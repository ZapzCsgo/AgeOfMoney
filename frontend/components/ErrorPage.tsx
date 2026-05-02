'use client';

import Link from 'next/link';

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

        {/* Coin medallion — fleur-de-lys SVG */}
        <div className="my-8 relative">
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background:
                'radial-gradient(circle, rgba(255, 200, 87, 0.3) 0%, transparent 70%)',
              filter: 'blur(20px)',
              transform: 'scale(1.5)',
            }}
            aria-hidden="true"
          />
          <svg
            width="120"
            height="120"
            viewBox="0 0 120 120"
            className="relative"
            aria-hidden="true"
          >
            <defs>
              <radialGradient id="coinGradient" cx="0.3" cy="0.3">
                <stop offset="0%" stopColor="#F5D085" />
                <stop offset="50%" stopColor="#D4B896" />
                <stop offset="100%" stopColor="#8B6F47" />
              </radialGradient>
            </defs>
            {/* Outer coin disc */}
            <circle cx="60" cy="60" r="55" fill="url(#coinGradient)" stroke="#8B6F47" strokeWidth="2" />
            {/* Inner detail circle */}
            <circle cx="60" cy="60" r="48" fill="none" stroke="#8B6F47" strokeWidth="0.5" opacity="0.5" />
            {/* Fleur de lys */}
            <g transform="translate(60, 60)">
              <path d="M 0,-25 L -3,-10 L -3,5 L 0,8 L 3,5 L 3,-10 Z" fill="#8B6F47" />
              <path d="M 0,-5 Q -15,-10 -18,5 Q -20,15 -10,18 Q -5,15 -2,8 L 0,5" fill="#8B6F47" />
              <path d="M 0,-5 Q 15,-10 18,5 Q 20,15 10,18 Q 5,15 2,8 L 0,5" fill="#8B6F47" />
              <rect x="-12" y="6" width="24" height="3" fill="#8B6F47" />
              <rect x="-15" y="11" width="30" height="2" fill="#8B6F47" />
            </g>
          </svg>
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
