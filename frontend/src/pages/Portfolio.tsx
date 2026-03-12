import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { getAccounts, triggerSync } from '../services/api';
import { AccountSummary, HealthTier } from '../types';

const TIER_STYLES: Record<HealthTier | 'unmapped', string> = {
  healthy: 'bg-green-100 text-green-800',
  watch: 'bg-yellow-100 text-yellow-800',
  'at-risk': 'bg-orange-100 text-orange-800',
  critical: 'bg-red-100 text-red-800',
  unmapped: 'bg-gray-100 text-gray-500',
};

const TIER_LABELS: Record<HealthTier | 'unmapped', string> = {
  healthy: 'Healthy',
  watch: 'Watch',
  'at-risk': 'At Risk',
  critical: 'Critical',
  unmapped: 'Unmapped',
};

function formatArr(arr: number): string {
  if (arr == null) return '\u2014';
  return `$${(arr / 1000).toFixed(0)}k`;
}

function renewalBadge(date: string): string {
  if (!date) return '\u2014';
  const days = Math.round((new Date(date).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return 'Expired';
  if (days <= 30) return `${days}d !`;
  return `${days}d`;
}

function lastSyncedLabel(accounts: AccountSummary[]): string {
  const syncedAt = accounts.map(a => a.syncedAt).filter(Boolean).sort().reverse()[0];
  if (!syncedAt) return 'Never synced';
  const mins = Math.round((Date.now() - new Date(syncedAt).getTime()) / 60_000);
  if (mins < 60) return `Last synced ${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `Last synced ${hours}h ago`;
  return `Last synced ${Math.round(hours / 24)}d ago`;
}

export default function Portfolio() {
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAccounts(await getAccounts());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load accounts';
      if (msg.includes('404') || msg.includes('Failed to fetch')) {
        setAccounts([]);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  async function handleSync() {
    setSyncing(true);
    try {
      await triggerSync();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  const unmappedCount = accounts.filter(a => !a.amplitudeAlias).length;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">CS Copilot</h1>
        <nav className="flex items-center gap-4">
          <Link to="/mapping" className="text-sm text-blue-600 hover:text-blue-800">
            Amplitude Mapping
            {unmappedCount > 0 && (
              <span className="ml-1.5 bg-yellow-100 text-yellow-800 text-xs font-medium px-1.5 py-0.5 rounded-full">
                {unmappedCount} unmapped
              </span>
            )}
          </Link>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {syncing ? 'Syncing\u2026' : 'Sync Now'}
          </button>
        </nav>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-gray-800">
            My Accounts{accounts.length > 0 ? ` (${accounts.length})` : ''}
          </h2>
          {accounts.length > 0 && (
            <span className="text-xs text-gray-400">{lastSyncedLabel(accounts)}</span>
          )}
        </div>

        {loading && (
          <div className="flex items-center gap-3 text-gray-400 py-16 justify-center">
            <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Loading accounts...
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && !error && accounts.length === 0 && (
          <div className="text-center py-20 text-gray-400">
            <p className="text-4xl mb-4">📋</p>
            <p className="text-lg font-medium text-gray-600 mb-1">No accounts yet</p>
            <p className="text-sm mb-6">Run a sync to pull active clients from HubSpot.</p>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {syncing ? 'Syncing\u2026' : 'Sync Now'}
            </button>
          </div>
        )}

        {!loading && !error && accounts.length > 0 && (
          <div className="bg-white rounded-xl border overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <th className="px-4 py-3">Account</th>
                  <th className="px-4 py-3">CSM</th>
                  <th className="px-4 py-3">Health</th>
                  <th className="px-4 py-3">Score</th>
                  <th className="px-4 py-3">ARR</th>
                  <th className="px-4 py-3">Renewal</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {accounts.map(account => {
                  const tier = account.tier ?? null;
                  const isUnmapped = !account.amplitudeAlias;
                  return (
                    <tr
                      key={account.hubspotId}
                      className={`hover:bg-gray-50 transition-colors ${isUnmapped ? 'border-l-2 border-l-yellow-400' : ''}`}
                    >
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {account.accountName}
                        {isUnmapped && (
                          <Link to="/mapping" className="ml-2 text-xs text-yellow-600 hover:text-yellow-800">
                            Map Amplitude
                          </Link>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{account.csmName}</td>
                      <td className="px-4 py-3">
                        {tier ? (
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${TIER_STYLES[tier]}`}>
                            {TIER_LABELS[tier]}
                          </span>
                        ) : (
                          <span className="text-gray-400 text-xs">Pending</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {account.score !== null ? (
                          <span>
                            {account.score}
                            {account.scoreDelta !== null && account.scoreDelta !== 0 && (
                              <span className={`ml-1 text-xs ${account.scoreDelta > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {account.scoreDelta > 0 ? `+${account.scoreDelta}` : `${account.scoreDelta}`}
                              </span>
                            )}
                          </span>
                        ) : '\u2014'}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{formatArr(account.arr)}</td>
                      <td className="px-4 py-3 text-gray-600">{renewalBadge(account.renewalDate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
