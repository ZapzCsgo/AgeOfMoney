'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Trophy, Hexagon, Crown, Medal, Award, User, AlertTriangle } from 'lucide-react';
import { cn, formatCoins } from '@/lib/utils';
import { getTftLeaderboard, type LeaderboardEntry } from '@/lib/api';

type Period = 'week' | 'month' | 'all';
const PERIODS: { key: Period; label: string }[] = [
  { key: 'week',  label: 'Semaine' },
  { key: 'month', label: 'Mois'    },
  { key: 'all',   label: 'All-time'},
];

export default function LeaderboardPage() {
  const [period, setPeriod] = useState<Period>('month');
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    getTftLeaderboard(period).then((data) => { if (!cancelled) setEntries(data); });
    return () => { cancelled = true; };
  }, [period]);

  return (
    <div className="relative pb-20">
      <Header period={period} setPeriod={setPeriod} />

      <section className="max-w-4xl mx-auto px-6 mt-10">
        {entries === null && <LeaderboardSkeleton />}

        {entries && entries.length === 0 && <EmptyState />}

        {entries && entries.length >= 3 && (
          <>
            <PodiumSection top3={entries.slice(0, 3)} />
            <div className="mt-10 rounded-xl border border-tft-border bg-tft-bg-card/60 overflow-hidden">
              <TableHeader />
              {entries.slice(3).map((e) => <Row key={e.userId} entry={e} />)}
            </div>
          </>
        )}

        {entries && entries.length > 0 && entries.length < 3 && (
          <div className="rounded-xl border border-tft-border bg-tft-bg-card/60 overflow-hidden">
            <TableHeader />
            {entries.map((e) => <Row key={e.userId} entry={e} />)}
          </div>
        )}
      </section>
    </div>
  );
}

