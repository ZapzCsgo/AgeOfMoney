'use client';

/**
 * Subtle fade + slide-up wrapper for every top-level section on
 * /admin/finance. Staggered by `delay` so sections settle one after the
 * other on first paint — avoids the "everything pops in at once" feel.
 *
 * Keep the animation short and small (8px up → 0) so it reads as polish,
 * not as a splash transition.
 */

import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

export function SectionFade({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1], delay }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Inline error row rendered INSIDE a section — small, sober, doesn't
 * eat the whole layout when a single endpoint fails. If `children` is
 * provided, they are rendered as "actionable" (e.g. retry button).
 */
export function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      className="flex items-center gap-3 rounded-lg px-3 py-2 text-[11px]"
      style={{
        background: 'rgba(239,68,68,0.08)',
        border: '1px solid rgba(239,68,68,0.3)',
        color: '#fca5a5',
      }}
    >
      <span className="flex-1">{message}</span>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase hover:opacity-80 transition-opacity"
          style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', color: '#fca5a5' }}
        >
          Réessayer
        </button>
      )}
    </div>
  );
}
