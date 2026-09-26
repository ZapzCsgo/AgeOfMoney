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

const RANK_METAL: Record<1 | 2 | 3, { light: string; dark: string; bevel: string }> = {
  1: { light: '#ffe9a8', dark: '#8a6a12', bevel: '#ffd97a' },
  2: { light: '#e4e9ef', dark: '#5b6672', bevel: '#c7d0da' },
  3: { light: '#e8b98a', dark: '#7a4a20', bevel: '#d99a5c' },
};

/** One podium step — solid, flat front-facing block (no fake-3D angle).
 * `edge` controls which outer vertical border is drawn so three adjacent
 * steps read as a single touching podium instead of three separate boxes. */
function PodiumStep({ rank, heightPx, edge }: { rank: 1 | 2 | 3; heightPx: number; edge: 'left' | 'center' | 'right' }) {
  const metal = RANK_METAL[rank];
  const gradId = `step-grad-${rank}`;
  const bevelH = 7;

  return (
    <div className="relative w-full" style={{ height: heightPx }}>
      <svg viewBox="0 0 120 100" preserveAspectRatio="none" className="block w-full h-full" aria-hidden>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={metal.dark} stopOpacity="0.55" />
            <stop offset="100%" stopColor="#0a0814" stopOpacity="1" />
          </linearGradient>
        </defs>
        {/* Front face */}
        <rect x="0" y={bevelH} width="120" height={100 - bevelH} fill={`url(#${gradId})`} />
        {/* Top bevel — the surface a player stands on */}
        <rect x="0" y="0" width="120" height={bevelH} fill={metal.bevel} />
        {/* Outer edge borders only, so touching steps read as one podium */}
        {edge !== 'right' && <line x1="0" y1="0" x2="0" y2="100" stroke={metal.bevel} strokeOpacity="0.4" strokeWidth="1.5" />}
        {edge !== 'left' && <line x1="120" y1="0" x2="120" y2="100" stroke={metal.bevel} strokeOpacity="0.4" strokeWidth="1.5" />}
      </svg>
      <span
        className="absolute inset-x-0 flex items-center justify-center font-cinzel font-black"
        style={{
          top: bevelH, bottom: 0,
          color: metal.bevel,
          fontSize: Math.max(15, heightPx * 0.22),
          textShadow: '0 1px 0 rgba(255,255,255,0.18), 0 -1px 1px rgba(0,0,0,0.65)',
        }}
      >
        {rank}
      </span>
    </div>
  );
}

/** Skeleton placeholder for an unfilled top-3 slot — same footprint as a
 * real name + amount block so the row stays aligned, no new copy. */
function EmptySlotLabel() {
  return (
    <div className="flex flex-col items-center gap-1.5 mb-2">
      <div className="h-[10px] w-14 rounded-full" style={{ background: '#1e1a30' }} />
      <div className="h-[10px] w-10 rounded-full" style={{ background: '#1e1a30' }} />
    </div>
  );
}

function PodiumColumn({
  entry, rank, heightPx, isMe, edge,
}: {
  entry: LeaderboardEntry | undefined;
  rank: 1 | 2 | 3;
  heightPx: number;
  isMe: boolean;
  edge: 'left' | 'center' | 'right';
}) {
  const metal = RANK_METAL[rank];
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
        <EmptySlotLabel />
        <PodiumStep rank={rank} heightPx={heightPx} edge={edge} />
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
        <Crown size={20} className="mb-0.5 shrink-0" fill="#ffc542" color="#ffc542" strokeWidth={1.5} />
      )}
      <div className="relative mb-2 shrink-0">
        <div
          className="overflow-hidden rounded-full flex items-center justify-center text-[11px] font-bold text-white"
          style={{ width: avatarSize, height: avatarSize, border: `2px solid ${metal.bevel}`, background: entry.avatar ? 'transparent' : bg, boxShadow: rank === 1 ? '0 0 12px rgba(255,197,66,0.3)' : undefined }}
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
      <PodiumStep rank={rank} heightPx={heightPx} edge={edge} />
    </div>
  );
}

export function PodiumHero({ entries, myId }: { entries: LeaderboardEntry[]; myId?: string }) {
  const top3: Array<LeaderboardEntry | undefined> = [entries[0], entries[1], entries[2]];
  // Display order: 2nd (left), 1st (center, tallest), 3rd (right)
  const slots: Array<{ rank: 1 | 2 | 3; entry: LeaderboardEntry | undefined; heightPx: number; edge: 'left' | 'center' | 'right' }> = [
    { rank: 2, entry: top3[1], heightPx: 75,  edge: 'left'   },
    { rank: 1, entry: top3[0], heightPx: 100, edge: 'center' },
    { rank: 3, entry: top3[2], heightPx: 60,  edge: 'right'  },
  ];

  return (
    <div className="relative mb-8">
      <div
        className="pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 w-56 h-40 rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(255,197,66,0.16), transparent 70%)' }}
        aria-hidden
      />
      <div className="relative flex items-end justify-center gap-0 px-1 max-w-[420px] mx-auto">
        {slots.map(s => (
          <PodiumColumn key={s.rank} rank={s.rank} entry={s.entry} heightPx={s.heightPx} isMe={s.entry?.id === myId} edge={s.edge} />
        ))}
      </div>
    </div>
  );
}
