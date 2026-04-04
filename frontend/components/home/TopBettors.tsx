import Link from 'next/link';
import Image from 'next/image';
import { Trophy } from 'lucide-react';
import { LeaderboardEntry } from '@/types';

interface TopBettorsProps {
  users: LeaderboardEntry[];
}

const rankColors: Record<number, string> = {
  1: 'text-aoe-gold-bright',
  2: 'text-gray-300',
  3: 'text-amber-600',
};

const rankIcons: Record<number, string> = {
  1: '👑',
  2: '🥈',
  3: '🥉',
};

export function TopBettors({ users }: TopBettorsProps) {
  return (
    <div className="aoe-card-decorated p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Trophy size={16} className="text-aoe-gold" />
          <h3 className="font-cinzel font-bold text-sm text-aoe-gold tracking-wider">TOP PARIEURS</h3>
        </div>
        <Link
          href="/profile?tab=leaderboard"
          className="text-aoe-parchment-dim text-xs hover:text-aoe-gold transition-colors font-cinzel"
        >
          Voir tout →
        </Link>
      </div>

      {/* Leaderboard list */}
      <div className="space-y-1">
        {users.slice(0, 10).map((user, index) => {
          const rank = index + 1;
          return (
            <div
              key={user.id}
              className="flex items-center gap-3 px-2 py-2 rounded hover:bg-aoe-stone/50 transition-colors group"
            >
              {/* Rank */}
              <div className="w-7 text-center flex-shrink-0">
                {rank <= 3 ? (
                  <span className="text-base">{rankIcons[rank]}</span>
                ) : (
                  <span className="font-cinzel font-bold text-xs text-aoe-parchment-muted">
                    #{rank}
                  </span>
                )}
              </div>

              {/* Avatar */}
              <div className="w-7 h-7 rounded-full bg-aoe-stone border border-aoe-border flex-shrink-0 overflow-hidden">
                {user.avatar ? (
                  <Image
                    src={user.avatar}
                    alt={user.username}
                    width={28}
                    height={28}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs font-bold text-aoe-parchment-dim">
                    {user.username.substring(0, 2).toUpperCase()}
                  </div>
                )}
              </div>

              {/* Username */}
              <div className="flex-1 min-w-0">
                <p
                  className={`text-xs font-medium truncate group-hover:text-aoe-parchment transition-colors ${
                    rankColors[rank] ?? 'text-aoe-parchment-dim'
                  }`}
                >
                  {user.username}
                </p>
              </div>

              {/* Coins */}
              <div className="flex items-center gap-1 flex-shrink-0">
                <span className="text-aoe-gold text-xs">⚜</span>
                <span className="font-cinzel font-semibold text-xs text-aoe-gold">
                  {new Intl.NumberFormat('fr-FR').format(user.coins)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom link */}
      <div className="aoe-divider mt-3">
        <span>classement</span>
      </div>
      <Link
        href="/profile?tab=leaderboard"
        className="block text-center text-xs text-aoe-parchment-dim hover:text-aoe-gold transition-colors py-1 font-cinzel"
      >
        Voir le classement complet
      </Link>
    </div>
  );
}
