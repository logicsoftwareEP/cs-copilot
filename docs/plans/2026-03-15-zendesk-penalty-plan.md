# Zendesk Ticket Penalty for CS Copilot Health Scores

## Context

The CS Copilot health score currently uses only Amplitude product analytics (engagement, licence utilisation, feature adoption). A customer can score "healthy" while drowning the support team in tickets. Adding Zendesk data as a **penalty deduction** (0 to -20 pts) corrects this blind spot — high support load pulls the score down even if product usage is strong.

Zendesk instance: `helpeasyprojects.zendesk.com` (custom domain: `help.birdviewpsa.com`).

Tickets are matched to accounts by **requester email domain** (e.g. all tickets from `*@acme.com` belong to the Acme account). This requires a `domain` field on each account (auto-synced from HubSpot).

---

## Scoring Design

**Penalty applied after normalisation** — the existing Amplitude score (0-100) is computed first, then the Zendesk penalty is subtracted. Final score = `max(0, amplitudeScore - penalty)`. Tier is re-derived from the adjusted score.

| Sub-signal | Condition | Penalty |
|---|---|---|
| **Ticket volume** (last 30d) | 0-2 | 0 |
| | 3-5 | -3 |
| | 6-10 | -5 |
| | 11+ | -8 |
| **Open tickets** (unresolved) | 0 | 0 |
| | 1-2 | -2 |
| | 3-5 | -4 |
| | 6+ | -7 |
| **Severity** (urgent/high in 30d) | None | 0 |
| | 1-2 high | -2 |
| | Any urgent OR 3+ high | -5 |

Total penalty = sum of three sub-signals, **capped at -20**. Accounts without a domain get no penalty (null).

> **Deferred:** Sentiment analysis via Claude Haiku (4th sub-signal, up to -5 pts) — see TODOS.md.

---

## Architecture

```
  ┌──────────────┐     ┌──────────────┐     ┌──────────────────┐
  │   HubSpot    │     │  Amplitude   │     │     Zendesk      │
  │  CRM API     │     │  Segment API │     │  Search API      │
  └──────┬───────┘     └──────┬───────┘     └────────┬─────────┘
         │                    │                      │
         ▼                    ▼                      ▼
  ┌─────────────────────────────────────────────────────────────┐
  │                     SyncRunner.runSync()                     │
  │  1. Fetch HubSpot companies (with domain)                   │
  │  2. Upsert accounts                                         │
  │  3. Build Zendesk data map (per unique domain)               │
  │     - Sequential with 600ms delay (rate limit: 100 req/min)  │
  │     - Auth failure (401) on first call → skip remaining      │
  │     - Pagination capped at 5 pages (500 tickets) per domain  │
  │  4. For each account:                                        │
  │     a. Fetch Amplitude signals                               │
  │     b. computeScore() → base score                           │
  │     c. applyZendeskPenalty() → adjusted score                │
  │     d. Upsert score                                          │
  └──────────────────────────┬──────────────────────────────────┘
                             │
                             ▼
  ┌─────────────────────────────────────────────────────────────┐
  │              Azure Table Storage                             │
  │  accounts        │ amplitudemapping │ churnscores            │
  │  (+domain)       │                  │ (+zendeskPenalty,       │
  │                  │                  │  +zendeskDetails)       │
  └──────────────────────────┬──────────────────────────────────┘
                             │
                             ▼
  ┌─────────────────────────────────────────────────────────────┐
  │           AccountsApi                                        │
  │           GET /api/accounts — list with penalties             │
  │           GET /api/accounts/{id} — detail with breakdown     │
  └──────────────────────────┬──────────────────────────────────┘
                             │
                             ▼
  ┌─────────────────────────────────────────────────────────────┐
  │           React Frontend (Portfolio.tsx)                      │
  │           Detail panel: 4th card "Support Load"              │
  │           null penalty → "N/A" | 0 penalty → "No issues"    │
  └─────────────────────────────────────────────────────────────┘
```

