import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { z } from 'zod';
import { getConfig } from '../config';
import { UserStore } from '../services/userStore';
import { User } from '../types';
import { withAuth, corsHeaders } from '../middleware';

function makeStore() {
  const config = getConfig();
  return new UserStore(config.storageConnectionString, config.tableUsers);
}

// GET /api/me — returns current user's info
async function getMe(
  req: HttpRequest,
  context: InvocationContext,
  user: User,
): Promise<HttpResponseInit> {
  const headers = corsHeaders();
  return {
    status: 200,
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, displayName: user.displayName, role: user.role }),
  };
}

const UpsertUserSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1),
  role: z.enum(['admin', 'supervisor', 'csm']),
});

// GET /api/users, POST /api/users, DELETE /api/users?email=...
async function usersHandler(
  req: HttpRequest,
  context: InvocationContext,
  user: User,
): Promise<HttpResponseInit> {
  const headers = corsHeaders();
  const store = makeStore();
  await store.ensureTable();

  if (req.method === 'GET') {
    const users = await store.listUsers();
    return {
      status: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(users),
    };
  }

  if (req.method === 'POST') {
    let body: unknown;
    try { body = await req.json(); } catch {
      return { status: 400, headers, body: 'Invalid JSON body.' };
    }
    const parsed = UpsertUserSchema.safeParse(body);
    if (!parsed.success) {
      return { status: 400, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ errors: parsed.error.issues }) };
    }

    // Guard: cannot demote the last admin
    if (parsed.data.role !== 'admin') {
      const allUsers = await store.listUsers();
      const admins = allUsers.filter(u => u.role === 'admin');
      const isTargetCurrentlyAdmin = admins.some(a => a.email === parsed.data.email.toLowerCase());
      if (isTargetCurrentlyAdmin && admins.length <= 1) {
        return { status: 400, headers, body: 'Cannot demote the last admin.' };
      }
    }

    await store.upsertUser(parsed.data.email, parsed.data.displayName, parsed.data.role);
    return { status: 200, headers };
  }

  if (req.method === 'DELETE') {
    const email = req.query.get('email');
    if (!email) return { status: 400, headers, body: 'Missing email query parameter.' };

    // Guard: cannot delete the last admin
    const allUsers = await store.listUsers();
    const admins = allUsers.filter(u => u.role === 'admin');
    if (admins.length <= 1 && admins.some(a => a.email === email.toLowerCase())) {
      return { status: 400, headers, body: 'Cannot delete the last admin.' };
    }

    await store.deleteUser(email);
    return { status: 204, headers };
  }

  return { status: 405, headers, body: 'Method not allowed' };
}

app.http('GetMe', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'function',
  route: 'me',
  handler: withAuth(getMe),
});

app.http('UsersCollection', {
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  authLevel: 'function',
  route: 'users',
  handler: withAuth(usersHandler, 'admin'),
});
