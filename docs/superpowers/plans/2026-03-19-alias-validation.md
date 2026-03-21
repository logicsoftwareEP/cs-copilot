# Alias Validation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Differentiate accounts with genuinely zero Amplitude activity from accounts with mismatched aliases, by validating aliases against 365-day historical data.

**Architecture:** When all Amplitude signals return zero during sync, a new `validateAlias()` function queries the last 365 days. If no historical activity exists, the alias is flagged as `'not-found'` instead of scored as 0. A new `aliasStatus` field flows from score storage → API → frontend tooltip.

**Tech Stack:** TypeScript, Azure Table Storage, Amplitude Segmentation API, React

**Spec:** `docs/superpowers/specs/2026-03-19-alias-validation-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `backend/src/types.ts` | Modify | Add `aliasStatus` to `ChurnScore` and `AccountSummary` |
| `backend/src/clients/amplitudeClient.ts` | Modify | Add `validateAlias()` export |
| `backend/src/services/scoreStore.ts` | Modify | Add `aliasStatus` to entity, `fromEntity()`, `upsertScore()` |
| `backend/src/functions/SyncRunner.ts` | Modify | Call validation when all signals zero, write `aliasStatus` |
| `backend/src/functions/AccountsApi.ts` | Modify | Pass `aliasStatus` through in list and detail responses |
| `frontend/src/types.ts` | Modify | Add `aliasStatus` to `ChurnScore` and `AccountSummary` |
| `frontend/src/pages/Portfolio.tsx` | Modify | Warning color + tooltip on alias cell, detail panel text |
| `backend/src/__tests__/services/scoreStore.test.ts` | Modify | Add `aliasStatus` to entity fixtures |
| `backend/src/__tests__/services/SyncRunner.test.ts` | Modify | New test cases for validation flow |

---

### Task 1: Add `aliasStatus` to backend types

**Files:**
- Modify: `backend/src/types.ts:27-49`

- [ ] **Step 1: Add `aliasStatus` to `ChurnScore`**

In `backend/src/types.ts`, add after the `zendeskDetails` field (line 40):

```ts
aliasStatus: 'valid' | 'not-found' | null;
```

- [ ] **Step 2: Add `aliasStatus` to `AccountSummary`**

In `backend/src/types.ts`, add after the `amplitudeAlias` field (line 48):

```ts
aliasStatus: 'valid' | 'not-found' | null;
```

- [ ] **Step 3: Verify the build compiles (expect errors in files that construct these types)**

Run: `cd backend && npx tsc --noEmit 2>&1 | head -30`
Expected: Type errors in scoreStore.ts, SyncRunner.ts, AccountsApi.ts, and test files (missing `aliasStatus`). This confirms the type change propagated correctly.

- [ ] **Step 4: Commit**

```bash
git add backend/src/types.ts
git commit -m "feat(types): add aliasStatus to ChurnScore and AccountSummary"
```

---

### Task 2: Add `aliasStatus` to scoreStore

**Files:**
- Modify: `backend/src/services/scoreStore.ts:4-18,20-36,105-121`
- Modify: `backend/src/__tests__/services/scoreStore.test.ts:18-32`

- [ ] **Step 1: Add `aliasStatus` to `ScoreEntity` interface**

In `scoreStore.ts`, add after `zendeskDetails` (line 17):

```ts
aliasStatus?: string | null;
```

Note: `?` because existing Table Storage rows lack this column.

- [ ] **Step 2: Add `aliasStatus` to `fromEntity()`**

In `scoreStore.ts`, add after `zendeskDetails` mapping (line 34):

```ts
aliasStatus: (entity.aliasStatus as 'valid' | 'not-found' | null) ?? null,
```

- [ ] **Step 3: Add `aliasStatus` to `upsertScore()`**

In `scoreStore.ts`, add after `zendeskDetails` in the upsert entity object (line 119):

```ts
aliasStatus: score.aliasStatus,
```

- [ ] **Step 4: Update test fixture**

In `scoreStore.test.ts`, add to `SCORE_ENTITY` (after line 31):

```ts
aliasStatus: 'valid',
```

- [ ] **Step 5: Run scoreStore tests**

Run: `cd backend && npx jest --testPathPattern scoreStore -v`
Expected: All 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/scoreStore.ts backend/src/__tests__/services/scoreStore.test.ts
git commit -m "feat(scoreStore): persist aliasStatus field with backward compat"
```

---

### Task 3: Add `validateAlias()` to Amplitude client

**Files:**
- Modify: `backend/src/clients/amplitudeClient.ts`

- [ ] **Step 1: Add `validateAlias` function**

Add before the `fetchSignals` export (before line 212):

