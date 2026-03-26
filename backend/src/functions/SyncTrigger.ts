import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { runSync } from './SyncRunner';
import { getConfig } from '../config';
import { SyncStatusStore } from '../services/syncStatusStore';
import { User } from '../types';
import { withAuth, corsHeaders } from '../middleware';

async function triggerSync(
  req: HttpRequest,
  context: InvocationContext,
  user: User,
): Promise<HttpResponseInit> {
  const headers = corsHeaders();

  // GET /api/sync — return current sync status
  if (req.method === 'GET') {
    const config = getConfig();
    const statusStore = new SyncStatusStore(config.storageConnectionString);
    const status = await statusStore.getStatus();
    return {
      status: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(status),
    };
  }

  // POST /api/sync — admin only
  if (user.role !== 'admin') {
    return { status: 403, headers, body: 'Requires role: admin' };
  }

  const config = getConfig();
  const statusStore = new SyncStatusStore(config.storageConnectionString);

  await statusStore.ensureTable();

  // Concurrency guard: check if a sync is already running
  const currentStatus = await statusStore.getStatus();
  if (currentStatus.status === 'running' && currentStatus.startedAt) {
    const startedAt = new Date(currentStatus.startedAt).getTime();
    const fifteenMinAgo = Date.now() - 15 * 60 * 1000;
    if (startedAt > fifteenMinAgo) {
      return {
        status: 429,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Sync already in progress', startedAt: currentStatus.startedAt }),
      };
    }
    // Stale sync (>15 min) — allow override
  }

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
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'accepted' }),
  };
}

app.http('TriggerSync', {
  methods: ['GET', 'POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'sync',
  handler: withAuth(triggerSync),
});
