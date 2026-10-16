const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateRow, summarize } = require("../lib/jira");

const HOUR = 3600;
const REMAINING_FIELD = "customfield_test";

function epic(key, { original = 0, remaining = 0, children = [], epicTimeSpent = 0 } = {}) {
  return {
    key,
    fields: {
      summary: `${key} summary`,
      timeoriginalestimate: original * HOUR,
      timespent: epicTimeSpent * HOUR,
      [REMAINING_FIELD]: remaining,
    },
    resolvedChildIssues: children.map((hours, index) => ({
      key: `${key}-child-${index}`,
      fields: { timespent: hours * HOUR },
    })),
  };
}

test("calculateRow: slip/gain is original minus remaining minus time spent", () => {
  const row = calculateRow(epic("ALS-1", { original: 100, remaining: 30, children: [40, 10] }), REMAINING_FIELD);

  assert.equal(row.timeSpent, 50);
  assert.equal(row.slipGain, 20);
  assert.equal(row.progress, 0.625);
});

test("calculateRow: time logged directly on the epic counts toward time spent", () => {
  const row = calculateRow(epic("ALS-2", { original: 10, remaining: 0, children: [4], epicTimeSpent: 2 }), REMAINING_FIELD);

  assert.equal(row.timeSpent, 6);
  assert.equal(row.slipGain, 4);
  assert.equal(row.progress, 1);
});

test("calculateRow: no time and no remaining estimate means zero progress, not NaN", () => {
  const row = calculateRow(epic("ALS-3"), REMAINING_FIELD);

  assert.equal(row.progress, 0);
  assert.equal(row.slipGain, 0);
});

test("summarize: the three slip/gain views include the right epics", () => {
  const rows = [
    calculateRow(epic("DONE", { original: 50, remaining: 0, children: [40] }), REMAINING_FIELD),
    calculateRow(epic("OPEN", { original: 50, remaining: 20, children: [40] }), REMAINING_FIELD),
    calculateRow(epic("UNESTIMATED", { original: 0, remaining: 5, children: [5] }), REMAINING_FIELD),
  ];

  const summary = summarize(rows);

  assert.equal(summary.totalOriginalEstimate, 100);
  assert.equal(summary.slipGainAllIncluded, 10 + -10 + -10);
  assert.equal(summary.slipGainWithoutUnestimated, 10 + -10);
  assert.equal(summary.slipGainCompletedOnly, 10);
  assert.equal(summary.slipGainAllIncludedPct, -0.1);
});

test("summarize: an empty selection does not divide by zero", () => {
  const summary = summarize([]);

  assert.equal(summary.slipGainAllIncludedPct, 0);
  assert.equal(summary.slipGainWithoutUnestimatedPct, 0);
  assert.equal(summary.slipGainCompletedOnlyPct, 0);
});
