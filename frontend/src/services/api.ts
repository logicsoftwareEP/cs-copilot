import { AccountSummary, AccountDetail, User } from '../types';

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api';
const API_KEY = import.meta.env.VITE_API_KEY ?? '';

let _userEmail = '';
export function setAuthEmail(email: string) { _userEmail = email; }

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (_userEmail) h['X-User-Email'] = _userEmail;
  return h;
}

function withCode(url: string): string {
  if (!API_KEY) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}code=${encodeURIComponent(API_KEY)}`;
}

export async function getMe(email: string): Promise<User> {
  const res = await fetch(withCode(`${BASE_URL}/me`), {
    headers: { 'X-User-Email': email },
  });
  if (res.status === 401 || res.status === 403) throw new Error(`auth:${res.status}`);
  if (!res.ok) throw new Error(`Failed to fetch user: ${res.status}`);
  return res.json();
}

export async function getAccounts(): Promise<AccountSummary[]> {
  const res = await fetch(withCode(`${BASE_URL}/accounts`), {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to fetch accounts: ${res.status}`);
  return res.json();
}

export async function getAccountDetail(accountId: string): Promise<AccountDetail> {
  const res = await fetch(withCode(`${BASE_URL}/accounts/${encodeURIComponent(accountId)}`), {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to fetch account: ${res.status}`);
  return res.json();
}

export async function upsertMapping(accountId: string, accountName: string, amplitudeAlias: string): Promise<void> {
  const res = await fetch(withCode(`${BASE_URL}/mapping`), {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ accountId, accountName, amplitudeAlias }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(t || `Save failed: ${res.status}`); }
}

export async function deleteMapping(accountId: string): Promise<void> {
  const res = await fetch(withCode(`${BASE_URL}/mapping/${encodeURIComponent(accountId)}`), {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(t || `Delete failed: ${res.status}`); }
}

export async function triggerSync(): Promise<void> {
  const res = await fetch(withCode(`${BASE_URL}/sync`), {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Sync trigger failed: ${res.status}`);
}

export async function updateAccountLicenses(accountId: string, licenses: number | null): Promise<void> {
  const res = await fetch(withCode(`${BASE_URL}/accounts/${encodeURIComponent(accountId)}`), {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ licenses }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(t || `Update failed: ${res.status}`); }
}

export async function updateAccountArr(accountId: string, arr: number): Promise<void> {
  const res = await fetch(withCode(`${BASE_URL}/accounts/${encodeURIComponent(accountId)}`), {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ arr }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(t || `Update failed: ${res.status}`); }
}

export async function updateAccountHidden(accountId: string, hidden: boolean): Promise<void> {
  const res = await fetch(withCode(`${BASE_URL}/accounts/${encodeURIComponent(accountId)}`), {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ hidden }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(t || `Update failed: ${res.status}`); }
}

// Admin user management
export async function getUsers(): Promise<User[]> {
  const res = await fetch(withCode(`${BASE_URL}/users`), {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to fetch users: ${res.status}`);
  return res.json();
}

export async function upsertUser(email: string, displayName: string, role: string): Promise<void> {
  const res = await fetch(withCode(`${BASE_URL}/users`), {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ email, displayName, role }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(t || `Save failed: ${res.status}`); }
}

export async function deleteUser(email: string): Promise<void> {
  const res = await fetch(withCode(`${BASE_URL}/users?email=${encodeURIComponent(email)}`), {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(t || `Delete failed: ${res.status}`); }
}
