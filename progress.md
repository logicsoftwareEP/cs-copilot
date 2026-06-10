# CS Copilot - Progress

## Status: Live — HubSpot + Portal links in detail panel (2026-05-18)

**Spec:** `docs/plans/2026-03-11-cs-copilot-mvp-design.md`
**Plan:** `docs/plans/2026-03-11-cs-copilot-mvp-implementation.md`

---

## What's Left

1. ~~Set `INTERCOM_ACCESS_TOKEN` in Azure Functions app configuration~~ — **DONE** (2026-03-22)
2. Add remaining CSM users via `/admin` page
3. See `TODOS.md` for deferred items

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

### 2026-06-10 — PowerBI health score export

- New SQL table `[analytics].[AccountHealthScores]` (ClientId, Score, Tier, ScoreDate, UpdatedAt) in AccountsControl — DDL: `backend/scripts/sql/create-account-health-scores.sql` (already applied to the DB).
- `runSync()` now exports the latest score snapshot to SQL after scoring (snapshot replace, non-fatal on failure). `SyncResult.scoresExported` added.
- Smoke test: `npm run smoke:sql-scores` (real traffic — Table Storage read + live SQL write + read-back). Verified against live DB 2026-06-10: 35/35 rows.
- Spec: `docs/superpowers/specs/2026-06-10-powerbi-scores-export-design.md`.

### 2026-05-18 — HubSpot + Portal links in detail panel

**Changes:**
- Restored "Open in Portal" link (`adminportal.easyprojects.net/portal/clients/{accountId}`) lost in sprint-8 merge regression
- Added `HUBSPOT_PORTAL_ID` optional env var (`5966961` in production); `sqlClient.ts` now constructs `hubspotUrl` as `https://app.hubspot.com/contacts/{portalId}/company/{companyId}` when set
- `config.ts` + `SyncRunner.ts` updated to pass portal ID through to SQL client
- "Open in HubSpot" header link and "HubSpot ID" Account Details row now both active (previously `hubspotUrl` was always `''` from SQL)
- Fixed `deploy.sh` to use `python` instead of `python3` (Windows Store stub fix)

**Files changed:** `DetailPanel.tsx`, `config.ts`, `sqlClient.ts`, `SyncRunner.ts`, `backend/scripts/deploy.sh`

### 2026-03-24 — ClientId migration: fix license collisions + split multi-division accounts

**Problem:** The SQL view `[analytics].[ClientsOverview]` has multiple rows per `HubSpotCompanyId` when a company has separate divisions (e.g., Cornell University has 2 active divisions). The old code used `HubSpotCompanyId` as `accountId`, causing:
- 8 multi-division companies collided (last-write-wins for name, alias, licenses)
- 49 accounts had stale/incorrect license counts due to a "sticky" guard that never updated licenses once set
- Example: National Research Council had 132 licenses in storage but SQL said 20

**Fix:** Switched `accountId` from `HubSpotCompanyId` (numeric) to `ClientId` (GUID, unique per row in SQL view).
- Each division now gets its own account, alias, license count, and health score
- `hubspotCompanyId` retained as a non-key informational field
- License sync made unconditional — SQL is the source of truth, always overwritten on nightly sync
- Old numeric-keyed rows cleaned up from all tables (270 accounts, 286 mappings, 2,773 scores)

**Result:** 281 accounts (was 268), all GUID-keyed. Cornell: 2 entries (Dining Team = 4 lic, SSIT = 70 lic). NRC: 20 licenses (corrected from 132).

**Files changed:** `sqlClient.ts`, `types.ts` (both), `accountStore.ts`, `SyncRunner.ts`, `hubspotClient.ts`, `Portfolio.tsx`, `Troubleshoot.tsx`, `Mapping.tsx`, `SyncRunner.test.ts`, `accountStore.test.ts`

**Spec:** `docs/superpowers/specs/2026-03-24-clientid-migration-design.md`

## Validation Snapshot (2026-03-24)

- Backend TypeScript build: **clean**
- Backend tests: **178/178 passing** across 13 suites
- Frontend TypeScript + Vite build: **clean**
- Backend + frontend deployed to Azure
- 281 accounts, all GUID-keyed, license counts verified against SQL

### 2026-03-22 — Amplitude rate limiting fix + async sync with status polling

**Root cause: Amplitude 429 rate limiting.**
The sync was making ~2700 API calls per run (195 accounts × 14 calls each), far exceeding Amplitude's Segmentation API rate limit. This caused:
- "Inconsistent scores" — some accounts got data before rate limiting kicked in, others got 429 and scored 0
- "All scores 0" — when rate limit was fully exhausted, every account got 429

