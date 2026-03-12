import { MappingStore } from '../../services/mappingStore';

const mockUpsertEntity = jest.fn().mockResolvedValue(undefined);
const mockDeleteEntity = jest.fn().mockResolvedValue(undefined);
const mockListEntities = jest.fn();
const mockGetEntity = jest.fn();
const mockCreateTable = jest.fn().mockResolvedValue(undefined);

jest.mock('@azure/data-tables', () => ({
  TableClient: {
    fromConnectionString: jest.fn(() => ({
      createTable: mockCreateTable,
      upsertEntity: mockUpsertEntity,
      deleteEntity: mockDeleteEntity,
      listEntities: mockListEntities,
      getEntity: mockGetEntity,
    })),
  },
  odata: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce((acc, s, i) => acc + s + (values[i] ?? ''), '')
  ),
}));

describe('MappingStore', () => {
  let store: MappingStore;

  beforeEach(() => {
    mockUpsertEntity.mockReset();
    mockUpsertEntity.mockResolvedValue(undefined);
    mockDeleteEntity.mockReset();
    mockDeleteEntity.mockResolvedValue(undefined);
    mockListEntities.mockReset();
    mockGetEntity.mockReset();
    mockGetEntity.mockRejectedValue({ statusCode: 404 });
    mockCreateTable.mockReset();
    mockCreateTable.mockResolvedValue(undefined);

    store = new MappingStore('UseDevelopmentStorage=true', 'amplitudemapping');
  });

  it('upsertMapping stores with correct keys', async () => {
    await store.upsertMapping('hs-123', 'Acme Corp', 'acme-corp-prod');

    expect(mockUpsertEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        partitionKey: 'mapping',
        rowKey: 'hs-123',
        hubspotName: 'Acme Corp',
        amplitudeAlias: 'acme-corp-prod',
      }),
      'Replace'
    );
  });

  it('upsertMapping preserves createdAt on update', async () => {
    mockGetEntity.mockResolvedValue({
      partitionKey: 'mapping',
      rowKey: 'hs-123',
      hubspotName: 'Acme',
      amplitudeAlias: 'old',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    await store.upsertMapping('hs-123', 'Acme Corp', 'new-alias');
    const call = mockUpsertEntity.mock.calls[0][0];
    expect(call.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('upsertMapping sets createdAt for new mapping', async () => {
    await store.upsertMapping('hs-new', 'New Corp', 'new-alias');
    const call = mockUpsertEntity.mock.calls[0][0];
    expect(call.createdAt).toBeTruthy();
    expect(call.amplitudeAlias).toBe('new-alias');
  });

  it('deleteMapping throws for non-existent row', async () => {
    mockDeleteEntity.mockRejectedValue({ statusCode: 404 });
    await expect(store.deleteMapping('hs-missing')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('listMappings returns all rows', async () => {
    mockListEntities.mockReturnValue((async function* () {
      yield {
        partitionKey: 'mapping',
        rowKey: 'hs-123',
        hubspotName: 'Acme',
        amplitudeAlias: 'acme',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
    })());

    const results = await store.listMappings();
    expect(results).toHaveLength(1);
    expect(results[0].hubspotId).toBe('hs-123');
    expect(results[0].amplitudeAlias).toBe('acme');
  });

  it('getMapping returns null for missing row', async () => {
    const result = await store.getMapping('hs-999');
    expect(result).toBeNull();
  });

  it('deleteMapping calls deleteEntity with correct keys', async () => {
    await store.deleteMapping('hs-123');
    expect(mockDeleteEntity).toHaveBeenCalledWith('mapping', 'hs-123');
  });
});