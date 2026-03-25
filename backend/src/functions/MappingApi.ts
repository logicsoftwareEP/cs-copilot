import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { z } from 'zod';
import { getConfig } from '../config';
import { MappingStore } from '../services/mappingStore';
import { authenticateRequest, requireRole, AuthError } from '../auth';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-User-Email',
};

const UpsertMappingSchema = z.object({
  accountId: z.string().min(1),
  accountName: z.string().min(1),
  amplitudeAlias: z.string().min(1),
});

function makeStore() {
  const config = getConfig();
  return new MappingStore(config.storageConnectionString, config.tableMapping);
}

async function listMappings(
  req: HttpRequest,
  _context: InvocationContext
): Promise<HttpResponseInit> {
  const store = makeStore();
  await store.ensureTable();
  const mappings = await store.listMappings();

  return {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(mappings),
  };
}

async function upsertMapping(
  req: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { status: 400, headers: CORS_HEADERS, body: 'Invalid JSON body.' };
  }

  const parsed = UpsertMappingSchema.safeParse(body);
  if (!parsed.success) {
    return {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ errors: parsed.error.issues }),
    };
  }

  const store = makeStore();
  await store.ensureTable();

  try {
    await store.upsertMapping(parsed.data.accountId, parsed.data.accountName, parsed.data.amplitudeAlias);
  } catch (err: any) {
    context.error('upsertMapping failed:', err);
    return { status: 500, headers: CORS_HEADERS, body: `Storage error: ${err.message}` };
  }

  return { status: 200, headers: CORS_HEADERS };
}

async function deleteMapping(
  req: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const accountId = req.params.id;
  const store = makeStore();
  await store.ensureTable();

  try {
    await store.deleteMapping(accountId);
  } catch (err: any) {
    if (err?.statusCode === 404) {
      return { status: 404, headers: CORS_HEADERS, body: 'Mapping not found.' };
    }

    context.error('deleteMapping failed:', err);
    return { status: 500, headers: CORS_HEADERS, body: `Storage error: ${err.message}` };
  }

  return { status: 204, headers: CORS_HEADERS };
}

app.http('MappingCollection', {
  methods: ['GET', 'POST', 'OPTIONS'],
  authLevel: 'function',
  route: 'mapping',
  handler: async (req, context) => {
    if (req.method === 'OPTIONS') return { status: 204, headers: CORS_HEADERS };
    try {
      const user = await authenticateRequest(req);
      requireRole(user, 'admin', 'supervisor', 'csm');

      if (req.method === 'POST') return upsertMapping(req, context);
      return listMappings(req, context);
    } catch (err) {
      if (err instanceof AuthError) return { status: (err as AuthError).status, headers: CORS_HEADERS, body: (err as AuthError).message };
      return { status: 500, headers: CORS_HEADERS, body: 'Internal error' };
    }
  },
});

app.http('MappingItem', {
  methods: ['DELETE', 'OPTIONS'],
  authLevel: 'function',
  route: 'mapping/{id}',
  handler: async (req, context) => {
    if (req.method === 'OPTIONS') return { status: 204, headers: CORS_HEADERS };
    try {
      const user = await authenticateRequest(req);
      requireRole(user, 'admin', 'supervisor', 'csm');
      return deleteMapping(req, context);
    } catch (err) {
      if (err instanceof AuthError) return { status: (err as AuthError).status, headers: CORS_HEADERS, body: (err as AuthError).message };
      return { status: 500, headers: CORS_HEADERS, body: 'Internal error' };
    }
  },
});