```ts
/**
 * Validate whether an alias has any historical activity in Amplitude.
 * Queries _active events for the last 365 days with i=30 (monthly buckets).
 * Returns true if any bucket has > 0 users, false if all are zero.
 *
 * Used to distinguish mismatched aliases (no users exist) from genuinely
 * inactive accounts (users exist but stopped logging in).
 */
export async function validateAlias(
  apiKey: string,
  secretKey: string,
  accountAlias: string,
  accountProperty: string
): Promise<boolean> {
  try {
    const params = new URLSearchParams({
      e: JSON.stringify({
        event_type: '_active',
        filters: [{
          subprop_type: 'user',
          subprop_key: accountProperty,
          subprop_op: 'is',
          subprop_value: [accountAlias],
        }],
      }),
      m: 'uniques',
      i: '30',
      start: toAmplitudeDate(daysAgo(365)),
      end: toAmplitudeDate(daysAgo(1)),
    });

    const response = await fetch(
      `https://amplitude.com/api/2/events/segmentation?${params}`,
      { headers: { Authorization: buildBasicAuth(apiKey, secretKey) } }
    );

    if (!response.ok) {
      console.warn(`Amplitude alias validation failed: ${response.status} ${response.statusText}`);
      return true; // fail-open: don't flag as not-found on API error
    }

    const data = (await response.json()) as SegmentationResponse;
    if (!data.data?.series?.[0]) return false;

    return data.data.series[0].some(v => v > 0);
  } catch (error) {
    console.warn('Error validating alias:', error);
    return true; // fail-open on network error
  }
}
```

Key decisions:
- **Fail-open:** On API errors, returns `true` (assume valid) to avoid false `not-found` flags.
- Reuses existing `toAmplitudeDate`, `daysAgo`, `buildBasicAuth` helpers already in the file.
- Same filter pattern as `fetchMonthlyActiveUsers` (filter inside event object).

- [ ] **Step 2: Verify build compiles**

Run: `cd backend && npx tsc --noEmit 2>&1 | head -10`
Expected: May still have errors from SyncRunner/AccountsApi (aliasStatus not yet populated), but no errors in `amplitudeClient.ts` itself.

- [ ] **Step 3: Commit**

```bash
git add backend/src/clients/amplitudeClient.ts
git commit -m "feat(amplitude): add validateAlias for 365-day historical check"
```

---

### Task 4: Wire alias validation into SyncRunner

**Files:**
- Modify: `backend/src/functions/SyncRunner.ts:7,156-259`
- Modify: `backend/src/__tests__/services/SyncRunner.test.ts`

- [ ] **Step 1: Add import**

In `SyncRunner.ts`, update the amplitudeClient import (line 8) to include `validateAlias`:

```ts
import { fetchSignals, validateAlias } from '../clients/amplitudeClient';
```

- [ ] **Step 2: Add zero-signal detection helper**

Add after the imports, before the `SyncResult` interface:

```ts
function isAllZeroSignals(signals: AmplitudeSignals): boolean {
  return (
    signals.dauWauTrend === null &&
    signals.monthlyActiveUsers === 0 &&
    signals.featureBreadth !== null &&
    signals.featureBreadth.used.length === 0
  );
}
```

Also add the import for `AmplitudeSignals`:

```ts
import { fetchSignals, validateAlias, AmplitudeSignals } from '../clients/amplitudeClient';
```

- [ ] **Step 3: Modify the scoring loop**

In SyncRunner.ts, the existing scoring `try` block (around line 182-259) handles the case where an alias exists. Replace the body of the `try` block with logic that checks for all-zero signals after `fetchSignals`:

After the `fetchSignals` call (~line 183-189), add the zero-signal check before scoring:

```ts
        const signals = await fetchSignals(
          config.amplitudeApiKey,
          config.amplitudeSecretKey,
          amplitudeAlias,
          config.amplitudeAccountProperty,
          config.amplitudeFeatureEvents,
        );

        // All signals zero — validate whether alias actually exists in Amplitude
        if (isAllZeroSignals(signals)) {
          const aliasExists = await validateAlias(
            config.amplitudeApiKey,
            config.amplitudeSecretKey,
            amplitudeAlias,
            config.amplitudeAccountProperty
          );

          if (!aliasExists) {
            // Alias not found — treat as unmapped, not score=0
            const penalty = zendeskData ? computeZendeskPenalty(zendeskData) : null;
            await scoreStore.upsertScore({
              accountId: company.accountId,
              date: todayISO,
              score: null,
              tier: 'unmapped',
              dauWauTrend: null,
              monthlyActiveUsers: null,
              licenseUtilization: null,
              featuresUsed: null,
              featureDetails: null,
              scoreDelta: null,
              computedAt: new Date().toISOString(),
              zendeskPenalty: penalty ? penalty.totalPenalty : null,
              zendeskDetails: penalty ? JSON.stringify(penalty) : null,
              aliasStatus: 'not-found',
            });
            log(`Alias not found in Amplitude: ${amplitudeAlias} (${company.accountName})`);
            continue;
          }
        }
