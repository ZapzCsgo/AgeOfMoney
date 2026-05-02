'use client';

import { useState } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { Donut, paletteColor } from './Donut';
import type { RangePreset } from './DateRangePicker';

// ─── Types — matches backend /products response ─────────────────────────────

export interface ProductRow {
  product: 'BET_MATCH' | 'BET_BO' | 'BET_EXACT_SCORE' | 'COINFLIP' | 'ROULETTE' | 'JACKPOT';
  label: string;
  betsPlaced: number;
  volumeStaked: number;
  houseRevenue: number;
  marginPct: number;
  userWinRate: number;
}

export interface ProductsResponse {
  generatedAt: string;
  range: { label: RangePreset; from: string; to: string };
  rows: ProductRow[];
}

type SortKey = 'betsPlaced' | 'volumeStaked' | 'houseRevenue' | 'marginPct';

function coinsFmt(v: number): string {
  return v.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// ─── Section ────────────────────────────────────────────────────────────────

export function ProductsSection({
  data,
  loading,
}: {
  data: ProductsResponse | null;
  loading: boolean;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('houseRevenue');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const rows = data?.rows ?? [];
  // Donut slices only count positive revenue (can't render negative arcs).
  // The net GGR (positive + negative) is shown inline under the donut so
  // the user doesn't confuse the donut total with the real GGR KPI at
  // the top of the page.
  const totalRevenue = rows.reduce((s, r) => s + Math.max(0, r.houseRevenue), 0);
  const netRevenue   = rows.reduce((s, r) => s + r.houseRevenue, 0);
  const anyActivity  = rows.some((r) => r.betsPlaced > 0 || r.volumeStaked > 0);

  // Pre-sort for the table (donut always keeps its product order so colours stay stable)
  const sortedRows = [...rows].sort((a, b) => {
    const d = (a[sortKey] as number) - (b[sortKey] as number);
    return sortDir === 'asc' ? d : -d;
  });

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((v) => (v === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  }

  function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
    if (!active) return null;
    return dir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />;
  }

  // Slices in STABLE product order so colour mapping is predictable
  const slices = rows.map((r, i) => ({
    label: r.label,
    value: Math.max(0, r.houseRevenue),
    color: paletteColor(i),
  }));

  return (
    <section
      className="rounded-2xl p-5"
      style={{ background: '#0e0d1a', border: '1px solid #1e1a30' }}
    >
      <div className="flex items-center justify-between mb-4">
        <h2
          className="text-[14px] font-bold tracking-widest uppercase"
          style={{ fontFamily: 'Cinzel, serif', color: '#e8e2f5' }}
        >
          Revenue by product
        </h2>
        {data && (
          <span className="text-[10px]" style={{ color: '#6b6488' }}>
            Total · {coinsFmt(totalRevenue)} ⚜
          </span>
        )}
      </div>

      {loading ? (
        <div className="h-40 rounded-lg animate-pulse" style={{ background: 'rgba(255,255,255,0.02)' }} />
      ) : !anyActivity ? (
        <div className="text-center py-12 text-sm" style={{ color: '#6b6488' }}>
          Aucun pari placé pendant cette période.<br />
          L&apos;activité apparaîtra ici dès que des users joueront.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
          {/* Donut + legend */}
          <div className="lg:col-span-2 flex flex-col items-center">
            <Donut
              slices={slices}
              size={180}
              thickness={26}
              centerValue={coinsFmt(totalRevenue)}
              centerLabel="COINS"
            />
            {/* Clarify that the donut is positive-only — the real GGR can
                be lower (or higher) when some products are in the red. */}
            {netRevenue !== totalRevenue && (
              <div className="mt-2 text-[11px] text-center" style={{ color: '#888' }}>
                Net GGR · <span className="font-mono" style={{ color: '#c8c0e0' }}>
                  {coinsFmt(netRevenue)} ⚜
                </span>
                <span className="opacity-60"> — volume positif affiché ci-dessus</span>
              </div>
            )}
            <ul className="mt-4 space-y-1 w-full max-w-[220px]">
              {rows.map((r, i) => {
                const pct = totalRevenue > 0 ? (Math.max(0, r.houseRevenue) / totalRevenue) * 100 : 0;
                return (
                  <li key={r.product} className="flex items-center gap-2 text-[11px]">
                    <span
                      className="inline-block rounded-sm shrink-0"
                      style={{ width: 10, height: 10, background: paletteColor(i) }}
                    />
                    <span className="flex-1 truncate" style={{ color: '#c8c0e0' }}>{r.label}</span>
                    <span className="font-mono" style={{ color: '#6b6488' }}>{pct.toFixed(1)}%</span>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Table */}
          <div className="lg:col-span-3 overflow-x-auto">
            <table className="w-full text-[12px]" cellPadding={0} cellSpacing={0}>
              <thead>
                <tr style={{ color: '#6b6488' }}>
                  <th className="text-left py-2 px-2 font-bold tracking-wider uppercase text-[10px]">Produit</th>
                  <th
                    className="text-right py-2 px-2 font-bold tracking-wider uppercase text-[10px] cursor-pointer hover:text-[#c8c0e0]"
                    onClick={() => toggleSort('betsPlaced')}
                  >
                    <span className="inline-flex items-center gap-0.5 justify-end">
                      Bets <SortIcon active={sortKey === 'betsPlaced'} dir={sortDir} />
                    </span>
                  </th>
                  <th
                    className="text-right py-2 px-2 font-bold tracking-wider uppercase text-[10px] cursor-pointer hover:text-[#c8c0e0]"
                    onClick={() => toggleSort('volumeStaked')}
                  >
                    <span className="inline-flex items-center gap-0.5 justify-end">
                      Volume <SortIcon active={sortKey === 'volumeStaked'} dir={sortDir} />
                    </span>
                  </th>
                  <th
                    className="text-right py-2 px-2 font-bold tracking-wider uppercase text-[10px] cursor-pointer hover:text-[#c8c0e0]"
                    onClick={() => toggleSort('houseRevenue')}
                  >
                    <span className="inline-flex items-center gap-0.5 justify-end">
                      Revenue <SortIcon active={sortKey === 'houseRevenue'} dir={sortDir} />
                    </span>
                  </th>
                  <th
                    className="text-right py-2 px-2 font-bold tracking-wider uppercase text-[10px] cursor-pointer hover:text-[#c8c0e0]"
                    onClick={() => toggleSort('marginPct')}
                  >
                    <span className="inline-flex items-center gap-0.5 justify-end">
                      Margin <SortIcon active={sortKey === 'marginPct'} dir={sortDir} />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((r) => {
                  const orderIndex = rows.findIndex((x) => x.product === r.product);
                  return (
                    <tr
                      key={r.product}
                      className="transition-colors"
                      style={{ borderTop: '1px solid #1a1730' }}
                      onMouseEnter={(e) => ((e.currentTarget.style.background = 'rgba(255,255,255,0.02)'))}
                      onMouseLeave={(e) => ((e.currentTarget.style.background = 'transparent'))}
                    >
                      <td className="py-2.5 px-2">
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="inline-block rounded-sm shrink-0"
                            style={{ width: 8, height: 8, background: paletteColor(orderIndex) }}
                          />
                          <span style={{ color: '#e5e5e5' }}>{r.label}</span>
                        </span>
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono" style={{ color: '#9990b8' }}>
                        {r.betsPlaced.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono" style={{ color: '#c8c0e0' }}>
                        {coinsFmt(r.volumeStaked)} ⚜
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono font-bold" style={{ color: '#ffd97a' }}>
                        {coinsFmt(r.houseRevenue)} ⚜
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono" style={{ color: '#c8c0e0' }}>
                        {r.marginPct.toFixed(2)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
