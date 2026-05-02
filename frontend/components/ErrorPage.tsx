'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect } from 'react';

/**
 * Full-screen error / status overlay.
 *
 * Renders as a `position: fixed; inset: 0; z-index: 9999` overlay so it
 * visually replaces the root layout's Navbar / LeftSidebar / Footer
 * regardless of where it's used. This mirrors the pattern from the
 * existing `app/maintenance/page.tsx` — same body-scroll lock too.
 *
 * The image is rendered with `next/image fill` so it covers the entire
 * viewport (object-cover, no letterboxing). Fallback `<div>` is plain
 * black so the page never flashes white if the image is missing.
 *
 * `errorCode`/`title`/`subtitle` are optional HTML overlays. When set,
 * they render on top of the image at the same composition as the in-image
 * text — this lets us mask any baked-in artifacts (Gemini misspelled
 * "DEFEEAT", a stray watermark) without re-rendering the asset. The
 * underlying image is still served to AI-generated previews / OG-tags so
 * crawlers see something coherent. The mask gradient at the bottom hides
 * the watermark band even if the user disables JS.
 */
interface ErrorPageProps {
  imageSrc: string;
  imageAlt: string;
  ctaText?: string;
  ctaHref?: string;
  ctaOnClick?: () => void;
  showCta?: boolean;
  /** Big metallic numeral overlay (e.g. "404"). When omitted we trust the image. */
  errorCode?: string;
  /** Centered headline below the numeral (e.g. "DEFEAT"). */
  title?: string;
  /** Italic flavor line below the title. */
  subtitle?: string;
}

export function ErrorPage({
  imageSrc,
  imageAlt,
  ctaText = 'Return Home',
  ctaHref = '/',
  ctaOnClick,
  showCta = true,
  errorCode,
  title,
  subtitle,
}: ErrorPageProps) {
  // Lock body scroll while the overlay is mounted — same trick as the
  // existing maintenance page. Prevents the user from interacting with
  // anything underneath via mouse-wheel even though z-index already
  // covers it visually.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const ctaClasses = [
    'absolute bottom-12 left-1/2 -translate-x-1/2 z-10',
    'px-10 py-4',
    'bg-gradient-to-r from-amber-400 to-amber-500',
    'text-black font-bold text-lg',
    'rounded-lg',
    'hover:scale-105 hover:shadow-amber-500/50',
    'transition-all duration-300',
    'shadow-lg shadow-amber-500/30',
    'border border-amber-300',
  ].join(' ');

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#0A0A14' }}
      className="overflow-hidden"
    >
      <div className="absolute inset-0">
        <Image
          src={imageSrc}
          alt={imageAlt}
          fill
          priority
          className="object-cover"
          sizes="100vw"
        />
        {/* Bottom-right watermark mask — hides AI-generator signature
            baked into asset. ~24 % wide × 8 % tall covers Gemini /
            Imagen labels safely without intruding on the composition. */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: '24%',
            height: '8%',
            background:
              'linear-gradient(135deg, transparent 0%, rgba(10,10,20,0.85) 35%, #0A0A14 100%)',
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* Optional HTML text overlay — overrides any text baked into the
          image (e.g. corrects misspellings from the generator). */}
      {(errorCode || title || subtitle) && (
        <div
          aria-hidden={false}
          className="absolute inset-x-0 top-[18%] flex flex-col items-center pointer-events-none px-4 text-center"
        >
          {errorCode && (
            <span
              className="font-black tracking-wider"
              style={{
                fontSize: 'clamp(96px, 16vw, 220px)',
                lineHeight: 0.9,
                background: 'linear-gradient(180deg, #ffd97a 0%, #b8881a 60%, #6a4c0e 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                textShadow: '0 6px 24px rgba(0,0,0,0.7)',
                fontFamily: 'var(--font-cinzel, "Cinzel", serif)',
              }}
            >
              {errorCode}
            </span>
          )}
          {title && (
            <span
              className="mt-2 font-black uppercase"
              style={{
                fontSize: 'clamp(28px, 4.5vw, 64px)',
                letterSpacing: '0.18em',
                color: '#f5e3b3',
                textShadow: '0 2px 12px rgba(0,0,0,0.85), 0 0 28px rgba(255,197,66,0.25)',
                fontFamily: 'var(--font-cinzel, "Cinzel", serif)',
              }}
            >
              {title}
            </span>
          )}
          {subtitle && (
            <span
              className="mt-3 italic max-w-2xl"
              style={{
                fontSize: 'clamp(14px, 1.5vw, 20px)',
                color: 'rgba(245,227,179,0.7)',
                textShadow: '0 1px 6px rgba(0,0,0,0.85)',
              }}
            >
              {subtitle}
            </span>
          )}
        </div>
      )}

      {showCta && (
        ctaOnClick ? (
          <button onClick={ctaOnClick} className={ctaClasses}>
            {ctaText}
          </button>
        ) : (
          <Link href={ctaHref} className={ctaClasses}>
            {ctaText}
          </Link>
        )
      )}
    </div>
  );
}
