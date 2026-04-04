'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Bet, BetStatus } from '@/types';
import { formatDateTime, getBetStatusLabel, cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

interface BetHistoryProps {
  bets: Bet[];
  total: number;
  onPageChange?: (offset: number) => void;
  onStatusFilter?: (status: string | null) => void;
  loading?: boolean;
}

const PAGE_SIZE = 10;

function StatusBadge({ status }: { status: BetStatus }) {
  const { t } = useT();
  const configs: Record<BetStatus, { label: string; className: string }> = {
    WON:       { label: t('common_won'),       className: 'bg-emerald-900/20 border-emerald-800/50 text-emerald-400' },
    LOST:      { label: t('common_lost'),      className: 'bg-red-900/20 border-red-800/50 text-red-400' },
    PENDING:   { label: t('common_pending'),   className: 'bg-amber-900/20 border-amber-800/50 text-amber-400' },
    REFUNDED:  { label: t('common_refunded'),  className: 'bg-gray-800/50 border-gray-700/50 text-gray-400' },
    CANCELLED: { label: t('common_cancelled'), className: 'bg-gray-900/50 border-gray-800/50 text-gray-500' },
  };
  const cfg = configs[status];
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold font-cinzel tracking-wider border',
      cfg.className
    )}>
      {cfg.label}
    </span>
  );
}

export function BetHistory({ bets, total, onPageChange, onStatusFilter, loading = false }: BetHistoryProps) {
  const { t } = useT();
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [currentPage, setCurrentPage] = useState(0);

  const STATUS_OPTIONS = [
    { value: '',          label: t('profile_history_filter_all') },
    { value: 'PENDING',  label: t('profile_history_pending') },
    { value: 'WON',      label: t('profile_history_won') },
    { value: 'LOST',     label: t('profile_history_lost') },
    { value: 'REFUNDED', label: t('common_refunded') },
  ];

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const handleStatusChange = (status: string) => {
    setStatusFilter(status);
    setCurrentPage(0);
    onStatusFilter?.(status || null);
    onPageChange?.(0);
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    onPageChange?.(page * PAGE_SIZE);
  };

  if (loading) {
    return (
      <div className="aoe-card p-6 text-center">
        <div className="w-8 h-8 border-2 border-aoe-gold border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    );
  }

  return (
    <div className="aoe-card overflow-hidden">
      {/* Filter bar */}
      <div className="flex items-center gap-2 p-4 border-b border-aoe-border overflow-x-auto">
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => handleStatusChange(opt.value)}
            className={cn(
              'px-3 py-1.5 rounded text-xs font-cinzel tracking-wide border transition-all whitespace-nowrap',
              statusFilter === opt.value
                ? 'border-aoe-gold text-aoe-gold bg-aoe-gold/10'
                : 'border-aoe-border text-aoe-parchment-dim hover:border-aoe-border-gold hover:text-aoe-parchment'
            )}
          >
            {opt.label}
          </button>
        ))}
        <span className="ml-auto text-aoe-parchment-muted text-xs whitespace-nowrap">
          {total} {t('lb_bets').toLowerCase()}
        </span>
      </div>

      {/* Table */}
      {bets.length === 0 ? (
        <div className="p-10 text-center">
          <p className="text-aoe-parchment-muted font-cinzel">{t('profile_no_history')}</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-aoe-border">
                  {[t('history_col_match'), t('history_col_player'), t('history_col_amount'), t('history_col_odds'), t('history_col_status'), t('history_col_profit')].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-aoe-parchment-muted text-xs font-cinzel uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bets.map((bet, i) => {
                  const selectedName = bet.selectedPlayer === 1
                    ? bet.match.player1.name
                    : bet.match.player2.name;
                  const payout = bet.payout ?? 0;
                  const profit = payout - bet.amount;

                  return (
                    <tr
                      key={bet.id}
                      className={cn(
                        'border-b border-aoe-border/50 transition-colors hover:bg-aoe-stone/30',
                        i % 2 === 0 ? 'bg-aoe-stone/10' : ''
                      )}
                    >
                      <td className="px-4 py-3">
                        <Link href={`/matches/${bet.matchId}`} className="hover:text-aoe-gold transition-colors">
                          <p className="text-aoe-parchment text-xs font-semibold">
                            {bet.match.player1.name} vs {bet.match.player2.name}
                          </p>
                          <p className="text-aoe-parchment-muted text-[10px] mt-0.5">
                            {formatDateTime(bet.createdAt)}
                            {bet.match.tournament && ` · ${bet.match.tournament.name}`}
                          </p>
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-aoe-parchment text-xs">{selectedName}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-aoe-gold font-cinzel font-semibold text-xs">
                          {new Intl.NumberFormat('fr-FR').format(bet.amount)} ⚜
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-aoe-parchment-dim text-xs font-cinzel">
                          × {bet.oddsAtBet.toFixed(2)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={bet.status} />
                      </td>
                      <td className="px-4 py-3">
                        {bet.status === 'WON' && (
                          <span className="text-emerald-400 font-cinzel font-bold text-xs">
                            +{new Intl.NumberFormat('fr-FR').format(profit)} ⚜
                          </span>
                        )}
                        {bet.status === 'LOST' && (
                          <span className="text-red-400 font-cinzel font-bold text-xs">
                            -{new Intl.NumberFormat('fr-FR').format(bet.amount)} ⚜
                          </span>
                        )}
                        {bet.status === 'REFUNDED' && (
                          <span className="text-gray-400 text-xs">
                            +{new Intl.NumberFormat('fr-FR').format(bet.amount)} ⚜
                          </span>
                        )}
                        {bet.status === 'PENDING' && (
                          <span className="text-amber-400 text-xs"></span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 p-4 border-t border-aoe-border">
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 0}
                className="px-3 py-1.5 rounded border border-aoe-border text-aoe-parchment-dim text-xs font-cinzel hover:border-aoe-border-gold hover:text-aoe-parchment disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                ← Préc.
              </button>
              {[...Array(Math.min(totalPages, 7))].map((_, i) => {
                const page = i;
                return (
                  <button
                    key={page}
                    onClick={() => handlePageChange(page)}
                    className={cn(
                      'w-8 h-8 rounded border text-xs font-cinzel transition-all',
                      currentPage === page
                        ? 'border-aoe-gold text-aoe-gold bg-aoe-gold/10'
                        : 'border-aoe-border text-aoe-parchment-dim hover:border-aoe-border-gold'
                    )}
                  >
                    {page + 1}
                  </button>
                );
              })}
              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage >= totalPages - 1}
                className="px-3 py-1.5 rounded border border-aoe-border text-aoe-parchment-dim text-xs font-cinzel hover:border-aoe-border-gold hover:text-aoe-parchment disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                Suiv. →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
