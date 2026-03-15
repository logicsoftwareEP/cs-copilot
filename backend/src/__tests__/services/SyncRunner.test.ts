// Mock @azure/functions before importing SyncRunner so the timer registration
// does not fail during tests.
jest.mock('@azure/functions', () => ({
  app: {
    timer: jest.fn(),
  },
}));

jest.mock('../../clients/hubspotClient');
jest.mock('../../clients/amplitudeClient');
jest.mock('../../clients/zendeskClient');
jest.mock('../../services/accountStore');
jest.mock('../../services/mappingStore');
jest.mock('../../services/scoreStore');

import { runSync } from '../../functions/SyncRunner';
import { searchActiveCompanies } from '../../clients/hubspotClient';
import { fetchSignals } from '../../clients/amplitudeClient';
import { fetchZendeskTickets } from '../../clients/zendeskClient';
import { AccountStore } from '../../services/accountStore';
import { MappingStore } from '../../services/mappingStore';
import { ScoreStore } from '../../services/scoreStore';
import { HubspotAccount } from '../../types';
import { AmplitudeSignals } from '../../clients/amplitudeClient';
import { ZendeskTicketData } from '../../clients/zendeskClient';

// Set required env vars so getConfig() does not throw
beforeAll(() => {
  process.env.AZURE_STORAGE_CONNECTION_STRING = 'UseDevelopmentStorage=true';
  process.env.HUBSPOT_API_KEY = 'test-hubspot-key';
  process.env.AMPLITUDE_API_KEY = 'test-amplitude-key';
  process.env.AMPLITUDE_SECRET_KEY = 'test-amplitude-secret';
});

const mockSearchActiveCompanies = searchActiveCompanies as jest.MockedFunction<typeof searchActiveCompanies>;
const mockFetchSignals = fetchSignals as jest.MockedFunction<typeof fetchSignals>;
const mockFetchZendeskTickets = fetchZendeskTickets as jest.MockedFunction<typeof fetchZendeskTickets>;

const MockAccountStore = AccountStore as jest.MockedClass<typeof AccountStore>;
const MockMappingStore = MappingStore as jest.MockedClass<typeof MappingStore>;
const MockScoreStore = ScoreStore as jest.MockedClass<typeof ScoreStore>;

// HubSpot does not carry licenses — that is entered manually after sync
const COMPANY_A: HubspotAccount = {
  hubspotId: 'hs-001',
  accountName: 'Alpha Corp',
  csmName: 'Jane Smith',
  csmEmail: 'jane@example.com',
  arr: 50000,
  renewalDate: '2026-12-01',
  hubspotUrl: 'https://app.hubspot.com/contacts/1',
  syncedAt: '2026-03-12T02:00:00.000Z',
  licenses: null,
  domain: '',
};

const COMPANY_B: HubspotAccount = {
  hubspotId: 'hs-002',
  accountName: 'Beta Inc',
  csmName: 'John Doe',
  csmEmail: 'john@example.com',
  arr: 30000,
  renewalDate: '2026-06-01',
  hubspotUrl: 'https://app.hubspot.com/contacts/2',
  syncedAt: '2026-03-12T02:00:00.000Z',
  licenses: null,
  domain: '',
};

// GOOD_SIGNALS: dauWauTrend ≥0.1 (40pts) + monthlyActiveUsers (unused, licenses null) + lastLoginDays <7 (25pts)
// With no licenses: rawScore = 40+25 = 65, maxPossible = 65 → finalScore = 100
const GOOD_SIGNALS: AmplitudeSignals = {
  dauWauTrend: 0.15,
  monthlyActiveUsers: 50,
  lastLoginDays: 3,
};

