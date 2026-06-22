# MinuteBook — Project Details

## Project Purpose

**MinuteBook** is a SaaS web application that helps Canadian small-business owners create and maintain a **corporate minute book** — the legally-required record of a corporation's key information (directors, shareholders, share structure, registered office) and constitutional documents (Articles of Incorporation, By-Laws). Users enter their company data once, the system auto-generates polished PDF versions of all standard corporate documents on demand, tracks corporate events over time, and flags compliance gaps inline.

The defaults (province field, "Canada" country default) make the Canadian/Alberta legal context explicit.

**Live deployment:** Backend — `https://corporateminutebook.onrender.com` (Render Web Service). Frontend — separate Render Static Site.

---

## Backend (`backend/`)

**Stack:** Node.js + Express 5 + TypeScript + MongoDB (Mongoose) + Puppeteer + EJS + pdf-lib + Anthropic SDK + Multer, secured with Helmet, CORS, JWT, bcrypt.

### Entry & infrastructure
- [server.ts](src/server.ts) — wires Helmet, CORS, Morgan, JSON body parsing, mounts all route groups under `/api/*`, and a `/api/health` probe.
- [config/db.ts](src/config/db.ts) — connects to MongoDB Atlas via `MONGODB_URI`; `process.exit(1)` on failure.

### Data models (`src/models/`)

**[User.ts](src/models/User.ts)**
- `email`, bcrypt `passwordHash`, `role` (`admin` | `business_owner`), `subscriptionTier` (`free` | `premium`).

**[Company.ts](src/models/Company.ts)** — full corporate profile snapshot:
- `registeredOfficeAddress`, `recordsAddress`, `addressForService` — all three address types required by Canadian corporate law, each with `sameAsRegistered` / `sameAsRecords` flags. `addressForService` also supports `poBox` and `email`.
- `restrictions` — split into `restrictedTo` / `restrictedFrom` (each with `has` boolean + `description`). Legacy `hasRestrictions` kept for backward compat.
- `authorizedBy` — name, company, email, phone (the person who authorized the minute book preparation).
- `shareClasses[]` — name, type (`Common`/`Preferred`), voting, maxAuthorized (null = unlimited), parValue (null = no par).
- `directors[]` — firstName/middleName/lastName split + legacy `name`, residentCanadian, appointedDate/resignedDate.
- `shareholders[]` — holderType (`Individual`/`Legal Entity`), corporateAccessNumber (for legal entities), address, votingPercent, **certificateNumber** (auto-assigned sequential), **considerationPaid**, **issuanceDate**.
- `officers[]` — name, title, appointedDate/resignedDate.
- `schedules[]` — name + content (free-text; Schedule A is auto-generated from shareClasses).
- `incorporationDocumentFile` — UUID filename of uploaded incorporation PDF stored in `backend/uploads/`.
- `fiscalYearEnd`, `annualReturnDueDate` (MM-DD format), `deletedAt` (soft delete), `incorporationDate`, `minDirectors`/`maxDirectors`.

**[CorporateEvent.ts](src/models/CorporateEvent.ts)** — immutable event log:
- `companyId` (ref Company), `recordedBy` (ref User)
- `eventType` enum: `director_appointed` | `director_resigned` | `director_address_changed` | `officer_appointed` | `officer_resigned` | `address_changed` | `shares_issued` | `shares_transferred` | `shares_cancelled` | `share_class_added` | `annual_return_filed` | `fiscal_year_end_changed` | `name_changed`
- `effectiveDate`, `data` (Mixed — event-specific payload), `notes`
- `attachments[]` — subdocument array: `{ role: 'resolution' | 'registry_filing' | 'supporting', fileId, originalName, uploadedAt }`

**[Document.ts](src/models/Document.ts)**
- Versioned generation record: companyId, title, type, version, generatedAt, `generatedBy` (ref: User). Every PDF generation writes a record.

**[ActivityLog.ts](src/models/ActivityLog.ts)**
- Append-only audit trail (`CREATED_COMPANY`, `UPDATED_COMPANY`, `GENERATED_DOCUMENT`, `COMPILED_MINUTE_BOOK`, `RECORDED_EVENT`, etc.).

