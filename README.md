# CS Copilot

A Customer Success tool that syncs active clients from SQL Server, fetches usage signals from Amplitude, computes health scores with Zendesk/Intercom support penalties and Intercom engagement bonuses, and surfaces everything in a React web app behind Entra ID auth.

## Architecture

```
Azure Functions (backend — all reads + writes)
  Nightly timer (2 AM UTC) / POST /api/sync
    → Fetch active accounts from SQL Server ([analytics].[ClientsOverview])
    → Upsert to Azure Table Storage (accounts table)
    → Auto-sync Amplitude aliases and licence counts from SQL
    → Fetch Zendesk tickets in bulk (2-3 API calls)
    → Fetch Intercom conversations (incremental + open snapshot)
    → Store daily Intercom snapshots (intercomscores table)
    → For each mapped account: Amplitude Segmentation API → usage signals
    → Compute health score (0–100) + Intercom bonus (0–10) − penalties (0 to -20)
    → Save to Azure Table Storage (churnscores table)
    → Cleanup Intercom snapshots older than 35 days

  GET /api/accounts        → List accounts + today's score (CSM-filtered)
  GET /api/accounts/:id    → Single account + 7-day history + score breakdown
  PATCH /api/accounts/:id  → Update licence count / ARR / hidden flag
  GET /api/mapping         → List all Amplitude mappings (all roles)
  POST /api/mapping        → Create/update mapping (all roles)
  DELETE /api/mapping/:id  → Remove mapping (all roles)
  POST /api/sync           → Trigger on-demand sync (admin only, returns 202)
  GET  /api/sync           → Sync status (running/completed/failed/idle)
  GET /api/me              → Current user info
  GET /api/users           → List users (admin only)
  POST /api/users          → Create user (admin only)
  DELETE /api/users        → Delete user (admin only)

React Frontend (Azure Static Web Apps, Entra ID auth)
  /              → Portfolio page (dark theme, role-aware UI)
  /admin         → User management (admin only)
  /troubleshoot  → Raw scoring data per account (admin only)
```

### Data Sources

| Source | Used for |
|--------|----------|
| SQL Server | Account roster (keyed by `ClientId` GUID), ARR, renewal date, CSM assignment, domain, aliases, licences |
| Amplitude | DAU/WAU trend, MAU (monthly active users), feature breadth (12 categories). Rate-limited: max 4 concurrent requests, retry with backoff on 429 |
| Zendesk | Ticket volume, open tickets, severity → penalty deduction |
| Intercom | Conversation volume, open count, response time → penalty + engagement bonus |
| Azure Table Storage | Accounts, mappings, daily scores, users, Intercom snapshots, sync status |

### Health Score

Three Amplitude-derived components normalised to 0–100, then adjusted by support penalties and engagement bonus:

| Signal | Weight | Description |
|--------|--------|-------------|
| Licence utilisation | 0–60 pts | MAU ÷ paid seats. Omitted when licences not set |
| Activity trend (30d) | 0–25 pts | DAU/WAU ratio change over 28 days |
| Feature adoption (30d) | 0–15 pts | Fraction of 12 tracked Birdview categories with activity |

When licences are not set, score is normalised out of 40 (activity + features). When set, normalised out of 100.

**Zendesk penalty** (0 to -20 pts): Three sub-signals: ticket volume (30d), open tickets, severity. Applied after normalisation.

**Intercom penalty** (0 to -12 pts): Two sub-signals: open conversations, slow response time (avg > 24h with 3+ conversations).

**Combined penalty cap:** Zendesk + Intercom penalties summed and capped at -20.

**Intercom engagement bonus** (0 to +10 pts): Three signals: quick resolutions (≤2 replies), AI-handled conversations, active engagement (volume ≥3, open ≤1). Applied after penalties. Max score: 110.

| Score | Tier |
|-------|------|
| 80+ | Healthy |
| 60–79 | Watch |
| 40–59 | At Risk |
| 0–39 | Critical |
| No Amplitude alias | Unmapped |

