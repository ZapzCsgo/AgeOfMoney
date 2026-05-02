'use client';

/**
 * Operational cashflow ledger — paginated list of every Transaction with
 * inline filters + CSV export.
 *
 * No caching on the backend for this endpoint — new transactions show up
 * on the next fetch. Polling + window-focus refetch is inherited from
 * useFinanceFetch, so leaving the tab open keeps the view fresh.
 *
 * The CSV download bypasses the JSON endpoint and hits /cashflow/export
 * directly. We build the URL with the current filters + the backend API
 * origin + the JWT in the Authorization header via fetch().
 */

import { useEffect, useMemo, useState } from 'react';
import { Download, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { useFinanceFetch } from '../_hooks/useFinanceFetch';
import { InfoTooltip } from './InfoTooltip';
import type { RangePreset } from './DateRangePicker';

// ─── Types ──────────────────────────────────────────────────────────────────

const CASHFLOW_TYPES = ['all', 'deposit', 'withdrawal', 'bet_win', 'bet_loss', 'refund', 'bonus'] as const;
const CASHFLOW_STATUSES = ['all', 'pending', 'completed', 'failed'] as const;

type CashflowType = typeof CASHFLOW_TYPES[number];
type CashflowStatus = typeof CASHFLOW_STATUSES[number];

export interface CashflowRow {
  id: string;
  userId: string;
  username: string;
  avatar: string | null;
  type: string;
  amount: number;
  realAmountCents: number | null;
  coins: number;
  status: string;
  stripeSessionId: string | null;
  affiliateCodeId: string | null;
  createdAt: string;
}

export interface CashflowResponse {
  generatedAt: string;
  range: { label: RangePreset; from: string; to: string };
  page: number;
  limit: number;
  total: number;
  rows: CashflowRow[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const TYPE_LABEL: Record<string, string> = {
  deposit:    'Dépôt',
  withdrawal: 'Retrait',
  bet_win:    'Bet gagné',
  bet_loss:   'Bet perdu',
  refund:     'Remboursement',
  bonus:      'Bonus',
};

const TYPE_COLOR: Record<string, string> = {
  deposit:    '#10b981',
  withdrawal: '#ef4444',
  bet_win:    '#ffd97a',
  bet_loss:   '#6b7280',
  refund:     '#818cf8',
  bonus:      '#a78bfa',
};

const STATUS_COLOR: Record<string, { bg: string; color: string; border: string }> = {
  completed: { bg: 'rgba(16,185,129,0.1)',  color: '#10b981', border: 'rgba(16,185,129,0.3)' },
  pending:   { bg: 'rgba(255,197,66,0.1)',  color: '#ffd97a', border: 'rgba(255,197,66,0.3)' },
  failed:    { bg: 'rgba(239,68,68,0.1)',   color: '#ef4444', border: 'rgba(239,68,68,0.3)' },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatCents(c: number | null): string {
  if (c == null) return '—';
  return (c / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Section ────────────────────────────────────────────────────────────────

export function CashflowSection({
  range,
  ready,
}: {
  range: RangePreset;
  ready: boolean;
}) {
  const [type, setType] = useState<CashflowType>('all');
  const [status, setStatus] = useState<CashflowStatus>('all');
  const [searchInput, setSearchInput] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [downloading, setDownloading] = useState(false);

  // Debounce the search input — don't refetch on every keystroke
  useEffect(() => {
    const id = setTimeout(() => setSearchDebounced(searchInput.trim()), 350);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Reset pagination whenever any filter changes
  useEffect(() => {
    setPage(1);
  }, [range, type, status, searchDebounced]);

  const query = useMemo(() => ({
    range,
    type,
    status,
    search: searchDebounced,
    page: String(page),
    limit: '50',
  }), [range, type, status, searchDebounced, page]);

  const { data, loading, error } = useFinanceFetch<CashflowResponse>('/admin/finance/cashflow', query, { enabled: ready });

  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / 50));
  const rangeFrom = (page - 1) * 50 + 1;
  const rangeTo   = Math.min(page * 50, total);

  async function handleExport() {
    setDownloading(true);
    try {
      const { apiClient } = await import('@/lib/api');
      const params = new URLSearchParams();
      params.set('range', range);
      if (type !== 'all')   params.set('type', type);
      if (status !== 'all') params.set('status', status);
      if (searchDebounced)  params.set('search', searchDebounced);
      const res = await apiClient.get(`/admin/finance/cashflow/export?${params.toString()}`, {
        responseType: 'blob',
      });
      // Trigger download. The backend sets Content-Disposition so browsers
      // already know the filename, but we hint it here too for older engines.
      const stamp = new Date().toISOString().slice(0, 10);
      const blob = new Blob([res.data as BlobPart], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ageofmoney_finance_cashflow_${range}_${stamp}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[Cashflow] export failed:', err);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <section
      className="rounded-2xl p-5 mt-8"
      style={{ background: '#0e0d1a', border: '1px solid #1e1a30' }}
    >
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <h2
            className="text-[14px] font-bold tracking-widest uppercase"
            style={{ fontFamily: 'Cinzel, serif', color: '#e8e2f5' }}
          >
            Cashflow
          </h2>
          <InfoTooltip content="Chaque Transaction enregistrée : dépôts, retraits, gains, pertes, bonus, affiliate payouts. Pas de cache — la liste reflète la DB en temps quasi-réel." />
        </div>
        <button
          onClick={handleExport}
          disabled={downloading || !data}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold tracking-wider uppercase transition-opacity hover:opacity-80 disabled:opacity-50"
          style={{ background: '#13111f', border: '1px solid #2a2640', color: '#9990b8' }}
        >
          <Download size={12} />
          {downloading ? 'Export…' : 'Export CSV'}
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        {/* Type */}
        <select
          value={type}
          onChange={(e) => setType(e.target.value as CashflowType)}
          className="px-3 py-1.5 rounded-lg text-[11px] font-bold tracking-wider uppercase transition-colors"
          style={{ background: '#13111f', border: '1px solid #2a2640', color: '#e5e5e5' }}
        >
          {CASHFLOW_TYPES.map((t) => (
            <option key={t} value={t}>
              {t === 'all' ? 'Tous types' : (TYPE_LABEL[t] ?? t)}
            </option>
          ))}
        </select>

        {/* Status */}
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as CashflowStatus)}
          className="px-3 py-1.5 rounded-lg text-[11px] font-bold tracking-wider uppercase transition-colors"
          style={{ background: '#13111f', border: '1px solid #2a2640', color: '#e5e5e5' }}
        >
          {CASHFLOW_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === 'all' ? 'Tous statuts' : s}
            </option>
          ))}
        </select>

        {/* Search */}
        <div className="relative flex-1 min-w-[180px] max-w-[280px]">
          <Search
            size={12}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: '#6b6488' }}
          />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Username…"
            className="w-full pl-7 pr-3 py-1.5 rounded-lg text-[11px] transition-colors outline-none"
            style={{ background: '#13111f', border: '1px solid #2a2640', color: '#e5e5e5' }}
          />
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div
          className="mb-3 rounded-lg px-3 py-2 text-[11px]"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5' }}
        >
          {error}
        </div>
      )}

      {/* Table */}
      {loading && !data ? (
        <div className="h-60 rounded-lg animate-pulse" style={{ background: 'rgba(255,255,255,0.02)' }} />
      ) : !data || data.rows.length === 0 ? (
        <div className="text-center py-12 text-[12px]" style={{ color: '#6b6488' }}>
          Aucune transaction sur cette période avec ces filtres.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] min-w-[620px]" cellPadding={0} cellSpacing={0}>
            <thead>
              <tr style={{ color: '#6b6488' }}>
                <th className="text-left py-2 px-2 font-bold tracking-wider uppercase text-[10px]">Date</th>
                <th className="text-left py-2 px-2 font-bold tracking-wider uppercase text-[10px]">User</th>
                <th className="text-left py-2 px-2 font-bold tracking-wider uppercase text-[10px]">Type</th>
                <th className="text-right py-2 px-2 font-bold tracking-wider uppercase text-[10px]">Coins</th>
                <th className="text-right py-2 px-2 font-bold tracking-wider uppercase text-[10px] hidden md:table-cell">EUR</th>
                <th className="text-left py-2 px-2 font-bold tracking-wider uppercase text-[10px]">Status</th>
                <th className="text-left py-2 px-2 font-bold tracking-wider uppercase text-[10px] hidden lg:table-cell">Ref</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const typeColor = TYPE_COLOR[r.type] ?? '#9990b8';
                const statusStyle = STATUS_COLOR[r.status] ?? { bg: 'rgba(107,100,136,0.15)', color: '#9990b8', border: 'transparent' };
                const ref = r.stripeSessionId ?? r.affiliateCodeId ?? '';
                const coinsSign = (r.type === 'withdrawal' || r.type === 'bet_loss') ? '-' : '+';
                return (
                  <tr
                    key={r.id}
                    className="transition-colors"
                    style={{ borderTop: '1px solid #1a1730' }}
                    onMouseEnter={(e) => ((e.currentTarget.style.background = 'rgba(255,255,255,0.02)'))}
                    onMouseLeave={(e) => ((e.currentTarget.style.background = 'transparent'))}
                  >
                    <td className="py-2 px-2 font-mono whitespace-nowrap" style={{ color: '#9990b8' }}>
                      {formatDate(r.createdAt)}
                    </td>
                    <td className="py-2 px-2">
                      <span className="inline-flex items-center gap-1.5">
                        {r.avatar
                          ? <img src={r.avatar} alt={r.username} className="w-5 h-5 rounded-full" />
                          : <span className="w-5 h-5 rounded-full inline-flex items-center justify-center text-[9px] font-bold" style={{ background: '#1a1730', color: '#c8c0e0' }}>{r.username.slice(0, 2).toUpperCase()}</span>
                        }
                        <span className="truncate max-w-[120px]" style={{ color: '#e5e5e5' }}>{r.username}</span>
                      </span>
                    </td>
                    <td className="py-2 px-2">
                      <span
                        className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider"
                        style={{ background: `${typeColor}18`, color: typeColor, border: `1px solid ${typeColor}40` }}
                      >
                        {TYPE_LABEL[r.type] ?? r.type}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-right font-mono font-bold" style={{ color: typeColor }}>
                      {coinsSign}{r.coins.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                    </td>
                    <td className="py-2 px-2 text-right font-mono hidden md:table-cell" style={{ color: '#c8c0e0' }}>
                      {r.realAmountCents != null ? `${formatCents(r.realAmountCents)} €` : '—'}
                    </td>
                    <td className="py-2 px-2">
                      <span
                        className="inline-block px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider"
                        style={{ background: statusStyle.bg, color: statusStyle.color, border: `1px solid ${statusStyle.border}` }}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="py-2 px-2 font-mono hidden lg:table-cell truncate max-w-[160px]" style={{ color: '#6b6488' }}>
                      {ref || '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {data && data.rows.length > 0 && (
        <div className="flex items-center justify-between mt-3 text-[11px]" style={{ color: '#9990b8' }}>
          <div>
            {rangeFrom}–{rangeTo} sur {total.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-1 rounded hover:opacity-80 transition-opacity disabled:opacity-30"
              style={{ background: '#13111f', border: '1px solid #2a2640' }}
              aria-label="previous page"
            >
              <ChevronLeft size={12} />
            </button>
            <span className="px-2">
              {page} / {lastPage}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
              disabled={page >= lastPage}
              className="p-1 rounded hover:opacity-80 transition-opacity disabled:opacity-30"
              style={{ background: '#13111f', border: '1px solid #2a2640' }}
              aria-label="next page"
            >
              <ChevronRight size={12} />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
