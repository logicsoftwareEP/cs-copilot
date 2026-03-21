import { UserStore } from '../../services/userStore';
import { User } from '../../types';

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

describe('UserStore', () => {
  let store: UserStore;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetEntity.mockRejectedValue({ statusCode: 404 });
    store = new UserStore('UseDevelopmentStorage=true', 'users');
  });

  it('upserts user with email as rowKey (lowercase)', async () => {
    await store.upsertUser('Admin@Example.COM', 'Admin User', 'admin');
    expect(mockUpsertEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        partitionKey: 'users',
        rowKey: 'admin@example.com',
        displayName: 'Admin User',
        role: 'admin',
      }),
      'Replace'
    );
  });

  it('getUser returns user for existing email', async () => {
    mockGetEntity.mockResolvedValueOnce({
      partitionKey: 'users',
      rowKey: 'jane@test.com',
      displayName: 'Jane',
      role: 'csm',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });

    const user = await store.getUser('Jane@Test.com');
    expect(user).not.toBeNull();
    expect(user!.email).toBe('jane@test.com');
    expect(user!.role).toBe('csm');
    expect(mockGetEntity).toHaveBeenCalledWith('users', 'jane@test.com');
  });

  it('getUser returns null for missing user', async () => {
    mockGetEntity.mockRejectedValueOnce({ statusCode: 404 });
    const user = await store.getUser('nobody@test.com');
    expect(user).toBeNull();
  });

  it('listUsers returns all users', async () => {
    mockListEntities.mockReturnValueOnce([
      { partitionKey: 'users', rowKey: 'a@test.com', displayName: 'A', role: 'admin', createdAt: '', updatedAt: '' },
      { partitionKey: 'users', rowKey: 'b@test.com', displayName: 'B', role: 'csm', createdAt: '', updatedAt: '' },
    ][Symbol.iterator]());
    const users = await store.listUsers();
    expect(users).toHaveLength(2);
    expect(users[0].email).toBe('a@test.com');
  });

  it('deleteUser calls deleteEntity', async () => {
    await store.deleteUser('Jane@Test.com');
    expect(mockDeleteEntity).toHaveBeenCalledWith('users', 'jane@test.com');
  });
});
