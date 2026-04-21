'use client';

/**
 * Anomalies feed — lists the currently-active flags from the 5 detectors
 * and lets the operator dismiss each one for 7 days.
 *
 * Critical cards (gambling flags) get a red border so they catch the eye
 * on scroll. Warnings get gold. Dismissal is optimistic : the card
 * disappears instantly and only rolls back if the backend refuses.
 */

import { useState } from 'react';
import { AlertTriangle, ShieldAlert, Check, Percent, TrendingUp, User as UserIcon } from 'lucide-react';
import { useFinanceFetch } from '../_hooks/useFinanceFetch';
import { apiClient } from '@/lib/api';
import { InfoTooltip } from './InfoTooltip';

// ─── Types ──────────────────────────────────────────────────────────────────

export type AnomalySeverity = 'critical' | 'warning' | 'info';
export type AnomalyType = 'sharp' | 'whale' | 'gambling_deposits' | 'gambling_losses' | 'rake_anomaly';

export interface Anomaly {
  key: string;
  type: AnomalyType;
  severity: AnomalySeverity;
  title: string;
  description: string;
  evidence: Record<string, unknown>;
  detectedAt: string;
  userId?: string;
  username?: string;
}

export interface AnomaliesResponse {
  generatedAt: string;
  anomalies: Anomaly[];
}

// ─── Visual config per type ────────────────────────────────────────────────

const TYPE_ICON: Record<AnomalyType, typeof UserIcon> = {
  sharp:               TrendingUp,
  whale:               TrendingUp,
  gambling_deposits:   ShieldAlert,
  gambling_losses:     ShieldAlert,
  rake_anomaly:        Percent,
};

const SEVERITY_STYLE: Record<AnomalySeverity, { bg: string; border: string; color: string; accent: string }> = {
  critical: { bg: 'rgba(239,68,68,0.08)',  border: 'rgba(239,68,68,0.4)',  color: '#f87171', accent: '#ef4444' },
  warning:  { bg: 'rgba(255,197,66,0.08)', border: 'rgba(255,197,66,0.35)', color: '#ffd97a', accent: '#ffc542' },
  info:     { bg: 'rgba(129,140,248,0.08)', border: 'rgba(129,140,248,0.35)', color: '#a5b4fc', accent: '#818cf8' },
};

const SEVERITY_LABEL: Record<AnomalySeverity, string> = {
  critical: 'CRITICAL',
  warning:  'WARNING',
  info:     'INFO',
};

// ─── Section ────────────────────────────────────────────────────────────────

export function AnomaliesSection({ ready }: { ready: boolean }) {
  const { data, loading, refresh, lastUpdatedAt } = useFinanceFetch<AnomaliesResponse>(
    '/admin/finance/anomalies',
    {},
    { enabled: ready },
  );

  // Optimistic dismissals — hides the card instantly, rolls back on error
  const [dismissing, setDismissing] = useState<Set<string>>(new Set());
  const [locallyDismissed, setLocallyDismissed] = useState<Set<string>>(new Set());

  async function handleDismiss(key: string) {
    setDismissing((s) => new Set(s).add(key));
    setLocallyDismissed((s) => new Set(s).add(key));
    try {
      await apiClient.post(`/admin/finance/anomalies/${encodeURIComponent(key)}/dismiss`);
      // Re-fetch so the true server state matches the UI
      await refresh();
    } catch (err) {
      console.error('[Anomalies] dismiss failed:', err);
      // Rollback
      setLocallyDismissed((s) => {
        const next = new Set(s);
        next.delete(key);
        return next;
      });
    } finally {
      setDismissing((s) => {
        const next = new Set(s);
        next.delete(key);
        return next;
      });
    }
  }

  const anomalies = (data?.anomalies ?? []).filter((a) => !locallyDismissed.has(a.key));
  const countBySeverity = {
    critical: anomalies.filter((a) => a.severity === 'critical').length,
    warning:  anomalies.filter((a) => a.severity === 'warning').length,
    info:     anomalies.filter((a) => a.severity === 'info').length,
  };
  const totalCount = anomalies.length;

  return (
    <section
      className="rounded-2xl p-5 mt-8"
      style={{ background: '#0e0d1a', border: '1px solid #1e1a30' }}
    >
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <AlertTriangle size={14} style={{ color: totalCount > 0 ? '#f87171' : '#6b6488' }} />
          <h2
            className="text-[14px] font-bold tracking-widest uppercase"
            style={{ fontFamily: 'Cinzel, serif', color: '#e8e2f5' }}
          >
            Anomalies
          </h2>
          <InfoTooltip content="5 détecteurs automatiques tournent en continu : sharps (winrate > 65 %), gros winners, responsible gaming flags (dépôts > 5 k€/7j et pertes massives/24h), margin anormale par produit. Un dismiss silence l'alerte 7 jours." />
          {totalCount > 0 && (
            <span
              className="ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{
                background: countBySeverity.critical > 0 ? 'rgba(239,68,68,0.15)' : 'rgba(255,197,66,0.15)',
                color: countBySeverity.critical > 0 ? '#f87171' : '#ffd97a',
                border: countBySeverity.critical > 0 ? '1px solid rgba(239,68,68,0.4)' : '1px solid rgba(255,197,66,0.4)',
              }}
            >
              {totalCount}
            </span>
          )}
        </div>
        {lastUpdatedAt && (
          <span className="text-[10px]" style={{ color: '#6b6488' }}>
            dernière analyse · {new Date(lastUpdatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      {loading && !data ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-16 rounded-lg animate-pulse" style={{ background: 'rgba(255,255,255,0.02)' }} />
          ))}
        </div>
      ) : anomalies.length === 0 ? (
        <div className="text-center py-10 text-[12px]" style={{ color: '#6b6488' }}>
          <Check size={20} className="mx-auto mb-2" style={{ color: '#10b981' }} />
          Aucune anomalie détectée pour l&apos;instant. Tout est clean.
        </div>
      ) : (
        <div className="space-y-2">
          {anomalies.map((a) => {
            const Icon = TYPE_ICON[a.type];
            const style = SEVERITY_STYLE[a.severity];
            const isDismissing = dismissing.has(a.key);
            return (
              <div
                key={a.key}
                className="rounded-lg p-3 flex items-start gap-3"
                style={{
                  background: style.bg,
                  border: `1px solid ${style.border}`,
                  opacity: isDismissing ? 0.5 : 1,
                  transition: 'opacity 0.15s',
                }}
              >
                <div
                  className="shrink-0 p-1.5 rounded-md"
                  style={{ background: `${style.accent}20`, color: style.accent }}
                >
                  <Icon size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="text-[9px] font-bold px-1.5 py-0.5 rounded tracking-wider uppercase"
                      style={{ background: `${style.accent}22`, color: style.color, border: `1px solid ${style.accent}44` }}
                    >
                      {SEVERITY_LABEL[a.severity]}
                    </span>
                    <span className="text-[13px] font-bold" style={{ color: '#e5e5e5' }}>
                      {a.title}
                    </span>
                  </div>
                  <p className="text-[12px] mt-1" style={{ color: '#c8c0e0' }}>
                    {a.description}
                  </p>
                </div>
                <button
                  onClick={() => handleDismiss(a.key)}
                  disabled={isDismissing}
                  className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-bold tracking-wider uppercase hover:opacity-80 transition-opacity disabled:opacity-50"
                  style={{ background: '#13111f', border: '1px solid #2a2640', color: '#9990b8' }}
                >
                  <Check size={10} />
                  {isDismissing ? 'Dismiss…' : 'Marquer revu'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
