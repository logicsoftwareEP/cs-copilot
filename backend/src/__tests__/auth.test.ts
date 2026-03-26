import { authenticateRequest, requireRole } from '../auth';
import { UserStore } from '../services/userStore';

jest.mock('../services/userStore');
jest.mock('../config', () => ({
  getConfig: () => ({
    storageConnectionString: 'UseDevelopmentStorage=true',
    tableUsers: 'users',
  }),
}));

const MockUserStore = UserStore as jest.MockedClass<typeof UserStore>;

function mockRequest(email?: string): any {
  if (!email) return { headers: new Map() };
  const claims = [{ typ: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress', val: email }];
  const principal = Buffer.from(JSON.stringify({ claims })).toString('base64');
  return { headers: new Map([['x-ms-client-principal', principal]]) };
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.SKIP_AUTH;
  delete process.env.WEBSITE_SITE_NAME;
  MockUserStore.mockImplementation(() => ({
    ensureTable: jest.fn().mockResolvedValue(undefined),
    getUser: jest.fn(),
    listUsers: jest.fn(),
    upsertUser: jest.fn(),
    deleteUser: jest.fn(),
  } as any));
});

describe('authenticateRequest', () => {
  it('returns user when header is valid and user exists', async () => {
    const mockGetUser = jest.fn().mockResolvedValue({ email: 'alice@test.com', displayName: 'Alice', role: 'admin', createdAt: '', updatedAt: '' });
    MockUserStore.mockImplementation(() => ({ ensureTable: jest.fn().mockResolvedValue(undefined), getUser: mockGetUser } as any));

    const user = await authenticateRequest(mockRequest('alice@test.com'));
    expect(user.email).toBe('alice@test.com');
    expect(user.role).toBe('admin');
  });

  it('throws 403 when no header', async () => {
    await expect(authenticateRequest(mockRequest())).rejects.toMatchObject({ status: 401 });
  });

  it('throws 403 when user not in users table', async () => {
    const mockGetUser = jest.fn().mockResolvedValue(null);
    MockUserStore.mockImplementation(() => ({ ensureTable: jest.fn().mockResolvedValue(undefined), getUser: mockGetUser } as any));

    await expect(authenticateRequest(mockRequest('unknown@test.com'))).rejects.toMatchObject({ status: 403 });
  });

  it('returns mock admin when SKIP_AUTH is set', async () => {
    process.env.SKIP_AUTH = 'true';
    const user = await authenticateRequest(mockRequest());
    expect(user.role).toBe('admin');
  });

  it('ignores SKIP_AUTH when WEBSITE_SITE_NAME is set (production)', async () => {
    process.env.SKIP_AUTH = 'true';
    process.env.WEBSITE_SITE_NAME = 'cs-copilot-func';
    await expect(authenticateRequest(mockRequest())).rejects.toMatchObject({ status: 401 });
  });

  it('uses X-User-Email in SKIP_AUTH mode for local dev', async () => {
    process.env.SKIP_AUTH = 'true';
    const req = { headers: new Map([['x-user-email', 'test@dev.com']]) };
    const user = await authenticateRequest(req as any);
    expect(user.email).toBe('test@dev.com');
    expect(user.role).toBe('admin');
  });
});

describe('requireRole', () => {
  it('does not throw when role matches', () => {
    expect(() => requireRole({ role: 'admin' } as any, 'admin', 'supervisor')).not.toThrow();
  });

  it('throws 403 when role does not match', () => {
    expect(() => requireRole({ role: 'csm' } as any, 'admin')).toThrow();
  });
});
