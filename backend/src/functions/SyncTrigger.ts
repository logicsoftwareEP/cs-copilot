import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getConfig } from '../config';

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

  // TODO: Task 7 - call runSync() instead of n8n webhook
  context.log('POST /api/sync received (runSync not yet implemented)');

  return {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'triggered' }),
  };
}

app.http('TriggerSync', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'function',
  route: 'sync',
  handler: triggerSync,
});