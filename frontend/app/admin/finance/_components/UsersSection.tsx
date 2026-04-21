'use client';

/**
 * User growth & retention — 4 KPI cards + 2 line charts (signups, retention)
 * + 1 horizontal bar chart (deposits frequency).
 *
 * Soft-launch reality-check :
 *   - DAU/WAU/MAU will be single-digit. That's OK, the empty states handle it.
 *   - Retention needs ≥ 3 cohorts to be meaningful. Below that we show a
 *     warning, below it we still plot but flag it.
 *   - Deposits frequency is LIFETIME (backend choice — see service).
 */

import { ArrowDown, ArrowUp, Minus, Users, CalendarDays, TrendingUp, Percent } from 'lucide-react';
import { Sparkline } from './Sparkline';
import { LineChart } from './LineChart';
import { InfoTooltip } from './InfoTooltip';
import type { RangePreset } from './DateRangePicker';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface UserGrowthResponse {
  generatedAt: string;
  range: { label: RangePreset; from: string; to: string };
  kpis: {
    dau: number;
    wau: number;
    mau: number;
    stickinessPct: number;
    deltas: {
      dauPct: number | null;
      wauPct: number | null;
      mauPct: number | null;
      stickinessPct: number | null;
    };
  };
  sparklines: { dauDaily: number[] };
  signupsDaily: Array<{ day: string; count: number }>;
  retention: { d1: number; d7: number; d14: number; d30: number; cohortCount: number };
  depositsFrequency: {
    depositors1x: number;
    depositors2x: number;
    depositors3to5x: number;
    depositors6to10x: number;
    depositors10plus: number;
  };
}

// ─── Delta pill (copy of KpiCards pattern, kept local to avoid a circular) ──

function DeltaPill({ pct }: { pct: number | null }) {
  if (pct == null) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded"
        style={{ background: 'rgba(107,100,136,0.15)', color: '#9990b8' }}>
        new
      </span>
    );
  }
  const sign = pct > 0 ? '+' : pct < 0 ? '-' : '';
  const Icon = pct > 0 ? ArrowUp : pct < 0 ? ArrowDown : Minus;
  const color = pct > 0 ? '#10b981' : pct < 0 ? '#ef4444' : '#6b7280';
  const bg    = pct > 0 ? 'rgba(16,185,129,0.1)' : pct < 0 ? 'rgba(239,68,68,0.1)' : 'rgba(107,114,128,0.1)';
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded"
      style={{ background: bg, color }}>
      <Icon size={10} />
      {sign}{Math.abs(pct).toFixed(1)}%
    </span>
  );
}

// ─── 1 KPI card ─────────────────────────────────────────────────────────────

function UserKpi({
  icon: Icon,
  label,
  value,
  suffix,
  delta,
  sparkline,
  tooltip,
  loading,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  suffix?: string;
  delta?: number | null;
  sparkline?: number[];
  tooltip?: string;
  loading: boolean;
}) {
  return (
    <div
      className="flex-1 min-w-[150px] rounded-xl p-4 flex flex-col justify-between"
      style={{ background: '#0e0d1a', border: '1px solid #1e1a30' }}
    >
      <div>
        <div className="flex items-center gap-1.5 text-[10px] tracking-[0.2em] uppercase" style={{ color: '#6b6488' }}>
          <Icon size={11} />
          <span>{label}</span>
          {tooltip && <InfoTooltip content={tooltip} />}
        </div>
        <div className="mt-2 flex items-baseline gap-1.5 min-h-[24px]">
          {loading ? (
            <div className="h-5 w-20 rounded" style={{ background: 'rgba(255,255,255,0.04)' }} />
          ) : (
            <>
              <span className="text-[22px] font-bold leading-none" style={{ color: '#ffd97a', fontFamily: 'Cinzel, serif' }}>
                {value}
              </span>
              {suffix && <span className="text-[11px]" style={{ color: '#6b6488' }}>{suffix}</span>}
            </>
          )}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between">
        {delta !== undefined
          ? <DeltaPill pct={delta ?? null} />
          : <span />
        }
        {sparkline && sparkline.length > 0 && (
          <Sparkline points={sparkline} width={72} height={22} />
        )}
      </div>
    </div>
  );
}

