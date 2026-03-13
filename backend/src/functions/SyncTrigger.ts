import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { runSync } from './SyncRunner';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function triggerSync(
  req: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return { status: 204, headers: CORS_HEADERS };

  try {
    const result = await runSync(context);
    return {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ok', result }),
    };
  } catch (err: any) {
    context.error('Sync failed:', err);
    return {
      status: 500,
      headers: CORS_HEADERS,
      body: `Sync failed: ${err.message}`,
    };
  }
}

app.http('TriggerSync', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'function',
  route: 'sync',
  handler: triggerSync,
});