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
      <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-tft-text-faint/15 text-tft-text-dim">
        new
      </span>
    );
  }
  const abs = Math.abs(pct);
  const sign = pct > 0 ? '+' : pct < 0 ? '-' : '';
  const Icon = pct > 0 ? ArrowUp : pct < 0 ? ArrowDown : Minus;
  const color = pct > 0 ? '#34d399' : pct < 0 ? '#ef4444' : '#64748b';
  const bg    = pct > 0 ? 'rgba(52,211,153,0.12)' : pct < 0 ? 'rgba(239,68,68,0.12)' : 'rgba(100,116,139,0.12)';
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
  /** Hex colour for the big value + sparkline stroke. Pass a tft hex
   *  (e.g. tft-gold-bright #fcd34d for money / tft-purple-bright #a78bfa
   *  for non-money) since SVG props can't read tailwind classes. */
  accent?: string;
  /** Tailwind text- class matching `accent` — used on the big value so
   *  Tailwind's JIT picks it up when scanning this file. */
  accentClass?: string;
  /** Area fill colour (rgba string) for the sparkline beneath the line. */
  sparkAreaColor?: string;
}

function KpiCard({
  label,
  value,
  suffix,
  tooltip,
  delta,
  sparkline,
  loading,
  compare = true,
  accent = '#a78bfa',
  accentClass = 'text-tft-purple-bright',
  sparkAreaColor = 'rgba(167,139,250,0.10)',
}: KpiCardProps) {
  return (
    <div className="rounded-md p-4 flex flex-col justify-between h-full group relative bg-tft-bg-card border border-tft-border">
      <div>
        <div className="flex items-center gap-1 text-[10px] tracking-[0.2em] uppercase text-tft-text-muted">
          {label}
          <InfoTooltip content={tooltip} />
        </div>

        <div className="mt-2 flex items-baseline gap-1.5 min-h-[28px]">
          {loading ? (
            <div className="h-6 w-20 rounded bg-white/5" />
          ) : (
            <>
              <span className={`text-[22px] font-display font-bold leading-none ${accentClass}`}>
                {value}
              </span>
              {suffix && <span className="text-[11px] text-tft-text-muted">{suffix}</span>}
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
          <Sparkline points={sparkline} width={72} height={22} color={accent} areaColor={sparkAreaColor} />
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
        suffix="LP"
        tooltip="Gross Gaming Revenue — mises des users moins les gains verses. L'argent qui reste au book avant bonus et commissions d'affiliation."
        delta={d?.compare.deltas.ggrPct}
        sparkline={d?.sparklines.ggrDaily}
        loading={loading}
        compare={compare}
      />
      <KpiCard
        label="NGR"
        value={d ? formatCoins(d.ngr) : '—'}
        suffix="LP"
        tooltip="Net Gaming Revenue — GGR apres commissions d'affiliation payees dans la periode. Vraie marge nette du book."
        delta={d?.compare.deltas.ngrPct}
        loading={loading}
        compare={compare}
      />
      <KpiCard
        label="Cashflow net"
        value={d ? formatCents(d.netCashflowCents) : '—'}
        suffix="€"
        tooltip="Deposits moins withdrawals sur la periode (transactions confirmees uniquement). Positif = plus d'argent entre que sorti."
        loading={loading}
        compare={compare}
        accent="#fcd34d"
        accentClass="text-tft-gold-bright"
        sparkAreaColor="rgba(252,211,77,0.10)"
      />
      <KpiCard
        label="User liability"
        value={d ? formatCoins(d.activeUserLiability) : '—'}
        suffix="LP"
        tooltip="Somme des soldes de tous les users non-bannis a l'instant T. Montant que tu dois potentiellement si tous retiraient demain."
        loading={loading}
        compare={false}
        accent="#fbbf24"
        accentClass="text-tft-gold"
        sparkAreaColor="rgba(251,191,36,0.10)"
      />
      <KpiCard
        label="Deposits"
        value={d ? formatCents(d.totalDepositsCents) : '—'}
        suffix="€"
        tooltip="Total des deposits confirmes sur la periode (OxaPay, EUR)."
        delta={d?.compare.deltas.depositsPct}
        sparkline={d?.sparklines.depositsDailyCents}
        loading={loading}
        compare={compare}
        accent="#fcd34d"
        accentClass="text-tft-gold-bright"
        sparkAreaColor="rgba(252,211,77,0.10)"
      />
      <KpiCard
        label="Withdrawals"
        value={d ? formatCents(d.totalWithdrawalsCents) : '—'}
        suffix="€"
        tooltip="Total des retraits confirmes sur la periode. Monte si les users encaissent leurs gains."
        delta={d?.compare.deltas.withdrawalsPct}
        loading={loading}
        compare={compare}
        accent="#fcd34d"
        accentClass="text-tft-gold-bright"
        sparkAreaColor="rgba(252,211,77,0.10)"
      />
    </div>
  );
}
