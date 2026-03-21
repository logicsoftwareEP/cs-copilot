# Hide Accounts Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow admin/supervisor to hide accounts from the dashboard, metrics, and scoring — with a "Show hidden" toggle to reveal them.

**Architecture:** A `hidden` boolean on the Account entity, written only via `updateHidden()` (never during sync). SyncRunner skips scoring for hidden accounts. Frontend filters them from metrics and the table by default, with a toolbar toggle to show them dimmed.

**Tech Stack:** TypeScript, Azure Table Storage, React

**Spec:** `docs/superpowers/specs/2026-03-19-hide-accounts-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `backend/src/types.ts` | Modify | Add `hidden: boolean` to `Account` and `AccountSummary` |
| `backend/src/services/accountStore.ts` | Modify | Add `hidden?` to entity, `fromEntity()`, new `updateHidden()`. Do NOT add to `toEntity()`. |
| `backend/src/functions/AccountsApi.ts` | Modify | Handle `hidden` in PATCH, pass through in list/detail, strip from CSM response |
| `backend/src/functions/SyncRunner.ts` | Modify | Skip scoring for hidden accounts |
| `frontend/src/types.ts` | Modify | Add `hidden: boolean` to `Account` and `AccountSummary` |
| `frontend/src/services/api.ts` | Modify | Add `updateAccountHidden()` |
| `frontend/src/pages/Portfolio.tsx` | Modify | Eye icon column, "Show hidden" toggle, dimmed rows, `activeAccounts` for metrics |
| `backend/src/__tests__/services/SyncRunner.test.ts` | Modify | Test hidden accounts skip scoring |
| `backend/src/__tests__/services/accountStore.test.ts` | Modify | Test `updateHidden` |

---

### Task 1: Backend types + accountStore

**Files:**
- Modify: `backend/src/types.ts:3-14,45-51`
- Modify: `backend/src/services/accountStore.ts:4-16,43-56,58-122`

- [ ] **Step 1: Add `hidden` to backend `Account` type**

In `backend/src/types.ts`, add after `domain: string;` (line 13):

```ts
hidden: boolean;
```

- [ ] **Step 2: Add `hidden` to `AccountEntity` (optional)**

In `backend/src/services/accountStore.ts`, add after `domain?: string;` (line 15):

```ts
hidden?: boolean;
```

- [ ] **Step 3: Add `hidden` to `fromEntity()`**

In `accountStore.ts`, add after `domain: entity.domain ?? '',` (line 54):

```ts
hidden: entity.hidden ?? false,
```

- [ ] **Step 4: Do NOT modify `toEntity()`**

`toEntity()` must not write `hidden`. Sync writes use Merge mode — if `hidden` were included as `false`, it would overwrite any manually-set `true` on every nightly sync. Only `updateHidden()` writes this field.

- [ ] **Step 5: Add `updateHidden()` method**

In `accountStore.ts`, add after the `updateArr` method (after line 121):

```ts
/**
 * Update the hidden flag for a single account.
 * Uses Merge mode so only `hidden` is written; all other fields are preserved.
 */
