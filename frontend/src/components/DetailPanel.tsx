import { useEffect, useState } from 'react';
import { getAccountDetail, refreshAccountScore } from '../services/api';
import { AccountSummary, AccountDetail } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { TIER_CFG, RENEWAL_COLOURS } from './constants';
import { dauWauInfo, licenseInfo, featureBreadthInfo, zendeskPenaltyInfo, intercomPenaltyInfo, intercomBonusInfo, formatArr, renewalInfo } from './scoreHelpers';
import { TierBadge } from './TierBadge';
import { ScoreBar } from './ScoreBar';
import { Spinner } from './Spinner';
import { Sparkline } from './Sparkline';

export function DetailPanel({ summary, onClose, onScoreRefreshed }: {
  summary: AccountSummary;
  onClose: () => void;
  onScoreRefreshed?: (accountId: string, score: number | null, tier: string) => void;
}) {
  const { user } = useAuth();
  const isCSM = user?.role === 'csm';
  const canRefresh = !!user; // all authenticated users can refresh scores
  const [detail, setDetail] = useState<AccountDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    setDetail(null);
    setLoading(true);
    getAccountDetail(summary.accountId)
      .then(setDetail)
      .catch(console.warn)
      .finally(() => setLoading(false));
  }, [summary.accountId]);

  const tier    = summary.tier ?? 'unmapped';
  const tierCfg = TIER_CFG[tier];
  const bd      = detail?.scoreBreakdown ?? null;
  const dau     = dauWauInfo(bd?.dauWauTrend ?? null);
  const license = licenseInfo(bd?.monthlyActiveUsers ?? null, summary.licenses);
  const fb      = featureBreadthInfo(bd?.featuresUsed ?? null);
  const featureDetails = bd?.featureDetails ?? null;
  const zd        = zendeskPenaltyInfo(bd?.zendeskPenalty ?? null);
  const icPenalty = intercomPenaltyInfo(bd?.intercomDetails ?? null);
  const icBonus   = intercomBonusInfo(bd?.intercomDetails ?? null);
  const hasLicenses = summary.licenses !== null;
  const intercomBonus = bd?.intercomBonus ?? 0;
  const scoreOver100 = summary.score !== null && summary.score > 100 ? summary.score - 100 : 0;
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

          <div className="flex items-center gap-4 mt-3">
            {summary.hubspotUrl && (
              <a href={summary.hubspotUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[14px] text-obs-accent hover:text-obs-glow transition-colors group">
                Open in HubSpot
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"
                     className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform">
                  <path d="M2 10L10 2M4 2h6v6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
            )}
            {!isCSM && (
              <a href={`/troubleshoot?account=${encodeURIComponent(summary.accountId)}`} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[14px] text-obs-accent hover:text-obs-glow transition-colors group">
                Details
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"
                     className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform">
                  <path d="M2 10L10 2M4 2h6v6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
            )}
          </div>
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
                      {Math.min(summary.score, 100)}
                      <span className="text-[14px] font-normal text-obs-ghost ml-1">/100</span>
                      {scoreOver100 > 0 && (
                        <span className="text-[14px] font-semibold text-tier-healthy ml-1.5">+{scoreOver100}</span>
                      )}
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
              ) : summary.aliasStatus === 'not-found' ? (
                <div className="rounded-xl bg-tier-watch-bg border border-tier-watch/20 px-4 py-4">
                  <p className="text-[14px] font-semibold text-tier-watch">Alias not recognized by Amplitude</p>
                  <p className="text-[14px] text-tier-watch/70 mt-1 leading-relaxed">
                    The alias <span className="font-mono">"{summary.amplitudeAlias}"</span> was not found in Amplitude.
                    Check the casing matches exactly, or wait for first activity if this is a new account.
                  </p>
                </div>
              ) : loading ? (
                <div className="flex items-center gap-2 text-[14px] text-obs-dim py-8 justify-center">
                  <Spinner className="h-4 w-4" /> Loading breakdown...
                </div>
              ) : (
                <div className="space-y-4">
                  {[
                    { label: 'Licence Utilisation',   sublabel: 'MAU / paid seats',                max: 60, info: license },
                    { label: 'Activity Trend',       sublabel: 'DAU/WAU over 28 days',            max: 25, info: dau },
                    { label: 'Feature Adoption',      sublabel: 'Categories used in last 30 days', max: 15, info: fb },
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

                  {/* Zendesk Support card */}
                  {bd && (
                    <div className="bg-obs-card rounded-lg px-4 py-3 border border-obs-edge">
                      <div className="flex items-baseline justify-between">
                        <div>
                          <p className="text-[14px] font-semibold text-obs-bright">Zendesk Support</p>
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

                  {/* Intercom Support card */}
                  {bd && (
                    <div className="bg-obs-card rounded-lg px-4 py-3 border border-obs-edge">
                      <div className="flex items-baseline justify-between">
                        <div>
                          <p className="text-[14px] font-semibold text-obs-bright">Intercom Support</p>
                          <p className="text-[14px] text-obs-ghost mt-0.5">Intercom conversation penalty</p>
                        </div>
                        <p className="text-[16px] font-bold font-mono flex-shrink-0 ml-3" style={{
                          color: icPenalty.pts === 'N/A' ? '#5A6170' : icPenalty.pts === '0' ? '#34D399' : Number(icPenalty.pts) >= -4 ? '#FBBF24' : '#F87171'
                        }}>
                          {icPenalty.pts}
                          {icPenalty.pts !== 'N/A' && <span className="text-obs-ghost font-normal text-[14px]">/0</span>}
                        </p>
                      </div>
                      <p className="text-[14px] text-obs-dim mt-2 leading-relaxed">
                        <span className="font-medium text-obs-text">{icPenalty.label}</span>
                        {' — '}{icPenalty.detail}
                      </p>
                      {icPenalty.hint && <p className="text-[14px] text-obs-ghost mt-0.5 leading-relaxed">{icPenalty.hint}</p>}
                    </div>
                  )}

                  {/* Intercom Engagement card */}
                  {bd && (
                    <div className="bg-obs-card rounded-lg px-4 py-3 border border-obs-edge">
                      <div className="flex items-baseline justify-between">
                        <div>
                          <p className="text-[14px] font-semibold text-obs-bright">Intercom Engagement</p>
                          <p className="text-[14px] text-obs-ghost mt-0.5">Conversation quality bonus</p>
                        </div>
                        <p className="text-[16px] font-bold font-mono flex-shrink-0 ml-3" style={{
                          color: icBonus.pts === 'N/A' ? '#5A6170' : icBonus.pts === '0' ? '#8891A0' : intercomBonus >= 7 ? '#34D399' : '#7C6AFF'
                        }}>
                          {icBonus.pts}
                        </p>
                      </div>
                      <p className="text-[14px] text-obs-dim mt-2 leading-relaxed">
                        <span className="font-medium text-obs-text">{icBonus.label}</span>
                        {' — '}{icBonus.detail}
                      </p>
                      {icBonus.hint && <p className="text-[14px] text-obs-ghost mt-0.5 leading-relaxed">{icBonus.hint}</p>}
                    </div>
                  )}

                  {/* Combined penalty cap note */}
                  {bd?.zendeskPenalty != null && bd?.intercomPenalty != null && (
                    <p className="text-[12px] text-obs-ghost italic px-1">Combined support penalty capped at -20</p>
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
                      <span>Utilisation {'\u2265'}80%          <b className="text-obs-text">60</b></span>
                      <span>Utilisation {'\u2265'}60%          <b className="text-obs-text">45</b></span>
                      <span>Activity growing (+10%)  <b className="text-obs-text">25</b></span>
                      <span>Stable (-10% to +10%)    <b className="text-obs-text">15</b></span>
                      <span>Features {'\u2265'}75%             <b className="text-obs-text">15</b></span>
                      <span>Features {'\u2265'}50%             <b className="text-obs-text">10</b></span>
                      <span>Intercom quick resolution  <b className="text-obs-text">+4</b></span>
                      <span>Intercom AI-handled        <b className="text-obs-text">+3</b></span>
                      <span>Intercom engagement        <b className="text-obs-text">+3</b></span>
                      <span>Intercom open penalty      <b className="text-obs-text">-2 to -12</b></span>
                    </div>
                    <div className="border-t border-obs-edge pt-2 text-[14px] text-obs-ghost">
                      {hasLicenses
                        ? (intercomBonus > 0
                            ? 'Score out of 110 max (Intercom engagement bonus active)'
                            : 'Score out of 100 (all three signals active)')
                        : 'Score out of 40 — enter licence count to unlock utilisation'}
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
                ].map(({ label, value, color, mono }) => (
                  <div key={label} className="flex items-center justify-between px-4 py-2.5 text-[14px]">
                    <dt className="text-obs-ghost">{label}</dt>
                    <dd className={`font-medium ${mono ? 'font-mono text-obs-dim' : ''}`}
                        style={color ? { color } : { color: '#C1C7D2' }}>
                      {value}
                    </dd>
                  </div>
                ))}
                {summary.hubspotCompanyId && (
                  <div className="flex items-center justify-between px-4 py-2.5 text-[14px]">
                    <dt className="text-obs-ghost">HubSpot</dt>
                    <dd>
                      {summary.hubspotUrl ? (
                        <a href={summary.hubspotUrl} target="_blank" rel="noopener noreferrer"
                          className="font-mono text-obs-accent hover:text-obs-glow transition-colors">
                          {summary.hubspotCompanyId}
                        </a>
                      ) : (
                        <span className="font-mono text-obs-dim">{summary.hubspotCompanyId}</span>
                      )}
                    </dd>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-obs-edge flex-shrink-0 bg-obs-base">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: tierCfg.color, boxShadow: `0 0 6px ${tierCfg.glow}` }} />
              <span className="text-[14px] text-obs-dim">
                {tierCfg.label} — score {summary.score ?? 'N/A'}/100
              </span>
            </div>
            {canRefresh && summary.amplitudeAlias && (
              <button
                onClick={async () => {
                  setRefreshing(true);
                  try {
                    const result = await refreshAccountScore(summary.accountId);
                    // Reload detail panel
                    const refreshed = await getAccountDetail(summary.accountId);
                    setDetail(refreshed);
                    onScoreRefreshed?.(summary.accountId, result.score, result.tier);
                  } catch (err) {
                    console.warn('Score refresh failed:', err);
                  } finally {
                    setRefreshing(false);
                  }
                }}
                disabled={refreshing}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-obs-accent hover:text-obs-glow border border-obs-accent/30 hover:border-obs-accent/60 rounded-lg transition-all disabled:opacity-50"
              >
                {refreshing ? (
                  <><Spinner className="h-3.5 w-3.5" /> Scoring...</>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M23 4v6h-6" /><path d="M1 20v-6h6" />
                      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                    </svg>
                    Refresh Score
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