### Error Handling Strategy

```
  Zendesk API Call per domain:
  ─────────────────────────────
  HAPPY:  Search → tickets[] → count/filter → ZendeskTicketData → penalty
  NIL:    Account has no domain → skip Zendesk entirely → penalty = null
  EMPTY:  Domain exists but returns 0 tickets → penalty = 0 (clean)
  ERROR:  Zendesk API fails (401/429/500/timeout) → log warning → return null
          (null = "couldn't check", NOT zeros = "checked, clean")
  AUTH:   First call returns 401 → log ONCE → skip all remaining domains
```

---

## Implementation Steps

### 1. Add `domain` field to accounts

**`backend/src/types.ts`** — add `domain: string;` to `HubspotAccount`

**`backend/src/clients/hubspotClient.ts`** — add `'domain'` to the HubSpot search properties array; map `domain: result.properties.domain ?? ''`

**`backend/src/services/accountStore.ts`**:
- Add `domain?: string` to `AccountEntity`
- In `toEntity()`: only write domain when non-empty (same pattern as ARR — preserve manual entries)
- In `fromEntity()`: `domain: entity.domain ?? ''`

**`frontend/src/types.ts`** — add `domain: string` to `HubspotAccount`

### 2. Add Zendesk fields to ChurnScore

**`backend/src/types.ts`** — add to `ChurnScore`:
```
zendeskPenalty: number | null;      // 0 to -20; null = no domain or API error
zendeskDetails: string | null;      // JSON: ticket breakdown
```

**`backend/src/services/scoreStore.ts`** — add both fields to `ScoreEntity`, `fromEntity()`, and `upsertScore()`

**`frontend/src/types.ts`** — add to `ScoreBreakdown`:
```
zendeskPenalty: number | null;
zendeskDetails: { ticketVolume: number; openCount: number; highPriorityCount: number; urgentCount: number } | null;
```

### 3. Zendesk client (new file)

**`backend/src/clients/zendeskClient.ts`**

```typescript
export interface ZendeskTicketData {
  ticketVolume: number;
  openCount: number;
  highPriorityCount: number;
  urgentCount: number;
}

export async function fetchZendeskTickets(
  subdomain: string, email: string, apiToken: string, domain: string
): Promise<ZendeskTicketData | null>
```

- Auth: Basic `{email}/token:{apiToken}` (use `Buffer.from().toString('base64')`)
- **Two queries per domain:**
  - Query 1 (volume + severity): `GET /api/v2/search.json?query=type:ticket requester:*@{encodeURIComponent(domain)} created>{30d_ago}` — counts total tickets and high/urgent priority
  - Query 2 (open tickets): `GET /api/v2/search.json?query=type:ticket requester:*@{encodeURIComponent(domain)} status:open status:pending status:new` — counts ALL currently open tickets regardless of creation date
- **URL-encode the domain** to prevent special character issues
- Handle pagination (`next_page`) — **cap at 5 pages (500 tickets)** per query to prevent runaway pagination
- Count from query 1: total (volume), priority `high`, priority `urgent`. Count from query 2: open/pending/new (open count)
- **On error: log warning, return `null`** (null = "couldn't check", not zeros = "checked, clean")

### 4. Config

**`backend/src/config.ts`** — add optional env vars:
```
zendeskSubdomain: process.env.ZENDESK_SUBDOMAIN ?? null     // 'helpeasyprojects'
zendeskEmail: process.env.ZENDESK_EMAIL ?? null
zendeskApiToken: process.env.ZENDESK_API_TOKEN ?? null
```

### 5. Scoring function

**`backend/src/services/healthScoreService.ts`**

