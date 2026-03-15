import { app, Timer, InvocationContext } from '@azure/functions';
import { getConfig } from '../config';
import { AccountStore } from '../services/accountStore';
import { MappingStore } from '../services/mappingStore';
import { ScoreStore } from '../services/scoreStore';
import { searchActiveCompanies } from '../clients/hubspotClient';
import { fetchSignals } from '../clients/amplitudeClient';
import { fetchZendeskTickets, ZendeskTicketData } from '../clients/zendeskClient';
import { computeScore, applyZendeskPenalty, computeZendeskPenalty } from '../services/healthScoreService';

export interface SyncResult {
  synced: number;   // accounts upserted to accountStore
  scored: number;   // accounts with a score computed
  failed: number;   // accounts where Amplitude fetch failed
  zendeskFetched: number; // domains with Zendesk data fetched
  errors: string[]; // error messages
}

export async function runSync(context?: InvocationContext): Promise<SyncResult> {
  const log = (msg: string, ...args: unknown[]) => {
    if (context) {
      context.log(msg, ...args);
    } else {
      console.log(msg, ...args);
    }
  };

  try {
    const config = getConfig();

    const accountStore = new AccountStore(config.storageConnectionString, config.tableAccounts);
    const mappingStore = new MappingStore(config.storageConnectionString, config.tableMapping);
    const scoreStore = new ScoreStore(config.storageConnectionString, config.tableScores);

    await Promise.all([
      accountStore.ensureTable(),
      mappingStore.ensureTable(),
      scoreStore.ensureTable(),
    ]);

    // Fetch all active HubSpot companies
    const companies = await searchActiveCompanies(config.hubspotApiKey);
    log(`Fetched ${companies.length} active companies from HubSpot`);

    // Upsert each company into the account store (Merge mode preserves licenses)
    for (const company of companies) {
      await accountStore.upsertAccount(company);
    }

    // Reload stored accounts to pick up manually-entered licenses
    const storedAccounts = await accountStore.listAccounts();
    const storedMap = new Map(storedAccounts.map(a => [a.hubspotId, a]));

    // Build mapping lookup: hubspotId → amplitudeAlias
    const mappingList = await mappingStore.listMappings();
    const mappingMap = new Map<string, string>(
      mappingList.map(m => [m.hubspotId, m.amplitudeAlias])
    );

    // ── Zendesk fetch phase ─────────────────────────────────────────────────
    const zendeskEnabled = !!(config.zendeskSubdomain && config.zendeskEmail && config.zendeskApiToken);
    const zendeskMap = new Map<string, ZendeskTicketData | null>();
    let zendeskFetched = 0;

    if (zendeskEnabled) {
      // Collect unique non-empty domains from stored accounts
      const domains = new Set<string>();
      for (const acct of storedAccounts) {
        if (acct.domain) {
          domains.add(acct.domain);
        }
      }

      const domainArray = Array.from(domains);
      let isFirstCall = true;

      for (const domain of domainArray) {
        const data = await fetchZendeskTickets(
          config.zendeskSubdomain!,
          config.zendeskEmail!,
          config.zendeskApiToken!,
          domain
        );

        if (isFirstCall && data === null) {
          log('Zendesk: first call returned null (possible auth failure) — skipping remaining domains');
          break;
        }
        isFirstCall = false;

        zendeskMap.set(domain, data);
        if (data !== null) {
          zendeskFetched++;
        }

        // Rate limiting: 100 req/min → 600ms between calls
        if (domainArray.indexOf(domain) < domainArray.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 600));
        }
      }

      log(`Zendesk: fetched ${zendeskFetched}/${domains.size} domains, ${zendeskFetched} with data`);
    } else {
      log('Zendesk: disabled (missing config)');
    }

    // Load yesterday's scores for delta calculation
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayISO = yesterday.toISOString().slice(0, 10);
    const yesterdayScores = await scoreStore.getAllScoresForDate(yesterdayISO);

    const todayISO = new Date().toISOString().slice(0, 10);

    let scored = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const company of companies) {
      const amplitudeAlias = mappingMap.get(company.hubspotId);
      const accountDomain = storedMap.get(company.hubspotId)?.domain ?? '';
      const zendeskData = accountDomain ? (zendeskMap.get(accountDomain) ?? null) : null;

      if (!amplitudeAlias) {
        // No Amplitude mapping — upsert a placeholder score
        const penalty = zendeskData ? computeZendeskPenalty(zendeskData) : null;
        await scoreStore.upsertScore({
          hubspotId: company.hubspotId,
          date: todayISO,
          score: null,
          tier: 'unmapped',
          dauWauTrend: null,
          monthlyActiveUsers: null,
          licenseUtilization: null,
          lastLoginDays: null,
          featuresUsed: null,
          featureDetails: null,
          scoreDelta: null,
          computedAt: new Date().toISOString(),
          zendeskPenalty: penalty ? penalty.totalPenalty : null,
          zendeskDetails: penalty ? JSON.stringify(penalty) : null,
        });
        continue;
      }

      try {
        const signals = await fetchSignals(
          config.amplitudeApiKey,
          config.amplitudeSecretKey,
          amplitudeAlias,
          config.amplitudeAccountProperty,
        );

        // Use stored licenses (manually entered) rather than HubSpot-synced data
        const licenses = storedMap.get(company.hubspotId)?.licenses ?? null;
        const baseResult = computeScore(signals, licenses);

        // Apply Zendesk penalty
        const adjusted = applyZendeskPenalty(baseResult, zendeskData);
        const penaltyDetails = zendeskData ? computeZendeskPenalty(zendeskData) : null;

        // Calculate score delta vs yesterday
        const yesterdayScore = yesterdayScores.get(company.hubspotId);
        let scoreDelta: number | null = null;
        if (
          yesterdayScore !== undefined &&
          yesterdayScore.score !== null &&
          adjusted.score !== null
        ) {
          scoreDelta = adjusted.score - yesterdayScore.score;
        }

        await scoreStore.upsertScore({
          hubspotId: company.hubspotId,
          date: todayISO,
          score: adjusted.score,
          tier: adjusted.tier,
          dauWauTrend: signals.dauWauTrend,
          monthlyActiveUsers: adjusted.monthlyActiveUsers,
          licenseUtilization: adjusted.licenseUtilization,
          lastLoginDays: signals.lastLoginDays,
          featuresUsed: null,
          featureDetails: null,
          scoreDelta,
          computedAt: new Date().toISOString(),
          zendeskPenalty: adjusted.zendeskPenalty,
          zendeskDetails: penaltyDetails ? JSON.stringify(penaltyDetails) : null,
        });

        scored++;
      } catch (err: any) {
        const msg = `Failed to score ${company.hubspotId} (${company.accountName}): ${err.message}`;
        log(msg);
        errors.push(msg);
        failed++;

        // Still write a null score so the account is represented
        await scoreStore.upsertScore({
          hubspotId: company.hubspotId,
          date: todayISO,
          score: null,
          tier: 'unmapped',
          dauWauTrend: null,
          monthlyActiveUsers: null,
          licenseUtilization: null,
          lastLoginDays: null,
          featuresUsed: null,
          featureDetails: null,
          scoreDelta: null,
          computedAt: new Date().toISOString(),
          zendeskPenalty: null,
          zendeskDetails: null,
        });
      }
    }

    return { synced: companies.length, scored, failed, zendeskFetched, errors };
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    return { synced: 0, scored: 0, failed: 0, zendeskFetched: 0, errors: [msg] };
  }
}

app.timer('NightlySync', {
  schedule: '0 0 2 * * *',  // 2 AM UTC daily
  handler: async (myTimer: Timer, context: InvocationContext) => {
    const result = await runSync(context);
    context.log('Nightly sync complete:', result);
  },
});
