# PowerBI Health Score Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At the end of every sync, write the latest health score per account to a SQL Server table (`[analytics].[AccountHealthScores]`) so PowerBI can join scores to `[analytics].[ClientsOverview]` on `ClientId`.

**Architecture:** A new `exportScoresToSql()` in `backend/src/clients/sqlClient.ts` does a full snapshot replace (DELETE + bulk INSERT in one transaction, reusing the existing connection pool and transient-retry policy). `runSync()` in `backend/src/functions/SyncRunner.ts` calls it after the scoring loop with today's score snapshot from Table Storage; failure is non-fatal. A one-time DDL script creates the table; a smoke test exercises the real export against the live DB.

**Tech Stack:** Azure Functions v4, Node.js 20, TypeScript (CommonJS), `mssql` ^12, jest + ts-jest. Spec: `docs/superpowers/specs/2026-06-10-powerbi-scores-export-design.md`.

**Working conventions for this repo:**
- All commands run from `backend/` unless noted.
- Run a single test file: `npx jest src/__tests__/clients/sqlClient.test.ts` (wrap in `timeout 120` on bash).
- Tests must never hit real network — `mssql` is mocked in unit tests.

---

### Task 1: DDL script for the SQL table

**Files:**
- Create: `backend/scripts/sql/create-account-health-scores.sql`

No unit test — this is a script the admin runs manually, once, against the `AccountsControl` database.

- [ ] **Step 1: Create the DDL script**

```sql
-- Creates the PowerBI score export table in the AccountsControl database.
-- Run ONCE as an admin. Then replace <app_user> with the database user
-- mapped to the app's SQL_LOGIN and run the GRANT.
--
-- The app does DELETE + bulk INSERT on every sync (full snapshot replace),
-- so it needs SELECT, INSERT, DELETE — not UPDATE.

IF OBJECT_ID('[analytics].[AccountHealthScores]', 'U') IS NULL
BEGIN
    CREATE TABLE [analytics].[AccountHealthScores] (
        ClientId   UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
        Score      INT          NULL,         -- 0-100, NULL when not computable
        Tier       NVARCHAR(20) NOT NULL,     -- healthy | watch | at-risk | critical | unmapped
        ScoreDate  DATE         NOT NULL,     -- date the score was computed for
        UpdatedAt  DATETIME2    NOT NULL      -- when the sync wrote this row
    );
END;
GO

GRANT SELECT, INSERT, DELETE ON [analytics].[AccountHealthScores] TO [<app_user>];
GO
```

- [ ] **Step 2: Commit**

```bash
git add backend/scripts/sql/create-account-health-scores.sql
git commit -m "feat: DDL script for AccountHealthScores PowerBI export table"
```

---

### Task 2: `exportScoresToSql()` in sqlClient (TDD)

**Files:**
- Create: `backend/src/__tests__/clients/sqlClient.test.ts`
- Modify: `backend/src/clients/sqlClient.ts` (append after `fetchAccountsFromSql`)

The function does a full snapshot replace inside one transaction: `DELETE FROM [analytics].[AccountHealthScores]`, then bulk insert of all rows. Empty input is a no-op (never wipe the table on an empty snapshot). Transient SQL errors retry the whole transaction up to 3 times (same `isTransient` policy as `queryWithRetry`); non-transient errors roll back and rethrow.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/__tests__/clients/sqlClient.test.ts`:

```typescript
// Unit tests for exportScoresToSql. mssql is fully mocked — no real network.
jest.mock('mssql', () => {
  const begin = jest.fn().mockResolvedValue(undefined);
  const commit = jest.fn().mockResolvedValue(undefined);
  const rollback = jest.fn().mockResolvedValue(undefined);
  const query = jest.fn().mockResolvedValue({ recordset: [] });
  const bulk = jest.fn().mockResolvedValue({ rowsAffected: 0 });
  const tables: any[] = [];

  class MockTable {
    name: string;
    create = true;
    columnList: any[] = [];
    rowList: any[] = [];
    columns = { add: (...args: any[]) => this.columnList.push(args) };
    rows = { add: (...args: any[]) => this.rowList.push(args) };
    constructor(name: string) {
      this.name = name;
      tables.push(this);
    }
  }
  class MockTransaction {
    begin = begin;
    commit = commit;
    rollback = rollback;
  }
  class MockRequest {
    query = query;
    bulk = bulk;
  }
  class MockConnectionPool {
    connected = true;
    connect = jest.fn().mockImplementation(async () => this);
    request = () => new MockRequest();
  }

  return {
    __esModule: true,
    default: {
      ConnectionPool: MockConnectionPool,
      Transaction: MockTransaction,
      Request: MockRequest,
      Table: MockTable,
      UniqueIdentifier: 'UniqueIdentifier',
      Int: 'Int',
      NVarChar: (n: number) => `NVarChar(${n})`,
      Date: 'SqlDate',
      DateTime2: 'DateTime2',
      __mocks: { begin, commit, rollback, query, bulk, tables },
    },
  };
});

