'use client';

import { useEffect, useState } from 'react';

/**
 * Subtle "rain of gold coins" background — pure CSS animation, no
 * canvas-confetti dependency. Each coin is a tiny SVG hexagon that
 * falls top → bottom while rotating, randomised per-instance so they
 * don't sync.
 *
 * Tuned (refonte 2026-05-29) for an ambient, restrained presence — the
 * previous version had so many coins at high opacity it pushed the page
 * into "casino fireworks" territory. Default is now half as many coins,
 * smaller, ~1/3 the opacity, slower fall. Caller can bump `count` for
 * more presence, but the default is what reads as classy.
 *
 * Deferred on the client (no SSR) because we randomise positions at
 * mount — rendering on the server would either need a seeded RNG (more
 * code) or produce hydration mismatches. The home is interactive-only
 * anyway, so loading this after hydration is fine.
 */
export function CoinRain({ count = 8 }: { count?: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;

  const coins = Array.from({ length: count }, (_, i) => {
    const left     = Math.random() * 100;            // %
    const duration = 14 + Math.random() * 14;        // 14-28s — slow, ambient
    const delay    = -Math.random() * duration;      // negative = already partway through on mount
    const size     = 8 + Math.random() * 8;          // 8-16px — small
    const opacity  = 0.10 + Math.random() * 0.14;    // 0.10-0.24 — very subtle
    return { i, left, duration, delay, size, opacity };
  });

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden="true"
    >
      {coins.map((c) => (
        <span
          key={c.i}
          className="absolute top-0 animate-coin-fall"
          style={{
            left: `${c.left}%`,
            opacity: c.opacity,
            width: c.size,
            height: c.size,
            // CSS variable — the keyframe references --coin-duration
            // so each instance can have its own speed without needing
            // 18 separate animation classes.
            ['--coin-duration' as string]: `${c.duration}s`,
            animationDelay: `${c.delay}s`,
          }}
        >
          <svg viewBox="0 0 32 32" width="100%" height="100%">
            <defs>
              <radialGradient id={`g${c.i}`} cx="40%" cy="40%" r="60%">
                <stop offset="0%"   stopColor="#fde68a" />
                <stop offset="60%"  stopColor="#fbbf24" />
                <stop offset="100%" stopColor="#b45309" />
              </radialGradient>
            </defs>
            <path
              d="M16 2l12 7v14L16 30 4 23V9z"
              fill={`url(#g${c.i})`}
              stroke="#fde68a"
              strokeWidth="0.6"
            />
          </svg>
        </span>
      ))}
    </div>
  );
}
