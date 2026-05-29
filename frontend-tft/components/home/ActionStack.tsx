'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession, signIn } from 'next-auth/react';
import {
  Wallet, ArrowRight, Flame, ChevronRight, Sparkles, Hexagon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getTftTournaments, type TftTournament, type TftParticipant } from '@/lib/api';

/**
 * "Above-the-fold action zone" — the left 60 % of the hero. Goal is to
 * collapse the time-to-bet from 3 clicks to 1 :
 *   1. If logged out → giant Steam login
 *   2. If logged in  → balance pill + deposit shortcut
 *   3. Live Now mini-cards (3-4 favourites of a live tournament, each
 *      a direct deep-link to the tournament page with the favourite
 *      preselected)
 *   4. Hot Pick — a single bigger card with a "🔥 -15%" badge,
 *      designed to draw the eye even when nothing is moving elsewhere.
 *
 * No marketing copy. The only words are pseudo-data labels (LIVE NOW,
 * HOT PICK) and odds. Marketing copy goes to /how-it-works (linked
 * discreetly in the footer of this stack).
 */
export function ActionStack() {
  const { data: session, status } = useSession();
  const [live, setLive]         = useState<TftTournament[] | null>(null);
  const [hotPick, setHotPick]   = useState<{ tournament: TftTournament; favourite: TftParticipant } | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getTftTournaments({ status: 'live',     limit: 1 }),
      getTftTournaments({ status: 'upcoming', limit: 4 }),
    ]).then(([liveT, upcoming]) => {
      if (cancelled) return;
      const merged = [...liveT, ...upcoming].slice(0, 1);
      setLive(merged);
      // Pick the "hot" tournament : prefer live, fall back to next upcoming.
      // Use participant index 2 (third favourite) as the "hot pick" so it
      // feels like a contrarian tip rather than just regurgitating the
      // obvious favourite.
      const featured = merged[0];
      if (featured && featured.participants && featured.participants.length >= 3) {
        setHotPick({ tournament: featured, favourite: featured.participants[2] });
      } else if (featured && featured.participants && featured.participants.length >= 1) {
        setHotPick({ tournament: featured, favourite: featured.participants[0] });
      }
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-4">
      {/* ── Identity / wallet card ─────────────────────────────────── */}
      {status === 'authenticated' && session?.user ? (
        <WalletCard coins={session.user.coins ?? 0} name={session.user.name ?? 'Tactician'} />
      ) : (
        <LoginSteamCard />
      )}

      {/* ── Live Now grid ──────────────────────────────────────────── */}
      <LiveNowGrid live={live} />

      {/* ── Hot Pick ───────────────────────────────────────────────── */}
      {hotPick && <HotPickCard pick={hotPick} />}

      {/* ── Tiny how-it-works footer line ──────────────────────────── */}
      <p className="text-[11px] text-tft-text-faint">
        Première fois ici ?{' '}
        <Link href="/how-it-works" className="underline hover:text-tft-cyan-bright transition-colors">
          Comment ça marche
        </Link>
      </p>
    </div>
  );
}

/* ─────────────────────── Wallet card (logged-in) ─────────────────────── */
function WalletCard({ coins, name }: { coins: number; name: string }) {
  const usd = (coins / 1.69).toFixed(2);
  return (
    <div className="rounded-xl border border-tft-purple/40 bg-card-arcane ring-arcane p-4 md:p-5 flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <p className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-text-muted">
          Salut <span className="text-tft-text">{name}</span>
        </p>
        <div className="flex items-end gap-3 mt-1">
          <p className="font-display font-bold text-3xl md:text-4xl text-tft-gold-bright tabular-nums leading-none">
            {new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(coins)}
            <span className="text-xl ml-1">◈</span>
          </p>
          <p className="text-xs text-tft-text-muted mb-1">≈ ${usd}</p>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Link
          href="/deposit"
          className="px-4 py-2 rounded-md bg-tft-mint/15 border border-tft-mint/50 hover:bg-tft-mint/25 font-ui text-[11px] uppercase tracking-wider text-tft-mint transition-colors cursor-pointer text-center"
        >
          + Dépôt
        </Link>
        <Link
          href="/withdraw"
          className="px-4 py-2 rounded-md bg-tft-bg-card border border-tft-border hover:border-tft-gold/40 font-ui text-[11px] uppercase tracking-wider text-tft-text-dim hover:text-tft-gold-bright transition-colors cursor-pointer text-center"
        >
          Retrait
        </Link>
      </div>
    </div>
  );
}

