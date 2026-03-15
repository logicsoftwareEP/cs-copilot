import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { getAccounts, triggerSync, getAccountDetail, updateAccountLicenses } from '../services/api';
import { AccountSummary, AccountDetail, HealthTier, ChurnScore, ZendeskDetails } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

type SortCol = 'accountName' | 'csmName' | 'tier' | 'score' | 'arr' | 'renewalDate' | 'licenses';

// ─── Brand config ─────────────────────────────────────────────────────────────

const TIER_CFG: Record<HealthTier | 'unmapped', { label: string; dot: string; bg: string; text: string }> = {
  healthy:  { label: 'Healthy',  dot: '#22A06B', bg: '#EBFAF4', text: '#1F845A' },
  watch:    { label: 'Watch',    dot: '#CF9F02', bg: '#FAF6E6', text: '#946F00' },
  'at-risk':{ label: 'At Risk', dot: '#D97008', bg: '#FFF3EB', text: '#A54800' },
  critical: { label: 'Critical', dot: '#C9372C', bg: '#FFECEB', text: '#AE2A19' },
  unmapped: { label: 'Unmapped', dot: '#8A8A99', bg: '#F7F7FC', text: '#6F6F80' },
};

const TIER_ORDER: Record<HealthTier | 'unmapped', number> = {
  healthy: 4, watch: 3, 'at-risk': 2, critical: 1, unmapped: 0,
};

// ─── Score breakdown helpers (mirrors backend healthScoreService logic) ────────

function dauWauInfo(trend: number | null) {
  if (trend === null) return { pts: 0, label: 'No data', detail: 'No activity data available', hint: null };
  const pct = Math.round(trend * 100);
  const sign = pct >= 0 ? '+' : '';
  const detail = `${sign}${pct}% DAU/WAU ratio change over 28 days`;
  if (trend >= 0.1)  return { pts: 40, label: 'Growing',          detail, hint: 'More users are logging in more often than last period.' };
  if (trend > -0.1)  return { pts: 25, label: 'Stable',           detail, hint: 'Usage is holding steady — no significant change.' };
  if (trend >= -0.3) return { pts: 10, label: 'Declining',        detail, hint: 'Fewer users are logging in than last period.' };
                     return { pts: 0,  label: 'Critical decline',  detail, hint: 'A sharp drop in daily active users. Follow up urgently.' };
}

function licenseInfo(mau: number | null, licenses: number | null) {
  if (licenses === null) {
    return { pts: 0, label: 'Not set', detail: 'Enter licence count in the grid to enable this metric', hint: null };
  }
  if (mau === null) {
    return { pts: 0, label: 'No data', detail: 'No Amplitude activity data available', hint: null };
  }
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
    util >= 0.4 ? 'Moderate adoption — there is room to grow engagement.' :
    util >= 0.2 ? 'Low adoption — consider a proactive outreach.' :
                  'Very low adoption — churn risk. Engage urgently.';
  return {
    pts,
    label: `${pct}% utilisation`,
    detail: `${mau} of ${licenses} licences used (MAU ÷ paid seats)`,
    hint,
  };
}

function loginInfo(days: number | null) {
  if (days === null) return { pts: 0, label: 'No data', detail: 'No login data available', hint: null };
  if (days < 7)   return { pts: 25, label: 'This week',    detail: `Last active ${days}d ago`, hint: 'Account is actively using the platform.' };
  if (days < 14)  return { pts: 16, label: 'Last 2 weeks', detail: `Last active ${days}d ago`, hint: 'Recent but not daily — worth a check-in.' };
  if (days <= 30) return { pts: 8,  label: 'This month',   detail: `Last active ${days}d ago`, hint: 'Infrequent usage. Consider a proactive outreach.' };
                  return { pts: 0,  label: '30+ days ago', detail: `Last active ${days}d ago`, hint: 'No activity in over a month. At risk of churn.' };
}

