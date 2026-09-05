# MinuteBook

Canadian corporate minute-book SaaS. Business owners create a corporation once, record events over time (director changes, dividends, share transfers…), and download a compiled, legally-formatted minute book on demand. Bundles targeted at bankers (loan file), auditors (CRA response), and buyers (due diligence) collapse the full record into audience-specific slices.

**Live:**
- Frontend: separate Render Static Site
- Backend: `https://corporateminutebook.onrender.com`
- Marketing pass-through / cross-sell: `https://www.corporateregistryservices.ca`

## Repository layout

```
minutebook/
├── backend/          # Node 20 + Express 5 + TypeScript + MongoDB + Puppeteer
│   ├── src/
│   │   ├── controllers/     # auth, company, event, document, share, crsFeed, incorporation
│   │   ├── models/          # User, Company, CorporateEvent, CompanyShare, CrsProcessedOrder, Document, ActivityLog
│   │   ├── routes/          # thin route files that mount controllers under /api/*
│   │   ├── middleware/      # protect (cookie auth), validateBody (Zod)
│   │   ├── schemas/         # Zod input schemas (company, event, auth, common primitives)
│   │   ├── services/        # documentGenerator (Puppeteer), emailService (SES),
│   │   │                    # uploadStorage (S3+disk), notificationScheduler,
│   │   │                    # registryDriftChecker, docusealService
│   │   ├── templates/       # EJS templates for every PDF (minute_book, share_certificate,
│   │   │                    # resolution_*, articles_of_incorporation, by_laws, registers)
│   │   ├── utils/           # apiError (500 helper + Sentry), unsubscribe (CASL tokens),
│   │   │                    # shareRedaction (viewer projections, pure + unit-tested)
│   │   └── server.ts
│   ├── test/            # Vitest unit tests — DB-free layers only (middleware, schemas, env, redaction)
│   ├── scripts/         # one-off ops scripts (backfillFoundingRegistryNA)
│   └── package.json
├── frontend/         # Vite + React 18 + TypeScript + MUI + Redux
│   ├── src/
│   │   ├── components/      # Landing, Login, Dashboard, MinuteBookBuilder, RecordsVault,
│   │   │                    # DocumentManagement, SharedCompanyView, ChangeWizard,
│   │   │                    # ShareDialog, RecordEventDialog, AccountPage, SessionBootCheck
│   │   ├── store/           # Redux (authSlice — user metadata only, no token) + its Vitest spec
│   │   ├── context/         # SnackbarContext
│   │   ├── utils/           # api (axios with withCredentials)
│   │   └── App.tsx
│   ├── .eslintrc.cjs        # ESLint — `npm run lint` is zero-warning
│   └── package.json
├── .github/workflows/ci.yml   # GitHub Actions — see "Continuous integration"
└── tests/            # Playwright persona test suite
    ├── personas/
    │   ├── shared/          # auth, api helpers, fixtures, pdf-validator, config
    │   ├── business-owner.spec.ts
    │   ├── cpa.spec.ts
    │   ├── lawyer.spec.ts
    │   └── share-viewer.spec.ts
    ├── playwright.config.ts
    ├── README.md            # detailed test-suite docs
    └── package.json
```

Three separate `package.json` files — backend, frontend, tests. No workspaces / monorepo tooling. Each folder is installed independently.

## First-run setup on a new machine

```powershell
# 1. Clone
git clone https://github.com/rubeshgithub/corporateminutebook.git minutebook
cd minutebook

# 2. Backend
cd backend
npm install
# Copy .env.example → .env and fill in — see "Env vars" below.
npm run dev                      # tsc watch + nodemon; hosts on :5000
npm test                         # Vitest unit tests — no database or Chrome needed
```

```powershell
# 3. Frontend (in a second terminal)
cd frontend
npm install
npm run dev                      # Vite on :5173
npm run lint && npm test         # ESLint (zero-warning policy) + Vitest
```

```powershell
# 4. Tests (optional, once backend + frontend are up)
cd tests
npm install
npx playwright install chromium  # one-time browser download
npm test                         # runs all three persona specs
```

Frontend proxies API calls to `http://localhost:5000` in dev. The httpOnly auth cookie is set on the backend origin and browsers ship it on cross-origin XHR because `withCredentials: true` is set on the frontend axios instance + CORS `credentials: true` is set server-side.

