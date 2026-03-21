/**
 * Bootstrap the first admin user.
 * Usage: npx ts-node scripts/seed-admin.ts
 * Requires AZURE_STORAGE_CONNECTION_STRING env var.
 */
import { UserStore } from '../src/services/userStore';

const CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING;
if (!CONNECTION_STRING) {
  console.error('Set AZURE_STORAGE_CONNECTION_STRING');
  process.exit(1);
}

(async () => {
  const store = new UserStore(CONNECTION_STRING, 'users');
  await store.ensureTable();
  await store.upsertUser('vadim@logicsoftware.net', 'Vadim', 'admin');
  console.log('Seeded admin: vadim@logicsoftware.net');
})().catch(e => { console.error(e); process.exit(1); });
