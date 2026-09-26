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
import { PodiumHero } from '@/components/leaderboard/PodiumHero';

/** Faint heraldic ornament behind the header — pure decoration, very low
 * opacity so it never competes with the title/podium above it. */
function HeaderOrnament() {
  return (
    <svg
      viewBox="0 0 400 120"
      className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 w-[420px] max-w-[140%] h-auto"
      style={{ opacity: 0.05 }}
      aria-hidden
    >
      <path d="M200 10 C170 30 150 55 150 85 C150 100 165 112 200 112 C235 112 250 100 250 85 C250 55 230 30 200 10Z" fill="none" stroke="#ffc542" strokeWidth="1.5" />
      {[...Array(5)].map((_, i) => (
        <g key={`l-${i}`}>
          <ellipse cx={130 - i * 18} cy={40 + i * 14} rx="14" ry="7" fill="none" stroke="#ffc542" strokeWidth="1.2" transform={`rotate(${-20 - i * 6} ${130 - i * 18} ${40 + i * 14})`} />
        </g>
      ))}
      {[...Array(5)].map((_, i) => (
        <g key={`r-${i}`}>
          <ellipse cx={270 + i * 18} cy={40 + i * 14} rx="14" ry="7" fill="none" stroke="#ffc542" strokeWidth="1.2" transform={`rotate(${20 + i * 6} ${270 + i * 18} ${40 + i * 14})`} />
        </g>
      ))}
    </svg>
  );
}

/** Small illustrated empty state (trophy + banner) — same title/description
 * copy as before, richer visual than a single lucide icon. */
function EmptyLeaderboardIllustration({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-20">
      <svg width="72" height="72" viewBox="0 0 48 48" fill="none" className="mb-5">
        <path d="M10 30 L4 44 L14 40 Z" fill="#ffc542" opacity="0.35" />
        <path d="M38 30 L44 44 L34 40 Z" fill="#ffc542" opacity="0.35" />
        <path d="M16 8h16v9a8 8 0 0 1-16 0V8z" stroke="#ffc542" strokeWidth="2" />
        <path d="M16 10h-4a4 4 0 0 0 0 8h2.5" stroke="#ffc542" strokeWidth="2" />
        <path d="M32 10h4a4 4 0 0 1 0 8h-2.5" stroke="#ffc542" strokeWidth="2" />
        <rect x="21" y="25" width="6" height="6" fill="#ffc542" />
        <rect x="15" y="31" width="18" height="4" rx="1" fill="#ffc542" />
      </svg>
      <p className="text-base font-semibold text-aoe-parchment tracking-tight">{title}</p>
    </div>
  );
}

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
    case 'gold':     return '#ffc542';
    case 'silver':   return '#94a3b8';
    default:         return '#78716c';
  }
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return (
    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg, #ffc542, #ffd97a)', boxShadow: '0 0 12px #ffc54255' }}>
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
    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-[12px] font-bold tabular-nums" style={{ background: '#13111f', border: '1px solid rgba(255,197,66,0.2)', color: '#8981ab' }}>
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
    <div className="min-h-screen px-3 sm:px-4 py-6 sm:py-10" style={{ background: '#07060f' }}>
      <div className="max-w-2xl mx-auto">

        {/* Header */}
        <div className="relative text-center mb-8">
          <HeaderOrnament />
          <div className="relative inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-4 text-[11px] font-medium uppercase tracking-widest"
            style={{ background: '#ffc54215', border: '1px solid #ffc54230', color: '#ffc542' }}>
            <Trophy size={11} /> {t('lb_title')}
          </div>
          <h1 className="relative text-[28px] font-bold mb-1" style={{ color: '#e8e2f5', fontFamily: 'Cinzel, serif' }}>
            {t('lb_top_bettors')}
          </h1>
          <p className="relative text-[13px]" style={{ color: '#8981ab' }}>
            {t('lb_sorted_by')}
          </p>
        </div>

        {/* My rank banner */}
        {myRank > 0 && (
          <div className="rounded-xl px-4 py-3 mb-5 flex items-center justify-between"
            style={{ background: '#ffc54210', border: '1px solid #ffc54230' }}>
            <span className="text-[12px]" style={{ color: '#9990b8' }}>{t('lb_rank')}</span>
            <span className="text-[14px] font-bold" style={{ color: '#ffc542' }}>#{myRank}</span>
          </div>
        )}

        {/* Podium — top 3 */}
        {!loading && entries.length > 0 && (
          <PodiumHero entries={entries} myId={session?.user?.id} />
        )}

        {/* Table — rank 4 and below */}
        <div className="rounded-2xl overflow-hidden" style={{ background: '#0d0b1a', border: '1px solid rgba(255,197,66,0.2)' }}>
          {loading ? (
            <div className="py-16 text-center text-[13px]" style={{ color: '#8981ab' }}>{t('common_loading')}</div>
          ) : entries.length === 0 ? (
            <EmptyLeaderboardIllustration title={t('lb_empty')} />
          ) : (
            <div>
              {entries.slice(3).map((entry, i) => {
                const rank = i + 4;
                const level = computeLevel(entry.totalWagered);
                const tier  = levelTier(level);
                const color = tierColor(tier);
                const isMe  = entry.id === session?.user?.id;
                const bg    = avatarColor(entry.username);

                return (
                  <div
                    key={entry.id}
                    className={cn(
                      'flex items-center gap-4 px-5 py-4 transition-all border-l-2',
                      isMe ? 'bg-[#ffc542]/5 border-l-[#ffc542]' : 'border-l-transparent hover:bg-[#13111f] hover:border-l-[#ffc542]/60 hover:-translate-y-px'
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
                      <p className={cn('text-[13px] font-bold truncate', isMe ? 'text-[#ffc542]' : 'text-[#e8e2f5]')}>
                        {entry.username}
                        {isMe && <span className="ml-2 text-[10px] font-normal text-[#ffc542]/60">{t('lb_you_short')}</span>}
                      </p>
                      <p className="text-[11px]" style={{ color: '#8981ab' }}>
                        {entry._count?.bets ?? 0} {t('lb_bets').toLowerCase()}
                      </p>
                    </div>

                    {/* Volume */}
                    <div className="text-right shrink-0">
                      <p className="text-[13px] font-bold tabular-nums" style={{ color: '#ffc542' }}>
                        {new Intl.NumberFormat('fr-FR').format(entry.totalWagered)} ⚜
                      </p>
                      <p className="text-[10px]" style={{ color: '#8981ab' }}>{t('lb_wagered')}</p>
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
