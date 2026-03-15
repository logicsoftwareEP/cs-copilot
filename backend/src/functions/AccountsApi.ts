import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getConfig } from '../config';
import { AccountStore } from '../services/accountStore';
import { ScoreStore } from '../services/scoreStore';
import { MappingStore } from '../services/mappingStore';
import { AccountSummary } from '../types';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
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
    const { accounts, scores, mappings } = makeStores();
    await Promise.all([accounts.ensureTable(), scores.ensureTable(), mappings.ensureTable()]);

    const [allAccounts, todayScores, allMappings] = await Promise.all([
      accounts.listAccounts(),
      scores.getAllScoresForDate(todayISO()),
      mappings.listMappings(),
    ]);

    const mappingLookup = new Map(allMappings.map(m => [m.hubspotId, m.amplitudeAlias]));

    const missingIds = allAccounts
      .filter(a => !todayScores.has(a.hubspotId))
      .map(a => a.hubspotId);

    const fallbackScores = new Map(
      await Promise.all(
        missingIds.map(async id => {
          const s = await scores.getLatestScoreForAccount(id);
          return [id, s] as const;
        })
      )
    );

    const summary: AccountSummary[] = allAccounts.map(account => {
      const scoreRow = todayScores.get(account.hubspotId) ?? fallbackScores.get(account.hubspotId) ?? null;
      return {
        ...account,
        score: scoreRow?.score ?? null,
        tier: scoreRow?.tier ?? null,
        scoreDelta: scoreRow?.scoreDelta ?? null,
        amplitudeAlias: mappingLookup.get(account.hubspotId) ?? null,
      };
    });

    return {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify(summary),
    };
  } catch (err: any) {
    context.error('listAccounts failed:', err);
    return { status: 500, headers: CORS_HEADERS, body: `Internal error: ${err.message}` };
  }
}

async function getAccount(
  req: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const hubspotId = req.params.id;

  if (req.method === 'OPTIONS') return { status: 204, headers: CORS_HEADERS };

  // ── PATCH: update license count ────────────────────────────────────────────
  if (req.method === 'PATCH') {
    try {
      const body = await req.json() as { licenses?: number | null };
      const licenses = body.licenses !== undefined ? body.licenses : null;

      if (licenses !== null && (typeof licenses !== 'number' || licenses < 0)) {
        return { status: 400, headers: CORS_HEADERS, body: 'licenses must be a non-negative number or null.' };
      }

      const { accounts } = makeStores();
      await accounts.ensureTable();
      await accounts.updateLicenses(hubspotId, licenses);

      return { status: 204, headers: CORS_HEADERS };
    } catch (err: any) {
      context.error('updateLicenses failed:', err);
      return { status: 500, headers: CORS_HEADERS, body: `Internal error: ${err.message}` };
    }
  }

  // ── GET: account detail with score breakdown ───────────────────────────────
  try {
    const { accounts, scores, mappings } = makeStores();

    const [account, mapping] = await Promise.all([
      accounts.getById(hubspotId),
      mappings.getMapping(hubspotId),
    ]);

    if (!account) {
      return { status: 404, headers: CORS_HEADERS, body: 'Account not found.' };
    }

    const [latestScore, history] = await Promise.all([
      scores.getLatestScoreForAccount(hubspotId),
      scores.getScoreHistory(hubspotId, 7),
    ]);

    return {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...account,
        score: latestScore?.score ?? null,
        tier: latestScore?.tier ?? null,
        scoreDelta: latestScore?.scoreDelta ?? null,
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

// Single handler for GET + PATCH + OPTIONS on accounts/{id}
app.http('GetAccount', {
  methods: ['GET', 'PATCH', 'OPTIONS'],
  authLevel: 'function',
  route: 'accounts/{id}',
  handler: getAccount,
});
