import { AccountSummary, IntercomDetails } from '../types';
import { SortCol, TIER_ORDER } from './constants';

// ─── Score breakdown helpers ──────────────────────────────────────────────────

export function dauWauInfo(trend: number | null) {
  if (trend === null) return { pts: 0, label: 'No data', detail: 'No activity data available', hint: null };
  const pct = Math.round(trend * 100);
  const sign = pct >= 0 ? '+' : '';
  const detail = `${sign}${pct}% DAU/WAU ratio change over 28 days`;
  if (trend >= 0.1)  return { pts: 25, label: 'Growing',          detail, hint: 'More users logging in more often than last period.' };
  if (trend > -0.1)  return { pts: 15, label: 'Stable',           detail, hint: 'Usage is holding steady — no significant change.' };
  if (trend >= -0.3) return { pts: 6,  label: 'Declining',        detail, hint: 'Fewer users logging in than last period.' };
                     return { pts: 0,  label: 'Critical decline',  detail, hint: 'A sharp drop in daily active users. Follow up urgently.' };
}

export function licenseInfo(mau: number | null, licenses: number | null) {
  if (licenses === null)
    return { pts: 0, label: 'Not set', detail: 'Enter licence count to enable this metric', hint: null };
  if (mau === null)
    return { pts: 0, label: 'No data', detail: 'No Amplitude activity data available', hint: null };
  const util = Math.min(1, mau / Math.max(1, licenses));
  const pct = Math.round(util * 100);
  let pts = 0;
  if (util >= 0.8) pts = 60;
  else if (util >= 0.6) pts = 45;
  else if (util >= 0.4) pts = 30;
  else if (util >= 0.2) pts = 15;
  const hint =
    util >= 0.8 ? 'Excellent adoption — the team is fully engaged.' :
    util >= 0.6 ? 'Good adoption — most seats are in active use.' :
    util >= 0.4 ? 'Moderate adoption — room to grow engagement.' :
    util >= 0.2 ? 'Low adoption — consider proactive outreach.' :
                  'Very low adoption — churn risk. Engage urgently.';
  return { pts, label: `${pct}% utilisation`, detail: `${mau} of ${licenses} licences used (MAU / paid seats)`, hint };
}

export function featureBreadthInfo(featuresUsed: number | null, total = 12) {
  if (featuresUsed === null) return { pts: 0, label: 'No data', detail: 'No feature usage data', hint: null };
  const ratio = total > 0 ? featuresUsed / total : 0;
  const detail = `${featuresUsed} of ${total} tracked feature categories in active use`;
  if (ratio >= 0.75) return { pts: 15, label: `${featuresUsed}/${total}`, detail, hint: 'Broad adoption — deeply embedded in the product.' };
  if (ratio >= 0.50) return { pts: 10, label: `${featuresUsed}/${total}`, detail, hint: 'Moderate adoption — good usage across key areas.' };
  if (ratio >= 0.25) return { pts: 5,  label: `${featuresUsed}/${total}`, detail, hint: 'Narrow adoption — opportunity to expand usage.' };
                     return { pts: 0,  label: `${featuresUsed}/${total}`, detail, hint: 'Minimal adoption — high churn risk.' };
}

export function zendeskPenaltyInfo(penalty: number | null): { pts: string; label: string; detail: string; hint: string | null } {
  if (penalty === null) return { pts: 'N/A', label: 'No data', detail: 'Zendesk not configured or no domain', hint: null };
  if (penalty === 0) return { pts: '0', label: 'No issues', detail: 'No significant support burden', hint: 'Clean — no ticket penalty applied.' };
  if (penalty >= -9) return { pts: String(penalty), label: 'Minor', detail: `${penalty} point deduction`, hint: 'Some support activity detected.' };
  return { pts: String(penalty), label: 'High', detail: `${penalty} point deduction`, hint: 'Significant support burden. Review tickets.' };
}

