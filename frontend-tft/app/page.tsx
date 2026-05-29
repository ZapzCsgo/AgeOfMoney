'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Sparkles, ShieldCheck, Zap, Headphones, ChevronRight, ChevronDown,
  Trophy, Users, Coins, ArrowRight, Hexagon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getTftTournaments, type TftTournament } from '@/lib/api';

const TRUST_ITEMS = [
  {
    icon: ShieldCheck,
    title: 'Sources officielles',
    body: 'Standings live sourcés depuis CompeteTFT (plateforme officielle Riot) avec fallback Liquipedia. Settlement automatique dès la fin du tournoi — pas de jugement manuel.',
  },
  {
    icon: Zap,
    title: 'Dépôts instantanés',
    body: 'BTC, ETH, USDT, LTC, SOL crédités en moins de 2 minutes après confirmation. Retraits traités sous 5 minutes en moyenne — pas de KYC tant que tu restes sous 1 000 $/mois.',
  },
  {
    icon: Headphones,
    title: 'Support 24/7',
    body: 'Une équipe FR/EN dispo en ticket et sur Discord. Réponse moyenne sous 15 minutes. Litiges traités sous 24 h.',
  },
];

const STEPS = [
  { n: '01', icon: Users,  title: 'Connecte-toi avec Steam', body: 'Un clic. Pas d\'email à saisir, pas de mot de passe à retenir.' },
  { n: '02', icon: Coins,  title: 'Dépose en crypto',         body: 'Choisis ta monnaie, scanne le QR, et tes coins ◈ apparaissent en moins de 2 minutes.' },
  { n: '03', icon: Trophy, title: 'Parie sur les tournois',   body: 'Sélectionne ton tactician favori, fixe ta mise, encaisse à la fin de la finale.' },
];

const FAQS = [
  {
    q: 'Pourquoi un site dédié à TFT ?',
    a: 'Parce qu\'aucune plateforme grand public ne propose des odds décentes sur Set Championships, Tactician\'s Trials ou la TFT Open Series. On fixe nos odds à la main à partir des stats Riot solo queue + tournament history et on les ajuste en direct.',
  },
  {
    q: 'Sur quoi puis-je parier exactement ?',
    a: 'Pour l\'instant : Tournament Winner (qui gagne un tournoi entier). Les marchés Top 4 et Lobby Winner arrivent dès qu\'on a assez de données live pour les pricer correctement.',
  },
  {
    q: 'Vous êtes affiliés à Riot ?',
    a: 'Non. tft.money est une initiative indépendante de fans. Teamfight Tactics™ est une marque déposée de Riot Games, Inc.',
  },
  {
    q: 'Comment êtes-vous régulés ?',
    a: 'tft.money fonctionne avec des coins virtuels (◈) — pas une devise réglementée. C\'est un service de divertissement pour adultes (18+). Voir les Conditions d\'utilisation pour les détails complets.',
  },
];

export default function HomePage() {
  return (
    <div className="relative">
      <Hero />
      <FeaturedTournaments />
      <HowItWorks />
      <TrustSignals />
      <FinalCta />
      <Faq />
    </div>
  );
}

