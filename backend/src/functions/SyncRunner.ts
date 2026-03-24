import { app, Timer, InvocationContext } from '@azure/functions';
import { getConfig } from '../config';
import { AccountStore } from '../services/accountStore';
import { MappingStore } from '../services/mappingStore';
import { ScoreStore } from '../services/scoreStore';
import { UserStore } from '../services/userStore';
import { searchActiveCompanies } from '../clients/hubspotClient';
import { fetchAccountsFromSql, SqlFetchResult } from '../clients/sqlClient';
import { fetchSignals, validateAlias, AmplitudeSignals } from '../clients/amplitudeClient';
import { Account } from '../types';
import { fetchAllZendeskTickets, ZendeskTicketData } from '../clients/zendeskClient';
import { fetchIntercomConversations } from '../clients/intercomClient';
import { IntercomStore, IntercomAggregated } from '../services/intercomStore';
import { computeScore, applyAllPenalties, computeZendeskPenalty, computeIntercomPenalty, computeIntercomBonus } from '../services/healthScoreService';

function isAllZeroSignals(signals: AmplitudeSignals): boolean {
  return (
    signals.dauWauTrend === null &&
    signals.monthlyActiveUsers === 0 &&
    signals.featureBreadth !== null &&
    signals.featureBreadth.used.length === 0
  );
}

export interface SyncResult {
  synced: number;   // accounts upserted to accountStore
  scored: number;   // accounts with a score computed
  failed: number;   // accounts where Amplitude fetch failed
  zendeskFetched: number; // domains with Zendesk data fetched
  intercomFetched: number; // domains with Intercom data fetched
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

    // ── Fetch accounts from configured data source ─────────────────────────
    let companies: Account[];
    let sqlResult: SqlFetchResult | null = null;

    if (config.dataSource === 'sql') {
      if (!config.sqlConnectionString || !config.sqlLogin || !config.sqlPassword) {
        throw new Error('SQL data source selected but SQL credentials not configured');
      }
      sqlResult = await fetchAccountsFromSql(
        config.sqlConnectionString, config.sqlLogin, config.sqlPassword
      );
      companies = sqlResult.accounts;
      log(`Fetched ${companies.length} active accounts from SQL Server`);
    } else {
      if (!config.hubspotApiKey) {
        throw new Error('HubSpot data source selected but HUBSPOT_API_KEY not configured');
      }
      companies = await searchActiveCompanies(config.hubspotApiKey);
      log(`Fetched ${companies.length} active companies from HubSpot`);
    }

    // ── Resolve csmName → csmEmail via users table ────────────────────────
    // SQL view provides CSM name only; look up the matching user to get email.
    const userStore = new UserStore(config.storageConnectionString, config.tableUsers);
    await userStore.ensureTable();
    const allUsers = await userStore.listUsers();
    const nameToEmail = new Map(
      allUsers.map(u => [u.displayName.toLowerCase(), u.email.toLowerCase()])
    );
    let emailResolved = 0;
    for (const company of companies) {
      if (!company.csmEmail && company.csmName) {
        const email = nameToEmail.get(company.csmName.toLowerCase());
        if (email) {
          company.csmEmail = email;
          emailResolved++;
        }
      }
    }
    if (emailResolved > 0) log(`Resolved ${emailResolved} CSM emails from users table`);

    // Upsert each company into the account store (Merge mode preserves licenses)
    for (const company of companies) {
      await accountStore.upsertAccount(company);
    }

    // ── Auto-sync aliases from SQL (before listMappings so scoring sees them) ──
    // Only creates mappings for accounts that don't have one yet.
    // Existing mappings are never overwritten — they may have been corrected
    // for Amplitude casing differences (SQL collation is case-insensitive).
    if (sqlResult?.aliases.size) {
      const existingMappings = await mappingStore.listMappings();
      const existingSet = new Set(existingMappings.map(m => m.accountId));
      let aliasCount = 0;

      for (const [accountId, alias] of sqlResult.aliases) {
        if (!alias) continue;
        if (existingSet.has(accountId)) continue; // preserve existing mapping
        const name = companies.find(c => c.accountId === accountId)?.accountName ?? '';
        await mappingStore.upsertMapping(accountId, name, alias);
        aliasCount++;
      }
      if (aliasCount > 0) log(`Auto-synced ${aliasCount} new Amplitude aliases from SQL`);
    }

