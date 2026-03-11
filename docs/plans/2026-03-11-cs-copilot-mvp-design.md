# CS Copilot MVP — Technical Design

**Date:** 2026-03-11
**Status:** Approved
**Author:** Vadim + Claude

---

## 1. Purpose

Build a CS Copilot MVP that:
1. Syncs active clients from HubSpot nightly into Azure Table Storage
2. Maps each HubSpot account to its Amplitude alias via a web UI
3. Fetches Amplitude usage signals per account via the Amplitude MCP server
4. Computes a 0–100 health score per account based on Amplitude data only
5. Displays accounts and scores in the existing React web app

Future phases will add Zendesk signals, Slack DM alerts, and additional data sources. The architecture is designed to accommodate these without structural changes.

---

## 2. Architecture Overview

**Pattern:** n8n writes, thin Azure Functions read API, React frontend.

```
HubSpot API          Amplitude MCP (mcp.amplitude.com/mcp)
     │                        │
     └──────────┬─────────────┘
                │
          ┌─────▼──────────────────────┐
          │  n8n Cloud (nightly sync)  │
          │  + webhook for manual sync │
          └─────┬──────────────────────┘
                │ writes
                ▼
     ┌──────────────────────┐
     │  Azure Table Storage │
     │  - accounts          │
     │  - amplitudemapping  │
     │  - churnscores       │
     └──────────┬───────────┘
                │ reads
                ▼
     ┌──────────────────────┐
     │  Azure Functions     │◄── POST /api/sync (triggers n8n webhook)
     │  (read API + mapping │
     │   CRUD)              │
     └──────────┬───────────┘
                │
                ▼
     ┌──────────────────────┐
     │  React Frontend      │
     │  - Portfolio page    │
     │  - Mapping page      │
     └──────────────────────┘
```

**Key principle:** n8n owns all data writes (HubSpot sync, Amplitude fetch, score computation). Azure Functions is read-only except for mapping CRUD and triggering the manual sync webhook.

---

## 3. HubSpot Sync Criteria

Active clients are HubSpot Companies where the custom property `active = Yes`.

Fields pulled per company:
- `hs_object_id` — used as stable primary key throughout the system
- `name` — display name
- `hubspot_owner_id` → resolved to owner name and email
- `arr` — Annual Recurring Revenue
- `renewal_date` — ISO date
- `hs_object_url` — direct link to HubSpot record

---

## 4. n8n Workflow Design

### Triggers
- **Schedule trigger:** Nightly (e.g., 2am ET)
- **Webhook trigger:** `POST /webhook/sync` — called by `POST /api/sync` in Azure Functions for manual runs

Both triggers feed into the same workflow.

### Node Sequence

1. **HubSpot node** — Search Companies where `active = Yes`, fetch all fields listed above. Owner resolution: use a second HubSpot node to look up owner by `hubspot_owner_id` and retrieve `firstname`, `lastname`, and `email`. This is a separate node in the workflow, not an inline call.
2. **Azure Table Storage node** — Upsert all fetched companies into `accounts` table (RowKey = HubSpot company ID)
3. **Azure Table Storage node** — Load all rows from `amplitudemapping` table, build in-memory lookup: HubSpot ID → Amplitude alias
4. **Azure Table Storage node (read)** — Fetch yesterday's scores for all accounts: query `churnscores` for each HubSpot ID with RowKey = yesterday's ISO date. Build an in-memory map: HubSpot ID → previous score. Pass this map into the loop.
5. **Loop node** — For each account:
   - **If alias found:**
     - **AI Agent node + MCP Client** — connects to `https://mcp.amplitude.com/mcp` via OAuth 2.0. The agent is backed by Claude Haiku (configured in n8n AI Agent node credentials) for low cost. Prompt instructs the agent to return the structured JSON output contract defined below.
     - **Code node** — applies deterministic scoring algorithm, produces score 0–100 and tier
   - **If Amplitude MCP call fails** (HTTP error, timeout, malformed response):
     - **Error handler node** — log the error with account ID, set score = null, tier = `"unmapped"`, continue loop (do not abort entire workflow run)
   - **If no alias:**
     - **Set node** — score = null, tier = `"unmapped"`
