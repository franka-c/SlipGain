import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const authCard = document.getElementById("auth-card");
const appShell = document.getElementById("app-shell");
const authStatusEl = document.getElementById("auth-status");
const authCopy = document.getElementById("auth-copy");
const authInfoButton = document.getElementById("auth-info-button");
const authInfoModal = document.getElementById("auth-info-modal");
const authInfoClose = document.getElementById("auth-info-close");
const authLayout = document.getElementById("auth-layout");
const signupForm = document.getElementById("signup-form");
const signinForm = document.getElementById("signin-form");
const resetPasswordForm = document.getElementById("reset-password-form");
const forgotPasswordButton = document.getElementById("forgot-password-button");
const accountMenuWrap = document.getElementById("account-menu-wrap");
const menuToggle = document.getElementById("menu-toggle");
const menuPanel = document.getElementById("menu-panel");
const reportButton = document.getElementById("report-button");
const adminButton = document.getElementById("admin-button");
const adjustFiltersButton = document.getElementById("adjust-filters-button");
const logoutButton = document.getElementById("logout-button");

const form = document.getElementById("config-form");
const loginCard = document.querySelector(".login-card");
const statusEl = document.getElementById("status");
const loginEyebrow = document.getElementById("login-eyebrow");
const loginTitle = document.getElementById("login-title");
const loginCopy = document.getElementById("login-copy");
const emailGroup = document.getElementById("email-group");
const tokenGroup = document.getElementById("token-group");
const loadProjectsGroup = document.getElementById("load-projects-group");
const projectPickerGroup = document.getElementById("project-picker-group");
const generateActionGroup = document.getElementById("generate-action-group");
const projectEmptyState = document.getElementById("project-empty-state");
const projectSelect = document.getElementById("projectKey");
const partialFilterSection = document.getElementById("partial-filter-section");
const completionStateSelect = document.getElementById("completion-state");
const statusOptions = document.getElementById("status-options");
const labelOptions = document.getElementById("label-options");
const epicOptions = document.getElementById("epic-options");
const epicSelectionCount = document.getElementById("epic-selection-count");
const selectAllEpicsButton = document.getElementById("select-all-epics");
const clearAllEpicsButton = document.getElementById("clear-all-epics");
const reportMetadataSection = document.getElementById("report-metadata-section");
const trendSection = document.getElementById("trend-section");
const trendChart = document.getElementById("trend-chart");
const trendToggleButtons = document.querySelectorAll("[data-trend-view]");
const trendControlsForm = document.getElementById("trend-controls-form");
const loadTrendButton = document.getElementById("load-trend-button");
const adminSection = document.getElementById("admin-section");
const backToReportButton = document.getElementById("back-to-report");
const adminUserForm = document.getElementById("admin-user-form");
const adminRequestsBody = document.getElementById("admin-requests-body");
const adminUsersBody = document.getElementById("admin-users-body");
const adminStatusEl = document.getElementById("admin-status");
const reportMetadataForm = document.getElementById("report-metadata-form");
const reportBody = document.getElementById("report-body");
const reportSection = document.getElementById("report-section");
const summarySection = document.getElementById("summary-section");
const errorSection = document.getElementById("error-section");
const errorMessage = document.getElementById("error-message");
const errorHint = document.getElementById("error-hint");
const errorDetails = document.getElementById("error-details");
const debugOutput = document.getElementById("debug-output");
const dismissErrorButton = document.getElementById("dismiss-error");
const exportActions = document.getElementById("export-actions");
const exportButton = document.getElementById("export-csv");
const downloadPdfButton = document.getElementById("download-pdf");
const loadProjectsButton = document.getElementById("load-projects");

let latestRows = [];
let loadedProjects = [];
let latestBaseSummary = null;
let latestRenderedSummary = null;
let latestTrendData = null;
let managedAuth = false;
let authEnabled = false;
let approvalGateEnabled = false;
let allowedEmailDomain = "decode.agency";
let supabase = null;
let accessToken = null;
let latestEpicFilters = null;
let selectedEpicKeysState = null;
let activeTrendView = "monthly";
let currentUser = null;
let approvedUsers = [];
let pendingRequests = [];
let passwordRecoveryMode = false;
let posthogEnabled = false;
const defaultAuthCopy = authCopy?.textContent || "";
const INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000;
let inactivityTimeoutId = null;
let inactivityListenersBound = false;
let lastCapturedPagePath = null;

function isAdminRoute() {
  return window.location.pathname === "/admin";
}

function navigateTo(path) {
  if (window.location.pathname === path) {
    applyRouteVisibility();
    capturePageview();
    closeMenu();
    return;
  }

  window.history.pushState({}, "", path);
  applyRouteVisibility();
  capturePageview();
  closeMenu();
}

function getTrendControlPayload() {
  const data = new FormData(trendControlsForm);
  return Object.fromEntries(data.entries());
}

function closeMenu() {
  menuPanel.classList.add("hidden");
  menuToggle.setAttribute("aria-expanded", "false");
}

function openAuthInfoModal() {
  authInfoModal?.classList.remove("hidden");
}

function closeAuthInfoModal() {
  authInfoModal?.classList.add("hidden");
}

function updateFilterMenuState() {
  const onAdminRoute = isAdminRoute();
  adjustFiltersButton.classList.toggle(
    "hidden",
    onAdminRoute || !latestEpicFilters?.epics?.length
  );
  adminButton.classList.toggle(
    "hidden",
    currentUser?.role !== "admin" || onAdminRoute
  );
  reportButton.classList.toggle("hidden", !onAdminRoute);
}

function setStatus(message, isError = false, isLoading = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
  statusEl.classList.toggle("loading", isLoading);
}

function setAuthStatus(message, isError = false) {
  authStatusEl.textContent = message;
  authStatusEl.classList.toggle("error", isError);
}

function setAdminStatus(message, isError = false) {
  adminStatusEl.textContent = message;
  adminStatusEl.classList.toggle("error", isError);
}

function applyAuthModeUi() {
  if (authLayout) {
    authLayout.classList.toggle("hidden", passwordRecoveryMode);
  }

  if (resetPasswordForm) {
    resetPasswordForm.classList.toggle("hidden", !passwordRecoveryMode);
  }

  if (authCopy) {
    authCopy.textContent = passwordRecoveryMode
      ? "Open the recovery email, follow the link, and set a new password here."
      : defaultAuthCopy;
  }
}

function hasRecoveryHash() {
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const params = new URLSearchParams(hash);
  return params.get("type") === "recovery";
}

function clearRecoveryHash() {
  const cleanUrl = `${window.location.pathname}${window.location.search}`;
  window.history.replaceState({}, "", cleanUrl);
}

function setPasswordRecoveryMode(isRecovery) {
  passwordRecoveryMode = isRecovery;
  applyAuthModeUi();

  if (!isRecovery) {
    resetPasswordForm?.reset();
    clearRecoveryHash();
  }
}

function setButtonLoading(button, isLoading, loadingLabel) {
  if (!button) {
    return;
  }

  if (!button.dataset.defaultLabel) {
    button.dataset.defaultLabel = button.textContent.trim();
  }

  button.disabled = isLoading;
  button.classList.toggle("button-loading", isLoading);
  button.textContent = isLoading ? loadingLabel : button.dataset.defaultLabel;
}

function initPosthog(config) {
  if (!config?.posthogKey || !window.posthog) {
    posthogEnabled = false;
    return;
  }

  window.posthog.init(config.posthogKey, {
    api_host: config.posthogHost || "https://eu.i.posthog.com",
    person_profiles: "identified_only",
    capture_pageview: false,
    capture_pageleave: false,
    autocapture: false,
    session_recording: {
      enabled: false,
    },
  });

  posthogEnabled = true;
}

function captureEvent(eventName, properties = {}) {
  if (!posthogEnabled || !window.posthog) {
    return;
  }

  window.posthog.capture(eventName, properties);
}

function getRouteName() {
  if (isAdminRoute()) {
    return "admin";
  }

  return "report";
}

function capturePageview({ force = false } = {}) {
  if (!posthogEnabled || !window.posthog) {
    return;
  }

  const currentPath = `${window.location.pathname}${window.location.search}`;
  if (!force && currentPath === lastCapturedPagePath) {
    return;
  }

  lastCapturedPagePath = currentPath;
  window.posthog.capture("$pageview", {
    path: window.location.pathname,
    full_path: currentPath,
    route_name: getRouteName(),
    is_admin_route: isAdminRoute(),
    managed_auth: managedAuth,
    auth_enabled: authEnabled,
    project_key: projectSelect?.value || "",
  });
}

