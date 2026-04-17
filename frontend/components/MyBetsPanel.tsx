'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Bet } from '@/types';
import { getMyBets, setAuthToken } from '@/lib/api';
import { Receipt, ChevronDown, ChevronUp, Loader2, Trophy, Clock, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useT } from '@/lib/i18n';

const STATUS_CONFIG = {
  PENDING: { tKey: 'bet_status_pending', color: 'text-amber-400', bg: 'bg-amber-400/10', border: 'border-amber-400/30', icon: Clock   },
  WON:     { tKey: 'bet_status_won',     color: 'text-green-400', bg: 'bg-green-400/10', border: 'border-green-400/30', icon: Trophy  },
  LOST:    { tKey: 'bet_status_lost',    color: 'text-red-400',   bg: 'bg-red-400/10',   border: 'border-red-400/30',   icon: XCircle },
} as const;

export function MyBetsPanel() {
  const { data: session } = useSession();
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [bets, setBets] = useState<Bet[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'PENDING' | 'all'>('PENDING');
  const { notifications } = useNotifications();

  const fetchBets = useCallback(async () => {
    if (!session?.user) return;
    if (session.user.accessToken) setAuthToken(session.user.accessToken);
    setLoading(true);
    try {
      const res = await getMyBets({ limit: 30 });
      setBets(res.data ?? []);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [session?.user]);

  useEffect(() => { if (open) fetchBets(); }, [open, fetchBets]);
  useEffect(() => { if (notifications.length > 0 && open) fetchBets(); }, [notifications.length, open, fetchBets]);

  if (!session?.user) return null;

  const pendingBets  = bets.filter(b => b.status === 'PENDING');
  const displayBets  = tab === 'PENDING' ? pendingBets : bets;
  const pendingCount = pendingBets.length;

  return (
    <div
      className="fixed z-[65] flex flex-col items-end pointer-events-none
        bottom-20 right-4
        md:bottom-4 md:right-4
        lg:right-[296px]"
    >
      {/* ── Floating panel — only this has pointer-events ─────────────────── */}
      {open && (
        <div
          className="pointer-events-auto mb-2 rounded-xl overflow-hidden shadow-2xl"
          style={{
            width: 360,
            maxHeight: 440,
            background: '#0d0b1a',
            border: '1px solid #1e1a30',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e1a30] shrink-0">
            <div className="flex items-center gap-2">
              <Receipt size={13} className="text-[#ffc542]" />
              <span className="font-cinzel font-bold text-[13px] text-[#ffc542]">{t('mybets_title')}</span>
              {pendingCount > 0 && (
                <span className="text-[10px] font-bold text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded-full px-2 py-0.5">
                  {pendingCount}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="flex rounded-lg overflow-hidden border border-[#1e1a30]">
                {(['PENDING', 'all'] as const).map(tabKey => (
                  <button key={tabKey} onClick={() => setTab(tabKey)}
                    className={cn('px-2.5 py-1 text-[10px] font-cinzel font-bold transition-colors',
                      tab === tabKey ? 'bg-[#ffc542] text-black' : 'text-[#6b6488] hover:text-[#e8e2f5]'
                    )}
                  >
                    {tabKey === 'PENDING' ? t('mybets_pending') : t('mybets_all')}
                  </button>
                ))}
              </div>
              <button onClick={() => setOpen(false)} className="text-[#6b6488] hover:text-[#e8e2f5] transition-colors">
                <ChevronDown size={16} />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="overflow-y-auto flex-1">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={20} className="animate-spin text-[#ffc542]" />
              </div>
            ) : displayBets.length === 0 ? (
              <div className="py-8 text-center text-[#6b6488] text-[12px]">
                {tab === 'PENDING' ? t('mybets_empty_pending') : t('mybets_empty')}
              </div>
            ) : (
              <div className="divide-y divide-[#13111f]">
                {displayBets.map(bet => {
                  const cfg = STATUS_CONFIG[bet.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.PENDING;
                  const StatusIcon = cfg.icon;
                  const statusLabel = t(cfg.tKey);
                  const betOnName   = bet.selectedPlayer === 1 ? bet.match?.player1?.name : bet.match?.player2?.name;
                  const opponentName = bet.selectedPlayer === 1 ? bet.match?.player2?.name : bet.match?.player1?.name;

                  return (
                    <Link key={bet.id} href={`/matches/${bet.matchId}`} onClick={() => setOpen(false)}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors"
                    >
                      <div className={cn('shrink-0 rounded-lg p-1.5', cfg.bg, `border ${cfg.border}`)}>
                        <StatusIcon size={12} className={cfg.color} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                          <span className="font-cinzel font-bold text-[12px] text-[#e8e2f5] truncate">{betOnName}</span>
                          <span className="text-[#4a4570] text-[10px] shrink-0">vs {opponentName}</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[10px] text-[#6b6488] truncate">{bet.match?.tournament?.name ?? t('mybets_tournament_fallback')}</span>
                          <span className={cn('text-[10px] font-semibold shrink-0', cfg.color)}>· {statusLabel}</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {bet.status === 'WON' ? (
                          <div className="text-[12px] font-bold text-green-400">+{(bet.payout ?? 0).toFixed(2)} ⚜</div>
                        ) : bet.status === 'LOST' ? (
                          <div className="text-[12px] font-bold text-red-400">-{bet.amount.toFixed(2)} ⚜</div>
                        ) : (
                          <div className="text-[12px] font-bold text-[#ffc542]">{(bet.amount * bet.oddsAtBet).toFixed(2)} ⚜</div>
                        )}
                        <div className="text-[10px] text-[#6b6488] mt-0.5">{bet.amount.toFixed(2)} × {bet.oddsAtBet.toFixed(2)}</div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Trigger button ─────────────────────────────────────────────────── */}
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          'pointer-events-auto flex items-center gap-2 rounded-full px-4 h-10 transition-all duration-200',
          'border font-cinzel font-bold text-[12px] shadow-xl',
          open
            ? 'bg-[#0d0b1a] border-[#ffc542] text-[#ffc542]'
            : 'bg-[#ffc542] border-[#ffc542] text-black hover:bg-[#ffd97a]'
        )}
        style={{ boxShadow: '0 4px 20px rgba(255,197,66,0.3)' }}
      >
        <Receipt size={13} />
        {t('mybets_title')}
        {pendingCount > 0 && (
          <span className={cn(
            'rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-black',
            open ? 'bg-[#ffc542] text-black' : 'bg-black/30 text-black'
          )}>
            {pendingCount}
          </span>
        )}
        {open ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
      </button>
    </div>
  );
}
