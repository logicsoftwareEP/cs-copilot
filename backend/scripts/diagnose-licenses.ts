/**
 * Diagnose license mismatches between SQL Server and Table Storage.
 * Shows: duplicate SQL rows per account, SQL vs stored license values.
 *
 * Usage: npx ts-node scripts/diagnose-licenses.ts
 * Requires env vars: SQL_SERVER_DETAILS, SQL_LOGIN, SQL_PASSWORD, AZURE_STORAGE_CONNECTION_STRING
 */
import sql from 'mssql';
import { TableClient, odata } from '@azure/data-tables';
import * as fs from 'fs';
import * as path from 'path';

// Load env from local.settings.json
const settingsPath = path.join(__dirname, '..', 'local.settings.json');
const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
for (const [k, v] of Object.entries(settings.Values ?? {})) {
  if (!process.env[k]) process.env[k] = v as string;
}

async function main() {
  const connStr = process.env.SQL_SERVER_DETAILS!;
  const login = process.env.SQL_LOGIN!;
  const password = process.env.SQL_PASSWORD!;
  const storageConn = process.env.AZURE_STORAGE_CONNECTION_STRING!;

  // Connect to SQL
  const serverMatch = connStr.match(/Server\s*=\s*(?:tcp:)?([^,;]+)(?:,(\d+))?/i);
  const dbMatch = connStr.match(/Database\s*=\s*([^;]+)/i);
  const pool = await new sql.ConnectionPool({
    server: serverMatch![1],
    port: serverMatch![2] ? parseInt(serverMatch![2], 10) : 1433,
    database: dbMatch?.[1] ?? '',
    user: login,
    password,
    options: { encrypt: true, trustServerCertificate: false },
  }).connect();

  const result = await pool.request().query<{
    HubSpotCompanyId: number | null;
    Company: string | null;
    Licenses: number | null;
  }>(`SELECT HubSpotCompanyId, Company, Licenses
      FROM [analytics].[ClientsOverview]
      WHERE IsCanceled = 0
      ORDER BY HubSpotCompanyId`);

  // Group SQL rows by accountId to detect duplicates
  const sqlByAccount = new Map<string, { company: string; licenses: (number | null)[] }>();
  for (const row of result.recordset) {
    if (!row.HubSpotCompanyId) continue;
    const id = String(row.HubSpotCompanyId);
    const entry = sqlByAccount.get(id) ?? { company: row.Company ?? '', licenses: [] };
    entry.licenses.push(row.Licenses);
    sqlByAccount.set(id, entry);
  }

  // Show duplicate rows
  const duplicates = [...sqlByAccount.entries()].filter(([, v]) => v.licenses.length > 1);
  console.log(`\n=== SQL DUPLICATES (${duplicates.length} accounts with multiple rows) ===`);
  for (const [id, { company, licenses }] of duplicates) {
    console.log(`  ${id} "${company}": ${licenses.join(', ')} (last-write-wins: ${licenses[licenses.length - 1]})`);
  }

  // Load Table Storage accounts
  const tableClient = TableClient.fromConnectionString(storageConn, 'accounts');
  const stored = new Map<string, { name: string; licenses: number | null }>();
  for await (const entity of tableClient.listEntities<{
    partitionKey: string; rowKey: string; accountName: string; licenses?: number | null;
  }>({ queryOptions: { filter: odata`PartitionKey eq 'accounts'` } })) {
    stored.set(entity.rowKey, { name: entity.accountName, licenses: entity.licenses ?? null });
  }

  // Compare: SQL "effective" license (last value in map) vs stored
  console.log(`\n=== LICENSE MISMATCHES (SQL vs Table Storage) ===`);
  let mismatches = 0;
  for (const [id, { company, licenses }] of sqlByAccount) {
    // SQL effective: last positive value, or null
    const sqlEffective = licenses.filter(l => l != null && l > 0);
    const sqlLicense = sqlEffective.length > 0 ? sqlEffective[sqlEffective.length - 1] : null;
    const storedEntry = stored.get(id);
    const storedLicense = storedEntry?.licenses ?? null;

    if (sqlLicense !== storedLicense) {
      mismatches++;
      console.log(`  ${id} "${company}": SQL=${sqlLicense}, Stored=${storedLicense}`);
    }
  }
  if (mismatches === 0) console.log('  (none)');
  console.log(`\nTotal: ${sqlByAccount.size} SQL accounts, ${stored.size} stored accounts, ${mismatches} mismatches`);

  await pool.close();
}

main().catch(err => { console.error(err); process.exit(1); });