    // Reload stored accounts to pick up manually-entered licenses
    const storedAccounts = await accountStore.listAccounts();
    const storedMap = new Map(storedAccounts.map(a => [a.accountId, a]));

    // Apply SQL licences — always overwrite with SQL values (source of truth)
    if (sqlResult?.licences.size) {
      let licCount = 0;
      for (const [accountId, licenceCount] of sqlResult.licences) {
        const stored = storedMap.get(accountId);
        if (stored) {
          await accountStore.updateLicenses(accountId, licenceCount);
          stored.licenses = licenceCount;
          licCount++;
        }
      }
      if (licCount > 0) log(`Auto-synced ${licCount} licence counts from SQL`);
    }

    // Log stale accounts (in Table Storage but not in current data source)
    const sourceIds = new Set(companies.map(c => c.accountId));
    const staleAccounts = storedAccounts.filter(a => !sourceIds.has(a.accountId));
    if (staleAccounts.length > 0) {
      log(`Warning: ${staleAccounts.length} accounts in Table Storage not found in data source (stale)`);
    }

    // Build mapping lookup: accountId → amplitudeAlias
    const mappingList = await mappingStore.listMappings();
    const mappingMap = new Map<string, string>(
      mappingList.map(m => [m.accountId, m.amplitudeAlias])
    );

    // ── Zendesk fetch phase ─────────────────────────────────────────────────
    const zendeskEnabled = !!(config.zendeskSubdomain && config.zendeskEmail && config.zendeskApiToken);
    let zendeskMap = new Map<string, ZendeskTicketData>();
    let zendeskFetched = 0;

    if (zendeskEnabled) {
      const result = await fetchAllZendeskTickets(
        config.zendeskSubdomain!,
        config.zendeskEmail!,
        config.zendeskApiToken!
      );

      if (result === null) {
        log('Zendesk: fetch failed (possible auth failure)');
      } else {
        zendeskMap = result;
        zendeskFetched = zendeskMap.size;
        const totalTickets = [...zendeskMap.values()].reduce((sum, d) => sum + d.openCount, 0);
        log(`Zendesk: ${totalTickets} open tickets across ${zendeskFetched} domains`);
      }
    } else {
      log('Zendesk: disabled (missing config)');
    }

    // ── Date calculations ─────────────────────────────────────────────────────
    const todayISO = new Date().toISOString().slice(0, 10);

    // ── Intercom fetch phase ──────────────────────────────────────────────────
    const intercomEnabled = !!config.intercomAccessToken;
    const intercomStore = new IntercomStore(config.storageConnectionString);
    let intercomDomainMap = new Map<string, IntercomAggregated>();
    let intercomFetched = 0;

    if (intercomEnabled) {
      await intercomStore.ensureTable();
      const snapshots = await fetchIntercomConversations(config.intercomAccessToken!, 36);
      if (snapshots === null) {
        log('Intercom: fetch failed (possible auth failure)');
      } else {
        for (const [domain, data] of snapshots) {
          await intercomStore.upsertSnapshot(domain, todayISO, data);
        }
        log(`Intercom: stored snapshots for ${snapshots.size} domains`);

        // Aggregate last 30 days per domain
        const allDomains = new Set<string>();
        for (const [domain] of snapshots) allDomains.add(domain);
        for (const company of companies) {
          const d = storedMap.get(company.accountId)?.domain ?? company.domain;
          if (d) allDomains.add(d);
        }
        for (const domain of allDomains) {
          const rows = await intercomStore.getSnapshots(domain, 30);
          const aggregated = intercomStore.aggregate(rows);
          if (aggregated) intercomDomainMap.set(domain, aggregated);
        }
        intercomFetched = intercomDomainMap.size;
        log(`Intercom: ${intercomFetched} domains with 30d aggregated data`);
      }
      const deleted = await intercomStore.cleanup(35);
      if (deleted > 0) log(`Intercom: cleaned up ${deleted} old snapshot rows`);
    } else {
      log('Intercom: disabled (missing config)');
    }

