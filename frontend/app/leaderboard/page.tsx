'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Trophy, Medal } from 'lucide-react';
import { getLeaderboard } from '@/lib/api';
import { LeaderboardEntry } from '@/types';
import { computeLevel, levelTier } from '@/lib/level';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

function avatarColor(name: string): string {
  const colors = ['#7c3aed','#0891b2','#b45309','#047857','#be185d','#1d4ed8'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % colors.length;
  return colors[h];
}

function tierColor(tier: string): string {
  switch (tier) {
    case 'legend':   return '#a855f7';
    case 'diamond':  return '#06b6d4';
    case 'platinum': return '#38bdf8';
    case 'gold':     return '#d4a017';
    case 'silver':   return '#94a3b8';
    default:         return '#78716c';
  }
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return (
    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg, #d4a017, #f5c842)', boxShadow: '0 0 12px #d4a01755' }}>
      <Trophy size={14} style={{ color: '#07060f' }} />
    </div>
  );
  if (rank === 2) return (
    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg, #94a3b8, #cbd5e1)' }}>
      <Medal size={14} style={{ color: '#07060f' }} />
    </div>
  );
  if (rank === 3) return (
    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg, #b45309, #d97706)' }}>
      <Medal size={14} style={{ color: '#07060f' }} />
    </div>
  );
  return (
    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-[12px] font-bold tabular-nums" style={{ background: '#13111f', border: '1px solid #1e1a30', color: '#6b6488' }}>
      {rank}
    </div>
  );
}

export default function LeaderboardPage() {
  const { data: session } = useSession();
  const { t } = useT();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getLeaderboard()
      .then(res => setEntries(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const myRank = session?.user?.id
    ? entries.findIndex(e => e.id === session.user.id) + 1
    : 0;

  return (
    <div className="min-h-screen px-4 py-10" style={{ background: '#07060f' }}>
      <div className="max-w-2xl mx-auto">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-4 text-[11px] font-medium uppercase tracking-widest"
            style={{ background: '#d4a01715', border: '1px solid #d4a01730', color: '#d4a017' }}>
            <Trophy size={11} /> {t('lb_title')}
          </div>
          <h1 className="text-[28px] font-bold mb-1" style={{ color: '#e8e2f5', fontFamily: 'Cinzel, serif' }}>
            {t('lb_top_bettors')}
          </h1>
          <p className="text-[13px]" style={{ color: '#6b6488' }}>
            {t('lb_sorted_by')}
          </p>
        </div>

        {/* My rank banner */}
        {myRank > 0 && (
          <div className="rounded-xl px-4 py-3 mb-5 flex items-center justify-between"
            style={{ background: '#d4a01710', border: '1px solid #d4a01730' }}>
            <span className="text-[12px]" style={{ color: '#9990b8' }}>{t('lb_rank')}</span>
            <span className="text-[14px] font-bold" style={{ color: '#d4a017' }}>#{myRank}</span>
          </div>
        )}

        {/* Table */}
        <div className="rounded-2xl overflow-hidden" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
          {loading ? (
            <div className="py-16 text-center text-[13px]" style={{ color: '#6b6488' }}>{t('common_loading')}</div>
          ) : entries.length === 0 ? (
            <div className="py-16 text-center text-[13px]" style={{ color: '#6b6488' }}>{t('lb_empty')}</div>
          ) : (
            <div>
              {entries.map((entry, i) => {
                const rank = i + 1;
                const level = computeLevel(entry.totalWagered);
                const tier  = levelTier(level);
                const color = tierColor(tier);
                const isMe  = entry.id === session?.user?.id;
                const bg    = avatarColor(entry.username);

                return (
                  <div
                    key={entry.id}
                    className={cn(
                      'flex items-center gap-4 px-5 py-4 transition-colors',
                      isMe ? 'bg-[#d4a017]/5' : 'hover:bg-[#13111f]'
                    )}
                    style={{ borderBottom: '1px solid #1e1a3022' }}
                  >
                    {/* Rank */}
                    <RankBadge rank={rank} />

                    {/* Avatar */}
                    <div className="relative shrink-0">
                      <div className="w-9 h-9 rounded-full overflow-hidden flex items-center justify-center text-[11px] font-bold text-white"
                        style={{ background: entry.avatar ? 'transparent' : bg, border: `2px solid ${color}55` }}>
                        {entry.avatar
                          ? <img src={entry.avatar} alt={entry.username} className="w-full h-full object-cover" />
                          : entry.username.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="absolute -bottom-1 -right-1 text-[8px] font-black rounded-full flex items-center justify-center"
                        style={{ background: color, color: '#07060f', width: 15, height: 15, lineHeight: 1 }}>
                        {level}
                      </div>
                    </div>

                    {/* Name */}
                    <div className="flex-1 min-w-0">
                      <p className={cn('text-[13px] font-bold truncate', isMe ? 'text-[#d4a017]' : 'text-[#e8e2f5]')}>
                        {entry.username}
                        {isMe && <span className="ml-2 text-[10px] font-normal text-[#d4a017]/60">{t('lb_you_short')}</span>}
                      </p>
                      <p className="text-[11px]" style={{ color: '#6b6488' }}>
                        {entry._count?.bets ?? 0} {t('lb_bets').toLowerCase()}
                      </p>
                    </div>

                    {/* Volume */}
                    <div className="text-right shrink-0">
                      <p className="text-[13px] font-bold tabular-nums" style={{ color: '#d4a017' }}>
                        {new Intl.NumberFormat('fr-FR').format(entry.totalWagered)} ⚜
                      </p>
                      <p className="text-[10px]" style={{ color: '#6b6488' }}>{t('lb_wagered')}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
