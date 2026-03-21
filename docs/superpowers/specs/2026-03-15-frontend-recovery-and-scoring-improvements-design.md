# Frontend Recovery + Scoring Improvements — Design Spec

## Overview

Three changes to CS Copilot (items 2 and 3 from the original brief are now merged into a single Amplitude simplification):

1. **Recover stashed frontend** — restore inline alias/ARR editing, dark theme, no separate mapping page
2. **Amplitude simplification** — replace daily DAU/WAU trend with 30-day MAU comparison. Weekend-immune, simpler, fewer API calls
3. **Top 10 accounts needing review** — critical/at-risk accounts sorted by ARR at page top

---

## 1. Recover Stashed Frontend

### What was lost
The merge of `feature/zendesk-penalty` into `master` overwrote uncommitted frontend changes from prior sessions. The stash (`stash@{0}`) contains the correct versions:

- `Portfolio.tsx` — 961-line dark-theme version with inline alias editing, inline ARR editing, custom Tailwind dark theme classes (`obs-*`), sparklines, metric cards
- `App.tsx` — mapping route redirects to `/` (no separate Mapping page)
- `index.css` — custom CSS for dark theme
- `tailwind.config.js` — custom colour palette and animations

### Approach
1. Restore the stashed `Portfolio.tsx`, `App.tsx`, `index.css`, `tailwind.config.js`
2. Merge in the Zendesk penalty additions from the current branch:
   - `zendeskPenaltyInfo()` helper function
   - 4th breakdown card "Support Load" in the detail panel
   - `ZendeskDetails` type usage
3. The stashed version uses `featuresUsed` / `featureDetails` in `ScoreBreakdown` — update to match current backend types which now include `zendeskPenalty`, `zendeskDetails`, and `domain`
4. Ensure `updateAccountArr` function exists in `api.ts` (for inline ARR editing via PATCH endpoint)
5. Ensure PATCH endpoint in `AccountsApi.ts` accepts `{ arr }` in addition to `{ licenses }`

### Files changed
- `frontend/src/pages/Portfolio.tsx` — restore from stash + add Zendesk card
- `frontend/src/App.tsx` — restore from stash (redirect /mapping to /)
- `frontend/src/index.css` — restore from stash
- `frontend/tailwind.config.js` — restore from stash
- `frontend/src/services/api.ts` — add `updateAccountArr()` if missing
- `backend/src/functions/AccountsApi.ts` — accept `arr` in PATCH body

---

## 2. Amplitude Simplification (replaces weekend filtering + rolling average)

### Problem
The current DAU/WAU trend fetches 28 daily data points (`i=1, m=totals`), splits into 14-day halves, and compares averages. This is affected by weekends (B2B users don't work weekends) and produces noisy daily fluctuations.

### Solution
Replace the daily fetch with two 30-day aggregated MAU queries:
- **Current 30-day MAU**: already fetched via `fetchMonthlyActiveUsers()` (`i=30, m=uniques`)
- **Prior 30-day MAU**: new call, same parameters but date range shifted back 30 days

**Trend** = `(currentMAU - priorMAU) / priorMAU`

This is:
- **Weekend-immune**: 30-day unique users don't care what day of the week people logged in
- **Simpler**: 1 extra API call instead of 28 daily data points
- **More meaningful**: counts unique users, not total events

### Scoring impact
The "DAU/WAU trend" component (0-40 pts) becomes "MAU trend" (0-40 pts) with the same thresholds:
- `trend >= 0.1` → 40 pts (growing)
- `trend > -0.1` → 25 pts (stable)
- `trend >= -0.3` → 10 pts (declining)
- `else` → 0 pts (critical decline)

### No `rollingAvg30d` field needed
Since the score itself is now based on 30-day aggregates from Amplitude, it's inherently a 30-day rolling average. No need for a separate stored field.

### `fetchDauWauTrend` replacement

```typescript
async function fetchMauTrend(
  apiKey: string, secretKey: string, alias: string, accountProperty: string
): Promise<number | null> {
  // Fetch current 30-day MAU (days 1-30 ago)
  const currentMAU = await fetchMonthlyActiveUsers(apiKey, secretKey, alias, accountProperty);
  // Fetch prior 30-day MAU (days 31-60 ago) — same function, shifted dates
  const priorMAU = await fetchPriorMonthlyActiveUsers(apiKey, secretKey, alias, accountProperty);

  if (currentMAU === null || priorMAU === null || priorMAU === 0) return null;
  return (currentMAU - priorMAU) / priorMAU;
}
```

### Files changed
- `backend/src/clients/amplitudeClient.ts` — replace `fetchDauWauTrend()` with `fetchMauTrend()`, add `fetchPriorMonthlyActiveUsers()`
- `backend/src/services/healthScoreService.ts` — rename references from `dauWauTrend` to `mauTrend` in comments (the field name stays `dauWauTrend` for backwards compat with stored scores)
- `backend/src/types.ts` — add comment clarifying `dauWauTrend` now represents MAU trend
- Tests — update test descriptions, no logic changes needed (thresholds unchanged)

### Backwards compatibility
The `ChurnScore.dauWauTrend` field name stays the same to avoid breaking stored data in Azure Table Storage. Only the internal computation changes. Comments/labels updated to say "MAU trend."

---

## 3. Top 10 Accounts Needing Review

### Problem
CSMs need to quickly see which high-value accounts are in trouble. Currently they must scan the full table.

### Approach
Frontend-only. At the top of the Portfolio page, above the main table, display a "Needs Review" section:
- Filter accounts where tier is `critical` or `at-risk`
- Sort by ARR descending
- Take top 10
- Display as compact cards showing: account name, tier badge, score, ARR, CSM
- Click a card to open the detail panel

If no accounts are critical/at-risk, hide the section entirely.

### Files changed
- `frontend/src/pages/Portfolio.tsx` — add "Needs Review" section above the table

---

## Verification

1. `cd backend && npm run build && npm test` — all tests pass
2. `cd frontend && npm run build` — frontend compiles
3. Visual check: portfolio page shows dark theme, inline editing works, top 10 section appears
4. Deploy backend + frontend to Azure
