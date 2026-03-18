const JIRA_BASE_URL = process.env.JIRA_BASE_URL || "https://decode.atlassian.net";
const REMAINING_ESTIMATE_FIELD_ID =
  process.env.REMAINING_ESTIMATE_FIELD_ID || "customfield_10822";

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  if (typeof res.setHeader === "function") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
  }
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks).toString("utf8");
  if (!body) {
    return {};
  }

  return JSON.parse(body);
}

function normalizeBaseUrl(baseUrl) {
  return (baseUrl || JIRA_BASE_URL).trim().replace(/\/+$/, "");
}

function getCredentials(requestBody = {}) {
  const email = process.env.JIRA_EMAIL || requestBody.email;
  const apiToken = process.env.JIRA_API_TOKEN || requestBody.apiToken;
  const baseUrl = process.env.JIRA_BASE_URL || requestBody.baseUrl || JIRA_BASE_URL;

  if (!email || !apiToken) {
    throw new Error("Jira credentials are not configured.");
  }

  return { email, apiToken, baseUrl };
}

function getAuthHeader(email, apiToken) {
  return `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`;
}

async function jiraRequest({ baseUrl, email, apiToken, apiPath, method = "GET", body }) {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}${apiPath}`, {
    method,
    headers: {
      Accept: "application/json",
      Authorization: getAuthHeader(email, apiToken),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const detail =
      data?.errorMessages?.join(" ") ||
      (data?.errors && JSON.stringify(data.errors)) ||
      data?.message ||
      `Jira request failed with status ${response.status}`;
    const error = new Error(detail);
    error.status = response.status;
    error.responseData = data;
    error.apiPath = apiPath;
    error.requestBody = body;
    throw error;
  }

  return data;
}

async function fetchAllProjects(credentials) {
  const projects = [];
  let startAt = 0;
  const maxResults = 50;

  while (true) {
    const data = await jiraRequest({
      ...credentials,
      apiPath: `/rest/api/3/project/search?startAt=${startAt}&maxResults=${maxResults}`,
    });

    projects.push(...(data.values || []));

    if (projects.length >= (data.total || 0) || !(data.isLast === false)) {
      break;
    }

    startAt += maxResults;
  }

  return projects
    .map((project) => ({
      id: project.id,
      key: project.key,
      name: project.name,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function searchIssues(credentials, jql, fields) {
  const issues = [];
  let nextPageToken;
  const maxResults = 100;

  while (true) {
    const data = await jiraRequest({
      ...credentials,
      apiPath: "/rest/api/3/search/jql",
      method: "POST",
      body: {
        jql,
        maxResults,
        fields,
        fieldsByKeys: false,
        ...(nextPageToken ? { nextPageToken } : {}),
      },
    });

    issues.push(...(data.issues || []));

    if (data.isLast || !data.nextPageToken) {
      break;
    }

    nextPageToken = data.nextPageToken;
  }

  return issues;
}

function summarizeIssueTypes(issues) {
  const counts = {};

  for (const issue of issues) {
    const issueTypeName = issue.fields?.issuetype?.name || "Unknown";
    counts[issueTypeName] = (counts[issueTypeName] || 0) + 1;
  }

  return counts;
}

async function fetchEpicChildren(credentials, projectKey, epicKey) {
  const strategies = [
    `project = "${projectKey}" AND parentEpic = "${epicKey}"`,
    `project = "${projectKey}" AND "Epic Link" = "${epicKey}"`,
    `project = "${projectKey}" AND parent = "${epicKey}"`,
  ];

  const attempts = [];
  let bestMatch = { childIssues: [], issueCount: 0 };

  for (const jql of strategies) {
    try {
      const issues = await searchIssues(credentials, jql, ["timespent", "issuetype"]);
      attempts.push({
        jql,
        issueCount: issues.length,
        issueTypes: summarizeIssueTypes(issues),
        success: true,
      });

      if (issues.length > bestMatch.issueCount) {
        bestMatch = {
          childIssues: issues,
          issueCount: issues.length,
        };
      }
    } catch (error) {
      attempts.push({
        jql,
        success: false,
        error: error.message,
        status: error.status || null,
      });

      if (!String(error.message).toLowerCase().includes("field")) {
        throw error;
      }
    }
  }

  return { childIssues: bestMatch.childIssues, attempts };
}

function toHours(secondsValue) {
  const seconds = Number(secondsValue || 0);
  return Math.round((seconds / 3600) * 100) / 100;
}

function calculateRow(epic, remainingEstimateFieldId = REMAINING_ESTIMATE_FIELD_ID) {
  const originalEstimate = toHours(epic.fields.timeoriginalestimate);
  const remainingEstimate = Number(epic.fields[remainingEstimateFieldId] || 0);
  const timeSpent = epic.childIssues.reduce(
    (sum, issue) => sum + toHours(issue.fields.timespent),
    0
  );
  const slipGain = Number(
    (originalEstimate - remainingEstimate - timeSpent).toFixed(2)
  );
  const progress =
    timeSpent + remainingEstimate === 0
      ? 0
      : Number((timeSpent / (timeSpent + remainingEstimate)).toFixed(4));

  return {
    issueKey: epic.key,
    summary: epic.fields.summary || "",
    originalEstimate,
    remainingEstimate,
    timeSpent: Number(timeSpent.toFixed(2)),
    slipGain,
    progress,
  };
}

function summarize(rows) {
  const totalOriginalEstimate = rows.reduce((sum, row) => sum + row.originalEstimate, 0);
  const totalRemainingEstimate = rows.reduce(
    (sum, row) => sum + row.remainingEstimate,
    0
  );
  const totalSlipGain = rows.reduce((sum, row) => sum + row.slipGain, 0);
  const totalTimeSpent = rows.reduce((sum, row) => sum + row.timeSpent, 0);
  const slipGainWithoutUnestimated = rows
    .filter((row) => row.originalEstimate !== 0)
    .reduce((sum, row) => sum + row.slipGain, 0);
  const slipGainCompletedOnly = rows
    .filter((row) => row.remainingEstimate === 0)
    .reduce((sum, row) => sum + row.slipGain, 0);

  return {
    totalOriginalEstimate: Number(totalOriginalEstimate.toFixed(2)),
    totalRemainingEstimate: Number(totalRemainingEstimate.toFixed(2)),
    totalTimeSpent: Number(totalTimeSpent.toFixed(2)),
    slipGainAllIncluded: Number(totalSlipGain.toFixed(2)),
    slipGainAllIncludedPct:
      totalOriginalEstimate === 0
        ? 0
        : Number((totalSlipGain / totalOriginalEstimate).toFixed(4)),
    slipGainWithoutUnestimated: Number(slipGainWithoutUnestimated.toFixed(2)),
    slipGainWithoutUnestimatedPct:
      totalOriginalEstimate === 0
        ? 0
        : Number((slipGainWithoutUnestimated / totalOriginalEstimate).toFixed(4)),
    slipGainCompletedOnly: Number(slipGainCompletedOnly.toFixed(2)),
    slipGainCompletedOnlyPct:
      totalOriginalEstimate === 0
        ? 0
        : Number((slipGainCompletedOnly / totalOriginalEstimate).toFixed(4)),
  };
}

async function handleProjects(req, res) {
  try {
    const body = await readJsonBody(req);
    const credentials = getCredentials(body);
    const projects = await fetchAllProjects(credentials);
    sendJson(res, 200, { projects });
  } catch (error) {
    sendJson(res, 400, {
      error: error.message,
      hint:
        "Project loading failed. Check that Jira credentials are configured and valid.",
    });
  }
}

async function handleReport(req, res) {
  try {
    const body = await readJsonBody(req);
    const { projectKey } = body;

    if (!projectKey) {
      throw new Error("Project key is required.");
    }

    const credentials = getCredentials(body);
    const epicFields = ["summary", "timeoriginalestimate", REMAINING_ESTIMATE_FIELD_ID];
    const epicJql = `project = "${projectKey}" AND issuetype = Epic ORDER BY key ASC`;
    const epics = await searchIssues(credentials, epicJql, epicFields);

    const rows = [];
    const childLookupDebug = [];

    for (const epic of epics) {
      const childLookup = await fetchEpicChildren(credentials, projectKey, epic.key);
      childLookupDebug.push({
        epicKey: epic.key,
        attempts: childLookup.attempts,
      });
      rows.push(
        calculateRow(
          {
            ...epic,
            childIssues: childLookup.childIssues,
          },
          REMAINING_ESTIMATE_FIELD_ID
        )
      );
    }

    sendJson(res, 200, {
      rows,
      summary: summarize(rows),
      debug: {
        projectKey,
        jiraBaseUrl: normalizeBaseUrl(credentials.baseUrl),
        remainingEstimateFieldId: REMAINING_ESTIMATE_FIELD_ID,
        epicJql,
        epicCount: epics.length,
        childLookupDebug,
      },
    });
  } catch (error) {
    sendJson(res, 400, {
      error: error.message,
      hint:
        "Project loading succeeded, so the Jira connection is valid. This error happened while searching issues for the report.",
      debug: {
        status: error.status || null,
        apiPath: error.apiPath || null,
        requestBody: error.requestBody || null,
        responseData: error.responseData || null,
      },
    });
  }
}

function handleConfig(_req, res) {
  sendJson(res, 200, {
    managedAuth: Boolean(process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN),
    jiraBaseUrl: JIRA_BASE_URL,
    remainingEstimateFieldId: REMAINING_ESTIMATE_FIELD_ID,
  });
}

module.exports = {
  JIRA_BASE_URL,
  REMAINING_ESTIMATE_FIELD_ID,
  calculateRow,
  fetchAllProjects,
  getCredentials,
  handleConfig,
  handleProjects,
  handleReport,
  readJsonBody,
  summarize,
  toHours,
};
