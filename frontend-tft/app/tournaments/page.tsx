'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Calendar, Trophy, Users, ChevronRight, AlertTriangle, Hexagon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getTftTournaments, type TftTournament } from '@/lib/api';

type StatusFilter = 'all' | 'upcoming' | 'live' | 'completed';

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all',       label: 'Tous'      },
  { key: 'live',      label: 'Live'      },
  { key: 'upcoming',  label: 'À venir'   },
  { key: 'completed', label: 'Terminés'  },
];

export default function TournamentsListingPage() {
  const [status, setStatus]               = useState<StatusFilter>('all');
  const [tournaments, setTournaments]     = useState<TftTournament[] | null>(null);
  const [error, setError]                 = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTournaments(null);
    setError(null);
    getTftTournaments({ status, limit: 50 })
      .then((data) => { if (!cancelled) setTournaments(data); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Erreur'); });
    return () => { cancelled = true; };
  }, [status]);

  // Auto-refresh live tournaments every 60s so standings stay fresh on the
  // listing page (where users typically land when a major event starts).
  useEffect(() => {
    if (status !== 'live') return;
    const interval = setInterval(() => {
      getTftTournaments({ status, limit: 50 }).then((data) => setTournaments(data)).catch(() => {});
    }, 60_000);
    return () => clearInterval(interval);
  }, [status]);

  return (
    <div className="relative">
      <PageHeader status={status} setStatus={setStatus} count={tournaments?.length ?? 0} />

      <section className="max-w-6xl mx-auto px-6 py-10">
        {error && (
          <div className="rounded-xl border border-tft-rose/40 bg-tft-rose/10 p-5 text-tft-rose-bright text-sm flex items-center gap-2">
            <AlertTriangle size={16} />
            Impossible de charger les tournois — {error}.
          </div>
        )}

        {!error && tournaments === null && <GridSkeleton count={6} />}

        {!error && tournaments && tournaments.length === 0 && <EmptyState status={status} />}

        {!error && tournaments && tournaments.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {tournaments.map((t) => <TournamentCard key={t.id} tournament={t} />)}
          </div>
        )}
      </section>
    </div>
  );
}

