# CS Copilot - Progress

## Status: Live — Zendesk ticket penalty added (2026-03-15)

**Spec:** `docs/plans/2026-03-11-cs-copilot-mvp-design.md`
**Plan:** `docs/plans/2026-03-11-cs-copilot-mvp-implementation.md`

---

## What's Left

Zendesk penalty feature implemented, pending deployment:

1. Set Azure app settings: `ZENDESK_SUBDOMAIN=helpeasyprojects`, `ZENDESK_EMAIL`, `ZENDESK_API_TOKEN`
2. Deploy backend + frontend to Azure
3. Trigger sync, verify penalty appears in score breakdown

Other improvements:

1. Add more Amplitude alias mappings (currently 6 of 267 accounts mapped)
2. Set licence counts for mapped accounts to enable utilisation scoring
3. See `TODOS.md` for deferred items (sentiment analysis, Slack alerts, domain editing)

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

## Validation Snapshot (2026-03-15)

- Backend TypeScript build: **clean**
- Backend tests: **98/98 passing** across 7 suites
- Frontend TypeScript + Vite build: **clean** (217 kB JS, 19 kB CSS)

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

**Azure Functions (SyncRunner)** fetches HubSpot companies (with domain) + Zendesk ticket data per domain + Amplitude signals → computes health scores with Zendesk penalty → writes to **Azure Table Storage** (3 tables: `accounts`, `amplitudemapping`, `churnscores`) → **Azure Functions** read API + mapping CRUD → **React frontend** (Portfolio + Mapping pages).

Sync runs: (a) nightly timer trigger at 2 AM UTC, (b) on-demand via `POST /api/sync` button in the frontend.

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
