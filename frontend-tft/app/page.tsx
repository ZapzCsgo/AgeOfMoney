'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useSession, signIn } from 'next-auth/react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
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
  const { status } = useSession();

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
          <h1 className="font-display font-bold text-4xl md:text-5xl lg:text-[58px] leading-[1.05] tracking-tight text-tft-text">
            Parie sur la scène
            <span className="block text-tft-purple-bright">Teamfight Tactics</span>
          </h1>

          <p className="text-tft-text-dim text-sm md:text-base max-w-lg leading-relaxed">
            Tous les tournois TFT pros, en direct.
          </p>

          <div className="pt-1">
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
          </div>

          {/* Steam CTA only when logged out — when logged in, the navbar
              already carries the wallet + name pill, repeating it here
              under the hero copy was redundant noise. */}
          {status === 'unauthenticated' && <SteamPill />}
        </div>

        {/* Right — character art with subtle parallax follow */}
        <HeroArt />
      </div>
    </section>
  );
}

/**
 * Tracks the viewport cursor and translates the little legend by a small
 * fraction of the distance from screen center. Smoothed via rAF lerp so
 * the motion feels weighted rather than 1:1 jittery, and capped to a
 * ±18px box so it never looks dramatic. Respects `prefers-reduced-motion`
 * by short-circuiting the listener.
 */
function HeroArt() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const target = useRef({ x: 0, y: 0 });
  const current = useRef({ x: 0, y: 0 });
  const rafId = useRef<number | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;

    const MAX = 18; // px envelope — keeps the effect "subtle weight", not a tilt-on-rails
    const onMove = (e: MouseEvent) => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      // normalise to [-1, 1] from screen center, then scale to MAX
      const nx = (e.clientX / w - 0.5) * 2;
      const ny = (e.clientY / h - 0.5) * 2;
      target.current = { x: nx * MAX, y: ny * MAX };
    };
    window.addEventListener('mousemove', onMove, { passive: true });

    const tick = () => {
      // lerp toward target with a soft factor — 0.08 gives ~200ms catch-up,
      // which reads as "the legend follows the cursor lazily" rather than
      // "the legend is glued to the cursor".
      current.current.x += (target.current.x - current.current.x) * 0.08;
      current.current.y += (target.current.y - current.current.y) * 0.08;
      if (wrapRef.current) {
        wrapRef.current.style.transform =
          `translate3d(${current.current.x.toFixed(2)}px, ${current.current.y.toFixed(2)}px, 0)`;
      }
      rafId.current = requestAnimationFrame(tick);
    };
    rafId.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('mousemove', onMove);
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
    };
  }, []);

  return (
    <div className="relative hidden lg:flex items-center justify-center">
      <div
        ref={wrapRef}
        className="relative w-full max-w-[420px] aspect-square will-change-transform"
        style={{
          // Hide the slight cold-start jump before useEffect runs by holding
          // a 0 transform until mount. Without this the image visibly snaps
          // on the first mousemove event of the session.
          transform: mounted ? undefined : 'translate3d(0,0,0)',
        }}
      >
        <Image
          src="/tft.png"
          alt="Teamfight Tactics little legend"
          fill
          priority
          sizes="(min-width: 1024px) 420px, 100vw"
          className="object-contain drop-shadow-[0_0_40px_rgba(124,58,237,0.35)] select-none pointer-events-none"
        />
      </div>
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
        Connexion Steam
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
