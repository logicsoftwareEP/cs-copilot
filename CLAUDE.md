# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Backend
cd backend
npm run build        # tsc -> dist/
npm start            # func start
npm test             # jest (112 tests, 9 suites)

# Frontend
cd frontend
npm run dev          # vite dev server
npm run build        # tsc + vite build
```

**Backend tests** live in `src/__tests__/**/*.test.ts` (ts-jest).

## Architecture

Azure Functions syncs account data from SQL Server nightly, enriches with Amplitude usage signals and Zendesk tickets, computes health scores, and stores in Azure Table Storage. React frontend (behind SWA Entra ID auth) displays accounts with role-based access control. No n8n dependency.

### Backend (`backend/`) - Azure Functions v4, Node.js 20, TypeScript, CommonJS

Entry point `src/index.ts` imports all function modules as side effects.

**Functions** (`src/functions/`):
- `AccountsApi.ts` - `GET /api/accounts` (list, CSM-filtered), `GET /api/accounts/{id}` (detail), `PATCH /api/accounts/{id}` (admin/supervisor: update ARR/licences). Auth required on all.
- `MappingApi.ts` - `GET /api/mapping`, `POST /api/mapping`, `DELETE /api/mapping/{id}`. Admin/supervisor only.
- `SyncTrigger.ts` - `POST /api/sync` - admin only. Calls `runSync()` directly.
- `SyncRunner.ts` - Timer trigger (2 AM UTC daily) + `runSync()` export. Orchestrates: SQL Server → accounts table, Amplitude → health scores, Zendesk → penalties.
- `UsersApi.ts` - `GET /api/me` (current user), `GET /api/users`, `POST /api/users`, `DELETE /api/users?email=...`. Admin only (except `/api/me`).

**Auth** (`src/auth.ts`):
- `authenticateRequest(req)` - decodes `x-ms-client-principal` header (SWA) or reads `X-User-Email` header, looks up user in `users` table, returns `User` or throws `AuthError`
- `requireRole(user, ...roles)` - throws 403 if role not in allowed list
- `SKIP_AUTH` env var for local dev bypass

**Clients** (`src/clients/`):
- `sqlClient.ts` - SQL Server: fetches accounts from `[analytics].[ClientsOverview]` view, extracts aliases and licences. Connection pooling + retry for transient errors.
- `hubspotClient.ts` - **DISABLED**: HubSpot CRM API. Retained for rollback via `DATA_SOURCE=hubspot`.
- `amplitudeClient.ts` - Amplitude Segmentation API: MAU trend, feature breadth (12 categories). Uses `gp:alias` user property with case-sensitive `is` filter.
- `zendeskClient.ts` - Fetches ALL open/pending tickets in bulk (2-3 API calls), aggregates by requester email domain. No per-domain search.

**Services** (`src/services/`):
- `accountStore.ts` - `AccountStore` wraps Azure Table Storage. `partitionKey = 'accounts'`, `rowKey = accountId`.
- `mappingStore.ts` - `MappingStore` for `amplitudemapping` table. `partitionKey = 'mapping'`, `rowKey = accountId`.
- `scoreStore.ts` - `ScoreStore` for `churnscores` table. `partitionKey = accountId`, `rowKey = YYYY-MM-DD`.
- `userStore.ts` - `UserStore` for `users` table. `partitionKey = 'users'`, `rowKey = email (lowercase)`.
- `healthScoreService.ts` - Pure scoring: licence utilisation (0–60) + activity trend (0–25) + feature adoption (0–15) − Zendesk penalty (0 to -20).

**Patterns to follow:**
- All env vars go through `getConfig()` in `config.ts`. `requireEnv()` hard-crashes on missing vars; optional vars have defaults.
- Every HTTP handler must call `authenticateRequest(req)` and check roles via `requireRole()`.
- Every HTTP handler must respond to `OPTIONS` with `CORS_HEADERS` (wildcard origin, includes `X-User-Email`).
- Zod validates external inputs in MappingApi and UsersApi. JSON API uses `camelCase`.
- New functions must be added to `src/index.ts` as an import side effect.
- Account writes come from `SyncRunner.runSync()` (timer or on-demand via `POST /api/sync`).

### Frontend (`frontend/`) - React 18, Vite, TypeScript, Tailwind CSS, react-router-dom v6

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

**`src/services/api.ts`** - all fetch calls centralised here. Uses `VITE_API_URL` + `VITE_API_KEY` (function key via `?code=`). Sends `X-User-Email` header on every request via `setAuthEmail()`. Do not make fetch calls anywhere else.

**`staticwebapp.config.json`** - SPA fallback + SWA auth: requires `authenticated` role on all routes, blocks GitHub/Twitter providers, 401 redirects to `/.auth/login/aad`.

**Frontend env** (`.env.local`, not committed):
```
VITE_API_URL=http://localhost:7071/api
VITE_API_KEY=<function-key-from-local-settings>
VITE_SKIP_AUTH=true
```

## Data Model

Four Azure Table Storage tables:
- **`accounts`** - Account data synced nightly from SQL Server
- **`amplitudemapping`** - Account ID → Amplitude alias (auto-synced from SQL, manually correctable)
- **`churnscores`** - Daily health scores per account
- **`users`** - Email → displayName + role (admin/supervisor/csm)

`Account` → joined with latest `ChurnScore` + `AmplitudeMapping` → returned as `AccountSummary`.

Types renamed from `HubspotAccount`/`hubspotId` to `Account`/`accountId` (2026-03-16).

`HealthTier`: `'healthy' | 'watch' | 'at-risk' | 'critical'` - defined in both `backend/src/types.ts` and `frontend/src/types.ts` (kept in sync manually).

## Data Source

Primary data source: SQL Server view `[analytics].[ClientsOverview]` on `ffzf1thpek.database.windows.net` / `AccountsControl` database. Controlled by `DATA_SOURCE` env var (default: `sql`). Set `DATA_SOURCE=hubspot` to rollback to HubSpot.

SQL sync auto-populates Amplitude aliases and licence counts. Alias sync only creates new mappings — existing mappings are never overwritten (to preserve case corrections for Amplitude's case-sensitive matching).

## Env vars

**Required:** `AZURE_STORAGE_CONNECTION_STRING`, `AMPLITUDE_API_KEY`, `AMPLITUDE_SECRET_KEY`, `SQL_SERVER_DETAILS`, `SQL_LOGIN`, `SQL_PASSWORD`

**Optional:** `DATA_SOURCE` (default `sql`), `HUBSPOT_API_KEY` (for rollback), `AMPLITUDE_ACCOUNT_PROPERTY` (default `gp:alias`), `AMPLITUDE_FEATURE_EVENTS` (JSON), `ZENDESK_SUBDOMAIN`, `ZENDESK_EMAIL`, `ZENDESK_API_TOKEN`, `SKIP_AUTH` (local dev only)

## Amplitude API — CRITICAL

**Account filters MUST go inside the event object**, not as a top-level `filters` query param. Amplitude silently ignores top-level filters and returns global totals across all accounts. This bug has occurred 3 times.

**Amplitude `is` filter is case-sensitive.** SQL view aliases may have different casing than Amplitude's `gp:alias` values. 32 aliases were manually corrected — stored in the `amplitudemapping` table. The nightly sync preserves these corrections (only creates mappings for accounts without existing ones).

## Testing Notes

- **Base64 / Basic Auth on Windows**: do NOT use `echo -n "key:secret" | base64` in bash — Windows Git Bash can silently include a trailing CR. Use Python instead.
- **`func` CLI v4.7+** crashes with Node.js 24 ("Value cannot be null"). Use `azure-functions-core-tools@4.0.6610`.

Full spec: `docs/plans/2026-03-11-cs-copilot-mvp-design.md`
Auth spec: `docs/superpowers/specs/2026-03-17-auth-and-user-management-design.md`
Progress: `progress.md`
