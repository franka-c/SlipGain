# Testing

100% test coverage is the key to great vibe coding. Tests let you move fast, trust your instincts, and ship with confidence. Without them, vibe coding is just yolo coding. With tests, it's a superpower.

## Framework

Node's built-in test runner (`node:test` and `node:assert/strict`, Node 24). No dependencies.

## Running tests

```bash
npm test
```

This runs `node --test "tests/**/*.test.js"`. Tests do not load `.env`, so Supabase auth is off and no real Jira or Supabase calls are made.

## Layers

- **Unit tests** (`tests/*.test.js`): pure server logic in `lib/jira.js`, such as the slip/gain math in `calculateRow` and `summarize`.
- **Integration tests**: call the real request handlers exported from `lib/jira.js` (for example `handleEpics`) with a fake `global.fetch` standing in for Jira. Pass the request body as `req.body`.
- **Smoke / E2E**: the browser UI (`public/app.js`) has no automated tests yet. Check it in a real browser against `npm run start:local`.

## Conventions

- One file per area: `tests/<area>.test.js`.
- `const test = require("node:test")` and `const assert = require("node:assert/strict")`.
- Test names say the behavior in plain words, e.g. `"epics still load when the orphan lookup fails"`.
- Replace `global.fetch` inside the test and restore it in a `finally` block.
- Never put real credentials in tests; use placeholder values like `qa@decode.agency` / `test-token`.