function Header({ period, setPeriod }: { period: Period; setPeriod: (p: Period) => void }) {
  return (
    <section className="relative overflow-hidden bg-hero-arcane border-b border-tft-border">
      <div className="absolute inset-0 bg-hex-grid opacity-15 pointer-events-none" aria-hidden="true" />
      <div className="absolute -top-32 -left-20 w-[420px] h-[420px] rounded-full bg-tft-gold/15 blur-[120px]" aria-hidden="true" />

      <div className="relative max-w-4xl mx-auto px-6 pt-12 pb-10 space-y-6">
        <div className="space-y-3 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-tft-gold/40 bg-tft-gold/10">
            <Trophy size={11} className="text-tft-gold-bright" />
            <span className="font-ui text-[11px] tracking-[0.22em] uppercase text-tft-gold-bright">
              Classement TFT
            </span>
          </div>
          <h1 className="font-display font-bold text-4xl md:text-5xl text-tft-text leading-tight">
            Top parieurs TFT
          </h1>
          <p className="text-tft-text-dim text-base max-w-2xl mx-auto">
            Classés au volume total wagered. Mise à jour en temps réel après chaque pari réglé.
          </p>
        </div>

        <div className="flex justify-center gap-2">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={cn(
                'px-4 py-2 rounded-md font-ui text-[12px] tracking-[0.16em] uppercase transition-all cursor-pointer',
                period === p.key
                  ? 'bg-tft-purple/20 border border-tft-purple-bright text-tft-purple-bright shadow-arcane-sm'
                  : 'bg-tft-bg-card/60 border border-tft-border text-tft-text-dim hover:text-tft-text hover:border-tft-purple/40',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────── Podium ─────────────────── */
function PodiumSection({ top3 }: { top3: LeaderboardEntry[] }) {
  // Display order : 2nd left, 1st center, 3rd right — like an actual podium
  const ordered = [top3[1], top3[0], top3[2]];
  const sizes = [
    { rank: 2, icon: Medal, color: 'text-tft-text',         border: 'border-tft-text-faint/40',   pad: 'pt-10', heightPc: 75 },
    { rank: 1, icon: Crown, color: 'text-tft-gold-bright',  border: 'border-tft-gold/50',         pad: 'pt-0',  heightPc: 100 },
    { rank: 3, icon: Award, color: 'text-[#c97a3c]',        border: 'border-[#c97a3c]/40',        pad: 'pt-12', heightPc: 65 },
  ];

  return (
    <div className="grid grid-cols-3 gap-3 md:gap-5 items-end">
      {ordered.map((e, i) => (
        <PodiumCard key={e.userId} entry={e} style={sizes[i]} />
      ))}
    </div>
  );
}

function PodiumCard({
  entry, style,
}: {
  entry: LeaderboardEntry;
  style: { rank: number; icon: typeof Trophy; color: string; border: string; pad: string; heightPc: number };
}) {
  return (
    <div className={cn('relative flex flex-col items-center', style.pad)}>
      <div className={cn('w-14 h-14 md:w-20 md:h-20 rounded-md border-2 bg-tft-bg-card overflow-hidden flex items-center justify-center mb-3 shadow-arcane-sm', style.border)}>
        {entry.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={entry.avatar} alt={entry.username} className="w-full h-full object-cover" />
        ) : (
          <User size={28} className={style.color} />
        )}
      </div>
      <style.icon size={style.rank === 1 ? 22 : 18} className={cn(style.color, 'mb-1')} />
      <p className="font-display font-bold text-sm md:text-base text-tft-text truncate max-w-full text-center">{entry.username}</p>
      <p className={cn('font-ui font-semibold text-sm md:text-base tabular-nums mt-1', style.color)}>
        {formatCoins(entry.totalWagered)} ◈
      </p>
      <div
        className={cn(
          'w-full mt-3 rounded-t-md border-t border-x',
          style.border,
          style.rank === 1 ? 'bg-tft-gold/10' : 'bg-tft-bg-card/60',
        )}
        style={{ height: `${style.heightPc}px` }}
      >
        <p className={cn(
          'text-center pt-3 font-display font-bold text-2xl md:text-3xl tabular-nums',
          style.color,
        )}>
          {style.rank}
        </p>
      </div>
    </div>
  );
}

/* ─────────────────── Table ─────────────────── */
function TableHeader() {
  return (
    <div className="hidden md:grid grid-cols-[60px_1fr_140px_140px] gap-4 px-5 py-3 border-b border-tft-border bg-tft-bg-elevated/50">
      <span className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-text-muted">Rang</span>
      <span className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-text-muted">Utilisateur</span>
      <span className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-text-muted text-right">Paris</span>
      <span className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-text-muted text-right">Wagered</span>
    </div>
  );
}

function Row({ entry }: { entry: LeaderboardEntry }) {
  return (
    <div className="grid grid-cols-[60px_1fr_auto] md:grid-cols-[60px_1fr_140px_140px] gap-3 md:gap-4 px-4 md:px-5 py-3 border-b border-tft-border last:border-0 items-center hover:bg-tft-bg-hover transition-colors">
      <span className="font-ui text-tft-text-dim font-semibold tabular-nums">#{entry.rank}</span>
      <div className="flex items-center gap-3 min-w-0">
        <div className="shrink-0 w-9 h-9 rounded-md bg-tft-bg-elevated border border-tft-border overflow-hidden flex items-center justify-center">
          {entry.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={entry.avatar} alt={entry.username} className="w-full h-full object-cover" />
          ) : (
            <User size={16} className="text-tft-purple-bright" />
          )}
        </div>
        <span className="font-medium text-tft-text truncate">{entry.username}</span>
      </div>
      <span className="hidden md:block text-right font-ui text-sm text-tft-text-dim tabular-nums">
        {entry.totalBets ?? '—'}
      </span>
      <span className="text-right font-ui font-semibold text-sm text-tft-gold-bright tabular-nums">
        {formatCoins(entry.totalWagered)} ◈
      </span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-tft-border bg-tft-bg-card/50 p-12 text-center">
      <Hexagon size={32} className="text-tft-purple-bright mx-auto mb-3 opacity-50" />
      <h3 className="font-display font-semibold text-xl text-tft-text mb-2">
        Pas encore de classement
      </h3>
      <p className="text-sm text-tft-text-dim max-w-md mx-auto leading-relaxed">
        Le classement se construit dès le premier pari réglé sur la plateforme. Sois le premier à
        apparaître ici en plaçant un pari sur un tournoi en cours.
      </p>
      <Link
        href="/tournaments"
        className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-gradient-rose shadow-rose-md font-ui font-semibold text-[12px] uppercase tracking-wider text-white hover:shadow-arcane-md cursor-pointer transition-all"
      >
        Voir les tournois
      </Link>
    </div>
  );
}

function LeaderboardSkeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="grid grid-cols-3 gap-3 md:gap-5 items-end">
        {[2, 1, 3].map((r, i) => (
          <div key={r} className="flex flex-col items-center" style={{ paddingTop: i === 1 ? 0 : 40 }}>
            <div className="w-20 h-20 rounded-md bg-tft-bg-elevated mb-3" />
            <div className="h-4 w-20 rounded bg-tft-bg-elevated mb-2" />
            <div className={`w-full mt-3 rounded-t-md ${i === 1 ? 'h-24' : i === 0 ? 'h-18' : 'h-16'} bg-tft-bg-elevated`} />
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-tft-border bg-tft-bg-card/60 p-5 space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-10 rounded bg-tft-bg-elevated" />
        ))}
      </div>
    </div>
  );
}
