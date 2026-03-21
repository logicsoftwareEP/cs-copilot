# Frontend Recovery + Scoring Improvements — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover stashed frontend UI (dark theme, inline editing), simplify Amplitude scoring to use 30-day MAU comparison (weekend-immune), add Top 10 needs-review section.

**Architecture:** Three independent changes: (1) frontend file restoration from git stash + Zendesk card merge, (2) backend Amplitude client simplification replacing daily DAU/WAU with two 30-day MAU windows, (3) frontend-only Top 10 section. Changes 1 and 2 are independent and can be done in parallel.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Azure Functions v4, Amplitude Segmentation API

**Spec:** `docs/superpowers/specs/2026-03-15-frontend-recovery-and-scoring-improvements-design.md`

---

## Task 1: Restore stashed frontend files (CSS, Tailwind, App.tsx)

**Files:**
- Restore from stash: `frontend/src/index.css`
- Restore from stash: `frontend/tailwind.config.js`
- Restore from stash: `frontend/src/App.tsx`

- [ ] **Step 1: Extract stashed files**

```bash
cd d:/Logic\ Software/AI
git show stash@{0}:cs-copilot/frontend/src/index.css > cs-copilot/frontend/src/index.css
git show stash@{0}:cs-copilot/frontend/tailwind.config.js > cs-copilot/frontend/tailwind.config.js
git show stash@{0}:cs-copilot/frontend/src/App.tsx > cs-copilot/frontend/src/App.tsx
```

- [ ] **Step 2: Verify frontend compiles**

```bash
cd cs-copilot/frontend && npm run build
```

Expected: Build succeeds (may have warnings about unused Mapping import — that's fine since the route now redirects).

- [ ] **Step 3: Commit**

```bash
git add cs-copilot/frontend/src/index.css cs-copilot/frontend/tailwind.config.js cs-copilot/frontend/src/App.tsx
git commit -m "fix(cs-copilot): restore dark theme CSS, Tailwind config, and App routing from stash"
```

---

## Task 2: Restore stashed Portfolio.tsx and merge Zendesk penalty card

**Files:**
- Restore from stash + modify: `frontend/src/pages/Portfolio.tsx`
- Modify: `frontend/src/types.ts`

This is the most complex task. The stashed Portfolio.tsx (961 lines) has the dark theme UI with inline alias/licences editing, but is missing the Zendesk penalty card added in the current version.

- [ ] **Step 1: Extract stashed Portfolio.tsx**

```bash
cd d:/Logic\ Software/AI
git show stash@{0}:cs-copilot/frontend/src/pages/Portfolio.tsx > cs-copilot/frontend/src/pages/Portfolio.tsx
```

- [ ] **Step 2: Update ScoreBreakdown usage**

The stashed version uses `bd?.featuresUsed` and `bd?.featureDetails`. The current backend sends `featuresUsed` and `featureDetails` in the score breakdown. Check if the stashed code already references these fields correctly. If `ScoreBreakdown` in `frontend/src/types.ts` is missing `featuresUsed` or `featureDetails`, add them:

```typescript
// In ScoreBreakdown interface, ensure these fields exist:
featuresUsed: number | null;
featureDetails: Record<string, boolean> | null;
```

The current `frontend/src/types.ts` has `lastLoginDays` instead of `featuresUsed`/`featureDetails`. Update `ScoreBreakdown` to match what the backend actually sends:

```typescript
export interface ScoreBreakdown {
  dauWauTrend: number | null;
  monthlyActiveUsers: number | null;
  licenseUtilization: number | null;
  featuresUsed: number | null;
  featureDetails: Record<string, boolean> | null;
  zendeskPenalty: number | null;
  zendeskDetails: ZendeskDetails | null;
}
```

- [ ] **Step 3: Add Zendesk penalty card to the detail panel**

In the stashed Portfolio.tsx, find the score breakdown card array (around line 346-375 — the `[{ label: 'Activity Trend', ... }].map(...)` block). After the three existing cards, add a 4th card for Support Load.

Add the `zendeskPenaltyInfo()` helper function near the other helpers (around line 27-67):

```typescript
function zendeskPenaltyInfo(penalty: number | null): { pts: string; label: string; detail: string; hint: string | null } {
  if (penalty === null) return { pts: 'N/A', label: 'No data', detail: 'Zendesk not configured or no domain', hint: null };
  if (penalty === 0) return { pts: '0', label: 'No issues', detail: 'No significant support burden', hint: 'Clean — no ticket penalty applied.' };
  if (penalty >= -9) return { pts: String(penalty), label: 'Minor', detail: `${penalty} point deduction`, hint: 'Some support activity detected.' };
  return { pts: String(penalty), label: 'High', detail: `${penalty} point deduction`, hint: 'Significant support burden. Review tickets.' };
}
```

In the detail panel, after the 3-card `.map(...)` block, add a Zendesk penalty card. Use the `bd?.zendeskPenalty` value. Read `bd?.zendeskDetails` (which is a `ZendeskDetails` object from the API) for the breakdown.

The card should show:
- Label: "Support Load" / sublabel: "Zendesk ticket penalty"
- Points: the penalty value or "N/A"
- When zendeskDetails is available, show: "Volume: X, Open: Y, High: Z, Urgent: W"
- Colour: green when 0, amber when -1 to -9, red when -10 to -20, grey when null

- [ ] **Step 4: Import ZendeskDetails type**

Ensure the `ZendeskDetails` import is available in Portfolio.tsx. The type is defined in `frontend/src/types.ts`. Import it alongside the other types:

```typescript
import { AccountSummary, AccountDetail, HealthTier, ChurnScore, ZendeskDetails } from '../types';
```

- [ ] **Step 5: Verify frontend compiles**

```bash
cd cs-copilot/frontend && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add cs-copilot/frontend/src/pages/Portfolio.tsx cs-copilot/frontend/src/types.ts
git commit -m "fix(cs-copilot): restore dark theme Portfolio.tsx with inline editing + merge Zendesk penalty card"
```

---

## Task 3: Add inline ARR editing

**Files:**
- Modify: `frontend/src/pages/Portfolio.tsx`
- Modify: `frontend/src/services/api.ts`
- Modify: `backend/src/functions/AccountsApi.ts`

The stashed Portfolio.tsx has inline editing for licences and alias. ARR editing follows the same pattern.

- [ ] **Step 1: Add `updateAccountArr` to api.ts**

```typescript
export async function updateAccountArr(hubspotId: string, arr: number): Promise<void> {
  const res = await fetch(withCode(`${BASE_URL}/accounts/${encodeURIComponent(hubspotId)}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ arr }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Update failed: ${res.status}`);
  }
}
```