6. **Azure Table Storage node (write)** — Upsert into `churnscores` (PartitionKey = HubSpot ID, RowKey = today's ISO date). `scoreDelta` = today's score minus previous score from the in-memory map (null if no previous row exists).

### Amplitude MCP Integration

- **Endpoint:** `https://mcp.amplitude.com/mcp` (US) or `https://mcp.eu.amplitude.com/mcp` (EU)
- **Transport:** Streaming HTTP (remote service, no self-hosting required)
- **Auth:** OAuth 2.0 configured as an n8n credential
- **Primary tools used:** `query_dataset`, `get_users`
- **n8n node:** AI Agent node with MCP Client tool pointed at the Amplitude endpoint

The AI Agent node is used only to retrieve structured data from Amplitude. Scoring is handled deterministically in a separate Code node — not by AI — for predictability and cost control.

**Amplitude endpoint:** Use `https://mcp.amplitude.com/mcp` (US) unless the Amplitude account is on EU data residency, in which case use `https://mcp.eu.amplitude.com/mcp`. This is a one-time configuration in the n8n MCP Client credential.

**Expected AI Agent output contract:** The agent prompt must instruct the agent to return a JSON object with exactly these fields:
```json
{
  "dauWauTrend": -0.15,        // fractional change: positive = growth, negative = decline
  "featuresUsed": 4,           // integer: number of distinct features used in last 30d
  "featuresTotal": 12,         // integer: total licensed features
  "lastLoginDays": 9           // integer: days since most recent active user login
}
```
If any field cannot be determined, it must be `null`. The Code node treats any null field as contributing 0 pts for that signal and logs a warning.

---

## 5. Health Score Algorithm

Score range: **0–100**. Amplitude signals only for MVP (100% weight).

| Signal | Max pts | Logic |
|--------|---------|-------|
| DAU/WAU trend (28d) | 40 | ≥+10% = 40 · >-10% and <+10% = 25 · ≥-30% and ≤-10% = 10 · <-30% = 0 |
| Feature adoption breadth | 35 | % of features used in last 30d, linear scale 0–35 |
| Last active user login | 25 | <7d = 25 · 7–14d = 16 · 14–30d = 8 · >30d = 0 |

### Risk Tiers

| Score | Tier |
|-------|------|
| 80–100 | ✅ Healthy |
| 60–79 | 🟡 Watch |
| 40–59 | 🟠 At Risk |
| 0–39 | 🔴 Critical |
| null | ⚠ Unmapped |

### Future Extensibility

When Zendesk (or other sources) are added, the algorithm becomes weighted:
```
Score = Amplitude (e.g. 60%) + Zendesk (e.g. 30%) + CRM (e.g. 10%)
```
Weights will be stored in a `scoreweights` config table in Azure Table Storage, read by the n8n Code node at runtime. No code changes needed to adjust weights. The `scoreweights` table is **not created in this MVP** — it is noted here for future planning only. In MVP, weights are hardcoded in the n8n Code node.

---

## 6. Data Schema

### Table: `accounts`

Synced nightly from HubSpot. Read-only from the app.

| Field | Type | Notes |
|-------|------|-------|
| PartitionKey | string | Fixed: `"accounts"` |
| RowKey | string | HubSpot company ID — stable primary key |
| accountName | string | HubSpot company name |
| csmName | string | HubSpot owner display name |
| csmEmail | string | HubSpot owner email |
| arr | number | Annual Recurring Revenue |
| renewalDate | string | ISO date or empty |
| hubspotUrl | string | Direct link to HubSpot company record |
| syncedAt | string | ISO timestamp of last HubSpot sync |

### Table: `amplitudemapping`

Managed via the web app mapping UI. Written by Azure Functions.

| Field | Type | Notes |
|-------|------|-------|
| PartitionKey | string | Fixed: `"mapping"` |
| RowKey | string | HubSpot company ID — joins to `accounts` table |
| hubspotName | string | Denormalised display name for UI |
| amplitudeAlias | string | Exact account identifier used in Amplitude |
| createdAt | string | ISO timestamp |
| updatedAt | string | ISO timestamp |

### Table: `churnscores`

Written nightly by n8n. One row per account per day.

| Field | Type | Notes |
|-------|------|-------|
| PartitionKey | string | HubSpot company ID |
| RowKey | string | ISO date `YYYY-MM-DD` |
| score | number \| null | 0–100 or null if unmapped |
| tier | string | `healthy \| watch \| at-risk \| critical \| unmapped` |
| dauWauTrend | number \| null | Raw % value from Amplitude |
| featureAdoption | number \| null | Fraction used/total (e.g. 0.42) |
| lastLoginDays | number \| null | Days since last active user login |
| scoreDelta | number \| null | Difference vs previous day's score |
| computedAt | string | ISO timestamp of this run |

---

## 7. Azure Functions API

All endpoints use `authLevel: 'function'` and respond to `OPTIONS` with CORS headers (matching existing pattern).

### Modified Endpoints

| Endpoint | Change | Notes |
|----------|--------|-------|
| `GET /api/accounts` | Rewrite | Read all rows from `accounts` table; for each, fetch today's score row from `churnscores` (PartitionKey = HubSpot ID, RowKey = today's ISO date). If today's row does not exist, fall back to the most recent row within the last 90 days (filter `RowKey ge '<90-days-ago>'`, sort client-side by RowKey descending, take first). If no score row exists at all, return `score: null, tier: null`. |
| `GET /api/accounts/:id` | Rewrite | Single account row from `accounts` + score breakdown from `churnscores`. Score history: query PartitionKey = HubSpot ID with filter `RowKey ge '<7-days-ago>'` (ISO date string comparison works correctly as RowKey since dates sort lexicographically). Returns up to 7 rows ordered by date ascending. |
| `POST /api/accounts/import` | Remove | Replaced by HubSpot sync |
| `POST/PUT/DELETE /api/accounts` | Remove | Accounts are read-only; writes come from n8n |

### New Endpoints

