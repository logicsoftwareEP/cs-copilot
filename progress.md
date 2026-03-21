# CS Copilot - Progress

## Status: Live — SQL data source + Auth + Zendesk bulk sync (2026-03-17)

**Spec:** `docs/plans/2026-03-11-cs-copilot-mvp-design.md`
**Plan:** `docs/plans/2026-03-11-cs-copilot-mvp-implementation.md`

---

## What's Left

1. Add remaining CSM users via `/admin` page
2. Verify all 32 alias casing corrections are scoring correctly (next nightly sync)
3. See `TODOS.md` for deferred items (sentiment analysis, Slack alerts)

---

## Task Tracker

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1-2 | Rewrite `types.ts` + `config.ts` | **DONE** | New interfaces, stripped old types, added tableMapping + n8nSyncWebhookUrl |
| 3 | Rewrite `accountStore.ts` with TDD | **DONE** | Rewritten for HubSpot ID RowKey; 4 tests |
| 4 | Add `mappingStore.ts` with TDD | **DONE** | New file, amplitudemapping table CRUD; 7 tests |
| 5 | Add `scoreStore.ts` with TDD | **DONE** | New file, churnscores table reads; 4 tests |
| 6 | Rewrite `AccountsApi.ts` (read-only) | **DONE** | Read-only GET /api/accounts + GET /api/accounts/{id} with score + mapping joins |
| 7 | Add `MappingApi.ts` | **DONE** | GET/POST/DELETE /api/mapping |
| 8 | Add `SyncTrigger.ts` | **DONE** | POST /api/sync calls runSync() directly (n8n removed) |
| 9 | Update `index.ts`, delete old files | **DONE** | Registered new functions; deleted ImportAccounts.ts |
| 10-11 | ~~n8n Cloud setup~~ | **SUPERSEDED** | Replaced by Azure Functions native sync (SyncRunner) |
| 16 | Add `hubspotClient.ts` | **DONE** | HubSpot CRM API: active companies + owner resolution |
| 17 | Add `amplitudeClient.ts` | **DONE** | Amplitude Segmentation API: DAU/WAU trend, MAU, feature breadth (12 categories) |
| 18 | Add `healthScoreService.ts` | **DONE** | Pure scoring function + 64 unit tests |
| 19 | Add `SyncRunner.ts` | **DONE** | Nightly timer (2 AM UTC) + runSync() orchestration + 5 tests |
| 12 | Frontend: routing, types, API service | **DONE** | react-router-dom installed, types + api.ts rewritten, main.tsx wrapped in BrowserRouter |
| 13 | Rewrite `Portfolio.tsx` | **DONE** | Scores, sync button, unmapped flag; removed editing + CsvImportModal |
| 14 | Add `Mapping.tsx` | **DONE** | New page for Amplitude alias management with inline editing |
| 15 | Update `App.tsx` with routing | **DONE** | Routes for / and /mapping, staticwebapp.config.json for SPA |

---

## Validation Snapshot (2026-03-17)

- Backend TypeScript build: **clean**
- Backend tests: **112/112 passing** across 9 suites
- Frontend TypeScript + Vite build: **clean** (226 kB JS, 23 kB CSS)
- Backend + frontend deployed to Azure
- 268 accounts, 257 aliases (195 scoring), 27 with Zendesk penalties

### 2026-03-17 — SQL Server data source + Auth + Zendesk bulk sync

**SQL Server migration:**
- Data source switched from HubSpot to `[analytics].[ClientsOverview]` SQL view
- Types renamed: `HubspotAccount` → `Account`, `hubspotId` → `accountId` (18 files)
- `sqlClient.ts`: connection pooling, retry logic, field mapping, domain extraction from email
- 257 Amplitude aliases auto-synced from SQL (was 6 manual), 265 licence counts
- HubSpot code disabled but retained (`DATA_SOURCE=hubspot` to rollback)
- 32 alias casing corrections applied (Amplitude `is` filter is case-sensitive, SQL collation is CI)
- Alias sync changed: only creates new mappings, never overwrites (preserves casing corrections)

**Zendesk bulk sync:**
- Replaced per-domain search (500+ API calls) with bulk ticket fetch (2-3 calls)
- Fetches ALL open/pending/new tickets, batch-fetches requesters, aggregates by email domain
- Fixes Zendesk search API not finding tickets by domain (e.g., sesconsulting.com)
- 27 accounts now have Zendesk penalties

**Authentication & user management:**
- Azure SWA built-in Entra ID (pre-configured `aad` provider, Standard plan)
- Three roles: Admin, Supervisor, CSM
- `users` table in Azure Table Storage (email → displayName + role)
- `auth.ts`: `authenticateRequest()` reads `x-ms-client-principal` or `X-User-Email` header, validates against users table
- `UsersApi.ts`: `GET /api/me` + admin CRUD (`GET/POST/DELETE /api/users`)
- Last-admin guard: cannot delete or demote the last admin
- CSM filtering: accounts filtered by `csmName` matching user's `displayName` (case-insensitive)
- Admin page (`/admin`): user management UI with add/edit/delete
- Portfolio: role-aware UI (CSMs: no sync/edit, Supervisors: no sync/user-mgmt, Admins: full access)
- `AuthContext.tsx`: checks `/.auth/me` → `GET /api/me` → renders app or "Access denied"
- Bootstrap: `vadim@logicsoftware.net` seeded as admin
- `staticwebapp.config.json`: requires `authenticated` role, blocks GitHub/Twitter providers

