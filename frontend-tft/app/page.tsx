'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useSession, signIn } from 'next-auth/react';
import { ArrowRight, Wallet, Hexagon } from 'lucide-react';
import { cn, formatCoins } from '@/lib/utils';
import { CoinRain }       from '@/components/home/CoinRain';
import { HotTournaments } from '@/components/home/HotTournaments';

/**
 * tft.money homepage — sober + functional (refonte #3, 2026-05-29).
 *
 * Previous iteration leaned too "AI-generated landing" (rainbow gradient
 * title, big blurred halos, multi-accent palette purple/cyan/gold/rose/
 * mint everywhere, soft round-2xl corners on every card). This version
 * tightens to a sober gambling-site posture :
 *
 *   - Palette collapses to indigo bg + purple primary + gold for money.
 *     Cyan/rose/mint reserved for state badges only (live, hot, win).
 *   - Corners are angular (rounded-sm / rounded-md max).
 *   - Compact hero (no 32 rem padding, no monumental h1).
 *   - Featured TFT character art as the hero visual instead of a
 *     procedural SVG of glowing hexagons.
 *   - Tournament cards land immediately under the hero — the actual
 *     product, not a decorative intro section.
 *
 * "Why TFT.money" pillars removed from the home ; visitors who want the
 * explanation click through to /how-it-works, which already covers it.
 */
export default function HomePage() {
  return (
    <div className="relative">
      <Hero />
      <HotTournaments />
      <FooterCta />
    </div>
  );
}

/* ─────────────────────── HERO ─────────────────────── */
function Hero() {
  const { data: session, status } = useSession();

  return (
    <section className="relative overflow-hidden bg-tft-bg border-b border-tft-border">
      {/* Single soft halo — anchored behind the character art, kept low
          opacity so the hero stays grounded rather than dreamy. */}
      <div className="absolute top-1/2 right-0 -translate-y-1/2 w-[480px] h-[480px] rounded-full bg-tft-purple/12 blur-[100px] pointer-events-none" aria-hidden="true" />
      <div className="absolute inset-0 bg-hex-grid opacity-[0.06] pointer-events-none" aria-hidden="true" />
      <CoinRain count={6} />

      <div className="relative max-w-6xl mx-auto px-6 py-14 md:py-20 grid lg:grid-cols-[1.2fr_1fr] gap-10 items-center">
        {/* Left — tight copy + CTAs */}
        <div className="space-y-5">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-sm border border-tft-purple/40 bg-tft-purple/10">
            <Hexagon size={10} className="text-tft-purple-bright" />
            <span className="font-ui text-[10.5px] tracking-[0.22em] uppercase text-tft-purple-bright">
              Saison TFT 14 · S/A-Tier
            </span>
          </div>

          <h1 className="font-display font-bold text-4xl md:text-5xl lg:text-[58px] leading-[1.05] tracking-tight text-tft-text">
            Parie sur la scène
            <span className="block text-tft-purple-bright">Teamfight Tactics</span>
          </h1>

          <p className="text-tft-text-dim text-sm md:text-base max-w-lg leading-relaxed">
            Tactician&apos;s Crown, Set Championship, Regional Finals, Esports World Cup.
            Odds maison fixées sur les vraies stats Riot, settlement automatique
            sur sources officielles.
          </p>

          <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
            <Link
              href="/tournaments"
              className={cn(
                'group inline-flex items-center justify-center gap-2 px-5 py-3 rounded-sm cursor-pointer',
                'font-ui font-semibold text-[12px] tracking-[0.18em] uppercase text-white',
                'bg-tft-purple hover:bg-tft-purple-bright transition-colors',
              )}
            >
              Voir les tournois
              <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <Link
              href="/how-it-works"
              className={cn(
                'inline-flex items-center justify-center gap-2 px-5 py-3 rounded-sm cursor-pointer',
                'font-ui font-semibold text-[12px] tracking-[0.18em] uppercase text-tft-text-dim',
                'border border-tft-border bg-tft-bg-card hover:border-tft-purple/60 hover:text-tft-text transition-colors',
              )}
            >
              Comment ça marche
            </Link>
          </div>

          {status === 'authenticated' && session?.user ? (
            <AccountPill name={session.user.name ?? 'Tactician'} coins={session.user.coins ?? 0} />
          ) : status === 'unauthenticated' ? (
            <SteamPill />
          ) : null}
        </div>

        {/* Right — character art (replaces previous procedural hex SVG) */}
        <div className="relative hidden lg:flex items-center justify-center">
          <div className="relative w-full max-w-[420px] aspect-square">
            <Image
              src="/tft.png"
              alt="Teamfight Tactics little legend"
              fill
              priority
              sizes="(min-width: 1024px) 420px, 100vw"
              className="object-contain drop-shadow-[0_0_40px_rgba(124,58,237,0.35)] select-none"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────── Account / Steam pills ─────────────────────── */
function AccountPill({ name, coins }: { name: string; coins: number }) {
  return (
    <div className="inline-flex items-center gap-3 px-3.5 py-2 rounded-sm border border-tft-border bg-tft-bg-card">
      <Wallet size={12} className="text-tft-purple-bright" />
      <span className="font-ui text-[12px] text-tft-text-dim">
        {name} ·{' '}
        <span className="text-tft-gold-bright font-semibold tabular-nums">
          {formatCoins(coins)} ◈
        </span>
      </span>
      <Link
        href="/deposit"
        className="font-ui text-[10px] tracking-wider uppercase text-tft-text hover:text-tft-purple-bright transition-colors"
      >
        + Dépôt
      </Link>
    </div>
  );
}

function SteamPill() {
  return (
    <button
      onClick={() => signIn('steam')}
      className={cn(
        'inline-flex items-center gap-2.5 px-3.5 py-2 rounded-sm cursor-pointer',
        'border border-tft-border bg-tft-bg-card hover:border-tft-purple/60 transition-colors',
      )}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" className="text-tft-text" aria-hidden="true">
        <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.003.187.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.029 4.524 4.524s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.718L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0z" />
      </svg>
      <span className="font-ui text-[12px] text-tft-text-dim">
        Connexion Steam — 1 clic, sans email
      </span>
    </button>
  );
}

/* ─────────────────────── Footer CTA ─────────────────────── */
function FooterCta() {
  const { status } = useSession();
  if (status !== 'unauthenticated') return null;

  return (
    <section className="relative border-t border-tft-border bg-tft-bg">
      <div className="absolute inset-0 bg-hex-grid opacity-[0.04] pointer-events-none" aria-hidden="true" />
      <div className="relative max-w-4xl mx-auto px-6 py-12 md:py-16 grid md:grid-cols-[1fr_auto] items-center gap-6">
        <div className="space-y-2">
          <h2 className="font-display font-bold text-2xl md:text-3xl text-tft-text leading-tight">
            Prêt à parier ?
          </h2>
          <p className="text-tft-text-dim text-sm max-w-md">
            Connexion Steam d&apos;un clic, dépôt crypto en 2 minutes, bonus de bienvenue de 25 ◈
            après ton premier dépôt. 18+ uniquement.
          </p>
        </div>
        <button
          onClick={() => signIn('steam')}
          className={cn(
            'inline-flex items-center justify-center gap-2.5 px-6 py-3 rounded-sm cursor-pointer',
            'font-ui font-bold text-[12px] tracking-[0.18em] uppercase text-white',
            'bg-tft-purple hover:bg-tft-purple-bright transition-colors',
          )}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.003.187.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.029 4.524 4.524s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.718L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0z" />
          </svg>
          Steam
        </button>
      </div>
    </section>
  );
}
