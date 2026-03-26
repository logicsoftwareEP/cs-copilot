import { HealthTier } from '../types';
import { TIER_CFG } from './constants';

export function TierBadge({ tier }: { tier: HealthTier | 'unmapped' | null }) {
  if (!tier) return <span className="text-obs-ghost">—</span>;
  const c = TIER_CFG[tier];
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[14px] font-semibold tracking-wide transition-all"
      style={{ background: c.bg, color: c.color, border: `1px solid ${c.glow}` }}
    >
      <span className="text-[10px]">{c.icon}</span>
      {c.label}
    </span>
  );
}