### 2026-03-15 — Dark theme UI + scoring improvements + Zendesk penalty
- **Dark theme frontend** restored with custom `obs-*` Tailwind palette, dark/light theme toggle (localStorage persisted)
- **Inline editing** for Amplitude alias, licences, and ARR directly in the portfolio grid (no separate mapping page)
- **Top 10 Needs Review** section at page top showing critical/at-risk accounts sorted by ARR
- **MAU trend** replaces daily DAU/WAU: compares current 30d unique users vs prior 30d unique users — weekend-immune, fewer API calls
- **Feature breadth** restored as 3rd scoring component (12 Birdview categories, 0-25 pts)
- **Amplitude filter fix** (3rd occurrence): account filter moved inside event object — top-level `filters` param silently returns global totals
- **ARR write guard** restored: `toEntity()` skips ARR when 0 to preserve CSV/manual values
- **Config fix**: `amplitudeAccountProperty` default corrected from `account_name` to `gp:alias`

### 2026-03-15 — Zendesk ticket penalty
- **Zendesk penalty** deducts 0 to -20 points from health score based on support load
  - Three sub-signals: ticket volume (last 30d, 0 to -8), open tickets (all time, 0 to -7), severity (0 to -5)
  - Penalty applied after Amplitude score normalisation; capped at -20
  - Two Zendesk API queries per domain: recent tickets + all open tickets
  - Sequential with 600ms rate limiting; auth failure short-circuits remaining domains
- **Domain field** added to accounts (auto-synced from HubSpot `domain` property)
- **Zendesk client** (`zendeskClient.ts`): Basic auth, pagination (capped at 5 pages), null on error
- **Scoring functions**: `computeZendeskPenalty()` returns structured result with sub-penalties; `applyZendeskPenalty()` adjusts score and re-derives tier
- **SyncRunner**: Zendesk fetch phase with domain dedup, rate limiting, auth short-circuit; unmapped accounts also get penalty
- **Frontend**: "Support Load" card in detail panel showing penalty breakdown (null="N/A", 0="No issues", active=colour-coded)
- **host.json**: `functionTimeout` set to 10 minutes to accommodate Zendesk phase
- 37 new tests (7 Zendesk client + 21 penalty scoring + 5 SyncRunner + 4 integration)

### 2026-03-13 — Feature breadth metric + bug fixes
- **Feature breadth** replaces "Last Active" (days since last login) as the 3rd scoring component (0–25 pts)
  - Queries 12 Amplitude feature events (1 per Birdview category) per account
  - Scores: ≥75% → 25 pts, ≥50% → 16 pts, ≥25% → 8 pts, <25% → 0 pts
  - Detail panel shows per-category breakdown (green/grey dots) so CSMs see adoption gaps
  - Feature events configurable via `AMPLITUDE_FEATURE_EVENTS` env var (JSON)
- **Amplitude API filter fix**: moved account filter from top-level `filters` query param into event object's `filters` array — API was silently ignoring the filter and returning global totals
- **Amplitude property fix**: changed `AMPLITUDE_ACCOUNT_PROPERTY` from `account_name` to `gp:alias` (correct Amplitude user property)
- **Licence utilisation metric** added (prior session): MAU ÷ paid seats (0–35 pts)
- **Licences column** with inline editing in portfolio grid
- Backend redeployed, frontend redeployed to Azure

---

## Architecture Summary

**Azure SWA (Entra ID auth)** → **React frontend** (role-based UI) → **Azure Functions** (auth middleware + read API + mapping CRUD) → **Azure Table Storage** (4 tables: `accounts`, `amplitudemapping`, `churnscores`, `users`).

**SyncRunner** fetches SQL Server accounts + Zendesk bulk tickets + Amplitude signals → computes health scores → writes to Table Storage. Aliases and licences auto-synced from SQL.

Sync runs: (a) nightly timer trigger at 2 AM UTC, (b) on-demand via `POST /api/sync` (admin only).

**Health Score:** DAU/WAU trend (0–40 pts) + Licence utilisation MAU÷seats (0–35 pts) + Feature breadth (0–25 pts) − Zendesk penalty (0 to -20 pts). Normalised to 65 when licences not yet entered, 100 when set.

**Tiers:** Healthy (80-100), Watch (60-79), At Risk (40-59), Critical (0-39), Unmapped (no Amplitude alias).

---

## Previous Architecture History

### 2026-03-05 - Pivoted to n8n + Slack-only
Replaced Azure Functions + React with n8n + Slack-only interface (~$30-40/mo). Amplitude deferred.

### 2026-03-11 - Pivoted to MVP hybrid
Restored React frontend + Azure Functions as thin read API. n8n handles all writes. Added Amplitude MCP integration. Cost: ~$26-30/mo.

### Phase 0 - Completed 2026-03-02
Built Azure Functions backend + React frontend (now rewritten for MVP):
- `accountStore.ts` - Azure Table Storage CRUD for accounts
- `ImportAccounts.ts` - POST /api/accounts/import CSV upload
- `AccountsApi.ts` - full CRUD: GET/POST/PUT/DELETE /api/accounts
- `CsvImportModal.tsx` + `Portfolio.tsx` - React frontend with inline editing
