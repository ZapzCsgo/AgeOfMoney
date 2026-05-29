'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Trophy, Coins, TrendingUp, Hexagon, Users, Flame } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Right-hand zone of the gambling hero. Three vertical slabs :
 *   1. Stat strip (live tournaments, online users, bets today) — counters
 *      tick up every 3-5 s with a brief green flash for the eye.
 *   2. Big jackpot box — countdown to the next S-tier event with prize
 *      pool aggregated across the next 7 days. Glow pulse on hover.
 *   3. Activity feed — entries drop in from the top every 2-4 s with
 *      slide-in-top animation. Caps at 5 visible, older entries fall
 *      off the bottom.
 *
 * All data is fake-client-side for the MVP — when /api/v1/tft/live-feed
 * exists, swap each useState's interval driver for a socket subscription
 * or a polled fetch.
 */
export function LiveFeed() {
  return (
    <div className="space-y-4">
      <StatStrip />
      <Jackpot />
      <ActivityFeed />
    </div>
  );
}

/* ─────────────────────── Stat strip ─────────────────────── */
const STAT_BASE = {
  liveTournaments: 4,
  onlineUsers:     2847,
  betsToday:       12_480,
};

function StatStrip() {
  const [live, setLive]       = useState(STAT_BASE.liveTournaments);
  const [online, setOnline]   = useState(STAT_BASE.onlineUsers);
  const [bets, setBets]       = useState(STAT_BASE.betsToday);

  useEffect(() => {
    // Online users drift +/- 12 every 4 s — enough variation to feel
    // alive without making the number jump around chaotically.
    const onlineI = setInterval(() => setOnline((n) => Math.max(2000, n + Math.floor(Math.random() * 25) - 8)), 4000);
    // Bets only ever go up (it's a daily counter). +1 to +4 every 2-3 s.
    const betsI   = setInterval(() => setBets((n) => n + Math.floor(Math.random() * 4) + 1), 2500);
    // Live tournaments rarely changes — every 30 s, +/- 1 with a small
    // probability so it's stable but not frozen.
    const liveI   = setInterval(() => {
      if (Math.random() < 0.3) setLive((n) => Math.max(2, Math.min(8, n + (Math.random() < 0.5 ? -1 : 1))));
    }, 30_000);
    return () => { clearInterval(onlineI); clearInterval(betsI); clearInterval(liveI); };
  }, []);

  return (
    <div className="grid grid-cols-3 gap-2">
      <StatTile icon={Hexagon} label="Tournois live" value={live}    flashOnUpdate />
      <StatTile icon={Users}   label="En ligne"      value={online}  flashOnUpdate />
      <StatTile icon={TrendingUp} label="Bets · 24h" value={bets}    flashOnUpdate />
    </div>
  );
}

function StatTile({
  icon: Icon, label, value, flashOnUpdate,
}: {
  icon: typeof Hexagon;
  label: string;
  value: number;
  flashOnUpdate?: boolean;
}) {
  const [flashKey, setFlashKey] = useState(0);
  const prev = useRef(value);
  useEffect(() => {
    if (flashOnUpdate && prev.current !== value) {
      setFlashKey((k) => k + 1);
      prev.current = value;
    }
  }, [value, flashOnUpdate]);

  return (
    <div className="rounded-md border border-tft-border bg-tft-bg-card/60 px-3 py-2">
      <p className="font-ui text-[9px] tracking-[0.22em] uppercase text-tft-text-muted flex items-center gap-1">
        <Icon size={9} className="text-tft-cyan-bright" />
        {label}
      </p>
      <p
        key={flashKey}
        className="font-display font-bold text-lg md:text-xl text-tft-text tabular-nums animate-num-tick"
      >
        {new Intl.NumberFormat('fr-FR').format(value)}
      </p>
    </div>
  );
}

/* ─────────────────────── Jackpot ─────────────────────── */
const JACKPOT_BASE = 425_000;        // $
const JACKPOT_TARGET_DATE = new Date(); // computed at mount in case the user keeps the tab open across days
JACKPOT_TARGET_DATE.setDate(JACKPOT_TARGET_DATE.getDate() + 6);
JACKPOT_TARGET_DATE.setHours(20, 0, 0, 0);

