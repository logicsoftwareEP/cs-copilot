import { HttpRequest } from '@azure/functions';
import { getConfig } from './config';
import { UserStore } from './services/userStore';
import { User, UserRole } from './types';

interface ClientPrincipalClaim {
  typ: string;
  val: string;
}

interface ClientPrincipal {
  claims: ClientPrincipalClaim[];
}

export class AuthError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function authenticateRequest(req: HttpRequest): Promise<User> {
  // Local dev bypass — disabled when WEBSITE_SITE_NAME is set (Azure production)
  if (process.env.SKIP_AUTH && !process.env.WEBSITE_SITE_NAME) {
    const devEmail = req.headers.get('x-user-email')?.toLowerCase() || 'dev@local';
    return { email: devEmail, displayName: 'Dev User', role: 'admin', createdAt: '', updatedAt: '' };
  }

  // SWA client principal header (only trusted auth source in production)
  let email: string | undefined;
  const principalHeader = req.headers.get('x-ms-client-principal');
  if (principalHeader) {
    try {
      const principal: ClientPrincipal = JSON.parse(Buffer.from(principalHeader, 'base64').toString('utf8'));
      const emailClaim = principal.claims.find(
        c => c.typ === 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'
          || c.typ === 'preferred_username'
      );
      email = emailClaim?.val?.toLowerCase();
    } catch { /* invalid principal header */ }
  }

  // Fall back to X-User-Email header (used by frontend behind function key auth)
  // This fallback is safe because authLevel: 'function' gates access with a key.
  // Will be removed when SWA backend linking is enabled (Standard plan).
  if (!email) {
    email = req.headers.get('x-user-email')?.toLowerCase();
  }

  if (!email) {
    throw new AuthError(401, 'Not authenticated');
  }

  const config = getConfig();
  const userStore = new UserStore(config.storageConnectionString, config.tableUsers ?? 'users');
  await userStore.ensureTable();
  const user = await userStore.getUser(email);
  if (!user) {
    throw new AuthError(403, 'Access denied. Contact admin.');
  }

  return user;
}

export function requireRole(user: User, ...roles: UserRole[]): void {
  if (!roles.includes(user.role)) {
    throw new AuthError(403, `Requires role: ${roles.join(' or ')}`);
  }
}
