# CS Copilot — Technical Design

**Date:** 2026-02-24
**Status:** Approved
**Author:** Vadim + Claude

---

## 1. Purpose

A CS Copilot that lets Customer Success Managers ask natural language questions about their accounts and receive proactive churn risk alerts. Available via Web UI and Slack.

**Reactive:** CSM asks a question → gets an answer grounded in live data
**Proactive:** System detects at-risk accounts → DMs the CSM each morning

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                        CSM Interfaces                        │
│          Web UI (React/Vite)    │    Slack Bot (DM)          │
└─────────────────┬───────────────┴────────────┬───────────────┘
                  │                            │
┌─────────────────▼────────────────────────────▼───────────────┐
│                    Azure Functions (Backend)                  │
│                                                              │
│  POST /api/ask          — Q&A via Claude + tools             │
│  GET  /api/accounts     — CSM portfolio with health scores   │
│  GET  /api/accounts/:id — 360° account view                  │
│  POST /api/slack/events — Slack DM handler (Bolt)            │
│  Timer: ChurnScoreJob   — Daily 7am, scores + DMs            │
└────────┬──────────────────────────────────────────┬──────────┘
         │                                          │
         ▼                                          ▼
┌────────────────────┐                  ┌───────────────────────┐
│  Claude API        │                  │  Azure Table Storage  │
│  (Sonnet/Haiku)    │                  │  - churn_scores       │
│  + Tool calls      │                  │  - csm_accounts map   │
│  + Amplitude MCP   │                  │  - slack_convo_history│
└────────┬───────────┘                  └───────────────────────┘
         │
         ▼ (Claude decides which tools to call)