## Env vars

### Backend (`backend/.env`)

**Required (server refuses to boot without these):**

| Var | Purpose |
|---|---|
| `MONGODB_URI` | Atlas connection string |
| `JWT_SECRET` | 32+ chars in production. Signs the httpOnly session cookie + the unsubscribe-link tokens |
| `FRONTEND_URL` | **Required in production only** — backs CORS allowlist + CSRF origin check. Without it the app boots but every authed write from the real SPA is rejected as foreign-origin. Falls back to `http://localhost:5173` in dev |
| `S3_ATTACHMENTS_BUCKET` | **Required in production only** — without it uploads fall back to the ephemeral container disk and signed resolutions are destroyed on the next deploy. Falls back to local disk in dev |

**Feature vars (feature no-ops silently if missing — warned at boot):**

| Var | Feature |
|---|---|
| `ANTHROPIC_API_KEY` | Incorporation-PDF parsing (Claude Haiku) |
| `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` + `AWS_REGION` + `SES_FROM` | Transactional email (OTP, reminders, share invites, resolutions) |
| `S3_ATTACHMENTS_PREFIX` | Key prefix inside the attachments bucket |
| `S3_REGION` | Region of the attachments bucket when it differs from `AWS_REGION` (bucket in `ca-central-1`, SES elsewhere). Falls back to `AWS_REGION` |
| `BACKEND_PUBLIC_URL` | Backend's own public origin — backs the CASL unsubscribe links in reminder emails. Set to the Render backend URL in prod; falls back to `http://localhost:5000` |
| `SENTRY_DSN` | Error tracking. Without it server errors exist only in stdout logs |
| `DOCUSEAL_API_KEY` | e-Signature |
| `CRS_FEED_SECRET` | Shared secret for HMAC-verified CRS order webhook |
| `NODE_ENV=production` | Flips auth cookie to `secure=true` + `sameSite=none` for cross-origin XHR |

**Scheduled-job vars (opt-in via env — disabled unless set to `true`):**

| Var | Effect |
|---|---|
| `NOTIFICATIONS_ENABLED=true` | Daily 09:00 UTC cron sends FYE + annual-return reminder emails |
| `DRIFT_CHECK_ENABLED=true` | Monday 04:00 UTC job diffs each company against CBR / BC OrgBook and flips a drift banner on the dashboard when the two disagree |

**Test-only vars (never enable in production):**

| Var | Effect |
|---|---|
| `TEST_MODE_ENABLED=true` | Unlocks `POST /api/auth/test-mint-session` (endpoint 404s otherwise) |
| `TEST_MODE_TOKEN=<secret>` | Shared secret checked against `x-test-token` header on every test-mint request |

### Frontend (`frontend/.env`)

| Var | Purpose |
|---|---|
| `VITE_API_URL` | Backend base URL. Blank in dev (Vite proxy handles it). Set to the Render backend URL in production. |
| `VITE_GOOGLE_PLACES_API_KEY` | Optional — enables address autocomplete in the Builder. Silently no-ops without it. |

## Deploy on Render

Two services on the same account:

- **Web Service** (backend) — `backend/` directory. Node 24. `npm install && npx puppeteer browsers install chrome && npm run build`. Start command: `npm start`.
  - Env vars required: `MONGODB_URI`, `JWT_SECRET`, `FRONTEND_URL`, `S3_ATTACHMENTS_BUCKET`, `NODE_ENV=production`, plus every feature-var above.
  - **Chrome for PDFs:** `backend/.puppeteerrc.cjs` pins Puppeteer's download cache to `backend/.cache/puppeteer` so the Chrome installed during the build is inside the deployed project tree. Without it Puppeteer uses `~/.cache/puppeteer`, which Render does not carry from build to runtime, and every PDF request fails with a generic 500. The boot log prints `[pdf] Chrome: <path>` or a `[pdf] Chrome not found` warning — check it after any change to the build command.
- **Static Site** (frontend) — `frontend/` directory. `npm install && npm run build`. Publish directory: `dist`.
  - Env vars required: `VITE_API_URL=https://corporateminutebook.onrender.com`, `VITE_GOOGLE_PLACES_API_KEY`.
  - **History fallback:** the SPA uses path routing, so every deep link (`/dashboard`, `/share/<token>`, `/account`, …) must serve `index.html`. Add a Redirect/Rewrite rule on the Static Site in the Render dashboard: source `/*`, destination `/index.html`, action **Rewrite**. Until that rule exists, the build script copies `index.html` to `404.html`, which Render serves for unknown paths — the app renders, but with a 404 status, so emailed share links work either way.

