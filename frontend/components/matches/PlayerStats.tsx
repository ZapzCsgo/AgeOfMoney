'use client';

import { Player, RecentMatchResult } from '@/types';
import { getCountryFlag } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

interface PlayerStatsProps {
  player1: Player;
  player2: Player;
  recentForm1?: RecentMatchResult[];
  recentForm2?: RecentMatchResult[];
  h2h?: {
    total: number;
    player1Wins: number;
    player2Wins: number;
  };
  p1Score?: number;
  p2Score?: number;
  matchStatus?: string;
  winnerId?: string | null;
}

interface FormBadgeProps {
  playerId: string;
  match: RecentMatchResult;
}

function FormBadge({ playerId, match }: FormBadgeProps) {
  const won = match.winnerId === playerId;
  return (
    <span className={won ? 'form-w' : 'form-l'}>
      {won ? 'W' : 'L'}
    </span>
  );
}

function StatRow({ label, value1, value2, highlight }: {
  label: string;
  value1: React.ReactNode;
  value2: React.ReactNode;
  highlight?: 'left' | 'right' | 'none';
}) {
  return (
    <div className="flex items-center gap-2 py-2 border-b border-aoe-border/50 last:border-0">
      <div className={cn('flex-1 text-right text-sm', highlight === 'left' ? 'text-aoe-gold font-semibold' : 'text-aoe-parchment')}>
        {value1}
      </div>
      <div className="w-32 text-center text-xs text-aoe-parchment-muted font-cinzel uppercase tracking-wider flex-shrink-0">
        {label}
      </div>
      <div className={cn('flex-1 text-sm', highlight === 'right' ? 'text-aoe-gold font-semibold' : 'text-aoe-parchment')}>
        {value2}
      </div>
    </div>
  );
}

export function PlayerStats({ player1, player2, recentForm1 = [], recentForm2 = [], h2h, p1Score, p2Score, matchStatus, winnerId }: PlayerStatsProps) {
  const { t } = useT();
  const wrHighlight = player1.winrate > player2.winrate ? 'left' : player2.winrate > player1.winrate ? 'right' : 'none';

  return (
    <div className="aoe-card p-5 space-y-5">
      {/* H2H — only shown when match is upcoming (no live score yet) */}
      {matchStatus !== 'LIVE' && matchStatus !== 'COMPLETED' && h2h && h2h.total > 0 && (
        <>
          <div className="aoe-divider">
            <span>{t('head_to_head')}</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex-1 text-center">
              <div className="font-cinzel font-black text-3xl text-aoe-gold">{h2h.player1Wins}</div>
              <div className="text-aoe-parchment-dim text-xs mt-1">{player1.name}</div>
            </div>
            <div className="text-center">
              <div className="text-aoe-parchment-muted text-sm font-cinzel">{h2h.total} matchs</div>
            </div>
            <div className="flex-1 text-center">
              <div className="font-cinzel font-black text-3xl text-aoe-parchment">{h2h.player2Wins}</div>
              <div className="text-aoe-parchment-dim text-xs mt-1">{player2.name}</div>
            </div>
          </div>
          <div className="flex h-3 rounded-full overflow-hidden">
            <div className="bg-gradient-to-r from-aoe-gold-dark to-aoe-gold" style={{ width: `${(h2h.player1Wins / h2h.total) * 100}%` }} />
            <div className="bg-gradient-to-r from-aoe-stone to-aoe-stone-light flex-1" />
          </div>
        </>
      )}
    </div>
  );
}
