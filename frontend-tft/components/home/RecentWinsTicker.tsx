'use client';

import { cn } from '@/lib/utils';
import { Trophy, Sparkles, Flame, Hexagon } from 'lucide-react';

/**
 * Horizontally scrolling ticker pinned just under the navbar — same
 * pattern as Stake / CSGOEmpire. MVP uses a hardcoded array that loops
 * via the `ticker` keyframe ; once /api/v1/tft/recent-wins exists, swap
 * the const for a React Query subscription.
 *
 * Entries duplicated in-array so the marquee has no visible "reset"
 * point — a single content pass would snap back to start when the loop
 * resets, which reads as a stutter.
 */
type WinKind = 'win' | 'jackpot' | 'big-win' | 'live';

interface WinEntry {
  user: string;
  amount: number;
  on: string;
  kind: WinKind;
}

const WINS: WinEntry[] = [
  { user: 'tactician42',  amount: 485,   on: 'Setsuko · 3.20×',                  kind: 'win'      },
  { user: 'merlin69',     amount: 1240,  on: "Tactician's Crown",                kind: 'big-win'  },
  { user: 'gambler420',   amount: 120,   on: 'Lobby Winner',                     kind: 'win'      },
  { user: 'mortdog_fan',  amount: 8420,  on: 'Set 12 Worlds — k3soju',           kind: 'jackpot'  },
  { user: 'soju4life',    amount: 250,   on: 'Anima Cup — Robinsongz',           kind: 'win'      },
  { user: 'hexcore',      amount: 690,   on: 'EWC Paris — Chocolate',            kind: 'win'      },
  { user: 'doublestrike', amount: 320,   on: 'Regional Finals',                  kind: 'live'     },
  { user: 'fortune7',     amount: 2150,  on: "Tactician's Trials KR — Setsuko",  kind: 'big-win'  },
  { user: 'mistwalker',   amount: 420,   on: 'Hyrqbot @ 11×',                    kind: 'win'      },
  { user: 'wizardking',   amount: 12500, on: 'JACKPOT · Set Championship',       kind: 'jackpot'  },
  { user: 'rerollme',     amount: 95,    on: 'Anonymous bet · 4.5×',             kind: 'win'      },
  { user: 'augmentpls',   amount: 1820,  on: 'Open Series APAC',                 kind: 'big-win'  },
];

function colorFor(kind: WinKind): { text: string; glow: string; icon: typeof Trophy } {
  if (kind === 'jackpot')   return { text: 'text-tft-gold-bright',  glow: 'drop-shadow-[0_0_8px_rgba(251,191,36,0.7)]', icon: Trophy };
  if (kind === 'big-win')   return { text: 'text-tft-rose-bright',  glow: 'drop-shadow-[0_0_8px_rgba(244,63,94,0.65)]', icon: Flame  };
  if (kind === 'live')      return { text: 'text-tft-cyan-bright',  glow: '',                                            icon: Hexagon};
  return                          { text: 'text-tft-mint',          glow: '',                                            icon: Sparkles };
}

function formatAmount(n: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n);
}

/**
 * Single entry pill — composes the colour scheme and the trailing dot
 * separator. The dot is rendered as part of the entry so the gap stays
 * consistent across kinds without extra flex tricks.
 */
function Pill({ entry }: { entry: WinEntry }) {
  const { text, glow, icon: Icon } = colorFor(entry.kind);
  return (
    <span className="inline-flex items-center gap-2 px-3 shrink-0">
      <Icon size={11} className={cn(text, glow)} />
      <span className="font-ui text-[11.5px] tracking-wide">
        <span className="text-tft-text-muted">@{entry.user}</span>
        <span className={cn('mx-1.5 font-semibold tabular-nums', text, glow)}>
          +{formatAmount(entry.amount)} ◈
        </span>
        <span className="text-tft-text-dim">{entry.on}</span>
      </span>
      <span className="text-tft-text-faint">·</span>
    </span>
  );
}

export function RecentWinsTicker() {
  // Render the array twice — the CSS animation translates -100% across
  // a flex container, so the second pass picks up exactly when the first
  // is half-out. Looks seamless to the eye.
  const loops = [...WINS, ...WINS];
  return (
    <div
      className={cn(
        'relative h-9 overflow-hidden border-y border-tft-border',
        'bg-tft-bg/95 backdrop-blur-sm',
      )}
      role="marquee"
      aria-label="Gains récents"
    >
      {/* Edge fades — softens the cut at left/right so entries dissolve
          rather than chop. */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-tft-bg to-transparent z-10" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-tft-bg to-transparent z-10" aria-hidden="true" />

      {/* Left label — anchor on "LIVE WINS" so the strip has a known
          context, otherwise readers may not realise it's a ticker. */}
      <div className="absolute inset-y-0 left-0 z-20 px-3 flex items-center bg-tft-purple/15 border-r border-tft-purple/30">
        <span className="w-1.5 h-1.5 rounded-full bg-tft-rose mr-2 animate-pulse-live" />
        <span className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-purple-bright font-bold">
          Live wins
        </span>
      </div>

      <div
        className="flex items-center h-full whitespace-nowrap pl-32"
        style={{
          // Override the default 40s tailwind ticker — 60s reads as a
          // natural reading pace ; faster than that and entries become
          // visual noise rather than legible content.
          animation: 'ticker 60s linear infinite',
        }}
      >
        {loops.map((entry, i) => <Pill key={`${entry.user}-${i}`} entry={entry} />)}
      </div>
    </div>
  );
}
