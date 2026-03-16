import { useEffect, useState, useCallback, useMemo } from 'react';
import { getAccounts, triggerSync, getAccountDetail, updateAccountLicenses, updateAccountArr, upsertMapping, deleteMapping } from '../services/api';
import { AccountSummary, AccountDetail, HealthTier, ChurnScore } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

type SortCol = 'accountName' | 'csmName' | 'tier' | 'score' | 'arr' | 'renewalDate' | 'licenses' | 'amplitudeAlias';

// ─── Tier config (dark theme) ─────────────────────────────────────────────────

const TIER_CFG: Record<HealthTier | 'unmapped', {
  label: string; color: string; bg: string; glow: string; icon: string;
}> = {
  healthy:   { label: 'Healthy',  color: '#34D399', bg: '#34D39915', glow: '#34D39930', icon: '\u25CF' },
  watch:     { label: 'Watch',    color: '#FBBF24', bg: '#FBBF2415', glow: '#FBBF2430', icon: '\u25D0' },
  'at-risk': { label: 'At Risk',  color: '#FB923C', bg: '#FB923C15', glow: '#FB923C30', icon: '\u25D1' },
  critical:  { label: 'Critical', color: '#F87171', bg: '#F8717115', glow: '#F8717130', icon: '\u25CB' },
  unmapped:  { label: 'Unmapped', color: '#5A6170', bg: '#5A617015', glow: '#5A617015', icon: '\u25CC' },
};

const TIER_ORDER: Record<HealthTier | 'unmapped', number> = {
  healthy: 4, watch: 3, 'at-risk': 2, critical: 1, unmapped: 0,
};

// ─── Score breakdown helpers ──────────────────────────────────────────────────

function dauWauInfo(trend: number | null) {
  if (trend === null) return { pts: 0, label: 'No data', detail: 'No activity data available', hint: null };
  const pct = Math.round(trend * 100);
  const sign = pct >= 0 ? '+' : '';
  const detail = `${sign}${pct}% DAU/WAU ratio change over 28 days`;
  if (trend >= 0.1)  return { pts: 40, label: 'Growing',          detail, hint: 'More users logging in more often than last period.' };
  if (trend > -0.1)  return { pts: 25, label: 'Stable',           detail, hint: 'Usage is holding steady — no significant change.' };
  if (trend >= -0.3) return { pts: 10, label: 'Declining',        detail, hint: 'Fewer users logging in than last period.' };
                     return { pts: 0,  label: 'Critical decline',  detail, hint: 'A sharp drop in daily active users. Follow up urgently.' };
}

function licenseInfo(mau: number | null, licenses: number | null) {
  if (licenses === null)
    return { pts: 0, label: 'Not set', detail: 'Enter licence count to enable this metric', hint: null };
  if (mau === null)
    return { pts: 0, label: 'No data', detail: 'No Amplitude activity data available', hint: null };
  const util = Math.min(1, mau / Math.max(1, licenses));
  const pct = Math.round(util * 100);
  let pts = 0;
  if (util >= 0.8) pts = 35;
  else if (util >= 0.6) pts = 25;
  else if (util >= 0.4) pts = 15;
  else if (util >= 0.2) pts = 5;
  const hint =
    util >= 0.8 ? 'Excellent adoption — the team is fully engaged.' :
    util >= 0.6 ? 'Good adoption — most seats are in active use.' :
    util >= 0.4 ? 'Moderate adoption — room to grow engagement.' :
    util >= 0.2 ? 'Low adoption — consider proactive outreach.' :
                  'Very low adoption — churn risk. Engage urgently.';
  return { pts, label: `${pct}% utilisation`, detail: `${mau} of ${licenses} licences used (MAU / paid seats)`, hint };
}

function featureBreadthInfo(featuresUsed: number | null, total = 12) {
  if (featuresUsed === null) return { pts: 0, label: 'No data', detail: 'No feature usage data', hint: null };
  const ratio = total > 0 ? featuresUsed / total : 0;
  const detail = `${featuresUsed} of ${total} tracked feature categories in active use`;
  if (ratio >= 0.75) return { pts: 25, label: `${featuresUsed}/${total}`, detail, hint: 'Broad adoption — deeply embedded in the product.' };
  if (ratio >= 0.50) return { pts: 16, label: `${featuresUsed}/${total}`, detail, hint: 'Moderate adoption — good usage across key areas.' };
  if (ratio >= 0.25) return { pts: 8,  label: `${featuresUsed}/${total}`, detail, hint: 'Narrow adoption — opportunity to expand usage.' };
                     return { pts: 0,  label: `${featuresUsed}/${total}`, detail, hint: 'Minimal adoption — high churn risk.' };
}

function zendeskPenaltyInfo(penalty: number | null): { pts: string; label: string; detail: string; hint: string | null } {
  if (penalty === null) return { pts: 'N/A', label: 'No data', detail: 'Zendesk not configured or no domain', hint: null };
  if (penalty === 0) return { pts: '0', label: 'No issues', detail: 'No significant support burden', hint: 'Clean — no ticket penalty applied.' };
  if (penalty >= -9) return { pts: String(penalty), label: 'Minor', detail: `${penalty} point deduction`, hint: 'Some support activity detected.' };
  return { pts: String(penalty), label: 'High', detail: `${penalty} point deduction`, hint: 'Significant support burden. Review tickets.' };
}

// ─── Utility helpers ──────────────────────────────────────────────────────────

