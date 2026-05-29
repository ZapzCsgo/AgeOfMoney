'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession, signIn } from 'next-auth/react';
import {
  ShieldCheck, Zap, Coins, Trophy, ArrowRight, ChevronRight, Hexagon,
  Wallet, Sparkles, Headphones,
} from 'lucide-react';
import { cn, formatCoins } from '@/lib/utils';
import { CoinRain }       from '@/components/home/CoinRain';
import { HotTournaments } from '@/components/home/HotTournaments';
import { getTftTournaments, type TftTournament } from '@/lib/api';

/**
 * tft.money homepage — clean iteration (refonte #2, 2026-05-29).
 *
 * Brief : AgeOfMoney-clean energy with TFT's design language. The previous
 * gambling-vibe version (ticker + activity feed + fake jackpot counter)
 * read as a scam landing. This rewrite drops every faked social-proof
 * element ; the actual product (live + upcoming tournaments pulled from
 * the API) is the hero, with restrained motion (subtle coin rain + hex
 * pulse) for atmosphere.
 *
 * Sections, top to bottom :
 *   1. Hero    — tagline, login/wallet, hex arena visual
 *   2. HotTournaments — real cards (or graceful empty state)
 *   3. WhyTftMoney — 3 differentiators (no fake numbers)
 *   4. FooterCta — sign-in CTA, only shown when logged out
 */
export default function HomePage() {
  return (
    <div className="relative">
      <Hero />
      <HotTournaments />
      <WhyTftMoney />
      <FooterCta />
    </div>
  );
}

/* ─────────────────────── HERO ─────────────────────── */
function Hero() {
  const { data: session, status } = useSession();
  return (
    <section className="relative overflow-hidden bg-hero-arcane">
      <div className="absolute inset-0 bg-hex-grid opacity-20 animate-hex-pulse pointer-events-none" aria-hidden="true" />
      <div className="absolute -top-32 -left-32 w-[480px] h-[480px] rounded-full bg-tft-purple/15 blur-[120px] pointer-events-none" aria-hidden="true" />
      <div className="absolute -bottom-32 -right-32 w-[520px] h-[520px] rounded-full bg-tft-cyan/10 blur-[140px] pointer-events-none" aria-hidden="true" />
      <CoinRain count={8} />

      <div className="relative max-w-6xl mx-auto px-6 py-20 md:py-28 grid lg:grid-cols-[1.15fr_1fr] gap-12 items-center">
        {/* Left — copy + CTAs */}
        <div className="space-y-7">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-tft-purple/40 bg-tft-purple/10 backdrop-blur-sm">
            <Sparkles size={12} className="text-tft-cyan-bright" />
            <span className="font-ui text-[11px] tracking-[0.22em] uppercase text-tft-purple-bright">
              Saison TFT 14 · S/A-Tier only
            </span>
          </div>

          <h1 className="font-display font-bold text-5xl md:text-6xl lg:text-7xl leading-[1.05] tracking-tight">
            <span className="text-tft-text">Parie sur la scène</span>
            <br />
            <span className="text-arcane">Teamfight&nbsp;Tactics</span>
          </h1>

          <p className="text-tft-text-dim text-base md:text-lg max-w-xl leading-relaxed">
            Tournament Winner sur les tournois Tactician&apos;s Crown, Set Championship,
            Regional Finals et Esports World Cup. Odds maison fixées sur les vraies
            stats Riot, settlement automatique sur sources officielles.
          </p>

          {/* CTAs row */}
          <div className="flex flex-col sm:flex-row gap-3 pt-1">
            <Link
              href="/tournaments"
              className={cn(
                'group inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-md cursor-pointer',
                'font-ui font-semibold text-[13px] tracking-[0.18em] uppercase text-white',
                'bg-gradient-rose shadow-rose-md hover:shadow-arcane-md transition-all',
              )}
            >
              Voir les tournois
              <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <Link
              href="/how-it-works"
              className={cn(
                'inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-md cursor-pointer',
                'font-ui font-semibold text-[13px] tracking-[0.18em] uppercase text-tft-text-dim',
                'border border-tft-border bg-tft-bg-card/50 hover:border-tft-purple/60 hover:text-tft-text transition-all',
              )}
            >
              Comment ça marche
            </Link>
          </div>

          {/* Account strip — adapts to session state */}
          <div className="pt-2">
            {status === 'authenticated' && session?.user ? (
              <AccountPill name={session.user.name ?? 'Tactician'} coins={session.user.coins ?? 0} />
            ) : status === 'unauthenticated' ? (
              <SteamPill />
            ) : null}
          </div>
        </div>

        {/* Right — TFT board visual */}
        <div className="relative hidden lg:block">
          <HexArena />
        </div>
      </div>
    </section>
  );
}

