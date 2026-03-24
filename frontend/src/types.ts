export interface Account {
  accountId: string;
  hubspotCompanyId: string;
  accountName: string;
  csmName: string;
  csmEmail: string;
  arr: number;
  renewalDate: string;
  hubspotUrl: string;
  syncedAt: string;
  licenses: number | null;
  domain: string;
  hidden: boolean;
}

export interface AccountSummary extends Account {
  score: number | null;
  tier: HealthTier | 'unmapped' | null;
  scoreDelta: number | null;
  amplitudeAlias: string | null;
  aliasStatus: 'valid' | 'not-found' | null;
}

export interface ZendeskDetails {
  totalPenalty: number;
  volumePenalty: number;
  openPenalty: number;
  severityPenalty: number;
  ticketVolume: number;
  openCount: number;
  highPriorityCount: number;
  urgentCount: number;
}

export interface IntercomDetails {
  openPenalty: number;
  slowPenalty: number;
  openCount: number;
  avgResponseTime: number | null;
  quickResolutionBonus: number;
  quickResolutions: number;
  aiBonus: number;
  aiHandled: number;
  engagementBonus: number;
  conversationVolume: number;
  totalBonus: number;
}

export interface ScoreBreakdown {
  dauWauTrend: number | null;
  monthlyActiveUsers: number | null;
  licenseUtilization: number | null;
  featuresUsed: number | null;
  featureDetails: Record<string, boolean> | null;
  zendeskPenalty: number | null;
  zendeskDetails: ZendeskDetails | null;
  intercomPenalty: number | null;
  intercomBonus: number | null;
  intercomDetails: IntercomDetails | null;
}

export interface AccountDetail extends AccountSummary {
  scoreBreakdown: ScoreBreakdown | null;
  scoreHistory: ChurnScore[];
}

export interface AmplitudeMapping {
  accountId: string;
  accountName: string;
  amplitudeAlias: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChurnScore {
  accountId: string;
  date: string;
  score: number | null;
  tier: HealthTier | 'unmapped';
  dauWauTrend: number | null;
  monthlyActiveUsers: number | null;
  licenseUtilization: number | null;
  featuresUsed: number | null;
  featureDetails: string | null;
  scoreDelta: number | null;
  computedAt: string;
  zendeskPenalty: number | null;
  zendeskDetails: string | null;
  aliasStatus: 'valid' | 'not-found' | null;
}

export type HealthTier = 'healthy' | 'watch' | 'at-risk' | 'critical';

export type UserRole = 'admin' | 'supervisor' | 'csm';

export interface User {
  email: string;
  displayName: string;
  role: UserRole;
  createdAt?: string;
  updatedAt?: string;
}