/* ─────────────────────── Login Steam (logged-out) ─────────────────────── */
function LoginSteamCard() {
  return (
    <div className="relative rounded-xl border border-tft-rose/40 bg-card-arcane overflow-hidden">
      <div className="absolute inset-0 bg-hex-grid opacity-10 pointer-events-none" aria-hidden="true" />
      <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-tft-rose/15 blur-3xl pointer-events-none" aria-hidden="true" />

      <div className="relative p-5 md:p-6 flex items-center gap-5">
        <div className="flex-1 min-w-0">
          <p className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-rose-bright mb-1.5 flex items-center gap-2">
            <Sparkles size={11} className="text-tft-cyan-bright" />
            Bonus de bienvenue · 25 ◈
          </p>
          <h2 className="font-display font-bold text-2xl md:text-3xl text-tft-text leading-tight">
            Connecte-toi et commence à parier
          </h2>
          <p className="text-xs text-tft-text-muted mt-1">
            Pas d&apos;email, pas de mot de passe — un clic Steam, et le bonus est crédité au premier dépôt de 10 ◈.
          </p>
        </div>
        <button
          onClick={() => signIn('steam')}
          className={cn(
            'shrink-0 inline-flex items-center justify-center gap-2.5',
            'px-6 md:px-7 py-3.5 md:py-4 rounded-md cursor-pointer',
            'font-ui font-bold text-[13px] tracking-[0.18em] uppercase text-white',
            'bg-gradient-rose animate-glow-cta',
          )}
        >
          <SteamIcon />
          Steam
        </button>
      </div>
    </div>
  );
}

function SteamIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.003.187.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.029 4.524 4.524s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.718L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0z"/>
    </svg>
  );
}