Both are set to auto-deploy on push to `main`.

## Continuous integration

`.github/workflows/ci.yml` runs on every push to `main`, on every pull request, and on demand (`workflow_dispatch`):

| Job | What it runs |
|---|---|
| `backend` | `npm run typecheck` (app + test tsconfig), `npm test` (Vitest), `npm run build`. Chrome download skipped. |
| `frontend` | `npm run lint`, `npm test`, `npm run build` (tsc + Vite). |
| `e2e` | The Playwright persona suite against a real stack: MongoDB 7 started as a single-node replica set (the event and CRS-feed endpoints use transactions, which a standalone `mongod` refuses), backend built and started with `TEST_MODE_ENABLED=true`, SPA served from its production build with `vite preview`. Starts only after the two fast jobs pass. On failure the Playwright report and both server logs are uploaded as an artifact. |

Because Render deploys `main` on push, CI is a signal, not a gate: a red run on `main` means production already has the change. Open a pull request for anything non-trivial so the checks run before the merge. There is no staging environment yet — see "Where to continue".

## What's shipped (feature waves)

The app has been through five persona-driven feature waves plus a security-hardening pass. Recent history summarized:

**Hardening (before waves):**
- OTP rate limiting (IP + email, IPv6-safe helper)
- Event→Company writes wrapped in Mongoose transaction
- Zod validation middleware on every write endpoint
- Puppeteer singleton with launch-mutex + 60s page timeout + try/finally
- Global 200 req/min + 1 MB body cap; per-endpoint stricter limits on generation + LLM parse
- httpOnly cookie auth (one-shot cutover from localStorage token)
- S3 attachment storage with local-disk fallback
- Event soft-delete + edit with honest "snapshot won't rewind" warning

**Wave 1** — dashboard action split (Corporate Records / + Record Event) · first-run empty-state hero · Bank/Audit/Sale readiness pills per row · purpose-driven bundle exports (`POST /api/documents/bundle/:type`, bank/dd/cra).

**Wave 2** — `signing_authority_granted/_revoked` + `dividend_declared` event types with dedicated resolution templates · tri-state filing status pills (D drafted / S signed / F filed) · board vs. shareholder resolution split in the compiled minute book.

**Wave 3** — Notification scheduler (FYE + AR reminders, daily 09:00 UTC) · registry-drift check (weekly Monday 04:00 UTC against CBR + OrgBook) · dashboard drift banner with "Reconciled" acknowledgement action.

**Wave 4** — Read-only sharing: `CompanyShare` model + `POST /api/companies/:id/shares` + public `GET /api/share/:token` + public `/share/:token` SPA route · share links can be public or email-invited (same token type) · time-limited + revocable · view telemetry surfaced in the share dialog.

**Wave 5** — Plain-English change wizard (tile launcher opens `RecordEventDialog` preset to the right event type) · T2 reference field on annual-return events · specimen-signature nudge on signing-authority grants · CRS Certificate-of-Good-Standing deep-link on Bank-Ready companies.

**Post-waves:**
- Registry filing `not applicable` per-event marker (founding events auto-marked; UI toggle for the rest). Compliance gap counts skip N/A events.
- `FRONTEND_URL` becomes required in production (previously would silently break CORS/CSRF).
- Persona test suite v1 (Playwright + `pdf-parse`) — Business Owner / CPA / Lawyer / Share Viewer specs hit the API, compile PDFs, validate expected sections. Backed by env-gated `POST /api/auth/test-mint-session`.
- **Account page** (`/account`) — reminder-email opt-in/out (`PATCH /api/auth/preferences`, the in-app counterpart to the emailed CASL unsubscribe link, and the only way to turn reminders back on) and self-service account deletion (`DELETE /api/auth/account`, account email retyped to confirm). Deletion erases every company the user has ever owned (soft-deleted included), their events, uploaded attachments, generated-document records, share links, and activity rows, then the user itself — files first, user row last, so a failed step leaves a retryable account rather than a half-dead one. Privacy policy and Terms updated to describe it.
- **Session boot check** — the SPA confirms its cached sign-in against `GET /api/auth/me` once per page load and signs out on 401/404, instead of discovering a dead cookie on the user's first write.
- **Dashboard and Documents load failures** are surfaced (snackbar + inline Retry) instead of rendering the first-run "Add your first corporation" hero over a failed request.
- **Unit tests, lint, CI** — Vitest suites in `backend/test/` (auth middleware, CSRF guard, env validation, Zod contracts, share redaction, error helper) and colocated `*.test.ts` in the SPA; an ESLint config for the SPA (the `lint` script previously had no config to run against, so it had never run); the GitHub Actions workflow described above.
- **Share-link redaction** extracted to `backend/src/utils/shareRedaction.ts` so the PII allow-lists are pure and unit-tested; the PDF projection now also drops `crsCustomerEmail`.

