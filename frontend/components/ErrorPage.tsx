'use client';

import Link from 'next/link';
import Image from 'next/image';

/**
 * Pure-CSS / pure-SVG error page. NO PNG image dependency.
 *
 * Replaced the previous Gemini-generated background images because they
 * shipped with two pre-launch defects in prod :
 *   1. Generator hallucinated text ("DEFEEAT") baked INTO the asset, then
 *      our HTML overlay added "DEFEAT" on top → duplicated text.
 *   2. Imagen watermark in the bottom-right was visible, and our CSS mask
 *      didn't survive a hard reload reliably across browsers.
 *
 * The new visual is composed entirely from inline SVG (topographic grid +
 * fleur-de-lys medallion) and CSS gradients — same medieval-premium feel,
 * zero asset dependency, fully responsive via `clamp()` typography.
 */
interface ErrorPageProps {
  errorCode: string;        // "404", "500", "403", "MAINTENANCE"
  title: string;            // "DEFEAT", "FORTRESS UNDER SIEGE", …
  subtitle: string;         // "This territory is uncharted…"
  ctaText?: string;
  ctaHref?: string;
  ctaOnClick?: () => void;
  showCta?: boolean;
}

export function ErrorPage({
  errorCode,
  title,
  subtitle,
  ctaText = 'Return Home',
  ctaHref = '/',
  ctaOnClick,
  showCta = true,
}: ErrorPageProps) {
  return (
    <div
      className="min-h-screen relative overflow-hidden flex flex-col items-center justify-center px-4"
      style={{
        background: 'radial-gradient(ellipse at center, #1a1410 0%, #0A0A14 70%, #050507 100%)',
      }}
    >
      {/* Topographic grid background — pure SVG, scales with viewport */}
      <svg
        className="absolute inset-0 w-full h-full opacity-[0.08]"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid slice"
        viewBox="0 0 800 600"
        aria-hidden="true"
      >
        <defs>
          <pattern id="errgrid" width="60" height="60" patternUnits="userSpaceOnUse">
            <path d="M 60 0 L 0 0 0 60" fill="none" stroke="#D4B896" strokeWidth="0.5" />
          </pattern>
          <pattern id="errtopo" width="200" height="150" patternUnits="userSpaceOnUse">
            <path d="M0,75 Q50,40 100,75 T200,75" fill="none" stroke="#D4B896" strokeWidth="0.6" opacity="0.4" />
            <path d="M0,90 Q50,55 100,90 T200,90" fill="none" stroke="#D4B896" strokeWidth="0.5" opacity="0.3" />
            <path d="M0,60 Q50,25 100,60 T200,60" fill="none" stroke="#D4B896" strokeWidth="0.5" opacity="0.3" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#errgrid)" />
        <rect width="100%" height="100%" fill="url(#errtopo)" />
      </svg>

      {/* Central golden glow — radial CSS gradient with blur */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
        style={{
          width: '600px',
          height: '600px',
          background:
            'radial-gradient(circle, rgba(212, 184, 150, 0.15) 0%, rgba(212, 184, 150, 0.05) 40%, transparent 70%)',
          filter: 'blur(40px)',
        }}
        aria-hidden="true"
      />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center text-center max-w-2xl">
        {/* Error code */}
        <h1
          className="tracking-wider"
          style={{
            fontSize: 'clamp(5rem, 15vw, 10rem)',
            color: '#D4B896',
            textShadow:
              '0 4px 30px rgba(212, 184, 150, 0.4), 0 0 60px rgba(255, 200, 87, 0.2)',
            fontFamily: 'var(--font-cinzel), "Cinzel", "Trajan Pro", "Playfair Display", serif',
            fontWeight: 600,
            lineHeight: 1,
            marginBottom: '1.5rem',
          }}
        >
          {errorCode}
        </h1>

        {/* Coin medallion — official AOM logo from /public.
            aomlogo.png ships with a dark gradient background (square
            asset) which used to draw a visible rectangle on the error
            page's black backdrop. We use `mix-blend-mode: screen` to
            wipe the dark areas (black + dark gradient → transparent)
            while keeping the gold coin + rays fully visible. Same logo
            as the site favicon + structured-data logo. */}
        <div className="my-8 relative flex items-center justify-center">
          {/* Soft golden glow behind the coin */}
          <div
            className="absolute pointer-events-none"
            style={{
              width: '220px',
              height: '220px',
              background:
                'radial-gradient(circle, rgba(255, 200, 87, 0.5) 0%, rgba(212, 184, 150, 0.2) 40%, transparent 70%)',
              filter: 'blur(35px)',
            }}
            aria-hidden="true"
          />
          <Image
            src="/aomlogo.png"
            alt="AgeOfMoney"
            width={160}
            height={160}
            priority
            className="relative drop-shadow-[0_4px_30px_rgba(212,184,150,0.6)]"
            style={{
              // Wipe the square dark background — only the gold coin +
              // rays survive screen-blend against the page's near-black
              // backdrop.
              mixBlendMode: 'screen',
              objectFit: 'contain',
            }}
          />
        </div>

        {/* Title (DEFEAT, FORTRESS UNDER SIEGE, …) */}
        <h2
          className="tracking-widest font-bold"
          style={{
            fontSize: 'clamp(2rem, 6vw, 4rem)',
            color: '#D4B896',
            textShadow: '0 4px 20px rgba(212, 184, 150, 0.4)',
            fontFamily: 'var(--font-cinzel), "Cinzel", "Trajan Pro", serif',
            marginBottom: '1rem',
            letterSpacing: '0.15em',
          }}
        >
          {title}
        </h2>

        {/* Subtitle */}
        <p
          className="italic"
          style={{
            color: 'rgba(245, 240, 232, 0.7)',
            fontSize: 'clamp(0.875rem, 2vw, 1.125rem)',
            maxWidth: '500px',
            marginBottom: '2.5rem',
            fontFamily: 'var(--font-cinzel), serif',
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
                className="px-10 py-4 rounded-lg font-bold text-lg transition-all hover:scale-105"
                style={{
                  background: 'linear-gradient(135deg, #FFC857 0%, #D4B896 100%)',
                  color: '#0A0A14',
                  boxShadow:
                    '0 4px 20px rgba(212, 184, 150, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.3)',
                  border: '1px solid #FFC857',
                }}
              >
                {ctaText}
              </button>
            ) : (
              <Link
                href={ctaHref}
                className="inline-block px-10 py-4 rounded-lg font-bold text-lg transition-all hover:scale-105"
                style={{
                  background: 'linear-gradient(135deg, #FFC857 0%, #D4B896 100%)',
                  color: '#0A0A14',
                  boxShadow:
                    '0 4px 20px rgba(212, 184, 150, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.3)',
                  border: '1px solid #FFC857',
                }}
              >
                {ctaText}
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Vignette overlay — soft black corners pull focus to center */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.6) 100%)',
        }}
        aria-hidden="true"
      />
    </div>
  );
}