- [ ] **Step 2: Update PATCH handler in AccountsApi.ts**

Read `backend/src/functions/AccountsApi.ts`. The PATCH handler currently accepts `{ licenses }`. Extend it to also accept `{ arr }`:

```typescript
// In the PATCH handler, after the licenses block:
if (body.arr !== undefined) {
  const arr = typeof body.arr === 'number' ? body.arr : Number(body.arr);
  if (!isNaN(arr) && arr >= 0) {
    await accounts.mergeFields(id, { arr });
  }
}
```

- [ ] **Step 3: Add inline ARR editing state and handlers to Portfolio.tsx**

Add state variables (near the existing editingLicenses/editingAlias state):

```typescript
const [editingArr, setEditingArr] = useState<string | null>(null);
const [arrInput, setArrInput] = useState('');
```

Add save handler (near saveLicenses):

```typescript
async function saveArr(hubspotId: string) {
  const raw = arrInput.trim();
  const value = raw === '' ? 0 : Number(raw);
  if (isNaN(value) || value < 0) {
    setEditingArr(null);
    return;
  }
  try {
    await updateAccountArr(hubspotId, value);
    setAccounts(prev => prev.map(a =>
      a.hubspotId === hubspotId ? { ...a, arr: value } : a
    ));
  } catch (err) {
    console.warn('Failed to save ARR:', err);
  }
  setEditingArr(null);
}
```

Add import for `updateAccountArr` from `'../services/api'`.

In the table row where ARR is rendered (find `formatArr(a.arr)` in the table body), replace the static display with an inline-editable cell following the same pattern as the licences cell:

```tsx
{/* ARR cell */}
<td className="px-4 py-3 text-[14px] font-mono text-obs-bright text-right">
  {editingArr === a.hubspotId ? (
    <input
      autoFocus
      className="w-20 bg-obs-elevated border border-obs-accent rounded px-2 py-0.5 text-[14px] font-mono text-obs-bright text-right outline-none"
      value={arrInput}
      onChange={e => setArrInput(e.target.value)}
      onBlur={() => saveArr(a.hubspotId)}
      onKeyDown={e => { if (e.key === 'Enter') saveArr(a.hubspotId); if (e.key === 'Escape') setEditingArr(null); }}
    />
  ) : (
    <span
      className="cursor-pointer hover:text-obs-accent transition-colors"
      onClick={() => { setEditingArr(a.hubspotId); setArrInput(String(a.arr || '')); }}
      title="Click to edit ARR"
    >
      {formatArr(a.arr)}
    </span>
  )}
</td>
```