function formatArr(arr: number): string {
  if (arr == null || arr === 0) return '—';
  if (arr >= 1000) return `$${(arr / 1000).toFixed(arr >= 10000 ? 0 : 1)}k`;
  return `$${arr.toFixed(0)}`;
}

function renewalInfo(date: string): { label: string; urgency: 'expired' | 'urgent' | 'soon' | 'ok' | 'none' } {
  if (!date) return { label: '—', urgency: 'none' };
  const days = Math.round((new Date(date).getTime() - Date.now()) / 86_400_000);
  if (days < 0)   return { label: 'Expired',  urgency: 'expired' };
  if (days <= 30) return { label: `${days}d`,  urgency: 'urgent' };
  if (days <= 90) return { label: `${days}d`,  urgency: 'soon' };
  return {
    label: new Date(date).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: '2-digit' }),
    urgency: 'ok',
  };
}

const RENEWAL_COLOURS: Record<string, string> = {
  expired: '#F87171', urgent: '#FB923C', soon: '#FBBF24', ok: '#8891A0', none: '#5A6170',
};

function lastSyncedLabel(accounts: AccountSummary[]): string {
  const sorted = accounts.map(a => a.syncedAt).filter(Boolean).sort();
  const ts = sorted[sorted.length - 1];
  if (!ts) return '';
  const mins = Math.round((Date.now() - new Date(ts).getTime()) / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function sortRows(rows: AccountSummary[], col: SortCol, dir: 'asc' | 'desc'): AccountSummary[] {
  const m = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    switch (col) {
      case 'accountName':    return m * a.accountName.localeCompare(b.accountName);
      case 'csmName':        return m * (a.csmName ?? '').localeCompare(b.csmName ?? '');
      case 'tier':           return m * ((TIER_ORDER[a.tier ?? 'unmapped'] ?? 0) - (TIER_ORDER[b.tier ?? 'unmapped'] ?? 0));
      case 'score':          return m * ((a.score ?? -1) - (b.score ?? -1));
      case 'arr':            return m * ((a.arr ?? 0) - (b.arr ?? 0));
      case 'renewalDate':    return m * (a.renewalDate ?? '').localeCompare(b.renewalDate ?? '');
      case 'licenses':       return m * ((a.licenses ?? -1) - (b.licenses ?? -1));
      case 'amplitudeAlias': return m * (a.amplitudeAlias ?? '').localeCompare(b.amplitudeAlias ?? '');
      default:               return 0;
    }
  });
}

// ─── Small components ─────────────────────────────────────────────────────────

function ObsLogo() {
  return (
    <div className="relative w-8 h-8 flex items-center justify-center">
      <div className="absolute inset-0 rounded-lg bg-obs-accent/10" />
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <circle cx="9" cy="9" r="7" stroke="#7C6AFF" strokeWidth="1.5" strokeDasharray="3 2" />
        <circle cx="9" cy="9" r="3" fill="#7C6AFF" />
        <circle cx="9" cy="9" r="1" fill="#111318" />
      </svg>
    </div>
  );
}

function TierBadge({ tier }: { tier: HealthTier | 'unmapped' | null }) {
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

function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (!active) return <span className="ml-1 text-obs-invisible">{'\u21D5'}</span>;
  return <span className="ml-1 text-obs-accent">{dir === 'asc' ? '\u2191' : '\u2193'}</span>;
}

function ScoreBar({ pts, max, color }: { pts: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((pts / max) * 100) : 0;
  return (
    <div className="h-1.5 rounded-full bg-obs-edge overflow-hidden mt-2">
      <div
        className="h-full rounded-full transition-all duration-700 ease-out"
        style={{ width: `${pct}%`, background: color, boxShadow: `0 0 8px ${color}40` }}
      />
    </div>
  );
}

function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

function Sparkline({ history }: { history: ChurnScore[] }) {
  const valid = history.filter(h => h.score !== null);
  if (valid.length === 0) return <p className="text-[14px] text-obs-ghost py-4">No history available</p>;

  const W = 280, H = 64;
  const scores = valid.map(h => h.score as number);

  if (valid.length === 1) {
    return (
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <circle cx={W / 2} cy={H / 2} r="4" fill="#7C6AFF" />
      </svg>
    );
  }

  const pts = scores.map((s, i) => {
    const x = (i / (scores.length - 1)) * (W - 16) + 8;
    const y = H - 8 - (s / 100) * (H - 16);
    return `${x},${y}`;
  });

  const areaPath = [`M8,${H}`, ...pts.map(p => `L${p}`), `L${W - 8},${H}`, 'Z'].join(' ');
  const linePath = [`M${pts[0]}`, ...pts.slice(1).map(p => `L${p}`)].join(' ');
  const lastPt = pts[pts.length - 1].split(',');

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7C6AFF" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#7C6AFF" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#sparkGrad)" />
      <path d={linePath} fill="none" stroke="#7C6AFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastPt[0]} cy={lastPt[1]} r="4" fill="#7C6AFF" />
      <circle cx={lastPt[0]} cy={lastPt[1]} r="6" fill="none" stroke="#7C6AFF" strokeWidth="1" opacity="0.3" />
    </svg>
  );
}

// ─── Metric card ──────────────────────────────────────────────────────────────

