import { SyncStatusStore } from '../../services/syncStatusStore';

// Mock TableClient
const mockUpsertEntity = jest.fn();
const mockGetEntity = jest.fn();
const mockCreateTable = jest.fn();

jest.mock('@azure/data-tables', () => ({
  TableClient: {
    fromConnectionString: () => ({
      upsertEntity: mockUpsertEntity,
      getEntity: mockGetEntity,
      createTable: mockCreateTable,
    }),
  },
  odata: jest.fn(),
}));

beforeEach(() => jest.clearAllMocks());

describe('SyncStatusStore', () => {
  const store = new SyncStatusStore('UseDevelopmentStorage=true');

  test('setRunning writes status "running" with startedAt timestamp', async () => {
    await store.setRunning();
    expect(mockUpsertEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        partitionKey: 'sync',
        rowKey: 'status',
        status: 'running',
        startedAt: expect.any(String),
      }),
      'Replace'
    );
  });

  test('setCompleted writes status "completed" with completedAt timestamp', async () => {
    await store.setCompleted();
    expect(mockUpsertEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        partitionKey: 'sync',
        rowKey: 'status',
        status: 'completed',
        completedAt: expect.any(String),
      }),
      'Replace'
    );
  });

  test('setFailed writes status "failed" with error message', async () => {
    await store.setFailed('something broke');
    expect(mockUpsertEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        partitionKey: 'sync',
        rowKey: 'status',
        status: 'failed',
        error: 'something broke',
      }),
      'Replace'
    );
  });

  test('getStatus returns the current sync status', async () => {
    mockGetEntity.mockResolvedValue({
      partitionKey: 'sync',
      rowKey: 'status',
      status: 'running',
      startedAt: '2026-03-22T10:00:00.000Z',
    });
    const result = await store.getStatus();
    expect(result).toEqual({
      status: 'running',
      startedAt: '2026-03-22T10:00:00.000Z',
    });
  });

  test('getStatus returns idle when no status row exists', async () => {
    mockGetEntity.mockRejectedValue({ statusCode: 404 });
    const result = await store.getStatus();
    expect(result).toEqual({ status: 'idle' });
  });
});
