export interface FeatureEvent {
  category: string;
  eventType: string;
}

const DEFAULT_FEATURE_EVENTS: FeatureEvent[] = [
  { category: 'Activity Center', eventType: 'Activity Created' },
  { category: 'Time Tracking', eventType: 'Activity Time Submitted' },
  { category: 'Resources', eventType: 'Allocation Created' },
  { category: 'Reporting', eventType: 'Page Viewed - Custom Report' },
  { category: 'Dashboards', eventType: 'Page Viewed - Dashboard' },
  { category: 'Financials', eventType: 'Activities In Budget Updated' },
  { category: 'Invoices', eventType: 'Add Invoice Clicked' },
  { category: 'Custom Forms', eventType: 'Page Viewed - Custom Form Records' },
  { category: 'AI Features', eventType: 'AI Chatbot Message Sent' },
  { category: 'Collaboration', eventType: 'Activity Message Added' },
  { category: 'Workload', eventType: 'Page Viewed - Workload' },
  { category: 'Settings', eventType: 'Page Viewed - Account Settings' },
];

export interface Config {
  storageConnectionString: string;
  tableAccounts: string;
  tableMapping: string;
  tableScores: string;
  hubspotApiKey: string;
  amplitudeApiKey: string;
  amplitudeSecretKey: string;
  amplitudeAccountProperty: string;
  amplitudeFeatureEvents: FeatureEvent[];
  zendeskSubdomain: string | null;
  zendeskEmail: string | null;
  zendeskApiToken: string | null;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function getConfig(): Config {
  const featureEventsJson = process.env.AMPLITUDE_FEATURE_EVENTS;
  let featureEvents = DEFAULT_FEATURE_EVENTS;
  if (featureEventsJson) {
    try {
      featureEvents = JSON.parse(featureEventsJson);
    } catch {
      console.warn('Invalid AMPLITUDE_FEATURE_EVENTS JSON, using defaults');
    }
  }

  return {
    storageConnectionString: requireEnv('AZURE_STORAGE_CONNECTION_STRING'),
    tableAccounts: process.env.AZURE_STORAGE_TABLE_ACCOUNTS ?? 'accounts',
    tableMapping: process.env.AZURE_STORAGE_TABLE_MAPPING ?? 'amplitudemapping',
    tableScores: process.env.AZURE_STORAGE_TABLE_SCORES ?? 'churnscores',
    hubspotApiKey: requireEnv('HUBSPOT_API_KEY'),
    amplitudeApiKey: requireEnv('AMPLITUDE_API_KEY'),
    amplitudeSecretKey: requireEnv('AMPLITUDE_SECRET_KEY'),
    amplitudeAccountProperty: process.env.AMPLITUDE_ACCOUNT_PROPERTY ?? 'gp:alias',
    amplitudeFeatureEvents: featureEvents,
    zendeskSubdomain: process.env.ZENDESK_SUBDOMAIN ?? null,
    zendeskEmail: process.env.ZENDESK_EMAIL ?? null,
    zendeskApiToken: process.env.ZENDESK_API_TOKEN ?? null,
  };
}