## Persona test suite

See `tests/README.md` for full details. Quick reference:

```powershell
cd tests
# Requires backend/.env to have TEST_MODE_ENABLED=true + TEST_MODE_TOKEN set
npm install
npx playwright install chromium
npm test
```

The suite reads `TEST_MODE_TOKEN` automatically from `backend/.env` — no shell setup needed. Downloaded PDFs land in `tests/artifacts/` for inspection. HTML report: `npm run report`.

## Where to continue

Open items I'd tackle next (in rough priority order):

1. **Run the founding-event backfill against production** — `cd backend && npm run backfill:founding-na` prints how many founding events still count as missing a registry filing (dry run); re-run with `-- --apply` to flag them. Until it runs, companies created before the flag existed show spurious compliance gaps. Idempotent.
2. **Payments** — `User.subscriptionTier` is never read anywhere. Founder decision needed first: in-app Stripe checkout vs. CRS-side entitlements pushed through the order webhook. Gating, upgrade prompts, and invoicing all wait on that call.
3. **Staging environment** — Render deploys `main` straight to production. Add a second pair of services (or Render preview environments) on a separate Atlas database, store `MINUTEBOOK_URL` / `MINUTEBOOK_API_URL` / `TEST_MODE_TOKEN` as repository secrets, and add a workflow job that runs the persona suite against staging after each deploy.
4. **Multi-instance readiness** — Puppeteer runs in-process, rate limits are in-memory, and both cron jobs assume exactly one instance (`NOTIFICATIONS_ENABLED` / `DRIFT_CHECK_ENABLED`). Scaling past one Render instance needs a shared rate-limit store, a job lock or scheduler service, and PDF generation moved to a worker.
5. **PDF validator v1.1** — layout-level checks via `pdfjs-dist`: signature blocks split across pages, table rows past bottom margin, widow/orphan lines. Bones for it are stubbed in `tests/personas/shared/pdf-validator.ts`.
6. **Additional personas** — Banker and Auditor (lower-risk expansions of the current three).
7. **Registry drift v1.1** — richer diff coverage (directors, registered office) requires per-jurisdiction paid APIs. Current v1 covers name / status / city only.
8. **French UI** — the marketing site advertises it; the SPA has no i18n layer.
9. **Admin back-office** — `role: 'admin'` exists on the User model and `adminOnly` middleware exists, but no route uses either.

## Common gotchas

- **httpOnly cookie doesn't reach cross-origin** — check `NODE_ENV=production` is set on the backend Render service. Without it, cookie defaults to `secure=false` + `sameSite=lax` and the browser refuses to send it cross-site.
- **Puppeteer crash on `EEXIST /tmp/minutebook_chrome_profile`** — the launch mutex in `documentGenerator.ts` handles concurrent launches, but a hung Chrome process from a previous run can leave stale profile files. Delete the tmp dir and restart.
- **"Test mode 404"** — the test-mint endpoint is env-gated. Confirm `TEST_MODE_ENABLED=true` is set on the backend AND `TEST_MODE_TOKEN` matches on both sides (backend `.env` + wherever the tests read it from).
- **Nodemon doesn't pick up `.env` changes** — touch any `.ts` file in `backend/src/` to force a restart, or `Ctrl+C` and `npm run dev` again.
- **`npm run lint` fails on a warning** — the script runs with `--max-warnings 0` and `--report-unused-disable-directives`, so a new `react-hooks/exhaustive-deps` warning or a stale `eslint-disable` comment fails CI. Fix the dependency array, or keep the disable and say why in a comment above it.