// ─── Deposits histogram ─────────────────────────────────────────────────────

function DepositsHistogram({ data }: { data: UserGrowthResponse['depositsFrequency'] | null }) {
  if (!data) return null;
  const buckets = [
    { label: '1 dépôt',    value: data.depositors1x },
    { label: '2 dépôts',   value: data.depositors2x },
    { label: '3-5 dépôts', value: data.depositors3to5x },
    { label: '6-10 dépôts', value: data.depositors6to10x },
    { label: '10+ dépôts', value: data.depositors10plus },
  ];
  const total = buckets.reduce((s, b) => s + b.value, 0);
  if (total === 0) {
    return (
      <div className="text-center py-6 text-[12px]" style={{ color: '#6b6488' }}>
        Aucun dépôt enregistré pour le moment.
      </div>
    );
  }
  const maxV = Math.max(...buckets.map((b) => b.value), 1);
  // Gradient gold shades darker as count climbs
  const shades = ['#fff0a8', '#ffd97a', '#f5c842', '#d4a017', '#8b6914'];

  return (
    <div className="space-y-2">
      {buckets.map((b, i) => (
        <div key={b.label} className="flex items-center gap-3 text-[12px]">
          <div className="w-24 shrink-0 text-right" style={{ color: '#9990b8' }}>{b.label}</div>
          <div
            className="flex-1 h-6 rounded overflow-hidden relative"
            style={{ background: 'rgba(255,255,255,0.03)' }}
          >
            {b.value > 0 && (
              <div
                className="h-full rounded transition-all"
                style={{
                  width: `${(b.value / maxV) * 100}%`,
                  background: shades[i],
                  boxShadow: `0 0 8px ${shades[i]}44`,
                }}
              />
            )}
          </div>
          <div className="w-16 shrink-0 text-right font-mono font-bold" style={{ color: '#ffd97a' }}>
            {b.value}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Section ────────────────────────────────────────────────────────────────

function retentionToPoints(r: UserGrowthResponse['retention'] | null) {
  if (!r) return [];
  return [
    { x: 'D1',  y: r.d1  * 100 },
    { x: 'D7',  y: r.d7  * 100 },
    { x: 'D14', y: r.d14 * 100 },
    { x: 'D30', y: r.d30 * 100 },
  ];
}

export function UsersSection({
  data,
  loading,
}: {
  data: UserGrowthResponse | null;
  loading: boolean;
}) {
  const k = data?.kpis;
  const signupsTotal = (data?.signupsDaily ?? []).reduce((s, r) => s + r.count, 0);

  const signupPoints = (data?.signupsDaily ?? []).map((p) => ({
    x: new Date(p.day).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
    y: p.count,
  }));
  const retentionPoints = retentionToPoints(data?.retention ?? null);
  const cohortCount = data?.retention?.cohortCount ?? 0;
  const cohortsBelowThreshold = cohortCount > 0 && cohortCount < 3;

  return (
    <section
      className="rounded-2xl p-5 mt-8"
      style={{ background: '#0e0d1a', border: '1px solid #1e1a30' }}
    >
      <div className="flex items-center justify-between mb-4">
        <h2
          className="text-[14px] font-bold tracking-widest uppercase"
          style={{ fontFamily: 'Cinzel, serif', color: '#e8e2f5' }}
        >
          User growth &amp; retention
        </h2>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <UserKpi
          icon={Users}
          label="DAU"
          value={k ? String(k.dau) : '—'}
          delta={k?.deltas.dauPct}
          sparkline={data?.sparklines.dauDaily}
          tooltip="Utilisateurs actifs sur les dernières 24 h : au moins 1 bet, coinflip, roulette, jackpot ou transaction."
          loading={loading && !data}
        />
        <UserKpi
          icon={CalendarDays}
          label="WAU"
          value={k ? String(k.wau) : '—'}
          delta={k?.deltas.wauPct}
          tooltip="Utilisateurs actifs sur 7 jours glissants."
          loading={loading && !data}
        />
        <UserKpi
          icon={TrendingUp}
          label="MAU"
          value={k ? String(k.mau) : '—'}
          delta={k?.deltas.mauPct}
          tooltip="Utilisateurs actifs sur 30 jours glissants."
          loading={loading && !data}
        />
        <UserKpi
          icon={Percent}
          label="Stickiness"
          value={k ? `${k.stickinessPct.toFixed(1)}` : '—'}
          suffix="%"
          delta={k?.deltas.stickinessPct}
          tooltip="DAU ÷ MAU × 100 — proportion de ton audience mensuelle qui revient chaque jour. 20 %+ est excellent."
          loading={loading && !data}
        />
      </div>

      {/* Charts row — signups + retention */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        {/* Signups */}
        <div className="rounded-lg p-3" style={{ background: '#0a0817', border: '1px solid #1a1730' }}>
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-[11px] font-bold tracking-wider uppercase" style={{ color: '#c8c0e0' }}>
                Nouveaux utilisateurs
              </div>
              <div className="text-[10px]" style={{ color: '#6b6488' }}>
                {signupsTotal} signup{signupsTotal !== 1 ? 's' : ''} sur la période
              </div>
            </div>
          </div>
          {loading && !data ? (
            <div className="h-40 rounded animate-pulse" style={{ background: 'rgba(255,255,255,0.02)' }} />
          ) : signupPoints.length === 0 ? (
            <div className="text-center py-12 text-[11px]" style={{ color: '#6b6488' }}>
              Pas de nouveaux utilisateurs sur cette période.
            </div>
          ) : (
            <LineChart points={signupPoints} width={420} height={160} />
          )}
        </div>

        {/* Retention */}
        <div className="rounded-lg p-3" style={{ background: '#0a0817', border: '1px solid #1a1730' }}>
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-[11px] font-bold tracking-wider uppercase" style={{ color: '#c8c0e0' }}>
                Retention moyenne
              </div>
              <div className="text-[10px]" style={{ color: '#6b6488' }}>
                {cohortCount} cohort{cohortCount !== 1 ? 's' : ''} — stabilise avec plus d&apos;utilisateurs
              </div>
            </div>
            {cohortsBelowThreshold && (
              <span
                className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}
              >
                ≥ 3 cohorts requis
              </span>
            )}
          </div>
          {loading && !data ? (
            <div className="h-40 rounded animate-pulse" style={{ background: 'rgba(255,255,255,0.02)' }} />
          ) : retentionPoints.length === 0 || cohortCount === 0 ? (
            <div className="text-center py-12 text-[11px]" style={{ color: '#6b6488' }}>
              Pas de cohorts disponibles sur cette période.
            </div>
          ) : (
            <LineChart
              points={retentionPoints}
              width={420}
              height={160}
              ySuffix="%"
              yIntFormat={false}
            />
          )}
        </div>
      </div>

      {/* Deposits frequency histogram */}
      <div className="rounded-lg p-3" style={{ background: '#0a0817', border: '1px solid #1a1730' }}>
        <div className="flex items-center gap-2 mb-3">
          <div className="text-[11px] font-bold tracking-wider uppercase" style={{ color: '#c8c0e0' }}>
            Distribution des dépôts
          </div>
          <InfoTooltip content="Lifetime : combien de users ont déposé 1x, 2x, 3-5x, 6-10x, 10+. Indicateur de fidélité / valeur par user." />
        </div>
        {loading && !data ? (
          <div className="h-32 rounded animate-pulse" style={{ background: 'rgba(255,255,255,0.02)' }} />
        ) : (
          <DepositsHistogram data={data?.depositsFrequency ?? null} />
        )}
      </div>
    </section>
  );
}
