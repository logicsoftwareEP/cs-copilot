import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getConfig } from '../config';
import { IntercomStore } from '../services/intercomStore';
import { AccountStore } from '../services/accountStore';
import { ScoreStore } from '../services/scoreStore';
import { withAuth, corsHeaders } from '../middleware';
import { User } from '../types';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function handleDiagnostics(
  req: HttpRequest,
  context: InvocationContext,
  user: User,
): Promise<HttpResponseInit> {
  const headers = corsHeaders();
  const type = req.params.type;

  if (type === 'intercom') {
    return handleIntercom(headers);
  }
  if (type === 'zendesk') {
    return handleZendesk(headers);
  }

  return { status: 404, headers, body: `Unknown diagnostics type: ${type}` };
}

async function handleIntercom(headers: Record<string, string>): Promise<HttpResponseInit> {
  const config = getConfig();
  const store = new IntercomStore(config.storageConnectionString);
  await store.ensureTable();

  const allSnapshots = await store.getAllSnapshots(30);

  // Group by domain
  const byDomain = new Map<string, typeof allSnapshots>();
  for (const snap of allSnapshots) {
    const existing = byDomain.get(snap.domain) ?? [];
    existing.push(snap);
    byDomain.set(snap.domain, existing);
  }

  const domains = Array.from(byDomain.entries()).map(([domain, snapshots]) => {
    const aggregated = store.aggregate(snapshots);
    return {
      domain,
      aggregated,
      snapshots: snapshots.map(s => ({
        date: s.date,
        conversationVolume: s.conversationVolume,
        openCount: s.openCount,
        avgResponseTime: s.avgResponseTime,
        quickResolutions: s.quickResolutions,
        aiHandled: s.aiHandled,
        cxScoreTotal: s.cxScoreTotal,
        cxScoreCount: s.cxScoreCount,
      })),
    };
  });

  return {
    status: 200,
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ domains }),
  };
}

async function handleZendesk(headers: Record<string, string>): Promise<HttpResponseInit> {
  const config = getConfig();
  const accounts = new AccountStore(config.storageConnectionString, config.tableAccounts);
  const scores = new ScoreStore(config.storageConnectionString, config.tableScores);
  await Promise.all([accounts.ensureTable(), scores.ensureTable()]);

  const [allAccounts, todayScores] = await Promise.all([
    accounts.listAccounts(),
    scores.getAllScoresForDate(todayISO()),
  ]);

  // Build accountId -> account lookup
  const accountLookup = new Map(allAccounts.map(a => [a.accountId, a]));

  // Per-account rows (not grouped by domain, since penalties are non-linear)
  interface ZendeskAccountRow {
    accountName: string;
    domain: string;
    ticketVolume: number;
    openCount: number;
    highPriorityCount: number;
    urgentCount: number;
    totalPenalty: number;
    volumePenalty: number;
    openPenalty: number;
    severityPenalty: number;
  }

  const rows: ZendeskAccountRow[] = [];
  let syncedAt: string | null = null;

  for (const [accountId, score] of todayScores) {
    if (!score.zendeskDetails) continue;
    const account = accountLookup.get(accountId);
    if (!account?.domain) continue;

    if (!syncedAt) syncedAt = score.computedAt;

    const zd = JSON.parse(score.zendeskDetails as string);
    rows.push({
      accountName: account.accountName,
      domain: account.domain,
      ticketVolume: zd.ticketVolume,
      openCount: zd.openCount,
      highPriorityCount: zd.highPriorityCount,
      urgentCount: zd.urgentCount,
      totalPenalty: zd.totalPenalty,
      volumePenalty: zd.volumePenalty,
      openPenalty: zd.openPenalty,
      severityPenalty: zd.severityPenalty,
    });
  }

  rows.sort((a, b) => a.totalPenalty - b.totalPenalty);

  return {
    status: 200,
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ syncedAt, accounts: rows }),
  };
}

app.http('Diagnostics', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'function',
  route: 'diagnostics/{type}',
  handler: withAuth(handleDiagnostics, 'admin'),
});
