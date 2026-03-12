import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { getAccounts, upsertMapping, deleteMapping } from '../services/api';
import { AccountSummary } from '../types';

interface RowState {
  editing: boolean;
  inputValue: string;
  saving: boolean;
  error: string | null;
}

export default function Mapping() {
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAccounts(await getAccounts());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load accounts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  function startEdit(hubspotId: string, currentAlias: string | null) {
    setRowStates(prev => ({
      ...prev,
      [hubspotId]: { editing: true, inputValue: currentAlias ?? '', saving: false, error: null },
    }));
  }

  function cancelEdit(hubspotId: string) {
    setRowStates(prev => {
      const next = { ...prev };
      delete next[hubspotId];
      return next;
    });
  }

  async function saveEdit(account: AccountSummary) {
    const state = rowStates[account.hubspotId];
    if (!state) return;
    const alias = state.inputValue.trim();
    if (!alias) return;

    setRowStates(prev => ({
      ...prev,
      [account.hubspotId]: { ...state, saving: true, error: null },
    }));

    try {
      await upsertMapping(account.hubspotId, account.accountName, alias);
      setAccounts(prev =>
        prev.map(a => a.hubspotId === account.hubspotId ? { ...a, amplitudeAlias: alias } : a)
      );
      cancelEdit(account.hubspotId);
    } catch (err: unknown) {
      setRowStates(prev => ({
        ...prev,
        [account.hubspotId]: {
          ...state,
          saving: false,
          error: err instanceof Error ? err.message : 'Save failed \u2014 try again',
        },
      }));
    }
  }

  async function handleDelete(account: AccountSummary) {
    try {
      await deleteMapping(account.hubspotId);
      setAccounts(prev =>
        prev.map(a => a.hubspotId === account.hubspotId ? { ...a, amplitudeAlias: null } : a)
      );
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  function handleKeyDown(e: React.KeyboardEvent, account: AccountSummary) {
    if (e.key === 'Enter') saveEdit(account);
    if (e.key === 'Escape') cancelEdit(account.hubspotId);
  }

  const INPUT_CLS = 'border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 w-56';

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-gray-400 hover:text-gray-600 text-sm">&larr; Portfolio</Link>
          <h1 className="text-xl font-bold text-gray-900">Amplitude Mapping</h1>
        </div>
        <button
          disabled
          title="Coming soon"
          className="px-4 py-2 bg-gray-100 text-gray-400 text-sm font-medium rounded-lg cursor-not-allowed"
        >
          Import CSV
        </button>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        <p className="text-sm text-gray-500 mb-6">
          Match each HubSpot account to its Amplitude account alias. Unmapped accounts cannot be scored.
        </p>

        {loading && (
          <div className="flex items-center gap-3 text-gray-400 py-16 justify-center">
            <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Loading...
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 mb-4">
            {error}
          </div>
        )}

        {!loading && !error && accounts.length === 0 && (
          <div className="text-center py-20 text-gray-400">
            <p className="text-4xl mb-4">🔗</p>
            <p className="text-lg font-medium text-gray-600 mb-1">No accounts yet</p>
            <p className="text-sm">
              <Link to="/" className="text-blue-600 hover:text-blue-800">Run a sync</Link> to pull accounts from HubSpot first.
            </p>
          </div>
        )}

        {!loading && !error && accounts.length > 0 && (
          <div className="bg-white rounded-xl border overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <th className="px-4 py-3">HubSpot Account</th>
                  <th className="px-4 py-3">Amplitude Alias</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {accounts.map(account => {
                  const state = rowStates[account.hubspotId];
                  const isUnmapped = !account.amplitudeAlias;

                  return (
                    <tr
                      key={account.hubspotId}
                      className={`${isUnmapped ? 'border-l-2 border-l-yellow-400 bg-yellow-50' : 'hover:bg-gray-50'} transition-colors`}
                    >
                      <td className="px-4 py-3 font-medium text-gray-900">{account.accountName}</td>
                      <td className="px-4 py-3">
                        {state?.editing ? (
                          <div>
                            <input
                              autoFocus
                              className={INPUT_CLS}
                              value={state.inputValue}
                              onChange={e => setRowStates(prev => ({
                                ...prev,
                                [account.hubspotId]: { ...prev[account.hubspotId], inputValue: e.target.value },
                              }))}
                              onKeyDown={e => handleKeyDown(e, account)}
                              disabled={state.saving}
                              placeholder="e.g. acme-corp-prod"
                            />
                            {state.error && (
                              <p className="text-xs text-red-600 mt-1">{state.error}</p>
                            )}
                          </div>
                        ) : (
                          <span
                            className={isUnmapped ? 'text-gray-400 italic' : 'text-gray-700'}
                            onClick={() => startEdit(account.hubspotId, account.amplitudeAlias)}
                            role="button"
                            title="Click to edit"
                          >
                            {account.amplitudeAlias ?? 'Not mapped'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {state?.editing ? (
                          <div className="flex gap-3">
                            <button
                              onClick={() => saveEdit(account)}
                              disabled={state.saving || !state.inputValue.trim()}
                              className="text-green-600 hover:text-green-800 disabled:opacity-40 font-bold"
                            >
                              {state.saving ? '\u2026' : '\u2713'}
                            </button>
                            <button
                              onClick={() => cancelEdit(account.hubspotId)}
                              disabled={state.saving}
                              className="text-gray-400 hover:text-gray-600 font-bold"
                            >
                              {'\u2715'}
                            </button>
                          </div>
                        ) : (
                          <div className="flex gap-3">
                            <button
                              onClick={() => startEdit(account.hubspotId, account.amplitudeAlias)}
                              className="text-gray-400 hover:text-blue-600 transition-colors"
                              title="Edit alias"
                            >
                              ✏
                            </button>
                            {account.amplitudeAlias && (
                              <button
                                onClick={() => handleDelete(account)}
                                className="text-gray-400 hover:text-red-600 transition-colors"
                                title="Remove mapping"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        )}
                      </td>
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
