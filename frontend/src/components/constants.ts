import { HealthTier } from '../types';

export type SortCol = 'accountName' | 'csmName' | 'tier' | 'score' | 'arr' | 'renewalDate' | 'licenses' | 'amplitudeAlias';

export const TIER_CFG: Record<HealthTier | 'unmapped', {
  label: string; color: string; bg: string; glow: string; icon: string;
}> = {
  healthy:   { label: 'Healthy',  color: '#34D399', bg: '#34D39915', glow: '#34D39930', icon: '\u25CF' },
  watch:     { label: 'Watch',    color: '#FBBF24', bg: '#FBBF2415', glow: '#FBBF2430', icon: '\u25D0' },
  'at-risk': { label: 'At Risk',  color: '#FB923C', bg: '#FB923C15', glow: '#FB923C30', icon: '\u25D1' },
  critical:  { label: 'Critical', color: '#F87171', bg: '#F8717115', glow: '#F8717130', icon: '\u25CB' },
  unmapped:  { label: 'Unmapped', color: '#5A6170', bg: '#5A617015', glow: '#5A617015', icon: '\u25CC' },
};

export const TIER_ORDER: Record<HealthTier | 'unmapped', number> = {
  healthy: 4, watch: 3, 'at-risk': 2, critical: 1, unmapped: 0,
};

export const RENEWAL_COLOURS: Record<string, string> = {
  expired: '#F87171', urgent: '#FB923C', soon: '#FBBF24', ok: '#8891A0', none: '#5A6170',
};