/* ─────────────────────── Live Now grid ─────────────────────── */
function LiveNowGrid({ live }: { live: TftTournament[] | null }) {
  if (live === null) return <LiveNowSkeleton />;
  if (live.length === 0) {
    return (
      <div className="rounded-xl border border-tft-border bg-tft-bg-card/50 p-5">
        <div className="flex items-center justify-between mb-2">
          <p className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-cyan-bright">À venir</p>
          <Link href="/tournaments" className="text-tft-text-muted hover:text-tft-cyan-bright text-xs font-ui transition-colors inline-flex items-center gap-1">
            Tous <ChevronRight size={12} />
          </Link>
        </div>
        <p className="text-sm text-tft-text-muted">
          Pas de tournoi S/A ouvert au pari. Le scrape Liquipedia tourne toutes les 30 min.
        </p>
      </div>
    );
  }

  const tournament   = live[0];
  const isLive       = tournament.bracketStarted;
  const participants = (tournament.participants ?? []).slice(0, 4);

  return (
    <div className="rounded-xl border border-tft-border bg-card-arcane overflow-hidden">
      {/* Header strip */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-tft-border bg-tft-bg/60">
        <div className="flex items-center gap-2.5 min-w-0">
          {isLive ? (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-tft-rose/15 border border-tft-rose/40 font-ui text-[9px] tracking-[0.22em] uppercase text-tft-rose-bright">
              <span className="w-1.5 h-1.5 rounded-full bg-tft-rose animate-pulse-live" />
              Live
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-tft-cyan-dim border border-tft-cyan/40 font-ui text-[9px] tracking-[0.22em] uppercase text-tft-cyan-bright">
              À venir
            </span>
          )}
          <Link href={`/tournaments/${tournament.id}`} className="font-display font-semibold text-base text-tft-text hover:text-tft-purple-bright truncate transition-colors">
            {tournament.name}
          </Link>
        </div>
        <Link href={`/tournaments/${tournament.id}`} className="text-tft-text-muted hover:text-tft-cyan-bright text-xs font-ui transition-colors inline-flex items-center gap-1 shrink-0">
          Voir <ChevronRight size={12} />
        </Link>
      </div>

      {/* Participants grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-tft-border">
        {participants.map((p) => (
          <Link
            key={p.id}
            href={`/tournaments/${tournament.id}?pick=${p.id}`}
            className="group p-3 hover:bg-tft-purple/10 transition-colors cursor-pointer"
          >
            <p className="text-[11px] text-tft-text-dim truncate">{p.name}</p>
            <p className="font-ui font-bold text-xl text-tft-purple-bright tabular-nums mt-0.5">
              {p.odds.toFixed(2)}×
            </p>
            <p className="text-[9px] tracking-[0.22em] uppercase text-tft-text-muted mt-1 group-hover:text-tft-rose-bright transition-colors">
              Parier →
            </p>
          </Link>
        ))}
        {participants.length === 0 && (
          <div className="col-span-4 p-4 text-center text-xs text-tft-text-muted">
            Participants en attente de Liquipedia
          </div>
        )}
      </div>
    </div>
  );
}

function LiveNowSkeleton() {
  return (
    <div className="rounded-xl border border-tft-border bg-card-arcane animate-pulse">
      <div className="h-9 bg-tft-bg-elevated/50 border-b border-tft-border" />
      <div className="grid grid-cols-4 divide-x divide-tft-border">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="p-3 space-y-2">
            <div className="h-3 w-16 rounded bg-tft-bg-elevated" />
            <div className="h-5 w-12 rounded bg-tft-bg-elevated" />
            <div className="h-2 w-10 rounded bg-tft-bg-elevated" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────── Hot Pick card ─────────────────────── */
function HotPickCard({ pick }: { pick: { tournament: TftTournament; favourite: TftParticipant } }) {
  return (
    <Link
      href={`/tournaments/${pick.tournament.id}?pick=${pick.favourite.id}`}
      className={cn(
        'group relative block rounded-xl border-2 border-tft-gold/40 bg-card-arcane overflow-hidden',
        'hover:border-tft-gold-bright transition-all shadow-gold-md',
      )}
    >
      <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full bg-tft-gold/15 blur-3xl pointer-events-none" aria-hidden="true" />

      <div className="relative flex items-center gap-4 p-4">
        {/* Hot badge */}
        <div className="shrink-0 w-12 h-12 rounded-md bg-tft-gold/20 border border-tft-gold/50 flex items-center justify-center animate-badge-pulse">
          <Flame size={22} className="text-tft-gold-bright" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-ui text-[9px] tracking-[0.22em] uppercase font-bold text-tft-gold-bright">
              Hot Pick
            </span>
            <span className="font-ui text-[9px] tracking-[0.18em] uppercase text-tft-rose-bright bg-tft-rose/15 border border-tft-rose/30 rounded px-1.5 py-0.5">
              -15 % côte
            </span>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <p className="font-display font-bold text-lg md:text-xl text-tft-text truncate">
              {pick.favourite.name}
            </p>
            {pick.favourite.country && <span className="text-base shrink-0">{pick.favourite.country}</span>}
          </div>
          <p className="text-xs text-tft-text-muted truncate">{pick.tournament.name}</p>
        </div>

        <div className="text-right shrink-0">
          <p className="font-ui text-[9px] tracking-[0.22em] uppercase text-tft-text-muted mb-0.5">Côte</p>
          <p className="font-display font-bold text-2xl md:text-3xl text-tft-gold-bright tabular-nums leading-none">
            {pick.favourite.odds.toFixed(2)}×
          </p>
          <p className="font-ui text-[9px] tracking-[0.18em] uppercase text-tft-rose-bright mt-1 group-hover:translate-x-0.5 transition-transform inline-flex items-center gap-0.5">
            Parier <ArrowRight size={10} />
          </p>
        </div>
      </div>
    </Link>
  );
}

void Hexagon; // re-export safety in case caller bundles lucide chunk
