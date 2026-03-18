const form = document.getElementById("config-form");
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
const reportMetadataSection = document.getElementById("report-metadata-section");
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
let managedAuth = false;

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function getFormPayload() {
  const data = new FormData(form);
  return Object.fromEntries(data.entries());
}

function getMetadataPayload() {
  const data = new FormData(reportMetadataForm);
  return Object.fromEntries(data.entries());
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
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
    return { managedAuth: false };
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

function renderSummary(summary) {
  latestRenderedSummary = summary;
  const estimateItems = [
    ["Original Estimate", summary.totalOriginalEstimate],
    ["Remaining Estimate", summary.totalRemainingEstimate],
    ["Total Time Spent", summary.totalTimeSpent],
  ];

  const performanceItems = [
    ["Time Spent", formatPercent(summary.timeSpentMetric), summary.timeSpentMetric],
    ["Time Passed", summary.timePassedMetric === null ? "Waiting for dates" : formatPercent(summary.timePassedMetric), summary.timePassedMetric],
    ["Overall Progress", formatPercent(summary.overallProgress), summary.overallProgress],
    ["Projection Till Deadline", summary.projectedTimeSpentTillDeadline === null ? "Waiting for dates" : formatPercent(summary.projectedTimeSpentTillDeadline), summary.projectedTimeSpentTillDeadline],
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

  if (managedAuth) {
    emailGroup.classList.add("hidden");
    tokenGroup.classList.add("hidden");
    loadProjectsGroup.classList.add("hidden");
    document.getElementById("email").required = false;
    document.getElementById("apiToken").required = false;
    loginEyebrow.textContent = "Project";
    loginTitle.textContent = "Project Selection";
    loginCopy.textContent =
      "Jira credentials are managed by the deployment. Choose a project, then generate the report.";
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
    "Load available projects first, then generate the report once the project is selected.";
}

function getSelectedProject() {
  return loadedProjects.find((project) => project.key === projectSelect.value) || null;
}

async function loadProjects() {
  const payload = getFormPayload();
  setStatus("Loading Jira projects...");

  try {
    const data = await postJson("/api/projects", payload);
    hideError();
    loadedProjects = data.projects;
    renderProjectOptions(loadedProjects);
    const hasProjects = data.projects.length > 0;
    projectPickerGroup.classList.toggle("hidden", !hasProjects);
    generateActionGroup.classList.toggle("hidden", !hasProjects);
    projectEmptyState.classList.toggle("hidden", hasProjects);
    setStatus(
      hasProjects
        ? `Loaded ${data.projects.length} projects.`
        : "No Jira projects were returned for this account."
    );
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
    ["Time Passed", summary.timePassedMetric === null ? "Waiting for dates" : formatPercent(summary.timePassedMetric)],
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
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60000);
}

function downloadPdf() {
  if (!latestRenderedSummary || latestRows.length === 0) {
    return;
  }

  const summary = latestRenderedSummary;
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
          body {
            font-family: "Avenir Next", "Segoe UI", sans-serif;
            margin: 24px;
            color: #1d232b;
          }
          h1, h2, p { margin: 0; }
          .page { display: grid; gap: 18px; }
          .topbar {
            display: flex;
            justify-content: space-between;
            align-items: start;
            border-bottom: 2px solid #d9e4f6;
            padding-bottom: 14px;
          }
          .title-block small, .label {
            color: #5a6472;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
          }
          .title-block h1 {
            margin-top: 6px;
            font-size: 30px;
            line-height: 1;
          }
          .summary-grid {
            display: grid;
            grid-template-columns: 1.2fr 1fr;
            gap: 18px;
          }
          .card {
            border: 1px solid #d7dee8;
            border-radius: 16px;
            padding: 16px;
          }
          .card h2 {
            font-size: 16px;
            margin-bottom: 12px;
          }
          .meta-grid, .metric-grid {
            display: grid;
            gap: 10px;
          }
          .meta-item, .metric-item {
            display: flex;
            justify-content: space-between;
            gap: 12px;
            font-size: 14px;
          }
          .metric-item strong, .meta-item strong {
            font-size: 14px;
          }
          .slip-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 14px;
          }
          .slip-table th, .slip-table td {
            border-bottom: 1px solid #e5e8ee;
            padding: 8px 10px;
            text-align: left;
            vertical-align: top;
          }
          .slip-table th {
            color: #5a6472;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.06em;
          }
          .positive { color: #0f7b48; font-weight: 700; }
          .negative { color: #ba2d0b; font-weight: 700; }
          @media print {
            body { margin: 12mm; }
          }
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
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60000);
}

loadProjectsButton.addEventListener("click", loadProjects);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const { email, apiToken, projectKey } = getFormPayload();
  const payload = { email, apiToken, projectKey };
  setStatus("Generating report. This can take a while for large projects...");
  exportButton.disabled = true;

  try {
    const data = await postJson("/api/report", payload);
    hideError();
    latestRows = data.rows;
    latestBaseSummary = data.summary;
    const selectedProject = getSelectedProject();
    const projectTitleInput = document.getElementById("projectTitle");

    if (projectTitleInput && !projectTitleInput.value) {
      projectTitleInput.value = selectedProject?.name || "";
    }

    reportMetadataSection.classList.remove("hidden");
    renderSummary(buildSummary(latestBaseSummary, getMetadataPayload()));
    renderRows(data.rows);
    exportActions.classList.toggle("hidden", data.rows.length === 0);
    exportButton.disabled = data.rows.length === 0;
    downloadPdfButton.disabled = data.rows.length === 0;
    setStatus(`Report ready. ${data.rows.length} epics included.`);
  } catch (error) {
    exportActions.classList.add("hidden");
    exportButton.disabled = true;
    downloadPdfButton.disabled = true;
    renderError(error.payload, error.message);
    setStatus(error.message, true);
  }
});

exportButton.addEventListener("click", exportCsv);
downloadPdfButton.addEventListener("click", downloadPdf);
reportMetadataForm.addEventListener("input", () => {
  renderSummary(buildSummary(latestBaseSummary, getMetadataPayload()));
});
dismissErrorButton.addEventListener("click", hideError);

document.addEventListener("DOMContentLoaded", () => {
  const today = new Date().toISOString().slice(0, 10);
  const reportCreationDateInput = document.getElementById("reportCreationDate");

  if (reportCreationDateInput && !reportCreationDateInput.value) {
    reportCreationDateInput.value = today;
  }

  fetchConfig()
    .then((config) => {
      applyManagedAuthUi(config);
      if (config?.managedAuth) {
        return loadProjects();
      }
      return null;
    })
    .catch(() => {
      managedAuth = false;
    });
});