### Azure Table Storage Schema

Six tables:

- **`accounts`** — PartitionKey: `"accounts"`, RowKey: `ClientId` GUID (lowercased). Synced nightly from SQL Server. Each division/department is a separate account.
- **`amplitudemapping`** — PartitionKey: `"mapping"`, RowKey: account ID. Auto-synced from SQL, manually correctable.
- **`churnscores`** — PartitionKey: account ID, RowKey: `YYYY-MM-DD`. Includes Zendesk + Intercom penalty/bonus details.
- **`users`** — PartitionKey: `"users"`, RowKey: email (lowercase). Three roles: admin/supervisor/csm.
- **`intercomscores`** — PartitionKey: domain, RowKey: `YYYY-MM-DD`. Daily Intercom conversation snapshots (30d rolling window).
- **`syncstatus`** — PartitionKey: `"sync"`, RowKey: `"status"`. Single row tracking current sync state (running/completed/failed).

## Deployments

| Component | URL | Resource Group |
|-----------|-----|----------------|
| Backend | `cs-copilot-func.azurewebsites.net` | `customersuccess` |
| Frontend | `lemon-island-0c1c7070f.4.azurestaticapps.net` | `customersuccess` |
| Storage | `successep` account | `customersuccess` |

## Commands

```bash
# Backend
cd backend
npm run build        # tsc → dist/
npm start            # func start (local dev)
npm test             # jest (178 tests across 13 suites)

# Frontend
cd frontend
npm run dev          # vite dev server
npm run build        # tsc + vite build
```

## Environment Variables

### Backend (`backend/local.settings.json`)

| Variable | Required | Description |
|----------|----------|-------------|
| `AZURE_STORAGE_CONNECTION_STRING` | Yes | Azure Table Storage connection string |
| `AMPLITUDE_API_KEY` | Yes | Amplitude API key |
| `AMPLITUDE_SECRET_KEY` | Yes | Amplitude secret key |
| `SQL_SERVER_DETAILS` | Yes | SQL Server connection string |
| `SQL_LOGIN` | Yes | SQL Server login |
| `SQL_PASSWORD` | Yes | SQL Server password |
| `AMPLITUDE_ACCOUNT_PROPERTY` | No | Amplitude user property for account filtering (default: `gp:alias`) |
| `AMPLITUDE_FEATURE_EVENTS` | No | JSON array of `{category, eventType}` pairs (default: 12 Birdview categories) |
| `ZENDESK_SUBDOMAIN` | No | Zendesk subdomain. Enables Zendesk penalty when all 3 Zendesk vars set |
| `ZENDESK_EMAIL` | No | Zendesk agent email for API auth |
| `ZENDESK_API_TOKEN` | No | Zendesk API token |
| `INTERCOM_ACCESS_TOKEN` | No | Intercom bearer token. Enables Intercom penalty + bonus when set |
| `DATA_SOURCE` | No | `sql` (default) or `hubspot` (rollback) |
| `SKIP_AUTH` | No | Set to bypass auth in local dev |

### Frontend (`frontend/.env.local`)

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | Backend URL (default: `/api`) |
| `VITE_API_KEY` | Azure Functions host key |
| `VITE_SKIP_AUTH` | Set to bypass auth in local dev |

## Design Documents

- **MVP spec:** `docs/plans/2026-03-11-cs-copilot-mvp-design.md`
- **Auth spec:** `docs/superpowers/specs/2026-03-17-auth-and-user-management-design.md`
- **Intercom spec:** `docs/superpowers/specs/2026-03-21-intercom-integration-design.md`
- **Intercom plan:** `docs/superpowers/plans/2026-03-21-intercom-integration.md`
- **ClientId migration spec:** `docs/superpowers/specs/2026-03-24-clientid-migration-design.md`
- **ClientId migration plan:** `docs/superpowers/plans/2026-03-24-clientid-migration.md`
- **Progress:** `progress.md`
