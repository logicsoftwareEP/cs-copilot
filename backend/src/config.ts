export interface Config {
  storageConnectionString: string;
  tableAccounts: string;
  tableMapping: string;
  tableScores: string;
  n8nSyncWebhookUrl: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function getConfig(): Config {
  return {
    storageConnectionString: requireEnv('AZURE_STORAGE_CONNECTION_STRING'),
    tableAccounts: process.env.AZURE_STORAGE_TABLE_ACCOUNTS ?? 'accounts',
    tableMapping: process.env.AZURE_STORAGE_TABLE_MAPPING ?? 'amplitudemapping',
    tableScores: process.env.AZURE_STORAGE_TABLE_SCORES ?? 'churnscores',
    n8nSyncWebhookUrl: requireEnv('N8N_SYNC_WEBHOOK_URL'),
  };
}