┌────────────────────────────────────────────────────────────────┐
│                       Tool Layer                               │
│                                                                │
│  get_hubspot_account()    → HubSpot REST API                  │
│  get_zendesk_summary()    → Zendesk REST API                  │
│  get_intercom_summary()   → Intercom REST API                  │
│  search_ticket_history()  → Azure AI Search (vector)          │
│  [Amplitude data]         → Amplitude MCP via mcp_servers     │
└────────────────────────────────────────────────────────────────┘
```

---

## 3. Data Sources & Tool Design

### Approach: Smart Summarization (Not Raw Data Dumps)

Each tool returns a pre-aggregated summary (~500 tokens total across all tools), not raw records. This keeps per-query cost near **$0.005** regardless of account size.

| Source | Tool | Returns |
|--------|------|---------|
| HubSpot | `get_hubspot_account()` | ARR, renewal date, owner, last CSM contact, contract tier, open opportunities |
| Zendesk | `get_zendesk_summary()` | Open ticket count, critical count, avg resolution time, CSAT (90d), oldest open ticket age |
| Intercom | `get_intercom_summary()` | Conversation count (30d), unresolved count, sentiment, last contact date |
| Amplitude | Amplitude MCP (official) | DAU/WAU trend (28d), feature adoption breadth, last login, cohort activity |
| Azure AI Search | `search_ticket_history()` | Top 5 semantically relevant ticket/conversation excerpts |

### Vector Search (Hybrid Layer)

Used only when a CSM asks about specific issues, feature complaints, or past conversations — not for standard Q&A.

- **Nightly sync:** Pull last 12 months of Zendesk tickets + Intercom conversations, chunk, embed, upsert to Azure AI Search
- **Embedding model:** `text-embedding-3-small` (Azure OpenAI) — cheapest, good quality
- **Index size estimate:** 100 accounts × 200 tickets avg = ~20k documents
- **Tier:** Azure AI Search Basic (~$73/month) or free tier if under 10k documents
- **Claude decides autonomously** when to call this tool vs. relying on summaries

### Amplitude MCP Integration

Amplitude's official MCP server (25+ tools) is passed to Claude via the Anthropic API `mcp_servers` parameter. This provides segmentation, funnels, retention, and cohort queries without writing custom tool wrappers.

---

## 4. Account Management (MVP: CSV Import)

### Overview

For the MVP, the account roster (clients + CSM assignments) is seeded and maintained via CSV upload rather than a live HubSpot sync. This keeps the setup simple — no HubSpot owner API wiring required — while providing the data the system needs to route churn alerts to the right CSM.

Uploaded account records are stored in Azure Table Storage (`accounts` table). All other functions (churn scoring, Q&A, Slack alerts) read from this table as their source of truth for account-to-CSM mapping and external system IDs.

### CSV Format

| Column | Required | Description |
|--------|----------|-------------|
| `account_name` | ✅ | Display name; also used as the Amplitude company identifier |
| `csm_name` | ✅ | Full name of the assigned CSM |
| `csm_slack_id` | ✅ | Slack member ID (e.g. `U012AB3CD`) — used to DM the CSM |
| `csm_email` | ✅ | CSM email address |
| `hubspot_company_id` | optional | HubSpot company ID for CRM lookup |
| `zendesk_org_id` | optional | Zendesk organization ID for support lookup |
| `intercom_company_id` | optional | Intercom company ID for conversation lookup |
| `arr` | optional | Annual Recurring Revenue (USD) — used when not pulling from HubSpot |
| `renewal_date` | optional | ISO date `YYYY-MM-DD` — used when not pulling from HubSpot |

Example CSV:
```
account_name,csm_name,csm_slack_id,csm_email,hubspot_company_id,zendesk_org_id,intercom_company_id,arr,renewal_date
Acme Corp,Jane Smith,U012AB3CD,jane@logicsoftware.com,123456,7890,abc123,48000,2026-05-01
Globex Inc,Jane Smith,U012AB3CD,jane@logicsoftware.com,234567,8901,,72000,2026-08-15
Initech,Mike Lee,U098ZY7WX,mike@logicsoftware.com,,,def456,24000,2026-04-10
```

### Upload Flow

1. CSM admin uploads CSV via the Web UI (Portfolio page → "Manage Accounts" → "Upload CSV")
2. Frontend sends `POST /api/accounts/import` with the CSV file as `multipart/form-data`
3. Backend parses and validates each row with Zod
4. Valid rows are upserted to Azure Table Storage (`PartitionKey = account_name`, `RowKey = account_name`)
5. Rows with validation errors are returned in the response so the admin can fix them
6. A summary response is returned: `{ imported: N, skipped: M, errors: [...] }`

### Azure Table Storage Schema (`accounts` table)

| Field | Type | Notes |
|-------|------|-------|
| `PartitionKey` | string | `"accounts"` (fixed) |
| `RowKey` | string | Slugified `account_name` (e.g. `acme-corp`) |
| `accountName` | string | Display name |
| `csmName` | string | |
| `csmSlackId` | string | |
| `csmEmail` | string | |
| `hubspotCompanyId` | string | Empty string if not provided |
| `zendeskOrgId` | string | Empty string if not provided |
| `intercomCompanyId` | string | Empty string if not provided |
| `arr` | number | 0 if not provided |
| `renewalDate` | string | ISO date or empty |
| `createdAt` | string | ISO timestamp of first import |
| `updatedAt` | string | ISO timestamp of last upsert |

### Replacing / Updating Accounts

- Uploading a CSV with the same `account_name` overwrites the existing record (upsert)
- To remove an account, a future enhancement can add a "Delete account" button in the UI; for MVP, unused accounts are simply ignored by the churn scorer

### How Other Components Use This Table

| Component | Usage |
|-----------|-------|
| `ChurnScoreJob` | Iterates all rows → scores each account → groups by `csmSlackId` for Slack DMs |
| `GET /api/accounts` | Reads all rows, merges with latest churn scores |
| `GET /api/accounts/:id` | Reads single row to get external system IDs for tool calls |
| `POST /api/ask` | Uses `hubspotCompanyId`, `zendeskOrgId`, `intercomCompanyId` to scope tool calls |
| `SlackEvents` | Resolves incoming Slack user → CSM → their account list |

---

## 5. Churn Scoring Algorithm

Score range: **0–100**. Computed nightly per account.

```
Churn Score = Amplitude (60%) + Support Health (30%) + CRM Context (10%)
```

### Amplitude Signals (60 pts)

| Signal | Max | Logic |
|--------|-----|-------|
| DAU/WAU trend (28d) | 25 | >+10% = 25 · flat = 15 · -10% to -30% = 8 · <-30% = 0 |
| Feature adoption breadth | 20 | % of licensed features used in last 30d, linear scale |
| Last active user login | 15 | <7d = 15 · 7–14d = 10 · 14–30d = 5 · >30d = 0 |

### Support Health Signals (30 pts)

| Signal | Max | Logic |
|--------|-----|-------|
| Open critical tickets | 15 | 0 = 15 · 1 = 10 · 2 = 5 · 3+ = 0 |
| CSAT score (last 90d) | 10 | Linear scale 1–5 → 0–10 pts |
| Unresolved ticket age | 5 | No ticket >14d old = 5 · else 0 |

### CRM Context Signals (10 pts)

| Signal | Max | Logic |
|--------|-----|-------|
| Days to renewal | 5 | >90d = 5 · 30–90d = 3 · <30d = 1 |
| Days since last CSM contact | 5 | <14d = 5 · 14–30d = 3 · >30d = 0 |

### Risk Tiers

| Score | Tier |
|-------|------|
| 80–100 | ✅ Healthy |
| 60–79 | 🟡 Watch |
| 40–59 | 🟠 At Risk |
| 0–39 | 🔴 Critical |

---

## 6. Daily Churn Alert (7am Timer)

The `ChurnScoreJob` Azure Timer Function runs daily at 7am and:

1. Computes scores for all accounts
2. Groups accounts by CSM (from `accounts` Table Storage, populated via CSV import)
3. Compares today's score to yesterday's (stored in Azure Table Storage)
4. Sends one Slack DM per CSM — only if accounts dropped a tier or are 🔴 Critical
5. Skips CSMs with no at-risk changes (no noise)

**Example DM:**
```
Good morning! 3 accounts need your attention today:

🔴 Acme Corp — Score dropped from 58 → 31
   ↘ Usage down 41% this week, 2 critical tickets open

🟠 Globex Inc — Score dropped from 72 → 52
   ↘ No logins in 18 days

🟡 Initech — Renewal in 22 days, last contact 31 days ago
```

---

## 7. Web UI

**Stack:** React + Vite + TypeScript + Tailwind CSS
**Hosting:** Azure Static Web Apps (free tier, auto-deploys from git)
**Auth:** Azure Static Web Apps built-in SSO (Microsoft/Google)

### View 1: Portfolio Dashboard (home)
```
┌─────────────────────────────────────────────────────────┐
│  CS Copilot          [Search accounts...]    [Vadim ▾]  │
├─────────────────────────────────────────────────────────┤
│  My Accounts (14)   Filter: [All ▾]  [Sort ▾]  [Upload CSV ↑]│
│                                                         │
│  🔴 Acme Corp          Score: 31  ↘ -27  Renewal: 22d  │
│  🟠 Globex Inc         Score: 52  ↘ -20  Renewal: 67d  │
│  🟡 Initech            Score: 74  →  +2  Renewal: 91d  │
│  ✅ Umbrella Corp      Score: 88  ↗  +5  Renewal: 180d │
└─────────────────────────────────────────────────────────┘
```

### View 2: Account 360° + Chat Panel
```
┌──────────────────────────────┬──────────────────────────┐
│  ← Acme Corp          🔴 31  │  Ask anything about      │
│  ─────────────────────────── │  Acme Corp...            │
│  USAGE (Amplitude)           │                          │
│  DAU trend: ↘ -41% (28d)    │  CSM: What's causing     │
│  Features used: 3/12         │  the usage drop?         │
│  Last login: 2d ago          │                          │
│                              │  Bot: Based on Amplitude,│
│  SUPPORT                     │  the drop started Feb 10.│
│  Open tickets: 2 critical    │  Zendesk shows 2 critical│
│  CSAT: 2.8/5 (last 90d)     │  tickets opened that week│
│  Oldest open: 18d            │  about the API           │
│                              │  integration...          │
│  CRM                         │                          │
│  ARR: $48,000                │                          │
│  Renewal: Mar 18 (22d)       │                          │
│  Last contact: 31d ago       │                          │
└──────────────────────────────┴──────────────────────────┘
```

### View 3: Search Results
Triggered from the top search bar. Returns matching accounts ranked by relevance + health score.

---

## 8. Slack Bot

**Libraries:**
- `@slack/bolt` — official Slack SDK, handles DMs and slash commands
- `bolt-azure-functions-receiver` — adapts Bolt to Azure Functions HTTP triggers
- `@anthropic-ai/sdk` — Claude API calls
- Conversation memory: Slack `conversations.history` API (last 10 messages before each call)

**Interaction flow:**
```
Slack DM → Azure Function HTTP trigger
         → bolt-azure-functions-receiver validates request
         → Bolt handles message event
         → Fetch last 10 messages via conversations.history
         → Call Claude with history + account tools
         → Post reply via Bolt