async updateHidden(accountId: string, hidden: boolean): Promise<void> {
  await this.client.upsertEntity(
    { partitionKey: 'accounts', rowKey: accountId, hidden },
    'Merge'
  );
}
```

- [ ] **Step 6: Update `sqlClient.ts` Account construction**

In `backend/src/clients/sqlClient.ts`, the `accounts.push()` call (around line 141) constructs an `Account`. Add `hidden: false,` to the object (SQL accounts are never hidden by default):

```ts
hidden: false,
```

- [ ] **Step 7: Run backend type check**

Run: `cd "d:/Logic Software/AI/cs-copilot/backend" && npx tsc --noEmit 2>&1 | head -20`
Expected: Type errors in AccountsApi.ts (AccountSummary missing hidden), SyncRunner test fixtures, and frontend types. This is expected — they'll be fixed in later tasks.

- [ ] **Step 8: Commit**

```bash
git add backend/src/types.ts backend/src/services/accountStore.ts backend/src/clients/sqlClient.ts
git commit -m "feat(account): add hidden flag to Account type and accountStore"
```

---

### Task 2: AccountsApi — PATCH handler + pass-through + CSM filter

**Files:**
- Modify: `backend/src/functions/AccountsApi.ts:61-78,105-125,153-172`

- [ ] **Step 1: Add `hidden` to AccountSummary construction in list endpoint**

In `AccountsApi.ts`, in the `listAccounts` function's `.map()` call (around line 61-69), add after `aliasStatus`:

```ts
hidden: account.hidden,
```

Note: `hidden` comes from the `account` object (Account type), not from the score row.

- [ ] **Step 2: Strip hidden accounts from CSM response**

In the CSM filtering block (around line 73-78), add `&& !a.hidden` to the filter:

```ts
if (user.role === 'csm') {
  const email = user.email.toLowerCase();
  summary = summary.filter(a =>
    (a.csmEmail ?? '').toLowerCase() === email && !a.hidden
  );
}
```

- [ ] **Step 3: Handle `hidden` in PATCH body**

In the `getAccount` function's PATCH handler (around line 105-125), update the body type and add hidden handling:

Change the body type to:
```ts
const body = await req.json() as { licenses?: number | null; arr?: number; hidden?: boolean };
```

Add after the `arr` handling block:

```ts
if (body.hidden !== undefined) {
  if (typeof body.hidden !== 'boolean') {
    return { status: 400, headers: CORS_HEADERS, body: 'hidden must be a boolean.' };
  }
  await accounts.updateHidden(accountId, body.hidden);
}
```

- [ ] **Step 4: Add `hidden` to detail endpoint response**

In the GET detail response JSON (around line 153-172), add after `aliasStatus`:

```ts
hidden: account.hidden,
```

- [ ] **Step 5: Run backend tests**

Run: `cd "d:/Logic Software/AI/cs-copilot/backend" && npm test 2>&1 | tail -5`
Expected: Tests may have some failures in SyncRunner (fixture missing `hidden`). Note them for Task 3.

- [ ] **Step 6: Commit**

```bash
git add backend/src/functions/AccountsApi.ts
git commit -m "feat(api): handle hidden flag in PATCH, list, and detail endpoints"
```

---

### Task 3: SyncRunner — skip scoring for hidden accounts + fix tests

**Files:**
- Modify: `backend/src/functions/SyncRunner.ts`
- Modify: `backend/src/__tests__/services/SyncRunner.test.ts`

- [ ] **Step 1: Skip scoring for hidden accounts**

In `SyncRunner.ts`, inside the `for (const company of companies)` loop, right before the `const amplitudeAlias = ...` line, add:

```ts
// Skip scoring for hidden accounts
if (storedMap.get(company.accountId)?.hidden) {
  continue;
}
```

- [ ] **Step 2: Add `hidden: false` to test fixtures**

In `SyncRunner.test.ts`, add `hidden: false,` to both `COMPANY_A` and `COMPANY_B` objects (after `domain: '',`).

- [ ] **Step 3: Add `updateHidden` to mock AccountStore**

In `setupStoreMocks`, add `updateHidden: jest.fn(),` to the `MockAccountStore.mockImplementation` object.

- [ ] **Step 4: Add test for hidden account skipping scoring**

```ts
it('hidden accounts skip scoring entirely', async () => {
  const storedA: Account = { ...COMPANY_A, hidden: true };
  const storedB: Account = { ...COMPANY_B, hidden: false };
  const { upsertScore } = setupStoreMocks({
    mappings: [
      { accountId: 'hs-001', amplitudeAlias: 'alpha' },
      { accountId: 'hs-002', amplitudeAlias: 'beta' },
    ],
    storedAccounts: [storedA, storedB],
  });

  mockSearchActiveCompanies.mockResolvedValue([COMPANY_A, COMPANY_B]);
  mockFetchSignals.mockResolvedValue(GOOD_SIGNALS);
  mockFetchAllZendeskTickets.mockResolvedValue(null);

  const result = await runSync();
  expect(result.synced).toBe(2); // both synced
  expect(result.scored).toBe(1); // only B scored
  // upsertScore should only be called for B, not A
  expect(upsertScore).toHaveBeenCalledTimes(1);
  expect(upsertScore).toHaveBeenCalledWith(
    expect.objectContaining({ accountId: 'hs-002' })
  );
});
```

- [ ] **Step 5: Run all tests**

Run: `cd "d:/Logic Software/AI/cs-copilot/backend" && npm test`
Expected: All tests pass (115+ tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/functions/SyncRunner.ts backend/src/__tests__/services/SyncRunner.test.ts
git commit -m "feat(sync): skip scoring for hidden accounts"
```

---

### Task 4: Frontend types + API client

**Files:**
- Modify: `frontend/src/types.ts:1-12,14-20`
- Modify: `frontend/src/services/api.ts`

- [ ] **Step 1: Add `hidden` to frontend `Account`**

In `frontend/src/types.ts`, add after `domain: string;` (line 11):

```ts
hidden: boolean;
```

- [ ] **Step 2: Add `updateAccountHidden` to api.ts**

