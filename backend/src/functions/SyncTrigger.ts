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

  const config = getConfig();

  try {
    const response = await fetch(config.n8nSyncWebhookUrl, { method: 'POST' });
    if (!response.ok) {
      context.error(`n8n webhook returned ${response.status}`);
      return {
        status: 502,
        headers: CORS_HEADERS,
        body: `Failed to trigger sync: n8n returned ${response.status}`,
      };
    }
  } catch (err: any) {
    context.error('Failed to call n8n webhook:', err);
    return {
      status: 502,
      headers: CORS_HEADERS,
      body: `Failed to trigger sync: ${err.message}`,
    };
  }

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