- Keep existing `computeScore()` unchanged
- Add `ZendeskPenaltyResult` interface: `{ totalPenalty: number; volumePenalty: number; openPenalty: number; severityPenalty: number; ticketVolume: number; openCount: number; highPriorityCount: number; urgentCount: number }`
- Add `computeZendeskPenalty(data: ZendeskTicketData): ZendeskPenaltyResult` — computes 3 sub-penalties (volume, open, severity), sums and caps at -20. Returns structured result with both sub-penalties and raw counts (single computation used for both score and `zendeskDetails` JSON — avoids DRY violation)
- Add `applyZendeskPenalty(baseResult: HealthScoreResult, zendeskData: ZendeskTicketData | null): HealthScoreResult` — applies penalty, clamps score to 0, re-derives tier

### 6. Update host.json

**`backend/host.json`** — set `functionTimeout` to `"00:10:00"` to accommodate the added Zendesk fetch phase (~4 min with 600ms delay × 195 domains).

### 7. SyncRunner integration

**`backend/src/functions/SyncRunner.ts`**

- Add `zendeskFetched: number` to `SyncResult` interface for observability
- Check `zendeskEnabled = !!(config.zendeskSubdomain && config.zendeskEmail && config.zendeskApiToken)`
- Before the scoring loop: build `Map<domain, ZendeskTicketData | null>` by fetching once per unique domain (deduplicates shared domains)
  - Sequential calls with **600ms delay** between domains to stay within Zendesk's 100 req/min limit
  - **Auth failure short-circuit:** if first call returns 401, log once and skip all remaining domains
- Log Zendesk phase summary: `Zendesk: fetched {n}/{total} domains, {errors} errors, {skipped} no-domain`
- In the per-account loop: look up Zendesk data by `storedAccount.domain`, call `applyZendeskPenalty()`, write `zendeskPenalty` and `zendeskDetails` to score entity
- **Unmapped accounts also get Zendesk penalty:** even when no Amplitude alias exists, write `zendeskPenalty` and `zendeskDetails` to the placeholder score so CSMs see support load signal before Amplitude is mapped
- Both placeholder score writes (unmapped branch + error catch) must include `zendeskPenalty` and `zendeskDetails` fields

### 8. AccountsApi updates

**`backend/src/functions/AccountsApi.ts`**

- GET detail: add `zendeskPenalty` and `zendeskDetails` to `scoreBreakdown` response

> **Deferred:** PATCH handler for domain editing — see TODOS.md.

### 9. Frontend — penalty card

**`frontend/src/pages/Portfolio.tsx`**

- Add `zendeskPenaltyInfo()` helper → returns `{ pts, label, detail, hint }` for the penalty
  - `null` → "N/A" (Zendesk not configured or no domain)
  - `0` → "No issues" (green)
  - `-1 to -9` → "Minor" (warning/amber)
  - `-10 to -20` → "High" (red)
- Add 4th breakdown card in detail panel: "Support Load" — shows penalty as negative deduction with ticket breakdown
- Use red/warning colour when penalty is active, green when clean

> **Deferred:** Domain column with inline editing, domain column sorting — see TODOS.md.

### 10. Tests

**New: `backend/src/__tests__/services/zendeskPenalty.test.ts`** — test `computeZendeskPenalty` thresholds, boundary values (2→3, 5→6, 10→11), and capping at -20

**New: `backend/src/__tests__/clients/zendeskClient.test.ts`** — mock fetch, test parsing, pagination, pagination cap at 5 pages, auth failure (401) returns null, API error returns null (not zeros)

**Update: `backend/src/__tests__/services/healthScoreService.test.ts`** — test `applyZendeskPenalty`: null passthrough, penalty application, score clamping to 0, tier re-derivation

**Update: `backend/src/__tests__/services/SyncRunner.test.ts`** — add 4 tests:
- "sync with Zendesk enabled applies penalties"
- "sync with Zendesk disabled skips penalty phase"
- "unmapped account with domain still gets zendeskPenalty"
- "Zendesk auth failure (401) on first domain skips remaining domains"

### 11. Deploy

