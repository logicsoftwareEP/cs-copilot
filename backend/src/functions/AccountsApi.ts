import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getConfig } from '../config';
import { AccountStore } from '../services/accountStore';
import { ScoreStore } from '../services/scoreStore';
import { MappingStore } from '../services/mappingStore';
import { AccountSummary, User } from '../types';
import { fetchSignals, validateAlias } from '../clients/amplitudeClient';
import { fetchAllZendeskTickets } from '../clients/zendeskClient';
import { buildScoreRow } from '../services/healthScoreService';
import { IntercomStore, IntercomAggregated } from '../services/intercomStore';
import { withAuth, corsHeaders } from '../middleware';
import { todayISO } from '../utils/dateUtils';

function makeStores() {
  const config = getConfig();
  return {
    accounts: new AccountStore(config.storageConnectionString, config.tableAccounts),
    scores: new ScoreStore(config.storageConnectionString, config.tableScores),
    mappings: new MappingStore(config.storageConnectionString, config.tableMapping),
  };
}

async function listAccounts(
  req: HttpRequest,
  context: InvocationContext,
  user: User,
): Promise<HttpResponseInit> {
  const headers = corsHeaders();
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
      hidden: account.hidden,
    };
  });

  // CSM filtering: only show accounts owned by this CSM (matched by email)
  if (user.role === 'csm') {
    const email = user.email.toLowerCase();
    summary = summary.filter(a =>
      (a.csmEmail ?? '').toLowerCase() === email && !a.hidden
    );
  }

  return {
    status: 200,
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(summary),
  };
}

