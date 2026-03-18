# Jira Slip/Gain Report App

This app reproduces the Excel slip/gain workflow and can run locally or on Vercel.

## Local run

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000).

Without environment variables, the UI will ask for Jira email and API token.

## Environment variables

Copy `.env.example` and provide:

- `JIRA_BASE_URL`
- `JIRA_EMAIL`
- `JIRA_API_TOKEN`
- `REMAINING_ESTIMATE_FIELD_ID`

When `JIRA_EMAIL` and `JIRA_API_TOKEN` are set, the UI hides credential fields and uses managed auth automatically.

## Vercel deploy

1. Push this project to GitHub.
2. Import the repository into Vercel.
3. Add these environment variables in Vercel Project Settings:
   - `JIRA_BASE_URL=https://decode.atlassian.net`
   - `JIRA_EMAIL=...`
   - `JIRA_API_TOKEN=...`
   - `REMAINING_ESTIMATE_FIELD_ID=customfield_10822`
4. Deploy.

The frontend is served as static files and the backend runs through Vercel Functions:

- `/api/config`
- `/api/projects`
- `/api/report`

## Jira assumptions

- `Original estimate` comes from Jira `timeoriginalestimate` on the epic and is converted from seconds to hours.
- `Remaining Estimate` comes from `customfield_10822` unless overridden by env.
- Child issues are looked up using:
  - `parentEpic = EPIC-123`
  - `"Epic Link" = EPIC-123`
  - `parent = EPIC-123`

## Notes

- CSV export includes both summary metrics and epic rows.
- PDF export opens a print-ready view that you save as PDF from the browser.
