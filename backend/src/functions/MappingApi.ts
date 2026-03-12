import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { z } from 'zod';
import { getConfig } from '../config';
import { MappingStore } from '../services/mappingStore';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const UpsertMappingSchema = z.object({
  hubspotId: z.string().min(1),
  hubspotName: z.string().min(1),
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
  if (req.method === 'OPTIONS') return { status: 204, headers: CORS_HEADERS };

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
  if (req.method === 'OPTIONS') return { status: 204, headers: CORS_HEADERS };

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
    await store.upsertMapping(parsed.data.hubspotId, parsed.data.hubspotName, parsed.data.amplitudeAlias);
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
  if (req.method === 'OPTIONS') return { status: 204, headers: CORS_HEADERS };

  const hubspotId = req.params.id;
  const store = makeStore();
  await store.ensureTable();

  try {
    await store.deleteMapping(hubspotId);
  } catch (err: any) {
    if (err?.statusCode === 404) {
      return { status: 404, headers: CORS_HEADERS, body: 'Mapping not found.' };
    }

    context.error('deleteMapping failed:', err);
    return { status: 500, headers: CORS_HEADERS, body: `Storage error: ${err.message}` };
  }

  return { status: 204, headers: CORS_HEADERS };
}

app.http('ListMappings', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'function',
  route: 'mapping',
  handler: listMappings,
});

app.http('UpsertMapping', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'function',
  route: 'mapping',
  handler: upsertMapping,
});

app.http('DeleteMapping', {
  methods: ['DELETE', 'OPTIONS'],
  authLevel: 'function',
  route: 'mapping/{id}',
  handler: deleteMapping,
});