/* ─────────────────────── Header ─────────────────────── */
function PageHeader({
  status, setStatus, count,
}: { status: StatusFilter; setStatus: (s: StatusFilter) => void; count: number }) {
  return (
    <section className="relative overflow-hidden border-b border-tft-border bg-hero-arcane">
      <div className="absolute inset-0 bg-hex-grid opacity-15 pointer-events-none" aria-hidden="true" />
      <div className="absolute -top-32 -left-20 w-[420px] h-[420px] rounded-full bg-tft-purple/15 blur-[120px]" aria-hidden="true" />
      <div className="absolute -bottom-32 -right-20 w-[420px] h-[420px] rounded-full bg-tft-cyan/10 blur-[120px]" aria-hidden="true" />

      <div className="relative max-w-6xl mx-auto px-6 pt-12 pb-10 space-y-6">
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-tft-purple/40 bg-tft-purple/10 backdrop-blur-sm">
            <Hexagon size={11} className="text-tft-cyan-bright" />
            <span className="font-ui text-[11px] tracking-[0.22em] uppercase text-tft-purple-bright">
              Saison TFT 14 · S-Tier / A-Tier
            </span>
          </div>
          <h1 className="font-display font-bold text-4xl md:text-5xl text-tft-text leading-tight">
            Tournois TFT esport
          </h1>
          <p className="text-tft-text-dim text-base max-w-2xl">
            Tactician&apos;s Crown, Tactician&apos;s Trials, Regional Finals, Esports World Cup.
            Tous les tournois Tier S et A trackés par notre scraper Liquipedia + CompeteTFT,
            avec odds maison calculées en continu.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatus(f.key)}
              className={cn(
                'px-4 py-2 rounded-md font-ui text-[12px] tracking-[0.16em] uppercase transition-all cursor-pointer',
                status === f.key
                  ? 'bg-tft-purple/20 border border-tft-purple-bright text-tft-purple-bright shadow-arcane-sm'
                  : 'bg-tft-bg-card/60 border border-tft-border text-tft-text-dim hover:text-tft-text hover:border-tft-purple/40',
              )}
            >
              {f.label}
              {status === f.key && count > 0 && (
                <span className="ml-2 font-ui text-[10px] tabular-nums text-tft-cyan-bright">
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────── Card ─────────────────────── */
function TournamentCard({ tournament: t }: { tournament: TftTournament }) {
  const isLive      = t.bracketStarted && !isCompleted(t);
  const completed   = isCompleted(t);
  const winner      = t.participants?.find((p) => p.isWinner);
  const favorite    = !winner && t.participants?.[0];

  const startLabel = new Date(t.startDate).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });

  return (
    <Link
      href={`/tournaments/${t.id}`}
      className={cn(
        'group relative rounded-xl p-5 transition-all cursor-pointer',
        'bg-card-arcane border border-tft-border',
        'hover:border-tft-purple/60 hover:shadow-arcane-md hover:-translate-y-0.5',
      )}
    >
      <div className="flex items-center justify-between mb-4">
        {completed ? (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-tft-bg-elevated border border-tft-border font-ui text-[10px] tracking-[0.18em] uppercase text-tft-text-dim">
            Terminé
          </span>
        ) : isLive ? (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-tft-rose/15 border border-tft-rose/40 font-ui text-[10px] tracking-[0.18em] uppercase text-tft-rose-bright">
            <span className="w-1.5 h-1.5 rounded-full bg-tft-rose animate-pulse-live" />
            Live
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-tft-cyan-dim border border-tft-cyan/30 font-ui text-[10px] tracking-[0.18em] uppercase text-tft-cyan-bright">
            <Calendar size={10} />
            {startLabel}
          </span>
        )}
        <span className="font-ui text-[10px] tracking-wider uppercase text-tft-text-muted">
          {t.tier}-Tier
        </span>
      </div>

      <h3 className="font-display font-semibold text-lg text-tft-text leading-snug mb-4 group-hover:text-arcane transition-all min-h-[3rem]">
        {t.name}
      </h3>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <p className="font-ui text-[9px] tracking-[0.22em] uppercase text-tft-text-muted mb-1">Prize pool</p>
          <p className="font-ui text-lg font-bold text-tft-gold-bright tabular-nums">
            {t.prizePool ?? '—'}
          </p>
        </div>
        <div>
          <p className="font-ui text-[9px] tracking-[0.22em] uppercase text-tft-text-muted mb-1">
            <Users size={9} className="inline mr-1" />
            Participants
          </p>
          <p className="font-ui text-lg font-bold text-tft-text tabular-nums">
            {t.participants?.length ?? '—'}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between pt-3 border-t border-tft-border">
        {winner ? (
          <>
            <div className="min-w-0 flex items-center gap-2">
              <Trophy size={14} className="text-tft-gold-bright shrink-0" />
              <div className="min-w-0">
                <p className="font-ui text-[9px] tracking-[0.22em] uppercase text-tft-text-muted mb-0.5">Vainqueur</p>
                <p className="text-sm text-tft-text font-medium truncate">{winner.name}</p>
              </div>
            </div>
          </>
        ) : favorite ? (
          <>
            <div className="min-w-0">
              <p className="font-ui text-[9px] tracking-[0.22em] uppercase text-tft-text-muted mb-0.5">Favori</p>
              <p className="text-sm text-tft-text font-medium truncate">{favorite.name}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="font-ui text-[9px] tracking-[0.22em] uppercase text-tft-text-muted mb-0.5">Côte</p>
              <p className="font-ui text-xl font-bold text-tft-purple-bright tabular-nums">
                {favorite.odds.toFixed(2)}×
              </p>
            </div>
          </>
        ) : (
          <p className="text-xs text-tft-text-muted">Participants à venir</p>
        )}
      </div>
    </Link>
  );
}

function isCompleted(t: TftTournament): boolean {
  if (!t.endDate) return false;
  return new Date(t.endDate).getTime() < Date.now() - 6 * 3600 * 1000;
}

/* ─────────────────────── Empty / loading ─────────────────────── */
function EmptyState({ status }: { status: StatusFilter }) {
  const label = status === 'live' ? 'live'
              : status === 'upcoming' ? 'à venir'
              : status === 'completed' ? 'terminé'
              : '';
  return (
    <div className="rounded-xl border border-tft-border bg-tft-bg-card/50 p-12 text-center">
      <Hexagon size={32} className="text-tft-purple-bright mx-auto mb-3 opacity-50" />
      <h3 className="font-display font-semibold text-xl text-tft-text mb-2">
        Aucun tournoi {label}
      </h3>
      <p className="text-sm text-tft-text-dim max-w-md mx-auto leading-relaxed">
        Le scraper Liquipedia tourne toutes les 30 minutes — si un nouveau tournoi est annoncé,
        il apparaîtra ici sans intervention. Pendant ce temps, jette un œil à{' '}
        <a href="https://liquipedia.net/tft/Portal:Tournaments" target="_blank" rel="noopener noreferrer" className="text-tft-cyan-bright hover:underline">
          le portail Liquipedia TFT
        </a>{' '}
        ou{' '}
        <Link href="/tournaments" onClick={(e) => { e.preventDefault(); window.history.back(); }} className="text-tft-cyan-bright hover:underline">
          change le filtre
        </Link>.
      </p>
    </div>
  );
}

function GridSkeleton({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl p-5 bg-card-arcane border border-tft-border animate-pulse">
          <div className="flex items-center justify-between mb-4">
            <div className="w-14 h-4 rounded bg-tft-bg-elevated" />
            <div className="w-10 h-3 rounded bg-tft-bg-elevated" />
          </div>
          <div className="w-3/4 h-5 mb-2 rounded bg-tft-bg-elevated" />
          <div className="w-1/2 h-5 mb-6 rounded bg-tft-bg-elevated" />
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="space-y-2"><div className="h-3 w-16 rounded bg-tft-bg-elevated" /><div className="h-5 w-20 rounded bg-tft-bg-elevated" /></div>
            <div className="space-y-2"><div className="h-3 w-16 rounded bg-tft-bg-elevated" /><div className="h-5 w-12 rounded bg-tft-bg-elevated" /></div>
          </div>
          <div className="pt-3 border-t border-tft-border flex items-center justify-between">
            <div className="space-y-1.5"><div className="h-3 w-12 rounded bg-tft-bg-elevated" /><div className="h-4 w-20 rounded bg-tft-bg-elevated" /></div>
            <div className="space-y-1.5 text-right"><div className="h-3 w-10 rounded bg-tft-bg-elevated ml-auto" /><div className="h-5 w-14 rounded bg-tft-bg-elevated ml-auto" /></div>
          </div>
        </div>
      ))}
    </div>
  );
}