```

**Features:**
- Conversational DMs with full account Q&A
- `/csm [company name]` slash command for quick lookup
- Proactive morning alert DMs from `ChurnScoreJob`

**Out of scope for v1:**
- No group channel monitoring
- No write-back to HubSpot/Zendesk
- No Slack Block Kit rich formatting (plain text)

---

## 9. Project Structure

```
d:/Logic Software/AI/
└── cs-copilot/
    ├── backend/                        ← Azure Functions app
    │   ├── src/
    │   │   ├── functions/
    │   │   │   ├── AskAccount.ts       ← POST /api/ask
    │   │   │   ├── GetAccounts.ts      ← GET /api/accounts
    │   │   │   ├── GetAccount.ts       ← GET /api/accounts/:id
    │   │   │   ├── ImportAccounts.ts   ← POST /api/accounts/import (CSV upload)
    │   │   │   ├── SlackEvents.ts      ← POST /api/slack/events
    │   │   │   └── ChurnScoreJob.ts    ← Timer, daily 7am
    │   │   ├── tools/
    │   │   │   ├── hubspot.ts
    │   │   │   ├── zendesk.ts
    │   │   │   ├── intercom.ts
    │   │   │   └── vectorSearch.ts
    │   │   ├── services/
    │   │   │   ├── claude.ts
    │   │   │   ├── churnScorer.ts
    │   │   │   ├── accountStore.ts     ← Table Storage CRUD for accounts
    │   │   │   └── slackBot.ts
    │   │   └── types.ts
    │   ├── host.json
    │   ├── local.settings.json
    │   └── package.json
    │
    └── frontend/                       ← React/Vite app
        ├── src/
        │   ├── pages/
        │   │   ├── Portfolio.tsx       ← includes CSV upload button
        │   │   ├── Account.tsx
        │   │   └── Search.tsx
        │   ├── components/
        │   │   ├── HealthBadge.tsx
        │   │   ├── ChatPanel.tsx
        │   │   ├── AccountCard.tsx
        │   │   └── CsvImportModal.tsx  ← file picker + import result summary
        │   └── services/
        │       └── api.ts
        ├── index.html
        ├── vite.config.ts
        └── staticwebapp.config.json
```

---

## 10. Build Sequence

### Phase 0 — Account Seeding (MVP prerequisite)
1. `accountStore.ts` service — Table Storage read/write for accounts
2. `POST /api/accounts/import` — CSV parse, validate (Zod), upsert to Table Storage
3. `CsvImportModal.tsx` frontend component + Portfolio page integration
4. Verify: upload a test CSV, confirm records appear in Table Storage

### Phase 1 — Data Plumbing
5. HubSpot, Zendesk, Intercom connector tools (returning summaries)
6. Amplitude via official MCP in Claude API calls
7. `ChurnScoreJob` timer function — compute + store scores (reads accounts from Table Storage)
8. Verify: run job manually, check scores in Table Storage

### Phase 2 — Backend APIs
9. `GET /api/accounts` — portfolio with scores
10. `GET /api/accounts/:id` — 360° account data
11. `POST /api/ask` — Claude Q&A with tools
12. Verify: test each endpoint with curl

### Phase 3 — Web UI
13. Portfolio page
14. Account 360° page + chat panel
15. Deploy to Azure Static Web Apps

### Phase 4 — Slack
16. Bolt setup with `bolt-azure-functions-receiver`
17. DM handler wired to Claude
18. Proactive alert DMs from `ChurnScoreJob`
19. `/csm` slash command

### Phase 5 — Vector Search
20. Nightly ticket sync → Azure AI Search
21. `search_ticket_history()` tool wired into Claude

---

## 11. Environment Variables

```
ANTHROPIC_API_KEY
HUBSPOT_ACCESS_TOKEN
ZENDESK_SUBDOMAIN
ZENDESK_EMAIL
ZENDESK_TOKEN
INTERCOM_TOKEN
AMPLITUDE_API_KEY
AMPLITUDE_SECRET_KEY
SLACK_BOT_TOKEN
SLACK_SIGNING_SECRET
AZURE_SEARCH_ENDPOINT
AZURE_SEARCH_API_KEY
AZURE_STORAGE_CONNECTION_STRING
AZURE_STORAGE_TABLE_NAME_ACCOUNTS   # e.g. "accounts"
AZURE_STORAGE_TABLE_NAME_SCORES     # e.g. "churnscores"
```

---

## 12. Cost Estimate (Monthly)

| Item | Cost |
|------|------|
| Azure Functions (consumption plan) | ~$0–5 |
| Azure Static Web Apps | Free |
| Azure Table Storage | ~$1 |
| Azure AI Search Basic | ~$73 |
| Claude API (Haiku for scoring, Sonnet for Q&A) | ~$20–50 |
| Amplitude MCP | Included in Amplitude plan |
| **Total** | **~$95–130/month** |

Drops to ~$25/month if Azure AI Search free tier is sufficient (<10k documents).
