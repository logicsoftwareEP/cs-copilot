import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { z } from 'zod';
import { getConfig } from '../config';
import { MappingStore } from '../services/mappingStore';
import { User } from '../types';
import { withAuth, corsHeaders } from '../middleware';

const UpsertMappingSchema = z.object({
  accountId: z.string().min(1),
  accountName: z.string().min(1),
  amplitudeAlias: z.string().min(1),
});

function makeStore() {
  const config = getConfig();
  return new MappingStore(config.storageConnectionString, config.tableMapping);
}

async function mappingCollection(
  req: HttpRequest,
  context: InvocationContext,
  user: User,
): Promise<HttpResponseInit> {
  const headers = corsHeaders();
  const store = makeStore();
  await store.ensureTable();

  if (req.method === 'POST') {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return { status: 400, headers, body: 'Invalid JSON body.' };
    }

    const parsed = UpsertMappingSchema.safeParse(body);
    if (!parsed.success) {
      return {
        status: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ errors: parsed.error.issues }),
      };
    }

    await store.upsertMapping(parsed.data.accountId, parsed.data.accountName, parsed.data.amplitudeAlias);
    return { status: 200, headers };
  }

  // GET
  const mappings = await store.listMappings();
  return {
    status: 200,
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(mappings),
  };
}

async function mappingItem(
  req: HttpRequest,
  context: InvocationContext,
  user: User,
): Promise<HttpResponseInit> {
  const headers = corsHeaders();
  const accountId = req.params.id;
  const store = makeStore();
  await store.ensureTable();

  try {
    await store.deleteMapping(accountId);
  } catch (err: any) {
    if (err?.statusCode === 404) {
      return { status: 404, headers, body: 'Mapping not found.' };
    }
    throw err;
  }

  return { status: 204, headers };
}

app.http('MappingCollection', {
  methods: ['GET', 'POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'mapping',
  handler: withAuth(mappingCollection, 'admin', 'supervisor', 'csm'),
});

app.http('MappingItem', {
  methods: ['DELETE', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'mapping/{id}',
  handler: withAuth(mappingItem, 'admin', 'supervisor', 'csm'),
});