function MetricCard({ label, value, sub, accent, delay }: {
  label: string; value: string | number; sub?: string; accent?: string; delay: number;
}) {
  return (
    <div className={`animate-fade-up stagger-${delay} bg-obs-raised border border-obs-edge rounded-xl px-5 py-4 group hover:border-obs-rule transition-colors`}>
      <p className="text-[14px] font-semibold uppercase tracking-[0.12em] text-obs-ghost mb-2">{label}</p>
      <p className="text-[28px] font-bold font-mono tracking-tight" style={{ color: accent || '#E4E8EF' }}>
        {value}
      </p>
      {sub && <p className="text-[14px] text-obs-dim mt-1">{sub}</p>}
    </div>
  );
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

function DetailPanel({ summary, onClose }: { summary: AccountSummary; onClose: () => void }) {
  const [detail, setDetail] = useState<AccountDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setDetail(null);
    setLoading(true);
    getAccountDetail(summary.hubspotId)
      .then(setDetail)
      .catch(console.warn)
      .finally(() => setLoading(false));
  }, [summary.hubspotId]);

  const tier    = summary.tier ?? 'unmapped';
  const tierCfg = TIER_CFG[tier];
  const bd      = detail?.scoreBreakdown ?? null;
  const dau     = dauWauInfo(bd?.dauWauTrend ?? null);
  const license = licenseInfo(bd?.monthlyActiveUsers ?? null, summary.licenses);
  const fb      = featureBreadthInfo(bd?.featuresUsed ?? null);
  const featureDetails = bd?.featureDetails ?? null;
  const zd      = zendeskPenaltyInfo(bd?.zendeskPenalty ?? null);
  const hasLicenses = summary.licenses !== null;
  const renewal = renewalInfo(summary.renewalDate);

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-obs-void/60 z-40 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <aside className="animate-slide-in fixed right-0 top-0 bottom-0 w-[460px] bg-obs-raised z-50 flex flex-col shadow-panel border-l border-obs-edge">

        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-obs-edge flex-shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-semibold text-obs-bright text-[16px] leading-snug">{summary.accountName}</h2>
              <p className="text-[14px] text-obs-dim mt-1">{summary.csmName || 'No owner assigned'}</p>
            </div>
            <button
              onClick={onClose}
              className="flex-shrink-0 mt-0.5 w-8 h-8 flex items-center justify-center rounded-lg text-obs-ghost hover:text-obs-bright hover:bg-obs-elevated transition-colors"
              aria-label="Close"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 1l12 12M13 1L1 13" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {summary.hubspotUrl && (
            <a href={summary.hubspotUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[14px] text-obs-accent hover:text-obs-glow mt-3 transition-colors group">
              Open in HubSpot
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"
                   className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform">
                <path d="M2 10L10 2M4 2h6v6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          )}
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto obs-scrollbar">
          <div className="px-6 py-5 space-y-6">

            {/* Score hero */}
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <TierBadge tier={tier} />
                {summary.amplitudeAlias
                  ? <p className="text-[14px] text-obs-ghost font-mono">{summary.amplitudeAlias}</p>
                  : <p className="text-[14px] text-tier-watch">No Amplitude alias</p>
                }
              </div>
              <div className="text-right">
                {summary.score !== null ? (
                  <>
                    <p className="text-[40px] font-bold leading-none font-mono score-glow" style={{ color: tierCfg.color }}>
                      {summary.score}
                      <span className="text-[14px] font-normal text-obs-ghost ml-1">/100</span>
                    </p>
                    {summary.scoreDelta !== null && summary.scoreDelta !== 0 && (
                      <p className={`text-[14px] font-semibold font-mono mt-1.5 ${summary.scoreDelta > 0 ? 'text-tier-healthy' : 'text-tier-critical'}`}>
                        {summary.scoreDelta > 0 ? `+${summary.scoreDelta}` : summary.scoreDelta}
                        <span className="text-obs-ghost font-normal ml-1">since last sync</span>
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-[14px] text-obs-ghost">Not scored</p>
                )}
              </div>
            </div>

            {/* Score breakdown */}
            <div>
              <p className="text-[14px] font-semibold uppercase tracking-[0.12em] text-obs-ghost mb-4">Score Breakdown</p>

              {!summary.amplitudeAlias ? (
                <div className="rounded-xl bg-tier-watch-bg border border-tier-watch/20 px-4 py-4">
                  <p className="text-[14px] font-semibold text-tier-watch">No Amplitude mapping</p>
                  <p className="text-[14px] text-tier-watch/70 mt-1 leading-relaxed">
                    This account can't be scored until an Amplitude alias is set in the grid.
                  </p>
                </div>
              ) : loading ? (
                <div className="flex items-center gap-2 text-[14px] text-obs-dim py-8 justify-center">
                  <Spinner className="h-4 w-4" /> Loading breakdown...
                </div>
              ) : (
                <div className="space-y-4">
                  {[
                    { label: 'Activity Trend',       sublabel: 'DAU/WAU over 28 days',            max: 40, info: dau },
                    { label: 'Licence Utilisation',   sublabel: 'MAU / paid seats',                max: 35, info: license },
                    { label: 'Feature Adoption',      sublabel: 'Categories used in last 30 days', max: 25, info: fb },
                  ].map(({ label, sublabel, max, info }) => {
                    const pct = max > 0 ? info.pts / max : 0;
                    const barColor = pct >= 0.7 ? '#34D399' : pct >= 0.4 ? '#FBBF24' : pct > 0 ? '#FB923C' : '#5A6170';
                    return (
                      <div key={label} className="bg-obs-card rounded-lg px-4 py-3 border border-obs-edge">
                        <div className="flex items-baseline justify-between">
                          <div>
                            <p className="text-[14px] font-semibold text-obs-bright">{label}</p>
                            <p className="text-[14px] text-obs-ghost mt-0.5">{sublabel}</p>
                          </div>
                          <p className="text-[16px] font-bold font-mono flex-shrink-0 ml-3" style={{ color: barColor }}>
                            {info.pts}
                            <span className="text-obs-ghost font-normal text-[14px]">/{max}</span>
                          </p>
                        </div>
                        <ScoreBar pts={info.pts} max={max} color={barColor} />
                        <p className="text-[14px] text-obs-dim mt-2 leading-relaxed">
                          <span className="font-medium text-obs-text">{info.label}</span>
                          {' — '}{info.detail}
                        </p>
                        {info.hint && (
                          <p className="text-[14px] text-obs-ghost mt-0.5 leading-relaxed">{info.hint}</p>
                        )}
                      </div>
                    );
                  })}

                  {/* Zendesk Support Load card */}
                  {bd && (
                    <div className="bg-obs-card rounded-lg px-4 py-3 border border-obs-edge">
                      <div className="flex items-baseline justify-between">
                        <div>
                          <p className="text-[14px] font-semibold text-obs-bright">Support Load</p>
                          <p className="text-[14px] text-obs-ghost mt-0.5">Zendesk ticket penalty</p>
                        </div>
                        <p className="text-[16px] font-bold font-mono flex-shrink-0 ml-3" style={{
                          color: zd.pts === 'N/A' ? '#5A6170' : zd.pts === '0' ? '#34D399' : Number(zd.pts) >= -9 ? '#FBBF24' : '#F87171'
                        }}>
                          {zd.pts}
                          {zd.pts !== 'N/A' && <span className="text-obs-ghost font-normal text-[14px]">/0</span>}
                        </p>
                      </div>
                      <p className="text-[14px] text-obs-dim mt-2 leading-relaxed">
                        <span className="font-medium text-obs-text">{zd.label}</span>
                        {' — '}{zd.detail}
                      </p>
                      {zd.hint && <p className="text-[14px] text-obs-ghost mt-0.5 leading-relaxed">{zd.hint}</p>}
                      {bd.zendeskDetails && (
                        <p className="text-[14px] text-obs-ghost mt-1 font-mono">
                          Volume: {bd.zendeskDetails.ticketVolume} · Open: {bd.zendeskDetails.openCount} · High: {bd.zendeskDetails.highPriorityCount} · Urgent: {bd.zendeskDetails.urgentCount}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Feature Detail Grid */}
                  {featureDetails && (
                    <div>
                      <p className="text-[14px] font-semibold uppercase tracking-[0.12em] text-obs-ghost mb-3">Feature Adoption</p>
                      <div className="grid grid-cols-2 gap-1.5">
                        {Object.entries(featureDetails)
                          .sort(([, a], [, b]) => (a === b ? 0 : a ? -1 : 1))
                          .map(([category, used]) => (
                            <div
                              key={category}
                              className={`flex items-center gap-2 text-[14px] px-2.5 py-1.5 rounded-md ${
                                used ? 'bg-tier-healthy-bg text-tier-healthy' : 'bg-obs-card text-obs-ghost'
                              }`}
                            >
                              <span className="text-[10px]">{used ? '\u25CF' : '\u25CB'}</span>
                              {category}
                            </div>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Scoring key */}
                  <div className="rounded-lg bg-obs-card border border-obs-edge px-4 py-3 space-y-2">
                    <p className="text-[14px] font-semibold text-obs-ghost uppercase tracking-[0.12em]">Scoring Key</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[14px] text-obs-dim">
                      <span>Activity growing (+10%)  <b className="text-obs-text">40</b></span>
                      <span>Stable (-10% to +10%)    <b className="text-obs-text">25</b></span>
                      <span>Utilisation {'\u2265'}80%          <b className="text-obs-text">35</b></span>
                      <span>Utilisation {'\u2265'}60%          <b className="text-obs-text">25</b></span>
                      <span>Features {'\u2265'}75%             <b className="text-obs-text">25</b></span>
                      <span>Features {'\u2265'}50%             <b className="text-obs-text">16</b></span>
                    </div>
                    <div className="border-t border-obs-edge pt-2 text-[14px] text-obs-ghost">
                      {hasLicenses
                        ? 'Score out of 100 (all three signals active)'
                        : 'Score out of 65 — enter licence count to unlock utilisation'}
                    </div>
                    <div className="border-t border-obs-edge pt-2 text-[14px] text-obs-ghost">
                      <span className="text-obs-dim">Tiers: </span>
                      <span className="text-tier-healthy">Healthy {'\u2265'}80</span>
                      {' \u00B7 '}<span className="text-tier-watch">Watch {'\u2265'}60</span>
                      {' \u00B7 '}<span className="text-tier-risk">At Risk {'\u2265'}40</span>
                      {' \u00B7 '}<span className="text-tier-critical">Critical &lt;40</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 7-day history */}
            {detail && detail.scoreHistory.length > 0 && (
              <div>
                <p className="text-[14px] font-semibold uppercase tracking-[0.12em] text-obs-ghost mb-3">7-Day History</p>
                <div className="bg-obs-card rounded-lg border border-obs-edge p-4">
                  <Sparkline history={detail.scoreHistory} />
                  <div className="flex justify-between mt-3">
                    {detail.scoreHistory.slice(-7).map(h => (
                      <div key={h.date} className="text-center min-w-0">
                        <p className="text-[14px] text-obs-ghost font-mono">
                          {new Date(h.date).toLocaleDateString('en-CA', { month: 'numeric', day: 'numeric' })}
                        </p>
                        <p className={`text-[14px] font-semibold font-mono mt-0.5 ${h.score !== null ? 'text-obs-bright' : 'text-obs-ghost'}`}>
                          {h.score ?? '—'}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Account details */}
            <div>
              <p className="text-[14px] font-semibold uppercase tracking-[0.12em] text-obs-ghost mb-3">Account Details</p>
              <div className="bg-obs-card rounded-lg border border-obs-edge divide-y divide-obs-edge">
                {[
                  { label: 'ARR',        value: formatArr(summary.arr) },
                  { label: 'Renewal',    value: renewal.label, color: RENEWAL_COLOURS[renewal.urgency] },
                  { label: 'Owner',      value: summary.csmName || '—' },
                  { label: 'HubSpot ID', value: summary.hubspotId, mono: true },
                ].map(({ label, value, color, mono }) => (
                  <div key={label} className="flex items-center justify-between px-4 py-2.5 text-[14px]">
                    <dt className="text-obs-ghost">{label}</dt>
                    <dd className={`font-medium ${mono ? 'font-mono text-obs-dim' : ''}`}
                        style={color ? { color } : { color: '#C1C7D2' }}>
                      {value}
                    </dd>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-obs-edge flex-shrink-0 bg-obs-base">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: tierCfg.color, boxShadow: `0 0 6px ${tierCfg.glow}` }} />
            <span className="text-[14px] text-obs-dim">
              {tierCfg.label} — score {summary.score ?? 'N/A'}/100
            </span>
          </div>
        </div>
      </aside>
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Portfolio() {
  const [accounts, setAccounts]           = useState<AccountSummary[]>([]);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState<string | null>(null);
  const [syncing, setSyncing]             = useState(false);
  const [search, setSearch]               = useState('');
  const [filterTier, setFilterTier]       = useState('all');
  const [filterOwner, setFilterOwner]     = useState('all');
  const [sortCol, setSortCol]             = useState<SortCol>('score');
  const [sortDir, setSortDir]             = useState<'asc' | 'desc'>('asc');
  const [selected, setSelected]           = useState<AccountSummary | null>(null);

  // Theme toggle
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('cs-copilot-theme') as 'dark' | 'light') || 'dark';
    }
    return 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('cs-copilot-theme', theme);
  }, [theme]);

  // Inline editing state
  const [editingLicenses, setEditingLicenses] = useState<string | null>(null);
  const [licensesInput, setLicensesInput]     = useState('');
  const [editingAlias, setEditingAlias]       = useState<string | null>(null);
  const [aliasInput, setAliasInput]           = useState('');
  const [editingArr, setEditingArr]           = useState<string | null>(null);
  const [arrInput, setArrInput]               = useState('');

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAccounts(await getAccounts());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load accounts';
      if (msg.includes('404') || msg.includes('Failed to fetch')) {
        setAccounts([]);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  async function handleSync() {
    setSyncing(true);
    try {
      await triggerSync();
      await fetchAccounts();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  async function saveLicenses(hubspotId: string) {
    const raw = licensesInput.trim();
    const value = raw === '' ? null : Number(raw);
    if (raw !== '' && (isNaN(value as number) || (value as number) < 0)) {
      setEditingLicenses(null);
      return;
    }
    try {
      await updateAccountLicenses(hubspotId, value);
      setAccounts(prev => prev.map(a =>
        a.hubspotId === hubspotId ? { ...a, licenses: value } : a
      ));
    } catch (err) {
      console.warn('Failed to save licenses:', err);
    }
    setEditingLicenses(null);
  }

  async function saveArr(hubspotId: string) {
    const raw = arrInput.trim();
    const value = raw === '' ? 0 : Number(raw);
    if (isNaN(value) || value < 0) { setEditingArr(null); return; }
    try {
      await updateAccountArr(hubspotId, value);
      setAccounts(prev => prev.map(a => a.hubspotId === hubspotId ? { ...a, arr: value } : a));
    } catch (err) { console.warn('Failed to save ARR:', err); }
    setEditingArr(null);
  }

  async function saveAlias(account: AccountSummary) {
    const alias = aliasInput.trim();
    try {
      if (alias) {
        await upsertMapping(account.hubspotId, account.accountName, alias);
        setAccounts(prev => prev.map(a =>
          a.hubspotId === account.hubspotId ? { ...a, amplitudeAlias: alias } : a
        ));
      } else if (account.amplitudeAlias) {
        // Clear alias = delete mapping
        await deleteMapping(account.hubspotId);
        setAccounts(prev => prev.map(a =>
          a.hubspotId === account.hubspotId ? { ...a, amplitudeAlias: null } : a
        ));
      }
    } catch (err) {
      console.warn('Failed to save alias:', err);
    }
    setEditingAlias(null);
  }

  function handleSortClick(col: SortCol) {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  }

  const uniqueOwners = useMemo(() =>
    [...new Set(accounts.map(a => a.csmName).filter(Boolean))].sort()
  , [accounts]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return sortRows(
      accounts.filter(a => {
        if (q && !a.accountName.toLowerCase().includes(q)
            && !(a.csmName ?? '').toLowerCase().includes(q)
            && !(a.amplitudeAlias ?? '').toLowerCase().includes(q)) return false;
        if (filterTier !== 'all' && (a.tier ?? 'unmapped') !== filterTier) return false;
        if (filterOwner !== 'all' && a.csmName !== filterOwner) return false;
        return true;
      }),
      sortCol,
      sortDir,
    );
  }, [accounts, search, filterTier, filterOwner, sortCol, sortDir]);

  const unmappedCount = accounts.filter(a => !a.amplitudeAlias).length;

  // Portfolio metrics
  const totalArr = accounts.reduce((sum, a) => sum + (a.arr ?? 0), 0);
  const scoredAccounts = accounts.filter(a => a.score !== null);
  const avgScore = scoredAccounts.length > 0
    ? Math.round(scoredAccounts.reduce((sum, a) => sum + (a.score ?? 0), 0) / scoredAccounts.length)
    : null;
  const atRiskCount = accounts.filter(a => a.tier === 'at-risk' || a.tier === 'critical').length;

  function SortTH({ col, children, className = '' }: { col: SortCol; children: React.ReactNode; className?: string }) {
    const active = sortCol === col;
    return (
      <th
        className={`px-4 py-3 cursor-pointer select-none whitespace-nowrap text-left ${className}`}
        onClick={() => handleSortClick(col)}
      >
        <span className={`inline-flex items-center text-[14px] font-semibold uppercase tracking-[0.08em] transition-colors ${
          active ? 'text-obs-accent' : 'text-obs-ghost hover:text-obs-dim'
        }`}>
          {children}
          <SortIcon active={active} dir={sortDir} />
        </span>
      </th>
    );
  }

  return (
    <div className="min-h-screen bg-obs-base">

      {/* ── Header ── */}
      <header className="bg-obs-raised/80 backdrop-blur-xl border-b border-obs-edge h-14 flex items-center px-6 justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <ObsLogo />
          <div>
            <span className="font-semibold text-obs-bright text-[15px] tracking-tight">CS Copilot</span>
            <span className="text-obs-ghost text-[14px] ml-2 font-mono uppercase tracking-wider">Observatory</span>
          </div>
        </div>
        <nav className="flex items-center gap-3">
          {accounts.length > 0 && lastSyncedLabel(accounts) && (
            <span className="text-[14px] text-obs-ghost font-mono mr-1">
              Synced {lastSyncedLabel(accounts)}
            </span>
          )}
          {unmappedCount > 0 && (
            <span className="bg-tier-watch-bg text-tier-watch text-[14px] font-bold px-2 py-0.5 rounded-full border border-tier-watch/20">
              {unmappedCount} unmapped
            </span>
          )}
          <button
            onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-obs-ghost hover:text-obs-bright hover:bg-obs-elevated transition-colors"
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {theme === 'dark' ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-2 px-4 py-1.5 bg-obs-accent hover:bg-obs-glow disabled:opacity-50 text-white text-[14px] font-medium rounded-lg transition-all shadow-glow-sm hover:shadow-glow"
          >
            {syncing ? <><Spinner className="h-4 w-4" /> Syncing...</> : 'Sync Now'}
          </button>
        </nav>
      </header>

      <main className="max-w-[1440px] mx-auto px-6 py-6">

        {/* ── Metric cards ── */}
        {!loading && !error && accounts.length > 0 && (
          <div className="grid grid-cols-4 gap-4 mb-6">
            <MetricCard
              label="Accounts"
              value={accounts.length}
              sub={`${scoredAccounts.length} scored`}
              delay={1}
            />
            <MetricCard
              label="Portfolio ARR"
              value={totalArr >= 1_000_000 ? `$${(totalArr / 1_000_000).toFixed(1)}M` : `$${(totalArr / 1000).toFixed(0)}k`}
              sub={accounts.length > 0 ? `avg ${formatArr(totalArr / accounts.length)}` : undefined}
              delay={2}
            />
            <MetricCard
              label="Avg Health Score"
              value={avgScore ?? '—'}
              sub={avgScore !== null ? (avgScore >= 70 ? 'Portfolio is healthy' : avgScore >= 50 ? 'Needs attention' : 'At risk') : 'No scored accounts'}
              accent={avgScore !== null ? (avgScore >= 70 ? '#34D399' : avgScore >= 50 ? '#FBBF24' : '#F87171') : undefined}
              delay={3}
            />
            <MetricCard
              label="At Risk"
              value={atRiskCount}
              sub={atRiskCount > 0 ? `${accounts.filter(a => a.tier === 'critical').length} critical` : 'None'}
              accent={atRiskCount > 0 ? '#F87171' : '#34D399'}
              delay={4}
            />
          </div>
        )}

        {/* ── Top 10 Needs Review ── */}
        {!loading && !error && accounts.length > 0 && (() => {
          const needsReview = accounts
            .filter(a => a.tier === 'critical' || a.tier === 'at-risk')
            .sort((a, b) => (b.arr ?? 0) - (a.arr ?? 0))
            .slice(0, 10);

          if (needsReview.length === 0) return null;

          return (
            <div className="mb-6">
              <p className="text-[14px] font-semibold uppercase tracking-[0.12em] text-obs-ghost mb-3">
                Needs Review
                <span className="text-obs-dim font-normal ml-2">Top {needsReview.length} at-risk accounts by ARR</span>
              </p>
              <div className="grid grid-cols-5 gap-3">
                {needsReview.map(a => {
                  const cfg = TIER_CFG[a.tier ?? 'unmapped'];
                  return (
                    <div
                      key={a.hubspotId}
                      onClick={() => setSelected(a)}
                      className="bg-obs-raised border border-obs-edge rounded-xl px-4 py-3 cursor-pointer hover:border-obs-rule transition-colors group"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <TierBadge tier={a.tier ?? 'unmapped'} />
                        <span className="text-[16px] font-bold font-mono" style={{ color: cfg.color }}>
                          {a.score ?? '—'}
                        </span>
                      </div>
                      <p className="text-[14px] font-semibold text-obs-bright truncate">{a.accountName}</p>
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-[14px] text-obs-dim truncate">{a.csmName || '—'}</span>
                        <span className="text-[14px] font-mono text-obs-ghost">{formatArr(a.arr)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* ── Toolbar ── */}
        {!loading && !error && accounts.length > 0 && (
          <div className="bg-obs-raised border border-obs-edge rounded-xl px-4 py-3 mb-4 flex flex-wrap items-center gap-3">
            {/* Search */}
            <div className="relative flex-1 min-w-52">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-obs-ghost pointer-events-none"
                fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" strokeLinecap="round" />
              </svg>
              <input
                type="text"
                placeholder="Search accounts, owner, or alias..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-[14px] bg-obs-card border border-obs-edge rounded-lg text-obs-bright placeholder-obs-ghost focus:outline-none focus:ring-1 focus:ring-obs-accent focus:border-obs-accent"
              />
            </div>

            {/* Owner filter */}
            <select
              value={filterOwner}
              onChange={e => setFilterOwner(e.target.value)}
              className="text-[14px] bg-obs-card border border-obs-edge rounded-lg px-3 py-2 text-obs-text focus:outline-none focus:ring-1 focus:ring-obs-accent focus:border-obs-accent"
            >
              <option value="all">All owners</option>
              {uniqueOwners.map(o => <option key={o} value={o}>{o}</option>)}
            </select>

            {/* Tier filter */}
            <select
              value={filterTier}
              onChange={e => setFilterTier(e.target.value)}
              className="text-[14px] bg-obs-card border border-obs-edge rounded-lg px-3 py-2 text-obs-text focus:outline-none focus:ring-1 focus:ring-obs-accent focus:border-obs-accent"
            >
              <option value="all">All tiers</option>
              <option value="healthy">Healthy</option>
              <option value="watch">Watch</option>
              <option value="at-risk">At Risk</option>
              <option value="critical">Critical</option>
              <option value="unmapped">Unmapped</option>
            </select>

            {/* Clear + count */}
            {(search || filterTier !== 'all' || filterOwner !== 'all') && (
              <button
                onClick={() => { setSearch(''); setFilterTier('all'); setFilterOwner('all'); }}
                className="text-[14px] text-obs-dim hover:text-obs-accent transition-colors"
              >
                Clear
              </button>
            )}
            <span className="text-[14px] text-obs-ghost ml-auto whitespace-nowrap font-mono">
              {filtered.length !== accounts.length
                ? `${filtered.length} / ${accounts.length}`
                : `${accounts.length} accounts`}
            </span>
          </div>
        )}

        {/* ── Loading ── */}
        {loading && (
          <div className="flex flex-col items-center justify-center gap-4 py-32">
            <div className="w-12 h-12 rounded-full border-2 border-obs-edge border-t-obs-accent animate-spin" />
            <span className="text-[14px] text-obs-dim">Loading portfolio...</span>
          </div>
        )}

        {/* ── Error ── */}
        {error && (
          <div className="bg-tier-critical-bg border border-tier-critical/20 rounded-xl px-4 py-3 text-[14px] text-tier-critical">
            {error}
          </div>
        )}

        {/* ── Empty state ── */}
        {!loading && !error && accounts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-32">
            <div className="w-16 h-16 rounded-2xl bg-obs-raised border border-obs-edge flex items-center justify-center mb-5">
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                <circle cx="14" cy="14" r="10" stroke="#7C6AFF" strokeWidth="1.5" strokeDasharray="4 3" />
                <circle cx="14" cy="14" r="4" fill="#7C6AFF" opacity="0.4" />
              </svg>
            </div>
            <p className="text-[16px] font-semibold text-obs-bright mb-1">No accounts yet</p>
            <p className="text-[14px] text-obs-dim mb-6">Run a sync to pull active clients from HubSpot.</p>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="px-5 py-2 bg-obs-accent hover:bg-obs-glow disabled:opacity-50 text-white text-[14px] font-medium rounded-lg transition-all shadow-glow-sm hover:shadow-glow"
            >
              {syncing ? 'Syncing...' : 'Sync Now'}
            </button>
          </div>
        )}

        {/* ── Table ── */}
        {!loading && !error && accounts.length > 0 && (
          <div className="bg-obs-raised border border-obs-edge rounded-xl overflow-hidden shadow-card">
            {filtered.length === 0 ? (
              <div className="py-16 text-center text-[14px] text-obs-ghost">
                No accounts match the current filters.{' '}
                <button
                  onClick={() => { setSearch(''); setFilterTier('all'); setFilterOwner('all'); }}
                  className="text-obs-accent hover:text-obs-glow"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[14px]">
                  <thead>
                    <tr className="bg-obs-card/50 border-b border-obs-edge">
                      <SortTH col="accountName">Account</SortTH>
                      <SortTH col="csmName">Owner</SortTH>
                      <SortTH col="tier">Health</SortTH>
                      <SortTH col="score">Score</SortTH>
                      <SortTH col="amplitudeAlias">Alias</SortTH>
                      <SortTH col="licenses">Licences</SortTH>
                      <SortTH col="arr">ARR</SortTH>
                      <SortTH col="renewalDate">Renewal</SortTH>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(account => {
                      const r = renewalInfo(account.renewalDate);
                      const isActive = selected?.hubspotId === account.hubspotId;
                      const tierColor = TIER_CFG[account.tier ?? 'unmapped'].color;
                      return (
                        <tr
                          key={account.hubspotId}
                          onClick={() => setSelected(isActive ? null : account)}
                          className={`cursor-pointer transition-colors border-b border-obs-edge/50 ${
                            isActive ? 'bg-obs-accent/8' : 'row-hover'
                          }`}
                        >
                          {/* Account name + tier bar */}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <span className="w-1 h-6 rounded-full flex-shrink-0" style={{ background: tierColor }} />
                              <span className="font-medium text-obs-bright text-[14px]">{account.accountName}</span>
                            </div>
                          </td>

                          {/* Owner */}
                          <td className="px-4 py-3 text-obs-dim text-[14px]">{account.csmName || '—'}</td>

                          {/* Tier badge */}
                          <td className="px-4 py-3">
                            <TierBadge tier={account.tier ?? 'unmapped'} />
                          </td>

                          {/* Score */}
                          <td className="px-4 py-3">
                            {account.score !== null ? (
                              <span className="font-semibold font-mono text-obs-bright text-[14px]">
                                {account.score}
                                {account.scoreDelta !== null && account.scoreDelta !== 0 && (
                                  <span className={`ml-1.5 text-[14px] font-semibold ${
                                    account.scoreDelta > 0 ? 'text-tier-healthy' : 'text-tier-critical'
                                  }`}>
                                    {account.scoreDelta > 0 ? `+${account.scoreDelta}` : account.scoreDelta}
                                  </span>
                                )}
                              </span>
                            ) : (
                              <span className="text-obs-ghost text-[14px]">—</span>
                            )}
                          </td>

                          {/* Amplitude Alias (inline editable) */}
                          <td
                            className="px-4 py-3"
                            onClick={e => {
                              e.stopPropagation();
                              setEditingAlias(account.hubspotId);
                              setAliasInput(account.amplitudeAlias ?? '');
                            }}
                          >
                            {editingAlias === account.hubspotId ? (
                              <input
                                type="text"
                                autoFocus
                                value={aliasInput}
                                onChange={e => setAliasInput(e.target.value)}
                                onBlur={() => saveAlias(account)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') saveAlias(account);
                                  if (e.key === 'Escape') setEditingAlias(null);
                                }}
                                placeholder="e.g. acme-corp"
                                className="w-32 text-[14px] font-mono px-2 py-0.5 bg-obs-card border border-obs-accent rounded focus:outline-none text-obs-bright placeholder-obs-ghost"
                              />
                            ) : (
                              <span className={`text-[14px] font-mono ${
                                account.amplitudeAlias
                                  ? 'text-obs-text hover:text-obs-accent'
                                  : 'text-tier-watch italic'
                              } transition-colors`}>
                                {account.amplitudeAlias || 'Set alias'}
                              </span>
                            )}
                          </td>

                          {/* Licences (inline editable) */}
                          <td
                            className="px-4 py-3"
                            onClick={e => {
                              e.stopPropagation();
                              setEditingLicenses(account.hubspotId);
                              setLicensesInput(account.licenses !== null ? String(account.licenses) : '');
                            }}
                          >
                            {editingLicenses === account.hubspotId ? (
                              <input
                                type="number"
                                min="0"
                                autoFocus
                                value={licensesInput}
                                onChange={e => setLicensesInput(e.target.value)}
                                onBlur={() => saveLicenses(account.hubspotId)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') saveLicenses(account.hubspotId);
                                  if (e.key === 'Escape') setEditingLicenses(null);
                                }}
                                className="w-16 text-[14px] font-mono px-2 py-0.5 bg-obs-card border border-obs-accent rounded focus:outline-none text-obs-bright"
                              />
                            ) : (
                              <span className={`text-[14px] font-mono ${
                                account.licenses !== null ? 'text-obs-text' : 'text-obs-ghost italic'
                              }`}>
                                {account.licenses !== null ? account.licenses : 'Set'}
                              </span>
                            )}
                          </td>

                          {/* ARR (inline editable) */}
                          <td
                            className="px-4 py-3 text-[14px] font-mono text-obs-bright text-right"
                            onClick={e => {
                              e.stopPropagation();
                              setEditingArr(account.hubspotId);
                              setArrInput(String(account.arr || ''));
                            }}
                          >
                            {editingArr === account.hubspotId ? (
                              <input
                                autoFocus
                                className="w-20 bg-obs-elevated border border-obs-accent rounded px-2 py-0.5 text-[14px] font-mono text-obs-bright text-right outline-none"
                                value={arrInput}
                                onChange={e => setArrInput(e.target.value)}
                                onBlur={() => saveArr(account.hubspotId)}
                                onKeyDown={e => { if (e.key === 'Enter') saveArr(account.hubspotId); if (e.key === 'Escape') setEditingArr(null); }}
                              />
                            ) : (
                              <span
                                className="cursor-pointer hover:text-obs-accent transition-colors"
                                title="Click to edit ARR"
                              >
                                {formatArr(account.arr)}
                              </span>
                            )}
                          </td>

                          {/* Renewal */}
                          <td className="px-4 py-3">
                            <span className="text-[14px] font-medium font-mono" style={{ color: RENEWAL_COLOURS[r.urgency] }}>
                              {r.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>

      {/* ── Detail panel ── */}
      {selected && (
        <DetailPanel summary={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
