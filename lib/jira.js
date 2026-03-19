const JIRA_BASE_URL = process.env.JIRA_BASE_URL || "https://decode.atlassian.net";
const REMAINING_ESTIMATE_FIELD_ID =
  process.env.REMAINING_ESTIMATE_FIELD_ID || "customfield_10822";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const ALLOWED_EMAIL_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN || "decode.agency";

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

function isAuthEnabled() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

function isAllowedEmail(email) {
  return String(email || "").toLowerCase().endsWith(`@${ALLOWED_EMAIL_DOMAIN}`);
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

async function getAuthenticatedUser(req) {
  if (!isAuthEnabled()) {
    return null;
  }

  const authHeader =
    req.headers?.authorization || req.headers?.Authorization || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    const error = new Error("Authentication is required.");
    error.status = 401;
    throw error;
  }

  const accessToken = match[1];
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const text = await response.text();
  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(data?.msg || "Authentication failed.");
    error.status = 401;
    throw error;
  }

  if (!isAllowedEmail(data.email)) {
    const error = new Error("Only decode.agency accounts are allowed.");
    error.status = 403;
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

async function fetchFields(credentials) {
  return jiraRequest({
    ...credentials,
    apiPath: "/rest/api/3/field",
  });
}

async function discoverSprintFields(credentials) {
  const fields = await fetchFields(credentials);
  return fields
    .filter(
      (field) =>
        field.schema?.custom ===
        "com.pyxis.greenhopper.jira:gh-sprint"
    )
    .map((field) => field.id);
}

function normalizeName(value) {
  return String(value || "").trim();
}

function parseSprintNames(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => parseSprintNames(entry));
  }

  if (typeof value === "object") {
    const name = normalizeName(value.name);
    return name ? [name] : [];
  }

  if (typeof value === "string") {
    const directName = value.match(/name=([^,\]]+)/i);
    const sprintName = normalizeName(directName ? directName[1] : value);
    return sprintName ? [sprintName] : [];
  }

  return [];
}

function getEpicMetadata(epic, sprintFieldIds) {
  const sprintNames = sprintFieldIds.flatMap((fieldId) =>
    parseSprintNames(epic.fields?.[fieldId])
  );
  const uniqueSprintNames = [...new Set(sprintNames)].sort((a, b) =>
    a.localeCompare(b)
  );

  return {
    key: epic.key,
    summary: epic.fields.summary || "",
    status: epic.fields.status?.name || "Unknown",
    statusCategory: epic.fields.status?.statusCategory?.key || "unknown",
    labels: (epic.fields.labels || []).map((label) => String(label)).sort((a, b) =>
      a.localeCompare(b)
    ),
    milestones: (epic.fields.fixVersions || [])
      .map((version) => normalizeName(version?.name))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b)),
    sprints: uniqueSprintNames,
    completed:
      epic.fields.status?.statusCategory?.key === "done",
  };
}

function collectFilterOptions(epicMetadata) {
  const collect = (items) =>
    [...new Set(items.filter(Boolean))].sort((a, b) => a.localeCompare(b));

  return {
    statuses: collect(epicMetadata.map((epic) => epic.status)),
    labels: collect(epicMetadata.flatMap((epic) => epic.labels)),
    milestones: collect(epicMetadata.flatMap((epic) => epic.milestones)),
    sprints: collect(epicMetadata.flatMap((epic) => epic.sprints)),
  };
}

function normalizeFilterArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeName(entry))
    .filter(Boolean);
}