function identifyPosthogUser(user) {
  if (!posthogEnabled || !window.posthog || !user?.email) {
    return;
  }

  window.posthog.identify(user.email, {
    email_domain: user.email.split("@")[1] || "",
    role: user.role || "user",
  });
}

function resetPosthogUser() {
  if (!posthogEnabled || !window.posthog) {
    return;
  }

  window.posthog.reset();
  lastCapturedPagePath = null;
}

function clearInactivityTimeout() {
  if (inactivityTimeoutId) {
    window.clearTimeout(inactivityTimeoutId);
    inactivityTimeoutId = null;
  }
}

async function handleInactivityLogout() {
  await handleLogout("Signed out after 1 hour of inactivity.");
}

function resetInactivityTimer() {
  if (!authEnabled || !accessToken || passwordRecoveryMode) {
    clearInactivityTimeout();
    return;
  }

  clearInactivityTimeout();
  inactivityTimeoutId = window.setTimeout(() => {
    handleInactivityLogout().catch((error) => {
      setAuthStatus(error.message || "Could not sign out inactive session.", true);
    });
  }, INACTIVITY_TIMEOUT_MS);
}

function bindInactivityListeners() {
  if (inactivityListenersBound) {
    return;
  }

  const events = ["pointerdown", "keydown", "mousemove", "scroll", "touchstart"];
  for (const eventName of events) {
    window.addEventListener(eventName, resetInactivityTimer, { passive: true });
  }

  inactivityListenersBound = true;
}

function getFormPayload() {
  const data = new FormData(form);
  return Object.fromEntries(data.entries());
}

function getMetadataPayload() {
  const data = new FormData(reportMetadataForm);
  return Object.fromEntries(data.entries());
}

function resetReportMetadata(projectName = "") {
  const today = new Date().toISOString().slice(0, 10);
  const projectTitleInput = document.getElementById("projectTitle");
  const reportCreationDateInput = document.getElementById("reportCreationDate");
  const projectStartDateInput = document.getElementById("projectStartDate");
  const deadlineInput = document.getElementById("deadline");
  const timeSpentLastWeekInput = document.getElementById("timeSpentLastWeek");
  const trendStartDateInput = document.getElementById("trendStartDate");
  const trendEndDateInput = document.getElementById("trendEndDate");

  if (projectTitleInput) {
    projectTitleInput.value = projectName;
  }

  if (reportCreationDateInput) {
    reportCreationDateInput.value = today;
  }

  if (projectStartDateInput) {
    projectStartDateInput.value = "";
  }

  if (deadlineInput) {
    deadlineInput.value = "";
  }

  if (timeSpentLastWeekInput) {
    timeSpentLastWeekInput.value = "";
  }

  if (trendStartDateInput) {
    trendStartDateInput.value = "";
    delete trendStartDateInput.dataset.userSet;
  }

  if (trendEndDateInput) {
    trendEndDateInput.value = today;
    delete trendEndDateInput.dataset.userSet;
  }
}

function resetConfigInputs() {
  const emailInput = document.getElementById("email");
  const apiTokenInput = document.getElementById("apiToken");

  if (emailInput) {
    emailInput.value = "";
  }

  if (apiTokenInput) {
    apiTokenInput.value = "";
  }
}

function resetAuthInputs() {
  const signupEmailInput = document.getElementById("signup-email");
  const signupPasswordInput = document.getElementById("signup-password");
  const signinEmailInput = document.getElementById("signin-email");
  const signinPasswordInput = document.getElementById("signin-password");

  if (signupEmailInput) {
    signupEmailInput.value = "";
  }

  if (signupPasswordInput) {
    signupPasswordInput.value = "";
  }

  if (signinEmailInput) {
    signinEmailInput.value = "";
  }

  if (signinPasswordInput) {
    signinPasswordInput.value = "";
  }
}

function resetAllEditableInputs() {
  resetAuthInputs();
  resetConfigInputs();
  resetReportMetadata("");
}

function isAllowedEmail(email) {
  return String(email || "").toLowerCase().endsWith(`@${allowedEmailDomain}`);
}

async function postJson(url, payload) {
  return requestJson(url, {
    method: "POST",
    payload,
  });
}

async function requestJson(url, { method = "GET", payload } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      ...(payload ? { "Content-Type": "application/json" } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });

  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || "Request failed.");
    error.payload = data;
    throw error;
  }

  return data;
}

async function fetchConfig() {
  const response = await fetch("/api/config");
  if (!response.ok) {
    return { managedAuth: false, authEnabled: false };
  }

  return response.json();
}

function formatHours(value) {
  return Number(value).toFixed(2);
}

