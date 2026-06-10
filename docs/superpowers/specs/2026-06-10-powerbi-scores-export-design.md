# PowerBI Health Score Export — Design

**Date:** 2026-06-10
**Status:** Approved

## Problem

Per-account health scores live only in the `churnscores` Azure Table Storage table. PowerBI needs access to the latest score per account to calculate metrics in reports and dashboards. PowerBI already connects to the `AccountsControl` SQL Server database (where `[analytics].[ClientsOverview]` lives), so the most natural delivery is a SQL table joinable on `ClientId`.

## Decision

Write the latest score per account back to SQL Server at the end of every sync run (nightly timer + on-demand `POST /api/sync`). PowerBI reads the table directly and joins to `[analytics].[ClientsOverview]` on `ClientId`.

Alternatives considered and rejected:

- **PowerBI Web connector → existing `GET /api/accounts`**: zero backend code, but scheduled refresh with custom headers is finicky in PowerBI Service, the function key would live in every dataset, and reports get coupled to the internal API shape.
- **PowerBI native Azure Table Storage connector**: storage account key grants access to the entire storage account (including the `users` table), and "latest row per account" must be computed client-side in Power Query over full history.

## Scope

- Latest score only (no history).
- Row shape: account ID + score/tier only. PowerBI joins to `[analytics].[ClientsOverview]` for names, ARR, CSM, etc.

## SQL Table

New table in the `AccountsControl` database:

```sql
CREATE TABLE [analytics].[AccountHealthScores] (
    ClientId   UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    Score      INT          NULL,         -- 0–100, NULL when not computable
    Tier       NVARCHAR(20) NOT NULL,     -- healthy | watch | at-risk | critical | unmapped
    ScoreDate  DATE         NOT NULL,     -- date the score was computed for
    UpdatedAt  DATETIME2    NOT NULL      -- when the sync wrote this row
);
GRANT SELECT, INSERT, DELETE ON [analytics].[AccountHealthScores] TO [<SQL_LOGIN user>];
```

DDL + GRANT ships as `backend/scripts/sql/create-account-health-scores.sql`, run once manually by an admin. The app's `SQL_LOGIN` currently only reads the view, so it needs the grant before the export can succeed.

## Write Path

New export step at the end of `runSync()` in `backend/src/functions/SyncRunner.ts`:

1. After the scoring loop, re-fetch today's scores from `churnscores` via `scoreStore.getAllScoresForDate(todayISO)`. This is the complete current snapshot: accounts skipped during scoring (already had a valid score today) are included; hidden accounts have no row today and are naturally excluded.
2. Call a new `exportScoresToSql(connectionString, login, password, rows)` in `backend/src/clients/sqlClient.ts`. It reuses the existing module-level connection pool and transient-error retry. Inside one transaction: `DELETE FROM [analytics].[AccountHealthScores]` then bulk insert all rows (~268). Full snapshot replace — simple, idempotent, no MERGE logic.
3. Row mapping: `ClientId` = `accountId` (GUID), `Score` = `score` (nullable), `Tier` = `tier`, `ScoreDate` = score row's `date`, `UpdatedAt` = export time (UTC now).
4. Export failure is **non-fatal**: log the error and append to `SyncResult.errors`, but the sync still completes. Table Storage remains the source of truth; the SQL table is a derived feed.
5. `SyncResult` gains `scoresExported: number`.
6. The export runs only when `dataSource === 'sql'` (same credentials, no new env vars).

## Testing

- **Unit tests** (jest, mocked `mssql`): `exportScoresToSql` transaction semantics (delete + insert in one transaction, rollback on failure), row mapping including NULL score, empty-row-set behavior; SyncRunner wiring (export called with today's snapshot, failure is non-fatal and recorded in `errors`).
- **Smoke test** (real traffic, per global rules): `backend/scripts/smoke-test-sql-scores.ts` — checks env vars, reads today's actual scores from Table Storage, runs the real export against the live DB, reads back the row count and a sample row, prints elapsed ms. Exits 0 on success, non-zero with a hint on failure. Safe to run repeatedly (snapshot replace is idempotent).

## Rollout

1. Run `create-account-health-scores.sql` against `AccountsControl` as admin (CREATE + GRANT).
2. Deploy backend (`bash backend/scripts/deploy.sh`).
3. Trigger manual sync (`POST /api/sync`).
4. Run the smoke test; verify row count ≈ number of active accounts.
5. In PowerBI: add `[analytics].[AccountHealthScores]` to the existing AccountsControl dataset, relate to `[analytics].[ClientsOverview]` on `ClientId`.

## PowerBI Usage Example

```sql
SELECT c.Company, c.HubspotSuccessManager, c.ACV, s.Score, s.Tier, s.ScoreDate
FROM [analytics].[ClientsOverview] c
LEFT JOIN [analytics].[AccountHealthScores] s ON s.ClientId = c.ClientId
WHERE c.IsCanceled = 0;
```
