'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Hexagon, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getTftTournaments, type TftTournament, type TftParticipant } from '@/lib/api';
import {
  connectTftSocket,
  onTftStandings,
  onTftTournamentChanged,
} from '@/lib/socket';

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

  // Coalesce socket-driven refreshes : a noisy burst of `tft:standings`
  // shouldn't trigger 20 simultaneous API calls. We debounce 800ms so
  // multiple rank updates within the same poll cycle collapse into one
  // refetch.
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const [live, upcoming] = await Promise.all([
          getTftTournaments({ status: 'live',     limit: 3 }),
          getTftTournaments({ status: 'upcoming', limit: 6 }),
        ]);
        if (cancelled) return;
        setTournaments([...live, ...upcoming].slice(0, 6));
        setError(null);
      } catch (e) {
        // Keep the previous list on error — only flip to empty state if
        // we never managed an initial load. Without this guard one CORS
        // hiccup mid-session would wipe a populated grid.
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Erreur réseau');
        setTournaments((prev) => prev ?? []);
      }
    }

    function scheduleRefresh() {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        if (!cancelled) refresh();
      }, 800);
    }

    // ── Initial load + fallback polling ────────────────────────────────
    // Socket.io carries the "live" updates, but we keep a slow poll
    // (60s instead of 20s) as a safety net : if the socket disconnects
    // silently or the backend missed an emit (e.g. failed import), the
    // poll catches up. 60s is invisible to users compared to socket
    // pushes that land in <100ms.
    refresh();
    const pollId = setInterval(refresh, 60_000);

    // ── Socket subscription for instant updates ────────────────────────
    connectTftSocket(); // anonymous connection — read-only, no auth needed
    const offStandings = onTftStandings(scheduleRefresh);
    const offTournament = onTftTournamentChanged(scheduleRefresh);

    return () => {
      cancelled = true;
      clearInterval(pollId);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      offStandings();
      offTournament();
    };
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
            Aucun tournois ouvert pour l&apos;instant.
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
  // Sort by best odds (lowest = favourite) and take top 3 to show as bet
  // shortcuts. 3 fits the card width and matches AoM's H2H "2 picks + draw"
  // density. Players with no odds yet are pushed to the back.
  const topPicks = [...(t.participants ?? [])]
    .sort((a, b) => (a.odds || 999) - (b.odds || 999))
    .slice(0, 3);
  const totalPlayers = t.participants?.length ?? 0;
  const startLabel = new Date(t.startDate).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });

  return (
    <Link
      href={`/tournaments/${t.id}`}
      className={cn(
        'group relative rounded-md p-4 transition-colors cursor-pointer flex flex-col',
        'bg-tft-bg-card border border-tft-border',
        'hover:border-tft-purple/60',
      )}
    >
      {/* Top row : tier · live/date */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <span className="font-ui text-[10px] tracking-wider uppercase text-tft-text-muted">
            {t.tier}-Tier
          </span>
          {isLive ? (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-tft-rose/15 border border-tft-rose/40 font-ui text-[9px] tracking-[0.16em] uppercase text-tft-rose-bright">
              <span className="w-1 h-1 rounded-full bg-tft-rose animate-pulse-live" />
              Live
            </span>
          ) : (
            <span className="font-ui text-[10px] tracking-wider uppercase text-tft-text-dim">
              {startLabel}
            </span>
          )}
        </div>
        <span className="inline-flex items-center gap-1 font-ui text-[10px] tracking-wider uppercase text-tft-text-muted">
          <Users size={10} />
          {totalPlayers || '—'}
        </span>
      </div>

      {/* Tournament name */}
      <h3 className="font-display font-semibold text-[15px] text-tft-text leading-snug mb-3 min-h-[2.4rem] group-hover:text-tft-purple-bright transition-colors line-clamp-2">
        {t.name}
      </h3>

      {/* Pick rows — the heart of the card. 3 mini-rows (avatar + name + odds) */}
      <div className="space-y-1 mb-3">
        {topPicks.length > 0 ? (
          topPicks.map((p, i) => <PickRow key={p.id} pick={p} highlight={i === 0} />)
        ) : (
          <div className="text-[11px] text-tft-text-muted px-2 py-3 text-center border border-dashed border-tft-border rounded-sm">
            Participants pas encore publiés
          </div>
        )}
      </div>

      {/* Footer CTA */}
      <div className="mt-auto pt-2.5 border-t border-tft-border flex items-center justify-between">
        <span className="font-ui text-[10px] tracking-[0.18em] uppercase text-tft-text-muted">
          {totalPlayers > 3 ? `+${totalPlayers - 3} autres` : 'Voir le tournoi'}
        </span>
        <span className="inline-flex items-center gap-1 font-ui text-[11px] font-semibold tracking-wider uppercase text-tft-purple-bright group-hover:translate-x-0.5 transition-transform">
          Parier
          <ChevronRight size={12} />
        </span>
      </div>
    </Link>
  );
}

/**
 * One pick row inside a tournament card. Renders compactly with country
 * flag, name, and odds pill. The "highlight" treatment is reserved for
 * the favourite (best odds) so it draws the eye first.
 */
function PickRow({ pick, highlight }: { pick: TftParticipant; highlight: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-2 py-1.5 rounded-sm border transition-colors',
        highlight
          ? 'bg-tft-purple/[0.08] border-tft-purple/30'
          : 'bg-tft-bg/40 border-tft-border',
      )}
    >
      {pick.country ? (
        <span className="text-sm leading-none shrink-0">{pick.country}</span>
      ) : (
        <span className="w-4 h-4 rounded-sm bg-tft-bg-elevated shrink-0" />
      )}
      <span className="flex-1 min-w-0 text-[11.5px] text-tft-text truncate">
        {pick.name}
      </span>
      <span
        className={cn(
          'font-ui font-bold text-[12px] tabular-nums shrink-0',
          highlight ? 'text-tft-purple-bright' : 'text-tft-text-dim',
        )}
      >
        {pick.odds > 0 ? `${pick.odds.toFixed(2)}×` : '—'}
      </span>
    </div>
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