function formatPercent(value) {
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderApprovedUsersTable(users) {
  adminUsersBody.innerHTML = users
    .map(
      (user) => `
        <tr>
          <td>${escapeHtml(user.email)}</td>
          <td>${escapeHtml(user.role || "user")}</td>
          <td>${user.active === false ? "No" : "Yes"}</td>
          <td>${escapeHtml(user.approved_by || "Not set")}</td>
          <td>
            <button
              type="button"
              class="secondary-button admin-edit-button"
              data-admin-email="${escapeHtml(user.email)}"
            >
              Edit
            </button>
          </td>
        </tr>
      `
    )
    .join("");
}

function renderPendingRequestsTable(requests) {
  adminRequestsBody.innerHTML = requests
    .map(
      (request) => `
        <tr>
          <td>${escapeHtml(request.email)}</td>
          <td>${escapeHtml(request.status || "pending")}</td>
          <td>${escapeHtml(request.requested_at || "")}</td>
          <td>
            ${
              request.status === "pending"
                ? `<button
                    type="button"
                    class="secondary-button admin-approve-button"
                    data-request-email="${escapeHtml(request.email)}"
                  >
                    Approve
                  </button>`
                : ""
            }
          </td>
        </tr>
      `
    )
    .join("");
}

function populateAdminForm(user) {
  document.getElementById("admin-email").value = user?.email || "";
  document.getElementById("admin-role").value = user?.role || "user";
  document.getElementById("admin-active").checked = user?.active !== false;
}

async function loadCurrentUser() {
  if (!authEnabled || !accessToken) {
    currentUser = null;
    updateFilterMenuState();
    return null;
  }

  const data = await requestJson("/api/me");
  currentUser = data.user || null;
  identifyPosthogUser(currentUser);
  updateFilterMenuState();
  return currentUser;
}

async function loadApprovedUsers() {
  const data = await requestJson("/api/admin/users");
  approvedUsers = data.users || [];
  pendingRequests = data.requests || [];
  renderApprovedUsersTable(approvedUsers);
  renderPendingRequestsTable(pendingRequests);
  return approvedUsers;
}

function openAdminSection() {
  if (currentUser?.role !== "admin") {
    return;
  }

  navigateTo("/admin");
}

function showReportRoute() {
  navigateTo("/");
}

function applyRouteVisibility() {
  const onAdminRoute = isAdminRoute();

  if (onAdminRoute && currentUser?.role && currentUser.role !== "admin") {
    window.history.replaceState({}, "", "/");
    applyRouteVisibility();
    return;
  }

  for (const section of [
    loginCard,
    partialFilterSection,
    reportMetadataSection,
    trendSection,
    summarySection,
    errorSection,
    reportSection,
  ]) {
    section.classList.toggle("route-hidden", onAdminRoute);
  }

  adminSection.classList.remove("hidden");
  adminSection.classList.toggle(
    "route-hidden",
    !onAdminRoute || currentUser?.role !== "admin"
  );
  updateFilterMenuState();
}

function formatDate(value) {
  if (!value) {
    return "Not set";
  }

  return new Date(`${value}T00:00:00`).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function safeRatio(numerator, denominator) {
  if (!denominator) {
    return 0;
  }

  return Number((numerator / denominator).toFixed(4));
}

function parseDateInput(value) {
  if (!value) {
    return null;
  }

  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysBetween(firstDate, secondDate) {
  const millisecondsPerDay = 1000 * 60 * 60 * 24;
  return Math.abs((secondDate.getTime() - firstDate.getTime()) / millisecondsPerDay);
}

function signedDaysBetween(firstDate, secondDate) {
  const millisecondsPerDay = 1000 * 60 * 60 * 24;
  return (secondDate.getTime() - firstDate.getTime()) / millisecondsPerDay;
}

function buildSummary(baseSummary, metadata) {
  if (!baseSummary) {
    return null;
  }

  const projectStartDate = parseDateInput(metadata.projectStartDate);
  const deadline = parseDateInput(metadata.deadline);
  const reportCreationDate = parseDateInput(metadata.reportCreationDate);
  const effectiveToday = reportCreationDate || new Date();
  const timeSpentLastWeek = Number(metadata.timeSpentLastWeek || 0);

  return {
    ...baseSummary,
    projectTitle: metadata.projectTitle || "Not set",
    reportCreationDate: metadata.reportCreationDate || "",
    projectStartDate: metadata.projectStartDate || "",
    deadline: metadata.deadline || "",
    timeSpentLastWeek: Number(timeSpentLastWeek.toFixed(2)),
    timeSpentMetric: safeRatio(baseSummary.totalTimeSpent, baseSummary.totalOriginalEstimate),
    timePassedMetric:
      projectStartDate && deadline
        ? safeRatio(daysBetween(projectStartDate, effectiveToday), daysBetween(projectStartDate, deadline))
        : null,
    overallProgress: safeRatio(
      baseSummary.totalTimeSpent,
      baseSummary.totalTimeSpent + baseSummary.totalRemainingEstimate
    ),
    projectedTimeSpentTillDeadline:
      reportCreationDate && deadline
        ? safeRatio(
            (signedDaysBetween(reportCreationDate, deadline) / 7) * timeSpentLastWeek + baseSummary.totalTimeSpent,
            baseSummary.totalOriginalEstimate
          )
        : null,
  };
}

function renderProgressBar(value) {
  const pct = Math.max(0, Math.min(1, Number(value)));
  const color = pct >= 1 ? "#00a86b" : "#0b6cf0";
  return `
    <div class="progress-track">
      <div class="progress-fill" style="width:${pct * 100}%; background:${color};"></div>
    </div>
  `;
}

function renderMetricProgressBar(value) {
  if (value === null || value === undefined) {
    return "";
  }

  const pct = Math.max(0, Math.min(1, Number(value)));
  const color = pct >= 1 ? "#00a86b" : "#0b6cf0";
  return `
    <div class="metric-progress-track">
      <div class="metric-progress-fill" style="width:${pct * 100}%; background:${color};"></div>
    </div>
  `;
}

function getTrendSeries(view = activeTrendView) {
  return latestTrendData?.[view] || [];
}

function pointHasAnyTrendValue(point) {
  return (
    Number(point.cumulativeOriginalEstimate) > 0 ||
    Number(point.cumulativeTimeSpent) > 0 ||
    Number(point.remainingEstimate) > 0 ||
    Number(point.totalWork) > 0
  );
}

function getVisibleTrendSeries(view = activeTrendView) {
  const series = getTrendSeries(view);

  if (!series.length) {
    return [];
  }

  const firstNonZeroIndex = series.findIndex(pointHasAnyTrendValue);
  if (firstNonZeroIndex === -1) {
    return series;
  }

  return series.slice(firstNonZeroIndex);
}

function syncTrendDateDefaults() {
  const metadata = getMetadataPayload();
  const trendControls = getTrendControlPayload();
  const trendStartDateInput = document.getElementById("trendStartDate");
  const trendEndDateInput = document.getElementById("trendEndDate");
  const today = new Date().toISOString().slice(0, 10);

  if (trendStartDateInput && (!trendControls.trendStartDate || !trendStartDateInput.dataset.userSet)) {
    trendStartDateInput.value = metadata.projectStartDate || "";
  }

  if (trendEndDateInput && (!trendControls.trendEndDate || !trendEndDateInput.dataset.userSet)) {
    trendEndDateInput.value = today;
  }
}

function renderTrendEmptyState(message) {
  trendChart.innerHTML = `<p class="filter-empty">${escapeHtml(message)}</p>`;
  trendSection.classList.remove("hidden");
}

function formatTrendTooltipValue(value) {
  return `${formatHours(value)}h`;
}

function buildTrendChartMarkup(view = activeTrendView) {
  const series = getVisibleTrendSeries(view);

  if (!series.length) {
    return "";
  }

  const width = 1040;
  const height = 420;
  const margin = { top: 28, right: 30, bottom: 70, left: 70 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(
    ...series.flatMap((point) => [
      point.cumulativeOriginalEstimate,
      point.cumulativeTimeSpent,
      point.remainingEstimate,
      point.totalWork,
    ]),
    0
  );
  const yMax = Math.max(10, Math.ceil(maxValue / 25) * 25);
  const yTicks = 5;
  const xAxisY = height - margin.bottom;

  const pointsToPolyline = (key) =>
    series
      .map((point, index) => {
        const x =
          margin.left +
          (series.length === 1 ? plotWidth / 2 : (index / (series.length - 1)) * plotWidth);
        const y =
          margin.top +
          plotHeight -
          (Number(point[key]) / yMax) * plotHeight;
        return `${x},${y}`;
      })
      .join(" ");

  const xPosition = (index) =>
    margin.left +
    (series.length === 1 ? plotWidth / 2 : (index / (series.length - 1)) * plotWidth);

  const yPosition = (value) =>
    margin.top + plotHeight - (Number(value) / yMax) * plotHeight;

  const lineDefs = [
    {
      key: "cumulativeOriginalEstimate",
      label: "Cumulative Original Estimate",
      color: "#0f7b48",
      dash: "",
      marker: "circle",
    },
    {
      key: "cumulativeTimeSpent",
      label: "Cumulative Time Spent",
      color: "#1a33ff",
      dash: "",
      marker: "square",
    },
    {
      key: "remainingEstimate",
      label: "Remaining Estimate",
      color: "#ff3b30",
      dash: "",
      marker: "square",
    },
    {
      key: "totalWork",
      label: "Total Work",
      color: "#8f1bb3",
      dash: "8 6",
      marker: "triangle",
    },
  ];

  const gridLines = Array.from({ length: yTicks + 1 }, (_, index) => {
    const value = (yMax / yTicks) * index;
    const y = yPosition(value);
    return `
      <line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" class="trend-grid-line" />
      <text x="${margin.left - 12}" y="${y + 5}" text-anchor="end" class="trend-axis-label">${Math.round(value)}</text>
    `;
  }).join("");

  const xLabels = series
    .map(
      (point, index) => `
        <text
          x="${xPosition(index)}"
          y="${xAxisY + 22}"
          text-anchor="start"
          dominant-baseline="hanging"
          transform="rotate(-40 ${xPosition(index)} ${xAxisY + 22})"
          class="trend-axis-label trend-axis-label-x"
        >${escapeHtml(point.label)}</text>
      `
    )
    .join("");

  const pointMarkers = lineDefs
    .map((line) =>
      series
        .map((point, index) => {
          const x = xPosition(index);
          const y = yPosition(point[line.key]);
          const tooltip = `${line.label}: ${formatTrendTooltipValue(point[line.key])}`;

          if (line.marker === "circle") {
            return `<circle cx="${x}" cy="${y}" r="5" fill="${line.color}"><title>${escapeHtml(tooltip)}</title></circle>`;
          }

          if (line.marker === "triangle") {
            const size = 7;
            return `
              <polygon points="${x},${y - size} ${x - size},${y + size} ${x + size},${y + size}" fill="${line.color}">
                <title>${escapeHtml(tooltip)}</title>
              </polygon>
            `;
          }

          return `
            <rect x="${x - 4.5}" y="${y - 4.5}" width="9" height="9" fill="${line.color}">
              <title>${escapeHtml(tooltip)}</title>
            </rect>
          `;
        })
        .join("")
    )
    .join("");

  return `
    <div class="trend-legend">
      ${lineDefs
        .map(
          (line) => `
            <div class="trend-legend-item">
              <span class="trend-legend-swatch" style="--swatch:${line.color}; --dash:${line.dash || "none"};"></span>
              <span>${line.label}</span>
            </div>
          `
        )
        .join("")}
    </div>
    <svg viewBox="0 0 ${width} ${height}" class="trend-svg" aria-label="Historical project workload chart">
      ${gridLines}
      <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" class="trend-axis-line" />
      <line x1="${margin.left}" y1="${xAxisY}" x2="${width - margin.right}" y2="${xAxisY}" class="trend-axis-line" />
      ${lineDefs
        .map(
          (line) => `
            <polyline
              fill="none"
              stroke="${line.color}"
              stroke-width="3"
              stroke-dasharray="${line.dash}"
              points="${pointsToPolyline(line.key)}"
            />
          `
        )
        .join("")}
      ${pointMarkers}
      ${xLabels}
      <text x="${margin.left - 48}" y="${margin.top - 6}" class="trend-axis-title">Hours</text>
    </svg>
  `;
}

function renderTrendChart() {
  const markup = buildTrendChartMarkup();

  if (!markup) {
    renderTrendEmptyState("No historical trend data is available for this selection.");
    return;
  }

  trendChart.innerHTML = markup;

  trendSection.classList.remove("hidden");
  trendToggleButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.trendView === activeTrendView);
  });
}

function renderSummary(summary) {
  latestRenderedSummary = summary;
  const estimateItems = [
    ["Original Estimate", summary.totalOriginalEstimate],
    ["Remaining Estimate", summary.totalRemainingEstimate],
    ["Total Time Spent", summary.totalTimeSpent],
  ];

  const performanceItems = [
    ["Time Spent", formatPercent(summary.timeSpentMetric), summary.timeSpentMetric],
    [
      "Time Passed",
      summary.timePassedMetric === null ? "Waiting for dates" : formatPercent(summary.timePassedMetric),
      summary.timePassedMetric,
    ],
    ["Overall Progress", formatPercent(summary.overallProgress), summary.overallProgress],
    [
      "Projection Till Deadline",
      summary.projectedTimeSpentTillDeadline === null
        ? "Waiting for dates"
        : formatPercent(summary.projectedTimeSpentTillDeadline),
      summary.projectedTimeSpentTillDeadline,
    ],
    ["Time Spent Last Week", formatHours(summary.timeSpentLastWeek), null],
  ];

  const slipGainItems = [
    ["All Included", summary.slipGainAllIncluded, summary.slipGainAllIncludedPct],
    ["Without Unestimated", summary.slipGainWithoutUnestimated, summary.slipGainWithoutUnestimatedPct],
    ["Completed Only", summary.slipGainCompletedOnly, summary.slipGainCompletedOnlyPct],
  ];

  summarySection.innerHTML = `
    <article class="summary-card slip-gain-group">
      <div class="slip-gain-header">
        <p>Slip/Gain</p>
        <strong>Portfolio View</strong>
      </div>
      <div class="slip-gain-grid">
        ${slipGainItems
          .map(([label, value, pct]) => {
            const tone = Number(value) < 0 ? "negative" : "positive";
            return `
              <div class="slip-gain-item ${tone}">
                <span>${label}</span>
                <strong>${formatPercent(pct)}</strong>
                <small>${formatHours(value)}h</small>
              </div>
            `;
          })
          .join("")}
      </div>
    </article>

    <article class="summary-card totals-group">
      <div class="slip-gain-header">
        <p>Totals</p>
        <strong>Estimate Snapshot</strong>
      </div>
      <div class="slip-gain-grid">
        ${estimateItems
          .map(
            ([label, value]) => `
              <div class="metric-item neutral">
                <span>${label}</span>
                <strong>${formatHours(value)}</strong>
              </div>
            `
          )
          .join("")}
      </div>
    </article>

    <article class="summary-card performance-group">
      <div class="slip-gain-header">
        <p>Progress</p>
        <strong>Workbook Metrics</strong>
      </div>
      <div class="slip-gain-grid">
        ${performanceItems
          .map(
            ([label, value, progressValue]) => `
              <div class="metric-item neutral">
                <span>${label}</span>
                <strong>${value}</strong>
                ${renderMetricProgressBar(progressValue)}
              </div>
            `
          )
          .join("")}
      </div>
    </article>
  `;
  summarySection.classList.remove("hidden");
}

async function loadLastWeekHours(payload) {
  const timeSpentLastWeekInput = document.getElementById("timeSpentLastWeek");

  if (timeSpentLastWeekInput) {
    timeSpentLastWeekInput.value = "";
    timeSpentLastWeekInput.placeholder = "Loading...";
  }

  try {
    const data = await postJson("/api/last-week-hours", {
      ...payload,
      debugParentIssueKey: "BSPK-1270",
    });

    if (timeSpentLastWeekInput) {
      timeSpentLastWeekInput.value = formatHours(
        Number(data.timeSpentLastWeekPrefill || 0)
      );
      timeSpentLastWeekInput.placeholder = "0";
    }
    captureEvent("last_week_hours_loaded", {
      project_key: payload.projectKey,
      hours: Number(data.timeSpentLastWeekPrefill || 0),
    });
    renderSummary(buildSummary(latestBaseSummary, getMetadataPayload()));
  } catch (error) {
    if (timeSpentLastWeekInput) {
      timeSpentLastWeekInput.value = "";
      timeSpentLastWeekInput.placeholder = "0";
    }
    setStatus(
      "Report ready. Last week hours could not be loaded.",
      true
    );
    captureEvent("report_generation_failed", {
      stage: "last_week_hours",
      status_code: error?.payload?.debug?.status || null,
    });
  }
}

function renderRows(rows) {
  reportBody.innerHTML = rows
    .map(
      (row) => `
        <tr>
          <td>${row.issueKey}</td>
          <td>${row.summary}</td>
          <td>${formatHours(row.originalEstimate)}</td>
          <td>${formatHours(row.remainingEstimate)}</td>
          <td>${formatHours(row.timeSpent)}</td>
          <td class="${row.slipGain < 0 ? "negative" : "positive"}">${formatHours(row.slipGain)}</td>
          <td>${formatPercent(row.progress)}</td>
          <td>${renderProgressBar(row.progress)}</td>
        </tr>
      `
    )
    .join("");

  reportSection.classList.remove("hidden");
}

function hideError() {
  errorMessage.textContent = "";
  errorHint.textContent = "";
  errorHint.classList.add("hidden");
  errorDetails.open = false;
  debugOutput.textContent = "";
  errorSection.classList.add("hidden");
}

function renderError(payload, fallbackMessage) {
  errorMessage.textContent = payload?.error || fallbackMessage || "Request failed.";

  if (payload?.hint) {
    errorHint.textContent = payload.hint;
    errorHint.classList.remove("hidden");
  } else {
    errorHint.textContent = "";
    errorHint.classList.add("hidden");
  }

  if (payload?.debug) {
    debugOutput.textContent = JSON.stringify(payload.debug, null, 2);
    errorDetails.classList.remove("hidden");
  } else {
    debugOutput.textContent = "";
    errorDetails.classList.add("hidden");
  }

  errorSection.classList.remove("hidden");
}

function renderProjectOptions(projects) {
  projectSelect.innerHTML = '<option value="">Select a project</option>';

  for (const project of projects) {
    const option = document.createElement("option");
    option.value = project.key;
    option.textContent = `${project.name} (${project.key})`;
    projectSelect.appendChild(option);
  }
}

function applyManagedAuthUi(config) {
  managedAuth = Boolean(config?.managedAuth);
  authEnabled = Boolean(config?.authEnabled);
  approvalGateEnabled = Boolean(config?.approvalGateEnabled);
  allowedEmailDomain = config?.allowedEmailDomain || "decode.agency";

  if (managedAuth) {
    emailGroup.classList.add("hidden");
    tokenGroup.classList.add("hidden");
    loadProjectsGroup.classList.add("hidden");
    document.getElementById("email").required = false;
    document.getElementById("apiToken").required = false;
    loginEyebrow.textContent = "Project";
    loginTitle.textContent = "Project Selection";
    loginCopy.textContent =
      "Jira credentials are managed by the deployment. Choose a project, refine the epic scope if needed, then generate the report.";
    return;
  }

  emailGroup.classList.remove("hidden");
  tokenGroup.classList.remove("hidden");
  loadProjectsGroup.classList.remove("hidden");
  document.getElementById("email").required = true;
  document.getElementById("apiToken").required = true;
  loginEyebrow.textContent = "Connect";
  loginTitle.textContent = "Jira Access";
  loginCopy.textContent =
    "Load available projects first, then choose a project and refine the epic scope before generating the report.";
}

function getSelectedProject() {
  return loadedProjects.find((project) => project.key === projectSelect.value) || null;
}

function renderCheckboxOptions(container, values, kind, checkedValues = null) {
  container.innerHTML = "";

  if (!values || values.length === 0) {
    container.innerHTML = '<p class="filter-empty">No options available for this project.</p>';
    return;
  }

  for (const value of values) {
    const option = document.createElement("label");
    option.className = "filter-option";
    option.innerHTML = `
      <input type="checkbox" data-filter-kind="${kind}" value="${escapeHtml(value)}" />
      <span>${escapeHtml(value)}</span>
    `;

    const input = option.querySelector("input");
    if (!checkedValues || checkedValues.has(value)) {
      input.checked = true;
    }

    container.appendChild(option);
  }
}

function getCheckedValues(kind) {
  return Array.from(document.querySelectorAll(`[data-filter-kind="${kind}"]:checked`)).map(
    (input) => input.value
  );
}

function updateEpicSelectionCount() {
  const total = epicOptions.querySelectorAll('input[type="checkbox"]').length;
  const selected = epicOptions.querySelectorAll('input[type="checkbox"]:checked').length;

  if (total === 0) {
    epicSelectionCount.textContent = "No epics available for this project.";
    return;
  }

  if (selected === total) {
    epicSelectionCount.textContent = `All ${total} loaded epics are currently included.`;
    return;
  }

  epicSelectionCount.textContent = `${selected} of ${total} epics are currently included.`;
}

function matchesCompletionState(epic, completionState) {
  if (completionState === "completed") {
    return epic.completed;
  }

  if (completionState === "incomplete") {
    return !epic.completed;
  }

  return false;
}

function epicMatchesAutoFilters(epic, filters) {
  const statuses = filters.statuses || [];
  const labels = filters.labels || [];
  const completionState = filters.completionState || "all";

  const activeAutoMatches = [];

  if (statuses.length > 0) {
    activeAutoMatches.push(statuses.includes(epic.status));
  }

  if (labels.length > 0) {
    activeAutoMatches.push(labels.some((label) => epic.labels.includes(label)));
  }

  if (completionState !== "all") {
    activeAutoMatches.push(matchesCompletionState(epic, completionState));
  }

  if (activeAutoMatches.length === 0) {
    return true;
  }

  return activeAutoMatches.some(Boolean);
}

function getAutoFilterValues() {
  return {
    completionState: completionStateSelect.value || "all",
    statuses: getCheckedValues("status"),
    labels: getCheckedValues("label"),
  };
}

function hasActiveAutoFilters(filters) {
  return (
    filters.completionState !== "all" ||
    filters.statuses.length > 0 ||
    filters.labels.length > 0
  );
}

function syncSelectedEpicKeysState() {
  selectedEpicKeysState = new Set(
    Array.from(epicOptions.querySelectorAll('input[type="checkbox"]:checked'))
      .map((input) => input.value || "")
      .filter(Boolean)
  );
}

function renderEpicOptions() {
  epicOptions.innerHTML = "";

  if (!latestEpicFilters?.epics?.length) {
    epicOptions.innerHTML = '<p class="filter-empty">No epics available for this project.</p>';
    updateEpicSelectionCount();
    return;
  }

  const autoFilters = getAutoFilterValues();
  const visibleEpics = latestEpicFilters.epics.filter((epic) =>
    epicMatchesAutoFilters(epic, autoFilters)
  );

  if (!hasActiveAutoFilters(autoFilters)) {
    selectedEpicKeysState = null;
  }

  if (visibleEpics.length === 0) {
    epicOptions.innerHTML =
      '<p class="filter-empty">No epics match the current status, label, and completion filters.</p>';
    updateEpicSelectionCount();
    return;
  }

  const visibleEpicKeys = new Set(visibleEpics.map((epic) => epic.key));
  if (selectedEpicKeysState instanceof Set) {
    selectedEpicKeysState = new Set(
      [...selectedEpicKeysState].filter((key) => visibleEpicKeys.has(key))
    );
  }

  for (const epic of visibleEpics) {
    const option = document.createElement("label");
    option.className = "filter-option";
    option.innerHTML = `
      <input type="checkbox" data-filter-kind="epic" value="${escapeHtml(epic.key)}" />
      <span>${escapeHtml(epic.key)} - ${escapeHtml(epic.summary)}</span>
    `;

    const input = option.querySelector("input");
    input.checked =
      !(selectedEpicKeysState instanceof Set) || selectedEpicKeysState.has(epic.key);
    epicOptions.appendChild(option);
  }

  syncSelectedEpicKeysState();
  updateEpicSelectionCount();
}

function resetPartialFilters() {
  latestEpicFilters = null;
  selectedEpicKeysState = null;
  partialFilterSection.classList.add("hidden");
  completionStateSelect.value = "all";
  statusOptions.innerHTML = "";
  labelOptions.innerHTML = "";
  epicOptions.innerHTML = "";
  epicSelectionCount.textContent = "All loaded epics are currently included.";
  updateFilterMenuState();
}

function resetTrendData() {
  latestTrendData = null;
  activeTrendView = "monthly";
  trendChart.innerHTML = "";
  trendSection.classList.add("hidden");
  trendToggleButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.trendView === "monthly");
  });
  loadTrendButton.disabled = false;
}

