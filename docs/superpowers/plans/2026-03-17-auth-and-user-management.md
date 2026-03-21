# Auth & User Management Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Microsoft Entra ID authentication and role-based access control (Admin/Supervisor/CSM) to CS Copilot.

**Architecture:** Azure SWA built-in auth handles the OAuth flow with Entra ID. A `users` table in Azure Table Storage maps emails to roles. Backend validates identity via `x-ms-client-principal` header on every request. Frontend uses an auth context that gates access.

**Tech Stack:** Azure Static Web Apps built-in auth, Azure Table Storage, Azure Functions v4, React 18, Zod

**Spec:** `docs/superpowers/specs/2026-03-17-auth-and-user-management-design.md`

---

## Chunk 1: Backend — Types, UserStore, Auth Helper

### Task 1: Add User types to backend

**Files:**
- Modify: `backend/src/types.ts`

- [ ] **Step 1: Add UserRole and User types**

Add at the end of `backend/src/types.ts`:
```typescript
export type UserRole = 'admin' | 'supervisor' | 'csm';

export interface User {
  email: string;        // lowercase, rowKey in Table Storage
  displayName: string;  // must match csmName for CSM filtering
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Build to verify**

Run: `cd backend && npm run build`
Expected: Clean compilation

- [ ] **Step 3: Commit**

```bash
git add backend/src/types.ts
git commit -m "feat(auth): add User and UserRole types"
```

---

### Task 2: Create UserStore with TDD

**Files:**
- Create: `backend/src/services/userStore.ts`
- Create: `backend/src/__tests__/services/userStore.test.ts`

- [ ] **Step 1: Write tests**

Create `backend/src/__tests__/services/userStore.test.ts`:
```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npm test -- --testPathPattern=userStore`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement UserStore**

Create `backend/src/services/userStore.ts`:
```typescript
import { TableClient, odata } from '@azure/data-tables';
import { User, UserRole } from '../types';

interface UserEntity {
  partitionKey: string;
  rowKey: string;
  displayName: string;
  role: string;
  createdAt: string;
  updatedAt: string;
}

