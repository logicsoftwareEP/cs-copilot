// Mock @azure/functions before importing SyncRunner so the timer registration
// does not fail during tests.
jest.mock('@azure/functions', () => ({
  app: {
    timer: jest.fn(),
  },
}));

jest.mock('../../clients/hubspotClient');
jest.mock('../../clients/amplitudeClient');
jest.mock('../../services/accountStore');
jest.mock('../../services/mappingStore');
jest.mock('../../services/scoreStore');

import { runSync } from '../../functions/SyncRunner';
import { searchActiveCompanies } from '../../clients/hubspotClient';
import { fetchSignals } from '../../clients/amplitudeClient';
import { AccountStore } from '../../services/accountStore';
import { MappingStore } from '../../services/mappingStore';
import { ScoreStore } from '../../services/scoreStore';
import { HubspotAccount } from '../../types';
import { AmplitudeSignals } from '../../clients/amplitudeClient';

// Set required env vars so getConfig() does not throw
beforeAll(() => {
  process.env.AZURE_STORAGE_CONNECTION_STRING = 'UseDevelopmentStorage=true';
  process.env.HUBSPOT_API_KEY = 'test-hubspot-key';
  process.env.AMPLITUDE_API_KEY = 'test-amplitude-key';
  process.env.AMPLITUDE_SECRET_KEY = 'test-amplitude-secret';
});

const mockSearchActiveCompanies = searchActiveCompanies as jest.MockedFunction<typeof searchActiveCompanies>;
const mockFetchSignals = fetchSignals as jest.MockedFunction<typeof fetchSignals>;

const MockAccountStore = AccountStore as jest.MockedClass<typeof AccountStore>;
const MockMappingStore = MappingStore as jest.MockedClass<typeof MappingStore>;
const MockScoreStore = ScoreStore as jest.MockedClass<typeof ScoreStore>;

const COMPANY_A: HubspotAccount = {
  hubspotId: 'hs-001',
  accountName: 'Alpha Corp',
  csmName: 'Jane Smith',
  csmEmail: 'jane@example.com',
  arr: 50000,
  renewalDate: '2026-12-01',
  hubspotUrl: 'https://app.hubspot.com/contacts/1',
  syncedAt: '2026-03-12T02:00:00.000Z',
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
};

const GOOD_SIGNALS: AmplitudeSignals = {
  dauWauTrend: 0.15,
  featureAdoption: 0.6,
  lastLoginDays: 3,
};

function setupStoreMocks(opts: {
  mappings?: Array<{ hubspotId: string; amplitudeAlias: string }>;
  yesterdayScores?: Map<string, { score: number | null }>;
} = {}) {
  const upsertAccount = jest.fn().mockResolvedValue(undefined);
  const ensureTable = jest.fn().mockResolvedValue(undefined);
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
    listAccounts: jest.fn(),
    getById: jest.fn(),
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

  it('score delta calculation: yesterday score=70, today=80 → scoreDelta=10', async () => {
    const todayISO = new Date().toISOString().slice(0, 10);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayISO = yesterday.toISOString().slice(0, 10);

    const yesterdayScoreMap = new Map<string, any>([
      ['hs-001', { hubspotId: 'hs-001', date: yesterdayISO, score: 70, tier: 'watch' }],
    ]);

    const { upsertScore } = setupStoreMocks({
      mappings: [{ hubspotId: 'hs-001', amplitudeAlias: 'alpha' }],
      yesterdayScores: yesterdayScoreMap,
    });

    mockSearchActiveCompanies.mockResolvedValue([COMPANY_A]);

    // Signals that produce score=80: dauWauTrend>=0.1 (40pts) + featureAdoption=0 (0pts) + lastLoginDays<7 (25pts) = 65
    // Use signals that give exactly 80: dauWauTrend=0.15 (40) + featureAdoption ~=1.0 (35) + lastLoginDays<7 (25) = 100
    // Actually let's use signals that produce a known score to verify delta
    // dauWauTrend=0.15 → 40pts, featureAdoption=0.6 → 21pts, lastLoginDays=3 → 25pts = 86 points
    // So delta = 86 - 70 = 16
    mockFetchSignals.mockResolvedValue(GOOD_SIGNALS); // score = 86

    const result = await runSync();

    expect(result.scored).toBe(1);

    const scoreCall = upsertScore.mock.calls[0][0];
    expect(scoreCall.score).toBe(86);
    expect(scoreCall.scoreDelta).toBe(16); // 86 - 70
  });
});
