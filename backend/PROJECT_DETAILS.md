# MinuteBook — Project Details

## Project Purpose

**MinuteBook** is a SaaS web application that helps Canadian small-business owners create and maintain a **corporate minute book** — the legally-required record of a corporation's key information (directors, shareholders, share structure, registered office) and constitutional documents (Articles of Incorporation, By-Laws). Users enter their company data once, and the system auto-generates polished PDF versions of the standard corporate documents on demand.

The defaults (province field, "Canada" country default, the mock "Alberta Corporate Registry" stub at [registryController.ts:13](src/controllers/registryController.ts#L13)) make the Canadian/Alberta legal context explicit.

---

## Backend (`backend/`)

**Stack:** Node.js + Express 5 + TypeScript + MongoDB (Mongoose) + Puppeteer + EJS, secured with Helmet, CORS, JWT, bcrypt.

### Entry & infrastructure
- [server.ts](src/server.ts) wires Helmet, CORS, Morgan logging, JSON body parsing, then mounts four route groups under `/api/*` and a `/api/health` probe. A generic 500 error handler hides stack traces from the client.
- [config/db.ts](src/config/db.ts) connects to MongoDB Atlas via `MONGODB_URI`; `process.exit(1)` on connection failure is appropriate for a fail-fast startup.

### Data models (`src/models/`)
- [User.ts](src/models/User.ts) — email, bcrypt `passwordHash`, `role` (`admin` | `business_owner`), `subscriptionTier` (`free` | `premium`).
- [Company.ts](src/models/Company.ts) — owned by a `userId`; nested `registeredOfficeAddress`, plus `directors[]` and `shareholders[]` sub-arrays. The shape mirrors what Canadian corporate records actually need.
- [Document.ts](src/models/Document.ts) — versioned record of generated documents (currently logged but not actually written on generation — see issues below).
- [ActivityLog.ts](src/models/ActivityLog.ts) — append-only audit trail (`CREATED_COMPANY`, `GENERATED_DOCUMENT`, etc.).

### Auth & middleware
- [authController.ts](src/controllers/authController.ts) — `register` hashes with bcrypt (salt rounds 10) and issues a 30-day JWT; `login` does a constant comparison and reissues. Tokens carry `{id, role}`.
- [authMiddleware.ts](src/middleware/authMiddleware.ts) — `protect` parses `Authorization: Bearer …`, verifies the JWT, and attaches `req.user`. `adminOnly` is defined but currently unused on any route.

### Domain endpoints
- [companyController.ts](src/controllers/companyController.ts) — `POST /api/companies` creates a company scoped to the JWT user; `GET /` lists only that user's companies (proper tenant isolation).
- [documentController.ts](src/controllers/documentController.ts) — `POST /api/documents/generate` validates the requested template against an allow-list (`articles_of_incorporation`, `by_laws`), re-checks ownership of the company, then streams the PDF back with `Content-Disposition: attachment`. `GET /:companyId` lists existing documents (but nothing currently writes to that collection — see issue 3 below).
- [registryController.ts](src/controllers/registryController.ts) — a stub for an external registry lookup (e.g. Alberta Corporate Registry); always returns mock data.

### Document generation ([services/documentGenerator.ts](src/services/documentGenerator.ts))
1. Reads the EJS template by name from [templates/](src/templates/).
2. Renders to HTML with the `company` object.
3. Launches headless Chromium via Puppeteer (with `--no-sandbox` for containerized hosts).
4. Returns a `Buffer` of a Letter-size PDF with 1-inch margins.

The two templates produce a structured **Articles of Incorporation** (name, CAN, registered office, directors table, share structure, signature block) and a **By-Law No. 1** (registered office, directors, shareholders/fiscal year clauses).

---

## Frontend (`frontend/`)

**Stack:** React 18 + TypeScript + Vite + Material UI v5 + Redux Toolkit + React Router v6 + react-hook-form + Zod + Axios.

- `vite.config.ts` proxies `/api` to `http://localhost:5000`, so the dev server and the backend share an origin.
- `main.tsx` / `App.tsx` — wraps the app in the Redux store and an MUI theme (deep corporate blue `#1a237e`), with `BrowserRouter` and a `PrivateRoute` HOC that gates `/dashboard`, `/builder`, `/documents` behind `state.auth.isAuthenticated`.
- `store/authSlice.ts` — `loginSuccess` persists the user (and JWT) to `localStorage`; `logout` clears it. The slice **does not rehydrate** from `localStorage` on app start, so a hard refresh logs the user out (issue 2).
- `utils/api.ts` — Axios instance with a request interceptor that pulls the token from `localStorage` and adds `Authorization: Bearer …`.

### Components
- `Login.tsx` / `Register.tsx` — simple MUI forms calling `/api/auth/...` directly via raw `axios` (not the `api` instance), then dispatching `loginSuccess`. `alert()` is used for errors.
- `Dashboard.tsx` — fetches the user's companies, shows a "My Companies" list and an empty "Recent Activity" panel (the activity log endpoint isn't wired up yet), with buttons to the builder and document vault.
- `MinuteBookBuilder.tsx` — the core form. Uses Zod for validation and `useFieldArray` for dynamic director/shareholder rows. On submit, posts to `/api/companies` and returns to the dashboard. Despite the button label "Save Company & Generate Book," it only saves; PDF generation happens later.
- `DocumentManagement.tsx` — pick a company, click a template; calls `POST /documents/generate` with `responseType: 'blob'` and triggers a browser download via an object URL.

---

## End-to-end flow

1. **Register / login** → JWT stored in `localStorage`.
2. **Builder** → user enters company info; saved to MongoDB scoped to their user id.
3. **Dashboard** → lists companies.
4. **Document Vault** → user picks a template, backend renders EJS → Puppeteer → PDF buffer streamed to the browser as a download.
5. Every meaningful action writes an `ActivityLog` row.

---

## Notable issues & gaps

1. **Secret leakage** — `backend/.env` contains a live MongoDB Atlas connection string with credentials and a placeholder JWT secret (`supersecretjwtkey_change_in_production`). Rotate the DB password immediately, generate a real JWT secret, and add `.env` to a (currently missing) `.gitignore`.
2. **Auth doesn't survive refresh.** `authSlice` writes to `localStorage` but never reads on initialization. Add a `getInitialState()` that hydrates from `localStorage.getItem('user')`.
3. **`Document` model is dead code.** [documentController.ts:26-29](src/controllers/documentController.ts#L26-L29) explicitly notes `DocumentModel.create` was removed, so `GET /api/documents/:companyId` will always return `[]` and the "Document Vault" can't show generated history.
4. **Express 5 + return signatures.** Express 5's stricter handler typing means `return res.status(...).json(...)` patterns are fine at runtime but TypeScript may complain depending on `@types/express` version pinning.
5. **No password policy / rate limiting** on `/api/auth/*` — bcrypt protects at-rest, but brute-force at the endpoint is unmitigated. Consider `express-rate-limit`.
6. **No company update / delete** endpoint — once a company is created, the form data is immutable through the UI.
7. **Puppeteer per request** is heavy. For any real load, switch to a long-lived browser instance or pool, or a service like `@sparticuz/chromium` if deploying serverless.
8. **`adminOnly` middleware is unused** — the `admin` role exists but no admin routes consume it.
9. **`alert()` UX** in Login/Register/Builder/Vault — should be MUI `Snackbar`/`Alert` for consistency.
10. **Registry integration is a stub** — `fetchRegistryData` is wired into routes but never called from the frontend; the "auto-populate from registry" feature is unimplemented.
11. **`name` field has no `unique: true` constraint** on Company per user — duplicates per user are silently allowed.
12. **CORS is wide open** (`cors()` with no options) — fine for dev, should be locked to the frontend origin in production.
