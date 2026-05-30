'use client';

import { useState } from 'react';
import { Check, X, ChevronDown, ChevronUp, Flame, Lightbulb, Wallet, TrendingUp } from 'lucide-react';
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
  if (typeof v === 'number') return v.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map((x) => renderContextValue(x)).join(', ');
  return JSON.stringify(v);
}

/**
 * Single event suggestion row.
 *
 * On tft.money the "Launch Rain" action is omitted — rain isn't shipped
 * on this site so RAIN_OPPORTUNITY suggestions show the standard
 * "Marquer traité" CTA like every other rule.
 */
export function EventCard({
  event,
  onActed,
  onDismiss,
  busy,
}: {
  event: EventSuggestion;
  onActed: (e: EventSuggestion) => void;
  onDismiss: (id: string) => void;
  busy: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const style = PRIORITY_STYLE[event.priority];
  const category = RULE_CATEGORY[event.ruleType];

  const contextEntries = Object.entries(event.contextData ?? {});

  return (
    <article
      className="rounded-md transition-colors bg-tft-bg-card"
      style={{
        background: event.priority === 'HIGH' ? 'rgba(239,68,68,0.04)' : undefined,
        border: `1px solid ${style.border}`,
      }}
    >
      <div className="p-4">
        {/* Header line : priority + category + timestamp */}
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase font-ui"
            style={{ background: style.badgeBg, color: style.badgeColor, border: `1px solid ${style.border}` }}
          >
            {event.priority === 'HIGH' ? <Flame size={10} /> : null}
            {event.priority}
          </span>
          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase font-ui bg-tft-bg-elevated border border-tft-border text-tft-text-dim">
            {CATEGORY_LABELS[category]}
          </span>
          {event.status === 'SEEN' && (
            <span className="text-[9px] tracking-wider uppercase text-tft-text-muted font-ui">
              vu
            </span>
          )}
          <span className="ml-auto text-[10px] text-tft-text-muted font-ui">
            {relativeTime(event.createdAt)} · {RULE_LABELS[event.ruleType]}
          </span>
        </div>

        {/* Title */}
        <h3
          className="font-display text-[16px] font-bold mb-1.5"
          style={{ color: style.badgeColor }}
        >
          {event.title}
        </h3>

        {/* Suggested action */}
        <div className="flex items-start gap-2 text-[13px] mb-3 text-tft-text">
          <Lightbulb size={14} className="shrink-0 mt-0.5" style={{ color: style.accent }} />
          <p className="leading-relaxed">{event.suggestedAction}</p>
        </div>

        {/* Budget + Impact row */}
        {(event.estimatedBudget || event.estimatedImpact) && (
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] mb-3">
            {event.estimatedBudget && (
              <span className="flex items-center gap-1.5 text-tft-text-dim">
                <Wallet size={11} />
                <span>Budget :</span>
                <span className="text-tft-text">{event.estimatedBudget}</span>
              </span>
            )}
            {event.estimatedImpact && (
              <span className="flex items-center gap-1.5 text-tft-text-dim">
                <TrendingUp size={11} />
                <span>Impact :</span>
                <span className="text-tft-text">{event.estimatedImpact}</span>
              </span>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => onActed(event)}
            disabled={busy}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold tracking-wider uppercase hover:opacity-80 transition-opacity disabled:opacity-50 font-ui bg-tft-mint-dim border border-tft-mint/40 text-tft-mint"
          >
            <Check size={11} />
            Marquer traité
          </button>
          <button
            onClick={() => onDismiss(event.id)}
            disabled={busy}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold tracking-wider uppercase hover:opacity-80 transition-opacity disabled:opacity-50 font-ui bg-tft-bg-elevated border border-tft-border text-tft-text-dim"
          >
            <X size={11} />
            Ignorer 7 j
          </button>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold tracking-wider uppercase hover:opacity-80 transition-opacity font-ui bg-transparent border border-tft-border text-tft-text-muted"
          >
            {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            {expanded ? 'Moins' : 'Détails'}
          </button>
        </div>

        {/* Expanded context data */}
        {expanded && contextEntries.length > 0 && (
          <div className="mt-3 pt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] border-t border-tft-border">
            {contextEntries.map(([k, v]) => (
              <div key={k} className="flex items-baseline gap-2">
                <span className="shrink-0 text-tft-text-muted">{k} :</span>
                <span className="font-mono truncate text-tft-text">
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
