'use client';

/**
 * Affiliate program section — 4 KPI mini-cards + top-10 table.
 *
 * - The rank column gets a subtle gold medal tint on 1/2/3 so scanning
 *   the leaderboard is instant.
 * - `isApproximation` from the backend flags period-scoped commission
 *   totals as "approximate" (real per-period journal doesn't exist yet).
 *   We surface it via an InfoTooltip on Total commission so the user
 *   knows when to trust the number.
 * - Sort is client-side — click a column to toggle asc/desc.
 */

import { useState } from 'react';
import { Users, Percent, Coins, TrendingUp, ChevronUp, ChevronDown, Trophy } from 'lucide-react';
import { InfoTooltip } from './InfoTooltip';
import type { RangePreset } from './DateRangePicker';

export interface AffiliateKpis {
  totalCommissionPaid: number;
  activeAffiliatesCount: number;
  avgCommissionPerAffiliate: number;
  affiliateRevenueSharePct: number;
  isApproximation: boolean;
}

export interface AffiliateRow {
  userId: string;
  username: string;
  avatar: string | null;
  promoCode: string;
  commissionRate: number;
  referredUsersCount: number;
  volumeStakedByReferred: number;
  commissionPaid: number;
  roiRate: number;
}

export interface AffiliatesResponse {
  generatedAt: string;
  range: { label: RangePreset; from: string; to: string };
  kpis: AffiliateKpis;
  topAffiliates: AffiliateRow[];
}

type SortKey = 'referredUsersCount' | 'volumeStakedByReferred' | 'commissionPaid' | 'roiRate';

function coinsFmt(v: number): string {
  return v.toLocaleString('fr-FR');
}

// ─── Mini KPI card ──────────────────────────────────────────────────────────