- [ ] **Step 4: Verify backend builds and tests pass**

```bash
cd cs-copilot/backend && npm run build && npm test
```

- [ ] **Step 5: Verify frontend compiles**

```bash
cd cs-copilot/frontend && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add cs-copilot/frontend/src/pages/Portfolio.tsx cs-copilot/frontend/src/services/api.ts cs-copilot/backend/src/functions/AccountsApi.ts
git commit -m "feat(cs-copilot): add inline ARR editing in portfolio grid"
```

---

## Task 4: Replace DAU/WAU daily trend with MAU comparison

**Files:**
- Modify: `backend/src/clients/amplitudeClient.ts`
- Modify: `backend/src/types.ts` (comment update only)

- [ ] **Step 1: Add date parameters to `fetchMonthlyActiveUsers`**

Refactor `fetchMonthlyActiveUsers` to accept optional `startDaysAgo` and `endDaysAgo` parameters (defaulting to 30 and 1 for the current 30-day window). This avoids creating a near-duplicate function:

```typescript
async function fetchMonthlyActiveUsers(
  apiKey: string, secretKey: string, accountAlias: string, accountProperty: string,
  startDaysAgo = 30, endDaysAgo = 1
): Promise<number | null> {
  // ... same implementation but using daysAgo(startDaysAgo) and daysAgo(endDaysAgo)
}
```

- [ ] **Step 2: Replace `fetchDauWauTrend` with `fetchMauTrend`**

Replace the existing `fetchDauWauTrend` function entirely. `fetchMauTrend` returns BOTH the trend AND the current MAU to avoid duplicate API calls in `fetchSignals`:

```typescript
/**
 * Fetch MAU trend: compares current 30-day unique users vs prior 30-day unique users.
 * Weekend-immune — uses 30-day aggregates, not daily counts.
 * Returns { trend, currentMAU } so fetchSignals doesn't need a separate MAU call.
 */
async function fetchMauTrend(
  apiKey: string, secretKey: string, accountAlias: string, accountProperty: string
): Promise<{ trend: number | null; currentMAU: number | null }> {
  const [currentMAU, priorMAU] = await Promise.all([
    fetchMonthlyActiveUsers(apiKey, secretKey, accountAlias, accountProperty),         // days 1-30
    fetchMonthlyActiveUsers(apiKey, secretKey, accountAlias, accountProperty, 60, 31), // days 31-60
  ]);

  if (currentMAU === null || priorMAU === null || priorMAU === 0) {
    return { trend: null, currentMAU };
  }
  return { trend: (currentMAU - priorMAU) / priorMAU, currentMAU };
}
```

- [ ] **Step 3: Update `fetchSignals` to use `fetchMauTrend` (no duplicate MAU call)**

`fetchMauTrend` now returns both trend and MAU, so remove the separate `fetchMonthlyActiveUsers` call:

```typescript
export async function fetchSignals(
  apiKey: string, secretKey: string, accountAlias: string, accountProperty: string
): Promise<AmplitudeSignals> {
  const [mauResult, lastLoginDays] = await Promise.all([
    fetchMauTrend(apiKey, secretKey, accountAlias, accountProperty),
    fetchLastLoginDays(apiKey, secretKey, accountAlias, accountProperty),
  ]);

  return {
    dauWauTrend: mauResult.trend,
    monthlyActiveUsers: mauResult.currentMAU,
    lastLoginDays,
  };
}
```

Note: `dauWauTrend` field name kept for backwards compatibility. Computation is now MAU-based. One fewer API call per account vs the original plan.

- [ ] **Step 4: Update comment in types.ts**

In `backend/src/types.ts`, update the comment on `dauWauTrend`:

```typescript
dauWauTrend: number | null;      // MAU trend: (current30dMAU - prior30dMAU) / prior30dMAU
```

- [ ] **Step 5: Remove unused `fetchDauWauTrend` function**

Delete the old `fetchDauWauTrend` function entirely. It's replaced by `fetchMauTrend`.

- [ ] **Step 6: Add test for fetchMauTrend edge cases**

Add a test file or tests within existing test structure that verify:
- `fetchMauTrend` returns `{ trend: null, currentMAU: null }` when both API calls return null
- `fetchMauTrend` returns `{ trend: null, currentMAU: X }` when priorMAU is 0 (division by zero guard)
- `fetchMauTrend` returns correct trend when both values present (e.g. current=80, prior=100 → trend=-0.2)

- [ ] **Step 7: Verify backend builds and tests pass**

```bash
cd cs-copilot/backend && npm run build && npm test
```

