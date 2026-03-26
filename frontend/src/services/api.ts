import { AccountSummary, AccountDetail, User } from '../types';

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api';

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
}

export async function getMe(): Promise<User> {
  const res = await apiFetch('/me');
  if (res.status === 401 || res.status === 403) throw new Error(`auth:${res.status}`);
  if (!res.ok) throw new Error(`Failed to fetch user: ${res.status}`);
  return res.json();
}

export async function getAccounts(): Promise<AccountSummary[]> {
  const res = await apiFetch('/accounts');
  if (!res.ok) throw new Error(`Failed to fetch accounts: ${res.status}`);
  return res.json();
}

export async function getAccountDetail(accountId: string): Promise<AccountDetail> {
  const res = await apiFetch(`/accounts/${encodeURIComponent(accountId)}`);
  if (!res.ok) throw new Error(`Failed to fetch account: ${res.status}`);
  return res.json();
}

export async function upsertMapping(accountId: string, accountName: string, amplitudeAlias: string): Promise<void> {
  const res = await apiFetch('/mapping', {
    method: 'POST',
    body: JSON.stringify({ accountId, accountName, amplitudeAlias }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(t || `Save failed: ${res.status}`); }
}

export async function deleteMapping(accountId: string): Promise<void> {
  const res = await apiFetch(`/mapping/${encodeURIComponent(accountId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) { const t = await res.text(); throw new Error(t || `Delete failed: ${res.status}`); }
}

export async function triggerSync(): Promise<void> {
  const res = await apiFetch('/sync', { method: 'POST' });
  if (!res.ok) throw new Error(`Sync trigger failed: ${res.status}`);
}

export interface SyncStatus {
  status: 'idle' | 'running' | 'completed' | 'failed';
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export async function getSyncStatus(): Promise<SyncStatus> {
  const res = await apiFetch('/sync');
  if (!res.ok) return { status: 'idle' };
  return res.json();
}

export async function updateAccountLicenses(accountId: string, licenses: number | null): Promise<void> {
  const res = await apiFetch(`/accounts/${encodeURIComponent(accountId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ licenses }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(t || `Update failed: ${res.status}`); }
}

export async function updateAccountArr(accountId: string, arr: number): Promise<void> {
  const res = await apiFetch(`/accounts/${encodeURIComponent(accountId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ arr }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(t || `Update failed: ${res.status}`); }
}

export async function updateAccountHidden(accountId: string, hidden: boolean): Promise<void> {
  const res = await apiFetch(`/accounts/${encodeURIComponent(accountId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ hidden }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(t || `Update failed: ${res.status}`); }
}

export async function refreshAccountScore(accountId: string): Promise<{ score: number | null; tier: string; aliasStatus: string | null }> {
  const res = await apiFetch(`/accounts/${encodeURIComponent(accountId)}`, {
    method: 'POST',
  });
  if (!res.ok) { const t = await res.text(); throw new Error(t || `Score refresh failed: ${res.status}`); }
  return res.json();
}

// Admin user management
export async function getUsers(): Promise<User[]> {
  const res = await apiFetch('/users');
  if (!res.ok) throw new Error(`Failed to fetch users: ${res.status}`);
  return res.json();
}

export async function upsertUser(email: string, displayName: string, role: string): Promise<void> {
  const res = await apiFetch('/users', {
    method: 'POST',
    body: JSON.stringify({ email, displayName, role }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(t || `Save failed: ${res.status}`); }
}

export async function deleteUser(email: string): Promise<void> {
  const res = await apiFetch(`/users?email=${encodeURIComponent(email)}`, {
    method: 'DELETE',
  });
  if (!res.ok) { const t = await res.text(); throw new Error(t || `Delete failed: ${res.status}`); }
}