async function getAccount(
  req: HttpRequest,
  context: InvocationContext,
  user: User,
): Promise<HttpResponseInit> {
  const headers = corsHeaders();
  const accountId = req.params.id;

    // ── PATCH: update licence count and/or ARR ────────────────────────────────
    if (req.method === 'PATCH') {
      if (user.role !== 'admin' && user.role !== 'supervisor') {
        return { status: 403, headers, body: 'Requires role: admin or supervisor' };
      }

      const body = await req.json() as { licenses?: number | null; arr?: number; hidden?: boolean };
      const { accounts } = makeStores();
      await accounts.ensureTable();

      if (body.licenses !== undefined) {
        const licenses = body.licenses;
        if (licenses !== null && (typeof licenses !== 'number' || licenses < 0)) {
          return { status: 400, headers: headers, body: 'licenses must be a non-negative number or null.' };
        }
        await accounts.updateLicenses(accountId, licenses);
      }

      if (body.arr !== undefined) {
        const arr = typeof body.arr === 'number' ? body.arr : Number(body.arr);
        if (!isNaN(arr) && arr >= 0) {
          await accounts.updateArr(accountId, arr);
        }
      }

      if (body.hidden !== undefined) {
        if (typeof body.hidden !== 'boolean') {
          return { status: 400, headers: headers, body: 'hidden must be a boolean.' };
        }
        await accounts.updateHidden(accountId, body.hidden);
      }

      return { status: 204, headers: headers };
    }

    // ── POST: refresh score for a single account (all authenticated roles) ────
    if (req.method === 'POST') {

      const config = getConfig();
      const { accounts, scores, mappings } = makeStores();
      await Promise.all([accounts.ensureTable(), scores.ensureTable(), mappings.ensureTable()]);

      const [account, mapping] = await Promise.all([
        accounts.getById(accountId),
        mappings.getMapping(accountId),
      ]);

      if (!account) {
        return { status: 404, headers: headers, body: 'Account not found.' };
      }

      // CSM can only refresh their own accounts
      if (user.role === 'csm' && (account.csmEmail ?? '').toLowerCase() !== user.email.toLowerCase()) {
        return { status: 403, headers, body: 'Access denied.' };
      }

      const amplitudeAlias = mapping?.amplitudeAlias;
      if (!amplitudeAlias) {
        return { status: 400, headers: headers, body: 'No Amplitude alias set for this account.' };
      }

      const todayISO = new Date().toISOString().slice(0, 10);

      // Fetch Amplitude signals
      const signals = await fetchSignals(
        config.amplitudeApiKey,
        config.amplitudeSecretKey,
        amplitudeAlias,
        config.amplitudeAccountProperty,
        config.amplitudeFeatureEvents,
      );

      // Fetch Zendesk data for this account's domain
      let zendeskData = null;
      if (account.domain && config.zendeskSubdomain && config.zendeskEmail && config.zendeskApiToken) {
        const allTickets = await fetchAllZendeskTickets(
          config.zendeskSubdomain, config.zendeskEmail, config.zendeskApiToken
        );
        if (allTickets) {
          zendeskData = allTickets.get(account.domain) ?? null;
        }
      }

      // Fetch Intercom data for this account's domain
      let intercomData: IntercomAggregated | null = null;
      if (account.domain && config.intercomAccessToken) {
        const intercomStore = new IntercomStore(config.storageConnectionString);
        const rows = await intercomStore.getSnapshots(account.domain, 30);
        intercomData = intercomStore.aggregate(rows);
      }

      // Check for all-zero signals (alias mismatch)
      const isAllZero = signals.dauWauTrend === null
        && signals.monthlyActiveUsers === 0
        && signals.featureBreadth !== null
        && signals.featureBreadth.used.length === 0;

      if (isAllZero) {
        const aliasExists = await validateAlias(
          config.amplitudeApiKey, config.amplitudeSecretKey,
          amplitudeAlias, config.amplitudeAccountProperty
        );
        if (!aliasExists) {
          const row = buildScoreRow({
            accountId, date: todayISO, signals: null, licenses: account.licenses,
            featureEvents: config.amplitudeFeatureEvents,
            zendeskData, intercomData, previousScore: null, aliasStatus: 'not-found',
          });
          await scores.upsertScore(row);
          return {
            status: 200,
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ score: null, tier: 'unmapped', aliasStatus: 'not-found' }),
          };
        }
      }

      // Get yesterday's score for delta
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayISO = yesterday.toISOString().slice(0, 10);
      const yesterdayScores = await scores.getAllScoresForDate(yesterdayISO);
      const prevScore = yesterdayScores.get(accountId);

      const row = buildScoreRow({
        accountId, date: todayISO, signals, licenses: account.licenses,
        featureEvents: config.amplitudeFeatureEvents,
        zendeskData, intercomData,
        previousScore: prevScore?.score ?? null,
        aliasStatus: 'valid',
      });
      await scores.upsertScore(row);

      return {
        status: 200,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ score: row.score, tier: row.tier, aliasStatus: 'valid', scoreDelta: row.scoreDelta }),
      };
    }

    // ── GET: account detail with score breakdown ───────────────────────────────
    const { accounts, scores, mappings } = makeStores();

    const [account, mapping] = await Promise.all([
      accounts.getById(accountId),
      mappings.getMapping(accountId),
    ]);

    if (!account) {
      return { status: 404, headers: headers, body: 'Account not found.' };
    }

    // CSM filtering: can only view own accounts (matched by email)
    if (user.role === 'csm' && (account.csmEmail ?? '').toLowerCase() !== user.email.toLowerCase()) {
      return { status: 403, headers: headers, body: 'Access denied.' };
    }

    const [latestScore, history] = await Promise.all([
      scores.getLatestScoreForAccount(accountId),
      scores.getScoreHistory(accountId, 7),
    ]);

    return {
      status: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...account,
        score: latestScore?.score ?? null,
        tier: latestScore?.tier ?? null,
        scoreDelta: latestScore?.scoreDelta ?? null,
        aliasStatus: latestScore?.aliasStatus ?? null,
        hidden: account.hidden,
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
              intercomPenalty: latestScore.intercomPenalty ?? null,
              intercomBonus: latestScore.intercomBonus ?? null,
              intercomDetails: latestScore.intercomDetails ? JSON.parse(latestScore.intercomDetails as string) : null,
              cxScorePenalty: latestScore.cxScorePenalty ?? null,
              cxScoreBonus: latestScore.cxScoreBonus ?? null,
            }
          : null,
        scoreHistory: history,
      }),
    };
}

app.http('ListAccounts', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'function',
  route: 'accounts',
  handler: withAuth(listAccounts),
});

// Single handler for GET + PATCH + POST on accounts/{id}
app.http('GetAccount', {
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  authLevel: 'function',
  route: 'accounts/{id}',
  handler: withAuth(getAccount),
});
