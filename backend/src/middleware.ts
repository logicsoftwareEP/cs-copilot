import { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticateRequest, requireRole, AuthError } from './auth';
import { User, UserRole } from './types';

type AuthenticatedHandler = (
  req: HttpRequest,
  context: InvocationContext,
  user: User,
) => Promise<HttpResponseInit>;

export function corsHeaders(): Record<string, string> {
  // SWA_ORIGIN locks CORS to the frontend domain in production.
  // Falls back to '*' for local dev or when not configured.
  const origin = process.env.SWA_ORIGIN || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-User-Email',
  };
}

export function withAuth(
  handler: AuthenticatedHandler,
  ...roles: UserRole[]
): (req: HttpRequest, context: InvocationContext) => Promise<HttpResponseInit> {
  return async (req, context) => {
    const headers = corsHeaders();
    if (req.method === 'OPTIONS') return { status: 204, headers };

    try {
      const user = await authenticateRequest(req);
      if (roles.length > 0) requireRole(user, ...roles);
      const result = await handler(req, context, user);
      // Auto-merge CORS headers into handler response
      return { ...result, headers: { ...headers, ...result.headers } };
    } catch (err) {
      if (err instanceof AuthError) {
        return { status: err.status, headers, body: err.message };
      }
      context.error('Handler error:', err);
      return { status: 500, headers, body: 'Internal error' };
    }
  };
}
