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