### Auth & middleware
- [authController.ts](src/controllers/authController.ts) — `register` hashes with bcrypt (salt 10), issues 30-day JWT `{id, role}`; `login` reissues.
- [authMiddleware.ts](src/middleware/authMiddleware.ts) — `protect` verifies JWT, attaches `req.user`.

### Domain endpoints

**Companies** (`/api/companies`):
- `POST /` — create company; auto-assigns sequential certificate numbers to shareholders starting at 1.
- `GET /` — list user's non-deleted companies.
- `GET /compliance` — **batch compliance summary** for all user companies. Returns per-company `{ companyId, issues, missingResolutions, missingRegistryFilings, annualReturnStatus, daysUntilAnnualReturn }`. Fetches all events in a single query (`companyId: { $in: companyIds }`) then groups in-memory to avoid N+1. Route registered **before** `/:id` to prevent "compliance" being treated as a MongoDB ObjectId.
- `GET /:id` — fetch single company (ownership-scoped).
- `PUT /:id` — update company; new shareholders without a `certificateNumber` continue from `max(existing) + 1`.
- `DELETE /:id` — soft-delete via `deletedAt`.

**Annual return status logic** (in `getComplianceSummary`):
- Reads `annualReturnDueDate` (MM-DD) from Company.
- Computes `prevDue` (last occurrence) and `nextDue` (upcoming occurrence) from the MM-DD pattern relative to today.
- `overdue` if `today > prevDue && !filedThisPeriod`; `due_soon` if `daysUntilAnnualReturn <= 30`; otherwise `ok`.

**Corporate Events** (`/api/events`):
- `POST /:companyId` — record a new event; dual-writes to CorporateEvent + applies snapshot update to Company via `applyEventToCompany()`. Logs `RECORDED_EVENT` activity.
- `GET /:companyId` — list all events for a company (ownership-scoped).
- `PUT /:id` — update event notes/data.
- `DELETE /:id` — delete event.
- `POST /:id/attach` — multer disk upload (20 MB limit); appends `{ role, fileId: evt_<uuid><ext>, originalName, uploadedAt }` to `event.attachments`. Validates role is one of the three valid roles.
- `GET /:id/attachment/:fileId` — auth-protected static serve of stored attachment file.
- `GET /:id/resolution` — generates a resolution PDF for the event. Looks up the appropriate EJS template from `RESOLUTION_TEMPLATES` map, calls `generatePDFBuffer(company, templateName, [], { event: event.toObject() })`, streams buffer as download.

**Resolution template mapping** (`RESOLUTION_TEMPLATES`):
| Event types | Template |
|---|---|
| `director_appointed`, `director_resigned`, `director_address_changed`, `officer_appointed`, `officer_resigned` | `resolution_director_change` |
| `shares_issued`, `shares_cancelled`, `share_class_added` | `resolution_share_issuance` |
| `shares_transferred` | `resolution_share_transfer` |
| `address_changed` | `resolution_address_change` |
| `name_changed`, `fiscal_year_end_changed` | `resolution_name_change` |

**Documents** (`/api/documents`):
- `POST /generate` — validated template name from allow-list, re-checks ownership, streams PDF buffer, writes Document record with `generatedBy`.
- `GET /:companyId` — generation history with `.populate('generatedBy', 'name email')`.
- `POST /compile` — compiles full Corporate Minute Book (main + share certificate merged with pdf-lib), writes record.
- `POST /inaugural` — generates the full Inaugural Package (9 templates + uploaded incorp doc + share certificates + registers in one PDF), writes record.

**Incorporation** (`/api/incorporation`):
- `POST /parse` — multer memory upload (PDF only, 20 MB) → base64 → Claude Haiku `type: 'document'` API call → returns structured JSON + saves PDF to `uploads/`. Works for both digital and image/scanned PDFs.
- `GET /file/:filename` — auth-protected static serve of stored PDFs.

