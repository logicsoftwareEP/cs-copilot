# CS Copilot - Progress

## Status: MVP Code Complete — Azure Functions handles all sync (n8n removed 2026-03-12)

**Spec:** `docs/plans/2026-03-11-cs-copilot-mvp-design.md`
**Plan:** `docs/plans/2026-03-11-cs-copilot-mvp-implementation.md`

---

## What's Left

1. Add env vars to Azure Functions app settings: `HUBSPOT_API_KEY`, `AMPLITUDE_API_KEY`, `AMPLITUDE_SECRET_KEY`
2. Deploy backend to Azure Functions
3. Deploy frontend to Azure Static Web Apps

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
| 17 | Add `amplitudeClient.ts` | **DONE** | Amplitude Segmentation API: DAU/WAU trend, activity breadth, last login |
| 18 | Add `healthScoreService.ts` | **DONE** | Pure scoring function + 33 unit tests |
| 19 | Add `SyncRunner.ts` | **DONE** | Nightly timer (2 AM UTC) + runSync() orchestration + 5 tests |
| 12 | Frontend: routing, types, API service | **DONE** | react-router-dom installed, types + api.ts rewritten, main.tsx wrapped in BrowserRouter |
| 13 | Rewrite `Portfolio.tsx` | **DONE** | Scores, sync button, unmapped flag; removed editing + CsvImportModal |
| 14 | Add `Mapping.tsx` | **DONE** | New page for Amplitude alias management with inline editing |
| 15 | Update `App.tsx` with routing | **DONE** | Routes for / and /mapping, staticwebapp.config.json for SPA |

---

## Validation Snapshot (2026-03-12)

- Backend TypeScript build: **clean**
- Backend tests: **57/57 passing** across 5 suites (accountStore, mappingStore, scoreStore, healthScoreService, SyncRunner)
- Frontend TypeScript + Vite build: **clean** (191 kB JS, 12 kB CSS)
- Unused Phase 0 dependencies removed (117 packages)
- n8n dependency eliminated

---

## Architecture Summary

**Azure Functions (SyncRunner)** fetches HubSpot companies + Amplitude signals → computes health scores → writes to **Azure Table Storage** (3 tables: `accounts`, `amplitudemapping`, `churnscores`) → **Azure Functions** read API + mapping CRUD → **React frontend** (Portfolio + Mapping pages).

Sync runs: (a) nightly timer trigger at 2 AM UTC, (b) on-demand via `POST /api/sync` button in the frontend.

**Health Score:** 100% Amplitude for MVP. DAU/WAU trend (0-40 pts) + Feature adoption (0-35 pts) + Last active login (0-25 pts) = 0-100.

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