**Amplitude rate limit fix:**
- `amplitudeFetch()` wrapper: concurrency limiter (max 4 concurrent, Amplitude allows 5) + exponential backoff retry on 429 (5s, 10s, 20s, 40s, up to 4 retries)
- All Amplitude API calls serialized within each account (was 14 parallel → sequential through queue)
- **Skip feature queries for inactive accounts** — if MAU is 0 or null, skip all 12 feature event queries (saves ~80% of API calls for inactive accounts)
- **Skip re-scoring on re-sync** — accounts with valid non-zero scores for today are not re-queried (prevents wasting rate limit on manual re-sync)

**Amplitude date fix:**
- `daysAgo()` pinned to UTC midnight — all syncs on the same UTC calendar day produce identical Amplitude query windows
- `toAmplitudeDate()` switched from local time to UTC components
- 4 new tests for date utilities

**Async sync with status polling:**
- `POST /api/sync` now returns `202 Accepted` immediately (fire-and-forget)
- New `syncstatus` table tracks sync state (`running`/`completed`/`failed`)
- New `GET /api/sync` endpoint returns current sync status
- `SyncStatusStore` service: `setRunning()`, `setCompleted()`, `setFailed(error)`, `getStatus()`
- Frontend polls `GET /api/sync` every 5s while syncing, auto-refreshes accounts on completion
- Sync button stays disabled during entire sync, stale-status-aware (ignores completed from previous sync)
- On-mount status check: if page loads while sync is running, button automatically shows "Syncing..." and polls
- 5 new tests for SyncStatusStore

**Intercom token:** `INTERCOM_ACCESS_TOKEN` set in Azure Functions app configuration.

### 2026-03-21 — Intercom integration + scoring reweight

**Scoring reweight:**
- Licence utilisation: 35 → **60 pts** (dominant signal)
- Activity trend: 40 → **25 pts**
- Feature adoption: 25 → **15 pts**
- No-licence normalisation: 65 → 40
- Extracted `scoreToTier()` helper, derived `maxPossible` from named constants

**Intercom integration:**
- `intercomClient.ts`: Two-pass fetch — incremental conversations (36h) + open snapshot. Aggregates by contact email domain. Generic domains excluded.
- `intercomStore.ts`: Daily snapshots in `intercomscores` table. 30-day aggregation (sum events, latest openCount, weighted avg response time). Auto-cleanup > 35 days.
- **Intercom penalty** (0 to -12): open conversations (0 to -7) + slow responses > 24h (0 to -5)
- **Intercom bonus** (0 to +10): quick resolutions (0–4) + AI-handled (0–3) + active engagement (0–3)
- **Combined penalty cap**: Zendesk + Intercom summed and capped at -20
- `applyAllPenalties()` replaces `applyZendeskPenalty()` — single entry point for all penalties + bonus
- Score range now 0–110 (100 base + 10 bonus)
- SyncRunner: Intercom fetch phase, snapshot storage, 30d aggregation, scoring, cleanup
- AccountsApi: detail endpoint serves `intercomDetails`, uses pre-computed data from `intercomscores`
- Frontend: Intercom Support card, Intercom Engagement card, score > 100 badge, renamed Zendesk card, combined cap note, updated scoring key
- 57 new tests (15 client + 42 scoring)

**Troubleshooting page:**
- New `/troubleshoot` route (admin-only) — displays all raw signal data per account
- Amplitude signals, Zendesk details, Intercom details, score calculation breakdown, 7-day history
- Account list with search, click to view details
- "Details" link in Portfolio side panel opens Troubleshoot for the selected account in a new tab
- Deep-linkable via `?account={id}` query param

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

**Azure SWA (Entra ID auth)** → **React frontend** (role-based UI) → **Azure Functions** (auth middleware + read API + mapping CRUD) → **Azure Table Storage** (6 tables: `accounts`, `amplitudemapping`, `churnscores`, `users`, `intercomscores`, `syncstatus`).

**SyncRunner** fetches SQL Server accounts (keyed by `ClientId` GUID) + Zendesk bulk tickets + Intercom conversations + Amplitude signals → computes health scores → writes to Table Storage. Aliases and licences auto-synced from SQL. Each division/department is a separate account.

Sync runs: (a) nightly timer trigger at 2 AM UTC, (b) on-demand via `POST /api/sync` (admin only).

**Health Score:** Licence utilisation (0–60 pts) + Activity trend (0–25 pts) + Feature adoption (0–15 pts) + Intercom bonus (0–10 pts) − Zendesk/Intercom penalty (0 to -20 pts). Normalised to 40 when licences not entered, 100 when set. Max 110 with engagement bonus.

**Tiers:** Healthy (80+), Watch (60-79), At Risk (40-59), Critical (0-39), Unmapped (no Amplitude alias).

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
