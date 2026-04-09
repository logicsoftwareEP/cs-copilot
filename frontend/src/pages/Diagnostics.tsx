import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getDiagnosticsIntercom, getDiagnosticsZendesk } from '../services/api';
import { IntercomDiagnostics, IntercomDomainDiag, ZendeskDiagnostics, ZendeskAccountDiag } from '../types';

// ── Formatting helpers ───────────────────────────────────────────────────────

function fmtSeconds(s: number | null | undefined): string {
  if (s === null || s === undefined || s === 0) return '-';
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

function fmtNum(v: number | null | undefined, decimals = 1): string {
  if (v === null || v === undefined) return '-';
  return Number.isInteger(v) ? String(v) : v.toFixed(decimals);
}

// ── Intercom Tab ─────────────────────────────────────────────────────────────

function IntercomTab() {
  const [data, setData] = useState<IntercomDiagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    getDiagnosticsIntercom()
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-obs-dim text-[14px] py-8 text-center">Loading Intercom data...</p>;
  if (error) return <p className="text-tier-critical text-[14px] py-4">Error: {error}</p>;
  if (!data || data.domains.length === 0) return <p className="text-obs-ghost text-[14px] py-8 text-center">No Intercom data available.</p>;

  const sorted = [...data.domains].sort((a, b) => b.aggregated.conversationVolume - a.aggregated.conversationVolume);

  function toggleExpand(domain: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px] font-mono">
        <thead>
          <tr className="text-obs-ghost border-b border-obs-edge text-left">
            <th className="py-2 pr-4">Domain</th>
            <th className="py-2 pr-4 text-right">Volume (30d)</th>
            <th className="py-2 pr-4 text-right">Open</th>
            <th className="py-2 pr-4 text-right">Avg Response</th>
            <th className="py-2 pr-4 text-right">Quick Res</th>
            <th className="py-2 pr-4 text-right">AI Handled</th>
            <th className="py-2 pr-4 text-right">CX Score</th>
            <th className="py-2 text-right">CX Rated</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(d => (
            <IntercomDomainRow
              key={d.domain}
              domain={d}
              isExpanded={expanded.has(d.domain)}
              onToggle={() => toggleExpand(d.domain)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IntercomDomainRow({ domain: d, isExpanded, onToggle }: { domain: IntercomDomainDiag; isExpanded: boolean; onToggle: () => void }) {
  const a = d.aggregated;
  return (
    <>
      <tr
        className="border-b border-obs-edge/50 cursor-pointer hover:bg-obs-card transition-colors"
        onClick={onToggle}
      >
        <td className="py-2 pr-4 text-obs-bright">{isExpanded ? '▾' : '▸'} {d.domain}</td>
        <td className="py-2 pr-4 text-right text-obs-text">{a.conversationVolume}</td>
        <td className={`py-2 pr-4 text-right ${a.openCount >= 6 ? 'text-tier-critical' : 'text-obs-text'}`}>{a.openCount}</td>
        <td className={`py-2 pr-4 text-right ${a.avgResponseTime > 86400 ? 'text-tier-critical' : 'text-obs-text'}`}>{fmtSeconds(a.avgResponseTime)}</td>
        <td className="py-2 pr-4 text-right text-obs-text">{a.quickResolutions}</td>
        <td className="py-2 pr-4 text-right text-obs-text">{a.aiHandled}</td>
        <td className={`py-2 pr-4 text-right ${a.avgCxScore !== null && a.avgCxScore < 3.0 ? 'text-tier-critical' : 'text-obs-text'}`}>{fmtNum(a.avgCxScore)}</td>
        <td className="py-2 text-right text-obs-text">{a.cxScoreCount}</td>
      </tr>
      {isExpanded && d.snapshots.length > 0 && (
        <tr>
          <td colSpan={8} className="bg-obs-card/30 px-6 py-2">
            <table className="w-full text-[12px] font-mono">
              <thead>
                <tr className="text-obs-ghost border-b border-obs-edge/50">
                  <th className="py-1 pr-3 text-left">Date</th>
                  <th className="py-1 pr-3 text-right">Volume</th>
                  <th className="py-1 pr-3 text-right">Open</th>
                  <th className="py-1 pr-3 text-right">Avg Resp</th>
                  <th className="py-1 pr-3 text-right">Quick Res</th>
                  <th className="py-1 pr-3 text-right">AI</th>
                  <th className="py-1 pr-3 text-right">CX Total</th>
                  <th className="py-1 text-right">CX Rated</th>
                </tr>
              </thead>
              <tbody>
                {d.snapshots.map(s => (
                  <tr key={s.date} className="border-b border-obs-edge/30">
                    <td className="py-1 pr-3 text-obs-dim">{s.date}</td>
                    <td className="py-1 pr-3 text-right text-obs-text">{s.conversationVolume}</td>
                    <td className="py-1 pr-3 text-right text-obs-text">{s.openCount}</td>
                    <td className="py-1 pr-3 text-right text-obs-text">{fmtSeconds(s.avgResponseTime)}</td>
                    <td className="py-1 pr-3 text-right text-obs-text">{s.quickResolutions}</td>
                    <td className="py-1 pr-3 text-right text-obs-text">{s.aiHandled}</td>
                    <td className="py-1 pr-3 text-right text-obs-text">{fmtNum(s.cxScoreTotal)}</td>
                    <td className="py-1 text-right text-obs-text">{s.cxScoreCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Zendesk Tab ──────────────────────────────────────────────────────────────

function ZendeskTab() {
  const [data, setData] = useState<ZendeskDiagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDiagnosticsZendesk()
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-obs-dim text-[14px] py-8 text-center">Loading Zendesk data...</p>;
  if (error) return <p className="text-tier-critical text-[14px] py-4">Error: {error}</p>;
  if (!data || data.accounts.length === 0) return <p className="text-obs-ghost text-[14px] py-8 text-center">No Zendesk data available.</p>;

  return (
    <div>
      {data.syncedAt && (
        <p className="text-[12px] text-obs-ghost mb-3 font-mono">
          Data from last sync at {new Date(data.syncedAt).toLocaleString()}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-[13px] font-mono">
          <thead>
            <tr className="text-obs-ghost border-b border-obs-edge text-left">
              <th className="py-2 pr-4">Account Name</th>
              <th className="py-2 pr-4">Domain</th>
              <th className="py-2 pr-4 text-right">Tickets (30d)</th>
              <th className="py-2 pr-4 text-right">Open</th>
              <th className="py-2 pr-4 text-right">High</th>
              <th className="py-2 pr-4 text-right">Urgent</th>
              <th className="py-2 pr-4 text-right">Vol Pen</th>
              <th className="py-2 pr-4 text-right">Open Pen</th>
              <th className="py-2 pr-4 text-right">Sev Pen</th>
              <th className="py-2 text-right">Total Pen</th>
            </tr>
          </thead>
          <tbody>
            {data.accounts.map(a => (
              <ZendeskAccountRow key={a.accountName} account={a} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ZendeskAccountRow({ account: a }: { account: ZendeskAccountDiag }) {
  return (
    <tr className="border-b border-obs-edge/50">
      <td className="py-2 pr-4 text-obs-bright">{a.accountName}</td>
      <td className="py-2 pr-4 text-obs-dim text-[12px]">{a.domain}</td>
      <td className="py-2 pr-4 text-right text-obs-text">{a.ticketVolume}</td>
      <td className={`py-2 pr-4 text-right ${a.openCount >= 6 ? 'text-tier-critical' : 'text-obs-text'}`}>{a.openCount}</td>
      <td className={`py-2 pr-4 text-right ${a.highPriorityCount >= 3 ? 'text-tier-critical' : 'text-obs-text'}`}>{a.highPriorityCount}</td>
      <td className={`py-2 pr-4 text-right ${a.urgentCount >= 1 ? 'text-tier-critical' : 'text-obs-text'}`}>{a.urgentCount}</td>
      <td className={`py-2 pr-4 text-right ${a.volumePenalty < 0 ? 'text-tier-critical' : 'text-obs-text'}`}>{a.volumePenalty}</td>
      <td className={`py-2 pr-4 text-right ${a.openPenalty < 0 ? 'text-tier-critical' : 'text-obs-text'}`}>{a.openPenalty}</td>
      <td className={`py-2 pr-4 text-right ${a.severityPenalty < 0 ? 'text-tier-critical' : 'text-obs-text'}`}>{a.severityPenalty}</td>
      <td className={`py-2 text-right font-bold ${a.totalPenalty < 0 ? 'text-tier-critical' : 'text-obs-text'}`}>{a.totalPenalty}</td>
    </tr>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function Diagnostics() {
  const [tab, setTab] = useState<'intercom' | 'zendesk'>('intercom');

  return (
    <div className="min-h-screen bg-obs-bg text-obs-text">
      {/* Header */}
      <header className="border-b border-obs-edge bg-obs-surface px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-obs-ghost hover:text-obs-text text-[14px]">← Portfolio</Link>
          <span className="text-obs-edge">|</span>
          <span className="font-semibold text-obs-bright text-[15px]">Diagnostics</span>
          <span className="text-obs-ghost text-[13px] font-mono">Raw Support Data</span>
        </div>
      </header>

      <div className="max-w-[1440px] mx-auto px-6 py-6">
        {/* Tab buttons */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setTab('intercom')}
            className={`px-4 py-2 text-[14px] font-medium rounded-lg transition-colors ${
              tab === 'intercom'
                ? 'bg-obs-accent text-white'
                : 'bg-obs-card text-obs-ghost hover:text-obs-text border border-obs-edge'
            }`}
          >
            Intercom
          </button>
          <button
            onClick={() => setTab('zendesk')}
            className={`px-4 py-2 text-[14px] font-medium rounded-lg transition-colors ${
              tab === 'zendesk'
                ? 'bg-obs-accent text-white'
                : 'bg-obs-card text-obs-ghost hover:text-obs-text border border-obs-edge'
            }`}
          >
            Zendesk
          </button>
        </div>

        {/* Tab content */}
        {tab === 'intercom' ? <IntercomTab /> : <ZendeskTab />}
      </div>
    </div>
  );
}
