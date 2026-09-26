'use client';

import { Crown, HelpCircle } from 'lucide-react';
import { computeLevel, levelTier } from '@/lib/level';
import { cn } from '@/lib/utils';
import { LeaderboardEntry } from '@/types';

function avatarColor(name: string): string {
  const colors = ['#7c3aed', '#0891b2', '#b45309', '#047857', '#be185d', '#1d4ed8'];
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

const RANK_RING: Record<1 | 2 | 3, string> = {
  1: '#ffc542',
  2: '#94a3b8',
  3: '#b45309',
};

/** One podium step — beveled stone block, drawn with a fixed-viewBox SVG that
 * stretches to whatever height the caller gives it (rank 1 tallest). The rank
 * number is an HTML overlay rather than SVG <text> so it never skews when the
 * block is stretched. */
function PodiumStep({ rank, heightPx }: { rank: 1 | 2 | 3; heightPx: number }) {
  const ring = RANK_RING[rank];
  return (
    <div className="relative w-full" style={{ height: heightPx }}>
      <svg viewBox="0 0 120 100" preserveAspectRatio="none" className="block w-full h-full" aria-hidden>
        <polygon points="6,16 114,16 104,4 16,4" fill="#141226" stroke={ring} strokeOpacity="0.55" strokeWidth="1.5" />
        <rect x="6" y="16" width="108" height="84" rx="3" fill="#0d0b1a" stroke={ring} strokeOpacity="0.4" strokeWidth="1.5" />
        <line x1="6" y1="52" x2="114" y2="52" stroke="#1e1a30" strokeWidth="1" />
      </svg>
      <span
        className="absolute inset-x-0 top-2 text-center font-cinzel font-black"
        style={{ color: ring, fontSize: Math.max(16, heightPx * 0.24), textShadow: '0 0 12px rgba(255,197,66,0.25)' }}
      >
        {rank}
      </span>
    </div>
  );
}

function PodiumColumn({
  entry, rank, heightPx, isMe,
}: {
  entry: LeaderboardEntry | undefined;
  rank: 1 | 2 | 3;
  heightPx: number;
  isMe: boolean;
}) {
  const ring = RANK_RING[rank];
  const avatarSize = rank === 1 ? 60 : 48;

  if (!entry) {
    return (
      <div className="flex flex-1 min-w-0 flex-col items-center">
        <div
          className="mb-2 flex items-center justify-center rounded-full border border-dashed"
          style={{ width: avatarSize, height: avatarSize, borderColor: '#2d2850' }}
        >
          <HelpCircle size={avatarSize * 0.4} className="text-aoe-parchment-dim" strokeWidth={1.5} />
        </div>
        <p className="text-[11px] text-aoe-parchment-dim mb-0.5">—</p>
        <p className="text-[11px] text-aoe-parchment-dim mb-2">—</p>
        <PodiumStep rank={rank} heightPx={heightPx} />
      </div>
    );
  }

  const level = computeLevel(entry.totalWagered);
  const tier  = levelTier(level);
  const color = tierColor(tier);
  const bg    = avatarColor(entry.username);

  return (
    <div className="flex flex-1 min-w-0 flex-col items-center">
      {rank === 1 && (
        <Crown size={22} className="mb-1 shrink-0" fill="#ffc542" color="#ffc542" strokeWidth={1.5} />
      )}
      <div className="relative mb-2 shrink-0">
        <div
          className="overflow-hidden rounded-full flex items-center justify-center text-[11px] font-bold text-white"
          style={{ width: avatarSize, height: avatarSize, border: `2px solid ${ring}`, background: entry.avatar ? 'transparent' : bg, boxShadow: rank === 1 ? '0 0 16px rgba(255,197,66,0.35)' : undefined }}
        >
          {entry.avatar
            ? <img src={entry.avatar} alt={entry.username} className="w-full h-full object-cover" />
            : entry.username.slice(0, 2).toUpperCase()}
        </div>
        <div
          className="absolute -bottom-1 -right-1 flex items-center justify-center rounded-full text-[8px] font-black"
          style={{ background: color, color: '#07060f', width: 15, height: 15, lineHeight: 1 }}
        >
          {level}
        </div>
      </div>
      <p className={cn('text-[12px] font-bold truncate max-w-[90px]', isMe ? 'text-aoe-gold' : 'text-aoe-parchment')}>
        {entry.username}
      </p>
      <p className="text-[11px] font-bold text-aoe-gold tabular-nums mb-2">
        {new Intl.NumberFormat('fr-FR').format(entry.totalWagered)} ⚜
      </p>
      <PodiumStep rank={rank} heightPx={heightPx} />
    </div>
  );
}

export function PodiumHero({ entries, myId }: { entries: LeaderboardEntry[]; myId?: string }) {
  const top3: Array<LeaderboardEntry | undefined> = [entries[0], entries[1], entries[2]];
  // Display order: 2nd (left), 1st (center, tallest), 3rd (right)
  const slots: Array<{ rank: 1 | 2 | 3; entry: LeaderboardEntry | undefined; heightPx: number }> = [
    { rank: 2, entry: top3[1], heightPx: 76 },
    { rank: 1, entry: top3[0], heightPx: 100 },
    { rank: 3, entry: top3[2], heightPx: 60 },
  ];

  return (
    <div className="relative mb-8">
      <div
        className="pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 w-56 h-56 rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(255,197,66,0.16), transparent 70%)' }}
        aria-hidden
      />
      <div className="relative flex items-end justify-center gap-2 sm:gap-5 px-1">
        {slots.map(s => (
          <PodiumColumn key={s.rank} rank={s.rank} entry={s.entry} heightPx={s.heightPx} isMe={s.entry?.id === myId} />
        ))}
      </div>
    </div>
  );
}
