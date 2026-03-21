# Alias Validation — Differentiate Mismatch from Zero Activity

**Date:** 2026-03-19
**Status:** Approved

## Problem

Accounts with mismatched Amplitude aliases (wrong casing, typos, non-existent values) receive a health score of 0 instead of being flagged as unmapped. This happens because Amplitude returns `series: [[0]]` for both "alias exists, zero activity" and "alias doesn't exist" — the scoring pipeline can't tell them apart.

The all-null guard in `healthScoreService.ts` only fires when all three signals are literally `null`. For a non-existent alias, Amplitude returns:
- `dauWauTrend = null` (the division-by-zero guard in `fetchMauTrend` fires because priorMAU is 0)
- `monthlyActiveUsers = 0` (not null — guard bypassed)
- `featureBreadth = { used: [], total: 12 }` (not null — guard bypassed)

Since `monthlyActiveUsers` and `featureBreadth` are non-null, the all-null guard does not trigger, scoring proceeds, and `rawScore = 0` → `score = 0` → tier = `critical`.

## Solution

Add an alias validation step during sync: when all Amplitude signals return zero, query Amplitude for any activity in the **last 365 days**. If the alias has had any historical activity, the zero score is genuine. If not, the alias is a mismatch — mark as unmapped with a `'not-found'` status.

## Design

### Alias Validation — Amplitude Client

New `validateAlias()` function in `amplitudeClient.ts`:
- Signature: `validateAlias(apiKey, secretKey, accountAlias, accountProperty) → Promise<boolean>`
- Queries `_active` events for the last 365 days with `i=30` (Amplitude's max bucket size)
- Returns `true` if any monthly bucket has > 0 users
- Returns `false` if all buckets are 0 (alias not recognized)
- One API call per invocation

Only called when all signals from `fetchSignals()` return zero — estimated ~10-20 accounts per sync.

### Data Model — `aliasStatus` field

New field on `ChurnScore` entity and type:

| Value | Meaning |
|---|---|
| `null` | No alias set (existing unmapped behavior) |
| `'valid'` | Alias confirmed in Amplitude (has historical activity) |
| `'not-found'` | Alias set but no users found in Amplitude |

**Backward compatibility:** Existing rows in `churnscores` table lack this column. `fromEntity()` must default to `null` using `entity.aliasStatus ?? null`, matching the existing pattern for nullable fields.

### SyncRunner Logic

After `fetchSignals()`, check if all signals are effectively zero using the `AmplitudeSignals` fields available to SyncRunner:

```
signals.dauWauTrend === null &&
signals.monthlyActiveUsers === 0 &&
signals.featureBreadth !== null && signals.featureBreadth.used.length === 0
```

If this condition is true, call `validateAlias()`:
- Not found → write `score: null, tier: 'unmapped', aliasStatus: 'not-found'` (mirrors existing no-alias placeholder path at SyncRunner lines 183-200)
- Found → proceed with normal scoring, `aliasStatus: 'valid'` (score will be 0, tier = critical)

Other paths:
- Normal scoring (non-zero signals) → `aliasStatus: 'valid'`
- No alias at all → `aliasStatus: null` (unchanged)

### AccountSummary Pass-through

`AccountsApi.ts` extracts `aliasStatus` from the score record and includes it in the `AccountSummary` response. This is the first score-metadata field on the list endpoint (existing fields from scores are `score`, `tier`, `scoreDelta`).

The detail endpoint (`getAccount`) also includes `aliasStatus` in its response.

### Frontend — Tooltip indicator

No new tier or badge. Minimal changes to `Portfolio.tsx`:

- **Table alias cell:** When `aliasStatus === 'not-found'`, alias text renders in warning color (orange/yellow) with tooltip: "Alias not found in Amplitude — check casing or wait for first activity"
- **Detail panel:** When alias is set but `aliasStatus === 'not-found'`, show "Alias not recognized by Amplitude" instead of "No Amplitude mapping"
- All other states unchanged

### API Call Impact

Validation call only fires when all signals are zero (~10-20 accounts per sync). Amplitude Segmentation API allows 360 req/hour; current sync uses ~2,730 calls. Additional 10-20 is negligible. The 365-day query with `i=30` returns ~12 monthly buckets in a single response.

### Edge Cases

- **Newly onboarded accounts** with a correct alias but no historical activity will be flagged as `not-found`. This is acceptable — the tooltip text includes "or wait for first activity" to cover this case. Once the account generates any Amplitude activity, the next sync will mark it `valid`.
- **Partial zero signals** (e.g., `monthlyActiveUsers === 0` but some features used): validation is NOT triggered — this is a legitimate state (active feature usage but no unique user count). Scoring proceeds normally.

## Files to Modify

| File | Change |
|---|---|
| `backend/src/clients/amplitudeClient.ts` | Add `validateAlias()` export |
| `backend/src/functions/SyncRunner.ts` | Call validation when all signals zero, write `aliasStatus` |
| `backend/src/services/scoreStore.ts` | Add `aliasStatus` to `ScoreEntity`, `fromEntity()` (with `?? null` default), and `upsertScore()` |
| `backend/src/types.ts` (backend) | Add `aliasStatus` to `ChurnScore` |
| `backend/src/functions/AccountsApi.ts` | Pass `aliasStatus` through in both list and detail responses |
| `frontend/src/types.ts` | Add `aliasStatus` to `ChurnScore` and `AccountSummary` |
| `frontend/src/pages/Portfolio.tsx` | Tooltip on alias cell + detail panel text |
| `backend/src/__tests__/SyncRunner.test.ts` | New test cases for validation flow (all-zero path, not-found, valid) |
| `backend/src/__tests__/services/scoreStore.test.ts` | Add `aliasStatus` to entity mocks |

## Out of Scope

- Automatic alias correction/suggestion
- Bulk alias validation endpoint
- Changes to scoring formula or tier thresholds