**Other routes:**
- `GET /api/activity` — recent activity log for authenticated user (supports `?limit=N`).
- `GET /api/stats` — aggregate counts: companies, documents, directors, shareholders, sharesIssued, activityLast7Days.
- `GET /api/registry/fetch` — external registry lookup (stub, returns mock data).

### Document generation ([services/documentGenerator.ts](src/services/documentGenerator.ts))

**`generatePDFBuffer(company, templateName, [], extraData?)`** — single-template PDF via Puppeteer. Accepts optional `extraData` merged into EJS context (used to pass `{ event }` for resolution templates). Uses `waitUntil: 'domcontentloaded'` to avoid timeouts on Render free tier.

**`generateMinuteBookPDF(company)`** — compiled minute book:
1. Renders `minute_book` (portrait) + `share_certificate` (landscape) separately.
2. Inserts the uploaded incorporation document between main book pages and certificates using `appendUploadedDoc()`.
3. Merges with pdf-lib, overlays running headers/footers via `addHeadersFooters()`.

**`generateInauguralPackagePDF(company)`** — one-click inaugural package:
- Pre-incorp: `articles_of_incorporation`
- Uploaded incorporation document (proof of filing)
- Post-incorp: `schedule_a`, `by_laws`, `organizational_resolution`, `shareholders_organizational_resolution`, `consent_to_act`, `share_subscription`
- Landscape: `share_certificate`
- Portrait: `registers`
- Merged with pdf-lib + headers/footers

**Helpers:**
- `appendUploadedDoc(merged, filename?)` — silently appends stored PDF pages; skips if missing or encrypted.
- `addHeadersFooters(merged, font, rightHeaderText, skipFirstPage)` — draws company name + right text in header, "Confidential" + "Page X of Y" in footer.

### Incorporation AI parser ([controllers/incorporationController.ts](src/controllers/incorporationController.ts))
- Accepts PDF upload via multer memory storage.
- Sends raw base64 PDF to Claude Haiku as `type: 'document'` content — handles both digital text and image/scanned PDFs.
- Extracts: company name, CAN, incorporationDate, all three address types, directors (Alberta `Last, First Middle` → normalized), shareholders, shareClasses, restrictions, minDirectors, maxDirectors, fiscalYearEnd.
- Saves PDF to `backend/uploads/{uuid}.pdf` after successful parse.

### Event attachment storage
- Multer disk storage in `backend/uploads/` with `evt_<uuid><ext>` filenames.
- `eventAttachMiddleware` exported from `eventController.ts` — `multer({ storage, limits: { fileSize: 20MB } }).single('file')`.
- All params cast via `String(req.params.id)` to handle Express 5 `string | string[]` param typing.

### Templates (`src/templates/`) — 23 files

**Core document templates:**
| Template | Description |
|---|---|
| `articles_of_incorporation.ejs` | Articles of Incorporation |
| `schedule_a.ejs` | Auto-generated Schedule A — Share Capital. Dynamically renders legal text for each share class with voting rights, dividends, redemption, retraction, pricing, liquidity conditionals. |
| `by_laws.ejs` | By-Laws No. 1 |
| `_by_laws_body.ejs` | By-laws body partial |
| `organizational_resolution.ejs` | Organizational Resolution (Directors) |
| `_organizational_body.ejs` | Organizational resolution body partial |
| `shareholders_organizational_resolution.ejs` | Organizational Resolution (Shareholders) |
| `annual_director_resolution.ejs` | Annual Director Resolution |
| `annual_shareholder_resolution.ejs` | Annual Shareholder Resolution |
| `consent_to_act.ejs` | Consent to Act as Director |
| `share_certificate.ejs` | Share Certificate (landscape). Uses `shareholder.certificateNumber` (auto-assigned). |
| `share_ledger.ejs` | Share Ledger register |
| `share_subscription.ejs` | Share Subscription agreements. Uses `considerationPaid` if present, falls back to par × shares. Shows certificate number and issuance date. |
| `share_transfer_register.ejs` | Share Transfer Register |
| `registers.ejs` | Corporate Registers (directors, shareholders, officers) |
| `_registers_body.ejs` | Registers body partial |
| `glossary.ejs` | Glossary of corporate terms |
| `minute_book.ejs` | Full compiled minute book (includes all major sections) |

