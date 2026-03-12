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

n8n Cloud handles all data writes (HubSpot sync, Amplitude MCP fetch, score computation). Azure Functions is a thin read API + mapping CRUD. React frontend displays accounts and manages Amplitude mappings.

### Backend (`backend/`) - Azure Functions v4, Node.js 20, TypeScript, CommonJS

Entry point `src/index.ts` imports all function modules as side effects.

**Functions** (`src/functions/`):
- `AccountsApi.ts` - Read-only: `GET /api/accounts` (list with today's scores), `GET /api/accounts/{id}` (detail with 7-day history). Joins across accounts, churnscores, and amplitudemapping tables.
- `MappingApi.ts` - `GET /api/mapping`, `POST /api/mapping` (upsert, Zod-validated), `DELETE /api/mapping/{id}`.
- `SyncTrigger.ts` - `POST /api/sync` - fires n8n webhook, returns `{ status: "triggered" }`.

**Services** (`src/services/`):
- `accountStore.ts` - `AccountStore` wraps Azure Table Storage. `partitionKey = 'accounts'`, `rowKey = hubspotId`.
- `mappingStore.ts` - `MappingStore` for `amplitudemapping` table. `partitionKey = 'mapping'`, `rowKey = hubspotId`.
- `scoreStore.ts` - `ScoreStore` for `churnscores` table. `partitionKey = hubspotId`, `rowKey = YYYY-MM-DD`.

**Patterns to follow:**
- All env vars go through `getConfig()` in `config.ts`. `requireEnv()` hard-crashes on missing vars; optional vars have defaults.
- Every HTTP handler must respond to `OPTIONS` with `CORS_HEADERS` (wildcard origin).
- Zod validates external inputs in MappingApi. JSON API uses `camelCase`.
- New functions must be added to `src/index.ts` as an import side effect.
- Accounts are read-only in the API - all writes come from n8n/HubSpot sync.

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
- **`accounts`** - HubSpot company data, synced nightly by n8n
- **`amplitudemapping`** - HubSpot company ID -> Amplitude alias, managed via web UI
- **`churnscores`** - Daily health scores per account, written by n8n

`HubspotAccount` -> joined with latest `ChurnScore` + `AmplitudeMapping` -> returned as `AccountSummary`.

`HealthTier`: `'healthy' | 'watch' | 'at-risk' | 'critical'` - defined in both `backend/src/types.ts` and `frontend/src/types.ts` (kept in sync manually).

## Status

- **MVP backend + frontend: complete** (Tasks 1-9, 12-15)
- **n8n Cloud setup: pending** (Tasks 10-11, manual configuration)
- **Deployment: pending**

Full spec: `docs/plans/2026-03-11-cs-copilot-mvp-design.md`
Full plan: `docs/plans/2026-03-11-cs-copilot-mvp-implementation.md`
Progress: `progress.md`
