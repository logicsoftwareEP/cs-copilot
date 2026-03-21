/**
 * Find aliases that exist in SQL but return 0 results from Amplitude's `is` filter.
 * For each unmatched alias, try `contains` to find the correct casing.
 * Outputs a list of corrections to apply to the mapping table.
 *
 * Usage: npx ts-node scripts/find-unmatched-aliases.ts
 */

import { fetchAccountsFromSql } from '../src/clients/sqlClient';

const AMP_API_KEY = process.env.AMPLITUDE_API_KEY!;
const AMP_SECRET  = process.env.AMPLITUDE_SECRET_KEY!;
const SQL_CONN    = process.env.SQL_SERVER_DETAILS!;
const SQL_LOGIN   = process.env.SQL_LOGIN!;
const SQL_PASS    = process.env.SQL_PASSWORD!;
const AMP_PROP    = process.env.AMPLITUDE_ACCOUNT_PROPERTY ?? 'gp:alias';

function buildAuth(): string {
  return `Basic ${Buffer.from(`${AMP_API_KEY}:${AMP_SECRET}`).toString('base64')}`;
}

function toAmpDate(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

async function queryAmplitude(alias: string, op: 'is' | 'contains'): Promise<number> {
  const e = JSON.stringify({
    event_type: '_active',
    filters: [{ subprop_type: 'user', subprop_key: AMP_PROP, subprop_op: op, subprop_value: [alias] }],
  });
  const now = new Date();
  const start = new Date(now); start.setDate(start.getDate() - 30);
  const params = new URLSearchParams({ e, m: 'uniques', i: '30', start: toAmpDate(start), end: toAmpDate(now) });

  const resp = await fetch(`https://amplitude.com/api/2/events/segmentation?${params}`, {
    headers: { Authorization: buildAuth() },
  });

  if (resp.status === 429) {
    // Rate limited — wait and retry
    console.log('  Rate limited, waiting 60s...');
    await new Promise(r => setTimeout(r, 60000));
    return queryAmplitude(alias, op);
  }

  if (!resp.ok) {
    console.warn(`  Amplitude ${resp.status} for ${alias}`);
    return 0;
  }

  const data = await resp.json() as any;
  return data?.data?.series?.[0]?.[0] ?? 0;
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  // 1. Get all aliases from SQL
  console.log('Fetching accounts from SQL...');
  const { aliases } = await fetchAccountsFromSql(SQL_CONN, SQL_LOGIN, SQL_PASS);
  console.log(`Found ${aliases.size} aliases in SQL\n`);

  // 2. Check each alias with 'is' — find unmatched ones
  const unmatched: Array<{ accountId: string; sqlAlias: string }> = [];
  const matched: string[] = [];
  let i = 0;

  console.log('Phase 1: Checking aliases with exact match (is)...');
  for (const [accountId, alias] of aliases) {
    i++;
    if (i % 20 === 0) console.log(`  Progress: ${i}/${aliases.size}`);

    const count = await queryAmplitude(alias, 'is');
    if (count === 0) {
      unmatched.push({ accountId, sqlAlias: alias });
    } else {
      matched.push(alias);
    }
    await sleep(350); // Stay under 100 req/min
  }

  console.log(`\nPhase 1 results: ${matched.length} matched, ${unmatched.length} unmatched\n`);

  if (unmatched.length === 0) {
    console.log('All aliases matched! Nothing to fix.');
    return;
  }

  // 3. For each unmatched alias, try 'contains' to find if it exists with different casing
  console.log('Phase 2: Trying contains for unmatched aliases...');
  const corrections: Array<{ accountId: string; sqlAlias: string; status: string; users: number }> = [];

  for (const { accountId, sqlAlias } of unmatched) {
    const containsCount = await queryAmplitude(sqlAlias, 'contains');
    if (containsCount > 0) {
      corrections.push({ accountId, sqlAlias, status: 'CASING_MISMATCH', users: containsCount });
      console.log(`  CASING_MISMATCH: ${sqlAlias} → ${containsCount} users (contains works, is doesn't)`);
    } else {
      corrections.push({ accountId, sqlAlias, status: 'NOT_IN_AMPLITUDE', users: 0 });
      console.log(`  NOT_IN_AMPLITUDE: ${sqlAlias} → 0 users with both operators`);
    }
    await sleep(350);
  }

  // 4. Summary
  const casingIssues = corrections.filter(c => c.status === 'CASING_MISMATCH');
  const notInAmp = corrections.filter(c => c.status === 'NOT_IN_AMPLITUDE');

  console.log('\n========================================');
  console.log('SUMMARY');
  console.log('========================================');
  console.log(`Total aliases in SQL: ${aliases.size}`);
  console.log(`Matched (is): ${matched.length}`);
  console.log(`Casing mismatch (contains works): ${casingIssues.length}`);
  console.log(`Not in Amplitude at all: ${notInAmp.length}`);

  if (casingIssues.length > 0) {
    console.log('\nCASING MISMATCHES (need correction):');
    for (const c of casingIssues) {
      console.log(`  ${c.sqlAlias} (accountId: ${c.accountId}) — ${c.users} users`);
    }
  }

  if (notInAmp.length > 0) {
    console.log('\nNOT IN AMPLITUDE (genuinely inactive):');
    for (const c of notInAmp) {
      console.log(`  ${c.sqlAlias} (accountId: ${c.accountId})`);
    }
  }

  // Output as JSON for further processing
  const outputPath = './scripts/unmatched-aliases.json';
  const fs = require('fs');
  fs.writeFileSync(outputPath, JSON.stringify({ matched: matched.length, casingIssues, notInAmplitude: notInAmp }, null, 2));
  console.log(`\nResults saved to ${outputPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
