# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Repo:** `logicsoftwareEP/cs-copilot` (https://github.com/logicsoftwareEP/cs-copilot). Working copy lives at `D:/Logic Software/cs-copilot/`. Prior to 2026-05-21 this project was a subdirectory of the `D:/Logic Software/AI/` monorepo — that history was extracted via `git subtree split` into this dedicated repo. Do not commit cs-copilot work back into the AI monorepo.

## Commands

```bash
# Backend
cd backend
npm run build        # tsc -> dist/
npm start            # func start
npm test             # jest (225 tests, 17 suites)

# Frontend
cd frontend
npm run dev          # vite dev server
npm run build        # tsc + vite build
```

**Deploy:** `bash backend/scripts/deploy.sh` (builds + zip deploys to Azure Functions).

**Backend tests** live in `src/__tests__/**/*.test.ts` (ts-jest). **Frontend tests** live in `src/__tests__/` (vitest, 28 tests, 2 suites).

## Architecture

Azure Functions syncs account data from SQL Server nightly, enriches with Amplitude usage signals and Zendesk tickets, computes health scores, and stores in Azure Table Storage. React frontend (behind SWA Entra ID auth) displays accounts with role-based access control. No n8n dependency.

### Backend (`backend/`) - Azure Functions v4, Node.js 20, TypeScript, CommonJS

Entry point `src/index.ts` imports all function modules as side effects.

**Functions** (`src/functions/`):
- `AccountsApi.ts` - `GET /api/accounts` (list, CSM-filtered), `GET /api/accounts/{id}` (detail), `PATCH /api/accounts/{id}` (admin/supervisor: update ARR/licences). Auth required on all.
- `MappingApi.ts` - `GET /api/mapping`, `POST /api/mapping`, `DELETE /api/mapping/{id}`. All authenticated roles (admin/supervisor/csm).
- `SyncTrigger.ts` - `POST /api/sync` (admin only, returns 202, fire-and-forget), `GET /api/sync` (sync status). Uses `SyncStatusStore` to track running/completed/failed state.
- `SyncRunner.ts` - Timer trigger (every 30 min, 02:00–05:59 UTC = 8 slices/night) + `runSync()` export. Orchestrates: SQL Server → accounts table, Amplitude → health scores, Zendesk → penalties. After scoring, exports the latest score per account to SQL `[analytics].[AccountHealthScores]` for PowerBI (snapshot replace; non-fatal on failure). Each slice is time-boxed to 8 min (`SYNC_TIME_BUDGET_MS`) so it stops cleanly before the Consumption-plan 10-min `functionTimeout` kills it; accounts not reached are deferred (`SyncResult.remaining`) and picked up by the next slice — accounts already scored today are skipped, so slices resume until all accounts are scored.
- `UsersApi.ts` - `GET /api/me` (current user), `GET /api/users`, `POST /api/users`, `DELETE /api/users?email=...`. Admin only (except `/api/me`).

**Auth** (`src/auth.ts`):
- `authenticateRequest(req)` - decodes `x-ms-client-principal` header (SWA) or reads `X-User-Email` header, looks up user in `users` table, returns `User` or throws `AuthError`
- `requireRole(user, ...roles)` - throws 403 if role not in allowed list
- `SKIP_AUTH` env var for local dev bypass

**Clients** (`src/clients/`):
- `sqlClient.ts` - SQL Server: fetches accounts from `[analytics].[ClientsOverview]` view using `ClientId` (GUID) as `accountId`. Extracts aliases and licences. Connection pooling + retry for transient errors.
- `hubspotClient.ts` - **DISABLED**: HubSpot CRM API. Retained for rollback via `DATA_SOURCE=hubspot`.
- `amplitudeClient.ts` - Amplitude Segmentation API: MAU trend, feature breadth (12 categories). Uses `gp:alias` user property with case-sensitive `is` filter. All requests go through `amplitudeFetch()` — concurrency limiter (max 4) + exponential backoff retry on 429. Feature queries skipped for accounts with no active users. Date windows pinned to UTC midnight for deterministic results.
- `zendeskClient.ts` - Fetches ALL open/pending tickets in bulk (2-3 API calls), aggregates by requester email domain. No per-domain search.
- `intercomClient.ts` - Intercom Conversations API: bulk-fetch conversations (incremental + open snapshot), aggregate by contact email domain. Bearer token auth.