In `frontend/src/services/api.ts`, add after `updateAccountArr` (after line 87):

```ts
export async function updateAccountHidden(accountId: string, hidden: boolean): Promise<void> {
  const res = await fetch(withCode(`${BASE_URL}/accounts/${encodeURIComponent(accountId)}`), {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ hidden }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(t || `Update failed: ${res.status}`); }
}
```

- [ ] **Step 3: Add import to Portfolio.tsx**

In `Portfolio.tsx` line 3, add `updateAccountHidden` to the import:

```ts
import { getAccounts, triggerSync, getAccountDetail, updateAccountLicenses, updateAccountArr, upsertMapping, deleteMapping, updateAccountHidden } from '../services/api';
```

- [ ] **Step 4: Verify frontend compiles**

Run: `cd "d:/Logic Software/AI/cs-copilot/frontend" && npx tsc --noEmit`
Expected: Clean (no errors).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types.ts frontend/src/services/api.ts frontend/src/pages/Portfolio.tsx
git commit -m "feat(frontend): add hidden type and API client"
```

---

### Task 5: Frontend UI — toggle, filtering, metrics, eye icon

**Files:**
- Modify: `frontend/src/pages/Portfolio.tsx`

This is the largest task. All changes are in `Portfolio.tsx`.

- [ ] **Step 1: Add state for "Show hidden" toggle**

After the existing state declarations (around line 548), add:

```ts
const [showHidden, setShowHidden] = useState(false);
const canManage = !isCSM; // admin + supervisor can hide/unhide
```

- [ ] **Step 2: Add `activeAccounts` memo for metrics**

After `const [showHidden, setShowHidden] = useState(false);`, add:

```ts
const activeAccounts = useMemo(() => accounts.filter(a => !a.hidden), [accounts]);
```

- [ ] **Step 3: Rewire metrics to use `activeAccounts`**

Replace the metrics block (around lines 681-689):

```ts
const unmappedCount = activeAccounts.filter(a => !a.amplitudeAlias).length;

// Portfolio metrics
const totalArr = activeAccounts.reduce((sum, a) => sum + (a.arr ?? 0), 0);
const scoredAccounts = activeAccounts.filter(a => a.score !== null);
const avgScore = scoredAccounts.length > 0
  ? Math.round(scoredAccounts.reduce((sum, a) => sum + (a.score ?? 0), 0) / scoredAccounts.length)
  : null;
const atRiskCount = activeAccounts.filter(a => a.tier === 'at-risk' || a.tier === 'critical').length;
```

- [ ] **Step 4: Update `uniqueOwners` to use `activeAccounts`**

Change line 661-663:
```ts
const uniqueOwners = useMemo(() =>
  [...new Set(activeAccounts.map(a => a.csmName).filter(Boolean))].sort()
, [activeAccounts]);
```

- [ ] **Step 5: Add hidden filtering to `filtered` memo**

Update the `filtered` memo (around line 665-679) to filter hidden accounts first:

```ts
const filtered = useMemo(() => {
  const q = search.toLowerCase();
  return sortRows(
    accounts.filter(a => {
      // Hidden filter: exclude unless toggle is on
      if (a.hidden && !showHidden) return false;
      if (q && !(a.accountName ?? '').toLowerCase().includes(q)
          && !(a.csmName ?? '').toLowerCase().includes(q)
          && !(a.amplitudeAlias ?? '').toLowerCase().includes(q)) return false;
      if (filterTier !== 'all' && (a.tier ?? 'unmapped') !== filterTier) return false;
      if (filterOwner !== 'all' && a.csmName !== filterOwner) return false;
      return true;
    }),
    sortCol,
    sortDir,
  );
}, [accounts, search, filterTier, filterOwner, sortCol, sortDir, showHidden]);
```

- [ ] **Step 6: Update "Needs Review" section to use `activeAccounts`**

In the "Needs Review" section (around line 818), change `accounts` to `activeAccounts`:

```ts
const needsReview = activeAccounts
  .filter(a => a.tier === 'critical' || a.tier === 'at-risk')
```

- [ ] **Step 7: Update toolbar count display**

In the toolbar count (around line 913-916), update the denominator:

```ts
<span className="text-[14px] text-obs-ghost ml-auto whitespace-nowrap font-mono">
  {filtered.length !== (showHidden ? accounts.length : activeAccounts.length)
    ? `${filtered.length} / ${showHidden ? accounts.length : activeAccounts.length}`
    : `${showHidden ? accounts.length : activeAccounts.length} accounts`}
