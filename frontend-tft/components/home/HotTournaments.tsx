'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Hexagon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getTftTournaments, type TftTournament } from '@/lib/api';

/**
 * Below-the-fold grid of tournament cards. Mixes live + upcoming so the
 * top of the list has the pulsing red LIVE badges (high signal that
 * something is happening *right now*), and the rest of the grid fills
 * with upcoming events as warm-up content.
 *
 * Distinct from the /tournaments listing page in that we only render up
 * to 6 cards here ; the full list with filters lives on the dedicated
 * page.
 */
export function HotTournaments() {
  const [tournaments, setTournaments] = useState<TftTournament[] | null>(null);
  const [error, setError]             = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getTftTournaments({ status: 'live',     limit: 3 }),
      getTftTournaments({ status: 'upcoming', limit: 6 }),
    ])
      .then(([live, upcoming]) => {
        if (cancelled) return;
        setTournaments([...live, ...upcoming].slice(0, 6));
      })
      .catch((e) => {
        // Without this catch the promise rejects silently and the UI
        // stays on its skeleton state forever — looks broken. CORS
        // rejections and 500s from the backend both surface here.
        if (cancelled) return;
        setTournaments([]);
        setError(e instanceof Error ? e.message : 'Erreur réseau');
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <section className="relative border-t border-tft-border bg-tft-bg">
      <div className="absolute inset-0 bg-hex-grid opacity-[0.03] pointer-events-none" aria-hidden="true" />
      <div className="relative max-w-7xl mx-auto px-4 md:px-6 py-10">
        <div className="flex items-end justify-between mb-4">
          <div>
            <p className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-text-muted mb-1">
              Live + à venir
            </p>
            <h2 className="font-display font-semibold text-xl md:text-2xl text-tft-text leading-tight">
              Tournois ouverts aux paris
            </h2>
          </div>
          <Link
            href="/tournaments"
            className="hidden md:inline-flex items-center gap-1 text-tft-text-dim hover:text-tft-text transition-colors text-xs font-ui tracking-wider uppercase"
          >
            Tous
            <ChevronRight size={12} />
          </Link>
        </div>

        {tournaments === null && <GridSkeleton />}

        {tournaments && tournaments.length === 0 && (
          <div className="rounded-md border border-tft-border bg-tft-bg-card/50 p-8 text-center text-sm text-tft-text-muted">
            Aucun tournoi S/A ouvert pour l&apos;instant. Reviens dans 30 min — le scraper Liquipedia tourne en boucle.
          </div>
        )}

        {tournaments && tournaments.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
            {tournaments.map((t) => <Card key={t.id} t={t} />)}
          </div>
        )}
      </div>
    </section>
  );
}

function Card({ t }: { t: TftTournament }) {
  const isLive    = t.bracketStarted;
  const favourite = t.participants?.[0];
  const startLabel = new Date(t.startDate).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });

  return (
    <Link
      href={`/tournaments/${t.id}`}
      className={cn(
        'group relative rounded-md p-4 transition-colors cursor-pointer',
        'bg-tft-bg-card border border-tft-border',
        'hover:border-tft-purple/60',
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="font-ui text-[10px] tracking-wider uppercase text-tft-text-muted">
            {t.tier}-Tier
          </span>
          {isLive && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-tft-rose/15 border border-tft-rose/40 font-ui text-[9px] tracking-[0.16em] uppercase text-tft-rose-bright">
              <span className="w-1 h-1 rounded-full bg-tft-rose animate-pulse-live" />
              Live
            </span>
          )}
        </div>
        {!isLive && (
          <span className="font-ui text-[10px] tracking-wider uppercase text-tft-text-dim">
            {startLabel}
          </span>
        )}
      </div>

      <h3 className="font-display font-semibold text-base text-tft-text leading-snug mb-3 min-h-[2.5rem] group-hover:text-tft-purple-bright transition-colors">
        {t.name}
      </h3>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <div>
          <p className="font-ui text-[8px] tracking-[0.22em] uppercase text-tft-text-muted mb-0.5">Prize</p>
          <p className="font-ui text-sm font-bold text-tft-gold-bright tabular-nums leading-tight truncate">
            {t.prizePool ?? '—'}
          </p>
        </div>
        <div>
          <p className="font-ui text-[8px] tracking-[0.22em] uppercase text-tft-text-muted mb-0.5">Joueurs</p>
          <p className="font-ui text-sm font-bold text-tft-text tabular-nums leading-tight">
            {t.participants?.length ?? '—'}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between pt-2.5 border-t border-tft-border">
        {favourite ? (
          <>
            <div className="min-w-0">
              <p className="text-[11px] text-tft-text font-medium truncate">{favourite.name}</p>
              <p className="text-[9px] text-tft-text-muted">Favori</p>
            </div>
            <p className="font-ui text-lg font-bold text-tft-purple-bright tabular-nums shrink-0">
              {favourite.odds.toFixed(2)}×
            </p>
          </>
        ) : (
          <p className="text-[11px] text-tft-text-muted">Participants à venir</p>
        )}
      </div>
    </Link>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="rounded-md p-4 bg-card-arcane border border-tft-border animate-pulse">
          <div className="h-3 w-12 mb-3 rounded bg-tft-bg-elevated" />
          <div className="h-5 w-3/4 mb-2 rounded bg-tft-bg-elevated" />
          <div className="h-5 w-1/2 mb-3 rounded bg-tft-bg-elevated" />
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="space-y-1"><div className="h-2 w-10 rounded bg-tft-bg-elevated" /><div className="h-4 w-16 rounded bg-tft-bg-elevated" /></div>
            <div className="space-y-1"><div className="h-2 w-10 rounded bg-tft-bg-elevated" /><div className="h-4 w-10 rounded bg-tft-bg-elevated" /></div>
          </div>
          <div className="pt-2 border-t border-tft-border flex items-center justify-between">
            <div className="space-y-1"><div className="h-3 w-16 rounded bg-tft-bg-elevated" /><div className="h-2 w-10 rounded bg-tft-bg-elevated" /></div>
            <div className="h-5 w-12 rounded bg-tft-bg-elevated" />
          </div>
        </div>
      ))}
    </div>
  );
}

void Hexagon; // suppress lucide tree-shake oddities
