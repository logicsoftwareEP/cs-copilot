# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Backend
cd backend
npm run build        # tsc -> dist/
npm start            # func start
npm test             # jest (15 tests, 3 suites)

# Frontend
cd frontend
npm run dev          # vite dev server
npm run build        # tsc + vite build
```

**Backend tests** live in `src/__tests__/**/*.test.ts` (ts-jest).

## Architecture

Azure Functions handles all data writes: nightly HubSpot sync, Amplitude signal fetch, and health score computation. No n8n dependency. React frontend displays accounts and manages Amplitude mappings.

### Backend (`backend/`) - Azure Functions v4, Node.js 20, TypeScript, CommonJS

Entry point `src/index.ts` imports all function modules as side effects.

**Functions** (`src/functions/`):
- `AccountsApi.ts` - Read-only: `GET /api/accounts` (list with today's scores), `GET /api/accounts/{id}` (detail with 7-day history). Joins across accounts, churnscores, and amplitudemapping tables.
- `MappingApi.ts` - `GET /api/mapping`, `POST /api/mapping` (upsert, Zod-validated), `DELETE /api/mapping/{id}`.
- `SyncTrigger.ts` - `POST /api/sync` - calls `runSync()` directly, returns `{ status: "ok", result: SyncResult }`.
- `SyncRunner.ts` - Timer trigger (2 AM UTC daily) + `runSync()` export. Orchestrates: HubSpot → accounts table, Amplitude → health scores table.

**Clients** (`src/clients/`):
- `hubspotClient.ts` - HubSpot CRM API: search active companies, resolve owner by ID. Uses fetch + Bearer token.
- `amplitudeClient.ts` - Amplitude Segmentation API: DAU/WAU trend, activity breadth (proxy for feature adoption), last login days. Uses Basic Auth.

**Services** (`src/services/`):
- `accountStore.ts` - `AccountStore` wraps Azure Table Storage. `partitionKey = 'accounts'`, `rowKey = hubspotId`.
- `mappingStore.ts` - `MappingStore` for `amplitudemapping` table. `partitionKey = 'mapping'`, `rowKey = hubspotId`.
- `scoreStore.ts` - `ScoreStore` for `churnscores` table. `partitionKey = hubspotId`, `rowKey = YYYY-MM-DD`.
- `healthScoreService.ts` - Pure scoring function: DAU/WAU trend (0–40) + feature adoption (0–35) + last login (0–25).

**Patterns to follow:**
- All env vars go through `getConfig()` in `config.ts`. `requireEnv()` hard-crashes on missing vars; optional vars have defaults.
- Every HTTP handler must respond to `OPTIONS` with `CORS_HEADERS` (wildcard origin).
- Zod validates external inputs in MappingApi. JSON API uses `camelCase`.
- New functions must be added to `src/index.ts` as an import side effect.
- Account writes come from `SyncRunner.runSync()` (timer or on-demand via `POST /api/sync`).

### Frontend (`frontend/`) - React 18, Vite, TypeScript, Tailwind CSS, react-router-dom v6

Two-page SPA with client-side routing:
- `/` - `Portfolio.tsx` - Account table with health scores, sync button, unmapped account warnings
- `/mapping` - `Mapping.tsx` - Amplitude alias management with inline editing

**`src/services/api.ts`** - all fetch calls centralised here. Reads `VITE_API_URL` and `VITE_API_KEY` from env; appends `?code=<key>` to every request. Do not make fetch calls anywhere else.

**`staticwebapp.config.json`** - SPA navigation fallback for Azure Static Web Apps (prevents 404 on hard refresh of `/mapping`).

**Frontend env** (`.env.local`, not committed):
```
VITE_API_URL=http://localhost:7071/api
VITE_API_KEY=<function-key-from-local-settings>
```

## Data Model

Three Azure Table Storage tables:
- **`accounts`** - HubSpot company data, synced nightly by SyncRunner
- **`amplitudemapping`** - HubSpot company ID -> Amplitude alias, managed via web UI
- **`churnscores`** - Daily health scores per account, written by SyncRunner

`HubspotAccount` -> joined with latest `ChurnScore` + `AmplitudeMapping` -> returned as `AccountSummary`.

`HealthTier`: `'healthy' | 'watch' | 'at-risk' | 'critical'` - defined in both `backend/src/types.ts` and `frontend/src/types.ts` (kept in sync manually).

## Status

- **MVP backend + frontend: complete** (Tasks 1-9, 12-15)
- **n8n removed: Azure Functions handles all sync** (2026-03-12)
- **Env vars needed**: `HUBSPOT_API_KEY`, `AMPLITUDE_API_KEY`, `AMPLITUDE_SECRET_KEY` (required); `AMPLITUDE_ACCOUNT_PROPERTY` (default: `account_name`), `AMPLITUDE_FEATURES_TOTAL` (default: `10`)
- **Deployment: pending**

## Amplitude API — CRITICAL

**Account filters MUST go inside the event object**, not as a top-level `filters` query param. Amplitude silently ignores top-level filters and returns global totals across all accounts. This bug has occurred 3 times.

```typescript
// CORRECT:
e: JSON.stringify({ event_type: '_active', filters: [{ subprop_type: 'user', ... }] })

// WRONG (silently returns global data):
e: JSON.stringify({ event_type: '_active' }), filters: JSON.stringify([{ ... }])
```

## Testing Notes

- **Base64 / Basic Auth on Windows**: do NOT use `echo -n "key:secret" | base64` in bash — Windows Git Bash can silently include a trailing CR, producing a wrong hash. Use Python instead:
  ```bash
  python3 -c "import base64; print(base64.b64encode(b'key:secret').decode())"
  ```
  Node's `Buffer.from('key:secret').toString('base64')` in deployed code is unaffected.

Full spec: `docs/plans/2026-03-11-cs-copilot-mvp-design.md`
Full plan: `docs/plans/2026-03-11-cs-copilot-mvp-implementation.md`
Progress: `progress.md`