function fromEntity(entity: UserEntity): User {
  return {
    email: entity.rowKey,
    displayName: entity.displayName,
    role: entity.role as UserRole,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

export class UserStore {
  private client: TableClient;

  constructor(connectionString: string, tableName: string) {
    this.client = TableClient.fromConnectionString(connectionString, tableName);
  }

  async ensureTable(): Promise<void> {
    try {
      await this.client.createTable();
    } catch (err: any) {
      if (err?.statusCode !== 409) throw err;
    }
  }

  async getUser(email: string): Promise<User | null> {
    try {
      const entity = await this.client.getEntity<UserEntity>('users', email.toLowerCase());
      return fromEntity(entity);
    } catch (err: any) {
      if (err?.statusCode === 404) return null;
      throw err;
    }
  }

  async listUsers(): Promise<User[]> {
    const results: User[] = [];
    for await (const entity of this.client.listEntities<UserEntity>({
      queryOptions: { filter: odata`PartitionKey eq 'users'` },
    })) {
      results.push(fromEntity(entity));
    }
    return results;
  }

  async upsertUser(email: string, displayName: string, role: UserRole): Promise<void> {
    const key = email.toLowerCase();
    const existing = await this.getUser(key);
    await this.client.upsertEntity<UserEntity>(
      {
        partitionKey: 'users',
        rowKey: key,
        displayName,
        role,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      'Replace'
    );
  }

  async deleteUser(email: string): Promise<void> {
    await this.client.deleteEntity('users', email.toLowerCase());
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npm test -- --testPathPattern=userStore`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/userStore.ts backend/src/__tests__/services/userStore.test.ts
git commit -m "feat(auth): add UserStore with TDD"
```

---

### Task 3: Create auth helper with TDD

**Files:**
- Create: `backend/src/auth.ts`
- Create: `backend/src/__tests__/auth.test.ts`

- [ ] **Step 1: Write tests**

Create `backend/src/__tests__/auth.test.ts`:
```typescript
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
});

describe('requireRole', () => {
  it('does not throw when role matches', () => {
    expect(() => requireRole({ role: 'admin' } as any, 'admin', 'supervisor')).not.toThrow();
  });

  it('throws 403 when role does not match', () => {
    expect(() => requireRole({ role: 'csm' } as any, 'admin')).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npm test -- --testPathPattern=auth.test`
Expected: FAIL

- [ ] **Step 3: Implement auth helper**

Create `backend/src/auth.ts`:
```typescript
import { HttpRequest } from '@azure/functions';
import { getConfig } from './config';
import { UserStore } from './services/userStore';
import { User, UserRole } from './types';

interface ClientPrincipalClaim {
  typ: string;
  val: string;
}

interface ClientPrincipal {
  claims: ClientPrincipalClaim[];
}

export class AuthError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function authenticateRequest(req: HttpRequest): Promise<User> {
  // Local dev bypass
  if (process.env.SKIP_AUTH) {
    return { email: 'dev@local', displayName: 'Dev User', role: 'admin', createdAt: '', updatedAt: '' };
  }

  const header = req.headers.get('x-ms-client-principal');
  if (!header) {
    throw new AuthError(401, 'Not authenticated');
  }

  let principal: ClientPrincipal;
  try {
    principal = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
  } catch {
    throw new AuthError(401, 'Invalid client principal');
  }

  const emailClaim = principal.claims.find(
    c => c.typ === 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'
      || c.typ === 'preferred_username'
  );
  const email = emailClaim?.val?.toLowerCase();
  if (!email) {
    throw new AuthError(401, 'No email claim in principal');
  }

  const config = getConfig();
  const userStore = new UserStore(config.storageConnectionString, config.tableUsers ?? 'users');
  await userStore.ensureTable();
  const user = await userStore.getUser(email);
  if (!user) {
    throw new AuthError(403, 'Access denied. Contact admin.');
  }

  return user;
}

export function requireRole(user: User, ...roles: UserRole[]): void {
  if (!roles.includes(user.role)) {
    throw new AuthError(403, `Requires role: ${roles.join(' or ')}`);
  }
}
```

- [ ] **Step 4: Add `tableUsers` to config**

In `backend/src/config.ts`, add to the `Config` interface:
```typescript
tableUsers: string;
```

And in `getConfig()` return object:
```typescript
tableUsers: process.env.AZURE_STORAGE_TABLE_USERS ?? 'users',
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npm test -- --testPathPattern=auth.test`
Expected: All 5 tests PASS

- [ ] **Step 6: Run full test suite**

Run: `cd backend && npm run build && npm test`
Expected: All tests pass, clean build

- [ ] **Step 7: Commit**

```bash
git add backend/src/auth.ts backend/src/__tests__/auth.test.ts backend/src/config.ts
git commit -m "feat(auth): add authenticateRequest + requireRole helpers"
```

---

## Chunk 2: Backend — UsersApi + Modify Existing Endpoints

### Task 4: Create UsersApi

**Files:**
- Create: `backend/src/functions/UsersApi.ts`
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Create UsersApi**

Create `backend/src/functions/UsersApi.ts`:
```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { z } from 'zod';
import { getConfig } from '../config';
import { UserStore } from '../services/userStore';
import { authenticateRequest, requireRole, AuthError } from '../auth';

function makeStore() {
  const config = getConfig();
  return new UserStore(config.storageConnectionString, config.tableUsers);
}

function errorResponse(err: unknown): HttpResponseInit {
  if (err instanceof AuthError) {
    return { status: err.status, headers: { 'Content-Type': 'text/plain' }, body: err.message };
  }
  return { status: 500, headers: { 'Content-Type': 'text/plain' }, body: 'Internal error' };
}

// GET /api/me — returns current user's info or 403
async function getMe(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = await authenticateRequest(req);
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, displayName: user.displayName, role: user.role }),
    };
  } catch (err) {
    return errorResponse(err);
  }
}

const UpsertUserSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1),
  role: z.enum(['admin', 'supervisor', 'csm']),
});

// GET /api/users, POST /api/users, DELETE /api/users?email=...
async function usersHandler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    const user = await authenticateRequest(req);
    requireRole(user, 'admin');

    const store = makeStore();
    await store.ensureTable();

    if (req.method === 'GET') {
      const users = await store.listUsers();
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(users),
      };
    }

    if (req.method === 'POST') {
      let body: unknown;
      try { body = await req.json(); } catch {
        return { status: 400, body: 'Invalid JSON body.' };
      }
      const parsed = UpsertUserSchema.safeParse(body);
      if (!parsed.success) {
        return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ errors: parsed.error.issues }) };
      }

      // Guard: cannot demote the last admin
      if (parsed.data.role !== 'admin') {
        const allUsers = await store.listUsers();
        const admins = allUsers.filter(u => u.role === 'admin');
        const isTargetCurrentlyAdmin = admins.some(a => a.email === parsed.data.email.toLowerCase());
        if (isTargetCurrentlyAdmin && admins.length <= 1) {
          return { status: 400, body: 'Cannot demote the last admin.' };
        }
      }

      await store.upsertUser(parsed.data.email, parsed.data.displayName, parsed.data.role);
      return { status: 200 };
    }

    if (req.method === 'DELETE') {
      const email = req.query.get('email');
      if (!email) return { status: 400, body: 'Missing email query parameter.' };

      // Guard: cannot delete the last admin
      const allUsers = await store.listUsers();
      const admins = allUsers.filter(u => u.role === 'admin');
      if (admins.length <= 1 && admins.some(a => a.email === email.toLowerCase())) {
        return { status: 400, body: 'Cannot delete the last admin.' };
      }

      await store.deleteUser(email);
      return { status: 204 };
    }

    return { status: 405, body: 'Method not allowed' };
  } catch (err) {
    return errorResponse(err);
  }
}

app.http('GetMe', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'me',
  handler: getMe,
});

app.http('UsersCollection', {
  methods: ['GET', 'POST', 'DELETE'],
  authLevel: 'anonymous',
  route: 'users',
  handler: usersHandler,
});
```

- [ ] **Step 2: Register in index.ts**

Add to `backend/src/index.ts`:
```typescript
import './functions/UsersApi';
```

- [ ] **Step 3: Build to verify**

Run: `cd backend && npm run build`
Expected: Clean compilation

- [ ] **Step 4: Commit**

```bash
git add backend/src/functions/UsersApi.ts backend/src/index.ts
git commit -m "feat(auth): add UsersApi with GET /api/me + admin CRUD"
```

---

### Task 5: Add auth to existing endpoints + remove CORS/function keys

**Files:**
- Modify: `backend/src/functions/AccountsApi.ts`
- Modify: `backend/src/functions/MappingApi.ts`
- Modify: `backend/src/functions/SyncTrigger.ts`

- [ ] **Step 1: Update AccountsApi.ts**

Full rewrite — remove CORS_HEADERS, OPTIONS handling, add auth + CSM filtering:

Key changes:
- Remove `CORS_HEADERS` constant and all `OPTIONS` returns
- Import `authenticateRequest`, `requireRole`, `AuthError` from `../auth`
- `listAccounts`: call `authenticateRequest(req)`. If `user.role === 'csm'`, filter `summary` array to accounts where `account.csmName.toLowerCase() === user.displayName.toLowerCase()`
- `getAccount` GET: call `authenticateRequest(req)`. If `user.role === 'csm'`, verify `account.csmName.toLowerCase() === user.displayName.toLowerCase()`, else return 403
- `getAccount` PATCH: call `authenticateRequest(req)` then `requireRole(user, 'admin', 'supervisor')`
- Change both `authLevel` from `'function'` to `'anonymous'`
- Remove `OPTIONS` from methods arrays
- Wrap all handlers in try/catch for `AuthError`

- [ ] **Step 2: Update MappingApi.ts**

Key changes:
- Remove `CORS_HEADERS` and all `OPTIONS` handling
- Import auth helpers
- All handlers: call `authenticateRequest(req)` then `requireRole(user, 'admin', 'supervisor')`
- Change `authLevel` to `'anonymous'`
- Remove `OPTIONS` from methods

- [ ] **Step 3: Update SyncTrigger.ts**

Key changes:
- Remove `CORS_HEADERS` and `OPTIONS` handling
- Import auth helpers
- `triggerSync`: call `authenticateRequest(req)` then `requireRole(user, 'admin')`
- Change `authLevel` to `'anonymous'`
- Remove `OPTIONS` from methods

- [ ] **Step 4: Build and run full test suite**

Run: `cd backend && npm run build && npm test`
Expected: Existing tests may fail because mocks don't include auth headers. Fix in Task 6.

- [ ] **Step 5: Commit**

```bash
git add backend/src/functions/AccountsApi.ts backend/src/functions/MappingApi.ts backend/src/functions/SyncTrigger.ts
git commit -m "feat(auth): add auth to all endpoints, remove CORS + function keys"
```

---

### Task 6: Fix existing tests for auth changes

**Files:**
- Modify: `backend/src/__tests__/services/SyncRunner.test.ts`

The SyncRunner tests call `runSync()` directly (not via HTTP), so they should still pass. But `getConfig()` now requires `tableUsers` — add to `beforeAll`:
```typescript
process.env.AZURE_STORAGE_TABLE_USERS = 'users';
```

If any tests break due to the new config field, add the env var.

- [ ] **Step 1: Run tests, fix any failures**

Run: `cd backend && npm test`
Fix any failing tests by adding missing env vars or mocks.

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "fix(auth): update tests for new config fields"
```

---

## Chunk 3: Bootstrap Script + Frontend Auth

### Task 7: Create seed-admin script

**Files:**
- Create: `backend/scripts/seed-admin.ts`

- [ ] **Step 1: Create script**

Create `backend/scripts/seed-admin.ts`:
```typescript
/**
 * Bootstrap the first admin user.
 * Usage: npx ts-node scripts/seed-admin.ts
 * Requires AZURE_STORAGE_CONNECTION_STRING env var.
 */
import { UserStore } from '../src/services/userStore';

const CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING;
if (!CONNECTION_STRING) {
  console.error('Set AZURE_STORAGE_CONNECTION_STRING');
  process.exit(1);
}

(async () => {
  const store = new UserStore(CONNECTION_STRING, 'users');
  await store.ensureTable();
  await store.upsertUser('vadim@logicsoftware.net', 'Vadim', 'admin');
  console.log('Seeded admin: vadim@logicsoftware.net');
})().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run the script against Azure**

Run: `cd backend && AZURE_STORAGE_CONNECTION_STRING="<from local.settings.json or Azure>" npx ts-node scripts/seed-admin.ts`
Expected: "Seeded admin: vadim@logicsoftware.net"

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/seed-admin.ts
git commit -m "feat(auth): add seed-admin bootstrap script"
```

---

### Task 8: Update frontend types + API service

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/services/api.ts`

- [ ] **Step 1: Add User type to frontend**

Add to `frontend/src/types.ts`:
```typescript
export type UserRole = 'admin' | 'supervisor' | 'csm';

export interface User {
  email: string;
  displayName: string;
  role: UserRole;
  createdAt?: string;
  updatedAt?: string;
}
```

- [ ] **Step 2: Rewrite api.ts — remove function keys, add auth endpoints**

Replace `frontend/src/services/api.ts`:
```typescript
import { AccountSummary, AccountDetail, User } from '../types';

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api';

export async function getMe(): Promise<User> {
  const res = await fetch(`${BASE_URL}/me`);
  if (res.status === 401 || res.status === 403) throw new Error(`auth:${res.status}`);
  if (!res.ok) throw new Error(`Failed to fetch user: ${res.status}`);
  return res.json();
}

export async function getAccounts(): Promise<AccountSummary[]> {
  const res = await fetch(`${BASE_URL}/accounts`);
  if (!res.ok) throw new Error(`Failed to fetch accounts: ${res.status}`);
  return res.json();
}

export async function getAccountDetail(accountId: string): Promise<AccountDetail> {
  const res = await fetch(`${BASE_URL}/accounts/${encodeURIComponent(accountId)}`);
  if (!res.ok) throw new Error(`Failed to fetch account: ${res.status}`);
  return res.json();
}

export async function upsertMapping(accountId: string, accountName: string, amplitudeAlias: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/mapping`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId, accountName, amplitudeAlias }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(t || `Save failed: ${res.status}`); }
}

export async function deleteMapping(accountId: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/mapping/${encodeURIComponent(accountId)}`, { method: 'DELETE' });
  if (!res.ok) { const t = await res.text(); throw new Error(t || `Delete failed: ${res.status}`); }
}

export async function triggerSync(): Promise<void> {
  const res = await fetch(`${BASE_URL}/sync`, { method: 'POST' });
  if (!res.ok) throw new Error(`Sync trigger failed: ${res.status}`);
}

export async function updateAccountLicenses(accountId: string, licenses: number | null): Promise<void> {
  const res = await fetch(`${BASE_URL}/accounts/${encodeURIComponent(accountId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ licenses }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(t || `Update failed: ${res.status}`); }
}

export async function updateAccountArr(accountId: string, arr: number): Promise<void> {
  const res = await fetch(`${BASE_URL}/accounts/${encodeURIComponent(accountId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ arr }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(t || `Update failed: ${res.status}`); }
}

// Admin user management
export async function getUsers(): Promise<User[]> {
  const res = await fetch(`${BASE_URL}/users`);
  if (!res.ok) throw new Error(`Failed to fetch users: ${res.status}`);
  return res.json();
}

export async function upsertUser(email: string, displayName: string, role: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, displayName, role }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(t || `Save failed: ${res.status}`); }
}

export async function deleteUser(email: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/users?email=${encodeURIComponent(email)}`, { method: 'DELETE' });
  if (!res.ok) { const t = await res.text(); throw new Error(t || `Delete failed: ${res.status}`); }
}
```

- [ ] **Step 3: Build frontend**

Run: `cd frontend && npx tsc --noEmit`
Expected: Clean

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types.ts frontend/src/services/api.ts
git commit -m "feat(auth): update frontend types + api service for auth"
```

---

### Task 9: Create AuthContext + update App/main

**Files:**
- Create: `frontend/src/contexts/AuthContext.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/main.tsx`

- [ ] **Step 1: Create AuthContext**

Create `frontend/src/contexts/AuthContext.tsx`:
```tsx
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User } from '../types';
import { getMe } from '../services/api';

interface AuthState {
  user: User | null;
  loading: boolean;
  error: 'unauthorized' | 'forbidden' | null;
}

const AuthContext = createContext<AuthState>({ user: null, loading: true, error: null });

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true, error: null });

  useEffect(() => {
    (async () => {
      // In local dev (VITE_API_URL set), skip SWA auth check
      if (!import.meta.env.VITE_API_URL) {
        // Check SWA authentication
        try {
          const res = await fetch('/.auth/me');
          const data = await res.json();
          if (!data.clientPrincipal) {
            window.location.href = '/.auth/login/aad';
            return;
          }
        } catch {
          window.location.href = '/.auth/login/aad';
          return;
        }
      }

      // Check app-level authorization
      try {
        const user = await getMe();
        setState({ user, loading: false, error: null });
      } catch (err: any) {
        if (err.message?.includes('auth:401')) {
          setState({ user: null, loading: false, error: 'unauthorized' });
        } else if (err.message?.includes('auth:403')) {
          setState({ user: null, loading: false, error: 'forbidden' });
        } else {
          setState({ user: null, loading: false, error: 'unauthorized' });
        }
      }
    })();
  }, []);

  if (state.loading) {
    return (
      <div className="min-h-screen bg-obs-void flex items-center justify-center">
        <p className="text-obs-dim text-lg">Loading...</p>
      </div>
    );
  }

  if (state.error === 'forbidden') {
    return (
      <div className="min-h-screen bg-obs-void flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-obs-bright mb-2">Access Denied</h1>
          <p className="text-obs-dim">Your account is not registered. Contact your admin.</p>
          <a href="/.auth/logout" className="text-obs-accent hover:text-obs-glow mt-4 inline-block">Sign out</a>
        </div>
      </div>
    );
  }

  if (!state.user) {
    return (
      <div className="min-h-screen bg-obs-void flex items-center justify-center">
        <p className="text-obs-dim text-lg">Redirecting to login...</p>
      </div>
    );
  }

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}
```

- [ ] **Step 2: Update main.tsx**

Replace `frontend/src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App.tsx';
import { AuthProvider } from './contexts/AuthContext.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
```

- [ ] **Step 3: Update App.tsx with /admin route**

Replace `frontend/src/App.tsx`:
```tsx
import { Routes, Route, Navigate } from 'react-router-dom';
import Portfolio from './pages/Portfolio';
import Admin from './pages/Admin';
import { useAuth } from './contexts/AuthContext';

export default function App() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/" element={<Portfolio />} />
      <Route
        path="/admin"
        element={user?.role === 'admin' ? <Admin /> : <Navigate to="/" replace />}
      />
      <Route path="/mapping" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
```

- [ ] **Step 4: Create placeholder Admin page**

Create `frontend/src/pages/Admin.tsx`:
```tsx
export default function Admin() {
  return <div className="p-8 text-obs-bright">Admin page — user management coming next</div>;
}
```

- [ ] **Step 5: Build frontend**

Run: `cd frontend && npx tsc --noEmit`
Expected: Clean

- [ ] **Step 6: Commit**

```bash
git add frontend/src/contexts/AuthContext.tsx frontend/src/main.tsx frontend/src/App.tsx frontend/src/pages/Admin.tsx
git commit -m "feat(auth): add AuthContext, protected routes, /admin placeholder"
```

---

## Chunk 4: Admin Page + Portfolio Auth UI + SWA Config

### Task 10: Build Admin user management page

**Files:**
- Modify: `frontend/src/pages/Admin.tsx`

Build a simple user management page matching the existing dark theme (`obs-*` Tailwind palette):
- Table listing all users (email, display name, role, actions)
- "Add user" form at top with email, display name, role dropdown
- Edit role via dropdown in the table row
- Delete with confirmation
- "Back to Portfolio" link
- Uses `getUsers()`, `upsertUser()`, `deleteUser()` from api.ts

- [ ] **Step 1: Implement full Admin page**
- [ ] **Step 2: Build frontend**
- [ ] **Step 3: Commit**

---

### Task 11: Add auth-aware UI to Portfolio

**Files:**
- Modify: `frontend/src/pages/Portfolio.tsx`

Key changes:
- Import `useAuth()` hook
- Add user info + role badge + logout link to the header area
- If `user.role === 'admin'`, show link to `/admin`
- If `user.role === 'csm'`, hide the Sync button and hide the Owner filter dropdown
- If `user.role === 'csm'`, hide mapping edit controls (alias inline editing)

- [ ] **Step 1: Add auth-aware UI elements**
- [ ] **Step 2: Build frontend**
- [ ] **Step 3: Commit**

---

### Task 12: Update staticwebapp.config.json

**Files:**
- Modify: `frontend/staticwebapp.config.json`

- [ ] **Step 1: Replace with auth-enabled config**

Replace `frontend/staticwebapp.config.json`:
```json
{
  "routes": [
    { "route": "/.auth/login/github", "statusCode": 404 },
    { "route": "/.auth/login/twitter", "statusCode": 404 },
    { "route": "/api/*", "allowedRoles": ["authenticated"] },
    { "route": "/*", "allowedRoles": ["authenticated"] }
  ],
  "responseOverrides": {
    "401": {
      "redirect": "/.auth/login/aad",
      "statusCode": 302
    }
  },
  "navigationFallback": {
    "rewrite": "/index.html",
    "exclude": ["/api/*", "*.{css,js,png,ico,svg}"]
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/staticwebapp.config.json
git commit -m "feat(auth): configure SWA auth routes for Entra ID"
```

---

## Chunk 5: Azure Configuration + Deployment

### Task 13: Azure setup (manual steps)

These are manual Azure Portal / CLI steps:

- [ ] **Step 1: Register Entra ID app**
  - Azure Portal → Entra ID → App registrations → New registration
  - Name: `cs-copilot-auth`
  - Redirect URI: `https://lemon-island-0c1c7070f.4.azurestaticapps.net/.auth/login/aad/callback`
  - Create a client secret, note the value

- [ ] **Step 2: Link backend to SWA**
```bash
FUNC_ID=$(az functionapp show --name cs-copilot-func --resource-group customersuccess --query id -o tsv)
az staticwebapp backends link --name cs-copilot-ui --resource-group customersuccess --backend-resource-id "$FUNC_ID" --backend-region eastus
```

- [ ] **Step 3: Set SWA auth settings**
```bash
az staticwebapp appsettings set --name cs-copilot-ui --setting-names \
  AZURE_CLIENT_ID=<app-registration-client-id> \
  AZURE_CLIENT_SECRET=<client-secret-value>
```

- [ ] **Step 4: Seed admin user**
```bash
cd backend && AZURE_STORAGE_CONNECTION_STRING="<connection-string>" npx ts-node scripts/seed-admin.ts
```

### Task 14: Deploy

- [ ] **Step 1: Deploy backend**
```bash
cd backend && npm run build && func azure functionapp publish cs-copilot-func --javascript
```

- [ ] **Step 2: Deploy frontend**
```bash
cd frontend && npm run build
SWA_TOKEN=$(az staticwebapp secrets list --name cs-copilot-ui --query "properties.apiKey" -o tsv)
npx --yes @azure/static-web-apps-cli deploy dist --deployment-token "$SWA_TOKEN" --env production
```

- [ ] **Step 3: Test login flow**
  - Navigate to `https://lemon-island-0c1c7070f.4.azurestaticapps.net`
  - Should redirect to Entra ID login
  - After login, should see Portfolio (if vadim@logicsoftware.net) or "Access denied" (if other user)

- [ ] **Step 4: Test admin page**
  - Navigate to `/admin`
  - Add a test user, verify it appears
  - Delete the test user

- [ ] **Step 5: Commit any fixes**