/* Account / Steam pills — discrete account state under the CTAs.
   Keeps the hero scannable for logged-out visitors without dominating
   the layout the way a full login card did in earlier iterations. */
function AccountPill({ name, coins }: { name: string; coins: number }) {
  return (
    <div className="inline-flex items-center gap-3 px-4 py-2 rounded-full border border-tft-border bg-tft-bg-card/60 backdrop-blur-sm">
      <Wallet size={13} className="text-tft-purple-bright" />
      <span className="font-ui text-xs text-tft-text-dim">
        {name} · <span className="text-tft-gold-bright font-semibold tabular-nums">{formatCoins(coins)} ◈</span>
      </span>
      <Link href="/deposit" className="font-ui text-[10px] tracking-wider uppercase text-tft-cyan-bright hover:underline">
        Dépôt
      </Link>
    </div>
  );
}

function SteamPill() {
  return (
    <button
      onClick={() => signIn('steam')}
      className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full border border-tft-border bg-tft-bg-card/60 backdrop-blur-sm hover:border-tft-purple/50 transition-colors cursor-pointer"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-tft-text" aria-hidden="true">
        <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.003.187.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.029 4.524 4.524s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.718L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0z"/>
      </svg>
      <span className="font-ui text-xs text-tft-text-dim">
        Connexion Steam — 1 clic, sans email
      </span>
    </button>
  );
}

/* ─────────────────────── Hex Arena visual ─────────────────────── */
/**
 * 7 hexagonal cells laid out in a TFT-board flower, each tagged with a
 * cost (2-5) for the champion tier they represent. A featured tournament
 * chip floats top-right, populated from the next live or upcoming event
 * — hidden entirely when the API returns nothing (no fake placeholders).
 */
function HexArena() {
  const [featured, setFeatured] = useState<TftTournament | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getTftTournaments({ status: 'live',     limit: 1 }),
      getTftTournaments({ status: 'upcoming', limit: 1 }),
    ]).then(([live, upcoming]) => {
      if (cancelled) return;
      setFeatured(live[0] ?? upcoming[0] ?? null);
    }).catch(() => { /* no-op — hero still renders without the chip */ });
    return () => { cancelled = true; };
  }, []);

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
    <div className="relative w-full max-w-[440px] mx-auto aspect-[4/5] animate-float">
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

      {featured && (
        <Link
          href={`/tournaments/${featured.id}`}
          className="absolute -top-2 -right-2 max-w-[200px] px-3 py-2 rounded-lg border border-tft-cyan/40 bg-tft-bg-card/95 backdrop-blur-md shadow-cyan-md font-ui hover:border-tft-cyan-bright transition-colors cursor-pointer"
        >
          <p className="text-[9px] tracking-[0.22em] uppercase text-tft-text-muted mb-0.5">À l&apos;affiche</p>
          <p className="text-tft-cyan-bright text-sm font-bold leading-tight truncate">{featured.name}</p>
          <p className="text-[10px] text-tft-text-dim mt-0.5">{featured.tier}-Tier</p>
        </Link>
      )}
    </div>
  );
}

/* ─────────────────────── Why TFT.money ─────────────────────── */
const PILLARS = [
  {
    icon: ShieldCheck,
    title: 'Sources officielles',
    body: "Settlement basé sur CompeteTFT (plateforme officielle Riot) avec fallback Liquipedia. Aucun jugement manuel sur l'issue d'un tournoi — le winner est déterminé par les données officielles, point.",
  },
  {
    icon: Hexagon,
    title: 'Odds maison transparentes',
    body: "Calculées sur 60% recent solo queue + 40% ranked tier via l'API Riot. Overround 8% visible, oddsBasis exposé par participant pour audit. Pas de mise à jour secrète après ton clic.",
  },
  {
    icon: Zap,
    title: 'Crypto, pas de KYC',
    body: "Dépôts BTC/ETH/USDT/LTC/SOL crédités sous 2 minutes après confirmation réseau. Retraits traités sous 5 minutes. Pas de KYC en dessous de 1 000 $/mois cumulés.",
  },
];