```

This block goes right after `fetchSignals()` and before the existing `computeScore()` call. If the alias is not found, it writes a placeholder score (same pattern as the existing no-alias path at lines 162-179) and `continue`s to the next account.

- [ ] **Step 4: Add `aliasStatus: 'valid'` to all other score upserts**

There are three `upsertScore` calls in SyncRunner that need `aliasStatus` added:

1. **No-alias placeholder** (~line 164): Add `aliasStatus: null,`
2. **Normal scoring success** (~line 220): Add `aliasStatus: 'valid',`
3. **Amplitude fetch failure** (~line 244): Add `aliasStatus: 'valid',` (we had an alias, it just failed)

- [ ] **Step 5: Add mock for `validateAlias` in SyncRunner tests**

In `SyncRunner.test.ts`, update the amplitudeClient mock (line 11):

```ts
jest.mock('../../clients/amplitudeClient');
```

This already mocks the entire module. Add the mock reference after the existing mock declarations:

```ts
const mockValidateAlias = jest.requireMock('../../clients/amplitudeClient').validateAlias as jest.Mock;
```

In `beforeEach`, add:

```ts
mockValidateAlias.mockResolvedValue(true); // default: alias is valid
```

- [ ] **Step 6: Add `aliasStatus` to existing test assertions**

All existing `upsertScore` mock assertions need `aliasStatus` in `expect.objectContaining()`. Search for `upsertScore` calls in the test file and add `aliasStatus: 'valid'` (or `aliasStatus: null` for the no-alias path).

- [ ] **Step 7: Add new test: all-zero signals with invalid alias → not-found**

```ts
it('all-zero signals with invalid alias → aliasStatus not-found, score null', async () => {
  const { upsertScore } = setupStoreMocks({
    mappings: [{ accountId: 'hs-001', amplitudeAlias: 'bad-alias' }],
  });

  mockSearchActiveCompanies.mockResolvedValue([COMPANY_A]);
  mockFetchSignals.mockResolvedValue({
    dauWauTrend: null,
    monthlyActiveUsers: 0,
    featureBreadth: { used: [], total: 12 },
  });
  mockValidateAlias.mockResolvedValue(false);
  mockFetchAllZendeskTickets.mockResolvedValue(null);

  const result = await runSync();
  expect(result.synced).toBe(1);
  expect(upsertScore).toHaveBeenCalledWith(
    expect.objectContaining({
      score: null,
      tier: 'unmapped',
      aliasStatus: 'not-found',
    })
  );
});
```

- [ ] **Step 8: Add new test: all-zero signals with valid alias → score 0, aliasStatus valid**

```ts
it('all-zero signals with valid alias → score 0, aliasStatus valid', async () => {
  const { upsertScore } = setupStoreMocks({
    mappings: [{ accountId: 'hs-001', amplitudeAlias: 'real-alias' }],
  });

  mockSearchActiveCompanies.mockResolvedValue([COMPANY_A]);
  mockFetchSignals.mockResolvedValue({
    dauWauTrend: null,
    monthlyActiveUsers: 0,
    featureBreadth: { used: [], total: 12 },
  });
  mockValidateAlias.mockResolvedValue(true);
  mockFetchAllZendeskTickets.mockResolvedValue(null);

  const result = await runSync();
  expect(upsertScore).toHaveBeenCalledWith(
    expect.objectContaining({
      score: 0,
      aliasStatus: 'valid',
    })
  );
});
```

- [ ] **Step 9: Run all tests**

Run: `cd backend && npm test`
Expected: All tests pass (112+ existing + 2 new).

- [ ] **Step 10: Commit**

```bash
git add backend/src/functions/SyncRunner.ts backend/src/__tests__/services/SyncRunner.test.ts
git commit -m "feat(sync): validate aliases when all Amplitude signals zero"
```

---

### Task 5: Pass `aliasStatus` through AccountsApi

**Files:**
- Modify: `backend/src/functions/AccountsApi.ts:61-69,150-170`

- [ ] **Step 1: Add `aliasStatus` to the list endpoint AccountSummary construction**

In `AccountsApi.ts`, in the `listAccounts` function where `summary` is built (~line 61-69), add `aliasStatus` to the returned object:

```ts
aliasStatus: scoreRow?.aliasStatus ?? null,
```

Add it after the `amplitudeAlias` line.

- [ ] **Step 2: Add `aliasStatus` to the detail endpoint response**

In the `getAccount` function, in the JSON response object (~line 153-171), add:

```ts
aliasStatus: latestScore?.aliasStatus ?? null,
```

Add it after the `scoreDelta` line.

- [ ] **Step 3: Verify build compiles clean**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Run all backend tests**

Run: `cd backend && npm test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/functions/AccountsApi.ts
git commit -m "feat(api): pass aliasStatus through list and detail endpoints"
```

---

### Task 6: Update frontend types

**Files:**
- Modify: `frontend/src/types.ts`

- [ ] **Step 1: Add `aliasStatus` to frontend `ChurnScore`**

After the `zendeskDetails` field:

```ts
aliasStatus: 'valid' | 'not-found' | null;
```

- [ ] **Step 2: Add `aliasStatus` to frontend `AccountSummary`**

After the `amplitudeAlias` field:

```ts
aliasStatus: 'valid' | 'not-found' | null;
```

- [ ] **Step 3: Verify frontend compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types.ts
git commit -m "feat(frontend): add aliasStatus to types"
```

