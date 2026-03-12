export interface HubspotAccount {
  hubspotId: string;
  accountName: string;
  csmName: string;
  csmEmail: string;
  arr: number;
  renewalDate: string;
  hubspotUrl: string;
  syncedAt: string;
}

export interface AccountSummary extends HubspotAccount {
  score: number | null;
  tier: HealthTier | 'unmapped' | null;
  scoreDelta: number | null;
  amplitudeAlias: string | null;
}

export interface AmplitudeMapping {
  hubspotId: string;
  hubspotName: string;
  amplitudeAlias: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChurnScore {
  hubspotId: string;
  date: string;
  score: number | null;
  tier: HealthTier | 'unmapped';
  dauWauTrend: number | null;
  featureAdoption: number | null;
  lastLoginDays: number | null;
  scoreDelta: number | null;
  computedAt: string;
}

export type HealthTier = 'healthy' | 'watch' | 'at-risk' | 'critical';
