# MinuteBook — Persona Test Suite

End-to-end tests that impersonate three real roles (**Business Owner**, **CPA**, **Lawyer**) and walk each one through the app's happy path for their scenario. Each persona hits the API to set up a realistic corporation and event log, then downloads the compiled minute book (or a purpose-driven bundle) and validates the resulting PDF.

The goal is to catch the class of bugs that unit tests miss:

- Multi-step flows that break because a controller signature changed
- Compiled minute-book PDFs missing sections
- Persona-specific gaps ("dividend flow is missing a field the CPA needs")
- Regressions in the board-vs-shareholder split, signing-authority template, or purpose bundles

## What the personas cover

| Persona | Scenario | Bundle validated |
|---|---|---|
| **Business Owner** | Create corp → add a director → change address → download minute book | Full compile |
| **CPA** | Declare a dividend → log an annual return with T2 ref → issue Class B shares → download CRA bundle | CRA audit bundle |
| **Lawyer** | Grant signing authority → transfer shares → change corporate name → download DD bundle | Due-diligence bundle (Board + Shareholder split) |

## Prerequisites

**Backend running with test-mode enabled.** Add these to `backend/.env` for local runs:

```
TEST_MODE_ENABLED=true
TEST_MODE_TOKEN=<a random secret you pick>
```

**Never** set `TEST_MODE_ENABLED=true` in production. The endpoint 404s when the flag is off, so leaving both unset is safe by default.

**Frontend running.** The tests navigate to the SPA to verify UI state (dashboard renders, company appears). Default is `http://localhost:5173`.

**Node deps installed.** From this folder:

```
npm install
npx playwright install chromium
```

## Running the suite

```
# All three personas (against http://localhost:5173 + http://localhost:5000)
TEST_MODE_TOKEN=<your-secret> npm test

# One persona at a time (useful when iterating)
TEST_MODE_TOKEN=<your-secret> npm run test:owner
TEST_MODE_TOKEN=<your-secret> npm run test:cpa
TEST_MODE_TOKEN=<your-secret> npm run test:lawyer

# Interactive mode (pick tests + step through)
TEST_MODE_TOKEN=<your-secret> npm run test:ui

# Reset persona email each run (test the first-run empty state)
FRESH_EMAIL=true TEST_MODE_TOKEN=<your-secret> npm test
```

Against a different environment:

```
MINUTEBOOK_URL=https://your-frontend.onrender.com \
MINUTEBOOK_API_URL=https://corporateminutebook.onrender.com \
TEST_MODE_TOKEN=<same-secret-as-backend> \
npm test
```

## Where output lands

- `artifacts/` — the actual PDF each persona downloaded. Open these directly to inspect a failing bundle. Committed to `.gitignore` — never committed.
- `test-results/` — Playwright traces / screenshots / video for failed runs.
- `playwright-report/` — HTML report; open with `npm run report`.

## What the PDF validator checks (v1)

- Expected section headings are present ("ARTICLES OF INCORPORATION", "Board (Director) Resolutions", specific event labels, etc.)
- Forbidden strings absent (`undefined`, `NaN`, `[object Object]` — signs of a broken template variable)
- Minimum page count (empty PDFs are always a bug)

**Not yet checked (planned for v1.1):**

- Signature blocks split across pages
- Table rows extending past the bottom margin
- Widow / orphan lines
- Section rendering order

## Adding a new persona

1. Copy one of the existing specs under `personas/` and name it after the role.
2. Compose the persona's flow from the helpers in `personas/shared/` — most personas will use `loginAs()` + `createCompany()` + `recordEvent()` + `downloadBundle()`.
3. Write the persona's `expectedSections` list from the PDF headings that role actually needs (Bank asks for X, Auditor asks for Y).
4. Add a script alias in `tests/package.json` if you want per-persona invocation.

## When something fails

1. Read the `describeResult()` failure message — it names the missing sections or forbidden content.
2. Open the corresponding PDF in `artifacts/` to see what actually rendered.
3. If it's a walkthrough failure (network, click, timeout), open the trace: `npx playwright show-trace test-results/<...>/trace.zip`.