Expected: all tests pass. The scoring thresholds in `healthScoreService.ts` are unchanged — only the input to `dauWauTrend` changes from daily-count-based to MAU-based.

- [ ] **Step 8: Commit**

```bash
git add cs-copilot/backend/src/clients/amplitudeClient.ts cs-copilot/backend/src/types.ts
git commit -m "feat(cs-copilot): replace daily DAU/WAU trend with 30-day MAU comparison (weekend-immune)"
```

**Eng review note:** During Task 2 (restore Portfolio), verify that `AccountsApi.ts` actually sends `featuresUsed` and `featureDetails` in the scoreBreakdown response. If not, update it. The frontend `ScoreBreakdown` type must match what the API sends.

---

## Task 5: Add Top 10 Needs Review section

**Files:**
- Modify: `frontend/src/pages/Portfolio.tsx`

Frontend-only change. No backend modifications.

- [ ] **Step 1: Add the Needs Review section**

In Portfolio.tsx, after the metric cards grid (around line 696, after the `</div>` closing the `grid grid-cols-4` block) and before the toolbar, add:

```tsx
{/* ── Top 10 Needs Review ── */}
{(() => {
  const needsReview = accounts
    .filter(a => a.tier === 'critical' || a.tier === 'at-risk')
    .sort((a, b) => (b.arr ?? 0) - (a.arr ?? 0))
    .slice(0, 10);

  if (needsReview.length === 0) return null;

  return (
    <div className="mb-6">
      <p className="text-[14px] font-semibold uppercase tracking-[0.12em] text-obs-ghost mb-3">
        Needs Review
        <span className="text-obs-dim font-normal ml-2">Top {needsReview.length} at-risk accounts by ARR</span>
      </p>
      <div className="grid grid-cols-5 gap-3">
        {needsReview.map(a => {
          const cfg = TIER_CFG[a.tier ?? 'unmapped'];
          return (
            <div
              key={a.hubspotId}
              onClick={() => setSelected(a)}
              className="bg-obs-raised border border-obs-edge rounded-xl px-4 py-3 cursor-pointer hover:border-obs-rule transition-colors group"
            >
              <div className="flex items-center justify-between mb-2">
                <TierBadge tier={a.tier ?? 'unmapped'} />
                <span className="text-[16px] font-bold font-mono" style={{ color: cfg.color }}>
                  {a.score ?? '—'}
                </span>
              </div>
              <p className="text-[14px] font-semibold text-obs-bright truncate">{a.accountName}</p>
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-[14px] text-obs-dim">{a.csmName || '—'}</span>
                <span className="text-[14px] font-mono text-obs-ghost">{formatArr(a.arr)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
})()}
```

- [ ] **Step 2: Verify frontend compiles**

```bash
cd cs-copilot/frontend && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add cs-copilot/frontend/src/pages/Portfolio.tsx
git commit -m "feat(cs-copilot): add Top 10 Needs Review section showing at-risk accounts by ARR"
```

---

## Task 6: Final verification, docs update, and deploy

**Files:**
- Modify: `cs-copilot/README.md`
- Modify: `cs-copilot/progress.md`
- Modify: `cs-copilot/CLAUDE.md`

- [ ] **Step 1: Run full backend tests**

```bash
cd cs-copilot/backend && npm run build && npm test
```

Expected: all 98 tests pass.

- [ ] **Step 2: Run frontend build**

```bash
cd cs-copilot/frontend && npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Update README.md**

Update the Health Score table to note "MAU trend" instead of "DAU/WAU trend". Add note about weekend immunity.

- [ ] **Step 4: Update progress.md**

Add a new section for 2026-03-15 changes:
- Restored dark theme frontend with inline alias/ARR editing
- Replaced daily DAU/WAU trend with 30-day MAU comparison (weekend-immune)
- Added Top 10 Needs Review section
- No separate mapping page — alias editing is inline in portfolio grid

- [ ] **Step 5: Commit docs**

```bash
git add cs-copilot/README.md cs-copilot/progress.md
git commit -m "docs(cs-copilot): update README and progress for frontend recovery + MAU trend + top 10 review"
```

- [ ] **Step 6: Deploy backend**

```bash
cd cs-copilot/backend
npx bestzip ../deploy.zip dist/ host.json package.json package-lock.json node_modules/
az functionapp deployment source config-zip --name cs-copilot-func --resource-group customersuccess --src ../deploy.zip
```

- [ ] **Step 7: Deploy frontend**

```bash
cd cs-copilot/frontend
npx @azure/static-web-apps-cli deploy dist --deployment-token $(az staticwebapp secrets list --name cs-copilot-ui --resource-group customersuccess --query "properties.apiKey" -o tsv) --env production
```
