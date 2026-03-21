# Intercom Integration — Health Score Enhancement

**Date:** 2026-03-21
**Status:** Approved

## Overview

Incorporate Intercom chat history into CS Copilot health scoring. Intercom serves a dual role:
1. **Support penalty** — open/unresolved conversations and slow response times penalise the score (shared -20 cap with Zendesk)
2. **Engagement bonus** — quick resolutions, AI-handled conversations, and active-but-not-stuck accounts earn up to +10 bonus points above 100

## Account Matching

Match Intercom conversations to accounts by **email domain** — same strategy as Zendesk. Each conversation has contacts with email addresses; derive the domain and aggregate per account.

Contacts without email addresses are skipped. Generic domains (gmail.com, outlook.com, etc.) should be excluded.

## Intercom Client (`intercomClient.ts`)

### Authentication

Bearer token via `INTERCOM_ACCESS_TOKEN` env var. Added to `config.ts` as optional — when missing, Intercom scoring is skipped entirely (same pattern as Zendesk).

### Data Fetching — Incremental with Daily Snapshots

Rather than fetching 30 days of conversations on every sync, use incremental fetching with two queries:

1. **Incremental query:** Fetch conversations from the last ~36 hours (overlap for safety) via `POST /conversations/search` with `created_at` filter. Paginate at 50 per page. This captures new event-based metrics (volume, quick resolutions, AI-handled).
2. **Open conversations query:** Fetch conversations with `state = open` regardless of `created_at`. This is a point-in-time snapshot of currently unresolved conversations.
3. **Aggregate** per email domain. For each domain, store event-based counts from query 1 and point-in-time counts from query 2.
4. **Store** as one row per domain per date in `intercomscores` Table Storage table.
5. **At scoring time**, read last 30 daily rows per domain:
   - **Sum** across days: `conversationVolume`, `quickResolutions`, `aiHandled`
   - **Latest snapshot only**: `openCount` (point-in-time, not summable)
   - **Weighted average**: `avgResponseTime` computed as `sum(totalResponseTime) / sum(responseCount)` across 30 days
6. **First run** (no historical data): full 30-day backfill. After that, incremental only.
7. **Cleanup**: After each nightly sync, delete rows with `rowKey` older than 35 days.

### Output Shape — `IntercomData`

Per domain, aggregated from last 30 daily snapshots:

```typescript
interface IntercomData {
  conversationVolume: number;   // sum of conversations across 30d
  openCount: number;            // latest snapshot: state === 'open' (NOT summed)
  avgResponseTime: number;      // weighted average across 30d (seconds)
  quickResolutions: number;     // sum: closed with ≤2 reply rounds
  aiHandled: number;            // sum: ai_agent_participated === true
}
```

### API Details

- **Search:** `POST /conversations/search` — filter by `created_at` (incremental) or `state` (open snapshot), paginate with cursor
- **Rate limits:** 10,000 calls/min per app. At ~268 accounts with incremental fetching, expect only a handful of API calls per sync.
- **No direct company search** — conversations are grouped by contact email domain, not Intercom company object

## Storage

### New Table: `intercomscores`

