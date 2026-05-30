'use client';

import Link from 'next/link';
import Image from 'next/image';

/**
 * Pure SVG / CSS error page — no PNG dependency. Used by /forbidden,
 * /maintenance, and other error states. Themed for tft.money :
 *   - TFT logo (public/logo.svg) as the central medallion
 *   - Purple hex-grid background + gold halo
 *   - Cormorant serif title (font-display) for the error code,
 *     Chakra Petch (font-ui) for everything else
 *
 * Mirrors the AoM ErrorPage structure (gold halo / radial glow /
 * topographic grid) but with the TFT palette anchors instead of
 * AoM's #D4B896 gold.
 */
interface ErrorPageProps {
  errorCode: string;        // "404", "500", "403", "503"
  title: string;            // "FORBIDDEN", "MAINTENANCE EN COURS", ...
  subtitle: string;
  ctaText?: string;
  ctaHref?: string;
  ctaOnClick?: () => void;
  showCta?: boolean;
}

export function ErrorPage({
  errorCode,
  title,
  subtitle,
  ctaText = 'Retour à l\'accueil',
  ctaHref = '/',
  ctaOnClick,
  showCta = true,
}: ErrorPageProps) {
  return (
    <div
      className="min-h-screen relative overflow-hidden flex flex-col items-center justify-center px-4"
      style={{
        background: 'radial-gradient(ellipse at center, #0d0b1a 0%, #07060f 70%, #050507 100%)',
      }}
    >
      {/* Hex-grid pattern background — same vibe as the rest of tft.money */}
      <svg
        className="absolute inset-0 w-full h-full opacity-[0.08]"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid slice"
        viewBox="0 0 800 600"
        aria-hidden="true"
      >
        <defs>
          <pattern id="err-hex-grid" width="56" height="50" patternUnits="userSpaceOnUse">
            {/* A single hex cell, tiled */}
            <path
              d="M28 2 L52 16 L52 40 L28 54 L4 40 L4 16 Z"
              fill="none"
              stroke="#a78bfa"
              strokeWidth="0.6"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#err-hex-grid)" />
      </svg>

      {/* Central purple halo */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
        style={{
          width: '600px',
          height: '600px',
          background:
            'radial-gradient(circle, rgba(167, 139, 250, 0.18) 0%, rgba(124, 58, 237, 0.08) 40%, transparent 70%)',
          filter: 'blur(50px)',
        }}
        aria-hidden="true"
      />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center text-center max-w-2xl">
        {/* Error code in serif */}
        <h1
          className="font-display tracking-wider text-tft-purple-bright"
          style={{
            fontSize: 'clamp(5rem, 15vw, 10rem)',
            textShadow:
              '0 4px 30px rgba(167, 139, 250, 0.4), 0 0 60px rgba(252, 211, 77, 0.15)',
            fontWeight: 600,
            lineHeight: 1,
            marginBottom: '1.5rem',
          }}
        >
          {errorCode}
        </h1>

        {/* TFT logo medallion */}
        <div className="my-6 relative flex items-center justify-center">
          {/* Outer purple glow */}
          <div
            className="absolute pointer-events-none"
            style={{
              width: '320px',
              height: '320px',
              background:
                'radial-gradient(circle, rgba(167, 139, 250, 0.30) 0%, rgba(124, 58, 237, 0.10) 40%, transparent 70%)',
              filter: 'blur(40px)',
              borderRadius: '50%',
            }}
            aria-hidden="true"
          />
          {/* Inner gold sparkle */}
          <div
            className="absolute pointer-events-none"
            style={{
              width: '160px',
              height: '160px',
              background:
                'radial-gradient(circle, rgba(252, 211, 77, 0.35) 0%, rgba(252, 211, 77, 0.10) 50%, transparent 80%)',
              filter: 'blur(20px)',
              borderRadius: '50%',
            }}
            aria-hidden="true"
          />
          <Image
            src="/logo.svg"
            alt="tft.money"
            width={150}
            height={150}
            priority
            unoptimized
            className="relative"
            style={{
              filter: `
                drop-shadow(0 0 30px rgba(167, 139, 250, 0.55))
                drop-shadow(0 0 12px rgba(252, 211, 77, 0.35))
              `,
            }}
          />
        </div>

        {/* Title */}
        <h2
          className="font-display tracking-widest font-bold text-tft-text"
          style={{
            fontSize: 'clamp(1.75rem, 5vw, 3rem)',
            textShadow: '0 4px 20px rgba(167, 139, 250, 0.4)',
            marginBottom: '0.85rem',
            letterSpacing: '0.15em',
          }}
        >
          {title}
        </h2>

        {/* Subtitle */}
        <p
          className="italic text-tft-text-dim"
          style={{
            fontSize: 'clamp(0.875rem, 2vw, 1.125rem)',
            maxWidth: '500px',
            marginBottom: '2rem',
            fontFamily: 'var(--font-cormorant), serif',
          }}
        >
          {subtitle}
        </p>

        {/* CTA */}
        {showCta && (
          <div>
            {ctaOnClick ? (
              <button
                onClick={ctaOnClick}
                className="px-9 py-3.5 rounded-sm font-ui font-bold text-[13px] tracking-[0.22em] uppercase text-white transition-all hover:scale-105 bg-tft-purple hover:bg-tft-purple-bright"
              >
                {ctaText}
              </button>
            ) : (
              <Link
                href={ctaHref}
                className="inline-block px-9 py-3.5 rounded-sm font-ui font-bold text-[13px] tracking-[0.22em] uppercase text-white transition-all hover:scale-105 bg-tft-purple hover:bg-tft-purple-bright"
              >
                {ctaText}
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Vignette */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.6) 100%)',
        }}
        aria-hidden="true"
      />
    </div>
  );
}
