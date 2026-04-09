import { IntercomStore } from '../../services/intercomStore';
import { IntercomDailySnapshot } from '../../clients/intercomClient';

// Mock TableClient
const mockListEntities = jest.fn();
jest.mock('@azure/data-tables', () => ({
  TableClient: {
    fromConnectionString: () => ({
      createTable: jest.fn().mockResolvedValue(undefined),
      listEntities: mockListEntities,
    }),
  },
  odata: (strings: TemplateStringsArray, ...values: any[]) =>
    strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), ''),
}));

function makeSnapshot(domain: string, date: string, overrides: Partial<IntercomDailySnapshot> = {}): any {
  return {
    partitionKey: domain,
    rowKey: date,
    conversationVolume: 3,
    openCount: 1,
    avgResponseTime: 3600,
    quickResolutions: 1,
    aiHandled: 0,
    totalResponseTime: 7200,
    responseCount: 2,
    cxScoreTotal: 8,
    cxScoreCount: 2,
    ...overrides,
  };
}

describe('IntercomStore.getAllSnapshots', () => {
  beforeEach(() => {
    mockListEntities.mockReset();
  });

  it('returns snapshots from all domains, grouped by partitionKey, sorted newest-first', async () => {
    const entities = [
      makeSnapshot('acme.com', '2026-04-07'),
      makeSnapshot('acme.com', '2026-04-08'),
      makeSnapshot('beta.io', '2026-04-08'),
    ];

    mockListEntities.mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        for (const e of entities) yield e;
      },
    });

    const store = new IntercomStore('fake-conn');
    const result = await store.getAllSnapshots(30);

    // Should have been called with a filter on RowKey only (no PartitionKey)
    expect(mockListEntities).toHaveBeenCalledWith(
      expect.objectContaining({
        queryOptions: expect.objectContaining({
          filter: expect.not.stringContaining('PartitionKey'),
        }),
      })
    );

    // Verify result is sorted newest-first
    expect(result.length).toBe(3);
    expect(result[0].date).toBe('2026-04-08');
    expect(result[1].date).toBe('2026-04-08');
    expect(result[2].date).toBe('2026-04-07');

    // Each result should carry the domain
    expect(result.some(r => r.domain === 'acme.com')).toBe(true);
    expect(result.some(r => r.domain === 'beta.io')).toBe(true);
  });

  it('returns empty array when no rows match', async () => {
    mockListEntities.mockReturnValue({
      [Symbol.asyncIterator]: async function* () {},
    });

    const store = new IntercomStore('fake-conn');
    const result = await store.getAllSnapshots(30);
    expect(result).toEqual([]);
  });
});