export function intercomPenaltyInfo(details: IntercomDetails | null): { pts: string; label: string; detail: string; hint: string | null } {
  if (!details) return { pts: 'N/A', label: 'No data', detail: 'Intercom not configured or no domain', hint: null };
  const penalty = (details.openPenalty ?? 0) + (details.slowPenalty ?? 0);
  if (penalty === 0) return { pts: '0', label: 'No issues', detail: 'No open conversation burden', hint: 'Clean — no Intercom penalty applied.' };
  const parts: string[] = [];
  if (details.openCount > 0) parts.push(`${details.openCount} open`);
  if (details.slowPenalty < 0) parts.push('slow responses');
  return {
    pts: String(penalty),
    label: parts.join(', '),
    detail: `Open: ${details.openCount} · Avg response: ${Math.round((details.avgResponseTime ?? 0) / 3600)}h`,
    hint: penalty <= -8 ? 'High support burden from Intercom conversations.' : 'Some open conversations — monitor closely.',
  };
}

export function intercomBonusInfo(details: IntercomDetails | null): { pts: string; label: string; detail: string; hint: string | null } {
  if (!details) return { pts: 'N/A', label: 'No data', detail: 'Intercom not configured', hint: null };
  const bonus = details.totalBonus ?? 0;
  if (bonus === 0) return { pts: '0', label: 'No engagement', detail: 'No qualifying engagement signals detected', hint: null };
  const parts: string[] = [];
  if (details.quickResolutionBonus > 0) parts.push(`${details.quickResolutions} quick resolutions`);
  if (details.aiBonus > 0) parts.push(`${details.aiHandled} AI-handled`);
  if (details.engagementBonus > 0) parts.push('active & not stuck');
  return {
    pts: `+${bonus}`,
    label: parts.join(', '),
    detail: `Quick: ${details.quickResolutions ?? 0} · AI: ${details.aiHandled ?? 0} · Volume: ${details.conversationVolume ?? 0}`,
    hint: bonus >= 7 ? 'Highly engaged — strong product adoption signals.' : 'Some positive engagement signals detected.',
  };
}

export function cxScoreInfo(details: IntercomDetails | null): { pts: string; label: string; detail: string; hint: string | null } {
  if (!details || details.avgCxScore == null) {
    return { pts: 'N/A', label: 'No data', detail: 'No CX Score ratings available', hint: null };
  }
  if ((details.cxScoreCount ?? 0) < 3) {
    return { pts: 'N/A', label: 'Insufficient data', detail: `Only ${details.cxScoreCount ?? 0} rated conversation(s) — need 3+`, hint: null };
  }

  const net = details.netCxScore ?? 0;
  const avg = details.avgCxScore.toFixed(1);

  if (net === 0) {
    return { pts: '0', label: `Avg ${avg}/5`, detail: `${details.cxScoreCount} conversations rated`, hint: 'Neutral — CX Score in the mid range.' };
  }
  if (net > 0) {
    return { pts: `+${net}`, label: `Avg ${avg}/5`, detail: `${details.cxScoreCount} conversations rated`, hint: net >= 3 ? 'Excellent AI-assessed satisfaction.' : 'Good AI-assessed satisfaction.' };
  }
  return { pts: String(net), label: `Avg ${avg}/5`, detail: `${details.cxScoreCount} conversations rated`, hint: net <= -5 ? 'Poor AI-assessed satisfaction — review conversations.' : 'Below-average satisfaction. Monitor closely.' };
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

export function fmtSeconds(s: number | null | undefined): string {
  if (s === null || s === undefined || s === 0) return '—';
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

export function fmtNum(v: number | null | undefined, decimals = 1): string {
  if (v === null || v === undefined) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(decimals);
}

// ─── Utility helpers ──────────────────────────────────────────────────────────

export function formatArr(arr: number | null | undefined): string {
  if (arr == null || arr === 0) return '—';
  if (arr >= 1000) return `$${(arr / 1000).toFixed(arr >= 10000 ? 0 : 1)}k`;
  return `$${arr.toFixed(0)}`;
}

export function renewalInfo(date: string): { label: string; urgency: 'expired' | 'urgent' | 'soon' | 'ok' | 'none' } {
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

export function lastSyncedLabel(accounts: AccountSummary[]): string {
  const sorted = accounts.map(a => a.syncedAt).filter(Boolean).sort();
  const ts = sorted[sorted.length - 1];
  if (!ts) return '';
  const mins = Math.round((Date.now() - new Date(ts).getTime()) / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function sortRows(rows: AccountSummary[], col: SortCol, dir: 'asc' | 'desc'): AccountSummary[] {
  const m = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    switch (col) {
      case 'accountName':    return m * (a.accountName ?? '').localeCompare(b.accountName ?? '');
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
