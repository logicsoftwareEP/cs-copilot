# CS Copilot - Progress

## Status: MVP Code Complete (Tasks 1-9, 12-15 done) - Awaiting n8n Setup (Tasks 10-11)

**Spec:** `docs/plans/2026-03-11-cs-copilot-mvp-design.md`
**Plan:** `docs/plans/2026-03-11-cs-copilot-mvp-implementation.md`

---

## What's Left

1. **Tasks 10-11: n8n Cloud setup (manual)** - See implementation plan for node-by-node instructions
2. Deploy backend to Azure Functions
3. Deploy frontend to Azure Static Web Apps
4. Update `CLAUDE.md` to reflect new architecture

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
| 8 | Add `SyncTrigger.ts` | **DONE** | POST /api/sync triggers n8n webhook |
| 9 | Update `index.ts`, delete old files | **DONE** | Registered new functions; deleted ImportAccounts.ts |
| 10-11 | n8n Cloud setup | **MANUAL - PENDING** | User must configure n8n workflows |
| 12 | Frontend: routing, types, API service | **DONE** | react-router-dom installed, types + api.ts rewritten, main.tsx wrapped in BrowserRouter |
| 13 | Rewrite `Portfolio.tsx` | **DONE** | Scores, sync button, unmapped flag; removed editing + CsvImportModal |
| 14 | Add `Mapping.tsx` | **DONE** | New page for Amplitude alias management with inline editing |
| 15 | Update `App.tsx` with routing | **DONE** | Routes for / and /mapping, staticwebapp.config.json for SPA |

---

## Validation Snapshot (2026-03-12)

- Backend TypeScript build: **clean**
- Backend tests: **15/15 passing** across 3 suites (accountStore, mappingStore, scoreStore)
- Frontend TypeScript + Vite build: **clean** (191 kB JS, 12 kB CSS)
- Unused Phase 0 dependencies removed (117 packages)
- Unused Phase 0 env vars removed from local.settings.json

---

## Architecture Summary

**n8n Cloud** writes data (HubSpot sync, Amplitude MCP fetch, health score computation) -> **Azure Table Storage** (3 tables: `accounts`, `amplitudemapping`, `churnscores`) -> **Azure Functions** thin read API + mapping CRUD -> **React frontend** (Portfolio + Mapping pages).

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
