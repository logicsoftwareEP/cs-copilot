import sql from 'mssql';
import { Account } from '../types';

export interface SqlFetchResult {
  accounts: Account[];
  /** accountId → Amplitude alias (only entries where SQL provides a non-empty alias) */
  aliases: Map<string, string>;
  /** accountId → licence count (only entries where SQL provides a value) */
  licences: Map<string, number>;
}

// Module-level singleton pool — reused across Azure Functions invocations within the same host
let pool: sql.ConnectionPool | null = null;

const TRANSIENT_CODES = new Set([
  'ETIMEOUT', 'ECONNRESET', 'ECONNREFUSED', 'ESOCKET',
  // Azure SQL transient error numbers
  '40197', '40501', '40613', '49918', '49919', '49920',
]);

function isTransient(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: string }).code ?? '';
  const number = String((err as { number?: number }).number ?? '');
  return TRANSIENT_CODES.has(code) || TRANSIENT_CODES.has(number);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getPool(
  connectionString: string,
  login: string,
  password: string
): Promise<sql.ConnectionPool> {
  if (pool?.connected) return pool;

  // Parse ADO.NET-style connection string (Server=tcp:host,port;Database=db)
  const serverMatch = connectionString.match(/Server\s*=\s*(?:tcp:)?([^,;]+)(?:,(\d+))?/i);
  const dbMatch = connectionString.match(/Database\s*=\s*([^;]+)/i);

  if (!serverMatch) {
    throw new Error(`Cannot parse server from SQL_SERVER_DETAILS: ${connectionString}`);
  }

  const server = serverMatch[1];
  const port = serverMatch[2] ? parseInt(serverMatch[2], 10) : 1433;
  const database = dbMatch?.[1] ?? '';

  pool = await new sql.ConnectionPool({
    server,
    port,
    database,
    user: login,
    password,
    options: {
      encrypt: true,
      trustServerCertificate: false,
      connectTimeout: 15000,
      requestTimeout: 30000,
    },
    pool: {
      max: 5,
      min: 0,
      idleTimeoutMillis: 30000,
    },
  }).connect();

  return pool;
}

async function queryWithRetry<T>(
  p: sql.ConnectionPool,
  queryStr: string,
  retries = 3
): Promise<sql.IResult<T>> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await p.request().query<T>(queryStr);
    } catch (err) {
      if (attempt === retries || !isTransient(err)) throw err;
      await sleep(1000 * Math.pow(2, attempt - 1)); // 1s, 2s, 4s
    }
  }
  throw new Error('queryWithRetry: unreachable');
}

interface ClientsOverviewRow {
  ClientId: string | null;
  HubSpotCompanyId: number | null;
  Company: string | null;
  Alias: string | null;
  HubspotSuccessManager: string | null;
  ACV: number | null;
  ContractRenewalDate: Date | null;
  Licenses: number | null;
  Email: string | null;
  BillingEmail: string | null;
  IsCanceled: boolean;
}

function extractDomain(email: string | null): string {
  if (!email) return '';
  const at = email.lastIndexOf('@');
  return at > 0 ? email.substring(at + 1).toLowerCase() : '';
}

/**
 * Fetch active accounts from SQL Server [analytics].[ClientsOverview].
 * Returns Account[] (compatible with existing Table Storage schema) plus
 * alias and licence maps for auto-sync.
 */
export async function fetchAccountsFromSql(
  connectionString: string,
  login: string,
  password: string,
  hubspotPortalId = ''
): Promise<SqlFetchResult> {
  const p = await getPool(connectionString, login, password);

  const result = await queryWithRetry<ClientsOverviewRow>(
    p,
    `SELECT ClientId, HubSpotCompanyId, Company, Alias, HubspotSuccessManager,
            ACV, ContractRenewalDate, Licenses, Email, BillingEmail, IsCanceled
     FROM [analytics].[ClientsOverview]
     WHERE IsCanceled = 0`
  );

  const accounts: Account[] = [];
  const aliases = new Map<string, string>();
  const licences = new Map<string, number>();

  for (const row of result.recordset) {
    if (!row.ClientId) continue; // skip rows without ClientId

    const accountId = row.ClientId.toLowerCase();
    const hubspotCompanyId = row.HubSpotCompanyId ? String(row.HubSpotCompanyId) : '';
    const domain = extractDomain(row.Email) || extractDomain(row.BillingEmail);
    const renewalDate = row.ContractRenewalDate
      ? row.ContractRenewalDate.toISOString().split('T')[0]
      : '';

    accounts.push({
      accountId,
      hubspotCompanyId,
      accountName: row.Company ?? '',
      csmName: row.HubspotSuccessManager ?? '',
      csmEmail: '', // SQL view has CSM name only, no email
      arr: row.ACV ?? 0,
      renewalDate,
      hubspotUrl: hubspotPortalId && hubspotCompanyId
        ? `https://app.hubspot.com/contacts/${hubspotPortalId}/company/${hubspotCompanyId}`
        : '',
      syncedAt: new Date().toISOString(),
      licenses: null, // handled separately via licences map
      domain,
      hidden: false,
    });

    if (row.Alias) {
      aliases.set(accountId, row.Alias);
    }

    if (row.Licenses != null && row.Licenses > 0) {
      licences.set(accountId, row.Licenses);
    }
  }

  return { accounts, aliases, licences };
}