function WhyTftMoney() {
  return (
    <section className="relative py-20 md:py-24 border-t border-tft-border bg-tft-bg">
      <div className="absolute inset-0 bg-hex-grid-cyan opacity-[0.04] pointer-events-none" aria-hidden="true" />
      <div className="relative max-w-6xl mx-auto px-6">
        <div className="text-center mb-12 space-y-2">
          <p className="font-ui text-[11px] tracking-[0.22em] uppercase text-tft-purple-bright">
            Pourquoi tft.money
          </p>
          <h2 className="font-display font-bold text-3xl md:text-4xl text-tft-text">
            Trois choses non-négociables
          </h2>
        </div>

        <div className="grid md:grid-cols-3 gap-5">
          {PILLARS.map((p) => (
            <div key={p.title} className="p-6 rounded-xl border border-tft-border bg-tft-bg-card/60 backdrop-blur-sm hover:border-tft-purple/40 transition-colors">
              <div className="w-11 h-11 rounded-md bg-tft-cyan-dim border border-tft-cyan/40 flex items-center justify-center mb-4">
                <p.icon size={19} className="text-tft-cyan-bright" />
              </div>
              <h3 className="font-display font-semibold text-lg text-tft-text mb-2">{p.title}</h3>
              <p className="text-sm text-tft-text-dim leading-relaxed">{p.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 text-center">
          <Link
            href="/how-it-works"
            className="inline-flex items-center gap-1 text-sm font-ui text-tft-cyan-bright hover:opacity-80 transition-opacity"
          >
            Le détail technique
            <ChevronRight size={14} />
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────── Footer CTA ─────────────────────── */
function FooterCta() {
  const { status } = useSession();
  // Only show this CTA to logged-out visitors — for logged-in users it's
  // redundant chrome that pushes the footer further down for no value.
  if (status !== 'unauthenticated') return null;

  return (
    <section className="relative py-20 md:py-24 border-t border-tft-border overflow-hidden">
      <div className="absolute inset-0 bg-hero-arcane opacity-90" aria-hidden="true" />
      <div className="absolute inset-0 bg-hex-grid opacity-15 animate-hex-pulse" aria-hidden="true" />
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-tft-purple/15 blur-[120px]" aria-hidden="true" />

      <div className="relative max-w-3xl mx-auto px-6 text-center space-y-5">
        <h2 className="font-display font-bold text-3xl md:text-4xl text-tft-text leading-tight">
          Connecte-toi avec Steam
        </h2>
        <p className="text-tft-text-dim text-base max-w-xl mx-auto">
          Un clic et tu es prêt. Steam OpenID gère ton identité — on récupère ton pseudo
          public et ton avatar, rien d&apos;autre.
        </p>
        <div className="pt-2 flex items-center justify-center gap-3 flex-wrap">
          <button
            onClick={() => signIn('steam')}
            className={cn(
              'inline-flex items-center justify-center gap-3 px-8 py-4 rounded-md cursor-pointer',
              'font-ui font-bold text-[14px] tracking-[0.18em] uppercase text-white',
              'bg-gradient-rose shadow-rose-md hover:shadow-arcane-lg hover:scale-[1.01] transition-all',
            )}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.003.187.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.029 4.524 4.524s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.718L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0z"/>
            </svg>
            Se connecter avec Steam
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 pt-6 text-tft-text-muted text-xs">
          <span className="inline-flex items-center gap-1.5"><ShieldCheck size={12} className="text-tft-mint" /> Sources officielles</span>
          <span className="inline-flex items-center gap-1.5"><Coins      size={12} className="text-tft-gold-bright" /> Crypto · 2 min</span>
          <span className="inline-flex items-center gap-1.5"><Trophy     size={12} className="text-tft-cyan-bright" /> Settlement auto</span>
          <span className="inline-flex items-center gap-1.5"><Headphones size={12} className="text-tft-purple-bright" /> Support 24/7</span>
        </div>

        <p className="font-ui text-[10px] tracking-wider uppercase text-tft-text-muted pt-2">
          18+ uniquement · Jouer comporte des risques
        </p>
      </div>
    </section>
  );
}