**Event resolution templates** (receive `{ company, event }` context):
| Template | Handles |
|---|---|
| `resolution_director_change.ejs` | Director/officer appointments, resignations, address changes. Table: Effective Date / Name / Role / Change. Signature blocks per active director + resigning party. |
| `resolution_share_issuance.ejs` | Shares issued, shares cancelled, share class added. Conditional rendering per eventType. Share class table for `share_class_added`. |
| `resolution_share_transfer.ejs` | Sale of Shares table (Selling SH / Shares-Class / Voting % / Sale Price / Sold To). Changes to Share Register section: redeemed cert table + issued cert table. Signatures for directors + transferring/receiving shareholders. |
| `resolution_address_change.ejs` | Previous Address vs New Address table. `addrFieldMap` maps addressType to company field for before-state lookup. |
| `resolution_name_change.ejs` | `name_changed` → Previous Name / New Name table. `fiscal_year_end_changed` → Previous FYE / New FYE table. `fyFormat()` helper formats MM-DD as "Month Day". |

### Build
```
tsc && cp -r src/templates dist/templates
```
`tsc` does not copy `.ejs` files — the `cp` step is required. Render build command:
```
cd backend && npm install --include=dev && npm run build && npx puppeteer browsers install chrome
```
`--include=dev` is required because TypeScript compiler lives in `devDependencies`.

### Environment variables (`.env`)
```
PORT=5000
MONGODB_URI=...
JWT_SECRET=...
ANTHROPIC_API_KEY=...   ← required for incorporation document parsing
```
`backend/uploads/` is in `.gitignore` — uploaded PDFs and event attachments are not committed.

---

## Frontend (`frontend/`)

**Stack:** React 18 + TypeScript + Vite + Material UI v5 + Redux Toolkit + React Router v6 + react-hook-form + Zod + Axios.

- `vite.config.ts` proxies `/api` → `http://localhost:5000` in dev only.
- `utils/api.ts` — Axios instance with `VITE_API_URL/api` in production, `/api` via Vite proxy in dev. Interceptor adds `Authorization: Bearer …` from localStorage.
- `store/authSlice.ts` — persists user + JWT to `localStorage`; hydrates on init so auth survives page refresh. Auto-logout on 401.
- `context/SnackbarContext.tsx` — global `useSnackbar()` hook; replaces all `alert()` / `window.confirm()` calls app-wide.

### Routes (`App.tsx`)
| Path | Component |
|---|---|
| `/login` | Login |
| `/register` | Register |
| `/dashboard` | Dashboard (private) |
| `/builder` | MinuteBookBuilder — create mode (private) |
| `/builder/:id` | MinuteBookBuilder — edit mode (private) |
| `/documents` | DocumentManagement (private) |
| `/events/:companyId` | CorporateEvents (private) |
| `/records/:companyId` | RecordsVault (private) |

### Components

**`Dashboard.tsx`**
- **Stats strip** — 6 metric tiles (companies, documents, directors, shareholders, shares issued, activity last 7 days) with colored left-border accents, driven by `GET /api/stats`.
- **Annual return compliance banner** — amber strip at top listing companies with `annualReturnStatus === 'overdue'` or `'due_soon'`; each chip navigates to that company's Records Vault. Driven by `GET /api/companies/compliance`.
- **Companies table** — full-width, sortable, paginated (10/25/50 rows). Search by name, CAN, or BN. Columns:
  - Avatar + Company Name / CAN
  - Incorporated (date + FY end below)
  - Dir. — count chip with tooltip listing active director names
  - S/H — count chip with tooltip listing shareholder name + shares + class
  - **Compliance** — `ComplianceBadge` component (see below); sortable
  - Actions — Records Vault, Documents, Event History, Edit, Delete
