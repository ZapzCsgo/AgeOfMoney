'use client';

import { RefreshCw, ChevronDown } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';

export type RangePreset = '1d' | '7d' | '30d' | '90d' | 'mtd' | 'all';

export const RANGE_LABELS: Record<RangePreset, string> = {
  '1d':  "Aujourd'hui",
  '7d':  '7 jours',
  '30d': '30 jours',
  '90d': '90 jours',
  'mtd': 'Ce mois-ci',
  'all': 'Tout',
};

export function DateRangePicker({
  value,
  onChange,
  compare,
  onCompareChange,
  onRefresh,
  refreshing,
  lastUpdatedAt,
}: {
  value: RangePreset;
  onChange: (v: RangePreset) => void;
  compare: boolean;
  onCompareChange: (v: boolean) => void;
  onRefresh: () => void;
  refreshing: boolean;
  lastUpdatedAt: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const menuRef = useRef<HTMLDivElement>(null);

  // Refresh the "X min ago" label once a second so it stays accurate
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Close the preset menu on outside click
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const ago = lastUpdatedAt
    ? (() => {
        const diff = now - lastUpdatedAt;
        if (diff < 10_000) return "a l'instant";
        if (diff < 60_000) return `il y a ${Math.round(diff / 1000)}s`;
        if (diff < 3_600_000) return `il y a ${Math.round(diff / 60_000)} min`;
        return `il y a ${Math.round(diff / 3_600_000)} h`;
      })()
    : '—';

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Range preset menu */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-[12px] font-ui font-bold tracking-wider uppercase transition-colors bg-tft-bg-elevated border border-tft-border-mid text-tft-text hover:border-tft-purple-bright"
        >
          {RANGE_LABELS[value]}
          <ChevronDown size={12} className="text-tft-text-muted" />
        </button>

        {open && (
          <div
            className="absolute left-0 mt-1 rounded-md overflow-hidden z-20 bg-tft-bg-card border border-tft-border"
            style={{ minWidth: 160 }}
          >
            {(Object.keys(RANGE_LABELS) as RangePreset[]).map((k) => (
              <button
                key={k}
                onClick={() => { onChange(k); setOpen(false); }}
                className={`block w-full text-left px-3 py-2 text-[12px] transition-colors ${
                  value === k
                    ? 'bg-tft-purple/15 text-tft-purple-bright'
                    : 'text-tft-text-dim hover:bg-tft-bg-hover'
                }`}
              >
                {RANGE_LABELS[k]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Compare toggle */}
      <button
        onClick={() => onCompareChange(!compare)}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-ui font-bold tracking-wider uppercase transition-colors ${
          compare
            ? 'bg-tft-purple/10 border border-tft-purple-bright/40 text-tft-purple-bright'
            : 'bg-tft-bg-elevated border border-tft-border-mid text-tft-text-dim'
        }`}
      >
        Comparer
      </button>

      {/* Refresh */}
      <button
        onClick={onRefresh}
        disabled={refreshing}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-ui font-bold tracking-wider uppercase transition-colors disabled:opacity-60 bg-tft-bg-elevated border border-tft-border-mid text-tft-text-dim hover:text-tft-text"
        aria-label="refresh"
      >
        <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
        Refresh
      </button>

      {/* Data-as-of indicator */}
      <span className="text-[10px] ml-1 text-tft-text-muted">
        Donnees · {ago}
      </span>
    </div>
  );
}
