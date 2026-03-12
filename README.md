# CS Copilot

A Customer Success tool that syncs active clients from HubSpot, connects to Amplitude for usage data, computes health scores, and surfaces everything in a React web app.

## Architecture

```
n8n Cloud (writes)
  Schedule/Webhook trigger
  -> Fetch active accounts from HubSpot
  -> Upsert to Azure Table Storage (accounts table)
  -> Load Amplitude mappings
  -> For each mapped account: AI Agent + Amplitude MCP -> usage signals
  -> Compute health score (0-100)
  -> Save to Azure Table Storage (churnscores table)

Azure Functions (reads)
  GET /api/accounts        -> List accounts + today's score
  GET /api/accounts/:id    -> Single account + 7-day history
  GET /api/mapping         -> List all mappings
  POST /api/mapping        -> Create/update mapping
  DELETE /api/mapping/:id  -> Remove mapping
  POST /api/sync           -> Trigger n8n webhook

React Frontend
  /           -> Portfolio page (account table with health scores)
  /mapping    -> Amplitude alias mapping page
```

### Data Sources

| Source | Used for |
|--------|----------|
| HubSpot | Account roster, ARR, renewal date, CSM assignment |
| Amplitude (via MCP) | DAU/WAU trend, feature adoption, last login |
| Azure Table Storage | Accounts, mappings, daily scores |

### Health Score (MVP)

100% Amplitude-derived. Three signals weighted to 0-100:

| Signal | Weight | Source |
|--------|--------|--------|
| DAU/WAU trend (28d) | 0-40 pts | Amplitude |
| Feature adoption breadth (30d) | 0-35 pts | Amplitude |
| Days since last active login | 0-25 pts | Amplitude |

| Score | Tier |
|-------|------|
| 80-100 | Healthy |
| 60-79 | Watch |
| 40-59 | At Risk |
| 0-39 | Critical |
| No Amplitude alias | Unmapped |

### Azure Table Storage Schema

Three tables:

- **`accounts`** - PartitionKey: `"accounts"`, RowKey: HubSpot company ID. Synced nightly from HubSpot.
- **`amplitudemapping`** - PartitionKey: `"mapping"`, RowKey: HubSpot company ID. Managed via web UI.
- **`churnscores`** - PartitionKey: HubSpot company ID, RowKey: `YYYY-MM-DD`. One row per account per day.

## Commands

```bash
# Backend
cd backend
npm run build        # tsc -> dist/
npm start            # func start
npm test             # jest (15 tests across 3 suites)

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
| `AZURE_STORAGE_TABLE_ACCOUNTS` | No | Table name (default: `accounts`) |
| `AZURE_STORAGE_TABLE_MAPPING` | No | Table name (default: `amplitudemapping`) |
| `AZURE_STORAGE_TABLE_SCORES` | No | Table name (default: `churnscores`) |
| `N8N_SYNC_WEBHOOK_URL` | Yes | n8n webhook URL to trigger sync |

### Frontend (`frontend/.env.local`)

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | Backend URL (default: `/api`) |
| `VITE_API_KEY` | Azure Functions host key |

## Cost

| Item | Cost |
|------|------|
| n8n Cloud | ~$24/month |
| Claude API (Haiku for Amplitude MCP) | ~$2-6/month |
| **Total** | **~$26-30/month** |

## Design Documents

- **Spec:** `docs/plans/2026-03-11-cs-copilot-mvp-design.md`
- **Implementation plan:** `docs/plans/2026-03-11-cs-copilot-mvp-implementation.md`
- **Progress:** `progress.md`