function zendeskPenaltyInfo(penalty: number | null): { pts: string; label: string; detail: string; hint: string; colour: string } {
  if (penalty === null) return { pts: 'N/A', label: 'Support Load', detail: 'No Zendesk data', hint: 'Domain not configured or Zendesk not enabled', colour: 'gray' };
  if (penalty === 0) return { pts: '0', label: 'Support Load', detail: 'No issues', hint: 'No significant support burden detected', colour: 'green' };
  if (penalty >= -9) return { pts: String(penalty), label: 'Support Load', detail: 'Minor', hint: 'Some support activity detected', colour: 'amber' };
  return { pts: String(penalty), label: 'Support Load', detail: 'High', hint: 'Significant support burden', colour: 'red' };
}

// ─── Utility helpers ──────────────────────────────────────────────────────────

function formatArr(arr: number): string {
  if (arr == null) return '—';
  return `$${(arr / 1000).toFixed(0)}k`;
}

function renewalInfo(date: string): { label: string; urgency: 'expired' | 'urgent' | 'soon' | 'ok' | 'none' } {
  if (!date) return { label: '—', urgency: 'none' };
  const days = Math.round((new Date(date).getTime() - Date.now()) / 86_400_000);
  if (days < 0)   return { label: 'Expired',   urgency: 'expired' };
  if (days <= 30) return { label: `${days}d`,  urgency: 'urgent' };
  if (days <= 90) return { label: `${days}d`,  urgency: 'soon' };
  return {
    label: new Date(date).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: '2-digit' }),
    urgency: 'ok',
  };
}

const RENEWAL_COLOURS: Record<string, string> = {
  expired: '#C9372C',
  urgent:  '#D97008',
  soon:    '#CF9F02',
  ok:      '#6F6F80',
  none:    '#A1A1B2',
};