function setupStoreMocks(opts: {
  mappings?: Array<{ hubspotId: string; amplitudeAlias: string }>;
  yesterdayScores?: Map<string, { score: number | null }>;
  storedAccounts?: HubspotAccount[];
} = {}) {
  const upsertAccount = jest.fn().mockResolvedValue(undefined);
  const ensureTable = jest.fn().mockResolvedValue(undefined);
  const listAccounts = jest.fn().mockResolvedValue(
    opts.storedAccounts ?? [COMPANY_A, COMPANY_B]
  );
  const listMappings = jest.fn().mockResolvedValue(
    (opts.mappings ?? []).map(m => ({
      hubspotId: m.hubspotId,
      hubspotName: '',
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

  return { upsertAccount, upsertScore, ensureTable, listMappings, getAllScoresForDate };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('runSync', () => {
  it('happy path: 2 companies both mapped both succeed → synced=2, scored=2, failed=0', async () => {
    const { upsertAccount, upsertScore } = setupStoreMocks({
      mappings: [
        { hubspotId: 'hs-001', amplitudeAlias: 'alpha' },
        { hubspotId: 'hs-002', amplitudeAlias: 'beta' },
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
        { hubspotId: 'hs-001', amplitudeAlias: 'alpha' },
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
      (call) => call[0].hubspotId === 'hs-002'
    );
    expect(unmappedCall).toBeDefined();
    expect(unmappedCall![0].tier).toBe('unmapped');
    expect(unmappedCall![0].score).toBeNull();
  });

  it('Amplitude fetch fails for one company → failed=1, error recorded, null score written', async () => {
    const { upsertScore } = setupStoreMocks({
      mappings: [
        { hubspotId: 'hs-001', amplitudeAlias: 'alpha' },
        { hubspotId: 'hs-002', amplitudeAlias: 'beta' },
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
      (call) => call[0].hubspotId === 'hs-002' && call[0].score === null
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
      ['hs-001', { hubspotId: 'hs-001', date: yesterdayISO, score: 70, tier: 'watch' }],
    ]);

    const { upsertScore } = setupStoreMocks({
      mappings: [{ hubspotId: 'hs-001', amplitudeAlias: 'alpha' }],
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
    const storedA: HubspotAccount = { ...COMPANY_A, licenses: 100 };

    const { upsertScore } = setupStoreMocks({
      mappings: [{ hubspotId: 'hs-001', amplitudeAlias: 'alpha' }],
      storedAccounts: [storedA],
    });

    mockSearchActiveCompanies.mockResolvedValue([COMPANY_A]); // licenses=null from HubSpot
    // dauWau ≥0.1 (40) + MAU 50/100=50% ≥40% (15) + login <7 (25) = 80/100 = 80
    mockFetchSignals.mockResolvedValue({ dauWauTrend: 0.15, monthlyActiveUsers: 50, lastLoginDays: 3 });

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
    const companyWithDomain: HubspotAccount = { ...COMPANY_A, domain: 'alpha.com' };

    const { upsertScore } = setupStoreMocks({
      mappings: [{ hubspotId: 'hs-001', amplitudeAlias: 'alpha' }],
      storedAccounts: [companyWithDomain],
    });

    mockSearchActiveCompanies.mockResolvedValue([companyWithDomain]);
    mockFetchSignals.mockResolvedValue(GOOD_SIGNALS);
    mockFetchZendeskTickets.mockResolvedValue(ZENDESK_TICKET_DATA);

    const result = await runSync();

    expect(result.zendeskFetched).toBe(1);
    expect(mockFetchZendeskTickets).toHaveBeenCalledWith('test-sub', 'agent@test.com', 'zd-token-123', 'alpha.com');

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
      mappings: [{ hubspotId: 'hs-001', amplitudeAlias: 'alpha' }],
    });

    mockSearchActiveCompanies.mockResolvedValue([COMPANY_A]);
    mockFetchSignals.mockResolvedValue(GOOD_SIGNALS);

    const result = await runSync();

    expect(result.zendeskFetched).toBe(0);
    expect(mockFetchZendeskTickets).not.toHaveBeenCalled();
  });

  it('unmapped account with domain still gets zendeskPenalty', async () => {
    enableZendeskConfig();
    const companyWithDomain: HubspotAccount = { ...COMPANY_A, domain: 'alpha.com' };

    const { upsertScore } = setupStoreMocks({
      mappings: [], // no Amplitude mapping
      storedAccounts: [companyWithDomain],
    });

    mockSearchActiveCompanies.mockResolvedValue([companyWithDomain]);
    mockFetchZendeskTickets.mockResolvedValue(ZENDESK_TICKET_DATA);

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

  it('Zendesk auth failure (401) on first domain skips remaining domains', async () => {
    enableZendeskConfig();
    const companyA: HubspotAccount = { ...COMPANY_A, domain: 'alpha.com' };
    const companyB: HubspotAccount = { ...COMPANY_B, domain: 'beta.com' };

    setupStoreMocks({
      mappings: [
        { hubspotId: 'hs-001', amplitudeAlias: 'alpha' },
        { hubspotId: 'hs-002', amplitudeAlias: 'beta' },
      ],
      storedAccounts: [companyA, companyB],
    });

    mockSearchActiveCompanies.mockResolvedValue([companyA, companyB]);
    mockFetchSignals.mockResolvedValue(GOOD_SIGNALS);
    // First call returns null (auth failure) — remaining should be skipped
    mockFetchZendeskTickets.mockResolvedValueOnce(null);

    const result = await runSync();

    expect(mockFetchZendeskTickets).toHaveBeenCalledTimes(1);
    expect(result.zendeskFetched).toBe(0);

    disableZendeskConfig();
  });
});
