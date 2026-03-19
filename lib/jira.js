const JIRA_BASE_URL = process.env.JIRA_BASE_URL || "https://decode.atlassian.net";
const REMAINING_ESTIMATE_FIELD_ID =
  process.env.REMAINING_ESTIMATE_FIELD_ID || "customfield_10822";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ALLOWED_EMAIL_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN || "decode.agency";
const JIRA_MAX_RETRIES = Number(process.env.JIRA_MAX_RETRIES || 3);
const TREND_CACHE_TTL_MS = Number(
  process.env.TREND_CACHE_TTL_MS || 1000 * 60 * 15
);
const trendCache = new Map();

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

function isApprovalGateEnabled() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function isAllowedEmail(email) {
  return String(email || "").toLowerCase().endsWith(`@${ALLOWED_EMAIL_DOMAIN}`);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function fetchApprovedUser(email) {
  if (!isApprovalGateEnabled()) {
    return null;
  }

  const normalizedEmail = normalizeEmail(email);
  const url = new URL(`${SUPABASE_URL}/rest/v1/approved_users`);
  url.searchParams.set("select", "email,active,role,approved_by,created_at");
  url.searchParams.set("email", `eq.${normalizedEmail}`);
  url.searchParams.set("limit", "1");
  const data = await supabaseAdminRequest(url.toString());
  return Array.isArray(data) && data.length > 0 ? data[0] : null;
}

async function supabaseAdminRequest(url, { method = "GET", body } = {}) {
  if (!isApprovalGateEnabled()) {
    const error = new Error("Supabase admin access is not configured.");
    error.status = 500;
    throw error;
  }

  const response = await fetch(url, {
    method,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json", Prefer: "return=representation,resolution=merge-duplicates" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let data;

  try {
    data = text ? JSON.parse(text) : [];
  } catch {
    data = [];
  }

  if (!response.ok) {
    const detail =
      data?.message ||
      data?.error_description ||
      "Supabase admin request failed.";
    const error = new Error(detail);
    error.status = response.status;
    throw error;
  }

  return data;
}

async function fetchApprovedUsers() {
  const url = new URL(`${SUPABASE_URL}/rest/v1/approved_users`);
  url.searchParams.set("select", "email,active,role,approved_by,created_at");
  url.searchParams.set("order", "email.asc");
  const data = await supabaseAdminRequest(url.toString());
  return Array.isArray(data) ? data : [];
}

async function upsertApprovedUser({ email, role, active, approvedBy }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new Error("Email is required.");
  }

  if (!isAllowedEmail(normalizedEmail)) {
    throw new Error(`Only @${ALLOWED_EMAIL_DOMAIN} email addresses are allowed.`);
  }

  const normalizedRole = normalizeName(role).toLowerCase() === "admin" ? "admin" : "user";
  const payload = [
    {
      email: normalizedEmail,
      role: normalizedRole,
      active: active !== false,
      approved_by: normalizeEmail(approvedBy) || null,
    },
  ];

  return supabaseAdminRequest(`${SUPABASE_URL}/rest/v1/approved_users`, {
    method: "POST",
    body: payload,
  });
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

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseRetryAfterMs(response) {
  const retryAfter = response.headers.get("retry-after");
  if (!retryAfter) {
    return null;
  }

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const retryDate = new Date(retryAfter);
  if (Number.isNaN(retryDate.getTime())) {
    return null;
  }

  return Math.max(0, retryDate.getTime() - Date.now());
}

function getBackoffDelayMs(attempt, response) {
  const retryAfterMs = parseRetryAfterMs(response);
  if (retryAfterMs !== null) {
    return retryAfterMs;
  }

  const baseDelay = 1000 * 2 ** attempt;
  const jitter = Math.floor(Math.random() * 300);
  return baseDelay + jitter;
}

function pruneTrendCache() {
  const now = Date.now();

  for (const [key, entry] of trendCache.entries()) {
    if (entry.expiresAt <= now) {
      trendCache.delete(key);
    }
  }
}

function buildTrendCacheKey(baseUrl, projectKey, filters = {}, trendRange = {}) {
  return JSON.stringify({
    baseUrl: normalizeBaseUrl(baseUrl),
    projectKey: normalizeName(projectKey),
    filters: {
      completionState: normalizeName(filters.completionState).toLowerCase() || "all",
      selectedEpicKeys: normalizeFilterArray(filters.selectedEpicKeys).sort(),
      statuses: normalizeFilterArray(filters.statuses).sort(),
      labels: normalizeFilterArray(filters.labels).sort(),
      milestones: normalizeFilterArray(filters.milestones).sort(),
      sprints: normalizeFilterArray(filters.sprints).sort(),
    },
    trendRange: {
      startDate: normalizeName(trendRange.startDate),
      endDate: normalizeName(trendRange.endDate),
    },
    remainingEstimateFieldId: REMAINING_ESTIMATE_FIELD_ID,
  });
}

async function jiraRequest({ baseUrl, email, apiToken, apiPath, method = "GET", body }) {
  for (let attempt = 0; attempt <= JIRA_MAX_RETRIES; attempt += 1) {
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

    if (response.ok) {
      return data;
    }

    if (response.status === 429 && attempt < JIRA_MAX_RETRIES) {
      await sleep(getBackoffDelayMs(attempt, response));
      continue;
    }

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

  if (isApprovalGateEnabled()) {
    const approvedUser = await fetchApprovedUser(data.email);

    if (!approvedUser || approvedUser.active === false) {
      const error = new Error("Your account has not been approved for this app yet.");
      error.status = 403;
      throw error;
    }

    return {
      ...data,
      approvedUser,
      appRole: normalizeName(approvedUser.role).toLowerCase() === "admin" ? "admin" : "user",
    };
  }

  return {
    ...data,
    approvedUser: null,
    appRole: "user",
  };
}

async function requireAdmin(req) {
  const user = await getAuthenticatedUser(req);

  if (user?.appRole !== "admin") {
    const error = new Error("Admin access is required.");
    error.status = 403;
    throw error;
  }

  return user;
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

async function fetchIssueChangelog(credentials, issueKey) {
  const histories = [];
  let startAt = 0;
  const maxResults = 100;

  while (true) {
    const data = await jiraRequest({
      ...credentials,
      apiPath: `/rest/api/3/issue/${encodeURIComponent(issueKey)}/changelog?startAt=${startAt}&maxResults=${maxResults}`,
    });

    histories.push(...(data.values || []));

    if (histories.length >= (data.total || 0) || data.isLast) {
      break;
    }

    startAt += maxResults;
  }

  return histories;
}

async function fetchIssueWorklogs(credentials, issueKey) {
  const worklogs = [];
  let startAt = 0;
  const maxResults = 100;

  while (true) {
    const data = await jiraRequest({
      ...credentials,
      apiPath: `/rest/api/3/issue/${encodeURIComponent(issueKey)}/worklog?startAt=${startAt}&maxResults=${maxResults}`,
    });

    worklogs.push(...(data.worklogs || []));

    if (worklogs.length >= (data.total || 0)) {
      break;
    }

    startAt += maxResults;
  }

  return worklogs;
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

function matchesCompletionState(metadata, completionState) {
  if (completionState === "completed") {
    return metadata.completed;
  }

  if (completionState === "incomplete") {
    return !metadata.completed;
  }

  return false;
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

    const activeAutoMatches = [];

    if (statuses.length > 0) {
      activeAutoMatches.push(statuses.includes(metadata.status));
    }

    if (labels.length > 0) {
      activeAutoMatches.push(
        labels.some((label) => metadata.labels.includes(label))
      );
    }

    if (milestones.length > 0) {
      activeAutoMatches.push(
        milestones.some((milestone) => metadata.milestones.includes(milestone))
      );
    }

    if (sprints.length > 0) {
      activeAutoMatches.push(
        sprints.some((sprint) => metadata.sprints.includes(sprint))
      );
    }

    if (completionState !== "all") {
      activeAutoMatches.push(matchesCompletionState(metadata, completionState));
    }

    if (activeAutoMatches.length > 0 && !activeAutoMatches.some(Boolean)) {
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

function roundHours(value) {
  return Number(Number(value || 0).toFixed(2));
}

function parseDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function endOfUtcWeek(date) {
  const utcDate = startOfUtcDay(date);
  const day = utcDate.getUTCDay();
  const mondayOffset = (day + 6) % 7;
  const start = addUtcDays(utcDate, -mondayOffset);
  return addUtcDays(start, 6);
}

function endOfUtcMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function isSameUtcDay(firstDate, secondDate) {
  return (
    firstDate.getUTCFullYear() === secondDate.getUTCFullYear() &&
    firstDate.getUTCMonth() === secondDate.getUTCMonth() &&
    firstDate.getUTCDate() === secondDate.getUTCDate()
  );
}

function formatBucketLabel(date, granularity) {
  if (granularity === "monthly") {
    return date.toLocaleDateString("en-GB", {
      month: "2-digit",
      year: "2-digit",
      timeZone: "UTC",
    });
  }

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
  });
}

function buildBucketDates(startDate, endDate, granularity) {
  const safeStart = startOfUtcDay(startDate);
  const exactEnd = new Date(endDate.getTime());
  const safeEnd = startOfUtcDay(endDate);
  const buckets = [];

  let cursor =
    granularity === "monthly" ? endOfUtcMonth(safeStart) : endOfUtcWeek(safeStart);

  while (cursor <= safeEnd) {
    buckets.push(new Date(cursor));
    cursor =
      granularity === "monthly"
        ? endOfUtcMonth(new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1)))
        : addUtcDays(cursor, 7);
  }

  if (buckets.length === 0) {
    buckets.push(exactEnd);
    return buckets;
  }

  const lastBucket = buckets[buckets.length - 1];
  if (lastBucket.getTime() !== exactEnd.getTime()) {
    buckets.push(exactEnd);
  }

  return buckets;
}

function parseNumericHours(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  return roundHours(Number(value));
}

function parseEstimateSecondsToHours(value) {
  return toHours(value);
}

function matchesOriginalEstimateChange(item) {
  return (
    item.fieldId === "timeoriginalestimate" ||
    normalizeName(item.field).toLowerCase() === "original estimate"
  );
}

function matchesRemainingEstimateChange(item) {
  return item.fieldId === REMAINING_ESTIMATE_FIELD_ID;
}

function extractFieldChangeEvents(histories, matcher, valueParser) {
  return histories
    .flatMap((history) =>
      (history.items || [])
        .filter(matcher)
        .map((item) => ({
          changedAt: parseDate(history.created),
          fromValue: valueParser(item.from ?? item.fromString),
          toValue: valueParser(item.to ?? item.toString),
        }))
    )
    .filter((event) => event.changedAt)
    .sort((a, b) => a.changedAt - b.changedAt);
}

function getFieldValueAtDate(issueCreatedAt, currentValue, events, targetDate) {
  if (!issueCreatedAt || targetDate < issueCreatedAt) {
    return 0;
  }

  if (events.length === 0) {
    return roundHours(currentValue);
  }

  let value = roundHours(events[0].fromValue);

  for (const event of events) {
    if (event.changedAt > targetDate) {
      break;
    }

    value = roundHours(event.toValue);
  }

  return roundHours(value);
}

function buildWorklogEntries(worklogs) {
  return worklogs
    .map((worklog) => ({
      startedAt: parseDate(worklog.started),
      hours: toHours(worklog.timeSpentSeconds),
    }))
    .filter((entry) => entry.startedAt && entry.hours > 0)
    .sort((a, b) => a.startedAt - b.startedAt);
}

function buildCumulativeWorklogSeries(entries, bucketDates) {
  const series = [];
  let pointer = 0;
  let runningHours = 0;

  for (const bucketDate of bucketDates) {
    while (
      pointer < entries.length &&
      entries[pointer].startedAt <= bucketDate
    ) {
      runningHours += entries[pointer].hours;
      pointer += 1;
    }

    series.push(roundHours(runningHours));
  }

  return series;
}

function getEarliestRelevantDate(epics, epicChangelogs, worklogEntries) {
  const dates = [];

  for (const epic of epics) {
    const createdAt = parseDate(epic.fields.created);
    if (createdAt) {
      dates.push(createdAt);
    }
  }

  for (const histories of epicChangelogs.values()) {
    for (const history of histories) {
      const changedAt = parseDate(history.created);
      if (changedAt) {
        dates.push(changedAt);
      }
    }
  }

  for (const entry of worklogEntries) {
    dates.push(entry.startedAt);
  }

  if (dates.length === 0) {
    return startOfUtcDay(new Date());
  }

  return startOfUtcDay(new Date(Math.min(...dates.map((date) => date.getTime()))));
}

function buildTrendSeriesForGranularity(
  epics,
  epicChangelogs,
  worklogEntries,
  granularity,
  startDate,
  endDate
) {
  const bucketDates = buildBucketDates(startDate, endDate, granularity);
  const preparedEpics = epics.map((epic) => {
    const histories = epicChangelogs.get(epic.key) || [];
    return {
      createdAt: parseDate(epic.fields.created),
      currentOriginalEstimate: toHours(epic.fields.timeoriginalestimate),
      currentRemainingEstimate: parseNumericHours(
        epic.fields[REMAINING_ESTIMATE_FIELD_ID]
      ),
      originalEvents: extractFieldChangeEvents(
        histories,
        matchesOriginalEstimateChange,
        parseEstimateSecondsToHours
      ),
      remainingEvents: extractFieldChangeEvents(
        histories,
        matchesRemainingEstimateChange,
        parseNumericHours
      ),
    };
  });

  const originalSeries = bucketDates.map((bucketDate) =>
    roundHours(
      preparedEpics.reduce((sum, epic) => {
        return (
          sum +
          getFieldValueAtDate(
            epic.createdAt,
            epic.currentOriginalEstimate,
            epic.originalEvents,
            bucketDate
          )
        );
      }, 0)
    )
  );

  const remainingSeries = bucketDates.map((bucketDate) =>
    roundHours(
      preparedEpics.reduce((sum, epic) => {
        return (
          sum +
          getFieldValueAtDate(
            epic.createdAt,
            epic.currentRemainingEstimate,
            epic.remainingEvents,
            bucketDate
          )
        );
      }, 0)
    )
  );

  const timeSpentSeries = buildCumulativeWorklogSeries(worklogEntries, bucketDates);

  return bucketDates.map((bucketDate, index) => ({
    date: bucketDate.toISOString().slice(0, 10),
    label: formatBucketLabel(bucketDate, granularity),
    cumulativeOriginalEstimate: originalSeries[index],
    cumulativeTimeSpent: timeSpentSeries[index],
    remainingEstimate: remainingSeries[index],
    totalWork: roundHours(timeSpentSeries[index] + remainingSeries[index]),
  }));
}

async function buildTrendData(credentials, epicsWithChildren) {
  return buildTrendDataForRange(credentials, epicsWithChildren, {});
}

function normalizeTrendRange(range = {}) {
  const startDate = parseDate(range.startDate);
  const endDate = parseDate(range.endDate) || new Date();

  return {
    startDate,
    endDate,
  };
}

async function buildTrendDataForRange(credentials, epicsWithChildren, range = {}) {
  const epicChangelogEntries = await Promise.all(
    epicsWithChildren.map(async (epic) => [
      epic.key,
      await fetchIssueChangelog(credentials, epic.key),
    ])
  );
  const epicChangelogs = new Map(epicChangelogEntries);

  const childIssues = [
    ...new Map(
      epicsWithChildren
        .flatMap((epic) => epic.childIssues || [])
        .map((issue) => [issue.key, issue])
    ).values(),
  ];

  const childWorklogs = await Promise.all(
    childIssues.map(async (issue) =>
      fetchIssueWorklogs(credentials, issue.key)
    )
  );
  const { endDate } = normalizeTrendRange(range);
  const worklogEntries = buildWorklogEntries(childWorklogs.flat()).filter(
    (entry) => entry.startedAt <= endDate
  );

  const earliestDate = getEarliestRelevantDate(
    epicsWithChildren,
    epicChangelogs,
    worklogEntries
  );
  const requestedStartDate = normalizeTrendRange(range).startDate;
  const effectiveStartDate =
    requestedStartDate && requestedStartDate > earliestDate
      ? requestedStartDate
      : earliestDate;

  return {
    weekly: buildTrendSeriesForGranularity(
      epicsWithChildren,
      epicChangelogs,
      worklogEntries,
      "weekly",
      effectiveStartDate,
      endDate
    ),
    monthly: buildTrendSeriesForGranularity(
      epicsWithChildren,
      epicChangelogs,
      worklogEntries,
      "monthly",
      effectiveStartDate,
      endDate
    ),
  };
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

async function getFilteredEpicsWithChildren(credentials, projectKey, filters = {}) {
  const sprintFieldIds = await discoverSprintFields(credentials);
  const epicFields = [
    "summary",
    "created",
    "timeoriginalestimate",
    REMAINING_ESTIMATE_FIELD_ID,
    "status",
    "labels",
    "fixVersions",
    ...sprintFieldIds,
  ];
  const epicJql = `project = "${projectKey}" AND issuetype = Epic ORDER BY key ASC`;
  const epics = await searchIssues(credentials, epicJql, epicFields);
  const filteredEpics = applyEpicFilters(epics, filters, sprintFieldIds);
  const childLookupDebug = [];
  const epicsWithChildren = [];

  for (const epic of filteredEpics) {
    const childLookup = await fetchEpicChildren(credentials, projectKey, epic.key);
    childLookupDebug.push({
      epicKey: epic.key,
      attempts: childLookup.attempts,
    });
    epicsWithChildren.push({
      ...epic,
      childIssues: childLookup.childIssues,
    });
  }

  return {
    epicJql,
    epics,
    filteredEpics,
    epicsWithChildren,
    childLookupDebug,
  };
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
    const { epicJql, epics, filteredEpics, epicsWithChildren, childLookupDebug } =
      await getFilteredEpicsWithChildren(credentials, projectKey, body.filters);
    const rows = epicsWithChildren.map((epic) =>
      calculateRow(epic, REMAINING_ESTIMATE_FIELD_ID)
    );

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

async function handleTrends(req, res) {
  try {
    await getAuthenticatedUser(req);
    const body = await readJsonBody(req);
    const { projectKey, trendRange = {} } = body;

    if (!projectKey) {
      throw new Error("Project key is required.");
    }

    const credentials = getCredentials(body);
    pruneTrendCache();
    const cacheKey = buildTrendCacheKey(
      credentials.baseUrl,
      projectKey,
      body.filters,
      trendRange
    );
    const cachedEntry = trendCache.get(cacheKey);

    if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
      sendJson(res, 200, { trends: cachedEntry.value, cached: true });
      return;
    }

    const { epicsWithChildren } = await getFilteredEpicsWithChildren(
      credentials,
      projectKey,
      body.filters
    );
    const trends = await buildTrendDataForRange(
      credentials,
      epicsWithChildren,
      trendRange
    );

    trendCache.set(cacheKey, {
      value: trends,
      expiresAt: Date.now() + TREND_CACHE_TTL_MS,
    });

    sendJson(res, 200, { trends, cached: false });
  } catch (error) {
    sendJson(res, 400, {
      error: error.message,
      hint:
        "The main report can still work even when trend loading fails. Try narrowing the graph date range and loading it again.",
      debug: {
        status: error.status || null,
        apiPath: error.apiPath || null,
        requestBody: error.requestBody || null,
        responseData: error.responseData || null,
      },
    });
  }
}

async function handleCurrentUser(req, res) {
  try {
    const user = await getAuthenticatedUser(req);
    sendJson(res, 200, {
      user: {
        email: user.email,
        role: user.appRole || "user",
        approved: true,
      },
    });
  } catch (error) {
    sendJson(res, error.status || 400, {
      error: error.message,
    });
  }
}

async function handleAdminUsers(req, res) {
  try {
    const user = await requireAdmin(req);

    if (req.method === "GET") {
      const users = await fetchApprovedUsers();
      sendJson(res, 200, {
        currentUser: {
          email: user.email,
          role: user.appRole,
        },
        users,
      });
      return;
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      const saved = await upsertApprovedUser({
        email: body.email,
        role: body.role,
        active: body.active,
        approvedBy: user.email,
      });
      sendJson(res, 200, { user: saved?.[0] || null });
      return;
    }

    sendJson(res, 405, { error: "Method Not Allowed" });
  } catch (error) {
    sendJson(res, error.status || 400, {
      error: error.message,
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
    approvalGateEnabled: isApprovalGateEnabled(),
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
  handleCurrentUser,
  handleAdminUsers,
  handleEpics,
  handleProjects,
  handleReport,
  handleTrends,
  isAuthEnabled,
  readJsonBody,
  summarize,
  toHours,
};
