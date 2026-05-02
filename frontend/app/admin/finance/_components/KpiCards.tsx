'use client';

import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { Sparkline } from './Sparkline';
import { InfoTooltip } from './InfoTooltip';
import type { RangePreset } from './DateRangePicker';

// ─── Types — mirror the backend `OverviewResponse` shape ────────────────────

export interface OverviewKpis {
  ggr: number;
  ngr: number;
  netCashflowCents: number;
  activeUserLiability: number;
  totalDepositsCents: number;
  totalWithdrawalsCents: number;
  affiliateCommissionsPaid: number;
}

export interface OverviewResponse extends OverviewKpis {
  generatedAt: string;
  range: { label: RangePreset; from: string; to: string };
  compare: {
    previous: OverviewKpis;
    deltas: {
      ggrPct: number | null;
      ngrPct: number | null;
      depositsPct: number | null;
      withdrawalsPct: number | null;
      affiliatePct: number | null;
    };
  };
  sparklines: {
    ggrDaily: number[];
    depositsDailyCents: number[];
  };
}

// ─── Formatters ─────────────────────────────────────────────────────────────

function formatCoins(v: number): string {
  return v.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatCents(c: number): string {
  // Cents → € with 2 decimals, French separators ("1 234,56")
  return (c / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Delta pill ─────────────────────────────────────────────────────────────

function DeltaPill({ pct }: { pct: number | null }) {
  if (pct == null) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded"
        style={{ background: 'rgba(107,100,136,0.15)', color: '#9990b8' }}>
        new
      </span>
    );
  }
  const abs = Math.abs(pct);
  const sign = pct > 0 ? '+' : pct < 0 ? '-' : '';
  const Icon = pct > 0 ? ArrowUp : pct < 0 ? ArrowDown : Minus;
  const color = pct > 0 ? '#10b981' : pct < 0 ? '#ef4444' : '#6b7280';
  const bg    = pct > 0 ? 'rgba(16,185,129,0.1)' : pct < 0 ? 'rgba(239,68,68,0.1)' : 'rgba(107,114,128,0.1)';
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded"
      style={{ background: bg, color }}>
      <Icon size={10} />
      {sign}{abs.toFixed(1)}%
    </span>
  );
}

// ─── Single KPI card ────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string;
  suffix?: string;
  tooltip: string;
  delta?: number | null;
  sparkline?: number[];
  loading?: boolean;
  compare?: boolean;
  accent?: string;
}

function KpiCard({ label, value, suffix, tooltip, delta, sparkline, loading, compare = true, accent = '#ffd97a' }: KpiCardProps) {
  return (
    <div
      className="rounded-xl p-4 flex flex-col justify-between h-full group relative"
      style={{ background: '#0e0d1a', border: '1px solid #1e1a30' }}
    >
      <div>
        <div className="flex items-center gap-1 text-[10px] tracking-[0.2em] uppercase" style={{ color: '#6b6488' }}>
          {label}
          <InfoTooltip content={tooltip} />
        </div>

        <div className="mt-2 flex items-baseline gap-1.5 min-h-[28px]">
          {loading ? (
            <div className="h-6 w-20 rounded" style={{ background: 'rgba(255,255,255,0.04)' }} />
          ) : (
            <>
              <span className="text-[22px] font-bold leading-none" style={{ color: accent, fontFamily: 'Cinzel, serif' }}>
                {value}
              </span>
              {suffix && <span className="text-[11px]" style={{ color: '#6b6488' }}>{suffix}</span>}
            </>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        {compare && delta !== undefined
          ? <DeltaPill pct={delta ?? null} />
          : <span />
        }
        {sparkline && sparkline.length > 0 && (
          <Sparkline points={sparkline} width={72} height={22} color={accent} areaColor="rgba(255,197,66,0.10)" />
        )}
      </div>
    </div>
  );
}

// ─── The grid ──────────────────────────────────────────────────────────────

export function KpiCards({
  data,
  loading,
  compare,
}: {
  data: OverviewResponse | null;
  loading: boolean;
  compare: boolean;
}) {
  const d = data; // shorter alias

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
      <KpiCard
        label="GGR"
        value={d ? formatCoins(d.ggr) : '—'}
        suffix="⚜"
        tooltip="Gross Gaming Revenue — mises des users moins les gains versés. L'argent qui reste au book avant bonus et commissions d'affiliation."
        delta={d?.compare.deltas.ggrPct}
        sparkline={d?.sparklines.ggrDaily}
        loading={loading}
        compare={compare}
      />
      <KpiCard
        label="NGR"
        value={d ? formatCoins(d.ngr) : '—'}
        suffix="⚜"
        tooltip="Net Gaming Revenue — GGR après commissions d'affiliation payées dans la période. Vraie marge nette du book."
        delta={d?.compare.deltas.ngrPct}
        loading={loading}
        compare={compare}
      />
      <KpiCard
        label="Cashflow net"
        value={d ? formatCents(d.netCashflowCents) : '—'}
        suffix="€"
        tooltip="Deposits moins withdrawals sur la période (transactions confirmées uniquement). Positif = plus d'argent entré que sorti."
        loading={loading}
        compare={compare}
      />
      <KpiCard
        label="User liability"
        value={d ? formatCoins(d.activeUserLiability) : '—'}
        suffix="⚜"
        tooltip="Somme des soldes de tous les users non-bannis à l'instant T. Montant que tu dois potentiellement si tous retiraient demain."
        loading={loading}
        compare={false}
        accent="#f5c842"
      />
      <KpiCard
        label="Deposits"
        value={d ? formatCents(d.totalDepositsCents) : '—'}
        suffix="€"
        tooltip="Total des deposits confirmés sur la période (OxaPay, EUR)."
        delta={d?.compare.deltas.depositsPct}
        sparkline={d?.sparklines.depositsDailyCents}
        loading={loading}
        compare={compare}
      />
      <KpiCard
        label="Withdrawals"
        value={d ? formatCents(d.totalWithdrawalsCents) : '—'}
        suffix="€"
        tooltip="Total des retraits confirmés sur la période. Monte si les users encaissent leurs gains."
        delta={d?.compare.deltas.withdrawalsPct}
        loading={loading}
        compare={compare}
      />
    </div>
  );
}