async function loadTrendData() {
  const { email, apiToken, projectKey } = getFormPayload();
  const { trendStartDate, trendEndDate } = getTrendControlPayload();

  if (!projectKey) {
    setStatus("Choose a project before loading the graph.", true);
    return;
  }

  setButtonLoading(loadTrendButton, true, "Loading graph...");
  setStatus("Loading historical graph...");

  try {
    const data = await postJson("/api/trends", {
      email,
      apiToken,
      projectKey,
      filters: getReportFilters(),
      trendRange: {
        startDate: trendStartDate || undefined,
        endDate: trendEndDate || undefined,
      },
    });

    hideError();
    latestTrendData = data.trends || null;
    renderTrendChart();
    setStatus("Historical graph loaded.");
    captureEvent("graph_loaded", {
      trend_view: activeTrendView,
      cached: Boolean(data.cached),
      start_date: trendStartDate || "",
      end_date: trendEndDate || "",
    });
  } catch (error) {
    latestTrendData = null;
    renderTrendEmptyState("Could not load the historical graph for this date range.");
    renderError(error.payload, error.message);
    setStatus(error.message, true);
    captureEvent("graph_load_failed", {
      trend_view: activeTrendView,
      status_code: error?.payload?.debug?.status || null,
    });
  } finally {
    setButtonLoading(loadTrendButton, false);
  }
}