- Set Azure app settings: `ZENDESK_SUBDOMAIN=helpeasyprojects`, `ZENDESK_EMAIL`, `ZENDESK_API_TOKEN`
- Build + deploy backend + frontend
- Trigger sync to verify

---

## Files to modify

| File | Change |
|---|---|
| `backend/src/types.ts` | Add `domain` to HubspotAccount, Zendesk fields to ChurnScore |
| `backend/src/config.ts` | Add 3 Zendesk env vars |
| `backend/src/clients/hubspotClient.ts` | Sync `domain` property |
| `backend/src/clients/zendeskClient.ts` | **New** — Zendesk API client |
| `backend/src/services/accountStore.ts` | Add `domain` to entity mapping |
| `backend/src/services/scoreStore.ts` | Add `zendeskPenalty`, `zendeskDetails` |
| `backend/src/services/healthScoreService.ts` | Add `computeZendeskPenalty()` + `applyZendeskPenalty()` |
| `backend/host.json` | Set `functionTimeout` to `00:10:00` |
| `backend/src/functions/SyncRunner.ts` | Integrate Zendesk fetch + penalty + `zendeskFetched` counter |
| `backend/src/functions/AccountsApi.ts` | Expose Zendesk breakdown in detail response |
| `frontend/src/types.ts` | Mirror backend type changes |
| `frontend/src/pages/Portfolio.tsx` | Penalty breakdown card in detail panel |

## Verification

1. `cd backend && npm run build && npm test` — all tests pass including new Zendesk tests
2. Set Zendesk env vars locally, run `npm start`, trigger sync via `POST /api/sync`
3. Check a known account with tickets — verify penalty appears in score breakdown
4. Open frontend, verify penalty card shows in detail panel with correct null/0/active states
5. Deploy to Azure, set app settings, trigger sync, verify on live site

## Review Changes (2026-03-15 CEO plan review)

Changes from the original plan based on SCOPE REDUCTION review:

1. **Dropped sentiment analysis** — removed Claude API dependency, 4th sub-signal, ~$2/sync cost
2. **Dropped inline-editable domain column** — domain auto-syncs from HubSpot; manual editing deferred
3. **Zendesk client returns `null` on error**, not zeros — null = "couldn't check", 0 = "checked, clean"
4. **Added pagination cap** — max 5 pages (500 tickets) per domain to prevent runaway pagination
5. **Added auth failure short-circuit** — 401 on first call logs once and skips remaining domains
6. **Added 600ms delay** between domain calls for rate limiting (100 req/min)
7. **URL-encode domain** in Zendesk search query to prevent special character issues
8. **Set `functionTimeout: "00:10:00"`** in host.json — prevents timeout with added Zendesk phase
9. **Added `zendeskFetched` counter** to SyncResult for observability
10. **Frontend: null = "N/A", 0 = "No issues"** — distinct display states
11. **Added 2 SyncRunner tests** — Zendesk enabled and disabled scenarios
12. **Created TODOS.md** with 3 deferred items

## Review Changes (2026-03-15 Eng plan review)

Changes from the eng manager review, applied on top of CEO review:

1. **Unmapped accounts get Zendesk penalty** — even without Amplitude alias, write zendeskPenalty/Details to placeholder score so CSMs see support load signal
2. **`computeZendeskPenalty` returns structured result** — `ZendeskPenaltyResult` with sub-penalties + raw counts. Single computation used for both score and `zendeskDetails` JSON (DRY)
3. **Two queries per domain** — Query 1 (`created>{30d}`) for volume + severity; Query 2 (`status:open/pending/new`) for ALL open tickets regardless of creation date. Old unresolved tickets are caught.
4. **3 additional tests** — unmapped account with penalty, auth short-circuit (401), AccountsApi detail response includes penalty. Total: 4 new SyncRunner tests (was 2)
5. **Both placeholder score writes** (unmapped branch + error catch) include `zendeskPenalty` and `zendeskDetails` fields