function Jackpot() {
  const [pool, setPool]         = useState(JACKPOT_BASE);
  const [now, setNow]           = useState(() => Date.now());

  useEffect(() => {
    // Pool drifts up slowly — every 8 s, +$80 to $400 to simulate "new bets feeding the pot"
    const poolI = setInterval(() => setPool((p) => p + 80 + Math.floor(Math.random() * 320)), 8000);
    const tickI = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(poolI); clearInterval(tickI); };
  }, []);

  const msLeft = Math.max(0, JACKPOT_TARGET_DATE.getTime() - now);
  const days   = Math.floor(msLeft / 86_400_000);
  const hours  = Math.floor((msLeft % 86_400_000) / 3_600_000);
  const mins   = Math.floor((msLeft % 3_600_000) / 60_000);
  const secs   = Math.floor((msLeft % 60_000) / 1000);

  return (
    <div className="relative rounded-xl border-2 border-tft-gold/40 bg-card-arcane overflow-hidden shadow-gold-md">
      <div className="absolute inset-0 bg-hex-grid opacity-10 pointer-events-none" aria-hidden="true" />
      <div className="absolute -top-12 -left-12 w-44 h-44 rounded-full bg-tft-gold/15 blur-3xl pointer-events-none" aria-hidden="true" />
      <div className="absolute -bottom-12 -right-12 w-44 h-44 rounded-full bg-tft-rose/10 blur-3xl pointer-events-none" aria-hidden="true" />

      <div className="relative p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-gold-bright font-bold flex items-center gap-1.5">
            <Trophy size={11} />
            Prochaine S-Tier
          </p>
          <span className="font-ui text-[9px] tracking-[0.22em] uppercase text-tft-text-muted">
            En jeu
          </span>
        </div>

        <p className="font-display font-bold text-3xl md:text-4xl text-tft-gold-bright tabular-nums leading-none drop-shadow-[0_0_12px_rgba(251,191,36,0.55)]">
          ${new Intl.NumberFormat('fr-FR').format(pool)}
        </p>

        <div className="flex items-center justify-between pt-1 border-t border-tft-border">
          <p className="text-[10px] text-tft-text-muted uppercase tracking-wider font-ui">
            Coup d&apos;envoi dans
          </p>
          <div className="font-ui font-semibold text-sm text-tft-text tabular-nums">
            {days > 0 && <span>{days}j </span>}
            <span>{String(hours).padStart(2, '0')}</span>
            <span className="text-tft-text-muted mx-0.5">:</span>
            <span>{String(mins).padStart(2, '0')}</span>
            <span className="text-tft-text-muted mx-0.5">:</span>
            <span className="text-tft-rose-bright">{String(secs).padStart(2, '0')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────── Activity feed ─────────────────────── */
type FeedKind = 'bet' | 'win' | 'join' | 'big-win';
interface FeedEntry {
  id: number;
  user: string;
  kind: FeedKind;
  amount?: number;
  on: string;
  at: number;
}

const POOL_USERS = ['Anonymous', '@tactician42', '@merlin69', '@gambler420', '@hexcore', '@soju4life', '@mortdog_fan', '@rerollme', '@augmentpls'];
const POOL_TOURNAMENTS = ["Tactician's Crown", 'Set 12 Worlds', 'EWC Paris', 'Regional Finals EMEA', "Tactician's Trials KR", 'Open Series APAC', 'Anima Cup'];
const POOL_PARTICIPANTS = ['Setsuko', 'k3soju', 'Robinsongz', 'Chocolate', 'Hyrqbot', 'Outsider', 'Souless'];

let feedIdCounter = 0;
function generateEntry(): FeedEntry {
  const r = Math.random();
  feedIdCounter++;
  if (r < 0.2) {
    return {
      id: feedIdCounter,
      user: POOL_USERS[Math.floor(Math.random() * POOL_USERS.length)],
      kind: 'big-win',
      amount: 1000 + Math.floor(Math.random() * 8000),
      on: POOL_TOURNAMENTS[Math.floor(Math.random() * POOL_TOURNAMENTS.length)],
      at: Date.now(),
    };
  }
  if (r < 0.55) {
    return {
      id: feedIdCounter,
      user: POOL_USERS[Math.floor(Math.random() * POOL_USERS.length)],
      kind: 'win',
      amount: 40 + Math.floor(Math.random() * 800),
      on: `${POOL_PARTICIPANTS[Math.floor(Math.random() * POOL_PARTICIPANTS.length)]} @ ${(1.5 + Math.random() * 12).toFixed(2)}×`,
      at: Date.now(),
    };
  }
  if (r < 0.85) {
    return {
      id: feedIdCounter,
      user: POOL_USERS[Math.floor(Math.random() * POOL_USERS.length)],
      kind: 'bet',
      amount: 10 + Math.floor(Math.random() * 500),
      on: `${POOL_PARTICIPANTS[Math.floor(Math.random() * POOL_PARTICIPANTS.length)]} @ ${(1.5 + Math.random() * 12).toFixed(2)}×`,
      at: Date.now(),
    };
  }
  return {
    id: feedIdCounter,
    user: POOL_USERS[Math.floor(Math.random() * POOL_USERS.length)],
    kind: 'join',
    on: POOL_TOURNAMENTS[Math.floor(Math.random() * POOL_TOURNAMENTS.length)],
    at: Date.now(),
  };
}

function ActivityFeed() {
  const initial = useMemo(() => Array.from({ length: 5 }, () => generateEntry()), []);
  const [entries, setEntries] = useState<FeedEntry[]>(initial);

  useEffect(() => {
    const tick = () => {
      setEntries((prev) => [generateEntry(), ...prev].slice(0, 5));
    };
    // Variable cadence — 2 to 4 seconds between events. Keeps the feed
    // alive without becoming hypnotic.
    let timeoutId: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timeoutId = setTimeout(() => {
        tick();
        schedule();
      }, 2000 + Math.random() * 2000);
    };
    schedule();
    return () => clearTimeout(timeoutId);
  }, []);

  return (
    <div className="rounded-xl border border-tft-border bg-card-arcane">
      <div className="flex items-center justify-between px-4 py-2 border-b border-tft-border bg-tft-bg/60">
        <p className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-purple-bright font-bold flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-tft-mint animate-pulse-live" />
          Activité live
        </p>
        <Link href="/tournaments" className="text-tft-text-muted hover:text-tft-cyan-bright text-[10px] font-ui tracking-wider uppercase transition-colors">
          tous
        </Link>
      </div>

      <ul className="divide-y divide-tft-border">
        {entries.map((e) => <FeedRow key={e.id} entry={e} />)}
      </ul>
    </div>
  );
}

function FeedRow({ entry: e }: { entry: FeedEntry }) {
  const palette = {
    'big-win':  { icon: Trophy,     col: 'text-tft-gold-bright', glow: 'drop-shadow-[0_0_6px_rgba(251,191,36,0.6)]', verb: 'won' },
    win:        { icon: Coins,      col: 'text-tft-mint',         glow: '',                                            verb: 'won' },
    bet:        { icon: Hexagon,    col: 'text-tft-purple-bright',glow: '',                                            verb: 'bet' },
    join:       { icon: Flame,      col: 'text-tft-cyan-bright',  glow: '',                                            verb: 'joined' },
  }[e.kind];
  const Icon = palette.icon;

  return (
    <li
      key={e.id}
      className="grid grid-cols-[auto_1fr_auto] gap-3 items-center px-4 py-2 animate-slide-in-top"
    >
      <Icon size={13} className={cn(palette.col, palette.glow)} />
      <div className="min-w-0">
        <p className="font-ui text-[11.5px] leading-tight truncate">
          <span className="text-tft-text-dim">{e.user}</span>
          <span className="text-tft-text-muted"> {palette.verb} </span>
          {e.amount !== undefined && (
            <span className={cn('font-semibold tabular-nums', palette.col)}>
              {e.kind === 'big-win' ? '+' : ''}{new Intl.NumberFormat('fr-FR').format(e.amount)} ◈
            </span>
          )}
          {e.kind === 'join' && <span className="text-tft-text-dim italic">a rejoint</span>}
        </p>
        <p className="text-[10.5px] text-tft-text-muted truncate">{e.on}</p>
      </div>
    </li>
  );
}