function renderPartialFilters(epicPayload) {
  latestEpicFilters = epicPayload;
  selectedEpicKeysState = null;
  completionStateSelect.value = "all";
  renderCheckboxOptions(
    statusOptions,
    epicPayload.filters.statuses,
    "status",
    new Set()
  );
  renderCheckboxOptions(
    labelOptions,
    epicPayload.filters.labels,
    "label",
    new Set()
  );
  renderEpicOptions();
  partialFilterSection.classList.toggle("hidden", epicPayload.epics.length === 0);
  updateFilterMenuState();
}

function showPartialFilters() {
  if (!latestEpicFilters?.epics?.length) {
    return;
  }

  partialFilterSection.classList.remove("hidden");
  closeMenu();
  partialFilterSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function getSelectedEpicKeys() {
  syncSelectedEpicKeysState();
  return selectedEpicKeysState instanceof Set ? [...selectedEpicKeysState] : [];
}

function getReportFilters() {
  return {
    completionState: completionStateSelect.value || "all",
    selectedEpicKeys: getSelectedEpicKeys(),
    statuses: getCheckedValues("status"),
    labels: getCheckedValues("label"),
  };
}

async function loadEpicFilters() {
  const payload = getFormPayload();
  const { projectKey } = payload;
  const selectedProject = getSelectedProject();

  resetPartialFilters();
  resetReportMetadata(selectedProject?.name || "");
  latestRows = [];
  latestBaseSummary = null;
  latestRenderedSummary = null;
  resetTrendData();
  exportActions.classList.add("hidden");
  reportMetadataSection.classList.add("hidden");
  reportSection.classList.add("hidden");
  summarySection.classList.add("hidden");
  generateActionGroup.classList.add("hidden");

  if (!projectKey) {
    setStatus("Choose a project to load its epics.");
    return;
  }

  setStatus("Loading epic filters...");

  try {
    const data = await postJson("/api/epics", payload);
    hideError();
    renderPartialFilters(data);
    generateActionGroup.classList.toggle("hidden", data.epics.length === 0);
    setStatus(
      data.epics.length > 0
        ? `Loaded ${data.epics.length} epics. Adjust filters, then generate the report.`
        : "No epics were returned for this project."
    );
  } catch (error) {
    renderError(error.payload, error.message);
    setStatus(error.message, true);
  }
}

async function loadProjects() {
  const payload = getFormPayload();
  setStatus("Loading Jira projects...");
  resetPartialFilters();
  latestRows = [];
  latestBaseSummary = null;
  latestRenderedSummary = null;
  resetTrendData();
  exportActions.classList.add("hidden");
  reportMetadataSection.classList.add("hidden");
  reportSection.classList.add("hidden");
  summarySection.classList.add("hidden");

  try {
    const data = await postJson("/api/projects", payload);
    hideError();
    loadedProjects = data.projects;
    renderProjectOptions(loadedProjects);
    const hasProjects = data.projects.length > 0;
    projectPickerGroup.classList.toggle("hidden", !hasProjects);
    generateActionGroup.classList.add("hidden");
    projectEmptyState.classList.toggle("hidden", hasProjects);
    setStatus(
      hasProjects
        ? `Loaded ${data.projects.length} projects. Choose one to load its epic filters.`
        : "No Jira projects were returned for this account."
    );
    if (hasProjects) {
      captureEvent("projects_loaded", {
        project_count: data.projects.length,
      });
    }
  } catch (error) {
    loadedProjects = [];
    projectPickerGroup.classList.add("hidden");
    generateActionGroup.classList.add("hidden");
    projectEmptyState.classList.add("hidden");
    setStatus(error.message, true);
  }
}

function exportCsv() {
  if (!latestRenderedSummary) {
    setStatus("Generate a report before exporting CSV.", true);
    return;
  }

  const summary = latestRenderedSummary;
  const summaryRows = [
    ["Project Title", summary.projectTitle],
    ["Report Creation Date", formatDate(summary.reportCreationDate)],
    ["Project Start Date", formatDate(summary.projectStartDate)],
    ["Deadline", formatDate(summary.deadline)],
    ["Total Original Estimate", formatHours(summary.totalOriginalEstimate)],
    ["Total Remaining Estimate", formatHours(summary.totalRemainingEstimate)],
    ["Total Time Spent", formatHours(summary.totalTimeSpent)],
    ["Slip/Gain All Included", formatHours(summary.slipGainAllIncluded)],
    ["Slip/Gain All Included %", formatPercent(summary.slipGainAllIncludedPct)],
    ["Slip/Gain Without Unestimated", formatHours(summary.slipGainWithoutUnestimated)],
    ["Slip/Gain Without Unestimated %", formatPercent(summary.slipGainWithoutUnestimatedPct)],
    ["Slip/Gain Completed Only", formatHours(summary.slipGainCompletedOnly)],
    ["Slip/Gain Completed Only %", formatPercent(summary.slipGainCompletedOnlyPct)],
    ["Time Spent Metric", formatPercent(summary.timeSpentMetric)],
    [
      "Time Passed",
      summary.timePassedMetric === null ? "Waiting for dates" : formatPercent(summary.timePassedMetric),
    ],
    ["Overall Progress", formatPercent(summary.overallProgress)],
    ["Time Spent Last Week", formatHours(summary.timeSpentLastWeek)],
    [
      "Projection Till Deadline",
      summary.projectedTimeSpentTillDeadline === null
        ? "Waiting for dates"
        : formatPercent(summary.projectedTimeSpentTillDeadline),
    ],
  ];

  const headers = [
    "Issue Key",
    "Summary",
    "Original estimate",
    "Remaining Estimate",
    "Time Spent",
    "Slip/Gain",
    "Progress",
  ];

  const lines = latestRows.map((row) =>
    [
      row.issueKey,
      row.summary,
      row.originalEstimate,
      row.remainingEstimate,
      row.timeSpent,
      row.slipGain,
      row.progress,
    ]
      .map((value) => `"${String(value).replaceAll('"', '""')}"`)
      .join(",")
  );

  const summaryCsv = [
    ["Metric", "Value"].join(","),
    ...summaryRows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")),
    "",
    headers.join(","),
  ];

  const csv = [...summaryCsv, ...lines].join("\n");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const downloadFrame = window.open(url, "_blank");

  if (!downloadFrame) {
    setStatus("The CSV export window was blocked by the browser. Allow pop-ups and try again.", true);
    return;
  }

  setStatus("CSV opened in a new tab. Save it from there if it does not download automatically.");
  captureEvent("csv_exported", {
    row_count: latestRows.length,
    project_title: latestRenderedSummary.projectTitle || "",
  });
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60000);
}

