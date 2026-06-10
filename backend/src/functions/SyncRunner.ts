import { app, Timer, InvocationContext } from '@azure/functions';
import { getConfig } from '../config';
import { AccountStore } from '../services/accountStore';
import { MappingStore } from '../services/mappingStore';
import { ScoreStore } from '../services/scoreStore';
import { UserStore } from '../services/userStore';
import { searchActiveCompanies } from '../clients/hubspotClient';
import { fetchAccountsFromSql, SqlFetchResult, exportScoresToSql, ScoreExportRow } from '../clients/sqlClient';
import { fetchSignals, validateAlias, AmplitudeSignals } from '../clients/amplitudeClient';
import { Account } from '../types';
import { fetchAllZendeskTickets, ZendeskTicketData } from '../clients/zendeskClient';
import { fetchIntercomConversations } from '../clients/intercomClient';
import { IntercomStore, IntercomAggregated } from '../services/intercomStore';
import { buildScoreRow } from '../services/healthScoreService';

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
  scoresExported: number; // rows written to SQL [analytics].[AccountHealthScores]
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
        config.sqlConnectionString, config.sqlLogin, config.sqlPassword, config.hubspotPortalId
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

      const yesterdayScore = yesterdayScores.get(company.accountId);
      const previousScore = yesterdayScore?.score ?? null;
      const intercomData = accountDomain ? (intercomDomainMap.get(accountDomain) ?? null) : null;
      const licenses = storedMap.get(company.accountId)?.licenses ?? null;

      if (!amplitudeAlias) {
        // No Amplitude mapping — upsert a placeholder score
        await scoreStore.upsertScore(buildScoreRow({
          accountId: company.accountId, date: todayISO,
          signals: null, licenses, featureEvents: config.amplitudeFeatureEvents,
          zendeskData, intercomData, previousScore, aliasStatus: null,
        }));
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
            await scoreStore.upsertScore(buildScoreRow({
              accountId: company.accountId, date: todayISO,
              signals: null, licenses, featureEvents: config.amplitudeFeatureEvents,
              zendeskData, intercomData, previousScore, aliasStatus: 'not-found',
            }));
            log(`Alias not found in Amplitude: ${amplitudeAlias} (${company.accountName})`);
            continue;
          }
        }

        await scoreStore.upsertScore(buildScoreRow({
          accountId: company.accountId, date: todayISO,
          signals, licenses, featureEvents: config.amplitudeFeatureEvents,
          zendeskData, intercomData, previousScore, aliasStatus: 'valid',
        }));

        scored++;
      } catch (err: any) {
        const msg = `Failed to score ${company.accountId} (${company.accountName}): ${err.message}`;
        log(msg);
        errors.push(msg);
        failed++;

        // Still write a null score so the account is represented
        await scoreStore.upsertScore(buildScoreRow({
          accountId: company.accountId, date: todayISO,
          signals: null, licenses, featureEvents: config.amplitudeFeatureEvents,
          zendeskData, intercomData, previousScore: null, aliasStatus: 'valid',
        }));
      }
    }

    if (skipped > 0) log(`Skipped ${skipped} accounts with existing valid scores`);

    // ── Export latest scores to SQL for PowerBI ──────────────────────────
    // Today's churnscores rows are the complete current snapshot: accounts
    // skipped during scoring already have today's row; hidden accounts have
    // none. Failure is non-fatal — Table Storage stays the source of truth.
    let scoresExported = 0;
    if (config.dataSource === 'sql' && config.sqlConnectionString && config.sqlLogin && config.sqlPassword) {
      try {
        const finalScores = await scoreStore.getAllScoresForDate(todayISO);
        const exportRows: ScoreExportRow[] = [...finalScores.values()].map(s => ({
          clientId: s.accountId,
          score: s.score,
          tier: s.tier,
          scoreDate: s.date,
        }));
        scoresExported = await exportScoresToSql(
          config.sqlConnectionString, config.sqlLogin, config.sqlPassword, exportRows
        );
        log(`Exported ${scoresExported} scores to [analytics].[AccountHealthScores] for PowerBI`);
      } catch (err: any) {
        const msg = `SQL score export failed (non-fatal): ${err?.message ?? err}`;
        log(msg);
        errors.push(msg);
      }
    }

    return { synced: companies.length, scored, failed, zendeskFetched, intercomFetched, scoresExported, errors };
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    return { synced: 0, scored: 0, failed: 0, zendeskFetched: 0, intercomFetched: 0, scoresExported: 0, errors: [msg] };
  }
}

app.timer('NightlySync', {
  schedule: '0 0 2 * * *',  // 2 AM UTC daily
  handler: async (myTimer: Timer, context: InvocationContext) => {
    const result = await runSync(context);
    context.log('Nightly sync complete:', result);
  },
});