import { exportScoresToSql, ScoreExportRow } from '../../clients/sqlClient';

const { begin, commit, rollback, query, bulk, tables } =
  jest.requireMock('mssql').default.__mocks;

const CONN = 'Server=tcp:test.database.windows.net,1433;Database=TestDB';
const ROW_A: ScoreExportRow = {
  clientId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  score: 75,
  tier: 'healthy',
  scoreDate: '2026-06-10',
};
const ROW_B: ScoreExportRow = {
  clientId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
  score: null,
  tier: 'unmapped',
  scoreDate: '2026-06-10',
};

beforeEach(() => {
  jest.clearAllMocks();
  tables.length = 0;
});

describe('exportScoresToSql', () => {
  it('deletes existing rows then bulk-inserts the snapshot in one transaction', async () => {
    const written = await exportScoresToSql(CONN, 'user', 'pass', [ROW_A, ROW_B]);

    expect(written).toBe(2);
    expect(begin).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM [analytics].[AccountHealthScores]')
    );
    expect(bulk).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(rollback).not.toHaveBeenCalled();

    // Table targets the right name and carries both rows
    expect(tables).toHaveLength(1);
    expect(tables[0].name).toBe('analytics.AccountHealthScores');
    expect(tables[0].create).toBe(false);
    expect(tables[0].rowList).toHaveLength(2);
    // Row shape: [ClientId, Score, Tier, ScoreDate, UpdatedAt]
    expect(tables[0].rowList[0][0]).toBe(ROW_A.clientId);
    expect(tables[0].rowList[0][1]).toBe(75);
    expect(tables[0].rowList[0][2]).toBe('healthy');
    expect(tables[0].rowList[0][3]).toEqual(new Date('2026-06-10'));
    expect(tables[0].rowList[0][4]).toBeInstanceOf(Date);
  });

  it('maps a null score to a NULL column value', async () => {
    await exportScoresToSql(CONN, 'user', 'pass', [ROW_B]);

    expect(tables[0].rowList[0][1]).toBeNull();
    expect(tables[0].rowList[0][2]).toBe('unmapped');
  });

  it('is a no-op for an empty snapshot — never wipes the table', async () => {
    const written = await exportScoresToSql(CONN, 'user', 'pass', []);

    expect(written).toBe(0);
    expect(begin).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(bulk).not.toHaveBeenCalled();
  });

  it('rolls back and rethrows on a non-transient bulk failure', async () => {
    bulk.mockRejectedValueOnce(new Error('String or binary data would be truncated'));

    await expect(
      exportScoresToSql(CONN, 'user', 'pass', [ROW_A])
    ).rejects.toThrow('String or binary data would be truncated');

    expect(rollback).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
  });

  it('retries the whole transaction on a transient error, then succeeds', async () => {
    const transientErr = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    bulk.mockRejectedValueOnce(transientErr);

    const written = await exportScoresToSql(CONN, 'user', 'pass', [ROW_A]);

    expect(written).toBe(1);
    expect(begin).toHaveBeenCalledTimes(2);   // first attempt + retry
    expect(rollback).toHaveBeenCalledTimes(1); // failed attempt rolled back
    expect(commit).toHaveBeenCalledTimes(1);   // retry committed
  }, 15000); // retry sleeps 1s — allow headroom
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend
npx jest src/__tests__/clients/sqlClient.test.ts
```

Expected: FAIL — `exportScoresToSql` is not exported from `../../clients/sqlClient` (TS2305 or "is not a function").

- [ ] **Step 3: Implement `exportScoresToSql`**

Append to `backend/src/clients/sqlClient.ts` (after `fetchAccountsFromSql`, reusing the existing `getPool`, `isTransient`, `sleep` helpers already in the file):

```typescript
export interface ScoreExportRow {
  clientId: string;   // account GUID (= ClientId in [analytics].[ClientsOverview])
  score: number | null;
  tier: string;
  scoreDate: string;  // YYYY-MM-DD
}

/**
 * Replace the contents of [analytics].[AccountHealthScores] with the given
 * snapshot: DELETE all rows + bulk INSERT, in one transaction. Retries the
 * whole transaction on transient errors (same policy as queryWithRetry).
 * Empty input is a no-op — never wipes the table on an empty snapshot.
 * Returns the number of rows written.
 */
export async function exportScoresToSql(
  connectionString: string,
  login: string,
  password: string,
  rows: ScoreExportRow[],
  retries = 3
): Promise<number> {
  if (rows.length === 0) return 0;

  const p = await getPool(connectionString, login, password);

  for (let attempt = 1; attempt <= retries; attempt++) {
    const transaction = new sql.Transaction(p);
    try {
      await transaction.begin();
      await new sql.Request(transaction)
        .query('DELETE FROM [analytics].[AccountHealthScores]');

      const table = new sql.Table('analytics.AccountHealthScores');
      table.create = false;
      table.columns.add('ClientId', sql.UniqueIdentifier, { nullable: false });
      table.columns.add('Score', sql.Int, { nullable: true });
      table.columns.add('Tier', sql.NVarChar(20), { nullable: false });
      table.columns.add('ScoreDate', sql.Date, { nullable: false });
      table.columns.add('UpdatedAt', sql.DateTime2, { nullable: false });

      const now = new Date();
      for (const row of rows) {
        table.rows.add(row.clientId, row.score, row.tier, new Date(row.scoreDate), now);
      }

      await new sql.Request(transaction).bulk(table);
      await transaction.commit();
      return rows.length;
    } catch (err) {
      try {
        await transaction.rollback();
      } catch {
        // transaction never began or was already aborted — nothing to roll back
      }
      if (attempt === retries || !isTransient(err)) throw err;
      await sleep(1000 * Math.pow(2, attempt - 1)); // 1s, 2s
    }
  }
  throw new Error('exportScoresToSql: unreachable');
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest src/__tests__/clients/sqlClient.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Run the full suite + build to check nothing broke**

```bash
npx jest && npm run build
```

Expected: all suites pass (183 existing tests + 5 new), `tsc` clean.

- [ ] **Step 6: Commit**

```bash
git add src/clients/sqlClient.ts src/__tests__/clients/sqlClient.test.ts
git commit -m "feat: exportScoresToSql — snapshot-replace score export for PowerBI"
```

---

### Task 3: Wire the export into `runSync()` (TDD)

**Files:**
- Modify: `backend/src/__tests__/services/SyncRunner.test.ts`
- Modify: `backend/src/functions/SyncRunner.ts`

After the scoring loop, re-fetch today's scores from `churnscores` (`getAllScoresForDate(todayISO)`) — the complete current snapshot including accounts skipped for already having a valid score — and export. Runs only when `dataSource === 'sql'`. Failure is non-fatal: logged + recorded in `errors`, sync still succeeds. `SyncResult` gains `scoresExported: number`.

- [ ] **Step 1: Add failing tests to SyncRunner.test.ts**

In `backend/src/__tests__/services/SyncRunner.test.ts`:

(a) Extend the existing sqlClient import (line 22) to include the new export:

```typescript
import { fetchAccountsFromSql, exportScoresToSql } from '../../clients/sqlClient';
```

(b) Next to the other mock typings (around line 45), add:

```typescript
const mockExportScoresToSql = exportScoresToSql as jest.MockedFunction<typeof exportScoresToSql>;
```

(c) In the top-level `beforeEach` (around line 175), add a default so existing SQL-path tests keep working:

```typescript
  mockExportScoresToSql.mockResolvedValue(0); // default: export succeeds, 0 rows
```

(d) Add a new describe block at the end of the `runSync` describe (after the Intercom tests), reusing the existing `enableSqlConfig`/`disableSqlConfig` helpers and `COMPANY_A`:

```typescript
  // ── PowerBI SQL score export tests ──────────────────────────────────────

  it("SQL data source: exports today's score snapshot to SQL after scoring", async () => {
    enableSqlConfig();
    const todayISO = new Date().toISOString().slice(0, 10);

    // COMPANY_A already has a valid score today → scoring skips it, but the
    // export must still ship the snapshot row.
    const todayScoreMap = new Map<string, any>([
      [COMPANY_A.accountId, { accountId: COMPANY_A.accountId, date: todayISO, score: 75, tier: 'healthy' }],
    ]);

    setupStoreMocks({
      mappings: [{ accountId: COMPANY_A.accountId, amplitudeAlias: 'alpha' }],
      todayScores: todayScoreMap,
    });

    mockFetchAccountsFromSql.mockResolvedValue({
      accounts: [COMPANY_A],
      aliases: new Map(),
      licences: new Map(),
    });
    mockExportScoresToSql.mockResolvedValue(1);

    const result = await runSync();

    expect(mockExportScoresToSql).toHaveBeenCalledTimes(1);
    expect(mockExportScoresToSql).toHaveBeenCalledWith(
      'Server=tcp:test.database.windows.net,1433;Database=TestDB',
      'testuser',
      'testpass',
      [{ clientId: COMPANY_A.accountId, score: 75, tier: 'healthy', scoreDate: todayISO }]
    );
    expect(result.scoresExported).toBe(1);
    expect(result.errors).toHaveLength(0);

    disableSqlConfig();
  });

  it('SQL export failure is non-fatal: sync completes, error recorded', async () => {
    enableSqlConfig();
    setupStoreMocks({
      mappings: [{ accountId: COMPANY_A.accountId, amplitudeAlias: 'alpha' }],
    });

    mockFetchAccountsFromSql.mockResolvedValue({
      accounts: [COMPANY_A],
      aliases: new Map(),
      licences: new Map(),
    });
    mockFetchSignals.mockResolvedValue(GOOD_SIGNALS);
    mockExportScoresToSql.mockRejectedValue(new Error('Invalid object name AccountHealthScores'));

    const result = await runSync();

    expect(result.synced).toBe(1);
    expect(result.scored).toBe(1);          // sync itself succeeded
    expect(result.scoresExported).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Invalid object name');

    disableSqlConfig();
  });

  it('HubSpot data source: SQL export is skipped', async () => {
    // default config from beforeAll is DATA_SOURCE=hubspot
    setupStoreMocks({
      mappings: [{ accountId: COMPANY_A.accountId, amplitudeAlias: 'alpha' }],
    });

    mockSearchActiveCompanies.mockResolvedValue([COMPANY_A]);
    mockFetchSignals.mockResolvedValue(GOOD_SIGNALS);

    const result = await runSync();

    expect(mockExportScoresToSql).not.toHaveBeenCalled();
    expect(result.scoresExported).toBe(0);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest src/__tests__/services/SyncRunner.test.ts
```

Expected: FAIL — the 3 new tests fail (`exportScoresToSql` never called / `scoresExported` undefined). Existing tests must still pass; if TypeScript complains that `scoresExported` doesn't exist on `SyncResult`, that's the same failure signal — proceed.

- [ ] **Step 3: Implement the export step in SyncRunner.ts**

In `backend/src/functions/SyncRunner.ts`:

(a) Extend the sqlClient import (line 8):

```typescript
import { fetchAccountsFromSql, SqlFetchResult, exportScoresToSql, ScoreExportRow } from '../clients/sqlClient';
```

(b) Add `scoresExported` to `SyncResult` (after `intercomFetched`, line 30):

```typescript
export interface SyncResult {
  synced: number;   // accounts upserted to accountStore
  scored: number;   // accounts with a score computed
  failed: number;   // accounts where Amplitude fetch failed
  zendeskFetched: number; // domains with Zendesk data fetched
  intercomFetched: number; // domains with Intercom data fetched
  scoresExported: number; // rows written to SQL [analytics].[AccountHealthScores]
  errors: string[]; // error messages
}
```

(c) After the scoring loop — between `if (skipped > 0) log(...)` and the `return` (lines 318–319) — add the export step:

```typescript
    if (skipped > 0) log(`Skipped ${skipped} accounts with existing valid scores`);

    // ── Export latest scores to SQL for PowerBI ──────────────────────────
    // Today's churnscores rows are the complete current snapshot: accounts
    // skipped during scoring already have today's row; hidden accounts have
    // none. Failure is non-fatal — Table Storage stays the source of truth.
    let scoresExported = 0;
    if (config.dataSource === 'sql' && config.sqlConnectionString && config.sqlLogin && config.sqlPassword) {
      try {
        const finalScores = await scoreStore.getAllScoresForDate(todayISO);
        const exportRows: ScoreExportRow[] = [...finalScores.values()].map(s => ({
          clientId: s.accountId,
          score: s.score,
          tier: s.tier,
          scoreDate: s.date,
        }));
        scoresExported = await exportScoresToSql(
          config.sqlConnectionString, config.sqlLogin, config.sqlPassword, exportRows
        );
        log(`Exported ${scoresExported} scores to [analytics].[AccountHealthScores] for PowerBI`);
      } catch (err: any) {
        const msg = `SQL score export failed (non-fatal): ${err?.message ?? err}`;
        log(msg);
        errors.push(msg);
      }
    }

    return { synced: companies.length, scored, failed, zendeskFetched, intercomFetched, scoresExported, errors };
```

(d) Update the outer catch return (line 322) to include the new field:

```typescript
    return { synced: 0, scored: 0, failed: 0, zendeskFetched: 0, intercomFetched: 0, scoresExported: 0, errors: [msg] };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest src/__tests__/services/SyncRunner.test.ts
```

Expected: PASS — all SyncRunner tests including the 3 new ones.

- [ ] **Step 5: Run the full suite + build**

```bash
npx jest && npm run build
```

Expected: all green. If any other code constructs a `SyncResult` literal (search: `grep -rn "zendeskFetched" src/ --include="*.ts"`), add `scoresExported` there too.

- [ ] **Step 6: Commit**

```bash
git add src/functions/SyncRunner.ts src/__tests__/services/SyncRunner.test.ts
git commit -m "feat: export latest health scores to SQL after each sync"
```

---

### Task 4: Real-traffic smoke test

**Files:**
- Modify: `backend/src/clients/sqlClient.ts` (export `getPool` so the script can run a read-back query)
- Create: `backend/scripts/smoke-test-sql-scores.ts`
- Modify: `backend/package.json` (add `smoke:sql-scores` script)

No jest test — this IS the test (live API, per global smoke-test rules). It must not run in CI/jest (it lives in `scripts/`, outside the jest test match).

- [ ] **Step 1: Export `getPool` from sqlClient.ts**

In `backend/src/clients/sqlClient.ts`, change the `getPool` declaration (line 32) from:

```typescript
async function getPool(
```

to:

```typescript
export async function getPool(
```

- [ ] **Step 2: Write the smoke test script**

Create `backend/scripts/smoke-test-sql-scores.ts`:

```typescript
/**
 * Smoke test: real-traffic SQL score export for PowerBI.
 * Reads today's (or yesterday's) actual scores from Table Storage, runs the
 * REAL export against the live AccountsControl DB, reads the table back.
 *
 * Usage: npx ts-node scripts/smoke-test-sql-scores.ts
 *        (or: npm run smoke:sql-scores)
 * Env: AZURE_STORAGE_CONNECTION_STRING, SQL_SERVER_DETAILS, SQL_LOGIN,
 *      SQL_PASSWORD — auto-loaded from local.settings.json when not set.
 *
 * Safe to run repeatedly: the export is an idempotent snapshot replace.
 * Does NOT commit, push, or deploy anything.
 */
import * as fs from 'fs';
import * as path from 'path';
import { ScoreStore } from '../src/services/scoreStore';
import { exportScoresToSql, getPool, ScoreExportRow } from '../src/clients/sqlClient';

// Load local.settings.json Values into process.env for any missing vars
const settingsPath = path.join(__dirname, '..', 'local.settings.json');
if (fs.existsSync(settingsPath)) {
  const values = JSON.parse(fs.readFileSync(settingsPath, 'utf8')).Values ?? {};
  for (const [k, v] of Object.entries(values)) {
    if (!process.env[k]) process.env[k] = String(v);
  }
}

const REQUIRED = ['AZURE_STORAGE_CONNECTION_STRING', 'SQL_SERVER_DETAILS', 'SQL_LOGIN', 'SQL_PASSWORD'];
const missing = REQUIRED.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error(`FAIL: missing env vars: ${missing.join(', ')}`);
  console.error('Set them directly or fill backend/local.settings.json Values.');
  process.exit(1);
}

(async () => {
  const started = Date.now();

  // 1. Read the latest real score snapshot from Table Storage
  const store = new ScoreStore(process.env.AZURE_STORAGE_CONNECTION_STRING!, 'churnscores');
  let date = new Date().toISOString().slice(0, 10);
  let scores = await store.getAllScoresForDate(date);
  if (scores.size === 0) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    console.log(`No scores for ${date}, falling back to ${yesterday}`);
    date = yesterday;
    scores = await store.getAllScoresForDate(date);
  }
  if (scores.size === 0) {
    console.error('FAIL: no scores found for today or yesterday — run a sync first (POST /api/sync)');
    process.exit(1);
  }
  console.log(`Read ${scores.size} scores from churnscores for ${date}`);

  // 2. Real export to SQL Server
  const rows: ScoreExportRow[] = [...scores.values()].map(s => ({
    clientId: s.accountId,
    score: s.score,
    tier: s.tier,
    scoreDate: s.date,
  }));
  const written = await exportScoresToSql(
    process.env.SQL_SERVER_DETAILS!, process.env.SQL_LOGIN!, process.env.SQL_PASSWORD!, rows
  );
  console.log(`Exported ${written} rows to [analytics].[AccountHealthScores]`);

  // 3. Read back and verify
  const pool = await getPool(
    process.env.SQL_SERVER_DETAILS!, process.env.SQL_LOGIN!, process.env.SQL_PASSWORD!
  );
  const count = await pool.request()
    .query('SELECT COUNT(*) AS cnt FROM [analytics].[AccountHealthScores]');
  const cnt: number = count.recordset[0].cnt;
  const sample = await pool.request()
    .query('SELECT TOP 1 ClientId, Score, Tier, ScoreDate, UpdatedAt FROM [analytics].[AccountHealthScores] ORDER BY UpdatedAt DESC');
  console.log('Sample row:', sample.recordset[0]);

  if (cnt !== written) {
    console.error(`FAIL: row count mismatch — wrote ${written}, table has ${cnt}`);
    process.exit(1);
  }

  console.log(`OK: ${cnt} rows in [analytics].[AccountHealthScores]. Elapsed ${Date.now() - started} ms`);
  await pool.close();
  process.exit(0);
})().catch(err => {
  const msg = String(err?.message ?? err);
  console.error('Smoke test FAILED:', msg);
  if (/login failed|permission|denied/i.test(msg)) {
    console.error('Hint: run backend/scripts/sql/create-account-health-scores.sql GRANT for the SQL_LOGIN user.');
  }
  if (/invalid object name/i.test(msg)) {
    console.error('Hint: table missing — run backend/scripts/sql/create-account-health-scores.sql as admin first.');
  }
  process.exit(1);
});
```

- [ ] **Step 3: Add the npm script**

In `backend/package.json` scripts block, after `"test:watch"`:

```json
    "test:watch": "jest --watch",
    "smoke:sql-scores": "npx ts-node scripts/smoke-test-sql-scores.ts"
```

- [ ] **Step 4: Verify it compiles and fails loud without the table**

```bash
npx jest && npm run build
npm run smoke:sql-scores
```

Expected: jest + build green. The smoke run depends on environment state:
- If the DDL has NOT been run yet: exits non-zero with the "table missing" hint — that is the correct fail-loud behavior; rollout (Task 6) re-runs it after the DDL.
- If the DDL HAS been run: prints row count + sample row + elapsed ms, exits 0.

Either outcome verifies the script works. Paste the actual output into the task notes.

- [ ] **Step 5: Commit**

```bash
git add src/clients/sqlClient.ts scripts/smoke-test-sql-scores.ts package.json
git commit -m "feat: smoke test for SQL score export (real traffic)"
```

---

### Task 5: Documentation updates

**Files:**
- Modify: `CLAUDE.md` (repo root)
- Modify: `progress.md` (repo root)

- [ ] **Step 1: Update CLAUDE.md**

(a) In the **Functions** section, extend the `SyncRunner.ts` bullet:

```markdown
- `SyncRunner.ts` - Timer trigger (2 AM UTC daily) + `runSync()` export. Orchestrates: SQL Server → accounts table, Amplitude → health scores, Zendesk → penalties. After scoring, exports the latest score per account to SQL `[analytics].[AccountHealthScores]` for PowerBI (snapshot replace; non-fatal on failure).
```

(b) In the **Data Source** section, append a paragraph:

```markdown
**PowerBI export:** after every sync, the latest score per account is written to `[analytics].[AccountHealthScores]` in the same `AccountsControl` database (full snapshot replace: DELETE + bulk INSERT). PowerBI joins it to `[analytics].[ClientsOverview]` on `ClientId`. One-time setup: run `backend/scripts/sql/create-account-health-scores.sql` as admin (CREATE + GRANT SELECT/INSERT/DELETE to the app login). Verify with `npm run smoke:sql-scores`.
```

(c) Note: backend test count in CLAUDE.md ("183 tests, 13 suites") — update to the actual post-change numbers from the final `npx jest` run (Task 4 Step 4 output).

- [ ] **Step 2: Update progress.md**

Append an entry (match the existing format in the file):

```markdown
## 2026-06-10: PowerBI health score export

- New SQL table `[analytics].[AccountHealthScores]` (ClientId, Score, Tier, ScoreDate, UpdatedAt) in AccountsControl — DDL: `backend/scripts/sql/create-account-health-scores.sql`.
- `runSync()` now exports the latest score snapshot to SQL after scoring (snapshot replace, non-fatal on failure). `SyncResult.scoresExported` added.
- Smoke test: `npm run smoke:sql-scores` (real traffic — Table Storage read + live SQL write + read-back).
- Spec: `docs/superpowers/specs/2026-06-10-powerbi-scores-export-design.md`.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md progress.md
git commit -m "docs: PowerBI score export — CLAUDE.md + progress.md"
```

---

### Task 6: Rollout (manual, after merge — user-driven)

Not code steps; the executor stops before this and reports. Order matters:

- [ ] 1. User runs `backend/scripts/sql/create-account-health-scores.sql` against `AccountsControl` as admin (fill in the real app user in the GRANT).
- [ ] 2. Deploy: `bash backend/scripts/deploy.sh`.
- [ ] 3. Trigger manual sync: `POST /api/sync` (see CLAUDE.md Deploy Notes for the curl).
- [ ] 4. Run `cd backend && npm run smoke:sql-scores` — expect exit 0, row count ≈ active account count (~268). Paste output as evidence.
- [ ] 5. In PowerBI: add `[analytics].[AccountHealthScores]` to the existing AccountsControl dataset, relate to `[analytics].[ClientsOverview]` on `ClientId`.
