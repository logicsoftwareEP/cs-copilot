import { Link } from 'react-router-dom';
import { usePortfolioData } from '../hooks/usePortfolioData';
import { TIER_CFG, RENEWAL_COLOURS, SortCol } from '../components/constants';
import { renewalInfo } from '../components/scoreHelpers';
import { ObsLogo } from '../components/ObsLogo';
import { TierBadge } from '../components/TierBadge';
import { MetricCard } from '../components/MetricCard';
import { Spinner } from '../components/Spinner';
import { SortIcon } from '../components/SortIcon';
import { DetailPanel } from '../components/DetailPanel';

function SortTH({ col, sortCol, sortDir, onSort, children, className = '' }: {
  col: SortCol; sortCol: SortCol; sortDir: 'asc' | 'desc'; onSort: (col: SortCol) => void;
  children: React.ReactNode; className?: string;
}) {
  const active = sortCol === col;
  return (
    <th
      className={`px-4 py-3 cursor-pointer select-none whitespace-nowrap text-left ${className}`}
      onClick={() => onSort(col)}
    >
      <span className={`inline-flex items-center text-[14px] font-semibold uppercase tracking-[0.08em] transition-colors ${
        active ? 'text-obs-accent' : 'text-obs-ghost hover:text-obs-dim'
      }`}>
        {children}
        <SortIcon active={active} dir={sortDir} />
      </span>
    </th>
  );
}