function downloadPdf() {
  if (!latestRenderedSummary || latestRows.length === 0) {
    return;
  }

  const summary = latestRenderedSummary;
  const trendMarkup = buildTrendChartMarkup(activeTrendView);
  const trendViewLabel = activeTrendView === "monthly" ? "Monthly view" : "Weekly view";
  const slipGainItems = [
    ["Slip/gain all included", formatHours(summary.slipGainAllIncluded), formatPercent(summary.slipGainAllIncludedPct)],
    ["Slip/gain without unestimated work", formatHours(summary.slipGainWithoutUnestimated), formatPercent(summary.slipGainWithoutUnestimatedPct)],
    ["Slip/gain only completed work", formatHours(summary.slipGainCompletedOnly), formatPercent(summary.slipGainCompletedOnlyPct)],
  ];

  const metricRows = [
    ["Time spent", formatPercent(summary.timeSpentMetric)],
    ["Time passed", summary.timePassedMetric === null ? "Waiting for dates" : formatPercent(summary.timePassedMetric)],
    ["Overall progress", formatPercent(summary.overallProgress)],
    ["Last week time spent", formatHours(summary.timeSpentLastWeek)],
    ["Projection of time spent till deadline", summary.projectedTimeSpentTillDeadline === null ? "Waiting for dates" : formatPercent(summary.projectedTimeSpentTillDeadline)],
  ];

  const tableRows = latestRows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.issueKey)}</td>
          <td>${escapeHtml(row.summary)}</td>
          <td>${formatHours(row.originalEstimate)}</td>
          <td>${formatHours(row.remainingEstimate)}</td>
          <td>${formatHours(row.timeSpent)}</td>
          <td class="${row.slipGain < 0 ? "negative" : "positive"}">${formatHours(row.slipGain)}</td>
          <td>${formatPercent(row.progress)}</td>
        </tr>
      `
    )
    .join("");

  const printHtml = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>${escapeHtml(summary.projectTitle || "Slip Gain Report")}</title>
        <style>
          body { font-family: "Avenir Next", "Segoe UI", sans-serif; margin: 24px; color: #1d232b; }
          h1, h2, p { margin: 0; }
          .page { display: grid; gap: 18px; }
          .topbar { display: flex; justify-content: space-between; align-items: start; border-bottom: 2px solid #d9e4f6; padding-bottom: 14px; }
          .title-block small, .label { color: #5a6472; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
          .title-block h1 { margin-top: 6px; font-size: 30px; line-height: 1; }
          .summary-grid { display: grid; grid-template-columns: 1.2fr 1fr; gap: 18px; }
          .card { border: 1px solid #d7dee8; border-radius: 16px; padding: 16px; }
          .card h2 { font-size: 16px; margin-bottom: 12px; }
          .meta-grid, .metric-grid { display: grid; gap: 10px; }
          .meta-item, .metric-item { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; }
          .metric-item strong, .meta-item strong { font-size: 14px; }
          .trend-shell { display: grid; gap: 14px; }
          .trend-copy { margin-top: 4px; color: #5a6472; font-size: 13px; }
          .trend-legend { display: flex; flex-wrap: wrap; gap: 12px 16px; margin-bottom: 10px; }
          .trend-legend-item { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; }
          .trend-legend-swatch { width: 28px; height: 0; border-top: 3px solid var(--swatch); border-radius: 999px; position: relative; }
          .trend-legend-swatch::after { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--swatch); position: absolute; right: -1px; top: -5px; }
          .trend-svg { width: 100%; height: auto; display: block; }
          .trend-grid-line { stroke: rgba(90, 100, 114, 0.22); stroke-dasharray: 5 5; }
          .trend-axis-line { stroke: rgba(29, 35, 43, 0.24); stroke-width: 1.4; }
          .trend-axis-label { fill: #5a6472; font-size: 13px; font-family: "Avenir Next", "Segoe UI", sans-serif; }
          .trend-axis-title { fill: #5a6472; font-size: 14px; font-weight: 700; font-family: "Avenir Next", "Segoe UI", sans-serif; }
          .slip-table { width: 100%; border-collapse: collapse; font-size: 14px; }
          .slip-table th, .slip-table td { border-bottom: 1px solid #e5e8ee; padding: 8px 10px; text-align: left; vertical-align: top; }
          .slip-table th { color: #5a6472; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; }
          .positive { color: #0f7b48; font-weight: 700; }
          .negative { color: #ba2d0b; font-weight: 700; }
          @media print { body { margin: 12mm; } }
        </style>
      </head>
      <body>
        <div class="page">
          <section class="topbar">
            <div class="title-block">
              <small>Jira Slip/Gain</small>
              <h1>${escapeHtml(summary.projectTitle || "Project report")}</h1>
            </div>
            <div class="meta-grid">
              <div class="meta-item"><span class="label">Report date</span><strong>${escapeHtml(formatDate(summary.reportCreationDate))}</strong></div>
              <div class="meta-item"><span class="label">Project start date</span><strong>${escapeHtml(formatDate(summary.projectStartDate))}</strong></div>
              <div class="meta-item"><span class="label">Deadline</span><strong>${escapeHtml(formatDate(summary.deadline))}</strong></div>
            </div>
          </section>
          <section class="summary-grid">
            <div class="card">
              <h2>Overview</h2>
              <div class="metric-grid">
                <div class="metric-item"><span>Original estimate</span><strong>${formatHours(summary.totalOriginalEstimate)}</strong></div>
                ${slipGainItems
                  .map(
                    ([label, amount, pct]) => `
                      <div class="metric-item">
                        <span>${escapeHtml(label)}</span>
                        <strong>${escapeHtml(amount)} / ${escapeHtml(pct)}</strong>
                      </div>
                    `
                  )
                  .join("")}
              </div>
            </div>
            <div class="card">
              <h2>Workbook Metrics</h2>
              <div class="metric-grid">
                ${metricRows
                  .map(
                    ([label, value]) => `
                      <div class="metric-item">
                        <span>${escapeHtml(label)}</span>
                        <strong>${escapeHtml(value)}</strong>
                      </div>
                    `
                  )
                  .join("")}
              </div>
            </div>
          </section>
          ${
            trendMarkup
              ? `
                <section class="card trend-shell">
                  <div>
                    <h2>Workload Trend</h2>
                    <p class="trend-copy">${escapeHtml(trendViewLabel)}. Cumulative original estimate, logged time, remaining estimate, and total work for the included epics.</p>
                  </div>
                  <div>${trendMarkup}</div>
                </section>
              `
              : ""
          }
          <section class="card">
            <h2>Epic Breakdown</h2>
            <table class="slip-table">
              <thead>
                <tr>
                  <th>Issue Key</th>
                  <th>Summary</th>
                  <th>Original Estimate</th>
                  <th>Remaining Estimate</th>
                  <th>Time Spent</th>
                  <th>Slip/Gain</th>
                  <th>Progress</th>
                </tr>
              </thead>
              <tbody>${tableRows}</tbody>
            </table>
          </section>
        </div>
        <script>
          window.addEventListener("load", () => {
            setTimeout(() => window.print(), 150);
          });
        </script>
      </body>
    </html>
  `;

  const blob = new Blob([printHtml], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const printWindow = window.open(url, "_blank");

  if (!printWindow) {
    setStatus("The PDF window was blocked by the browser. Allow pop-ups and try again.", true);
    return;
  }

  setStatus("PDF view opened in a new tab.");
  captureEvent("pdf_exported", {
    row_count: latestRows.length,
    project_title: latestRenderedSummary.projectTitle || "",
    trend_view: activeTrendView,
  });
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60000);
}