---

### Task 7: Frontend tooltip and detail panel

**Files:**
- Modify: `frontend/src/pages/Portfolio.tsx:1026-1059,342-349`

- [ ] **Step 1: Update alias cell in the table**

In `Portfolio.tsx`, find the alias cell rendering (~line 1050-1058). Replace the `<span>` that shows the alias text:

Current code:
```tsx
<span className={`text-[14px] font-mono ${
  account.amplitudeAlias
    ? 'text-obs-text hover:text-obs-accent'
    : 'text-tier-watch italic'
} transition-colors`}>
  {account.amplitudeAlias || 'Set alias'}
</span>
```

Replace with:
```tsx
<span
  className={`text-[14px] font-mono ${
    account.amplitudeAlias
      ? account.aliasStatus === 'not-found'
        ? 'text-tier-watch'
        : 'text-obs-text hover:text-obs-accent'
      : 'text-tier-watch italic'
  } transition-colors`}
  title={account.aliasStatus === 'not-found' ? 'Alias not found in Amplitude — check casing or wait for first activity' : undefined}
>
  {account.amplitudeAlias || 'Set alias'}
  {account.aliasStatus === 'not-found' && (
    <span className="ml-1 text-[11px]" title="Alias not found in Amplitude">⚠</span>
  )}
</span>
```

- [ ] **Step 2: Update detail panel "No Amplitude mapping" card**

In `Portfolio.tsx`, find the detail panel's "No Amplitude mapping" conditional (~line 343-349). Currently it checks `!summary.amplitudeAlias`. Add a second condition for not-found aliases:

After the existing `!summary.amplitudeAlias` block, add an `else if` for `summary.aliasStatus === 'not-found'`:

```tsx
) : summary.aliasStatus === 'not-found' ? (
  <div className="rounded-xl bg-tier-watch-bg border border-tier-watch/20 px-4 py-4">
    <p className="text-[14px] font-semibold text-tier-watch">Alias not recognized by Amplitude</p>
    <p className="text-[14px] text-tier-watch/70 mt-1 leading-relaxed">
      The alias <span className="font-mono">"{summary.amplitudeAlias}"</span> was not found in Amplitude.
      Check the casing matches exactly, or wait for first activity if this is a new account.
    </p>
  </div>
```

- [ ] **Step 3: Verify frontend builds**

Run: `cd frontend && npm run build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Portfolio.tsx
git commit -m "feat(ui): show warning tooltip for not-found aliases"
```

---

### Task 8: Deploy and verify

**Files:** None (deployment only)

- [ ] **Step 1: Deploy backend**

Run: `cd backend && bash scripts/deploy.sh`
Expected: "Deployed!" message.

- [ ] **Step 2: Deploy frontend**

Run: `cd frontend && npm run build && npx @azure/static-web-apps-cli deploy dist --app-name cs-copilot-ui --env production`
Expected: "Project deployed to https://lemon-island-0c1c7070f.4.azurestaticapps.net"

- [ ] **Step 3: Trigger a sync**

Click "Sync Now" in the UI, or:
Run: `curl -X POST "https://cs-copilot-func.azurewebsites.net/api/sync?code=<key>" -H "X-User-Email: vadim@logicsoftware.net"`
Expected: Sync completes. Logs should show "Alias not found in Amplitude" messages for mismatched aliases.

- [ ] **Step 4: Verify in UI**

Check that:
1. Previously score=0 accounts now show as unmapped with warning icon on alias
2. Genuinely inactive accounts (if any) still show score=0
3. Normal scored accounts are unaffected
4. Detail panel shows "Alias not recognized by Amplitude" for not-found aliases