- Overdue rows rendered with `bgcolor: '#fff8f8'`.
- **`ComplianceBadge`** — green "Clean" / amber "N pending" / red "Overdue" chip. Tooltip shows breakdown: overdue annual return, days until due, missing resolutions count, missing registry filings count. "Based on recorded events" footnote. Clicking navigates to Records Vault.
- **Recent Activity strip** — compact horizontal-scrollable row of mini cards at the bottom. Each card: colored dot + action name + relative timestamp. Demoted from main content to a subtle footer strip.
- `fetchAll()` — parallel `Promise.all` of companies + compliance + activity + stats.
- `complianceMap` — memoized `Record<string, ComplianceEntry>` from compliance array.

**`MinuteBookBuilder.tsx`** — multi-step wizard, create + edit modes
- Steps: Company Info → Addresses → Restrictions → Share Classes → Directors → Shareholders → Officers → By-Laws → Schedules → Authorized By → Review (11 steps).
- `annualReturnDueDate` field (MM-DD) added to Company Info step alongside fiscalYearEnd.
- **Edit mode** (`/builder/:id`): loads existing data via `GET /api/companies/:id` + `reset()`. Steps freely clickable. "Save Changes" button visible on every step.
- **Create mode**: linear navigation. "Save Company" on Review step.
- **Incorporation Document Upload** (Step 0): uploads PDF → AI parse → auto-fills all fields. Shows success chips per filled field group.
- Zod schema covers all fields including `annualReturnDueDate`, `incorporateDocumentFile`, `certificateNumber`, `considerationPaid`, `issuanceDate`.

**`DocumentManagement.tsx`**
- Autocomplete company selector (pre-selects from `location.state.companyId`).
- Inaugural Package card (green): Preview + Download → `POST /api/documents/inaugural`.
- Compile Full Minute Book → `POST /api/documents/compile`.
- Generate New Document accordion — 14+ template buttons with preview + download.
- Generation History accordion — title, version, date, generated-by user.

**`CorporateEvents.tsx`**
- Full CRUD for `CorporateEvent` records per company.
- Event form: type selector (13 types), effective date, data fields (contextual per type), notes.
- **Generate Resolution button** — visible per event card only when `RESOLUTION_EVENT_TYPES.has(ev.eventType)`. Calls `GET /api/events/:id/resolution` as blob download.
- **Attach button** — opens dialog to upload a file with role selector (`resolution` / `registry_filing` / `supporting`). Posts `multipart/form-data` to `POST /api/events/:id/attach`.
- **Existing attachments** — colored role chips (`resolution=#1565c0`, `registry_filing=#2e7d32`, `supporting=#6d4c41`) with download links calling `GET /api/events/:id/attachment/:fileId`.
- `RESOLUTION_EVENT_TYPES` Set used to conditionally show the resolution generator button.

**`RecordsVault.tsx`** — `/records/:companyId`
- 4 Accordion sections:
  1. **Incorporation Documents** — shows uploaded incorporation PDF with download via `GET /api/incorporation/file/:filename`.
  2. **Annual Returns** — lists `annual_return_filed` events; status chip (overdue / due soon / ok / not set); `annualReturnDueDate` display.
  3. **Corporate Changes Archive** — all non-annual events in a table. Yellow-highlighted rows for events missing resolution or registry filing attachments (with `WarningAmberIcon` chips).
  4. **Generated Documents Log** — generation history from `GET /api/documents/:companyId` with re-download buttons for regenerable templates.
- **Compliance alert** at top: counts `missingResolutions` (events in `RESOLUTION_EVENT_TYPES` without a `resolution` attachment) and `missingRegistry` (events in `REGISTRY_EVENT_TYPES` without a `registry_filing` attachment).
- `REGENERABLE_TEMPLATES` set determines which document types show a re-download button.

**`Layout.tsx`** — shell with sidebar navigation (Dashboard, Builder, Documents) and top app bar.

---

## End-to-end flows