function applyEpicFilters(epics, filters = {}, sprintFieldIds = []) {
  const selectedEpicKeys = normalizeFilterArray(filters.selectedEpicKeys);
  const statuses = normalizeFilterArray(filters.statuses);
  const labels = normalizeFilterArray(filters.labels);
  const milestones = normalizeFilterArray(filters.milestones);
  const sprints = normalizeFilterArray(filters.sprints);
  const completionState = normalizeName(filters.completionState).toLowerCase() || "all";

  return epics.filter((epic) => {
    const metadata = getEpicMetadata(epic, sprintFieldIds);

    if (selectedEpicKeys.length > 0 && !selectedEpicKeys.includes(epic.key)) {
      return false;
    }

    if (statuses.length > 0 && !statuses.includes(metadata.status)) {
      return false;
    }

    if (
      labels.length > 0 &&
      !labels.some((label) => metadata.labels.includes(label))
    ) {
      return false;
    }

    if (
      milestones.length > 0 &&
      !milestones.some((milestone) => metadata.milestones.includes(milestone))
    ) {
      return false;
    }

    if (
      sprints.length > 0 &&
      !sprints.some((sprint) => metadata.sprints.includes(sprint))
    ) {
      return false;
    }

    if (completionState === "completed" && !metadata.completed) {
      return false;
    }

    if (completionState === "incomplete" && metadata.completed) {
      return false;
    }

    return true;
  });
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
    await getAuthenticatedUser(req);
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

async function handleEpics(req, res) {
  try {
    await getAuthenticatedUser(req);
    const body = await readJsonBody(req);
    const { projectKey } = body;

    if (!projectKey) {
      throw new Error("Project key is required.");
    }

    const credentials = getCredentials(body);
    const sprintFieldIds = await discoverSprintFields(credentials);
    const epicFields = [
      "summary",
      "status",
      "labels",
      "fixVersions",
      REMAINING_ESTIMATE_FIELD_ID,
      ...sprintFieldIds,
    ];
    const epicJql = `project = "${projectKey}" AND issuetype = Epic ORDER BY key ASC`;
    const epics = await searchIssues(credentials, epicJql, epicFields);
    const epicMetadata = epics.map((epic) => getEpicMetadata(epic, sprintFieldIds));

    sendJson(res, 200, {
      epics: epicMetadata,
      filters: collectFilterOptions(epicMetadata),
    });
  } catch (error) {
    sendJson(res, 400, {
      error: error.message,
      hint:
        "Project loading succeeded, but loading epic filters failed. Check Jira field availability for this project.",
      debug: {
        status: error.status || null,
        apiPath: error.apiPath || null,
        requestBody: error.requestBody || null,
        responseData: error.responseData || null,
      },
    });
  }
}

async function handleReport(req, res) {
  try {
    await getAuthenticatedUser(req);
    const body = await readJsonBody(req);
    const { projectKey } = body;

    if (!projectKey) {
      throw new Error("Project key is required.");
    }

    const credentials = getCredentials(body);
    const sprintFieldIds = await discoverSprintFields(credentials);
    const epicFields = [
      "summary",
      "timeoriginalestimate",
      REMAINING_ESTIMATE_FIELD_ID,
      "status",
      "labels",
      "fixVersions",
      ...sprintFieldIds,
    ];
    const epicJql = `project = "${projectKey}" AND issuetype = Epic ORDER BY key ASC`;
    const epics = await searchIssues(credentials, epicJql, epicFields);
    const filteredEpics = applyEpicFilters(epics, body.filters, sprintFieldIds);

    const rows = [];
    const childLookupDebug = [];

    for (const epic of filteredEpics) {
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
        filteredEpicCount: filteredEpics.length,
        appliedFilters: body.filters || {},
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
    authEnabled: isAuthEnabled(),
    jiraBaseUrl: JIRA_BASE_URL,
    remainingEstimateFieldId: REMAINING_ESTIMATE_FIELD_ID,
    supabaseUrl: SUPABASE_URL || null,
    supabaseAnonKey: SUPABASE_ANON_KEY || null,
    allowedEmailDomain: ALLOWED_EMAIL_DOMAIN,
  });
}

module.exports = {
  JIRA_BASE_URL,
  REMAINING_ESTIMATE_FIELD_ID,
  calculateRow,
  fetchAllProjects,
  getCredentials,
  handleConfig,
  handleEpics,
  handleProjects,
  handleReport,
  isAuthEnabled,
  readJsonBody,
  summarize,
  toHours,
};