/* ────────────────────────────── HERO ────────────────────────────── */
function Hero() {
  return (
    <section className="relative overflow-hidden bg-hero-arcane">
      <div className="absolute inset-0 bg-hex-grid opacity-20 animate-hex-pulse pointer-events-none" aria-hidden="true" />
      <div className="absolute -top-20 -left-32 w-[480px] h-[480px] rounded-full bg-tft-purple/15 blur-[120px] pointer-events-none" aria-hidden="true" />
      <div className="absolute -bottom-32 -right-32 w-[520px] h-[520px] rounded-full bg-tft-cyan/10 blur-[140px] pointer-events-none" aria-hidden="true" />

      <div className="relative max-w-6xl mx-auto px-6 py-24 md:py-32 grid md:grid-cols-2 gap-12 items-center">
        <div className="space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-tft-purple/40 bg-tft-purple/10 backdrop-blur-sm">
            <Sparkles size={12} className="text-tft-cyan-bright" />
            <span className="font-ui text-[11px] tracking-[0.22em] uppercase text-tft-purple-bright">
              Saison TFT 14 · Live
            </span>
          </div>
          <h1 className="font-display font-bold text-5xl md:text-6xl lg:text-7xl leading-[1.05] tracking-tight">
            <span className="text-tft-text">Parie sur la scène</span>
            <br />
            <span className="text-arcane">Teamfight&nbsp;Tactics</span>
          </h1>
          <p className="text-tft-text-dim text-base md:text-lg max-w-xl leading-relaxed">
            Tournois Set Championship, Tactician&apos;s Trials, Open Series : tft.money est la seule plateforme
            qui suit la scène TFT compétitive en temps réel. Odds maison, dépôts crypto instantanés, retraits sous 5&nbsp;minutes.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <Link
              href="/tournaments"
              className="group inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-md cursor-pointer font-ui font-semibold text-[13px] tracking-[0.18em] uppercase text-white bg-gradient-rose shadow-rose-md hover:shadow-arcane-md transition-all"
            >
              Voir les tournois en cours
              <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <Link
              href="/how-it-works"
              className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-md cursor-pointer font-ui font-semibold text-[13px] tracking-[0.18em] uppercase text-tft-text-dim border border-tft-border bg-tft-bg-card/50 hover:border-tft-purple/60 hover:text-tft-text transition-all"
            >
              Comment ça marche
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-4 pt-4 text-tft-text-muted text-xs">
            <div className="flex items-center gap-1.5"><ShieldCheck size={13} className="text-tft-mint" /> Sources officielles</div>
            <div className="flex items-center gap-1.5"><Zap        size={13} className="text-tft-cyan-bright" /> Crypto · 2 min</div>
            <div className="flex items-center gap-1.5"><Coins      size={13} className="text-tft-gold-bright" /> Retraits instantanés</div>
          </div>
        </div>
        <div className="relative hidden md:block">
          <HexArena />
        </div>
      </div>
    </section>
  );
}

function HexArena() {
  const cells = [
    { x: 160, y: 90,  fill: '#7c3aed', aura: '#a78bfa', cost: 5 },
    { x: 100, y: 130, fill: '#22d3ee', aura: '#67e8f9', cost: 4 },
    { x: 220, y: 130, fill: '#fbbf24', aura: '#fcd34d', cost: 4 },
    { x: 160, y: 170, fill: '#f43f5e', aura: '#fb7185', cost: 3 },
    { x: 60,  y: 170, fill: '#34d399', aura: '#6ee7b7', cost: 2 },
    { x: 260, y: 170, fill: '#a78bfa', aura: '#c4b5fd', cost: 3 },
    { x: 160, y: 220, fill: '#22d3ee', aura: '#67e8f9', cost: 4 },
  ];
  const hexPath = 'M0 -28 L24 -14 L24 14 L0 28 L-24 14 L-24 -14 Z';

  return (
    <div className="relative w-full max-w-[420px] mx-auto aspect-[4/5] animate-float">
      <div className="absolute inset-0 rounded-full bg-tft-purple-glow blur-3xl opacity-40" aria-hidden="true" />
      <svg viewBox="0 0 320 340" className="relative w-full h-full">
        <defs>
          <radialGradient id="board-bg" cx="50%" cy="50%" r="60%">
            <stop offset="0%"  stopColor="#1a1644" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#08081a" stopOpacity="0" />
          </radialGradient>
          <filter id="aura" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>
        <ellipse cx="160" cy="160" rx="150" ry="140" fill="url(#board-bg)" />
        {cells.map((c, i) => (
          <g key={i} transform={`translate(${c.x} ${c.y})`}>
            <path d={hexPath} fill={c.aura} opacity="0.35" filter="url(#aura)" />
            <path d={hexPath} fill="#0d0b20" stroke={c.fill} strokeWidth="2" />
            <path d={hexPath} fill={c.fill} fillOpacity="0.2" />
            <text x="0" y="6" textAnchor="middle" fontSize="14" fontWeight="700"
              fill={c.aura} fontFamily="var(--font-chakra)">{c.cost}</text>
          </g>
        ))}
        <g stroke="#7c3aed" strokeOpacity="0.25" strokeWidth="0.5">
          <line x1="100" y1="130" x2="160" y2="90" />
          <line x1="220" y1="130" x2="160" y2="90" />
          <line x1="160" y1="170" x2="100" y2="130" />
          <line x1="160" y1="170" x2="220" y2="130" />
          <line x1="60"  y1="170" x2="100" y2="130" />
          <line x1="260" y1="170" x2="220" y2="130" />
          <line x1="160" y1="220" x2="160" y2="170" />
        </g>
      </svg>
      <div className="absolute -top-4 -right-2 px-3 py-2 rounded-lg border border-tft-cyan/40 bg-tft-bg-card/90 backdrop-blur-md shadow-cyan-md font-ui">
        <p className="text-[9px] tracking-[0.22em] uppercase text-tft-text-muted mb-0.5">Live odds</p>
        <p className="text-tft-cyan-bright text-lg font-bold tabular-nums">3.20×</p>
      </div>
      <div className="absolute -bottom-2 -left-4 px-3 py-2 rounded-lg border border-tft-gold/40 bg-tft-bg-card/90 backdrop-blur-md shadow-gold-md font-ui">
        <p className="text-[9px] tracking-[0.22em] uppercase text-tft-text-muted mb-0.5">Payout</p>
        <p className="text-tft-gold-bright text-lg font-bold tabular-nums">+ 1 248 ◈</p>
      </div>
    </div>
  );
}

