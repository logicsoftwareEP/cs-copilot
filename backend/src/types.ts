// Account as synced from the upstream source and stored in the `accounts` table.
// RowKey in Table Storage = accountId (stable, never changes).
export interface Account {
  accountId: string;
  accountName: string;
  csmName: string;
  csmEmail: string;
  arr: number;
  renewalDate: string;   // ISO date YYYY-MM-DD or empty string
  hubspotUrl: string;
  syncedAt: string;      // ISO timestamp of last sync
  licenses: number | null; // total paid licences; null = not yet entered
  domain: string;
  hidden: boolean;
}

// Mapping between an account and its Amplitude account alias.
export interface AmplitudeMapping {
  accountId: string;
  accountName: string;  // denormalised for display
  amplitudeAlias: string;
  createdAt: string;
  updatedAt: string;
}

// Health score for one account on one day, stored in the `churnscores` table.
// PartitionKey = accountId, RowKey = YYYY-MM-DD
export interface ChurnScore {
  accountId: string;
  date: string;                    // YYYY-MM-DD
  score: number | null;
  tier: HealthTier | 'unmapped';
  dauWauTrend: number | null;      // MAU trend: (current30dMAU - prior30dMAU) / prior30dMAU
  monthlyActiveUsers: number | null; // unique active users in the last 30 days (MAU)
  licenseUtilization: number | null; // MAU / licenses, 0–1; null when licenses not set
  featuresUsed: number | null;     // count of feature categories used in last 30 days
  featureDetails: string | null;   // JSON string of Record<string, boolean>
  scoreDelta: number | null;       // vs previous day
  computedAt: string;
  zendeskPenalty: number | null;
  zendeskDetails: string | null;
  aliasStatus: 'valid' | 'not-found' | null;
}

// Account as returned by GET /api/accounts — account row joined with latest score.
export interface AccountSummary extends Account {
  score: number | null;
  tier: HealthTier | 'unmapped' | null;
  scoreDelta: number | null;
  amplitudeAlias: string | null;   // null = not mapped yet
  aliasStatus: 'valid' | 'not-found' | null;
}

export type HealthTier = 'healthy' | 'watch' | 'at-risk' | 'critical';

export type UserRole = 'admin' | 'supervisor' | 'csm';

export interface User {
  email: string;        // lowercase, rowKey in Table Storage
  displayName: string;  // must match csmName for CSM filtering
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}
