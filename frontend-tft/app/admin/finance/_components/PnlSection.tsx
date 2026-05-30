'use client';

/**
 * Profit & Loss summary — 4 pills aligned horizontally showing how much
 * the operator has made across today / 7 days / 30 days / lifetime.
 *
 * Display convention :
 *   - Green pill when positive, red when negative, neutral-gray at zero.
 *   - Lifetime shows the strict "realized profit" (net deposits - current
 *     liability) because across long windows the NGR-converted number
 *     drifts from actual cash. Shorter windows show NGR × withdrawal rate,
 *     the standard "gaming margin" casino metric.
 *   - All values rendered in EUR with French separators (never in coins).
 */

import { InfoTooltip } from './InfoTooltip';
import type { PnlPeriodLabel } from './types';

export interface PnlPeriod {
  label: PnlPeriodLabel;
  ngrCoins: number;
  ngrEur: number;                // cents
  netCashEurCents: number;
  realizedProfitEurCents: number | null;
}

export interface PnlResponse {
  generatedAt: string;
  periods: PnlPeriod[];
}

const PERIOD_LABELS: Record<PnlPeriodLabel, string> = {
  today:    "Aujourd'hui",
  '7d':     '7 jours',
  '30d':    '30 jours',
  lifetime: 'Lifetime',
};

const PERIOD_TOOLTIPS: Record<PnlPeriodLabel, string> = {
  today:    'Gaming margin nette sur les dernieres 24 h, convertie en € au taux de retrait (1 LP ≈ 0,59 €).',
  '7d':     'Gaming margin nette sur 7 jours glissants, convertie en € au taux de retrait.',
  '30d':    'Gaming margin nette sur 30 jours glissants, convertie en € au taux de retrait.',
  lifetime: "Benefice realise depuis le lancement : deposits cumules moins withdrawals cumules moins la liability actuelle (ce que tu dois encore aux users). C'est le cash reellement en caisse.",
};

function formatCents(c: number): string {
  return (c / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function valueColor(c: number): string {
  if (c > 0) return '#34d399';
  if (c < 0) return '#ef4444';
  return '#94a3b8';
}

function Pill({ period, loading }: { period?: PnlPeriod; loading: boolean }) {
  // For lifetime we prefer the realized-profit metric; fallback to NGR if
  // the backend didn't compute it for some reason.
  const raw = period
    ? (period.label === 'lifetime'
        ? (period.realizedProfitEurCents ?? period.ngrEur)
        : period.ngrEur)
    : 0;

  const color = valueColor(raw);
  const sign  = raw > 0 ? '+' : raw < 0 ? '-' : '';
  const absEur = Math.abs(raw) / 100;

  return (
    <div
      className="flex-1 min-w-[140px] rounded-md p-4 relative bg-tft-bg-card"
      style={{
        border: period && raw !== 0
          ? `1px solid ${raw > 0 ? 'rgba(52,211,153,0.3)' : 'rgba(239,68,68,0.3)'}`
          : '1px solid #1f1d4a',
      }}
    >
      <div className="flex items-center gap-1 text-[10px] tracking-[0.2em] uppercase text-tft-text-muted">
        <span>{period ? PERIOD_LABELS[period.label] : '—'}</span>
        {period && (
          <InfoTooltip content={PERIOD_TOOLTIPS[period.label]} />
        )}
      </div>

      <div className="mt-2 flex items-baseline gap-1 min-h-[28px]">
        {loading ? (
          <div className="h-6 w-24 rounded bg-white/5" />
        ) : (
          <>
            <span className="text-[24px] font-display font-bold leading-none" style={{ color }}>
              {sign}{absEur.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-[12px] text-tft-text-muted">€</span>
          </>
        )}
      </div>

      {/* Extra detail under the big number */}
      {period && !loading && (
        <div className="mt-1.5 text-[10px] flex flex-wrap gap-x-2 text-tft-text-muted">
          {period.label === 'lifetime' ? (
            <>
              <span>NGR · {formatCents(period.ngrEur)} €</span>
              <span>Cash net · {formatCents(period.netCashEurCents)} €</span>
            </>
          ) : (
            <>
              <span>NGR · {period.ngrCoins.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} LP</span>
              <span>Cash · {formatCents(period.netCashEurCents)} €</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function PnlSection({ data, loading }: { data: PnlResponse | null; loading: boolean }) {
  const byLabel = new Map<PnlPeriodLabel, PnlPeriod>();
  for (const p of data?.periods ?? []) byLabel.set(p.label, p);

  const order: PnlPeriodLabel[] = ['today', '7d', '30d', 'lifetime'];

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[12px] font-display font-bold tracking-widest uppercase text-tft-purple-bright">
          P&amp;L Summary
        </h2>
      </div>
      <div className="flex flex-wrap gap-3">
        {order.map((label) => (
          <Pill key={label} period={byLabel.get(label)} loading={loading && !data} />
        ))}
      </div>
    </section>
  );
}