**Services** (`src/services/`):
- `accountStore.ts` - `AccountStore` wraps Azure Table Storage. `partitionKey = 'accounts'`, `rowKey = accountId`.
- `mappingStore.ts` - `MappingStore` for `amplitudemapping` table. `partitionKey = 'mapping'`, `rowKey = accountId`.
- `scoreStore.ts` - `ScoreStore` for `churnscores` table. `partitionKey = accountId`, `rowKey = YYYY-MM-DD`.
- `userStore.ts` - `UserStore` for `users` table. `partitionKey = 'users'`, `rowKey = email (lowercase)`.
- `intercomStore.ts` - `IntercomStore` for `intercomscores` table. `partitionKey = domain`, `rowKey = YYYY-MM-DD`. Daily snapshots aggregated for 30d scoring.
- `syncStatusStore.ts` - `SyncStatusStore` for `syncstatus` table. Single row tracking sync state (running/completed/failed) for UI polling.
- `healthScoreService.ts` - Pure scoring: licence utilisation (0–60) + activity trend (0–25) + feature adoption (0–15) + Intercom bonus (0–10) − Zendesk/Intercom penalty (0 to -20). `buildScoreRow()` builds a complete `ChurnScore` entity from inputs (used by SyncRunner and AccountsApi PATCH).

**Patterns to follow:**
- All env vars go through `getConfig()` in `config.ts`. `requireEnv()` hard-crashes on missing vars; optional vars have defaults.
- Every HTTP handler must call `authenticateRequest(req)` and check roles via `requireRole()`.
- Every HTTP handler must respond to `OPTIONS` with `CORS_HEADERS` (wildcard origin, includes `X-User-Email`).
- Zod validates external inputs in MappingApi and UsersApi. JSON API uses `camelCase`.
- New functions must be added to `src/index.ts` as an import side effect.
- Account writes come from `SyncRunner.runSync()` (timer or on-demand via `POST /api/sync`).
- `withAuth(handler, ...roles)` in `middleware.ts` wraps HTTP handlers with auth + CORS + error handling. Handles OPTIONS preflight, calls `authenticateRequest()`, checks roles, and merges CORS headers into responses. All API functions use this pattern.
- `authLevel: 'function'` is set on all HTTP triggers (requires function key via `?code=` param) until SWA Standard upgrade enables linked backend with EasyAuth passthrough.

### Frontend (`frontend/`) - React 18, Vite, TypeScript, Tailwind CSS, react-router-dom v7

SPA with client-side routing and Azure SWA Entra ID authentication:
- `/` - `Portfolio.tsx` - Account table with health scores, role-aware UI
- `/admin` - `Admin.tsx` - User management (admin only)
- `/mapping` - redirects to `/`

**Auth flow:**
1. SWA pre-configured `aad` provider handles Microsoft login (any Microsoft account)
2. `AuthContext.tsx` calls `/.auth/me` → gets email → calls `GET /api/me` → gets role
3. Unregistered users see "Access denied" screen
4. `useAuth()` hook provides `{ user, loading, error }` to all components

**Role-based UI:**
- CSMs: see only own accounts, no sync/mapping/editing controls
- Supervisors: see all accounts, can edit ARR/licences/mappings
- Admins: full access + user management + sync trigger