function lastSyncedLabel(accounts: AccountSummary[]): string {
  const sorted = accounts.map(a => a.syncedAt).filter(Boolean).sort();
  const ts = sorted[sorted.length - 1];
  if (!ts) return '';
  const mins = Math.round((Date.now() - new Date(ts).getTime()) / 60_000);
  if (mins < 60) return `Synced ${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `Synced ${h}h ago`;
  return `Synced ${Math.round(h / 24)}d ago`;
}

function sortRows(rows: AccountSummary[], col: SortCol, dir: 'asc' | 'desc'): AccountSummary[] {
  const m = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    switch (col) {
      case 'accountName': return m * a.accountName.localeCompare(b.accountName);
      case 'csmName':     return m * (a.csmName ?? '').localeCompare(b.csmName ?? '');
      case 'tier':        return m * ((TIER_ORDER[a.tier ?? 'unmapped'] ?? 0) - (TIER_ORDER[b.tier ?? 'unmapped'] ?? 0));
      case 'score':       return m * ((a.score ?? -1) - (b.score ?? -1));
      case 'arr':         return m * ((a.arr ?? 0) - (b.arr ?? 0));
      case 'renewalDate': return m * (a.renewalDate ?? '').localeCompare(b.renewalDate ?? '');
      case 'licenses':    return m * ((a.licenses ?? -1) - (b.licenses ?? -1));
      default:            return 0;
    }
  });
}

// ─── Small components ─────────────────────────────────────────────────────────

function BvLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <circle cx="10" cy="10" r="10" fill="#6955ED" fillOpacity="0.12" />
      <path d="M6 10.5C6 8.015 8.015 6 10.5 6S15 8.015 15 10.5 12.985 15 10.5 15 6 12.985 6 10.5z" fill="#6955ED" />
      <path d="M5 7.5C5 6.12 6.12 5 7.5 5h1L6 8.5 5 7.5z" fill="#6955ED" fillOpacity="0.6" />
    </svg>
  );
}

function TierBadge({ tier }: { tier: HealthTier | 'unmapped' | null }) {
  if (!tier) return <span className="text-xs text-[#A1A1B2]">—</span>;
  const c = TIER_CFG[tier];
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ background: c.bg, color: c.text }}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: c.dot }} />
      {c.label}
    </span>
  );
}

function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  return (
    <span className={`ml-0.5 text-[10px] transition-colors ${active ? 'text-[#6955ED]' : 'text-[#C2C2CD]'}`}>
      {active ? (dir === 'asc' ? '↑' : '↓') : '↕'}
    </span>
  );
}

function ScoreBar({ pts, max, color }: { pts: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((pts / max) * 100) : 0;
  return (
    <div className="h-1.5 rounded-full bg-[#EDEDF2] overflow-hidden mt-1.5">
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color, transition: 'width 0.5s ease' }} />
    </div>
  );
}

function Spinner({ size = 4 }: { size?: number }) {
  return (
    <svg className={`animate-spin h-${size} w-${size}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

function Sparkline({ history }: { history: ChurnScore[] }) {
  const valid = history.filter(h => h.score !== null);
  if (valid.length === 0) return <p className="text-xs text-[#A1A1B2] py-4">No history available</p>;

  const W = 268, H = 56;
  const scores = valid.map(h => h.score as number);

  if (valid.length === 1) {
    return (
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <circle cx={W / 2} cy={H / 2} r="4" fill="#6955ED" />
      </svg>
    );
  }

  const pts = scores.map((s, i) => {
    const x = (i / (scores.length - 1)) * (W - 8) + 4;
    const y = H - 4 - (s / 100) * (H - 8);
    return `${x},${y}`;
  });

  const areaPath = [
    `M4,${H}`,
    ...pts.map(p => `L${p}`),
    `L${W - 4},${H}`,
    'Z',
  ].join(' ');

  const linePath = [`M${pts[0]}`, ...pts.slice(1).map(p => `L${p}`)].join(' ');

  const lastPt = pts[pts.length - 1].split(',');

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <defs>
        <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6955ED" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#6955ED" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#sg)" />
      <path d={linePath} fill="none" stroke="#6955ED" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastPt[0]} cy={lastPt[1]} r="3" fill="#6955ED" />
    </svg>
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
  const login   = loginInfo(bd?.lastLoginDays ?? null);
  const zendesk = zendeskPenaltyInfo(bd?.zendeskPenalty ?? null);
  const zd: ZendeskDetails | null = bd?.zendeskDetails ?? null;
  const hasLicenses = summary.licenses !== null;
  const renewal = renewalInfo(summary.renewalDate);

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-[#26262B]/25 z-40 backdrop-blur-[1px]" onClick={onClose} />

      {/* Panel */}
      <aside className="panel-enter fixed right-0 top-0 bottom-0 w-[420px] bg-white z-50 flex flex-col shadow-2xl shadow-[#26262B]/20">

        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-[#EDEDF2] flex-shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-semibold text-[#26262B] text-[15px] leading-snug">{summary.accountName}</h2>
              <p className="text-xs text-[#A1A1B2] mt-0.5">{summary.csmName || 'No owner assigned'}</p>
            </div>
            <button
              onClick={onClose}
              className="flex-shrink-0 mt-0.5 w-7 h-7 flex items-center justify-center rounded-lg text-[#A1A1B2] hover:text-[#26262B] hover:bg-[#F7F7FC] transition-colors text-sm"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          {summary.hubspotUrl && (
            <a href={summary.hubspotUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-[#6955ED] hover:text-[#523FCB] mt-2.5 transition-colors">
              Open in HubSpot
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M2 10L10 2M4 2h6v6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          )}
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto bv-scrollbar">
          <div className="px-6 py-5 space-y-6">

            {/* Score hero */}
            <div className="flex items-center justify-between">
              <div className="space-y-1.5">
                <TierBadge tier={tier} />
                {summary.amplitudeAlias
                  ? <p className="text-[11px] text-[#A1A1B2] font-mono">{summary.amplitudeAlias}</p>
                  : <p className="text-[11px] text-[#946F00]">No Amplitude alias</p>
                }
              </div>
              <div className="text-right">
                {summary.score !== null ? (
                  <>
                    <p className="text-[32px] font-bold leading-none text-[#26262B]">
                      {summary.score}
                      <span className="text-sm font-normal text-[#A1A1B2]">/100</span>
                    </p>
                    {summary.scoreDelta !== null && summary.scoreDelta !== 0 && (
                      <p className={`text-xs font-medium mt-1 ${summary.scoreDelta > 0 ? 'text-[#1F845A]' : 'text-[#AE2A19]'}`}>
                        {summary.scoreDelta > 0 ? `+${summary.scoreDelta}` : summary.scoreDelta} since last sync
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-[#A1A1B2]">Not scored</p>
                )}
              </div>
            </div>

            {/* Score breakdown */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#A1A1B2] mb-3">Score Breakdown</p>

              {!summary.amplitudeAlias ? (
                <div className="rounded-xl bg-[#FAF6E6] border border-[#F5CD47]/40 px-4 py-3.5">
                  <p className="text-xs font-semibold text-[#946F00]">No Amplitude mapping</p>
                  <p className="text-xs text-[#946F00]/80 mt-0.5 leading-relaxed">
                    This account can't be scored until linked to an Amplitude alias.
                  </p>
                  <Link to="/mapping"
                    className="text-xs text-[#6955ED] hover:text-[#523FCB] font-semibold mt-2 inline-flex items-center gap-1">
                    Set up mapping →
                  </Link>
                </div>
              ) : loading ? (
                <div className="flex items-center gap-2 text-xs text-[#A1A1B2] py-6 justify-center">
                  <Spinner size={3} /> Loading breakdown…
                </div>
              ) : (
                <div className="space-y-5">
                  {/* Component row */}
                  {[
                    {
                      label: 'Activity Trend',
                      sublabel: 'DAU/WAU over 28 days',
                      max: 40,
                      color: '#6955ED',
                      info: dau,
                    },
                    {
                      label: 'Licence Utilisation',
                      sublabel: 'MAU ÷ paid seats',
                      max: 35,
                      color: '#1D9AAA',
                      info: license,
                    },
                    {
                      label: 'Last Active',
                      sublabel: 'Days since last session',
                      max: 25,
                      color: '#22A06B',
                      info: login,
                    },
                  ].map(({ label, sublabel, max, color, info }) => (
                    <div key={label}>
                      <div className="flex items-baseline justify-between">
                        <div>
                          <p className="text-xs font-semibold text-[#26262B]">{label}</p>
                          <p className="text-[10px] text-[#A1A1B2] mt-0.5">{sublabel}</p>
                        </div>
                        <p className="text-xs font-bold text-[#26262B] flex-shrink-0 ml-3">
                          {info.pts}
                          <span className="font-normal text-[#A1A1B2]">/{max}</span>
                        </p>
                      </div>
                      <ScoreBar pts={info.pts} max={max} color={color} />
                      <p className="text-[11px] text-[#4A4A54] mt-1.5 leading-relaxed">
                        <span className="font-medium">{info.label}</span>
                        {' — '}{info.detail}
                      </p>
                      {info.hint && (
                        <p className="text-[10px] text-[#A1A1B2] mt-0.5 leading-relaxed">{info.hint}</p>
                      )}
                    </div>
                  ))}

                  {/* Support Load (Zendesk penalty) */}
                  <div>
                    <div className="flex items-baseline justify-between">
                      <div>
                        <p className="text-xs font-semibold text-[#26262B]">Support Load</p>
                        <p className="text-[10px] text-[#A1A1B2] mt-0.5">Zendesk ticket penalty</p>
                      </div>
                      <p className={`text-xs font-bold flex-shrink-0 ml-3 ${
                        zendesk.colour === 'green' ? 'text-[#1F845A]' :
                        zendesk.colour === 'amber' ? 'text-[#946F00]' :
                        zendesk.colour === 'red'   ? 'text-[#AE2A19]' :
                                                     'text-[#A1A1B2]'
                      }`}>
                        {zendesk.pts}
                      </p>
                    </div>
                    <p className="text-[11px] text-[#4A4A54] mt-1.5 leading-relaxed">
                      <span className="font-medium">{zendesk.detail}</span>
                      {' — '}{zendesk.hint}
                    </p>
                    {zd && bd?.zendeskPenalty !== null && bd?.zendeskPenalty !== 0 && (
                      <p className="text-[10px] text-[#A1A1B2] mt-0.5 leading-relaxed">
                        Volume: {zd.ticketVolume} tickets, Open: {zd.openCount}, High: {zd.highPriorityCount}, Urgent: {zd.urgentCount}
                      </p>
                    )}
                  </div>

                  {/* Scoring key */}
                  <div className="rounded-lg bg-[#F7F7FC] border border-[#EDEDF2] px-3.5 py-3 space-y-1.5">
                    <p className="text-[10px] font-semibold text-[#A1A1B2] uppercase tracking-wider">Scoring Key</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-[#6F6F80]">
                      <span>Activity growing (+10%)  <b className="text-[#26262B]">40 pts</b></span>
                      <span>Stable (−10% to +10%)    <b className="text-[#26262B]">25 pts</b></span>
                      <span>Utilisation ≥80%          <b className="text-[#26262B]">35 pts</b></span>
                      <span>Utilisation ≥60%          <b className="text-[#26262B]">25 pts</b></span>
                      <span>Last active &lt;7 days      <b className="text-[#26262B]">25 pts</b></span>
                      <span>Last active 7–14 days     <b className="text-[#26262B]">16 pts</b></span>
                    </div>
                    <div className="border-t border-[#EDEDF2] pt-1.5 text-[10px] text-[#6F6F80]">
                      <span className="font-medium text-[#A1A1B2]">Normalised: </span>
                      {hasLicenses
                        ? 'Score out of 100 (all three signals active)'
                        : 'Score out of 65 — enter licence count to unlock utilisation scoring'}
                    </div>
                    <div className="border-t border-[#EDEDF2] pt-1.5 text-[10px] text-[#6F6F80]">
                      <span className="font-medium text-[#A1A1B2]">Tiers: </span>
                      Healthy ≥80 · Watch ≥60 · At Risk ≥40 · Critical &lt;40
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 7-day history */}
            {detail && detail.scoreHistory.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[#A1A1B2] mb-3">7-Day History</p>
                <Sparkline history={detail.scoreHistory} />
                <div className="flex justify-between mt-2">
                  {detail.scoreHistory.slice(-7).map(h => (
                    <div key={h.date} className="text-center min-w-0">
                      <p className="text-[9px] text-[#A1A1B2]">
                        {new Date(h.date).toLocaleDateString('en-CA', { month: 'numeric', day: 'numeric' })}
                      </p>
                      <p className={`text-[11px] font-semibold mt-0.5 ${h.score !== null ? 'text-[#26262B]' : 'text-[#A1A1B2]'}`}>
                        {h.score ?? '—'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Account details */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#A1A1B2] mb-3">Account Details</p>
              <dl className="space-y-2.5">
                {[
                  { label: 'ARR',        value: formatArr(summary.arr) },
                  {
                    label: 'Renewal',
                    value: (
                      <span style={{ color: RENEWAL_COLOURS[renewal.urgency] }} className="font-semibold">
                        {renewal.label}
                      </span>
                    ),
                  },
                  { label: 'Owner',      value: summary.csmName || '—' },
                  { label: 'HubSpot ID', value: <span className="font-mono text-[11px]">{summary.hubspotId}</span> },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between text-xs">
                    <dt className="text-[#A1A1B2]">{label}</dt>
                    <dd className="text-[#26262B] font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#EDEDF2] flex-shrink-0 bg-[#FAFAFA]">
          <div
            className="w-3 h-3 rounded-full inline-block mr-2 align-middle"
            style={{ background: tierCfg.dot }}
          />
          <span className="text-xs text-[#6F6F80]">
            {tierCfg.label} — score {summary.score ?? 'N/A'}/100
          </span>
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
  const [editingLicenses, setEditingLicenses] = useState<string | null>(null);
  const [licensesInput, setLicensesInput]     = useState('');

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
        if (q && !a.accountName.toLowerCase().includes(q) && !(a.csmName ?? '').toLowerCase().includes(q)) return false;
        if (filterTier !== 'all' && (a.tier ?? 'unmapped') !== filterTier) return false;
        if (filterOwner !== 'all' && a.csmName !== filterOwner) return false;
        return true;
      }),
      sortCol,
      sortDir,
    );
  }, [accounts, search, filterTier, filterOwner, sortCol, sortDir]);

  const unmappedCount = accounts.filter(a => !a.amplitudeAlias).length;

  function SortTH({ col, children }: { col: SortCol; children: React.ReactNode }) {
    const active = sortCol === col;
    return (
      <th
        className="px-4 py-3 cursor-pointer select-none whitespace-nowrap text-left"
        onClick={() => handleSortClick(col)}
      >
        <span className={`inline-flex items-center text-[11px] font-semibold uppercase tracking-wider transition-colors ${active ? 'text-[#6955ED]' : 'text-[#8A8A99] hover:text-[#4A4A54]'}`}>
          {children}
          <SortIcon active={active} dir={sortDir} />
        </span>
      </th>
    );
  }

  return (
    <div className="min-h-screen bg-bv-surface">

      {/* ── Header ── */}
      <header className="bg-white border-b border-bv-border h-14 flex items-center px-6 justify-between sticky top-0 z-30">
        <div className="flex items-center gap-2">
          <BvLogo />
          <span className="font-semibold text-bv-ink text-sm tracking-tight">CS Copilot</span>
        </div>
        <nav className="flex items-center gap-2">
          <Link
            to="/mapping"
            className="flex items-center gap-1.5 text-sm text-bv-muted hover:text-bv-primary px-3 py-1.5 rounded-lg hover:bg-bv-xlight transition-colors"
          >
            Amplitude Mapping
            {unmappedCount > 0 && (
              <span className="bg-[#FAF6E6] text-[#946F00] text-[10px] font-semibold px-1.5 py-0.5 rounded-full">
                {unmappedCount}
              </span>
            )}
          </Link>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-bv-primary hover:bg-bv-hover disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {syncing ? <><Spinner size={3} /> Syncing…</> : 'Sync Now'}
          </button>
        </nav>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">

        {/* ── Toolbar ── */}
        {!loading && !error && accounts.length > 0 && (
          <div className="bg-white rounded-xl border border-bv-divider px-4 py-3 mb-4 flex flex-wrap items-center gap-3">
            {/* Search */}
            <div className="relative flex-1 min-w-52">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-bv-subtle pointer-events-none"
                fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" strokeLinecap="round" />
              </svg>
              <input
                type="text"
                placeholder="Search accounts or owner…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-sm bg-bv-surface border border-bv-divider rounded-lg text-bv-ink placeholder-bv-subtle focus:outline-none focus:ring-1 focus:ring-bv-primary focus:border-bv-primary"
              />
            </div>

            {/* Owner filter */}
            <select
              value={filterOwner}
              onChange={e => setFilterOwner(e.target.value)}
              className="text-sm bg-bv-surface border border-bv-divider rounded-lg px-3 py-1.5 text-bv-body focus:outline-none focus:ring-1 focus:ring-bv-primary focus:border-bv-primary"
            >
              <option value="all">All owners</option>
              {uniqueOwners.map(o => <option key={o} value={o}>{o}</option>)}
            </select>

            {/* Tier filter */}
            <select
              value={filterTier}
              onChange={e => setFilterTier(e.target.value)}
              className="text-sm bg-bv-surface border border-bv-divider rounded-lg px-3 py-1.5 text-bv-body focus:outline-none focus:ring-1 focus:ring-bv-primary focus:border-bv-primary"
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
                className="text-xs text-bv-muted hover:text-bv-primary transition-colors"
              >
                Clear
              </button>
            )}
            <span className="text-xs text-bv-subtle ml-auto whitespace-nowrap">
              {filtered.length !== accounts.length
                ? `${filtered.length} of ${accounts.length} accounts`
                : `${accounts.length} accounts`}
              {accounts.length > 0 && (
                <span className="ml-2 text-bv-subtle/60">{lastSyncedLabel(accounts)}</span>
              )}
            </span>
          </div>
        )}

        {/* ── Loading ── */}
        {loading && (
          <div className="flex items-center justify-center gap-3 text-bv-subtle py-28">
            <Spinner size={5} />
            <span className="text-sm">Loading accounts…</span>
          </div>
        )}

        {/* ── Error ── */}
        {error && (
          <div className="bg-[#FFECEB] border border-[#C9372C]/20 rounded-xl px-4 py-3 text-sm text-[#AE2A19]">
            {error}
          </div>
        )}

        {/* ── Empty state ── */}
        {!loading && !error && accounts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-28">
            <div className="w-14 h-14 rounded-2xl bg-bv-xlight flex items-center justify-center mb-4">
              <svg className="w-7 h-7 text-bv-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
              </svg>
            </div>
            <p className="text-base font-semibold text-bv-ink mb-1">No accounts yet</p>
            <p className="text-sm text-bv-muted mb-6">Run a sync to pull active clients from HubSpot.</p>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="px-5 py-2 bg-bv-primary hover:bg-bv-hover disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {syncing ? 'Syncing…' : 'Sync Now'}
            </button>
          </div>
        )}

        {/* ── Table ── */}
        {!loading && !error && accounts.length > 0 && (
          <div className="bg-white rounded-xl border border-bv-divider overflow-hidden shadow-sm shadow-[#26262B]/5">
            {filtered.length === 0 ? (
              <div className="py-16 text-center text-sm text-bv-subtle">
                No accounts match the current filters.{' '}
                <button
                  onClick={() => { setSearch(''); setFilterTier('all'); setFilterOwner('all'); }}
                  className="text-bv-primary hover:text-bv-hover"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-bv-surface border-b border-bv-divider">
                    <SortTH col="accountName">Account</SortTH>
                    <SortTH col="csmName">Owner</SortTH>
                    <SortTH col="tier">Health</SortTH>
                    <SortTH col="score">Score</SortTH>
                    <SortTH col="licenses">Licences</SortTH>
                    <SortTH col="arr">ARR</SortTH>
                    <SortTH col="renewalDate">Renewal</SortTH>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bv-surface">
                  {filtered.map(account => {
                    const r = renewalInfo(account.renewalDate);
                    const isActive = selected?.hubspotId === account.hubspotId;
                    return (
                      <tr
                        key={account.hubspotId}
                        onClick={() => setSelected(isActive ? null : account)}
                        className={`cursor-pointer transition-colors ${isActive ? 'bg-bv-xlight' : 'hover:bg-bv-surface'}`}
                      >
                        <td className="px-4 py-3">
                          <span className="font-medium text-bv-ink">{account.accountName}</span>
                          {!account.amplitudeAlias && (
                            <span className="ml-2 text-[10px] font-medium text-[#946F00] bg-[#FAF6E6] px-1.5 py-0.5 rounded-full">
                              unmapped
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-bv-muted">{account.csmName || '—'}</td>
                        <td className="px-4 py-3">
                          <TierBadge tier={account.tier ?? 'unmapped'} />
                        </td>
                        <td className="px-4 py-3">
                          {account.score !== null ? (
                            <span className="font-semibold text-bv-ink">
                              {account.score}
                              {account.scoreDelta !== null && account.scoreDelta !== 0 && (
                                <span className={`ml-1 text-xs font-medium ${account.scoreDelta > 0 ? 'text-[#1F845A]' : 'text-[#AE2A19]'}`}>
                                  {account.scoreDelta > 0 ? `+${account.scoreDelta}` : account.scoreDelta}
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-bv-subtle">—</span>
                          )}
                        </td>
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
                              className="w-20 text-sm px-2 py-0.5 border border-bv-primary rounded focus:outline-none text-bv-ink"
                            />
                          ) : (
                            <span className={`text-sm ${account.licenses !== null ? 'text-bv-body' : 'text-bv-subtle italic'}`}>
                              {account.licenses !== null ? account.licenses : 'Enter'}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-bv-body">{formatArr(account.arr)}</td>
                        <td className="px-4 py-3">
                          <span className="text-sm font-medium" style={{ color: RENEWAL_COLOURS[r.urgency] }}>
                            {r.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