| Field | Value |
|---|---|
| `partitionKey` | domain (e.g., `acme.com`) |
| `rowKey` | date (YYYY-MM-DD) |
| `conversationVolume` | number (event count for this day) |
| `openCount` | number (point-in-time snapshot) |
| `totalResponseTime` | number (seconds, sum for this day's conversations) |
| `responseCount` | number (conversations with response time data this day) |
| `quickResolutions` | number (event count for this day) |
| `aiHandled` | number (event count for this day) |

Cleanup: SyncRunner deletes rows older than 35 days after each nightly sync.

### Additions to `churnscores` Table

New columns (same pattern as existing `zendeskPenalty` / `zendeskDetails`):

| Column | Type | Description |
|---|---|---|
| `intercomPenalty` | number \| null | Computed Intercom penalty (0 to -12) |
| `intercomBonus` | number \| null | Computed engagement bonus (0 to +10) |
| `intercomDetails` | JSON string \| null | Raw Intercom data for the detail API |

## Scoring — Penalty (`computeIntercomPenalty`)

Two sub-components (no volume penalty — we don't penalise clients for communicating):

| Signal | Thresholds | Points | Max |
|---|---|---|---|
| Open/unresolved | 0: 0, 1–2: -2, 3–5: -4, 6+: -7 | -7 |
| Slow responses | avg response > 24h AND 3+ conversations: -5 | -5 |

**Max Intercom penalty: -12** (sum of -7 + -5).

### Combined Penalty Cap

Zendesk and Intercom penalties are computed independently, summed, and clamped:

```
totalPenalty = Math.max(zendeskPenalty + intercomPenalty, -20)
```

### New Function: `applyAllPenalties()`

Replaces `applyZendeskPenalty()` in both `SyncRunner.ts` and `AccountsApi.ts` (detail endpoint). Accepts base score result, Zendesk data (nullable), and Intercom data (nullable). Computes both penalties, enforces the shared -20 cap, adds engagement bonus, re-derives tier.

## Scoring — Engagement Bonus (`computeIntercomBonus`)

Uses Intercom conversation metadata to identify healthy engagement:

| Signal | Logic | Points |
|---|---|---|
| Quick resolutions | Closed, ≤2 reply rounds. ≥5 in 30d: +4, ≥3: +2, ≥1: +1 | 0–4 |
| AI-handled | `ai_agent_participated === true`. ≥3: +3, ≥1: +1 | 0–3 |
| Active engagement | Total conversations ≥3 AND open count ≤1 | 0–3 |

**Max bonus: +10.** Applied after penalties.

### Final Score Formula

```
finalScore = clamp(baseScore + totalPenalty + engagementBonus, 0, 110)
```

- Base score: 0–100 (licence utilisation 60 + activity trend 25 + feature adoption 15)
- Penalty: 0 to -20 (Zendesk + Intercom combined)
- Bonus: 0 to +10 (Intercom engagement)
- Theoretical range: 0–110

Note: The upper clamp at 110 is new — existing `applyZendeskPenalty` only clamps to 0. `scoreToTier()` needs no change (110 ≥ 80 → "healthy").

Tier thresholds unchanged: healthy ≥80, watch ≥60, at-risk ≥40, critical <40.

## SyncRunner Changes

Updated sync flow:

1. Fetch accounts from SQL Server
2. Fetch Amplitude signals per mapped account
3. Compute base health score (licence + activity + features)
4. Fetch Zendesk tickets (bulk, if configured)
5. **Fetch Intercom conversations (incremental + open snapshot, if configured)**
6. **Store daily Intercom snapshot in `intercomscores`**
7. **Read 30-day Intercom aggregates per account domain**
8. **`applyAllPenalties()` — combines Zendesk + Intercom penalty (cap -20) + engagement bonus**
9. Store final score in `churnscores` (including `intercomPenalty`, `intercomBonus`, `intercomDetails`)
10. **Cleanup: delete `intercomscores` rows older than 35 days**

## API Changes

### `GET /api/accounts/{id}` (detail)

Add `intercomDetails` to the response, alongside existing `zendeskDetails`. Data is read from the pre-computed `intercomDetails` column in `churnscores` (same pattern as Zendesk — no live API call on the detail endpoint).

```typescript
intercomDetails: {
  conversationVolume: number;
  openCount: number;
  avgResponseTime: number;
  quickResolutions: number;
  aiHandled: number;
  penalty: number;
  bonus: number;
} | null
```

The detail endpoint must also switch from `applyZendeskPenalty()` to `applyAllPenalties()` to ensure consistent scoring between the nightly sync and live detail views.

## Frontend — Side Panel

### Score Display

Score can now exceed 100 (max 110). The score bar remains 0–100 range; scores above 100 get a visual indicator (green glow or "+N" badge).

### New Breakdown Cards

**Intercom Support** (penalty card, same style as Zendesk):
- Shows: open count, avg response time, penalty points
- Color: green (0), yellow (≥-4), red (≥-8)

**Intercom Engagement** (bonus card, positive styling):
- Shows: quick resolutions, AI-handled, active engagement flag, bonus points
- Color: green (+7 to +10), blue (+1 to +6), grey (0)

### Existing Card Rename

Rename "Support Load" to "Zendesk Support" to distinguish from the new Intercom card. Show combined penalty cap note.

## Future: Troubleshooting Page

Separate follow-up after Intercom scoring is live:

- New route: `/troubleshoot`
- Displays all raw signal data per account: Amplitude signals, Zendesk ticket data, Intercom conversation data, and resulting score breakdown
- Admin-only access
- Useful for debugging why a specific account received its score

## Environment Variables

All optional (Intercom skipped when not configured):

| Variable | Purpose |
|---|---|
| `INTERCOM_ACCESS_TOKEN` | Bearer token for Intercom API |

## Dependencies

No new npm packages required — Intercom REST API uses standard `fetch`.

## Testing

### Unit Tests

- `computeIntercomPenalty()` — all threshold bands for open count and slow responses, including edge cases (exactly on boundary)
- `computeIntercomBonus()` — all three signals independently and combined, verify max cap at +10
- `applyAllPenalties()` — Zendesk-only, Intercom-only, both combined, verify shared -20 cap, verify bonus applied after penalty, verify upper clamp at 110
- Aggregation logic — verify `openCount` uses latest snapshot only, `avgResponseTime` is weighted, event counts are summed

### Mock-Based Tests

- `intercomClient.ts` — mock `POST /conversations/search` responses, verify domain grouping, verify generic domain exclusion, verify pagination handling
- SyncRunner integration — verify Intercom is skipped when `INTERCOM_ACCESS_TOKEN` is not set, verify incremental fetch + storage + aggregation + scoring pipeline