/* ──────────────────── FEATURED TOURNAMENTS — REAL DATA ──────────────────── */
function FeaturedTournaments() {
  const [tournaments, setTournaments] = useState<TftTournament[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getTftTournaments({ status: 'live',     limit: 3 }),
      getTftTournaments({ status: 'upcoming', limit: 3 }),
    ])
      .then(([live, upcoming]) => {
        if (cancelled) return;
        // Live tournaments first, then upcoming. Cap at 3 total so the grid
        // stays a single row across breakpoints.
        const merged = [...live, ...upcoming].slice(0, 3);
        setTournaments(merged);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Erreur');
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <section className="relative py-20 md:py-24 border-t border-tft-border bg-tft-bg">
      <div className="absolute inset-0 bg-hex-grid-cyan opacity-[0.04] pointer-events-none" aria-hidden="true" />
      <div className="relative max-w-6xl mx-auto px-6">
        <div className="flex items-end justify-between mb-10">
          <div>
            <p className="font-ui text-[11px] tracking-[0.22em] uppercase text-tft-purple-bright mb-2">
              À l&apos;affiche
            </p>
            <h2 className="font-display font-bold text-3xl md:text-4xl text-tft-text">
              Tournois en cours et à venir
            </h2>
          </div>
          <Link
            href="/tournaments"
            className="hidden md:flex items-center gap-1 text-tft-text-dim hover:text-tft-cyan-bright transition-colors text-sm font-ui"
          >
            Voir tous
            <ChevronRight size={14} />
          </Link>
        </div>

        {error && (
          <div className="rounded-xl border border-tft-rose/40 bg-tft-rose/10 p-5 text-tft-rose-bright text-sm">
            Impossible de charger les tournois — {error}.{' '}
            <Link href="/tournaments" className="underline hover:opacity-80">Réessayer</Link>
          </div>
        )}

        {!error && tournaments === null && <TournamentGridSkeleton />}

        {!error && tournaments !== null && tournaments.length === 0 && (
          <div className="rounded-xl border border-tft-border bg-tft-bg-card/50 p-10 text-center text-tft-text-dim text-sm">
            Aucun tournoi S/A ouvert aux paris en ce moment. Le prochain est annoncé sur{' '}
            <a href="https://twitter.com/TFT_Esports" target="_blank" rel="noopener noreferrer" className="text-tft-cyan-bright hover:underline">@TFT_Esports</a>.
          </div>
        )}

        {!error && tournaments !== null && tournaments.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {tournaments.map((t) => <TournamentCard key={t.id} tournament={t} />)}
          </div>
        )}

        <Link
          href="/tournaments"
          className="mt-8 md:hidden flex items-center justify-center gap-1 text-tft-cyan-bright hover:opacity-80 transition-opacity text-sm font-ui"
        >
          Voir tous les tournois <ChevronRight size={14} />
        </Link>
      </div>
    </section>
  );
}

