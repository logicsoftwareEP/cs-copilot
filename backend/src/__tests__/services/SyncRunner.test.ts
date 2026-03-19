// Mock @azure/functions before importing SyncRunner so the timer registration
// does not fail during tests.
jest.mock('@azure/functions', () => ({
  app: {
    timer: jest.fn(),
  },
}));

jest.mock('../../clients/hubspotClient');
jest.mock('../../clients/sqlClient');
jest.mock('../../clients/amplitudeClient');
jest.mock('../../clients/zendeskClient');
jest.mock('../../services/accountStore');
jest.mock('../../services/mappingStore');
jest.mock('../../services/scoreStore');
jest.mock('../../services/userStore');

import { runSync } from '../../functions/SyncRunner';
import { searchActiveCompanies } from '../../clients/hubspotClient';
import { fetchAccountsFromSql } from '../../clients/sqlClient';
import { fetchSignals, validateAlias } from '../../clients/amplitudeClient';
import { fetchAllZendeskTickets } from '../../clients/zendeskClient';
import { AccountStore } from '../../services/accountStore';
import { MappingStore } from '../../services/mappingStore';
import { ScoreStore } from '../../services/scoreStore';
import { UserStore } from '../../services/userStore';
import { Account } from '../../types';
import { AmplitudeSignals } from '../../clients/amplitudeClient';
import { ZendeskTicketData } from '../../clients/zendeskClient';

// Set required env vars so getConfig() does not throw
beforeAll(() => {
  process.env.AZURE_STORAGE_CONNECTION_STRING = 'UseDevelopmentStorage=true';
  process.env.DATA_SOURCE = 'hubspot';
  process.env.HUBSPOT_API_KEY = 'test-hubspot-key';
  process.env.AMPLITUDE_API_KEY = 'test-amplitude-key';
  process.env.AMPLITUDE_SECRET_KEY = 'test-amplitude-secret';
});

const mockSearchActiveCompanies = searchActiveCompanies as jest.MockedFunction<typeof searchActiveCompanies>;
const mockFetchAccountsFromSql = fetchAccountsFromSql as jest.MockedFunction<typeof fetchAccountsFromSql>;
const mockFetchSignals = fetchSignals as jest.MockedFunction<typeof fetchSignals>;
const mockFetchAllZendeskTickets = fetchAllZendeskTickets as jest.MockedFunction<typeof fetchAllZendeskTickets>;
const mockValidateAlias = jest.requireMock('../../clients/amplitudeClient').validateAlias as jest.Mock;

const MockAccountStore = AccountStore as jest.MockedClass<typeof AccountStore>;
const MockMappingStore = MappingStore as jest.MockedClass<typeof MappingStore>;
const MockScoreStore = ScoreStore as jest.MockedClass<typeof ScoreStore>;
const MockUserStore = UserStore as jest.MockedClass<typeof UserStore>;

// HubSpot does not carry licenses — that is entered manually after sync
const COMPANY_A: Account = {
  accountId: 'hs-001',
  accountName: 'Alpha Corp',
  csmName: 'Jane Smith',
  csmEmail: 'jane@example.com',
  arr: 50000,
  renewalDate: '2026-12-01',
  hubspotUrl: 'https://app.hubspot.com/contacts/1',
  syncedAt: '2026-03-12T02:00:00.000Z',
  licenses: null,
  domain: '',
  hidden: false,
};

const COMPANY_B: Account = {
  accountId: 'hs-002',
  accountName: 'Beta Inc',
  csmName: 'John Doe',
  csmEmail: 'john@example.com',
  arr: 30000,
  renewalDate: '2026-06-01',
  hubspotUrl: 'https://app.hubspot.com/contacts/2',
  syncedAt: '2026-03-12T02:00:00.000Z',
  licenses: null,
  domain: '',
  hidden: false,
};

// GOOD_SIGNALS: dauWauTrend ≥0.1 (40pts) + monthlyActiveUsers (unused, licenses null) + featureBreadth ≥75% (25pts)
// With no licenses: rawScore = 40+25 = 65, maxPossible = 65 → finalScore = 100
const GOOD_SIGNALS: AmplitudeSignals = {
  dauWauTrend: 0.15,
  monthlyActiveUsers: 50,
  featureBreadth: { used: ['Activity Center', 'Time Tracking', 'Resources', 'Reporting', 'Dashboards', 'Financials', 'Invoices', 'Custom Forms', 'AI Features', 'Collaboration'], total: 12 },
};