| Endpoint | Notes |
|----------|-------|
| `GET /api/mapping` | List all mappings from `amplitudemapping` table |
| `POST /api/mapping` | Create or update mapping for a HubSpot company ID |
| `DELETE /api/mapping/:id` | Remove mapping; account becomes "unmapped" on next sync |
| `POST /api/sync` | Fire n8n webhook URL; return `{ status: "triggered" }` immediately |

---

## 8. React Frontend Changes

### Modified Pages & Components

**`Portfolio.tsx`** (update):
- Keep account table and health tier badges
- Add score (0–100) and delta (↗ +5, ↘ -12) columns
- Add "Sync Now" button → `POST /api/sync`
- Add "Last synced: X hours ago" label (read from most recent `syncedAt` in accounts)
- Flag unmapped accounts with ⚠ linking to `/mapping`
- Remove CSV import button and `CsvImportModal`
- Remove inline account editing (accounts are read-only)

**`App.tsx` / Nav** (update):
- Add route `/mapping`
- Add nav link "Amplitude Mapping"

### New Pages & Components

**`Mapping.tsx`** (new page):
- List all accounts from `GET /api/accounts`
- Each row: account name + current Amplitude alias (or "Not mapped" in muted style)
- Inline edit: click alias field → input appears with current value → user edits → press Enter or click Save → `POST /api/mapping` (confirmed save, not optimistic). While saving, show a spinner on the row. On success, update local state. On error, show inline error message ("Save failed — try again") and leave the input open so the user can retry or cancel.
- Cancel: press Escape or click Cancel → revert to previous value, no API call
- Clear button → `DELETE /api/mapping/:id` → on success, row shows "Not mapped"
- Unmapped rows visually highlighted (e.g., yellow left border)
- Stub "Import CSV" button (disabled, tooltip: "Coming soon")

### Removed

- `CsvImportModal.tsx` — deleted
- `ImportAccounts.ts` (Azure Function) — deleted

---

## 9. Project Structure Changes

```
cs-copilot/
├── backend/src/
│   ├── functions/
│   │   ├── AccountsApi.ts        ← rewrite (read-only + mapping CRUD + sync trigger)
│   │   ├── MappingApi.ts         ← new
│   │   ├── SyncTrigger.ts        ← new
│   │   ├── ImportAccounts.ts     ← delete
│   │   └── [ChurnScoreJob.ts]    ← remove (replaced by n8n)
│   └── services/
│       └── accountStore.ts       ← update (new table schemas + churnscores reads)
│
└── frontend/src/
    ├── pages/
    │   ├── Portfolio.tsx          ← update
    │   └── Mapping.tsx            ← new
    └── components/
        └── CsvImportModal.tsx     ← delete
```

---

## 10. Environment Variables

### Azure Functions (`local.settings.json`)
```
AZURE_STORAGE_CONNECTION_STRING
AZURE_STORAGE_TABLE_ACCOUNTS       # "accounts"
AZURE_STORAGE_TABLE_MAPPING        # "amplitudemapping"
AZURE_STORAGE_TABLE_SCORES         # "churnscores"
N8N_SYNC_WEBHOOK_URL               # n8n webhook URL for manual sync trigger
```

### n8n Credentials
```
HubSpot API key
Amplitude MCP OAuth 2.0
Azure Table Storage connection string
```

---

## 11. Build Sequence

### Phase 0 — Data Layer (prerequisite)
1. Update `accountStore.ts` — new table schemas (`accounts`, `amplitudemapping`, `churnscores`)
2. Rewrite `AccountsApi.ts` — read-only GET endpoints with score join
3. Add `MappingApi.ts` — mapping CRUD
4. Add `SyncTrigger.ts` — fires n8n webhook

### Phase 1 — n8n Workflow
5. Create n8n Cloud account and credentials (HubSpot, Amplitude MCP OAuth, Azure Storage)
6. Build sync workflow: Schedule + Webhook triggers → HubSpot fetch → upsert accounts → load mapping → loop → Amplitude MCP → score → upsert scores
7. Verify: run manually, check Table Storage rows

### Phase 2 — Frontend
8. Update `Portfolio.tsx` — scores, sync button, unmapped flag
9. Add `Mapping.tsx` — alias management UI
10. Update routing and nav

### Phase 3 — Hardening
11. Error handling in n8n (API failures → continue loop, log errors)
12. Rate limit handling for HubSpot (n8n built-in retry)
13. End-to-end test with real accounts

---

## 12. Cost Estimate (Monthly)

| Item | Cost |
|------|------|
| n8n Cloud (Starter) | ~$24 |
| Azure Functions (consumption) | ~$0–2 |
| Azure Table Storage | ~$1 |
| Claude Haiku API (n8n AI Agent) | ~$1–3 (one Haiku call per account per night; ~100 accounts = negligible) |
| Amplitude MCP | Included in Amplitude plan |
| **Total** | **~$26–30/month** |

Note: The n8n AI Agent node requires an LLM to orchestrate Amplitude MCP tool calls. Claude Haiku is used to minimise cost. Claude API costs for Q&A features (Sonnet) will be added in a future phase.

**Important:** n8n AI Agent node must be configured with an Anthropic credential (Claude Haiku) in addition to the Amplitude MCP credential.