function TournamentCard({ tournament: t }: { tournament: TftTournament }) {
  const isLive = t.bracketStarted;
  const favorite = t.participants?.[0]; // backend orders by odds asc
  const startLabel = new Date(t.startDate).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short',
  });

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
        {isLive ? (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-tft-rose/15 border border-tft-rose/40 font-ui text-[10px] tracking-[0.18em] uppercase text-tft-rose-bright">
            <span className="w-1.5 h-1.5 rounded-full bg-tft-rose animate-pulse-live" />
            Live
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-tft-cyan-dim border border-tft-cyan/30 font-ui text-[10px] tracking-[0.18em] uppercase text-tft-cyan-bright">
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
          <p className="font-ui text-[9px] tracking-[0.22em] uppercase text-tft-text-muted mb-1">Participants</p>
          <p className="font-ui text-lg font-bold text-tft-text tabular-nums">
            {t.participants?.length ?? '—'}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between pt-3 border-t border-tft-border">
        {favorite ? (
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
          <p className="text-xs text-tft-text-muted">Liste des participants à venir</p>
        )}
      </div>
    </Link>
  );
}

function TournamentGridSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-xl p-5 bg-card-arcane border border-tft-border animate-pulse">
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-4 rounded bg-tft-bg-elevated" />
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

