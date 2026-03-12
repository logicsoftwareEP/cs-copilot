import { AccountSummary } from '../types';

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api';
const API_KEY = import.meta.env.VITE_API_KEY ?? '';

function withCode(url: string): string {
  return API_KEY ? `${url}?code=${encodeURIComponent(API_KEY)}` : url;
}

export async function getAccounts(): Promise<AccountSummary[]> {
  const res = await fetch(withCode(`${BASE_URL}/accounts`));
  if (!res.ok) throw new Error(`Failed to fetch accounts: ${res.status}`);
  return res.json();
}

export async function getAccount(hubspotId: string): Promise<AccountSummary> {
  const res = await fetch(withCode(`${BASE_URL}/accounts/${encodeURIComponent(hubspotId)}`));
  if (!res.ok) throw new Error(`Failed to fetch account: ${res.status}`);
  return res.json();
}

export async function upsertMapping(hubspotId: string, hubspotName: string, amplitudeAlias: string): Promise<void> {
  const res = await fetch(withCode(`${BASE_URL}/mapping`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hubspotId, hubspotName, amplitudeAlias }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Save failed: ${res.status}`);
  }
}

export async function deleteMapping(hubspotId: string): Promise<void> {
  const res = await fetch(withCode(`${BASE_URL}/mapping/${encodeURIComponent(hubspotId)}`), {
    method: 'DELETE',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Delete failed: ${res.status}`);
  }
}

export async function triggerSync(): Promise<void> {
  const res = await fetch(withCode(`${BASE_URL}/sync`), { method: 'POST' });
  if (!res.ok) throw new Error(`Sync trigger failed: ${res.status}`);
}
