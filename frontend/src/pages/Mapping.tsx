import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { getAccounts, upsertMapping, deleteMapping } from '../services/api';
import { AccountSummary } from '../types';

interface RowState {
  editing: boolean;
  inputValue: string;
  saving: boolean;
  error: string | null;
}

function BvLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <circle cx="10" cy="10" r="10" fill="#6955ED" fillOpacity="0.12" />
      <path d="M6 10.5C6 8.015 8.015 6 10.5 6S15 8.015 15 10.5 12.985 15 10.5 15 6 12.985 6 10.5z" fill="#6955ED" />
      <path d="M5 7.5C5 6.12 6.12 5 7.5 5h1L6 8.5 5 7.5z" fill="#6955ED" fillOpacity="0.6" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

export default function Mapping() {
  const [accounts, setAccounts]     = useState<AccountSummary[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [rowStates, setRowStates]   = useState<Record<string, RowState>>({});
  const [search, setSearch]         = useState('');
  const [filterMapped, setFilterMapped] = useState<'all' | 'mapped' | 'unmapped'>('all');

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

  const mappedCount   = accounts.filter(a => a.amplitudeAlias).length;
  const unmappedCount = accounts.length - mappedCount;
  const pct           = accounts.length > 0 ? Math.round((mappedCount / accounts.length) * 100) : 0;

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return accounts.filter(a => {
      if (q && !a.accountName.toLowerCase().includes(q)) return false;
      if (filterMapped === 'mapped'   && !a.amplitudeAlias) return false;
      if (filterMapped === 'unmapped' && a.amplitudeAlias)  return false;
      return true;
    });
  }, [accounts, search, filterMapped]);

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
          error: err instanceof Error ? err.message : 'Save failed — try again',
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

  return (
    <div className="min-h-screen bg-bv-surface">

      {/* ── Header ── */}
      <header className="bg-white border-b border-bv-border h-14 flex items-center px-6 justify-between sticky top-0 z-30">
        <div className="flex items-center gap-2.5">
          <Link
            to="/"
            className="text-bv-subtle hover:text-bv-primary transition-colors p-1 rounded-md hover:bg-bv-xlight"
            aria-label="Back to Portfolio"
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M19 12H5M12 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
          <span className="text-bv-border">|</span>
          <BvLogo />
          <span className="font-semibold text-bv-ink text-sm tracking-tight">CS Copilot</span>
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className="text-bv-border">
            <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-sm text-bv-muted">Amplitude Mapping</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-6">

        {/* ── Progress card ── */}
        {!loading && !error && accounts.length > 0 && (
          <div className="bg-white rounded-xl border border-bv-divider px-5 py-4 mb-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-sm font-semibold text-bv-ink">
                  {mappedCount} of {accounts.length} accounts mapped
                </p>
                <p className="text-xs text-bv-muted mt-0.5">
                  {unmappedCount > 0
                    ? `${unmappedCount} account${unmappedCount === 1 ? '' : 's'} still need an Amplitude alias to be scored`
                    : 'All accounts are mapped — scores will update on next sync'}
                </p>
              </div>
              <span className="text-lg font-bold text-bv-primary ml-4 flex-shrink-0">{pct}%</span>
            </div>
            <div className="h-1.5 bg-bv-divider rounded-full overflow-hidden">
              <div
                className="h-full bg-bv-primary rounded-full transition-all duration-700"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {/* ── Toolbar ── */}
        {!loading && !error && accounts.length > 0 && (
          <div className="bg-white rounded-xl border border-bv-divider px-4 py-3 mb-4 flex items-center gap-3">
            <div className="relative flex-1">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-bv-subtle pointer-events-none"
                fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" strokeLinecap="round" />
              </svg>
              <input
                type="text"
                placeholder="Search accounts…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-sm bg-bv-surface border border-bv-divider rounded-lg text-bv-ink placeholder-bv-subtle focus:outline-none focus:ring-1 focus:ring-bv-primary focus:border-bv-primary"
              />
            </div>

            <select
              value={filterMapped}
              onChange={e => setFilterMapped(e.target.value as typeof filterMapped)}
              className="text-sm bg-bv-surface border border-bv-divider rounded-lg px-3 py-1.5 text-bv-body focus:outline-none focus:ring-1 focus:ring-bv-primary focus:border-bv-primary"
            >
              <option value="all">All accounts</option>
              <option value="mapped">Mapped only</option>
              <option value="unmapped">Unmapped only</option>
            </select>

            <span className="text-xs text-bv-subtle whitespace-nowrap">
              {filtered.length !== accounts.length
                ? `${filtered.length} of ${accounts.length}`
                : `${accounts.length} accounts`}
            </span>
          </div>
        )}

        {/* ── Loading ── */}
        {loading && (
          <div className="flex items-center justify-center gap-3 text-bv-subtle py-24">
            <Spinner /> <span className="text-sm">Loading…</span>
          </div>
        )}

        {/* ── Error ── */}
        {error && (
          <div className="bg-[#FFECEB] border border-[#C9372C]/20 rounded-xl px-4 py-3 text-sm text-[#AE2A19] mb-4">
            {error}
          </div>
        )}

        {/* ── Empty state ── */}
        {!loading && !error && accounts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-28 text-center">
            <div className="w-14 h-14 rounded-2xl bg-bv-xlight flex items-center justify-center mb-4">
              <svg className="w-7 h-7 text-bv-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
              </svg>
            </div>
            <p className="text-base font-semibold text-bv-ink mb-1">No accounts to map</p>
            <p className="text-sm text-bv-muted mb-5">
              <Link to="/" className="text-bv-primary hover:text-bv-hover">Run a sync</Link> to pull accounts from HubSpot first.
            </p>
          </div>
        )}

        {/* ── No results ── */}
        {!loading && !error && accounts.length > 0 && filtered.length === 0 && (
          <div className="py-14 text-center text-sm text-bv-subtle">
            No accounts match your search.{' '}
            <button
              onClick={() => { setSearch(''); setFilterMapped('all'); }}
              className="text-bv-primary hover:text-bv-hover"
            >
              Clear
            </button>
          </div>
        )}

        {/* ── Table ── */}
        {!loading && !error && filtered.length > 0 && (
          <div className="bg-white rounded-xl border border-bv-divider overflow-hidden shadow-sm shadow-[#26262B]/5">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-bv-surface border-b border-bv-divider text-left">
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-bv-subtle">
                    HubSpot Account
                  </th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-bv-subtle">
                    Amplitude Alias
                  </th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-bv-subtle w-24">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bv-surface">
                {filtered.map(account => {
                  const state       = rowStates[account.hubspotId];
                  const isUnmapped  = !account.amplitudeAlias;

                  return (
                    <tr
                      key={account.hubspotId}
                      className={`transition-colors ${isUnmapped ? 'bg-white' : 'bg-white hover:bg-bv-surface'}`}
                    >
                      {/* Account name */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {isUnmapped && (
                            <span className="w-1.5 h-1.5 rounded-full bg-[#CF9F02] flex-shrink-0" title="Unmapped" />
                          )}
                          <span className="font-medium text-bv-ink">{account.accountName}</span>
                        </div>
                      </td>

                      {/* Alias column */}
                      <td className="px-4 py-3">
                        {state?.editing ? (
                          <div>
                            <input
                              autoFocus
                              value={state.inputValue}
                              onChange={e => setRowStates(prev => ({
                                ...prev,
                                [account.hubspotId]: { ...prev[account.hubspotId], inputValue: e.target.value },
                              }))}
                              onKeyDown={e => handleKeyDown(e, account)}
                              disabled={state.saving}
                              placeholder="e.g. acme-corp-prod"
                              className="border border-bv-border rounded-lg px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-1 focus:ring-bv-primary focus:border-bv-primary text-bv-ink placeholder-bv-subtle disabled:opacity-50"
                            />
                            {state.error && (
                              <p className="text-xs text-[#AE2A19] mt-1">{state.error}</p>
                            )}
                          </div>
                        ) : (
                          <button
                            onClick={() => startEdit(account.hubspotId, account.amplitudeAlias)}
                            className={`text-sm text-left rounded px-0 py-0 transition-colors group ${
                              isUnmapped
                                ? 'text-bv-subtle italic'
                                : 'text-bv-body font-mono hover:text-bv-primary'
                            }`}
                            title="Click to edit"
                          >
                            {account.amplitudeAlias ?? 'Not mapped — click to set'}
                          </button>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3">
                        {state?.editing ? (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => saveEdit(account)}
                              disabled={state.saving || !state.inputValue.trim()}
                              className="flex items-center gap-1 text-xs font-semibold text-white bg-bv-primary hover:bg-bv-hover disabled:opacity-40 px-2.5 py-1 rounded-lg transition-colors"
                            >
                              {state.saving ? <><Spinner /> Saving…</> : 'Save'}
                            </button>
                            <button
                              onClick={() => cancelEdit(account.hubspotId)}
                              disabled={state.saving}
                              className="text-xs text-bv-muted hover:text-bv-ink px-2 py-1 rounded-lg hover:bg-bv-surface transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => startEdit(account.hubspotId, account.amplitudeAlias)}
                              className="text-bv-subtle hover:text-bv-primary p-1.5 rounded-lg hover:bg-bv-xlight transition-colors"
                              title="Edit alias"
                            >
                              <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" strokeLinecap="round" strokeLinejoin="round" />
                                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                            {account.amplitudeAlias && (
                              <button
                                onClick={() => handleDelete(account)}
                                className="text-bv-subtle hover:text-[#C9372C] p-1.5 rounded-lg hover:bg-[#FFECEB] transition-colors"
                                title="Remove mapping"
                              >
                                <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                  <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
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