/* ───────────────────────── HOW IT WORKS ───────────────────────── */
function HowItWorks() {
  return (
    <section className="relative py-20 md:py-24 border-t border-tft-border">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-14">
          <p className="font-ui text-[11px] tracking-[0.22em] uppercase text-tft-purple-bright mb-2">Trois étapes</p>
          <h2 className="font-display font-bold text-3xl md:text-4xl text-tft-text mb-3">
            De zéro à ton premier pari en moins de 5 minutes
          </h2>
          <p className="text-tft-text-dim text-base max-w-2xl mx-auto">
            Pas de paperasse, pas de KYC obligatoire en dessous de 1 000 $/mois, pas de période d&apos;attente.
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {STEPS.map((step, i) => (
            <div key={step.n} className="relative p-6 rounded-xl border border-tft-border bg-card-arcane hover:border-tft-purple/50 transition-colors">
              <div className="flex items-start gap-4 mb-4">
                <div className="shrink-0 w-12 h-12 rounded-md bg-tft-purple/15 border border-tft-purple/40 flex items-center justify-center">
                  <step.icon size={20} className="text-tft-purple-bright" />
                </div>
                <span className="font-ui text-3xl font-bold text-tft-text-faint tabular-nums">{step.n}</span>
              </div>
              <h3 className="font-display font-semibold text-xl text-tft-text mb-2">{step.title}</h3>
              <p className="text-sm text-tft-text-dim leading-relaxed">{step.body}</p>
              {i < STEPS.length - 1 && (
                <ChevronRight size={22} className="hidden md:block absolute -right-4 top-1/2 -translate-y-1/2 text-tft-purple/40" />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── TRUST SIGNALS ───────────────────────── */
function TrustSignals() {
  return (
    <section className="relative py-20 md:py-24 border-t border-tft-border bg-tft-bg">
      <div className="absolute inset-0 bg-hex-grid opacity-[0.05] pointer-events-none" aria-hidden="true" />
      <div className="relative max-w-6xl mx-auto px-6">
        <div className="grid md:grid-cols-3 gap-6">
          {TRUST_ITEMS.map((item) => (
            <div key={item.title} className="relative p-6 rounded-xl border border-tft-border bg-tft-bg-card/60 backdrop-blur-sm">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-md bg-tft-cyan-dim border border-tft-cyan/40 flex items-center justify-center">
                  <item.icon size={18} className="text-tft-cyan-bright" />
                </div>
                <h3 className="font-display font-semibold text-lg text-tft-text">{item.title}</h3>
              </div>
              <p className="text-sm text-tft-text-dim leading-relaxed">{item.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────── FINAL CTA ────────────────────────── */
function FinalCta() {
  return (
    <section className="relative py-20 md:py-28 border-t border-tft-border overflow-hidden">
      <div className="absolute inset-0 bg-hero-arcane opacity-90" aria-hidden="true" />
      <div className="absolute inset-0 bg-hex-grid opacity-15 animate-hex-pulse" aria-hidden="true" />
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-tft-purple/20 blur-[120px]" aria-hidden="true" />
      <div className="relative max-w-3xl mx-auto px-6 text-center space-y-6">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-tft-cyan/40 bg-tft-cyan-dim">
          <Hexagon size={11} className="text-tft-cyan-bright" />
          <span className="font-ui text-[11px] tracking-[0.22em] uppercase text-tft-cyan-bright">Bonus de bienvenue</span>
        </div>
        <h2 className="font-display font-bold text-3xl md:text-5xl text-tft-text leading-tight">
          Reçois <span className="text-arcane">25 ◈</span> à l&apos;inscription
        </h2>
        <p className="text-tft-text-dim text-base md:text-lg max-w-xl mx-auto">
          Connexion Steam, dépôt de 10 ◈ minimum, et 25 ◈ supplémentaires sont créditées sur ton compte.
          Sans wager, retirables après ton premier pari réglé.
        </p>
        <div className="pt-4">
          <Link
            href="/api/auth/signin/steam"
            className="inline-flex items-center justify-center gap-3 px-8 py-4 rounded-md cursor-pointer font-ui font-bold text-[14px] tracking-[0.18em] uppercase text-white bg-gradient-rose shadow-rose-md hover:shadow-arcane-lg hover:scale-[1.02] transition-all"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.003.187.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.029 4.524 4.524s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.718L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0z"/>
            </svg>
            Se connecter avec Steam
          </Link>
        </div>
        <p className="font-ui text-[10px] tracking-wider uppercase text-tft-text-muted">
          18+ uniquement · Jouer comporte des risques
        </p>
      </div>
    </section>
  );
}

/* ─────────────────────────── FAQ ─────────────────────────── */
function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="relative py-20 md:py-24 border-t border-tft-border bg-tft-bg">
      <div className="max-w-3xl mx-auto px-6">
        <div className="text-center mb-12">
          <p className="font-ui text-[11px] tracking-[0.22em] uppercase text-tft-purple-bright mb-2">FAQ</p>
          <h2 className="font-display font-bold text-3xl md:text-4xl text-tft-text">
            Les questions qu&apos;on nous pose le plus
          </h2>
        </div>
        <div className="space-y-3">
          {FAQS.map((faq, i) => {
            const isOpen = open === i;
            return (
              <div key={i} className="border border-tft-border rounded-lg bg-tft-bg-card/60 overflow-hidden">
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left cursor-pointer hover:bg-tft-bg-hover transition-colors"
                  aria-expanded={isOpen}
                >
                  <span className="font-ui font-semibold text-tft-text text-sm md:text-base">{faq.q}</span>
                  <ChevronDown size={18} className={cn('shrink-0 text-tft-purple-bright transition-transform', isOpen && 'rotate-180')} />
                </button>
                {isOpen && <div className="px-5 pb-5 pt-1 text-tft-text-dim text-sm leading-relaxed">{faq.a}</div>}
              </div>
            );
          })}
        </div>
        <div className="mt-10 text-center">
          <Link href="/support" className="inline-flex items-center gap-1 text-tft-cyan-bright hover:opacity-80 transition-opacity text-sm font-ui">
            Autre question ? Contacte le support
            <ChevronRight size={14} />
          </Link>
        </div>
      </div>
    </section>
  );
}
