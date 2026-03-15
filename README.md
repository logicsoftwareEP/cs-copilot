# CS Copilot

A Customer Success tool that syncs active clients from HubSpot, fetches usage signals from Amplitude, computes health scores with Zendesk support penalty, and surfaces everything in a React web app.

## Architecture

```
Azure Functions (backend — all reads + writes)
  Nightly timer (2 AM UTC) / POST /api/sync
    → Fetch active accounts from HubSpot (with domain)
    → Upsert to Azure Table Storage (accounts table)
    → Fetch Zendesk ticket data per unique domain (rate-limited)
    → For each mapped account: Amplitude Segmentation API → usage signals
    → Compute health score (0–100) − Zendesk penalty (0 to -20)
    → Save to Azure Table Storage (churnscores table)

  GET /api/accounts        → List accounts + today's score
  GET /api/accounts/:id    → Single account + 7-day history + score breakdown
  PATCH /api/accounts/:id  → Update licence count
  GET /api/mapping         → List all mappings
  POST /api/mapping        → Create/update mapping
  DELETE /api/mapping/:id  → Remove mapping
  POST /api/sync           → Trigger on-demand sync

React Frontend (Azure Static Web Apps)
  /           → Portfolio page (account table with health scores, inline licence editing)
  /mapping    → Amplitude alias mapping page
```

### Data Sources

| Source | Used for |
|--------|----------|
| HubSpot | Account roster, ARR, renewal date, CSM assignment, domain |
| Amplitude | DAU/WAU trend, MAU (monthly active users), feature breadth (12 categories) |
| Zendesk | Ticket volume, open tickets, severity (penalty deduction) |
| Azure Table Storage | Accounts, mappings, daily scores |

### Health Score

Three Amplitude-derived components, normalised to 0–100, then adjusted by Zendesk penalty:

| Signal | Weight | Description |
|--------|--------|-------------|
| DAU/WAU trend (28d) | 0–40 pts | Compares first vs last 14 days of daily active users |
| Licence utilisation | 0–35 pts | MAU ÷ paid seats (manually entered). Omitted when licences not set |
| Feature breadth (30d) | 0–25 pts | Fraction of 12 tracked Birdview feature categories with any activity |

When licences are not set, score is normalised out of 65 (max from DAU/WAU + feature breadth). When licences are set, normalised out of 100.

**Zendesk penalty** (0 to -20 pts): Applied after normalisation. Three sub-signals: ticket volume (last 30d), open tickets (all time), severity (urgent/high in 30d). Capped at -20. Accounts without a domain get no penalty.

**Feature categories tracked:** Activity Center, Time Tracking, Resources, Reporting, Dashboards, Financials, Invoices, Custom Forms, AI Features, Collaboration, Workload, Settings.

| Score | Tier |
|-------|------|
| 80–100 | Healthy |
| 60–79 | Watch |
| 40–59 | At Risk |
| 0–39 | Critical |
| No Amplitude alias | Unmapped |

### Azure Table Storage Schema

Three tables:

- **`accounts`** — PartitionKey: `"accounts"`, RowKey: HubSpot company ID. Synced nightly from HubSpot.
- **`amplitudemapping`** — PartitionKey: `"mapping"`, RowKey: HubSpot company ID. Managed via web UI.
- **`churnscores`** — PartitionKey: HubSpot company ID, RowKey: `YYYY-MM-DD`. One row per account per day.

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
npm test             # jest (98 tests across 7 suites)

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
| `HUBSPOT_API_KEY` | Yes | HubSpot private app token |
| `AMPLITUDE_API_KEY` | Yes | Amplitude API key |
| `AMPLITUDE_SECRET_KEY` | Yes | Amplitude secret key |
| `AMPLITUDE_ACCOUNT_PROPERTY` | No | Amplitude user property for account filtering (default: `gp:alias`) |
| `AMPLITUDE_FEATURE_EVENTS` | No | JSON array of `{category, eventType}` pairs (default: 12 Birdview categories) |
| `ZENDESK_SUBDOMAIN` | No | Zendesk subdomain (e.g., `helpeasyprojects`). Enables Zendesk penalty when all 3 set |
| `ZENDESK_EMAIL` | No | Zendesk agent email for API auth |
| `ZENDESK_API_TOKEN` | No | Zendesk API token |
| `AZURE_STORAGE_TABLE_ACCOUNTS` | No | Table name (default: `accounts`) |
| `AZURE_STORAGE_TABLE_MAPPING` | No | Table name (default: `amplitudemapping`) |
| `AZURE_STORAGE_TABLE_SCORES` | No | Table name (default: `churnscores`) |

### Frontend (`frontend/.env.local`)

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | Backend URL (default: `/api`) |
| `VITE_API_KEY` | Azure Functions host key |

## Design Documents

- **MVP spec:** `docs/plans/2026-03-11-cs-copilot-mvp-design.md`
- **MVP implementation plan:** `docs/plans/2026-03-11-cs-copilot-mvp-implementation.md`
- **Feature breadth spec:** `docs/superpowers/specs/2026-03-13-feature-breadth-metric-design.md`
- **Zendesk penalty plan:** `docs/plans/2026-03-15-zendesk-penalty-plan.md`
- **Progress:** `progress.md`
- **TODOs:** `TODOS.md`