**`src/components/`** - Reusable UI components: `TierBadge`, `ScoreBar`, `Sparkline`, `MetricCard`, `DetailPanel`, `SortIcon`, `Spinner`, `ObsLogo`. Shared helpers in `scoreHelpers.ts` and `constants.ts`.

**`src/hooks/`** - Custom hooks: `usePortfolioData.ts` (fetches accounts + mapping, manages loading/error state).

**`src/services/api.ts`** - all fetch calls centralised here. Uses `VITE_API_URL` + `VITE_API_KEY` (function key via `?code=`). Sends `X-User-Email` header on every request via `setAuthEmail()`. Do not make fetch calls anywhere else.

**`staticwebapp.config.json`** - SPA fallback + SWA auth: requires `authenticated` role on all routes, blocks GitHub/Twitter providers, 401 redirects to `/.auth/login/aad`.

**Frontend env** (`.env.local`, not committed):
```
VITE_API_URL=http://localhost:7071/api
VITE_API_KEY=<function-key-from-local-settings>
VITE_SKIP_AUTH=true
```
`.env.production` (gitignored) contains `VITE_API_URL` and `VITE_API_KEY` for production builds.

## Data Model

Six Azure Table Storage tables:
- **`accounts`** - Account data synced nightly from SQL Server
- **`amplitudemapping`** - Account ID → Amplitude alias (auto-synced from SQL, manually correctable)
- **`churnscores`** - Daily health scores per account (includes Intercom penalty/bonus/details)
- **`users`** - Email → displayName + role (admin/supervisor/csm)
- **`intercomscores`** - Daily Intercom conversation snapshots per domain (30d rolling window)
- **`syncstatus`** - Single row tracking sync state (running/completed/failed) for UI polling

Health scores are also exported to a SQL table for PowerBI — see Data Source.

`Account` → joined with latest `ChurnScore` + `AmplitudeMapping` → returned as `AccountSummary`.

Types renamed from `HubspotAccount`/`hubspotId` to `Account`/`accountId` (2026-03-16). `accountId` switched from `HubSpotCompanyId` (numeric) to `ClientId` (GUID, lowercased) on 2026-03-24 — each division/department is now a separate account. `hubspotCompanyId` retained as a non-key informational field.

`HealthTier`: `'healthy' | 'watch' | 'at-risk' | 'critical'` - defined in both `backend/src/types.ts` and `frontend/src/types.ts` (kept in sync manually).

## Data Source

Primary data source: SQL Server view `[analytics].[ClientsOverview]` on `ffzf1thpek.database.windows.net` / `AccountsControl` database. Controlled by `DATA_SOURCE` env var (default: `sql`). Set `DATA_SOURCE=hubspot` to rollback to HubSpot.