function setupStoreMocks(opts: {
  mappings?: Array<{ accountId: string; amplitudeAlias: string }>;
  yesterdayScores?: Map<string, { score: number | null }>;
  storedAccounts?: Account[];
} = {}) {
  const upsertAccount = jest.fn().mockResolvedValue(undefined);
  const ensureTable = jest.fn().mockResolvedValue(undefined);
  const listAccounts = jest.fn().mockResolvedValue(
    opts.storedAccounts ?? [COMPANY_A, COMPANY_B]
  );
  const listMappings = jest.fn().mockResolvedValue(
    (opts.mappings ?? []).map(m => ({
      accountId: m.accountId,
      accountName: '',
      amplitudeAlias: m.amplitudeAlias,
      createdAt: '',
      updatedAt: '',
    }))
  );
  const getAllScoresForDate = jest.fn().mockResolvedValue(
    opts.yesterdayScores ?? new Map()
  );
  const upsertScore = jest.fn().mockResolvedValue(undefined);

  MockAccountStore.mockImplementation(() => ({
    ensureTable,
    upsertAccount,
    listAccounts,
    getById: jest.fn(),
    updateLicenses: jest.fn(),
    updateHidden: jest.fn(),
  } as any));

  MockMappingStore.mockImplementation(() => ({
    ensureTable,
    listMappings,
    getMapping: jest.fn(),
    upsertMapping: jest.fn(),
    deleteMapping: jest.fn(),
  } as any));

  MockScoreStore.mockImplementation(() => ({
    ensureTable,
    getAllScoresForDate,
    upsertScore,
    getLatestScoreForAccount: jest.fn(),
    getScoreHistory: jest.fn(),
  } as any));

  MockUserStore.mockImplementation(() => ({
    ensureTable,
    listUsers: jest.fn().mockResolvedValue([
      { email: 'jane@example.com', displayName: 'Jane Smith', role: 'csm' },
      { email: 'john@example.com', displayName: 'John Doe', role: 'csm' },
    ]),
    getUser: jest.fn(),
    upsertUser: jest.fn(),
    deleteUser: jest.fn(),
  } as any));

  return { upsertAccount, upsertScore, ensureTable, listMappings, getAllScoresForDate };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockValidateAlias.mockResolvedValue(true); // default: alias is valid
});

