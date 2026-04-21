'use client';

import { useState } from 'react';
import { Check, X, ChevronDown, ChevronUp, Flame, Lightbulb, Wallet, TrendingUp, Droplets } from 'lucide-react';
import { EventSuggestion, RULE_LABELS, RULE_CATEGORY, CATEGORY_LABELS, PRIORITY_STYLE } from './types';

/** Friendly relative "il y a X min / h / j" for createdAt */
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "à l'instant";
  if (diff < 3_600_000) return `il y a ${Math.round(diff / 60_000)} min`;
  if (diff < 86_400_000) return `il y a ${Math.round(diff / 3_600_000)} h`;
  return `il y a ${Math.round(diff / 86_400_000)} j`;
}

function renderContextValue(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'number') return v.toLocaleString('fr-FR');
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map((x) => renderContextValue(x)).join(', ');
  return JSON.stringify(v);
}

export function EventCard({
  event,
  onActed,
  onDismiss,
  onLaunchRain,
  busy,
}: {
  event: EventSuggestion;
  onActed: (e: EventSuggestion) => void;
  onDismiss: (id: string) => void;
  onLaunchRain?: (e: EventSuggestion) => void;
  busy: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const style = PRIORITY_STYLE[event.priority];
  const category = RULE_CATEGORY[event.ruleType];

  const contextEntries = Object.entries(event.contextData ?? {});

  return (
    <article
      className="rounded-xl transition-colors"
      style={{
        background: event.priority === 'HIGH' ? 'rgba(239,68,68,0.04)' : '#0e0d1a',
        border: `1px solid ${style.border}`,
      }}
    >
      <div className="p-4">
        {/* Header line : priority + category + timestamp */}
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase"
            style={{ background: style.badgeBg, color: style.badgeColor, border: `1px solid ${style.border}` }}
          >
            {event.priority === 'HIGH' ? <Flame size={10} /> : null}
            {event.priority}
          </span>
          <span
            className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase"
            style={{ background: 'rgba(255,255,255,0.04)', color: '#9990b8', border: '1px solid rgba(255,255,255,0.06)' }}
          >
            {CATEGORY_LABELS[category]}
          </span>
          {event.status === 'SEEN' && (
            <span className="text-[9px] tracking-wider uppercase" style={{ color: '#6b6488' }}>
              vu
            </span>
          )}
          <span className="ml-auto text-[10px]" style={{ color: '#6b6488' }}>
            {relativeTime(event.createdAt)} · {RULE_LABELS[event.ruleType]}
          </span>
        </div>

        {/* Title */}
        <h3 className="text-[16px] font-bold mb-1.5" style={{ fontFamily: 'Cinzel, serif', color: style.badgeColor }}>
          {event.title}
        </h3>

        {/* Suggested action */}
        <div className="flex items-start gap-2 text-[13px] mb-3" style={{ color: '#e5e5e5' }}>
          <Lightbulb size={14} className="shrink-0 mt-0.5" style={{ color: style.accent }} />
          <p className="leading-relaxed">{event.suggestedAction}</p>
        </div>

        {/* Budget + Impact row */}
        {(event.estimatedBudget || event.estimatedImpact) && (
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] mb-3">
            {event.estimatedBudget && (
              <span className="flex items-center gap-1.5" style={{ color: '#9990b8' }}>
                <Wallet size={11} />
                <span>Budget :</span>
                <span style={{ color: '#c8c0e0' }}>{event.estimatedBudget}</span>
              </span>
            )}
            {event.estimatedImpact && (
              <span className="flex items-center gap-1.5" style={{ color: '#9990b8' }}>
                <TrendingUp size={11} />
                <span>Impact :</span>
                <span style={{ color: '#c8c0e0' }}>{event.estimatedImpact}</span>
              </span>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {event.ruleType === 'RAIN_OPPORTUNITY' && onLaunchRain ? (
            <button
              onClick={() => onLaunchRain(event)}
              disabled={busy}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold tracking-wider uppercase hover:opacity-90 transition-opacity disabled:opacity-50"
              style={{
                background: 'linear-gradient(135deg, #f5c842 0%, #d4a017 100%)',
                color: '#1a1010',
                border: 'none',
                boxShadow: '0 1px 8px rgba(255,197,66,0.25)',
              }}
            >
              <Droplets size={11} />
              Launch Rain
            </button>
          ) : (
            <button
              onClick={() => onActed(event)}
              disabled={busy}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold tracking-wider uppercase hover:opacity-80 transition-opacity disabled:opacity-50"
              style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.35)', color: '#10b981' }}
            >
              <Check size={11} />
              Marquer traité
            </button>
          )}
          <button
            onClick={() => onDismiss(event.id)}
            disabled={busy}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold tracking-wider uppercase hover:opacity-80 transition-opacity disabled:opacity-50"
            style={{ background: '#13111f', border: '1px solid #2a2640', color: '#9990b8' }}
          >
            <X size={11} />
            Ignorer 7 j
          </button>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold tracking-wider uppercase hover:opacity-80 transition-opacity"
            style={{ background: 'transparent', border: '1px solid #2a2640', color: '#6b6488' }}
          >
            {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            {expanded ? 'Moins' : 'Détails'}
          </button>
        </div>

        {/* Expanded context data */}
        {expanded && contextEntries.length > 0 && (
          <div
            className="mt-3 pt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]"
            style={{ borderTop: '1px solid #1a1730' }}
          >
            {contextEntries.map(([k, v]) => (
              <div key={k} className="flex items-baseline gap-2">
                <span className="shrink-0" style={{ color: '#6b6488' }}>{k} :</span>
                <span className="font-mono truncate" style={{ color: '#c8c0e0' }}>
                  {renderContextValue(v)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