async function updateAuthState(session) {
  accessToken = session?.access_token || null;

  if (authEnabled && passwordRecoveryMode) {
    clearInactivityTimeout();
    currentUser = null;
    authCard.classList.remove("hidden");
    appShell.classList.add("hidden");
    accountMenuWrap.classList.add("hidden");
    adminSection.classList.add("hidden");
    updateFilterMenuState();
    closeMenu();
    return;
  }

  if (authEnabled && !session) {
    clearInactivityTimeout();
    currentUser = null;
    authCard.classList.remove("hidden");
    appShell.classList.add("hidden");
    accountMenuWrap.classList.add("hidden");
    adminSection.classList.add("hidden");
    updateFilterMenuState();
    closeMenu();
    resetPosthogUser();
    return;
  }

  if (authEnabled && session) {
    await loadCurrentUser();
  }

  authCard.classList.add("hidden");
  appShell.classList.remove("hidden");
  accountMenuWrap.classList.toggle("hidden", !(authEnabled && session));
  if (isAdminRoute() && currentUser?.role === "admin") {
    await loadApprovedUsers();
    setAdminStatus("Approved users loaded.");
  }
  applyRouteVisibility();
  updateFilterMenuState();
  resetInactivityTimer();
}

async function handleLogout(message = "Signed out.") {
  if (!supabase) {
    return;
  }

  const { error } = await supabase.auth.signOut();
  if (error) {
    setAuthStatus(error.message, true);
    return;
  }

  latestRows = [];
  latestBaseSummary = null;
  latestRenderedSummary = null;
  currentUser = null;
  approvedUsers = [];
  resetTrendData();
  loadedProjects = [];
  exportActions.classList.add("hidden");
  reportMetadataSection.classList.add("hidden");
  reportSection.classList.add("hidden");
  summarySection.classList.add("hidden");
  resetReportMetadata("");
  resetPartialFilters();
  adminSection.classList.add("hidden");
  projectPickerGroup.classList.add("hidden");
  generateActionGroup.classList.add("hidden");
  projectEmptyState.classList.add("hidden");
  renderProjectOptions([]);
  closeMenu();
  clearInactivityTimeout();
  setAuthStatus(message);
}

async function handleSignUp(event) {
  event.preventDefault();

  if (!supabase) {
    return;
  }

  const email = document.getElementById("signup-email").value.trim();
  const password = document.getElementById("signup-password").value;

  if (!isAllowedEmail(email)) {
    setAuthStatus(`Only @${allowedEmailDomain} email addresses are allowed.`, true);
    return;
  }

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: window.location.origin,
    },
  });

  if (error) {
    setAuthStatus(error.message, true);
    return;
  }

  if (approvalGateEnabled) {
    try {
      await postJson("/api/access-request", { email });
      captureEvent("access_request_created", {
        email_domain: email.split("@")[1] || "",
      });
    } catch (requestError) {
      setAuthStatus(requestError.message, true);
      return;
    }
  }

  setAuthStatus(
    approvalGateEnabled
      ? "Check your inbox and confirm your email. You will also need to be approved before you can access the app."
      : "Check your inbox and confirm your email before logging in."
  );
}

async function handleSignIn(event) {
  event.preventDefault();

  if (!supabase) {
    return;
  }

  const email = document.getElementById("signin-email").value.trim();
  const password = document.getElementById("signin-password").value;

  if (!isAllowedEmail(email)) {
    setAuthStatus(`Only @${allowedEmailDomain} email addresses are allowed.`, true);
    return;
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    setAuthStatus(error.message, true);
    return;
  }

  setAuthStatus("Signed in.");
  try {
    await updateAuthState(data.session);
    captureEvent("login_succeeded", {
      role: currentUser?.role || "user",
      managed_auth: managedAuth,
    });
    navigateTo("/");
    if (managedAuth) {
      await loadProjects();
    }
  } catch (authError) {
    if (supabase) {
      await supabase.auth.signOut();
    }
    setAuthStatus(authError.message, true);
  }
}

async function handleForgotPassword() {
  if (!supabase) {
    return;
  }

  const email = document.getElementById("signin-email").value.trim();

  if (!email) {
    setAuthStatus("Enter your work email first, then request a password reset.", true);
    return;
  }

  if (!isAllowedEmail(email)) {
    setAuthStatus(`Only @${allowedEmailDomain} email addresses are allowed.`, true);
    return;
  }

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  });

  if (error) {
    setAuthStatus(error.message, true);
    return;
  }

  captureEvent("password_reset_requested", {
    email_domain: email.split("@")[1] || "",
  });
  setAuthStatus("Password reset email sent. Open the link from your inbox to set a new password.");
}

async function handleResetPassword(event) {
  event.preventDefault();

  if (!supabase) {
    return;
  }

  const password = document.getElementById("reset-password").value;
  const confirmPassword = document.getElementById("reset-password-confirm").value;

  if (!password) {
    setAuthStatus("Enter a new password.", true);
    return;
  }

  if (password !== confirmPassword) {
    setAuthStatus("The password confirmation does not match.", true);
    return;
  }

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    setAuthStatus(error.message, true);
    return;
  }

  setPasswordRecoveryMode(false);
  await supabase.auth.signOut();
  setAuthStatus("Password updated. Log in with your new password.");
}