    // Load yesterday's scores for delta calculation
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayISO = yesterday.toISOString().slice(0, 10);
    const yesterdayScores = await scoreStore.getAllScoresForDate(yesterdayISO);

    // Load today's scores to skip accounts already scored with valid Amplitude data.
    // On re-sync, only re-query accounts that failed (score=0 with valid alias) or are new.
    const todayScores = await scoreStore.getAllScoresForDate(todayISO);
    let skipped = 0;

    let scored = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const company of companies) {
      // Skip scoring for hidden accounts
      if (storedMap.get(company.accountId)?.hidden) {
        continue;
      }

      const amplitudeAlias = mappingMap.get(company.accountId);
      const accountDomain = storedMap.get(company.accountId)?.domain ?? '';
      const zendeskData = accountDomain ? (zendeskMap.get(accountDomain) ?? null) : null;

      // Skip Amplitude re-query if this account already has a valid score today
      // (non-null score with MAU data). Zendesk/Intercom penalties still get refreshed.
      if (amplitudeAlias) {
        const existing = todayScores.get(company.accountId);
        if (existing && existing.score !== null && existing.score > 0) {
          skipped++;
          continue;
        }
      }

      if (!amplitudeAlias) {
        // No Amplitude mapping — upsert a placeholder score
        const penalty = zendeskData ? computeZendeskPenalty(zendeskData) : null;
        await scoreStore.upsertScore({
          accountId: company.accountId,
          date: todayISO,
          score: null,
          tier: 'unmapped',
          dauWauTrend: null,
          monthlyActiveUsers: null,
          licenseUtilization: null,
          featuresUsed: null,
          featureDetails: null,
          scoreDelta: null,
          computedAt: new Date().toISOString(),
          zendeskPenalty: penalty ? penalty.totalPenalty : null,
          zendeskDetails: penalty ? JSON.stringify(penalty) : null,
          intercomPenalty: null, intercomBonus: null, intercomDetails: null,
          aliasStatus: null,
        });
        continue;
      }

      try {
        const signals = await fetchSignals(
          config.amplitudeApiKey,
          config.amplitudeSecretKey,
          amplitudeAlias,
          config.amplitudeAccountProperty,
          config.amplitudeFeatureEvents,
        );

        // All signals zero — validate whether alias actually exists in Amplitude
        if (isAllZeroSignals(signals)) {
          const aliasExists = await validateAlias(
            config.amplitudeApiKey,
            config.amplitudeSecretKey,
            amplitudeAlias,
            config.amplitudeAccountProperty
          );

          if (!aliasExists) {
            // Alias not found — treat as unmapped, not score=0
            const penalty = zendeskData ? computeZendeskPenalty(zendeskData) : null;
            await scoreStore.upsertScore({
              accountId: company.accountId,
              date: todayISO,
              score: null,
              tier: 'unmapped',
              dauWauTrend: null,
              monthlyActiveUsers: null,
              licenseUtilization: null,
              featuresUsed: null,
              featureDetails: null,
              scoreDelta: null,
              computedAt: new Date().toISOString(),
              zendeskPenalty: penalty ? penalty.totalPenalty : null,
              zendeskDetails: penalty ? JSON.stringify(penalty) : null,
              intercomPenalty: null, intercomBonus: null, intercomDetails: null,
              aliasStatus: 'not-found',
            });
            log(`Alias not found in Amplitude: ${amplitudeAlias} (${company.accountName})`);
            continue;
          }
        }

        // Use stored licenses (manually entered) rather than HubSpot-synced data
        const licenses = storedMap.get(company.accountId)?.licenses ?? null;
        const baseResult = computeScore(signals, licenses);

        // Apply Zendesk + Intercom penalties/bonuses
        const intercomData = accountDomain ? (intercomDomainMap.get(accountDomain) ?? null) : null;
        const adjusted = applyAllPenalties(baseResult, zendeskData, intercomData);
        const penaltyDetails = zendeskData ? computeZendeskPenalty(zendeskData) : null;
        const intercomPenaltyDetails = intercomData ? computeIntercomPenalty(intercomData) : null;
        const intercomBonusDetails = intercomData ? computeIntercomBonus(intercomData) : null;

        // Build feature details map
        let featureDetailsJson: string | null = null;
        if (signals.featureBreadth) {
          const details: Record<string, boolean> = {};
          for (const fe of config.amplitudeFeatureEvents) {
            details[fe.category] = signals.featureBreadth.used.includes(fe.category);
          }
          featureDetailsJson = JSON.stringify(details);
        }

        // Calculate score delta vs yesterday
        const yesterdayScore = yesterdayScores.get(company.accountId);
        let scoreDelta: number | null = null;
        if (
          yesterdayScore !== undefined &&
          yesterdayScore.score !== null &&
          adjusted.score !== null
        ) {
          scoreDelta = adjusted.score - yesterdayScore.score;
        }

        await scoreStore.upsertScore({
          accountId: company.accountId,
          date: todayISO,
          score: adjusted.score,
          tier: adjusted.tier,
          dauWauTrend: signals.dauWauTrend,
          monthlyActiveUsers: adjusted.monthlyActiveUsers,
          licenseUtilization: adjusted.licenseUtilization,
          featuresUsed: signals.featureBreadth?.used.length ?? null,
          featureDetails: featureDetailsJson,
          scoreDelta,
          computedAt: new Date().toISOString(),
          zendeskPenalty: adjusted.zendeskPenalty,
          zendeskDetails: penaltyDetails ? JSON.stringify(penaltyDetails) : null,
          intercomPenalty: adjusted.intercomPenalty,
          intercomBonus: adjusted.intercomBonus,
          intercomDetails: intercomData ? JSON.stringify({ ...intercomPenaltyDetails, ...intercomBonusDetails, conversationVolume: intercomData.conversationVolume, quickResolutions: intercomData.quickResolutions, aiHandled: intercomData.aiHandled }) : null,
          aliasStatus: 'valid',
        });

        scored++;
      } catch (err: any) {
        const msg = `Failed to score ${company.accountId} (${company.accountName}): ${err.message}`;
        log(msg);
        errors.push(msg);
        failed++;

        // Still write a null score so the account is represented
        await scoreStore.upsertScore({
          accountId: company.accountId,
          date: todayISO,
          score: null,
          tier: 'unmapped',
          dauWauTrend: null,
          monthlyActiveUsers: null,
          licenseUtilization: null,
          featuresUsed: null,
          featureDetails: null,
          scoreDelta: null,
          computedAt: new Date().toISOString(),
          zendeskPenalty: null,
          zendeskDetails: null,
          intercomPenalty: null, intercomBonus: null, intercomDetails: null,
          aliasStatus: 'valid',
        });
      }
    }

    if (skipped > 0) log(`Skipped ${skipped} accounts with existing valid scores`);
    return { synced: companies.length, scored, failed, zendeskFetched, intercomFetched, errors };
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    return { synced: 0, scored: 0, failed: 0, zendeskFetched: 0, intercomFetched: 0, errors: [msg] };
  }
}

app.timer('NightlySync', {
  schedule: '0 0 2 * * *',  // 2 AM UTC daily
  handler: async (myTimer: Timer, context: InvocationContext) => {
    const result = await runSync(context);
    context.log('Nightly sync complete:', result);
  },
});
