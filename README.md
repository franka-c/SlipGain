# Jira Slip/Gain Report App

This app reproduces the Excel report logic from `/Users/franka/Downloads/Slip_Gain template.xlsx` and fetches the source data directly from Jira.

## What it does

- Connects to Jira Cloud using your base URL, email, and API token.
- Loads available Jira projects so a PM can choose one.
- Fetches epics in that project.
- Uses your custom epic field for `Remaining Estimate`.
- Sums `Time Spent` from the child issues under each epic.
- Calculates:
  - `Slip/Gain = Original estimate - Remaining Estimate - Time Spent`
  - `Progress = Time Spent / (Time Spent + Remaining Estimate)`
- Shows report totals that match the workbook summary logic.
- Exports the generated report as CSV.

## Start

```bash
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

## Jira inputs you need

- Jira base URL, for example `https://your-company.atlassian.net`
- Jira user email
- Jira API token
- The custom field ID used for epic `Remaining Estimate`, for example `customfield_12345`

## Assumptions

- `Original estimate` comes from Jira's `timeoriginalestimate` field on the epic and is converted from seconds to hours.
- `Remaining Estimate` is stored on the epic in your custom field and is already expressed in hours.
- Child issues are looked up using these JQL fallbacks:
  - `parentEpic = EPIC-123`
  - `"Epic Link" = EPIC-123`
  - `parent = EPIC-123`

If your Jira setup uses a different way to link tasks to epics, that part may need adjustment.

## Notes

- Credentials are sent only to the local Node server running on your machine. They are not stored.
- This is a practical MVP. The next improvement would be adding saved configuration and generating a real `.xlsx` file instead of CSV.
