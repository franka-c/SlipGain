# Jira Slip/Gain Report App

This app reproduces the Excel slip/gain workflow and can run locally or on Vercel/Render.

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

## Optional authentication

To require users to sign up and log in with `@decode.agency` email addresses:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ALLOWED_EMAIL_DOMAIN=decode.agency`

With these set:

- the app shows a sign-up and login screen
- users must confirm their email from inbox
- API access is protected by authenticated session checks
- access can be further restricted to approved users only

Supabase should have email confirmation enabled for the project.

### Approved users table

To restrict access to specific users instead of the full domain, create a table in Supabase:

```sql
create table public.approved_users (
  email text primary key,
  active boolean not null default true,
  role text not null default 'user',
  approved_by text,
  created_at timestamptz not null default now()
);
```

Then insert the approved email addresses you want to allow:

```sql
insert into public.approved_users (email, active, role, approved_by)
values
  ('name@decode.agency', true, 'user', 'your.name@decode.agency');
```

To make `franka.cvetko@decode.agency` an admin from the start:

```sql
insert into public.approved_users (email, active, role, approved_by)
values
  ('franka.cvetko@decode.agency', true, 'admin', 'franka.cvetko@decode.agency')
on conflict (email) do update
set active = excluded.active,
    role = excluded.role,
    approved_by = excluded.approved_by;
```

When `SUPABASE_SERVICE_ROLE_KEY` is configured, the app will:

- still require `@decode.agency`
- also require the email to exist in `approved_users`
- deny access if `active = false`
- use `role = 'admin'` to unlock the admin screen

### Pending access requests

If you want sign-ups to appear in the admin screen as pending requests before approval, also create this table in Supabase:

```sql
create table public.access_requests (
  email text primary key,
  status text not null default 'pending',
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text
);
```

With both `approved_users` and `access_requests` in place:

- a new sign-up creates or refreshes a `pending` access request
- admins can review pending requests on `/admin`
- approving a request adds the user to `approved_users`
- the request is marked as `approved` with reviewer metadata

## Optional analytics

To enable PostHog analytics for the web app, set:

- `POSTHOG_KEY`
- `POSTHOG_HOST=https://eu.i.posthog.com`

The app exposes these values to the frontend through `/api/config` and initializes PostHog only when `POSTHOG_KEY` is present.

Pageview tracking:

- The app uses PostHog's built-in pageview capture.
- PostHog autocapture is enabled so the default web dashboards and interaction tracking work out of the box.
- Reference: [PostHog JavaScript SDK docs](https://posthog.com/docs/libraries/js)

Current PostHog events implemented:
- `login_succeeded`
  Properties:
  - `role`
  - `managed_auth`
- `projects_loaded`
  Properties:
  - `project_count`
- `report_generated`
  Properties:
  - `project_key`
  - `epic_count`
  - `filtered`
- `partial_report_used`
  Properties:
  - `project_key`
  - `selected_epic_count`
  - `status_filter_count`
  - `label_filter_count`
  - `completion_state`
- `last_week_hours_loaded`
  Properties:
  - `project_key`
  - `hours`
- `graph_loaded`
  Properties:
  - `trend_view`
  - `cached`
  - `start_date`
  - `end_date`
- `csv_exported`
  Properties:
  - `row_count`
  - `project_title`
- `pdf_exported`
  Properties:
  - `row_count`
  - `project_title`
  - `trend_view`
- `admin_opened`
  Properties:
  - `approved_user_count`
  - `pending_request_count`
- `approval_granted`
  Properties:
  - `approved_email_domain`
  - `role`
- `access_request_created`
  Properties:
  - `email_domain`
- `password_reset_requested`
  Properties:
  - `email_domain`
- `report_generation_failed`
  Properties:
  - `stage`
  - `status_code`
- `graph_load_failed`
  Properties:
  - `trend_view`
  - `status_code`

Notes:

- Session replay is disabled in the current PostHog setup.
- Jira credentials and report contents are not sent to PostHog.
- User identification uses the authenticated email plus:
  - `email_domain`
  - `role`

## Vercel deploy

1. Push this project to GitHub.
2. Import the repository into Vercel.
3. Add these environment variables in Vercel Project Settings:
   - `JIRA_BASE_URL=https://decode.atlassian.net`
   - `JIRA_EMAIL=...`
   - `JIRA_API_TOKEN=...`
   - `REMAINING_ESTIMATE_FIELD_ID=customfield_10822`
   - `SUPABASE_URL=...`
   - `SUPABASE_ANON_KEY=...`
   - `SUPABASE_SERVICE_ROLE_KEY=...`
   - `ALLOWED_EMAIL_DOMAIN=decode.agency`
   - `POSTHOG_KEY=...`
   - `POSTHOG_HOST=https://eu.i.posthog.com`
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
