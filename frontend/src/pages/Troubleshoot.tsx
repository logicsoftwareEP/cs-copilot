import { useEffect, useState, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getAccounts, getAccountDetail } from '../services/api';
import { AccountSummary, AccountDetail, ScoreBreakdown, ZendeskDetails, IntercomDetails } from '../types';

// ── Formatting helpers ───────────────────────────────────────────────────────

function fmtNum(v: number | null | undefined, decimals = 2): string {
  if (v === null || v === undefined) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(decimals);
}

function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return `${Math.round(v * 100)}%`;
}

function fmtSeconds(s: number | null | undefined): string {
  if (s === null || s === undefined || s === 0) return '—';
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

// ── Data row component ───────────────────────────────────────────────────────

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex justify-between py-1 border-b border-obs-edge/50">
      <span className="text-obs-dim text-[13px]">{label}</span>
      <span className={`text-[13px] font-mono ${warn ? 'text-tier-critical' : 'text-obs-text'}`}>{value}</span>
    </div>
  );
}

// ── Section components ───────────────────────────────────────────────────────

function AmplitudeSection({ bd }: { bd: ScoreBreakdown }) {
  const features = bd.featureDetails ? Object.entries(bd.featureDetails) : [];
  return (
    <div>
      <h4 className="text-[13px] font-semibold uppercase tracking-wider text-obs-ghost mb-2">Amplitude Signals</h4>
      <div className="space-y-0">
        <Row label="DAU/WAU Trend" value={bd.dauWauTrend !== null ? `${bd.dauWauTrend >= 0 ? '+' : ''}${Math.round(bd.dauWauTrend * 100)}%` : '—'} />
        <Row label="Monthly Active Users" value={fmtNum(bd.monthlyActiveUsers, 0)} />
        <Row label="Licence Utilisation" value={fmtPct(bd.licenseUtilization)} />
        <Row label="Features Used" value={bd.featuresUsed !== null ? `${bd.featuresUsed}/12` : '—'} />
      </div>
      {features.length > 0 && (
        <div className="mt-2 grid grid-cols-2 gap-1">
          {features.sort(([, a], [, b]) => (a === b ? 0 : a ? -1 : 1)).map(([name, used]) => (
            <span key={name} className={`text-[12px] px-2 py-0.5 rounded ${used ? 'bg-tier-healthy-bg text-tier-healthy' : 'bg-obs-card text-obs-ghost'}`}>
              {used ? '●' : '○'} {name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ZendeskSection({ zd, penalty }: { zd: ZendeskDetails; penalty: number | null }) {
  return (
    <div>
      <h4 className="text-[13px] font-semibold uppercase tracking-wider text-obs-ghost mb-2">Zendesk</h4>
      <div className="space-y-0">
        <Row label="Ticket Volume (30d)" value={String(zd.ticketVolume)} warn={zd.ticketVolume >= 11} />
        <Row label="Open Tickets" value={String(zd.openCount)} warn={zd.openCount >= 6} />
        <Row label="High Priority (30d)" value={String(zd.highPriorityCount)} warn={zd.highPriorityCount >= 3} />
        <Row label="Urgent (30d)" value={String(zd.urgentCount)} warn={zd.urgentCount >= 1} />
        <Row label="Volume Penalty" value={String(zd.volumePenalty)} warn={zd.volumePenalty < 0} />
        <Row label="Open Penalty" value={String(zd.openPenalty)} warn={zd.openPenalty < 0} />
        <Row label="Severity Penalty" value={String(zd.severityPenalty)} warn={zd.severityPenalty < 0} />
        <Row label="Total Penalty" value={String(penalty ?? zd.totalPenalty)} warn={(penalty ?? zd.totalPenalty) < 0} />
      </div>
    </div>
  );
}

function IntercomSection({ ic, penalty, bonus }: { ic: IntercomDetails; penalty: number | null; bonus: number | null }) {
  return (
    <div>
      <h4 className="text-[13px] font-semibold uppercase tracking-wider text-obs-ghost mb-2">Intercom</h4>
      <div className="space-y-0">
        <Row label="Conversation Volume" value={String(ic.conversationVolume)} />
        <Row label="Open Conversations" value={String(ic.openCount)} warn={ic.openCount >= 6} />
        <Row label="Avg Response Time" value={fmtSeconds(ic.avgResponseTime)} warn={(ic.avgResponseTime ?? 0) > 86400} />
        <Row label="Quick Resolutions" value={String(ic.quickResolutions)} />
        <Row label="AI-Handled" value={String(ic.aiHandled)} />
        <Row label="Open Penalty" value={String(ic.openPenalty)} warn={ic.openPenalty < 0} />
        <Row label="Slow Penalty" value={String(ic.slowPenalty)} warn={ic.slowPenalty < 0} />
        <Row label="Total Penalty" value={String(penalty ?? (ic.openPenalty + ic.slowPenalty))} warn={(penalty ?? 0) < 0} />
        <Row label="Quick Resolution Bonus" value={`+${ic.quickResolutionBonus}`} />
        <Row label="AI Bonus" value={`+${ic.aiBonus}`} />
        <Row label="Engagement Bonus" value={`+${ic.engagementBonus}`} />
        <Row label="Total Bonus" value={`+${bonus ?? ic.totalBonus}`} />
        <Row label="CX Score (avg)" value={ic.avgCxScore !== null ? `${ic.avgCxScore.toFixed(1)}/5` : '—'} />
        <Row label="CX Score Count" value={String(ic.cxScoreCount ?? 0)} />
        <Row label="CX Score Penalty" value={String(ic.cxScorePenalty ?? 0)} warn={(ic.cxScorePenalty ?? 0) < 0} />
        <Row label="CX Score Bonus" value={ic.cxScoreBonus ? `+${ic.cxScoreBonus}` : '0'} />
      </div>
    </div>
  );
}

function ScoreSummary({ detail }: { detail: AccountDetail }) {
  const bd = detail.scoreBreakdown;
  if (!bd) return <p className="text-obs-ghost text-[13px]">No score data available.</p>;

  // Reconstruct the scoring math
  const hasLicenses = bd.licenseUtilization !== null;
  const zdPenalty = bd.zendeskPenalty ?? 0;
  const icPenalty = bd.intercomPenalty ?? 0;
  const icBonus = bd.intercomBonus ?? 0;
  const cxPenalty = bd.cxScorePenalty ?? 0;
  const cxBonus = bd.cxScoreBonus ?? 0;
  const combinedPenalty = Math.max(zdPenalty + icPenalty + cxPenalty, -20);

  return (
    <div>
      <h4 className="text-[13px] font-semibold uppercase tracking-wider text-obs-ghost mb-2">Score Calculation</h4>
      <div className="space-y-0">
        <Row label="Base Score" value={detail.score !== null ? `${(detail.score ?? 0) - combinedPenalty - icBonus - cxBonus}${detail.score === 0 || detail.score === 110 ? ' (clamped)' : ''}` : '—'} />
        <Row label="Normalised Out Of" value={hasLicenses ? '100' : '40'} />
        <Row label="Zendesk Penalty" value={bd.zendeskPenalty !== null ? String(bd.zendeskPenalty) : 'N/A'} warn={(bd.zendeskPenalty ?? 0) < 0} />
        <Row label="Intercom Penalty" value={bd.intercomPenalty !== null ? String(bd.intercomPenalty) : 'N/A'} warn={(bd.intercomPenalty ?? 0) < 0} />
        <Row label="Combined Penalty (cap -20)" value={String(combinedPenalty)} warn={combinedPenalty < 0} />
        <Row label="Intercom Bonus" value={bd.intercomBonus !== null ? `+${bd.intercomBonus}` : 'N/A'} />
        <Row label="CX Score Penalty" value={bd.cxScorePenalty !== null ? String(bd.cxScorePenalty) : 'N/A'} warn={(bd.cxScorePenalty ?? 0) < 0} />
        <Row label="CX Score Bonus" value={bd.cxScoreBonus !== null ? `+${bd.cxScoreBonus}` : 'N/A'} />
        <Row label="Final Score" value={detail.score !== null ? String(detail.score) : '—'} />
        <Row label="Tier" value={detail.tier ?? '—'} />
      </div>
    </div>
  );
}

// ── Account detail panel ─────────────────────────────────────────────────────

function AccountPanel({ accountId, onClose }: { accountId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<AccountDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getAccountDetail(accountId)
      .then(setDetail)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [accountId]);

  if (loading) return <div className="text-obs-dim text-[14px] py-8 text-center">Loading...</div>;
  if (error) return <div className="text-tier-critical text-[14px] py-4">Error: {error}</div>;
  if (!detail) return null;

  const bd = detail.scoreBreakdown;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[16px] font-bold text-obs-bright">{detail.accountName}</h3>
          <p className="text-[13px] text-obs-ghost font-mono">{detail.hubspotCompanyId || detail.accountId} · {detail.domain || 'no domain'}</p>
        </div>
        <button onClick={onClose} className="text-obs-ghost hover:text-obs-text text-[18px]">×</button>
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="bg-obs-card rounded-lg px-3 py-2 border border-obs-edge">
          <p className="text-[12px] text-obs-ghost">Score</p>
          <p className="text-[20px] font-bold text-obs-bright">{detail.score ?? '—'}</p>
        </div>
        <div className="bg-obs-card rounded-lg px-3 py-2 border border-obs-edge">
          <p className="text-[12px] text-obs-ghost">Tier</p>
          <p className="text-[20px] font-bold text-obs-bright">{detail.tier ?? '—'}</p>
        </div>
        <div className="bg-obs-card rounded-lg px-3 py-2 border border-obs-edge">
          <p className="text-[12px] text-obs-ghost">Alias</p>
          <p className="text-[13px] font-mono text-obs-text truncate">{detail.amplitudeAlias ?? 'unmapped'}</p>
        </div>
      </div>

      <div className="space-y-4">
        {bd && <ScoreSummary detail={detail} />}
        {bd && <AmplitudeSection bd={bd} />}
        {bd?.zendeskDetails && <ZendeskSection zd={bd.zendeskDetails} penalty={bd.zendeskPenalty} />}
        {bd?.intercomDetails && <IntercomSection ic={bd.intercomDetails} penalty={bd.intercomPenalty} bonus={bd.intercomBonus} />}
        {!bd?.zendeskDetails && <p className="text-[13px] text-obs-ghost">Zendesk: no data (not configured or no domain match)</p>}
        {!bd?.intercomDetails && <p className="text-[13px] text-obs-ghost">Intercom: no data (not configured or no domain match)</p>}
      </div>

      {detail.scoreHistory.length > 0 && (
        <div>
          <h4 className="text-[13px] font-semibold uppercase tracking-wider text-obs-ghost mb-2">Score History (7d)</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] font-mono">
              <thead>
                <tr className="text-obs-ghost border-b border-obs-edge">
                  <th className="text-left py-1 pr-3">Date</th>
                  <th className="text-right py-1 pr-3">Score</th>
                  <th className="text-right py-1 pr-3">Delta</th>
                  <th className="text-left py-1 pr-3">Tier</th>
                  <th className="text-right py-1 pr-3">ZD</th>
                  <th className="text-right py-1 pr-3">IC</th>
                  <th className="text-right py-1">Bonus</th>
                </tr>
              </thead>
              <tbody>
                {detail.scoreHistory.map(row => (
                  <tr key={row.date} className="border-b border-obs-edge/30">
                    <td className="py-1 pr-3 text-obs-dim">{row.date}</td>
                    <td className="py-1 pr-3 text-right text-obs-text">{row.score ?? '—'}</td>
                    <td className="py-1 pr-3 text-right text-obs-dim">{row.scoreDelta !== null ? (row.scoreDelta >= 0 ? `+${row.scoreDelta}` : String(row.scoreDelta)) : '—'}</td>
                    <td className="py-1 pr-3 text-obs-dim">{row.tier}</td>
                    <td className="py-1 pr-3 text-right text-obs-dim">{row.zendeskPenalty ?? '—'}</td>
                    <td className="py-1 pr-3 text-right text-obs-dim">{row.intercomPenalty ?? '—'}</td>
                    <td className="py-1 text-right text-obs-dim">{row.intercomBonus ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function Troubleshoot() {
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('account'));

  useEffect(() => {
    getAccounts()
      .then(setAccounts)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!search) return accounts;
    const q = search.toLowerCase();
    return accounts.filter(a =>
      a.accountName.toLowerCase().includes(q) ||
      a.accountId.toLowerCase().includes(q) ||
      a.domain?.toLowerCase().includes(q)
    );
  }, [accounts, search]);

  return (
    <div className="min-h-screen bg-obs-bg text-obs-text">
      {/* Header */}
      <header className="border-b border-obs-edge bg-obs-surface px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-obs-ghost hover:text-obs-text text-[14px]">← Portfolio</Link>
          <span className="text-obs-edge">|</span>
          <span className="font-semibold text-obs-bright text-[15px]">Troubleshoot</span>
          <span className="text-obs-ghost text-[13px] font-mono">Raw Scoring Data</span>
        </div>
      </header>

      <div className="flex h-[calc(100vh-49px)]">
        {/* Account list */}
        <div className="w-[380px] border-r border-obs-edge overflow-y-auto bg-obs-surface">
          <div className="p-3 border-b border-obs-edge">
            <input
              type="text"
              placeholder="Search accounts..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-obs-bg border border-obs-edge rounded px-3 py-1.5 text-[14px] text-obs-text placeholder:text-obs-ghost focus:outline-none focus:border-obs-accent"
            />
            <p className="text-[12px] text-obs-ghost mt-1">{filtered.length} accounts</p>
          </div>
          {loading ? (
            <p className="text-obs-dim text-[14px] p-4">Loading accounts...</p>
          ) : error ? (
            <p className="text-tier-critical text-[14px] p-4">{error}</p>
          ) : (
            <div>
              {filtered.map(a => (
                <button
                  key={a.accountId}
                  onClick={() => setSelectedId(a.accountId)}
                  className={`w-full text-left px-4 py-2.5 border-b border-obs-edge/50 hover:bg-obs-card transition-colors ${
                    selectedId === a.accountId ? 'bg-obs-card border-l-2 border-l-obs-accent' : ''
                  }`}
                >
                  <div className="flex justify-between items-baseline">
                    <span className="text-[14px] text-obs-bright font-medium truncate mr-2">{a.accountName}</span>
                    <span className={`text-[13px] font-mono flex-shrink-0 ${
                      a.tier === 'healthy' ? 'text-tier-healthy' :
                      a.tier === 'watch' ? 'text-tier-watch' :
                      a.tier === 'at-risk' ? 'text-tier-risk' :
                      a.tier === 'critical' ? 'text-tier-critical' : 'text-obs-ghost'
                    }`}>
                      {a.score ?? '—'}
                    </span>
                  </div>
                  <div className="text-[12px] text-obs-ghost font-mono mt-0.5">
                    {a.domain || 'no domain'} · {a.amplitudeAlias || 'unmapped'}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Detail panel */}
        <div className="flex-1 overflow-y-auto p-6">
          {selectedId ? (
            <AccountPanel accountId={selectedId} onClose={() => setSelectedId(null)} />
          ) : (
            <div className="flex items-center justify-center h-full text-obs-ghost text-[14px]">
              Select an account to view raw scoring data
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