SQL sync auto-populates Amplitude aliases and licence counts. Alias sync only creates new mappings — existing mappings are never overwritten (to preserve case corrections for Amplitude's case-sensitive matching). Licence counts are always overwritten from SQL (source of truth) — manual PATCH edits are temporary overrides reverted on next sync.

**Account key:** `accountId` is the `ClientId` GUID from the SQL view (lowercased). Each row in `[analytics].[ClientsOverview]` is a separate account (divisions/departments within the same company get their own account). The old `HubSpotCompanyId` is stored as `hubspotCompanyId` for reference.

**PowerBI export:** after every sync, the latest score per account is written to `[analytics].[AccountHealthScores]` in the same `AccountsControl` database (full snapshot replace: DELETE + bulk INSERT). PowerBI joins it to `[analytics].[ClientsOverview]` on `ClientId`. One-time setup: run `backend/scripts/sql/create-account-health-scores.sql` as admin (CREATE + GRANT SELECT/INSERT/DELETE to the app login (`SQL_LOGIN`)). Verify with `npm run smoke:sql-scores`.

## Env vars

**Required:** `AZURE_STORAGE_CONNECTION_STRING`, `AMPLITUDE_API_KEY`, `AMPLITUDE_SECRET_KEY`, `SQL_SERVER_DETAILS`, `SQL_LOGIN`, `SQL_PASSWORD`

**Optional:** `DATA_SOURCE` (default `sql`), `HUBSPOT_API_KEY` (for rollback), `HUBSPOT_PORTAL_ID` (numeric portal ID — when set, sqlClient builds `hubspotUrl` per account enabling "Open in HubSpot" header link and clickable HubSpot ID in detail panel; production value: `5966961`), `AMPLITUDE_ACCOUNT_PROPERTY` (default `gp:alias`), `AMPLITUDE_FEATURE_EVENTS` (JSON), `ZENDESK_SUBDOMAIN`, `ZENDESK_EMAIL`, `ZENDESK_API_TOKEN`, `INTERCOM_ACCESS_TOKEN`, `SKIP_AUTH` (local dev only), `SWA_ORIGIN` (locks CORS to frontend domain; defaults to `*`)

## Amplitude API — CRITICAL

**Account filters MUST go inside the event object**, not as a top-level `filters` query param. Amplitude silently ignores top-level filters and returns global totals across all accounts. This bug has occurred 3 times.

**Amplitude `is` filter is case-sensitive.** SQL view aliases may have different casing than Amplitude's `gp:alias` values. 32 aliases were manually corrected — stored in the `amplitudemapping` table. The nightly sync preserves these corrections (only creates mappings for accounts without existing ones).

**Amplitude rate limiting.** The Segmentation API has strict rate limits (~360 req/hour). All calls go through `amplitudeFetch()` which limits concurrency to 4 and retries 429s with exponential backoff (5s, 10s, 20s, 40s). Two optimizations reduce call volume: (1) feature breadth queries are skipped when MAU is 0 or null, (2) accounts with valid non-zero scores for today are skipped on re-sync. Do NOT add parallel Amplitude calls without going through the rate limiter.

## Testing Notes

- **Base64 / Basic Auth on Windows**: do NOT use `echo -n "key:secret" | base64` in bash — Windows Git Bash can silently include a trailing CR. Use Python instead.
- **`func` CLI v4.7+** crashes with Node.js 24 ("Value cannot be null"). Use `azure-functions-core-tools@4.0.6610`.

## Deploy Notes

`backend/scripts/deploy.sh` sequence: `tsc` → staged `npm ci --omit=dev` (cached) → zip from stage → `az functionapp deployment source config-zip` (run-from-package).

- **Python on Windows**: the script uses `python` (via `command -v python || command -v python3`) to build `deploy.zip`. Do **not** hardcode `python3` — on Windows Git Bash it resolves to the Microsoft Store alias, prints "Python was not found", and exits without creating the zip. Real Python is at `/c/Python314/python`; `py` launcher also works.
- **Staging dir:** the deploy builds the package in `backend/.deploy-stage/` (cached `npm ci --omit=dev`, refreshed only when `package-lock.json` changes — tracked via a sha256 lock hash) and never touches the working tree's `node_modules`. A failed deploy leaves the working tree intact. Delete `backend/.deploy-stage/` to force a clean rebuild of the cached production deps.
- **Deploy command:** `bash backend/scripts/deploy.sh` (run from the repo root or backend/).
- **Trigger manual sync after deploy:** `curl -X POST "https://cs-copilot-func.azurewebsites.net/api/sync?code=<FUNCTION_KEY>" -H "X-User-Email: vadim@logicsoftware.net"` — returns 202 immediately, sync runs in background (~5 min for 268 accounts). Get the key via `az functionapp keys list --name cs-copilot-func --resource-group customersuccess`.

Full spec: `docs/plans/2026-03-11-cs-copilot-mvp-design.md`
Auth spec: `docs/superpowers/specs/2026-03-17-auth-and-user-management-design.md`
ClientId migration spec: (removed — file does not exist)
Progress: `progress.md`

<!-- updated-by-superflow:2026-03-26 -->