### New company (incorporated this year)
1. Register/login → JWT persists across refresh.
2. New Company → MinuteBookBuilder wizard (11 steps).
3. **Optional Step 0**: upload Certificate of Incorporation PDF → Claude AI parses it → all fields auto-fill.
4. Complete remaining fields (including `annualReturnDueDate` MM-DD) → Save Company → MongoDB record created, shareholders get sequential certificate numbers.
5. Dashboard → folder icon → DocumentManagement pre-selects that company.
6. Generate Inaugural Package → one PDF: Articles → filed incorporation doc → Schedule A → By-Laws → Organizational Resolutions → Consent to Act → Share Subscriptions → Share Certificates → Registers.

### Established company (editing an existing record)
1. Dashboard → Edit icon → `/builder/:id` → all data pre-loaded.
2. Jump directly to any step — steps freely clickable.
3. Make changes → "Save Changes" on any step → `PUT /api/companies/:id`.
4. Any field change that requires a formal resolution should be followed by recording a corporate event in `/events/:companyId`.

### Recording a corporate event
1. Dashboard → Timeline icon → CorporateEvents for that company.
2. Click "Record Event" → fill type, effective date, event-specific data.
3. Event is saved; `applyEventToCompany()` updates the Company snapshot automatically.
4. Per-event card: click **Generate Resolution** → PDF resolution downloaded (if event type has a template).
5. Attach the signed resolution: click **Attach** → upload PDF with role `resolution`.
6. If registry filing required: upload that too with role `registry_filing`.
7. Dashboard compliance badge turns green once all attachments are in place.

### Compliance monitoring
1. Dashboard loads `GET /api/companies/compliance` in parallel with company list.
2. Each company row shows a `ComplianceBadge`: Clean / N pending / Overdue.
3. Tooltip details: overdue annual return, days until due, missing resolutions, missing registry filings.
4. Clicking the badge or Records Vault icon → `/records/:companyId` → full compliance detail with per-event yellow highlights.

---

## Known issues — resolution status

| # | Issue | Status |
|---|---|---|
| 1 | `.env` secrets in repo, weak JWT secret | **Fixed** — real secrets set as Render env vars; `.env` in `.gitignore` |
| 2 | Auth doesn't survive page refresh | **Fixed** — `authSlice` hydrates from `localStorage` on init |
| 3 | `Document` model was dead code | **Fixed** — every generation writes a Document record with `generatedBy` |
| 4 | Express 5 return signature TypeScript errors | **Fixed** — types aligned |
| 5 | No rate limiting on `/api/auth/*` | **Open** |
| 6 | No company edit UI | **Fixed** — MinuteBookBuilder edit mode, "Save Changes" on every step |
| 7 | Puppeteer launched per request (heavy) | **Open** — acceptable for current free-tier load |
| 8 | `alert()` UX in Login/Register/Builder | **Fixed** — global `SnackbarContext` used app-wide |
| 9 | Registry integration is a stub | **Open** |
| 10 | No unique company name constraint per user | **Open** |
| 11 | CORS wide open | **Open** — lock to `FRONTEND_URL` env var before production |
| 12 | No corporate event history | **Fixed** — `CorporateEvent` model + full CRUD + `applyEventToCompany()` |
| 13 | No resolution generation | **Fixed** — 5 EJS resolution templates + `GET /events/:id/resolution` endpoint |
| 14 | No attachment upload for events | **Fixed** — multer disk upload + serve endpoint + CorporateEvents UI |
| 15 | No compliance tracking | **Fixed** — batch compliance endpoint + Dashboard inline badges + Records Vault |
| 16 | No annual return tracking | **Fixed** — `annualReturnDueDate` field + status logic + dashboard banner |
| N1 | Puppeteer `waitUntil: 'networkidle0'` → 30s timeout on Render | **Fixed** → `domcontentloaded` |
| N2 | `tsc` doesn't copy `.ejs` templates to `dist/` | **Fixed** — build script appends `cp -r src/templates dist/templates` |
| N3 | `devDependencies` not installed on Render build | **Fixed** — `npm install --include=dev` |
| N4 | Puppeteer Chrome binary not found on Render | **Fixed** — `npx puppeteer browsers install chrome` + `PUPPETEER_CACHE_DIR` env var |
| N5 | Login/Register used raw `axios` — broken in production | **Fixed** — both use shared `api` instance |
| N6 | `import.meta.env.VITE_API_URL` TypeScript error | **Fixed** — `vite-env.d.ts` added |
| N7 | Image/scanned PDFs failed incorporation parse | **Fixed** — Claude native `type: 'document'` API |
| N8 | Express 5 `req.params` typed as `string \| string[]` | **Fixed** — `String(req.params.id)` cast in all new handlers |

