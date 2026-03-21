# Hide Accounts from Dashboard

**Date:** 2026-03-19
**Status:** Approved

## Problem

Some accounts in the dashboard are irrelevant (test accounts, churned-but-not-canceled, internal accounts) and clutter the portfolio view and distort metrics. There is no way to exclude them without deleting them from Table Storage.

## Solution

Add a `hidden` flag to accounts. Hidden accounts are excluded from scoring (no Amplitude/Zendesk API calls), excluded from dashboard metrics, and hidden from the default table view. A "Show hidden" toggle in the toolbar reveals them with dimmed styling. Admin/supervisor can toggle the flag inline.

## Design

### Data Model

Add `hidden: boolean` to the `Account` type and `AccountEntity`.

- Default: `false`
- `AccountEntity`: `hidden?: boolean` (optional — existing rows lack the column)
- `fromEntity()` reads with `entity.hidden ?? false` for backward compatibility
- **`toEntity()` must NOT write `hidden`** — follows the same pattern as `licenses`: the sync path must never overwrite a manually-set flag. `hidden` is only written via `updateHidden()`.
- New method: `AccountStore.updateHidden(accountId: string, hidden: boolean)` using Merge mode (same pattern as `updateLicenses`/`updateArr`)

`AccountSummary` (both backend and frontend types) gets `hidden: boolean`.

### API

The existing `PATCH /api/accounts/{id}` endpoint (admin/supervisor only) already handles `{ licenses, arr }`. Extend the body to also accept `{ hidden: boolean }`.

The list endpoint (`GET /api/accounts`) strips hidden accounts from the CSM response server-side (add `&& !a.hidden` to the existing CSM email filter). Admin/supervisor see all accounts (the frontend handles filtering).

No new endpoints needed.

### Sync & Scoring (SyncRunner)

- Hidden accounts **still sync from SQL** — they get upserted to Table Storage on every sync so data stays fresh
- Hidden accounts **skip scoring** — in the scoring loop (which iterates `companies`), check `storedMap.get(company.accountId)?.hidden` and `continue` past them. No Amplitude, no Zendesk, no score upsert.
- This saves API calls and keeps hidden accounts from producing stale/misleading scores

### Frontend — Table

- **Hide toggle column** — new first column (before Account name) with a clickable eye icon. Visible only for admin/supervisor roles. Click sends `PATCH { hidden: true/false }` and updates local state.
- **Hidden row styling** — when "Show hidden" is on, hidden accounts render with dimmed/muted opacity (e.g., `opacity-40`) to visually distinguish them.
- **CSMs** never see hidden accounts (backend strips them from the CSM response).

### Frontend — Toolbar

- **"Show hidden" checkbox** — in the toolbar, next to existing filters. Off by default. Visible only for admin/supervisor. When toggled on, hidden accounts appear in the table (dimmed). When off, hidden accounts are filtered out.
- State stored in component state (not persisted — resets on page load, always starts hidden).

### Frontend — Metrics & Filtering

**Metrics:** Introduce `activeAccounts = accounts.filter(a => !a.hidden)`. All four metric cards (Accounts, Portfolio ARR, Avg Health Score, At Risk) and the "Needs Review" section use `activeAccounts` instead of raw `accounts`. Metrics always reflect the active portfolio only, regardless of "Show hidden" toggle.

**Table filtering:** The existing `filtered` memo applies search/tier/owner filters. Add hidden-account filtering as the first stage: exclude hidden accounts unless "Show hidden" is on. Then apply existing filters on the result.

**Count display:** `filtered.length / activeAccounts.length` when "Show hidden" is off. `filtered.length / accounts.length` when on.

### Role Permissions

| Action | Admin | Supervisor | CSM |
|---|---|---|---|
| See hide toggle column | Yes | Yes | No |
| Toggle hidden state | Yes | Yes | No |
| See "Show hidden" checkbox | Yes | Yes | No |
| See hidden accounts (when toggle on) | Yes | Yes | Never |

## Files to Modify

| File | Change |
|---|---|
| `backend/src/types.ts` | Add `hidden: boolean` to `Account` and `AccountSummary` |
| `backend/src/services/accountStore.ts` | Add `hidden?` to `AccountEntity`, `fromEntity()` with `?? false`, do NOT add to `toEntity()`, new `updateHidden()` |
| `backend/src/functions/AccountsApi.ts` | Handle `hidden` in PATCH body, pass `hidden` through in list/detail, strip hidden from CSM response |
| `backend/src/functions/SyncRunner.ts` | Skip scoring for hidden accounts via `storedMap.get(id)?.hidden` |
| `frontend/src/types.ts` | Add `hidden: boolean` to `Account` and `AccountSummary` |
| `frontend/src/services/api.ts` | Add `updateAccountHidden()` convenience wrapper (same PATCH endpoint) |
| `frontend/src/pages/Portfolio.tsx` | Eye icon column, "Show hidden" toggle, dimmed rows, `activeAccounts` for metrics, two-stage filtering |
| `backend/src/__tests__/services/SyncRunner.test.ts` | Test that hidden accounts skip scoring |
| `backend/src/__tests__/services/accountStore.test.ts` | Test `updateHidden` |

## Out of Scope

- Bulk hide/unhide
- Persisting "Show hidden" toggle state across sessions
- Hiding accounts from the detail panel (hidden accounts are still viewable when clicked)
- Auto-hiding accounts based on rules (e.g., no activity for 90 days)