loadProjectsButton.addEventListener("click", loadProjects);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const { email, apiToken, projectKey } = getFormPayload();
  const payload = {
    email,
    apiToken,
    projectKey,
    filters: getReportFilters(),
  };
  setStatus("Generating report. This can take a while for large projects...", false, true);
  exportButton.disabled = true;

  try {
    const data = await postJson("/api/report", payload);
    hideError();
    latestRows = data.rows;
    latestBaseSummary = data.summary;
    const selectedProject = getSelectedProject();
    const projectTitleInput = document.getElementById("projectTitle");
    const timeSpentLastWeekInput = document.getElementById("timeSpentLastWeek");

    if (projectTitleInput && !projectTitleInput.value) {
      projectTitleInput.value = selectedProject?.name || "";
    }
    if (timeSpentLastWeekInput) {
      timeSpentLastWeekInput.value = "";
      timeSpentLastWeekInput.placeholder = "Loading...";
    }

    reportMetadataSection.classList.remove("hidden");
    syncTrendDateDefaults();
    trendSection.classList.remove("hidden");
    renderTrendEmptyState("Choose a date range and click Load Graph.");
    renderSummary(buildSummary(latestBaseSummary, getMetadataPayload()));
    renderRows(data.rows);
    partialFilterSection.classList.add("hidden");
    exportActions.classList.toggle("hidden", data.rows.length === 0);
    exportButton.disabled = data.rows.length === 0;
    downloadPdfButton.disabled = data.rows.length === 0;
    setStatus(`Report ready. ${data.rows.length} epics included.`);
    const reportFilters = getReportFilters();
    captureEvent("report_generated", {
      project_key: projectKey,
      epic_count: data.rows.length,
      filtered: Boolean(
        reportFilters.selectedEpicKeys?.length ||
          reportFilters.statuses?.length ||
          reportFilters.labels?.length ||
          (reportFilters.completionState && reportFilters.completionState !== "all")
      ),
    });
    if (
      reportFilters.selectedEpicKeys?.length ||
      reportFilters.statuses?.length ||
      reportFilters.labels?.length ||
      (reportFilters.completionState && reportFilters.completionState !== "all")
    ) {
      captureEvent("partial_report_used", {
        project_key: projectKey,
        selected_epic_count: reportFilters.selectedEpicKeys?.length || 0,
        status_filter_count: reportFilters.statuses?.length || 0,
        label_filter_count: reportFilters.labels?.length || 0,
        completion_state: reportFilters.completionState || "all",
      });
    }
    loadLastWeekHours(payload);
  } catch (error) {
    exportActions.classList.add("hidden");
    exportButton.disabled = true;
    downloadPdfButton.disabled = true;
    renderError(error.payload, error.message);
    setStatus(error.message, true);
    captureEvent("report_generation_failed", {
      stage: "report",
      status_code: error?.payload?.debug?.status || null,
    });
  }
});

adjustFiltersButton.addEventListener("click", showPartialFilters);
adminButton.addEventListener("click", async () => {
  try {
    setAdminStatus("Loading approved users...");
    await loadApprovedUsers();
    setAdminStatus("Approved users loaded.");
    captureEvent("admin_opened", {
      approved_user_count: approvedUsers.length,
      pending_request_count: pendingRequests.length,
    });
    openAdminSection();
  } catch (error) {
    setAdminStatus(error.message, true);
  }
});
reportButton.addEventListener("click", showReportRoute);
backToReportButton.addEventListener("click", showReportRoute);
exportButton.addEventListener("click", exportCsv);
downloadPdfButton.addEventListener("click", downloadPdf);
trendToggleButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeTrendView = button.dataset.trendView || "weekly";
    if (latestTrendData) {
      renderTrendChart();
    }
  });
});
reportMetadataForm.addEventListener("input", () => {
  renderSummary(buildSummary(latestBaseSummary, getMetadataPayload()));
  syncTrendDateDefaults();
  if (latestTrendData) {
    renderTrendChart();
  }
});
trendControlsForm.addEventListener("input", (event) => {
  if (event.target instanceof HTMLInputElement) {
    event.target.dataset.userSet = "true";
  }
});
loadTrendButton.addEventListener("click", loadTrendData);
adminUserForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = document.getElementById("admin-email").value.trim();
  const role = document.getElementById("admin-role").value;
  const active = document.getElementById("admin-active").checked;

  try {
    setAdminStatus("Saving user...");
    await postJson("/api/admin/users", { email, role, active });
    await loadApprovedUsers();
    populateAdminForm();
    setAdminStatus("User saved.");
  } catch (error) {
    setAdminStatus(error.message, true);
  }
});
dismissErrorButton.addEventListener("click", hideError);
signupForm.addEventListener("submit", handleSignUp);
signinForm.addEventListener("submit", handleSignIn);
resetPasswordForm.addEventListener("submit", handleResetPassword);
forgotPasswordButton.addEventListener("click", handleForgotPassword);
authInfoButton?.addEventListener("click", openAuthInfoModal);
authInfoClose?.addEventListener("click", closeAuthInfoModal);
projectSelect.addEventListener("change", loadEpicFilters);
partialFilterSection.addEventListener("change", (event) => {
  if (event.target.closest("#epic-options")) {
    syncSelectedEpicKeysState();
    updateEpicSelectionCount();
    return;
  }

  if (event.target.matches('[data-filter-kind="status"], [data-filter-kind="label"], #completion-state')) {
    renderEpicOptions();
  }
});
selectAllEpicsButton.addEventListener("click", () => {
  for (const input of epicOptions.querySelectorAll('input[type="checkbox"]')) {
    input.checked = true;
  }
  syncSelectedEpicKeysState();
  updateEpicSelectionCount();
});
clearAllEpicsButton.addEventListener("click", () => {
  for (const input of epicOptions.querySelectorAll('input[type="checkbox"]')) {
    input.checked = false;
  }
  syncSelectedEpicKeysState();
  updateEpicSelectionCount();
});
adminUsersBody.addEventListener("click", (event) => {
  const button = event.target.closest(".admin-edit-button");
  if (!button) {
    return;
  }

  const user = approvedUsers.find((entry) => entry.email === button.dataset.adminEmail);
  if (user) {
    populateAdminForm(user);
    adminSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }
});
adminRequestsBody.addEventListener("click", async (event) => {
  const button = event.target.closest(".admin-approve-button");
  if (!button) {
    return;
  }

  const email = button.dataset.requestEmail;
  if (!email) {
    return;
  }

  try {
    setAdminStatus("Approving request...");
    await postJson("/api/admin/users", {
      action: "approve-request",
      email,
      role: "user",
      active: true,
    });
    await loadApprovedUsers();
    setAdminStatus("Request approved.");
    captureEvent("approval_granted", {
      approved_email_domain: email.split("@")[1] || "",
      role: "user",
    });
  } catch (error) {
    setAdminStatus(error.message, true);
  }
});
for (const button of document.querySelectorAll("[data-filter-clear]")) {
  button.addEventListener("click", () => {
    const filterKind = button.dataset.filterClear;
    const map = {
      status: "status",
      label: "label",
    };
    const checkboxKind = map[filterKind];
    if (!checkboxKind) {
      return;
    }

    for (const input of document.querySelectorAll(`[data-filter-kind="${checkboxKind}"]`)) {
      input.checked = false;
    }

    renderEpicOptions();
  });
}
menuToggle.addEventListener("click", () => {
  const isOpen = !menuPanel.classList.contains("hidden");
  menuPanel.classList.toggle("hidden", isOpen);
  menuToggle.setAttribute("aria-expanded", String(!isOpen));
});
logoutButton.addEventListener("click", handleLogout);
document.addEventListener("click", (event) => {
  if (!accountMenuWrap.contains(event.target)) {
    closeMenu();
  }

  if (event.target === authInfoModal) {
    closeAuthInfoModal();
  }
});

window.addEventListener("popstate", () => {
  applyRouteVisibility();
  capturePageview({ force: true });
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeAuthInfoModal();
  }
});

document.addEventListener("DOMContentLoaded", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const reportCreationDateInput = document.getElementById("reportCreationDate");

  resetAllEditableInputs();

  if (reportCreationDateInput && !reportCreationDateInput.value) {
    reportCreationDateInput.value = today;
  }

  try {
    const config = await fetchConfig();
    applyManagedAuthUi(config);
    initPosthog(config);
    setPasswordRecoveryMode(hasRecoveryHash());
    bindInactivityListeners();

    if (config?.authEnabled && config.supabaseUrl && config.supabaseAnonKey) {
      supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
      const {
        data: { session },
      } = await supabase.auth.getSession();
      await updateAuthState(session);
      if (passwordRecoveryMode) {
        setAuthStatus("Set a new password to finish resetting your account.");
      }
      supabase.auth.onAuthStateChange(async (event, nextSession) => {
        if (event === "PASSWORD_RECOVERY") {
          setPasswordRecoveryMode(true);
          setAuthStatus("Set a new password to finish resetting your account.");
          await updateAuthState(nextSession);
          return;
        }

        await updateAuthState(nextSession);
      });

      if (session && managedAuth) {
        await loadProjects();
      }
      applyRouteVisibility();
      capturePageview({ force: true });
      return;
    }

    await updateAuthState(null);
    if (config?.managedAuth) {
      await loadProjects();
    }
    applyRouteVisibility();
    capturePageview({ force: true });
  } catch {
    await updateAuthState(null);
    applyRouteVisibility();
    capturePageview({ force: true });
  }
});

window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    resetAllEditableInputs();
  }
});
