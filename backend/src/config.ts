export interface Config {
  storageConnectionString: string;
  tableAccounts: string;
  tableMapping: string;
  tableScores: string;
  hubspotApiKey: string;
  amplitudeApiKey: string;
  amplitudeSecretKey: string;
  amplitudeAccountProperty: string;
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
    hubspotApiKey: requireEnv('HUBSPOT_API_KEY'),
    amplitudeApiKey: requireEnv('AMPLITUDE_API_KEY'),
    amplitudeSecretKey: requireEnv('AMPLITUDE_SECRET_KEY'),
    amplitudeAccountProperty: process.env.AMPLITUDE_ACCOUNT_PROPERTY ?? 'account_name',
  };
}
