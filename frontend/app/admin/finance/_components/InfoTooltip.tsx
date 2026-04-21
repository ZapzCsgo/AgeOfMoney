'use client';

/**
 * Click-activated tooltip on the little (?) icon next to KPI labels.
 *
 * Replaces the previous native `title=""` attribute — those were ugly,
 * slow to appear, and invisible on mobile. This one is styled, opens on
 * click, and closes on outside-click or escape.
 */

import { useState, useEffect, useRef } from 'react';
import { Info } from 'lucide-react';

export function InfoTooltip({ content, width = 240 }: { content: string; width?: number }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="opacity-60 hover:opacity-100 transition-opacity cursor-help"
        aria-label="En savoir plus"
      >
        <Info size={10} />
      </button>

      {open && (
        <span
          className="absolute left-1/2 -translate-x-1/2 mt-3 rounded-lg px-3 py-2 z-30 pointer-events-none text-[11px] leading-relaxed normal-case tracking-normal"
          style={{
            top: '100%',
            width,
            background: '#13111f',
            border: '1px solid #2a2640',
            color: '#c8c0e0',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            whiteSpace: 'normal',
          }}
        >
          {/* Arrow pointing up at the icon */}
          <span
            className="absolute left-1/2 -translate-x-1/2"
            style={{
              top: -5,
              width: 0,
              height: 0,
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              borderBottom: '5px solid #2a2640',
            }}
          />
          {content}
        </span>
      )}
    </span>
  );
}
