import { AccountStore } from '../../services/accountStore';
import { HubspotAccount } from '../../types';

const mockUpsertEntity = jest.fn().mockResolvedValue(undefined);
const mockListEntities = jest.fn();
const mockGetEntity = jest.fn();
const mockCreateTable = jest.fn().mockResolvedValue(undefined);

jest.mock('@azure/data-tables', () => ({
  TableClient: {
    fromConnectionString: jest.fn(() => ({
      createTable: mockCreateTable,
      upsertEntity: mockUpsertEntity,
      listEntities: mockListEntities,
      getEntity: mockGetEntity,
    })),
  },
  odata: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce((acc, s, i) => acc + s + (values[i] ?? ''), '')
  ),
}));

const SAMPLE: HubspotAccount = {
  hubspotId: 'hs-123',
  accountName: 'Acme Corp',
  csmName: 'Jane Smith',
  csmEmail: 'jane@example.com',
  arr: 48000,
  renewalDate: '2026-05-01',
  hubspotUrl: 'https://app.hubspot.com/contacts/123',
  syncedAt: '2026-03-11T02:00:00.000Z',
  licenses: null,
};

describe('AccountStore', () => {
  let store: AccountStore;

  beforeEach(() => {
    jest.clearAllMocks();
    store = new AccountStore('UseDevelopmentStorage=true', 'accounts');
  });

  it('upserts with hubspotId as RowKey', async () => {
    await store.upsertAccount(SAMPLE);
    expect(mockUpsertEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        partitionKey: 'accounts',
        rowKey: 'hs-123',
        accountName: 'Acme Corp',
        arr: 48000,
      }),
      'Merge'
    );
  });

  it('listAccounts returns mapped accounts', async () => {
    const entity = {
      partitionKey: 'accounts',
      rowKey: 'hs-123',
      accountName: 'Acme Corp',
      csmName: 'Jane Smith',
      csmEmail: 'jane@example.com',
      arr: 48000,
      renewalDate: '2026-05-01',
      hubspotUrl: 'https://app.hubspot.com/contacts/123',
      syncedAt: '2026-03-11T02:00:00.000Z',
    };

    mockListEntities.mockReturnValue((async function* () {
      yield entity;
    })());

    const results = await store.listAccounts();
    expect(results).toHaveLength(1);
    expect(results[0].hubspotId).toBe('hs-123');
    expect(results[0].accountName).toBe('Acme Corp');
  });

  it('getById returns null for missing entity', async () => {
    mockGetEntity.mockRejectedValue({ statusCode: 404 });
    const result = await store.getById('hs-999');
    expect(result).toBeNull();
  });

  it('getById returns account for existing entity', async () => {
    mockGetEntity.mockResolvedValue({
      partitionKey: 'accounts',
      rowKey: 'hs-123',
      accountName: 'Acme Corp',
      csmName: 'Jane Smith',
      csmEmail: 'jane@example.com',
      arr: 48000,
      renewalDate: '2026-05-01',
      hubspotUrl: 'https://app.hubspot.com/contacts/123',
      syncedAt: '2026-03-11T02:00:00.000Z',
    });

    const result = await store.getById('hs-123');
    expect(result?.hubspotId).toBe('hs-123');
  });
});