export default function Portfolio() {
  const d = usePortfolioData();

  return (
    <div className="min-h-screen bg-obs-base">

      {/* ── Header ── */}
      <header className="bg-obs-raised/80 backdrop-blur-xl border-b border-obs-edge h-14 flex items-center px-6 justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <ObsLogo />
          <div>
            <span className="font-semibold text-obs-bright text-[15px] tracking-tight">CS Copilot</span>
            <span className="text-obs-ghost text-[14px] ml-2 font-mono uppercase tracking-wider">Observatory</span>
          </div>
        </div>
        <nav className="flex items-center gap-3">
          {d.syncLabel && (
            <span className="text-[14px] text-obs-ghost font-mono mr-1">
              Synced {d.syncLabel}
            </span>
          )}
          {d.unmappedCount > 0 && (
            <span className="bg-tier-watch-bg text-tier-watch text-[14px] font-bold px-2 py-0.5 rounded-full border border-tier-watch/20">
              {d.unmappedCount} unmapped
            </span>
          )}

          {/* User info + role badge */}
          {d.user && (
            <span className="flex items-center gap-2 text-[14px]">
              <span className="text-obs-text">{d.user.displayName}</span>
              <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium uppercase tracking-wider border ${
                d.user.role === 'admin' ? 'bg-obs-accent/20 text-obs-accent border-obs-accent/30' :
                d.user.role === 'supervisor' ? 'bg-tier-watch-bg text-tier-watch border-tier-watch/30' :
                'bg-tier-healthy-bg text-tier-healthy border-tier-healthy/30'
              }`}>
                {d.user.role}
              </span>
            </span>
          )}

          {d.isAdmin && (
            <Link to="/admin" className="text-[14px] text-obs-accent hover:text-obs-glow transition-colors">
              Admin
            </Link>
          )}
          {d.isAdmin && (
            <Link to="/diagnostics" className="text-[14px] text-obs-accent hover:text-obs-glow transition-colors">
              Diagnostics
            </Link>
          )}

          <a href="/.auth/logout" className="text-[14px] text-obs-dim hover:text-obs-text transition-colors">
            Logout
          </a>

          <button
            onClick={() => d.setTheme(t => t === 'dark' ? 'light' : 'dark')}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-obs-ghost hover:text-obs-bright hover:bg-obs-elevated transition-colors"
            title={`Switch to ${d.theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {d.theme === 'dark' ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
          {d.isAdmin && (
            <button
              onClick={d.handleSync}
              disabled={d.syncing}
              className="flex items-center gap-2 px-4 py-1.5 bg-obs-accent hover:bg-obs-glow disabled:opacity-50 text-white text-[14px] font-medium rounded-lg transition-all shadow-glow-sm hover:shadow-glow"
            >
              {d.syncing ? <><Spinner className="h-4 w-4" /> Syncing...</> : 'Sync Now'}
            </button>
          )}
        </nav>
      </header>

      <main className="max-w-[1440px] mx-auto px-6 py-6">

        {/* ── Metric cards ── */}
        {!d.loading && !d.error && d.activeAccounts.length > 0 && (
          <div className="grid grid-cols-4 gap-4 mb-6">
            <MetricCard
              label="Accounts"
              value={d.activeAccounts.length}
              sub={`${d.scoredAccounts.length} scored`}
              delay={1}
            />
            <MetricCard
              label="Portfolio ARR"
              value={d.totalArr >= 1_000_000 ? `$${(d.totalArr / 1_000_000).toFixed(1)}M` : `$${(d.totalArr / 1000).toFixed(0)}k`}
              sub={d.activeAccounts.length > 0 ? `avg ${d.formatArr(d.totalArr / d.activeAccounts.length)}` : undefined}
              delay={2}
            />
            <MetricCard
              label="Avg Health Score"
              value={d.avgScore ?? '—'}
              sub={d.avgScore !== null ? (d.avgScore >= 70 ? 'Portfolio is healthy' : d.avgScore >= 50 ? 'Needs attention' : 'At risk') : 'No scored accounts'}
              accent={d.avgScore !== null ? (d.avgScore >= 70 ? '#34D399' : d.avgScore >= 50 ? '#FBBF24' : '#F87171') : undefined}
              delay={3}
            />
            <MetricCard
              label="At Risk"
              value={d.atRiskCount}
              sub={d.atRiskCount > 0 ? `${d.activeAccounts.filter(a => a.tier === 'critical').length} critical` : 'None'}
              accent={d.atRiskCount > 0 ? '#F87171' : '#34D399'}
              delay={4}
            />
          </div>
        )}

        {/* ── Top 10 Needs Review ── */}
        {!d.loading && !d.error && d.activeAccounts.length > 0 && (() => {
          const needsReview = d.activeAccounts
            .filter(a => a.tier === 'critical' || a.tier === 'at-risk')
            .sort((a, b) => (b.arr ?? 0) - (a.arr ?? 0))
            .slice(0, 10);

          if (needsReview.length === 0) return null;

          return (
            <div className="mb-6">
              <p className="text-[14px] font-semibold uppercase tracking-[0.12em] text-obs-ghost mb-3">
                Needs Review
                <span className="text-obs-dim font-normal ml-2">Top {needsReview.length} at-risk accounts by ARR</span>
              </p>
              <div className="grid grid-cols-5 gap-3">
                {needsReview.map(a => {
                  const cfg = TIER_CFG[a.tier ?? 'unmapped'];
                  return (
                    <div
                      key={a.accountId}
                      onClick={() => d.setSelected(a)}
                      className="bg-obs-raised border border-obs-edge rounded-xl px-4 py-3 cursor-pointer hover:border-obs-rule transition-colors group"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <TierBadge tier={a.tier ?? 'unmapped'} />
                        <span className="text-[16px] font-bold font-mono" style={{ color: cfg.color }}>
                          {a.score ?? '—'}
                        </span>
                      </div>
                      <p className="text-[14px] font-semibold text-obs-bright truncate">{a.accountName}</p>
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-[14px] text-obs-dim truncate">{a.csmName || '—'}</span>
                        <span className="text-[14px] font-mono text-obs-ghost">{d.formatArr(a.arr)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* ── Toolbar ── */}
        {!d.loading && !d.error && d.activeAccounts.length > 0 && (
          <div className="bg-obs-raised border border-obs-edge rounded-xl px-4 py-3 mb-4 flex flex-wrap items-center gap-3">
            {/* Search */}
            <div className="relative flex-1 min-w-52">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-obs-ghost pointer-events-none"
                fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" strokeLinecap="round" />
              </svg>
              <input
                type="text"
                placeholder="Search accounts, owner, or alias..."
                value={d.search}
                onChange={e => d.setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-[14px] bg-obs-card border border-obs-edge rounded-lg text-obs-bright placeholder-obs-ghost focus:outline-none focus:ring-1 focus:ring-obs-accent focus:border-obs-accent"
              />
            </div>

            {/* Owner filter (hidden for CSMs) */}
            {!d.isCSM && (
              <select
                value={d.filterOwner}
                onChange={e => d.setFilterOwner(e.target.value)}
                className="text-[14px] bg-obs-card border border-obs-edge rounded-lg px-3 py-2 text-obs-text focus:outline-none focus:ring-1 focus:ring-obs-accent focus:border-obs-accent"
              >
                <option value="all">All owners</option>
                {d.uniqueOwners.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            )}

            {/* Tier filter */}
            <select
              value={d.filterTier}
              onChange={e => d.setFilterTier(e.target.value)}
              className="text-[14px] bg-obs-card border border-obs-edge rounded-lg px-3 py-2 text-obs-text focus:outline-none focus:ring-1 focus:ring-obs-accent focus:border-obs-accent"
            >
              <option value="all">All tiers</option>
              <option value="healthy">Healthy</option>
              <option value="watch">Watch</option>
              <option value="at-risk">At Risk</option>
              <option value="critical">Critical</option>
              <option value="unmapped">Unmapped</option>
            </select>

            {d.canManage && (
              <label className="flex items-center gap-1.5 text-[14px] text-obs-ghost cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={d.showHidden}
                  onChange={e => d.setShowHidden(e.target.checked)}
                  className="accent-obs-accent"
                />
                Show hidden
              </label>
            )}

            {/* Clear + count */}
            {(d.search || d.filterTier !== 'all' || d.filterOwner !== 'all') && (
              <button
                onClick={() => { d.setSearch(''); d.setFilterTier('all'); d.setFilterOwner('all'); }}
                className="text-[14px] text-obs-dim hover:text-obs-accent transition-colors"
              >
                Clear
              </button>
            )}
            <span className="text-[14px] text-obs-ghost ml-auto whitespace-nowrap font-mono">
              {d.filtered.length !== (d.showHidden ? d.accounts.length : d.activeAccounts.length)
                ? `${d.filtered.length} / ${d.showHidden ? d.accounts.length : d.activeAccounts.length}`
                : `${d.showHidden ? d.accounts.length : d.activeAccounts.length} accounts`}
            </span>
          </div>
        )}

        {/* ── Loading ── */}
        {d.loading && (
          <div className="flex flex-col items-center justify-center gap-4 py-32">
            <div className="w-12 h-12 rounded-full border-2 border-obs-edge border-t-obs-accent animate-spin" />
            <span className="text-[14px] text-obs-dim">Loading portfolio...</span>
          </div>
        )}

        {/* ── Error ── */}
        {d.error && (
          <div className="bg-tier-critical-bg border border-tier-critical/20 rounded-xl px-4 py-3 text-[14px] text-tier-critical">
            {d.error}
          </div>
        )}

        {/* ── Empty state ── */}
        {!d.loading && !d.error && d.accounts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-32">
            <div className="w-16 h-16 rounded-2xl bg-obs-raised border border-obs-edge flex items-center justify-center mb-5">
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                <circle cx="14" cy="14" r="10" stroke="#7C6AFF" strokeWidth="1.5" strokeDasharray="4 3" />
                <circle cx="14" cy="14" r="4" fill="#7C6AFF" opacity="0.4" />
              </svg>
            </div>
            <p className="text-[16px] font-semibold text-obs-bright mb-1">No accounts yet</p>
            <p className="text-[14px] text-obs-dim mb-6">Run a sync to pull active clients.</p>
            {!d.isCSM && (
              <button
                onClick={d.handleSync}
                disabled={d.syncing}
                className="px-5 py-2 bg-obs-accent hover:bg-obs-glow disabled:opacity-50 text-white text-[14px] font-medium rounded-lg transition-all shadow-glow-sm hover:shadow-glow"
              >
                {d.syncing ? 'Syncing...' : 'Sync Now'}
              </button>
            )}
          </div>
        )}

        {/* ── Table ── */}
        {!d.loading && !d.error && d.activeAccounts.length > 0 && (
          <div className="bg-obs-raised border border-obs-edge rounded-xl overflow-hidden shadow-card">
            {d.filtered.length === 0 ? (
              <div className="py-16 text-center text-[14px] text-obs-ghost">
                No accounts match the current filters.{' '}
                <button
                  onClick={() => { d.setSearch(''); d.setFilterTier('all'); d.setFilterOwner('all'); }}
                  className="text-obs-accent hover:text-obs-glow"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[14px]">
                  <thead>
                    <tr className="bg-obs-card/50 border-b border-obs-edge">
                      {d.canManage && <th className="px-2 py-3 w-8" />}
                      <SortTH sortCol={d.sortCol} sortDir={d.sortDir} onSort={d.handleSortClick} col="accountName">Account</SortTH>
                      <SortTH sortCol={d.sortCol} sortDir={d.sortDir} onSort={d.handleSortClick} col="csmName">Owner</SortTH>
                      <SortTH sortCol={d.sortCol} sortDir={d.sortDir} onSort={d.handleSortClick} col="tier">Health</SortTH>
                      <SortTH sortCol={d.sortCol} sortDir={d.sortDir} onSort={d.handleSortClick} col="score">Score</SortTH>
                      <SortTH sortCol={d.sortCol} sortDir={d.sortDir} onSort={d.handleSortClick} col="amplitudeAlias">Alias</SortTH>
                      <SortTH sortCol={d.sortCol} sortDir={d.sortDir} onSort={d.handleSortClick} col="licenses">Licences</SortTH>
                      <SortTH sortCol={d.sortCol} sortDir={d.sortDir} onSort={d.handleSortClick} col="arr">ARR</SortTH>
                      <SortTH sortCol={d.sortCol} sortDir={d.sortDir} onSort={d.handleSortClick} col="renewalDate">Renewal</SortTH>
                    </tr>
                  </thead>
                  <tbody>
                    {d.filtered.map(account => {
                      const r = renewalInfo(account.renewalDate);
                      const isActive = d.selected?.accountId === account.accountId;
                      const tierColor = TIER_CFG[account.tier ?? 'unmapped'].color;
                      return (
                        <tr
                          key={account.accountId}
                          onClick={() => d.setSelected(isActive ? null : account)}
                          className={`cursor-pointer transition-colors border-b border-obs-edge/50 ${
                            isActive ? 'bg-obs-accent/8' : 'row-hover'
                          } ${account.hidden ? 'opacity-40' : ''}`}
                        >
                          {d.canManage && (
                            <td className="px-2 py-3 w-8" onClick={e => e.stopPropagation()}>
                              <button
                                onClick={() => d.handleToggleHidden(account.accountId, account.hidden)}
                                className={`transition-opacity ${account.hidden ? 'opacity-50 hover:opacity-80' : 'opacity-20 hover:opacity-50'}`}
                                title={account.hidden ? 'Unhide account' : 'Hide account'}
                              >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  {account.hidden ? (
                                    <>
                                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                                      <line x1="1" y1="1" x2="23" y2="23" />
                                    </>
                                  ) : (
                                    <>
                                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                      <circle cx="12" cy="12" r="3" />
                                    </>
                                  )}
                                </svg>
                              </button>
                            </td>
                          )}
                          {/* Account name + tier bar */}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <span className="w-1 h-6 rounded-full flex-shrink-0" style={{ background: tierColor }} />
                              <span className="font-medium text-obs-bright text-[14px]">{account.accountName}</span>
                            </div>
                          </td>

                          {/* Owner */}
                          <td className="px-4 py-3 text-obs-dim text-[14px]">{account.csmName || '—'}</td>

                          {/* Tier badge */}
                          <td className="px-4 py-3">
                            <TierBadge tier={account.tier ?? 'unmapped'} />
                          </td>

                          {/* Score */}
                          <td className="px-4 py-3">
                            {account.score !== null ? (
                              <span className="font-semibold font-mono text-obs-bright text-[14px]">
                                {account.score}
                                {account.scoreDelta !== null && account.scoreDelta !== 0 && (
                                  <span className={`ml-1.5 text-[14px] font-semibold ${
                                    account.scoreDelta > 0 ? 'text-tier-healthy' : 'text-tier-critical'
                                  }`}>
                                    {account.scoreDelta > 0 ? `+${account.scoreDelta}` : account.scoreDelta}
                                  </span>
                                )}
                              </span>
                            ) : (
                              <span className="text-obs-ghost text-[14px]">—</span>
                            )}
                          </td>

                          {/* Amplitude Alias (inline editable by all roles) */}
                          <td
                            className="px-4 py-3"
                            onClick={e => {
                              e.stopPropagation();
                              d.setEditingAlias(account.accountId);
                              d.setAliasInput(account.amplitudeAlias ?? '');
                            }}
                          >
                            {d.editingAlias === account.accountId ? (
                              <input
                                type="text"
                                autoFocus
                                value={d.aliasInput}
                                onChange={e => d.setAliasInput(e.target.value)}
                                onBlur={() => d.saveAlias(account)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') d.saveAlias(account);
                                  if (e.key === 'Escape') d.setEditingAlias(null);
                                }}
                                placeholder="e.g. acme-corp"
                                className="w-32 text-[14px] font-mono px-2 py-0.5 bg-obs-card border border-obs-accent rounded focus:outline-none text-obs-bright placeholder-obs-ghost"
                              />
                            ) : (
                              <span
                                className={`text-[14px] font-mono ${
                                  account.amplitudeAlias
                                    ? account.aliasStatus === 'not-found'
                                      ? 'text-tier-watch'
                                      : 'text-obs-text hover:text-obs-accent'
                                    : 'text-tier-watch italic'
                                } transition-colors`}
                                title={account.aliasStatus === 'not-found' ? 'Alias not found in Amplitude \u2014 check casing or wait for first activity' : undefined}
                              >
                                {account.amplitudeAlias || 'Set alias'}
                                {account.aliasStatus === 'not-found' && (
                                  <span className="ml-1 text-[11px]" title="Alias not found in Amplitude">{'\u26A0'}</span>
                                )}
                              </span>
                            )}
                          </td>

                          {/* Licences (inline editable, read-only for CSMs) */}
                          <td
                            className="px-4 py-3"
                            onClick={e => {
                              if (d.isCSM) return;
                              e.stopPropagation();
                              d.setEditingLicenses(account.accountId);
                              d.setLicensesInput(account.licenses !== null ? String(account.licenses) : '');
                            }}
                          >
                            {d.editingLicenses === account.accountId ? (
                              <input
                                type="number"
                                min="0"
                                autoFocus
                                value={d.licensesInput}
                                onChange={e => d.setLicensesInput(e.target.value)}
                                onBlur={() => d.saveLicenses(account.accountId)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') d.saveLicenses(account.accountId);
                                  if (e.key === 'Escape') d.setEditingLicenses(null);
                                }}
                                className="w-16 text-[14px] font-mono px-2 py-0.5 bg-obs-card border border-obs-accent rounded focus:outline-none text-obs-bright"
                              />
                            ) : (
                              <span className={`text-[14px] font-mono ${
                                account.licenses !== null ? 'text-obs-text' : 'text-obs-ghost italic'
                              }`}>
                                {account.licenses !== null ? account.licenses : 'Set'}
                              </span>
                            )}
                          </td>

                          {/* ARR (inline editable, read-only for CSMs) */}
                          <td
                            className="px-4 py-3 text-[14px] font-mono text-obs-bright text-right"
                            onClick={e => {
                              if (d.isCSM) return;
                              e.stopPropagation();
                              d.setEditingArr(account.accountId);
                              d.setArrInput(String(account.arr || ''));
                            }}
                          >
                            {d.editingArr === account.accountId ? (
                              <input
                                autoFocus
                                className="w-20 bg-obs-elevated border border-obs-accent rounded px-2 py-0.5 text-[14px] font-mono text-obs-bright text-right outline-none"
                                value={d.arrInput}
                                onChange={e => d.setArrInput(e.target.value)}
                                onBlur={() => d.saveArr(account.accountId)}
                                onKeyDown={e => { if (e.key === 'Enter') d.saveArr(account.accountId); if (e.key === 'Escape') d.setEditingArr(null); }}
                              />
                            ) : (
                              <span
                                className="cursor-pointer hover:text-obs-accent transition-colors"
                                title="Click to edit ARR"
                              >
                                {d.formatArr(account.arr)}
                              </span>
                            )}
                          </td>

                          {/* Renewal */}
                          <td className="px-4 py-3">
                            <span className="text-[14px] font-medium font-mono" style={{ color: RENEWAL_COLOURS[r.urgency] }}>
                              {r.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>

      {/* ── Detail panel ── */}
      {d.selected && (
        <DetailPanel
          summary={d.selected}
          onClose={() => d.setSelected(null)}
          onScoreRefreshed={(accountId, score, tier) => {
            d.setAccounts(prev => prev.map(a =>
              a.accountId === accountId ? { ...a, score, tier: tier as any } : a
            ));
            d.setSelected(prev => prev && prev.accountId === accountId ? { ...prev, score, tier: tier as any } : prev);
          }}
        />
      )}
    </div>
  );
}
