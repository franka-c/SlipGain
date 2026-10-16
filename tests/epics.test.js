const test = require("node:test");
const assert = require("node:assert/strict");
const { handleEpics } = require("../lib/jira");

const credentials = { email: "qa@decode.agency", apiToken: "test-token" };

function jiraResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(payload),
  };
}

// Stands in for Jira: answers the field list, the epic search and the
// no-parent search. `onOrphanSearch` decides how the no-parent search behaves.
function fakeJira({ orphanIssues = [], onOrphanSearch } = {}) {
  const orphanJqls = [];
  const fetch = async (url, options = {}) => {
    if (url.endsWith("/rest/api/3/field")) {
      return jiraResponse(200, []);
    }
    const { jql } = JSON.parse(options.body || "{}");
    if (jql.includes("issuetype = Epic")) {
      return jiraResponse(200, {
        isLast: true,
        issues: [{ key: "ALS-1", fields: { summary: "Epic one", status: { name: "To Do" }, labels: [] } }],
      });
    }
    if (jql.includes("parent is EMPTY")) {
      orphanJqls.push(jql);
      if (onOrphanSearch) {
        return onOrphanSearch(jql);
      }
      return jiraResponse(200, { isLast: true, issues: orphanIssues });
    }
    throw new Error(`Unexpected Jira request: ${url} ${jql}`);
  };
  return { fetch, orphanJqls };
}

function issue(key, type, labels = []) {
  return {
    key,
    fields: { summary: `${key} summary`, issuetype: { name: type }, status: { name: "Done" }, labels },
  };
}

async function callEpics(fetch) {
  const originalFetch = global.fetch;
  global.fetch = fetch;
  const res = {
    statusCode: 0,
    setHeader() {},
    end(body) {
      this.body = JSON.parse(body);
    },
  };
  try {
    await handleEpics({ method: "POST", headers: {}, body: { projectKey: "ALS", ...credentials } }, res);
  } finally {
    global.fetch = originalFetch;
  }
  return res;
}

test("orphan warning lists only tasks and bugs, with only billable labels", async () => {
  const { fetch } = fakeJira({
    orphanIssues: [
      issue("ALS-11", "Task", ["non-billable", "frontend", "NON_BILLABLE"]),
      issue("ALS-12", "Bug", ["bilable", "billing"]),
      issue("ALS-13", "Story", ["billable"]),
      issue("ALS-14", "Task"),
    ],
  });

  const res = await callEpics(fetch);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(
    res.body.orphanIssues.map(({ key, issueType, labels }) => ({ key, issueType, labels })),
    [
      { key: "ALS-11", issueType: "Task", labels: ["non-billable", "NON_BILLABLE"] },
      { key: "ALS-12", issueType: "Bug", labels: ["bilable"] },
      { key: "ALS-14", issueType: "Task", labels: [] },
    ]
  );
  assert.ok(res.body.jiraBaseUrl.startsWith("https://"));
});

test("orphan lookup retries without Epic Link when the field does not exist", async () => {
  const { fetch, orphanJqls } = fakeJira({
    onOrphanSearch: (jql) =>
      jql.includes('"Epic Link"')
        ? jiraResponse(400, { errorMessages: ["Field 'Epic Link' does not exist or you do not have permission to view it."] })
        : jiraResponse(200, { isLast: true, issues: [issue("ALS-20", "Bug")] }),
  });

  const res = await callEpics(fetch);

  assert.equal(res.statusCode, 200);
  assert.equal(orphanJqls.length, 2);
  assert.ok(!orphanJqls[1].includes("Epic Link"));
  assert.deepEqual(res.body.orphanIssues.map((orphan) => orphan.key), ["ALS-20"]);
});

test("epics still load when the orphan lookup fails", async () => {
  const { fetch } = fakeJira({
    onOrphanSearch: () => jiraResponse(500, { errorMessages: ["Jira is down"] }),
  });
  const originalError = console.error;
  console.error = () => {};

  let res;
  try {
    res = await callEpics(fetch);
  } finally {
    console.error = originalError;
  }

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.epics.map((epic) => epic.key), ["ALS-1"]);
  assert.equal(res.body.orphanIssues, null);
});