function MiniKpi({
  icon: Icon,
  label,
  value,
  suffix,
  tooltip,
  loading,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  suffix?: string;
  tooltip?: string;
  loading: boolean;
}) {
  return (
    <div
      className="flex-1 min-w-[140px] rounded-xl p-3"
      style={{ background: '#0e0d1a', border: '1px solid #1e1a30' }}
    >
      <div className="flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase" style={{ color: '#6b6488' }}>
        <Icon size={11} />
        <span>{label}</span>
        {tooltip && <InfoTooltip content={tooltip} />}
      </div>
      <div className="mt-1.5 flex items-baseline gap-1 min-h-[24px]">
        {loading ? (
          <div className="h-5 w-20 rounded" style={{ background: 'rgba(255,255,255,0.04)' }} />
        ) : (
          <>
            <span className="text-[20px] font-bold leading-none" style={{ color: '#ffd97a', fontFamily: 'Cinzel, serif' }}>
              {value}
            </span>
            {suffix && <span className="text-[11px]" style={{ color: '#6b6488' }}>{suffix}</span>}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Rank badge ─────────────────────────────────────────────────────────────

function RankBadge({ rank }: { rank: number }) {
  const styles: Record<number, { bg: string; border: string; color: string }> = {
    1: { bg: 'rgba(255,197,66,0.18)', border: 'rgba(255,197,66,0.5)', color: '#ffd97a' },
    2: { bg: 'rgba(200,192,224,0.10)', border: 'rgba(200,192,224,0.35)', color: '#c8c0e0' },
    3: { bg: 'rgba(184,134,11,0.15)', border: 'rgba(184,134,11,0.45)', color: '#d4a017' },
  };
  const s = styles[rank];
  if (!s) {
    return <span className="text-[11px] font-mono w-6 inline-block" style={{ color: '#6b6488' }}>#{rank}</span>;
  }
  return (
    <span
      className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold"
      style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.color }}
      aria-label={`rank ${rank}`}
    >
      {rank}
    </span>
  );
}

// ─── Main section ───────────────────────────────────────────────────────────

export function AffiliatesSection({
  data,
  loading,
}: {
  data: AffiliatesResponse | null;
  loading: boolean;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('commissionPaid');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const rows = data?.topAffiliates ?? [];
  const kpis = data?.kpis;
  const anyActivity = rows.length > 0;

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
          Affiliate program
        </h2>
      </div>

      {/* KPI mini-cards */}
      <div className="flex flex-wrap gap-3 mb-5">
        <MiniKpi
          icon={Coins}
          label="Total commission"
          value={kpis ? coinsFmt(kpis.totalCommissionPaid) : '—'}
          suffix="⚜"
          tooltip={
            kpis?.isApproximation
              ? 'Approximation : on n\'a pas de journal par période. Somme des commissions lifetime des affiliés actifs dans la fenêtre sélectionnée.'
              : 'Commission totale payée aux affiliés depuis le lancement.'
          }
          loading={loading && !data}
        />
        <MiniKpi
          icon={Users}
          label="Active affiliates"
          value={kpis ? String(kpis.activeAffiliatesCount) : '—'}
          tooltip="Codes promo avec au moins 1 user référé actif (au moins 1 bet) dans la fenêtre."
          loading={loading && !data}
        />
        <MiniKpi
          icon={TrendingUp}
          label="Avg per affiliate"
          value={kpis ? coinsFmt(kpis.avgCommissionPerAffiliate) : '—'}
          suffix="⚜"
          tooltip="Commission moyenne par affilié actif sur la période."
          loading={loading && !data}
        />
        <MiniKpi
          icon={Percent}
          label="Revenue share"
          value={kpis ? `${kpis.affiliateRevenueSharePct.toFixed(1)}%` : '—'}
          tooltip="Part du volume staked qui vient des users référés. Mesure à quel point ton programme d'affiliation nourrit l'activité globale."
          loading={loading && !data}
        />
      </div>

      {/* Table */}
      {loading && !data ? (
        <div className="h-40 rounded-lg animate-pulse" style={{ background: 'rgba(255,255,255,0.02)' }} />
      ) : !anyActivity ? (
        <div className="text-center py-10 text-sm" style={{ color: '#6b6488' }}>
          Aucune activité d&apos;affiliation sur cette période.<br />
          Les affiliés actifs (Corvinus1 & co) apparaîtront ici avec leurs stats.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]" cellPadding={0} cellSpacing={0}>
            <thead>
              <tr style={{ color: '#6b6488' }}>
                <th className="text-left py-2 px-2 font-bold tracking-wider uppercase text-[10px] w-10">#</th>
                <th className="text-left py-2 px-2 font-bold tracking-wider uppercase text-[10px]">Affilié</th>
                <th className="text-left py-2 px-2 font-bold tracking-wider uppercase text-[10px] hidden sm:table-cell">Code</th>
                <th
                  className="text-right py-2 px-2 font-bold tracking-wider uppercase text-[10px] cursor-pointer hover:text-[#c8c0e0]"
                  onClick={() => toggleSort('referredUsersCount')}
                >
                  <span className="inline-flex items-center gap-0.5 justify-end">
                    Users <SortIcon active={sortKey === 'referredUsersCount'} dir={sortDir} />
                  </span>
                </th>
                <th
                  className="text-right py-2 px-2 font-bold tracking-wider uppercase text-[10px] cursor-pointer hover:text-[#c8c0e0] hidden md:table-cell"
                  onClick={() => toggleSort('volumeStakedByReferred')}
                >
                  <span className="inline-flex items-center gap-0.5 justify-end">
                    Volume <SortIcon active={sortKey === 'volumeStakedByReferred'} dir={sortDir} />
                  </span>
                </th>
                <th
                  className="text-right py-2 px-2 font-bold tracking-wider uppercase text-[10px] cursor-pointer hover:text-[#c8c0e0]"
                  onClick={() => toggleSort('commissionPaid')}
                >
                  <span className="inline-flex items-center gap-0.5 justify-end">
                    Commission <SortIcon active={sortKey === 'commissionPaid'} dir={sortDir} />
                  </span>
                </th>
                <th
                  className="text-right py-2 px-2 font-bold tracking-wider uppercase text-[10px] cursor-pointer hover:text-[#c8c0e0] hidden sm:table-cell"
                  onClick={() => toggleSort('roiRate')}
                >
                  <span className="inline-flex items-center gap-0.5 justify-end">
                    ROI <SortIcon active={sortKey === 'roiRate'} dir={sortDir} />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r, i) => {
                const originalRank = rows.findIndex((x) => x.userId === r.userId) + 1;
                return (
                  <tr
                    key={r.userId}
                    className="transition-colors"
                    style={{ borderTop: '1px solid #1a1730' }}
                    onMouseEnter={(e) => ((e.currentTarget.style.background = 'rgba(255,255,255,0.02)'))}
                    onMouseLeave={(e) => ((e.currentTarget.style.background = 'transparent'))}
                  >
                    <td className="py-2.5 px-2">
                      <RankBadge rank={originalRank} />
                    </td>
                    <td className="py-2.5 px-2">
                      <span className="inline-flex items-center gap-2">
                        {r.avatar ? (
                          <img src={r.avatar} alt={r.username} className="w-6 h-6 rounded-full" />
                        ) : (
                          <span
                            className="w-6 h-6 rounded-full inline-flex items-center justify-center text-[9px] font-bold"
                            style={{ background: '#1a1730', color: '#c8c0e0' }}
                          >
                            {r.username.slice(0, 2).toUpperCase()}
                          </span>
                        )}
                        <span className="truncate max-w-[120px]" style={{ color: '#e5e5e5' }}>{r.username}</span>
                        {originalRank === 1 && (
                          <Trophy size={11} style={{ color: '#ffd97a' }} aria-label="top affiliate" />
                        )}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 font-mono hidden sm:table-cell" style={{ color: '#9990b8' }}>
                      {r.promoCode}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono" style={{ color: '#c8c0e0' }}>
                      {r.referredUsersCount.toLocaleString('fr-FR')}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono hidden md:table-cell" style={{ color: '#c8c0e0' }}>
                      {coinsFmt(r.volumeStakedByReferred)} ⚜
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono font-bold" style={{ color: '#ffd97a' }}>
                      {coinsFmt(r.commissionPaid)} ⚜
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono hidden sm:table-cell" style={{ color: '#c8c0e0' }}>
                      {(r.roiRate * 100).toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