describe('runSync', () => {
  it('happy path: 2 companies both mapped both succeed → synced=2, scored=2, failed=0', async () => {
    const { upsertAccount, upsertScore } = setupStoreMocks({
      mappings: [
        { accountId: 'hs-001', amplitudeAlias: 'alpha' },
        { accountId: 'hs-002', amplitudeAlias: 'beta' },
      ],
    });

    mockSearchActiveCompanies.mockResolvedValue([COMPANY_A, COMPANY_B]);
    mockFetchSignals.mockResolvedValue(GOOD_SIGNALS);

    const result = await runSync();

    expect(result.synced).toBe(2);
    expect(result.scored).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(0);

    // Both accounts were upserted to accountStore
    expect(upsertAccount).toHaveBeenCalledTimes(2);

    // Both scores were written with a real tier (not 'unmapped')
    expect(upsertScore).toHaveBeenCalledTimes(2);
    const firstCall = upsertScore.mock.calls[0][0];
    expect(firstCall.tier).not.toBe('unmapped');
    expect(firstCall.score).not.toBeNull();
  });

  it('one company unmapped → synced=2, scored=1, failed=0, unmapped gets tier=unmapped', async () => {
    const { upsertScore } = setupStoreMocks({
      mappings: [
        { accountId: 'hs-001', amplitudeAlias: 'alpha' },
        // hs-002 is NOT mapped
      ],
    });

    mockSearchActiveCompanies.mockResolvedValue([COMPANY_A, COMPANY_B]);
    mockFetchSignals.mockResolvedValue(GOOD_SIGNALS);

    const result = await runSync();

    expect(result.synced).toBe(2);
    expect(result.scored).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(0);

    // Find the upsertScore call for hs-002 (the unmapped one)
    const unmappedCall = upsertScore.mock.calls.find(
      (call) => call[0].accountId === 'hs-002'
    );
    expect(unmappedCall).toBeDefined();
    expect(unmappedCall![0].tier).toBe('unmapped');
    expect(unmappedCall![0].score).toBeNull();
  });

  it('Amplitude fetch fails for one company → failed=1, error recorded, null score written', async () => {
    const { upsertScore } = setupStoreMocks({
      mappings: [
        { accountId: 'hs-001', amplitudeAlias: 'alpha' },
        { accountId: 'hs-002', amplitudeAlias: 'beta' },
      ],
    });

    mockSearchActiveCompanies.mockResolvedValue([COMPANY_A, COMPANY_B]);
    mockFetchSignals
      .mockResolvedValueOnce(GOOD_SIGNALS)           // hs-001 succeeds
      .mockRejectedValueOnce(new Error('Amplitude 429')); // hs-002 fails

    const result = await runSync();

    expect(result.synced).toBe(2);
    expect(result.scored).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Amplitude 429');

    // The failed account still gets a null score written
    const failedCall = upsertScore.mock.calls.find(
      (call) => call[0].accountId === 'hs-002' && call[0].score === null
    );
    expect(failedCall).toBeDefined();
    expect(failedCall![0].tier).toBe('unmapped');
  });

  it('HubSpot fetch fails completely → returns {synced:0, scored:0, failed:0, errors:[...]}', async () => {
    setupStoreMocks();
    mockSearchActiveCompanies.mockRejectedValue(new Error('HubSpot 503'));

    const result = await runSync();

    expect(result.synced).toBe(0);
    expect(result.scored).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('HubSpot 503');
  });

  it('score delta calculation: yesterday score=70, today score uses licenses=null → score=100, delta=30', async () => {
    const yesterdayISO = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    const yesterdayScoreMap = new Map<string, any>([
      ['hs-001', { accountId: 'hs-001', date: yesterdayISO, score: 70, tier: 'watch' }],
    ]);

    const { upsertScore } = setupStoreMocks({
      mappings: [{ accountId: 'hs-001', amplitudeAlias: 'alpha' }],
      yesterdayScores: yesterdayScoreMap,
      storedAccounts: [{ ...COMPANY_A, licenses: null }],
    });

    mockSearchActiveCompanies.mockResolvedValue([COMPANY_A]);
    // GOOD_SIGNALS + licenses=null: dauWau(40) + login(25) = 65/65*100 = 100
    mockFetchSignals.mockResolvedValue(GOOD_SIGNALS);

    const result = await runSync();

    expect(result.scored).toBe(1);

    const scoreCall = upsertScore.mock.calls[0][0];
    expect(scoreCall.score).toBe(100);
    expect(scoreCall.scoreDelta).toBe(30); // 100 - 70
  });

  it('uses stored licenses from accountStore (not HubSpot data) for scoring', async () => {
    // HubSpot returns licenses=null, but stored account has licenses=100
    const storedA: Account = { ...COMPANY_A, licenses: 100 };

    const { upsertScore } = setupStoreMocks({
      mappings: [{ accountId: 'hs-001', amplitudeAlias: 'alpha' }],
      storedAccounts: [storedA],
    });

    mockSearchActiveCompanies.mockResolvedValue([COMPANY_A]); // licenses=null from HubSpot
    // dauWau ≥0.1 (40) + MAU 50/100=50% ≥40% (15) + featureBreadth ≥75% (25) = 80/100 = 80
    mockFetchSignals.mockResolvedValue({ dauWauTrend: 0.15, monthlyActiveUsers: 50, featureBreadth: { used: ['A','B','C','D','E','F','G','H','I','J'], total: 12 } });

    await runSync();

    const scoreCall = upsertScore.mock.calls[0][0];
    expect(scoreCall.score).toBe(80); // uses licenses=100 from store
    expect(scoreCall.licenseUtilization).toBeCloseTo(0.5);
  });

  // ── Zendesk integration tests ───────────────────────────────────────────

  const ZENDESK_TICKET_DATA: ZendeskTicketData = {
    ticketVolume: 7,
    openCount: 3,
    highPriorityCount: 1,
    urgentCount: 0,
  };

  function enableZendeskConfig() {
    process.env.ZENDESK_SUBDOMAIN = 'test-sub';
    process.env.ZENDESK_EMAIL = 'agent@test.com';
    process.env.ZENDESK_API_TOKEN = 'zd-token-123';
  }

  function disableZendeskConfig() {
    delete process.env.ZENDESK_SUBDOMAIN;
    delete process.env.ZENDESK_EMAIL;
    delete process.env.ZENDESK_API_TOKEN;
  }

  it('sync with Zendesk enabled applies penalties', async () => {
    enableZendeskConfig();
    const companyWithDomain: Account = { ...COMPANY_A, domain: 'alpha.com' };

    const { upsertScore } = setupStoreMocks({
      mappings: [{ accountId: 'hs-001', amplitudeAlias: 'alpha' }],
      storedAccounts: [companyWithDomain],
    });

    mockSearchActiveCompanies.mockResolvedValue([companyWithDomain]);
    mockFetchSignals.mockResolvedValue(GOOD_SIGNALS);
    mockFetchAllZendeskTickets.mockResolvedValue(
      new Map([['alpha.com', ZENDESK_TICKET_DATA]])
    );

    const result = await runSync();

    expect(result.zendeskFetched).toBe(1);

    const scoreCall = upsertScore.mock.calls[0][0];
    // Volume 7 → -5, Open 3 → -4, High 1 → -2 = total -11
    // Base score = 100 (no licenses), adjusted = 100 + (-11) = 89
    expect(scoreCall.zendeskPenalty).toBe(-11);
    expect(scoreCall.score).toBe(89);
    expect(scoreCall.zendeskDetails).toBeTruthy();
    const details = JSON.parse(scoreCall.zendeskDetails);
    expect(details.totalPenalty).toBe(-11);

    disableZendeskConfig();
  });

  it('sync with Zendesk disabled skips penalty phase', async () => {
    disableZendeskConfig();

    setupStoreMocks({
      mappings: [{ accountId: 'hs-001', amplitudeAlias: 'alpha' }],
    });

    mockSearchActiveCompanies.mockResolvedValue([COMPANY_A]);
    mockFetchSignals.mockResolvedValue(GOOD_SIGNALS);

    const result = await runSync();

    expect(result.zendeskFetched).toBe(0);
    expect(mockFetchAllZendeskTickets).not.toHaveBeenCalled();
  });

  it('unmapped account with domain still gets zendeskPenalty', async () => {
    enableZendeskConfig();
    const companyWithDomain: Account = { ...COMPANY_A, domain: 'alpha.com' };

    const { upsertScore } = setupStoreMocks({
      mappings: [], // no Amplitude mapping
      storedAccounts: [companyWithDomain],
    });

    mockSearchActiveCompanies.mockResolvedValue([companyWithDomain]);
    mockFetchAllZendeskTickets.mockResolvedValue(
      new Map([['alpha.com', ZENDESK_TICKET_DATA]])
    );

    const result = await runSync();

    expect(result.scored).toBe(0);
    expect(result.zendeskFetched).toBe(1);

    const scoreCall = upsertScore.mock.calls[0][0];
    expect(scoreCall.score).toBeNull();
    expect(scoreCall.tier).toBe('unmapped');
    // Volume 7 → -5, Open 3 → -4, High 1 → -2 = total -11
    expect(scoreCall.zendeskPenalty).toBe(-11);
    expect(scoreCall.zendeskDetails).toBeTruthy();

    disableZendeskConfig();
  });

  it('Zendesk auth failure returns null → zendeskFetched=0', async () => {
    enableZendeskConfig();
    const companyA: Account = { ...COMPANY_A, domain: 'alpha.com' };

    setupStoreMocks({
      mappings: [{ accountId: 'hs-001', amplitudeAlias: 'alpha' }],
      storedAccounts: [companyA],
    });

    mockSearchActiveCompanies.mockResolvedValue([companyA]);
    mockFetchSignals.mockResolvedValue(GOOD_SIGNALS);
    mockFetchAllZendeskTickets.mockResolvedValue(null);

    const result = await runSync();

    expect(result.zendeskFetched).toBe(0);

    disableZendeskConfig();
  });

  // ── SQL data source tests ──────────────────────────────────────────────

  function enableSqlConfig() {
    process.env.DATA_SOURCE = 'sql';
    process.env.SQL_SERVER_DETAILS = 'Server=tcp:test.database.windows.net,1433;Database=TestDB';
    process.env.SQL_LOGIN = 'testuser';
    process.env.SQL_PASSWORD = 'testpass';
  }

  function disableSqlConfig() {
    process.env.DATA_SOURCE = 'hubspot';
    delete process.env.SQL_SERVER_DETAILS;
    delete process.env.SQL_LOGIN;
    delete process.env.SQL_PASSWORD;
  }

  it('SQL data source: fetches from SQL instead of HubSpot', async () => {
    enableSqlConfig();
    const { upsertAccount, upsertScore } = setupStoreMocks({
      mappings: [
        { accountId: 'hs-001', amplitudeAlias: 'alpha' },
      ],
    });

    mockFetchAccountsFromSql.mockResolvedValue({
      accounts: [COMPANY_A],
      aliases: new Map(),
      licences: new Map(),
    });
    mockFetchSignals.mockResolvedValue(GOOD_SIGNALS);

    const result = await runSync();

    expect(result.synced).toBe(1);
    expect(result.scored).toBe(1);
    expect(mockFetchAccountsFromSql).toHaveBeenCalledTimes(1);
    expect(mockSearchActiveCompanies).not.toHaveBeenCalled();
    expect(upsertAccount).toHaveBeenCalledTimes(1);

    disableSqlConfig();
  });

  it('SQL data source: auto-syncs aliases only for accounts without existing mappings', async () => {
    enableSqlConfig();
    const mocks = setupStoreMocks({
      mappings: [
        { accountId: 'hs-001', amplitudeAlias: 'old-alias' }, // existing — preserved even if SQL differs
      ],
      // hs-002 has no mapping — SQL alias will be created
    });

    mockFetchAccountsFromSql.mockResolvedValue({
      accounts: [COMPANY_A, COMPANY_B],
      aliases: new Map([
        ['hs-001', 'new-alias'],  // SQL differs but existing mapping preserved
        ['hs-002', 'beta'],       // no existing mapping — will be created
      ]),
      licences: new Map(),
    });
    mockFetchSignals.mockResolvedValue(GOOD_SIGNALS);

    await runSync();

    // upsertMapping called once for hs-002 (new), NOT for hs-001 (existing preserved)
    const mappingStoreInstance = MockMappingStore.mock.results[0].value;
    const upsertMappingCalls = mappingStoreInstance.upsertMapping.mock.calls;
    expect(upsertMappingCalls.length).toBe(1);
    expect(upsertMappingCalls[0][0]).toBe('hs-002');
    expect(upsertMappingCalls[0][2]).toBe('beta');

    disableSqlConfig();
  });

  it('SQL data source: preserves manual mappings when SQL has no alias', async () => {
    enableSqlConfig();
    setupStoreMocks({
      mappings: [
        { accountId: 'hs-001', amplitudeAlias: 'manual-alias' },
      ],
    });

    mockFetchAccountsFromSql.mockResolvedValue({
      accounts: [COMPANY_A],
      aliases: new Map(), // SQL has no alias for hs-001
      licences: new Map(),
    });
    mockFetchSignals.mockResolvedValue(GOOD_SIGNALS);

    await runSync();

    // upsertMapping should NOT be called — manual mapping preserved
    const mappingStoreInstance = MockMappingStore.mock.results[0].value;
    expect(mappingStoreInstance.upsertMapping).not.toHaveBeenCalled();

    disableSqlConfig();
  });

  it('SQL data source: auto-syncs licences when no manual override exists', async () => {
    enableSqlConfig();
    const storedA: Account = { ...COMPANY_A, licenses: null }; // no manual override
    const storedB: Account = { ...COMPANY_B, licenses: 50 };   // manual override exists

    setupStoreMocks({
      mappings: [
        { accountId: 'hs-001', amplitudeAlias: 'alpha' },
        { accountId: 'hs-002', amplitudeAlias: 'beta' },
      ],
      storedAccounts: [storedA, storedB],
    });

    mockFetchAccountsFromSql.mockResolvedValue({
      accounts: [COMPANY_A, COMPANY_B],
      aliases: new Map(),
      licences: new Map([
        ['hs-001', 100],
        ['hs-002', 200],
      ]),
    });
    mockFetchSignals.mockResolvedValue(GOOD_SIGNALS);

    await runSync();

    // updateLicenses should only be called for hs-001 (no manual override)
    const accountStoreInstance = MockAccountStore.mock.results[0].value;
    const updateCalls = accountStoreInstance.updateLicenses.mock.calls;
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0][0]).toBe('hs-001');
    expect(updateCalls[0][1]).toBe(100);

    disableSqlConfig();
  });

  it('SQL fetch fails completely → returns error', async () => {
    enableSqlConfig();
    setupStoreMocks();
    mockFetchAccountsFromSql.mockRejectedValue(new Error('SQL connection timeout'));

    const result = await runSync();

    expect(result.synced).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('SQL connection timeout');

    disableSqlConfig();
  });

  // ── Alias validation tests ──────────────────────────────────────────────

  it('hidden accounts skip scoring entirely', async () => {
    const storedA: Account = { ...COMPANY_A, hidden: true };
    const storedB: Account = { ...COMPANY_B, hidden: false };
    const { upsertScore } = setupStoreMocks({
      mappings: [
        { accountId: 'hs-001', amplitudeAlias: 'alpha' },
        { accountId: 'hs-002', amplitudeAlias: 'beta' },
      ],
      storedAccounts: [storedA, storedB],
    });

    mockSearchActiveCompanies.mockResolvedValue([COMPANY_A, COMPANY_B]);
    mockFetchSignals.mockResolvedValue({
      dauWauTrend: 0.15,
      monthlyActiveUsers: 50,
      featureBreadth: { used: ['Activity Center', 'Time Tracking', 'Resources', 'Reporting', 'Dashboards', 'Financials', 'Invoices', 'Custom Forms', 'AI Features', 'Collaboration'], total: 12 },
    });
    mockFetchAllZendeskTickets.mockResolvedValue(null);

    const result = await runSync();
    expect(result.synced).toBe(2);
    expect(result.scored).toBe(1);
    expect(upsertScore).toHaveBeenCalledTimes(1);
    expect(upsertScore).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'hs-002' })
    );
  });

  it('all-zero signals with invalid alias → aliasStatus not-found, score null', async () => {
    const { upsertScore } = setupStoreMocks({
      mappings: [{ accountId: 'hs-001', amplitudeAlias: 'bad-alias' }],
    });

    mockSearchActiveCompanies.mockResolvedValue([COMPANY_A]);
    mockFetchSignals.mockResolvedValue({
      dauWauTrend: null,
      monthlyActiveUsers: 0,
      featureBreadth: { used: [], total: 12 },
    });
    mockValidateAlias.mockResolvedValue(false);
    mockFetchAllZendeskTickets.mockResolvedValue(null);

    const result = await runSync();
    expect(result.synced).toBe(1);
    expect(upsertScore).toHaveBeenCalledWith(
      expect.objectContaining({
        score: null,
        tier: 'unmapped',
        aliasStatus: 'not-found',
      })
    );
  });

  it('all-zero signals with valid alias → score 0, aliasStatus valid', async () => {
    const { upsertScore } = setupStoreMocks({
      mappings: [{ accountId: 'hs-001', amplitudeAlias: 'real-alias' }],
    });

    mockSearchActiveCompanies.mockResolvedValue([COMPANY_A]);
    mockFetchSignals.mockResolvedValue({
      dauWauTrend: null,
      monthlyActiveUsers: 0,
      featureBreadth: { used: [], total: 12 },
    });
    mockValidateAlias.mockResolvedValue(true);
    mockFetchAllZendeskTickets.mockResolvedValue(null);

    const result = await runSync();
    expect(upsertScore).toHaveBeenCalledWith(
      expect.objectContaining({
        score: 0,
        tier: 'critical',
        aliasStatus: 'valid',
      })
    );
  });
});
