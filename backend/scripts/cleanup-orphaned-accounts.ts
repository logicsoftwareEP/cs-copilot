/**
 * One-time cleanup: delete old accounts keyed by numeric HubSpotCompanyId.
 * After the ClientId migration, these are orphaned duplicates.
 *
 * Usage: npx ts-node scripts/cleanup-orphaned-accounts.ts
 */
import { TableClient } from '@azure/data-tables';
import * as fs from 'fs';
import * as path from 'path';

const settingsPath = path.join(__dirname, '..', 'local.settings.json');
const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
for (const [k, v] of Object.entries(settings.Values ?? {})) {
  if (!process.env[k]) process.env[k] = v as string;
}

async function cleanup(tableName: string, partitionKey: string, label: string, isOrphan: (rowKey: string) => boolean) {
  const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING!;
  const client = TableClient.fromConnectionString(connStr, tableName);
  let deleted = 0;

  for await (const entity of client.listEntities({ queryOptions: { filter: `PartitionKey eq '${partitionKey}'` } })) {
    if (isOrphan(entity.rowKey as string)) {
      await client.deleteEntity(partitionKey, entity.rowKey as string);
      deleted++;
    }
  }
  console.log(`${label}: deleted ${deleted} orphaned rows`);
}

// For churnscores, partitionKey IS the accountId
async function cleanupScores() {
  const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING!;
  const client = TableClient.fromConnectionString(connStr, 'churnscores');
  let deleted = 0;

  for await (const entity of client.listEntities()) {
    const pk = entity.partitionKey as string;
    // Orphaned = numeric partition key (no hyphens = old HubSpotCompanyId)
    if (!pk.includes('-')) {
      await client.deleteEntity(pk, entity.rowKey as string);
      deleted++;
    }
  }
  console.log(`churnscores: deleted ${deleted} orphaned rows`);
}

async function main() {
  const isNumeric = (key: string) => !key.includes('-');

  await cleanup('accounts', 'accounts', 'accounts', isNumeric);
  await cleanup('amplitudemapping', 'mapping', 'amplitudemapping', isNumeric);
  await cleanupScores();

  console.log('Done!');
}

main().catch(err => { console.error(err); process.exit(1); });
