import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { runSync } from './SyncRunner';
import { authenticateRequest, requireRole, AuthError } from '../auth';
import { getConfig } from '../config';
import { SyncStatusStore } from '../services/syncStatusStore';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-User-Email',
};

async function triggerSync(
  req: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: CORS_HEADERS };

  const config = getConfig();
  const statusStore = new SyncStatusStore(config.storageConnectionString);

  // GET /api/sync — return current sync status
  if (req.method === 'GET') {
    try {
      await authenticateRequest(req);
      const status = await statusStore.getStatus();
      return {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify(status),
      };
    } catch (err: any) {
      if (err instanceof AuthError) return { status: err.status, headers: CORS_HEADERS, body: err.message };
      return { status: 500, headers: CORS_HEADERS, body: `Status check failed: ${err.message}` };
    }
  }

  // POST /api/sync — trigger sync
  try {
    const user = await authenticateRequest(req);
    requireRole(user, 'admin');

    await statusStore.ensureTable();
    await statusStore.setRunning();

    // Fire-and-forget: return 202 immediately, run sync in background.
    runSync(context)
      .then(() => statusStore.setCompleted())
      .catch(async (err) => {
        context.error('Background sync failed:', err);
        await statusStore.setFailed(err?.message ?? String(err));
      });

    return {
      status: 202,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'accepted' }),
    };
  } catch (err: any) {
    if (err instanceof AuthError) return { status: err.status, headers: CORS_HEADERS, body: err.message };
    context.error('Sync failed:', err);
    return {
      status: 500,
      headers: CORS_HEADERS,
      body: `Sync failed: ${err.message}`,
    };
  }
}

app.http('TriggerSync', {
  methods: ['GET', 'POST', 'OPTIONS'],
  authLevel: 'function',
  route: 'sync',
  handler: triggerSync,
});