</span>
```

- [ ] **Step 8: Add "Show hidden" checkbox to toolbar**

In the toolbar, after the tier filter `<select>` and before the Clear button (around line 900), add:

```tsx
{/* Show hidden toggle (admin/supervisor only) */}
{canManage && (
  <label className="flex items-center gap-1.5 text-[14px] text-obs-ghost cursor-pointer select-none">
    <input
      type="checkbox"
      checked={showHidden}
      onChange={e => setShowHidden(e.target.checked)}
      className="accent-obs-accent"
    />
    Show hidden
  </label>
)}
```

- [ ] **Step 9: Add `handleToggleHidden` function**

Add after the `saveAlias` function (around line 642):

```ts
async function handleToggleHidden(accountId: string, currentHidden: boolean) {
  const newHidden = !currentHidden;
  try {
    await updateAccountHidden(accountId, newHidden);
    setAccounts(prev => prev.map(a =>
      a.accountId === accountId ? { ...a, hidden: newHidden } : a
    ));
  } catch (err) {
    console.warn('Failed to toggle hidden:', err);
  }
}
```

- [ ] **Step 10: Add eye icon column to table header**

In the `<thead>` (around line 976-985), add before `<SortTH col="accountName">Account</SortTH>`:

```tsx
{canManage && <th className="px-2 py-3 w-8" />}
```

- [ ] **Step 11: Add eye icon column to table rows**

In the `<tbody>` row rendering (around line 992-999), add as the first `<td>` inside the `<tr>`, before the Account name cell:

```tsx
{canManage && (
  <td className="px-2 py-3 w-8" onClick={e => e.stopPropagation()}>
    <button
      onClick={() => handleToggleHidden(account.accountId, account.hidden)}
      className={`text-[14px] transition-colors ${
        account.hidden ? 'text-obs-ghost hover:text-obs-bright' : 'text-obs-invisible hover:text-obs-ghost'
      }`}
      title={account.hidden ? 'Unhide account' : 'Hide account'}
    >
      {account.hidden ? '\uD83D\uDC41' : '\uD83D\uDC41'}
    </button>
  </td>
)}
```

Actually, use a simpler SVG eye icon to match the design system:

```tsx
{canManage && (
  <td className="px-2 py-3 w-8" onClick={e => e.stopPropagation()}>
    <button
      onClick={() => handleToggleHidden(account.accountId, account.hidden)}
      className={`transition-opacity ${account.hidden ? 'opacity-40 hover:opacity-70' : 'opacity-20 hover:opacity-60'}`}
      title={account.hidden ? 'Unhide account' : 'Hide account'}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {account.hidden ? (
          <>
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </>
        ) : (
          <>
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </>
        )}
      </svg>
    </button>
  </td>
)}
```

- [ ] **Step 12: Add dimmed styling for hidden rows**

In the `<tr>` className (around line 996-998), add opacity for hidden accounts:

```tsx
className={`cursor-pointer transition-colors border-b border-obs-edge/50 ${
  isActive ? 'bg-obs-accent/8' : 'row-hover'
} ${account.hidden ? 'opacity-40' : ''}`}
```

- [ ] **Step 13: Update metric cards condition to use `activeAccounts`**

The metric cards render condition (around line 786) checks `accounts.length > 0`. Change to `activeAccounts.length > 0`:

```tsx
{!loading && !error && activeAccounts.length > 0 && (
```

- [ ] **Step 14: Verify frontend builds**

Run: `cd "d:/Logic Software/AI/cs-copilot/frontend" && npm run build`
Expected: Build succeeds.

- [ ] **Step 15: Commit**

```bash
git add frontend/src/pages/Portfolio.tsx
git commit -m "feat(ui): add hide toggle, show hidden checkbox, dimmed rows, metric exclusion"
```

---

### Task 6: Deploy and verify

- [ ] **Step 1: Deploy backend**

Run: `cd "d:/Logic Software/AI/cs-copilot/backend" && bash scripts/deploy.sh`

- [ ] **Step 2: Deploy frontend**

Run: `cd "d:/Logic Software/AI/cs-copilot/frontend" && npm run build && npx @azure/static-web-apps-cli deploy dist --app-name cs-copilot-ui --env production`

- [ ] **Step 3: Verify in UI**

Check that:
1. Eye icon column appears for admin/supervisor, not for CSM
2. Clicking eye icon hides account (disappears from default view)
3. "Show hidden" checkbox reveals hidden accounts with dimmed styling
4. Metrics exclude hidden accounts
5. Needs Review section excludes hidden accounts
6. Triggering sync skips hidden accounts (check logs for scoring count)
