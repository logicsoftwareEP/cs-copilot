import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getConfig } from '../config';
import { AccountStore } from '../services/accountStore';
import { ScoreStore } from '../services/scoreStore';
import { MappingStore } from '../services/mappingStore';
import { AccountSummary } from '../types';
import { authenticateRequest, requireRole, AuthError } from '../auth';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-User-Email',
};

function makeStores() {
  const config = getConfig();
  return {
    accounts: new AccountStore(config.storageConnectionString, config.tableAccounts),
    scores: new ScoreStore(config.storageConnectionString, config.tableScores),
    mappings: new MappingStore(config.storageConnectionString, config.tableMapping),
  };
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

async function listAccounts(
  req: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: CORS_HEADERS };

  try {
    const user = await authenticateRequest(req);

    const { accounts, scores, mappings } = makeStores();
    await Promise.all([accounts.ensureTable(), scores.ensureTable(), mappings.ensureTable()]);

    const [allAccounts, todayScores, allMappings] = await Promise.all([
      accounts.listAccounts(),
      scores.getAllScoresForDate(todayISO()),
      mappings.listMappings(),
    ]);

    const mappingLookup = new Map(allMappings.map(m => [m.accountId, m.amplitudeAlias]));

    const missingIds = allAccounts
      .filter(a => !todayScores.has(a.accountId))
      .map(a => a.accountId);

    const fallbackScores = new Map(
      await Promise.all(
        missingIds.map(async id => {
          const s = await scores.getLatestScoreForAccount(id);
          return [id, s] as const;
        })
      )
    );

    let summary: AccountSummary[] = allAccounts.map(account => {
      const scoreRow = todayScores.get(account.accountId) ?? fallbackScores.get(account.accountId) ?? null;
      return {
        ...account,
        score: scoreRow?.score ?? null,
        tier: scoreRow?.tier ?? null,
        scoreDelta: scoreRow?.scoreDelta ?? null,
        amplitudeAlias: mappingLookup.get(account.accountId) ?? null,
        aliasStatus: scoreRow?.aliasStatus ?? null,
      };
    });

    // CSM filtering: only show accounts owned by this CSM (matched by email)
    if (user.role === 'csm') {
      const email = user.email.toLowerCase();
      summary = summary.filter(a =>
        (a.csmEmail ?? '').toLowerCase() === email
      );
    }

    return {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify(summary),
    };
  } catch (err: any) {
    if (err instanceof AuthError) return { status: err.status, headers: CORS_HEADERS, body: err.message };
    context.error('listAccounts failed:', err);
    return { status: 500, headers: CORS_HEADERS, body: `Internal error: ${err.message}` };
  }
}

async function getAccount(
  req: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: CORS_HEADERS };

  const accountId = req.params.id;

  try {
    const user = await authenticateRequest(req);

    // ── PATCH: update licence count and/or ARR ────────────────────────────────
    if (req.method === 'PATCH') {
      requireRole(user, 'admin', 'supervisor');

      const body = await req.json() as { licenses?: number | null; arr?: number };
      const { accounts } = makeStores();
      await accounts.ensureTable();

      if (body.licenses !== undefined) {
        const licenses = body.licenses;
        if (licenses !== null && (typeof licenses !== 'number' || licenses < 0)) {
          return { status: 400, headers: CORS_HEADERS, body: 'licenses must be a non-negative number or null.' };
        }
        await accounts.updateLicenses(accountId, licenses);
      }

      if (body.arr !== undefined) {
        const arr = typeof body.arr === 'number' ? body.arr : Number(body.arr);
        if (!isNaN(arr) && arr >= 0) {
          await accounts.updateArr(accountId, arr);
        }
      }

      return { status: 204, headers: CORS_HEADERS };
    }

    // ── GET: account detail with score breakdown ───────────────────────────────
    const { accounts, scores, mappings } = makeStores();

    const [account, mapping] = await Promise.all([
      accounts.getById(accountId),
      mappings.getMapping(accountId),
    ]);

    if (!account) {
      return { status: 404, headers: CORS_HEADERS, body: 'Account not found.' };
    }

    // CSM filtering: can only view own accounts (matched by email)
    if (user.role === 'csm' && (account.csmEmail ?? '').toLowerCase() !== user.email.toLowerCase()) {
      return { status: 403, headers: CORS_HEADERS, body: 'Access denied.' };
    }

    const [latestScore, history] = await Promise.all([
      scores.getLatestScoreForAccount(accountId),
      scores.getScoreHistory(accountId, 7),
    ]);

    return {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...account,
        score: latestScore?.score ?? null,
        tier: latestScore?.tier ?? null,
        scoreDelta: latestScore?.scoreDelta ?? null,
        aliasStatus: latestScore?.aliasStatus ?? null,
        amplitudeAlias: mapping?.amplitudeAlias ?? null,
        scoreBreakdown: latestScore
          ? {
              dauWauTrend: latestScore.dauWauTrend,
              monthlyActiveUsers: latestScore.monthlyActiveUsers,
              licenseUtilization: latestScore.licenseUtilization,
              featuresUsed: latestScore.featuresUsed ?? null,
              featureDetails: latestScore.featureDetails ? JSON.parse(latestScore.featureDetails as string) : null,
              zendeskPenalty: latestScore.zendeskPenalty ?? null,
              zendeskDetails: latestScore.zendeskDetails ? JSON.parse(latestScore.zendeskDetails as string) : null,
            }
          : null,
        scoreHistory: history,
      }),
    };
  } catch (err: any) {
    if (err instanceof AuthError) return { status: err.status, headers: CORS_HEADERS, body: err.message };
    context.error('getAccount failed:', err);
    return { status: 500, headers: CORS_HEADERS, body: `Internal error: ${err.message}` };
  }
}

app.http('ListAccounts', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'function',
  route: 'accounts',
  handler: listAccounts,
});

// Single handler for GET + PATCH on accounts/{id}
app.http('GetAccount', {
  methods: ['GET', 'PATCH', 'OPTIONS'],
  authLevel: 'function',
  route: 'accounts/{id}',
  handler: getAccount,
});