---

## Pending work — recommended priority order

### Lock CORS to Frontend URL (security, quick)
In `server.ts`:
```typescript
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
```
Set `FRONTEND_URL` as a Render env var pointing to the frontend static site URL.

---

### Rate Limiting on Auth Routes (security, quick)
Add `express-rate-limit` to `/api/auth/register` and `/api/auth/login`:
```typescript
import rateLimit from 'express-rate-limit';
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
router.post('/login', authLimiter, login);
router.post('/register', authLimiter, register);
```

---

### Annual Resolutions Wizard (high value, moderate work)
`annual_director_resolution.ejs` and `annual_shareholder_resolution.ejs` templates exist but generate with blank/placeholder data. A wizard or modal in DocumentManagement should collect:
- Fiscal year (pre-filled from `fiscalYearEnd`)
- Meeting date
- Resolutions passed (checkboxes: auditor waiver, approve financials, re-appoint directors, etc.)
- Custom resolution text
- Signing directors (from company directors list)

Then pass as a separate `resolutionData` object alongside `company` when rendering the template.

---

### Registry Integration (medium work)
`registryController.ts` is a stub returning mock data. Options:
- **Alberta CORES API** — paid real-time lookup
- **Current workaround** — incorporation document upload + AI parse achieves the same result for all provinces

---

### Unique Company Name Constraint (minor)
Add a unique index on `{userId, name}` in Company.ts to prevent duplicate company names per user.

---

### Email Reminders for Annual Returns (post-launch)
Cron job (e.g., node-cron or Render cron) that queries companies with `annualReturnStatus === 'overdue' | 'due_soon'` and sends reminder emails. Requires an email provider (SendGrid, Resend, etc.) and user email preferences.

---

## Architecture notes

### Snapshot + event log pattern
`Company` stores the **current state snapshot** (fast reads for PDF generation, dashboard display). `CorporateEvent` stores **what happened and when** (immutable history for registers, resolution generation, compliance tracking). The `applyEventToCompany()` function in `eventController.ts` keeps the snapshot updated whenever an event is recorded. Documents that need history (share ledger, transfer register, director register, annual resolutions) are rendered from the Company snapshot; compliance gaps are detected by inspecting event attachments.

### AI PDF parsing
The incorporation document upload uses Claude Haiku's native PDF reading (`type: 'document'` content block with base64 data). This handles both digital PDFs and image/scanned PDFs (e.g., Alberta Corporate Registry printouts from agent services like A-Plus Registry Services). `ANTHROPIC_API_KEY` must be set in `.env`.

### Certificate number assignment
Certificate numbers are assigned server-side in `companyController.ts` using `assignCertNumbers()`. On create, numbering starts at 1. On update, new shareholders without an existing number continue from `max(existing) + 1`. Never duplicated even if the frontend sends partial data.

### Compliance detection
Compliance gaps are detected purely from `CorporateEvent.attachments`. An event is "missing a resolution" if its `eventType` is in `RESOLUTION_ELIGIBLE` and no attachment with `role === 'resolution'` exists. Annual return status is computed from `annualReturnDueDate` (MM-DD) on the Company vs. the last `annual_return_filed` event's `effectiveDate`. Changes made directly in MinuteBookBuilder (initial setup) do not create events and therefore do not generate compliance gaps — this is by design (initial data entry is not a corporate change requiring a resolution).

### File storage
All uploaded files (incorporation PDFs + event attachments) are stored in `backend/uploads/` using UUID-based filenames. The directory is in `.gitignore`. In production (Render), the uploads directory is ephemeral — a persistent disk or cloud storage (S3) should be added before handling significant upload volume.
