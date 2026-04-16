import { AccountStore } from '../../services/accountStore';
import { Account } from '../../types';

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

const SAMPLE: Account = {
  accountId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  hubspotCompanyId: '123',
  accountName: 'Acme Corp',
  csmName: 'Jane Smith',
  csmEmail: 'jane@example.com',
  arr: 48000,
  renewalDate: '2026-05-01',
  hubspotUrl: 'https://app.hubspot.com/contacts/123',
  syncedAt: '2026-03-11T02:00:00.000Z',
  licenses: null,
  domain: '',
  hidden: false,
  notes: '',
};

describe('AccountStore', () => {
  let store: AccountStore;

  beforeEach(() => {
    jest.clearAllMocks();
    store = new AccountStore('UseDevelopmentStorage=true', 'accounts');
  });

  it('upserts with accountId as rowKey', async () => {
    await store.upsertAccount(SAMPLE);
    expect(mockUpsertEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        partitionKey: 'accounts',
        rowKey: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        accountName: 'Acme Corp',
        arr: 48000,
      }),
      'Merge'
    );
  });

  it('listAccounts returns mapped accounts', async () => {
    const entity = {
      partitionKey: 'accounts',
      rowKey: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
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
    expect(results[0].accountId).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
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
      rowKey: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      accountName: 'Acme Corp',
      csmName: 'Jane Smith',
      csmEmail: 'jane@example.com',
      arr: 48000,
      renewalDate: '2026-05-01',
      hubspotUrl: 'https://app.hubspot.com/contacts/123',
      syncedAt: '2026-03-11T02:00:00.000Z',
    });

    const result = await store.getById('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    expect(result?.accountId).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
  });
});