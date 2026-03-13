import { app, Timer, InvocationContext } from '@azure/functions';
import { getConfig } from '../config';
import { AccountStore } from '../services/accountStore';
import { MappingStore } from '../services/mappingStore';
import { ScoreStore } from '../services/scoreStore';
import { searchActiveCompanies } from '../clients/hubspotClient';
import { fetchSignals } from '../clients/amplitudeClient';
import { computeScore } from '../services/healthScoreService';

export interface SyncResult {
  synced: number;   // accounts upserted to accountStore
  scored: number;   // accounts with a score computed
  failed: number;   // accounts where Amplitude fetch failed
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

    // Upsert each company into the account store
    for (const company of companies) {
      await accountStore.upsertAccount(company);
    }

    // Build mapping lookup: hubspotId → amplitudeAlias
    const mappingList = await mappingStore.listMappings();
    const mappingMap = new Map<string, string>(
      mappingList.map(m => [m.hubspotId, m.amplitudeAlias])
    );

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

      if (!amplitudeAlias) {
        // No Amplitude mapping — upsert a placeholder score
        await scoreStore.upsertScore({
          hubspotId: company.hubspotId,
          date: todayISO,
          score: null,
          tier: 'unmapped',
          dauWauTrend: null,
          featureAdoption: null,
          lastLoginDays: null,
          scoreDelta: null,
          computedAt: new Date().toISOString(),
        });
        continue;
      }

      try {
        const signals = await fetchSignals(
          config.amplitudeApiKey,
          config.amplitudeSecretKey,
          amplitudeAlias,
          config.amplitudeAccountProperty,
          config.amplitudeFeaturesTotal,
        );

        const { score, tier } = computeScore(signals);

        // Calculate score delta vs yesterday
        const yesterdayScore = yesterdayScores.get(company.hubspotId);
        let scoreDelta: number | null = null;
        if (
          yesterdayScore !== undefined &&
          yesterdayScore.score !== null &&
          score !== null
        ) {
          scoreDelta = score - yesterdayScore.score;
        }

        await scoreStore.upsertScore({
          hubspotId: company.hubspotId,
          date: todayISO,
          score,
          tier,
          dauWauTrend: signals.dauWauTrend,
          featureAdoption: signals.featureAdoption,
          lastLoginDays: signals.lastLoginDays,
          scoreDelta,
          computedAt: new Date().toISOString(),
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
          featureAdoption: null,
          lastLoginDays: null,
          scoreDelta: null,
          computedAt: new Date().toISOString(),
        });
      }
    }

    return { synced: companies.length, scored, failed, errors };
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    return { synced: 0, scored: 0, failed: 0, errors: [msg] };
  }
}

app.timer('NightlySync', {
  schedule: '0 0 2 * * *',  // 2 AM UTC daily
  handler: async (myTimer: Timer, context: InvocationContext) => {
    const result = await runSync(context);
    context.log('Nightly sync complete:', result);
  },
});
