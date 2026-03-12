import { ScoreStore } from '../../services/scoreStore';

const mockListEntities = jest.fn();
const mockCreateTable = jest.fn().mockResolvedValue(undefined);

jest.mock('@azure/data-tables', () => ({
  TableClient: {
    fromConnectionString: jest.fn(() => ({
      createTable: mockCreateTable,
      listEntities: mockListEntities,
    })),
  },
  odata: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce((acc, s, i) => acc + s + (values[i] ?? ''), '')
  ),
}));

const SCORE_ENTITY = {
  partitionKey: 'hs-123',
  rowKey: '2026-03-11',
  score: 72,
  tier: 'watch',
  dauWauTrend: -0.05,
  featureAdoption: 0.6,
  lastLoginDays: 3,
  scoreDelta: -5,
  computedAt: '2026-03-11T02:00:00.000Z',
};

describe('ScoreStore', () => {
  let store: ScoreStore;

  beforeEach(() => {
    mockListEntities.mockReset();
    mockCreateTable.mockReset();
    mockCreateTable.mockResolvedValue(undefined);
    store = new ScoreStore('UseDevelopmentStorage=true', 'churnscores');
  });

  it('getLatestScoreForAccount returns most recent score within 90 days', async () => {
    mockListEntities.mockReturnValue((async function* () {
      yield SCORE_ENTITY;
    })());

    const result = await store.getLatestScoreForAccount('hs-123');
    expect(result?.score).toBe(72);
    expect(result?.tier).toBe('watch');
    expect(result?.hubspotId).toBe('hs-123');
  });

  it('getLatestScoreForAccount returns null when no rows found', async () => {
    mockListEntities.mockReturnValue((async function* () {})());
    const result = await store.getLatestScoreForAccount('hs-999');
    expect(result).toBeNull();
  });

  it('getScoreHistory returns rows sorted by date ascending', async () => {
    const older = { ...SCORE_ENTITY, rowKey: '2026-03-09', score: 80 };
    const newer = { ...SCORE_ENTITY, rowKey: '2026-03-11', score: 72 };
    mockListEntities.mockReturnValue((async function* () {
      yield newer;
      yield older;
    })());

    const result = await store.getScoreHistory('hs-123', 7);
    expect(result[0].date).toBe('2026-03-09');
    expect(result[1].date).toBe('2026-03-11');
  });

  it('getAllScoresForDate returns map of hubspotId to score', async () => {
    const entity1 = { ...SCORE_ENTITY, partitionKey: 'hs-123', score: 72 };
    const entity2 = { ...SCORE_ENTITY, partitionKey: 'hs-456', score: 45 };
    mockListEntities.mockReturnValue((async function* () {
      yield entity1;
      yield entity2;
    })());

    const result = await store.getAllScoresForDate('2026-03-11');
    expect(result.get('hs-123')?.score).toBe(72);
    expect(result.get('hs-456')?.score).toBe(45);
  });
});