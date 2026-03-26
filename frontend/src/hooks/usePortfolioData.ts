import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { getAccounts, triggerSync, getSyncStatus, updateAccountLicenses, updateAccountArr, updateAccountHidden, upsertMapping, deleteMapping } from '../services/api';
import { AccountSummary } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { SortCol } from '../components/constants';
import { formatArr, lastSyncedLabel, sortRows } from '../components/scoreHelpers';

export function usePortfolioData() {
  const { user } = useAuth();
  const isCSM = user?.role === 'csm';
  const isAdmin = user?.role === 'admin';

  const [accounts, setAccounts]           = useState<AccountSummary[]>([]);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState<string | null>(null);
  const [syncing, setSyncing]             = useState(false);
  const [search, setSearch]               = useState('');
  const [filterTier, setFilterTier]       = useState('all');
  const [filterOwner, setFilterOwner]     = useState('all');
  const [sortCol, setSortCol]             = useState<SortCol>('score');
  const [sortDir, setSortDir]             = useState<'asc' | 'desc'>('asc');
  const [selected, setSelected]           = useState<AccountSummary | null>(null);
  const [showHidden, setShowHidden]       = useState(false);
  const canManage = !isCSM; // admin + supervisor can hide/unhide

  // Theme toggle
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('cs-copilot-theme') as 'dark' | 'light') || 'dark';
    }
    return 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('cs-copilot-theme', theme);
  }, [theme]);

  // Inline editing state
  const [editingLicenses, setEditingLicenses] = useState<string | null>(null);
  const [licensesInput, setLicensesInput]     = useState('');
  const [editingAlias, setEditingAlias]       = useState<string | null>(null);
  const [aliasInput, setAliasInput]           = useState('');
  const [editingArr, setEditingArr]           = useState<string | null>(null);
  const [arrInput, setArrInput]               = useState('');

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

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const syncTriggeredAt = useRef<string | null>(null);

  // Check sync status on mount — if a sync is already running, resume polling
  useEffect(() => {
    getSyncStatus().then(status => {
      if (status.status === 'running') {
        setSyncing(true);
        syncTriggeredAt.current = status.startedAt ?? new Date().toISOString();
        startPolling();
      }
    }).catch(() => {});
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function startPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const status = await getSyncStatus();
        // Ignore stale completed/failed from before this sync was triggered
        const isStale = syncTriggeredAt.current &&
          status.completedAt && status.completedAt < syncTriggeredAt.current;
        if (isStale) return;

        if (status.status === 'completed') {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setSyncing(false);
          await fetchAccounts();
        } else if (status.status === 'failed') {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setSyncing(false);
          alert(`Sync failed: ${status.error ?? 'unknown error'}`);
        }
      } catch {
        // Ignore transient poll errors
      }
    }, 5000);
  }

  async function handleSync() {
    setSyncing(true);
    try {
      syncTriggeredAt.current = new Date().toISOString();
      await triggerSync();
      startPolling();
    } catch (err: unknown) {
      setSyncing(false);
      alert(err instanceof Error ? err.message : 'Sync failed');
    }
  }

  async function saveLicenses(accountId: string) {
    const raw = licensesInput.trim();
    const value = raw === '' ? null : Number(raw);
    if (raw !== '' && (isNaN(value as number) || (value as number) < 0)) {
      setEditingLicenses(null);
      return;
    }
    try {
      await updateAccountLicenses(accountId, value);
      setAccounts(prev => prev.map(a =>
        a.accountId === accountId ? { ...a, licenses: value } : a
      ));
    } catch (err) {
      console.warn('Failed to save licenses:', err);
    }
    setEditingLicenses(null);
  }

  async function saveArr(accountId: string) {
    const raw = arrInput.trim();
    const value = raw === '' ? 0 : Number(raw);
    if (isNaN(value) || value < 0) { setEditingArr(null); return; }
    try {
      await updateAccountArr(accountId, value);
      setAccounts(prev => prev.map(a => a.accountId === accountId ? { ...a, arr: value } : a));
    } catch (err) { console.warn('Failed to save ARR:', err); }
    setEditingArr(null);
  }

  async function saveAlias(account: AccountSummary) {
    const alias = aliasInput.trim();
    try {
      if (alias) {
        await upsertMapping(account.accountId, account.accountName, alias);
        setAccounts(prev => prev.map(a =>
          a.accountId === account.accountId ? { ...a, amplitudeAlias: alias } : a
        ));
      } else if (account.amplitudeAlias) {
        // Clear alias = delete mapping
        await deleteMapping(account.accountId);
        setAccounts(prev => prev.map(a =>
          a.accountId === account.accountId ? { ...a, amplitudeAlias: null } : a
        ));
      }
    } catch (err) {
      console.warn('Failed to save alias:', err);
    }
    setEditingAlias(null);
  }

  async function handleToggleHidden(accountId: string, currentHidden: boolean) {
    const newHidden = !currentHidden;
    try {
      await updateAccountHidden(accountId, newHidden);
      setAccounts(prev => prev.map(a =>
        a.accountId === accountId ? { ...a, hidden: newHidden } : a
      ));
    } catch (err) {
      console.warn('Failed to toggle hidden:', err);
    }
  }

  function handleSortClick(col: SortCol) {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  }

  const activeAccounts = useMemo(() => accounts.filter(a => !a.hidden), [accounts]);

  const uniqueOwners = useMemo(() =>
    [...new Set(activeAccounts.map(a => a.csmName).filter(Boolean))].sort()
  , [activeAccounts]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return sortRows(
      accounts.filter(a => {
        if (a.hidden && !showHidden) return false;
        if (q && !(a.accountName ?? '').toLowerCase().includes(q)
            && !(a.csmName ?? '').toLowerCase().includes(q)
            && !(a.amplitudeAlias ?? '').toLowerCase().includes(q)) return false;
        if (filterTier !== 'all' && (a.tier ?? 'unmapped') !== filterTier) return false;
        if (filterOwner !== 'all' && a.csmName !== filterOwner) return false;
        return true;
      }),
      sortCol,
      sortDir,
    );
  }, [accounts, search, filterTier, filterOwner, sortCol, sortDir, showHidden]);

  const unmappedCount = activeAccounts.filter(a => !a.amplitudeAlias).length;
  const syncLabel = lastSyncedLabel(accounts);

  // Portfolio metrics
  const totalArr = activeAccounts.reduce((sum, a) => sum + (a.arr ?? 0), 0);
  const scoredAccounts = activeAccounts.filter(a => a.score !== null);
  const avgScore = scoredAccounts.length > 0
    ? Math.round(scoredAccounts.reduce((sum, a) => sum + (a.score ?? 0), 0) / scoredAccounts.length)
    : null;
  const atRiskCount = activeAccounts.filter(a => a.tier === 'at-risk' || a.tier === 'critical').length;

  return {
    // Auth
    user, isCSM, isAdmin, canManage,

    // Data
    accounts, loading, error, syncing, selected, filtered,
    activeAccounts, uniqueOwners, scoredAccounts,
    unmappedCount, syncLabel, totalArr, avgScore, atRiskCount,

    // Filters & sorting
    search, setSearch, filterTier, setFilterTier,
    filterOwner, setFilterOwner, sortCol, sortDir,
    showHidden, setShowHidden, handleSortClick,

    // Selection
    setSelected, setAccounts,

    // Theme
    theme, setTheme,

    // Sync
    handleSync,

    // Inline editing
    editingLicenses, setEditingLicenses, licensesInput, setLicensesInput, saveLicenses,
    editingAlias, setEditingAlias, aliasInput, setAliasInput, saveAlias,
    editingArr, setEditingArr, arrInput, setArrInput, saveArr,

    // Actions
    handleToggleHidden,

    // Helpers (re-exported for convenience)
    formatArr,
  };
}
