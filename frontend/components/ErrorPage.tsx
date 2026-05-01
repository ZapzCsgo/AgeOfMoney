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
 */
interface ErrorPageProps {
  imageSrc: string;
  imageAlt: string;
  ctaText?: string;
  ctaHref?: string;
  ctaOnClick?: () => void;
  showCta?: boolean;
}

export function ErrorPage({
  imageSrc,
  imageAlt,
  ctaText = 'Return Home',
  ctaHref = '/',
  ctaOnClick,
  showCta = true,
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
      </div>

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
