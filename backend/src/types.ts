// Account as synced from HubSpot and stored in the `accounts` table.
// RowKey in Table Storage = hubspotId (stable, never changes).
export interface HubspotAccount {
  hubspotId: string;
  accountName: string;
  csmName: string;
  csmEmail: string;
  arr: number;
  renewalDate: string; // ISO date YYYY-MM-DD or empty string
  hubspotUrl: string;
  syncedAt: string;    // ISO timestamp of last sync
}

// Mapping between a HubSpot company and its Amplitude account alias.
export interface AmplitudeMapping {
  hubspotId: string;
  hubspotName: string;  // denormalised for display
  amplitudeAlias: string;
  createdAt: string;
  updatedAt: string;
}

// Health score for one account on one day, stored in the `churnscores` table.
// PartitionKey = hubspotId, RowKey = YYYY-MM-DD
export interface ChurnScore {
  hubspotId: string;
  date: string;        // YYYY-MM-DD
  score: number | null;
  tier: HealthTier | 'unmapped';
  dauWauTrend: number | null;    // fractional change, e.g. -0.15 = -15%
  featureAdoption: number | null; // fraction used/total, e.g. 0.42
  lastLoginDays: number | null;  // integer days
  scoreDelta: number | null;     // vs previous day
  computedAt: string;
}

// Account as returned by GET /api/accounts — account row joined with latest score.
export interface AccountSummary extends HubspotAccount {
  score: number | null;
  tier: HealthTier | 'unmapped' | null;
  scoreDelta: number | null;
  amplitudeAlias: string | null; // null = not mapped yet
}

export type HealthTier = 'healthy' | 'watch' | 'at-risk' | 'critical';
