'use client';

/**
 * Collapsible section at the bottom of /admin/events listing the last 20
 * rains launched on the site. Useful for ROI audit (amount vs. actual
 * participants → CPA of an engagement push).
 */

import { useState } from 'react';
import { ChevronDown, ChevronUp, Droplets, CircleDashed } from 'lucide-react';
import { useEventsFetch } from '../_hooks/useEventsFetch';

interface RainHistoryRow {
  id: string;
  amount: number;
  maxParticipants: number;
  actualParticipants: number;
  duration: number;
  perUser: number;
  status: 'ACTIVE' | 'COMPLETED' | 'EXPIRED';
  startedAt: string;
  endsAt: string;
  completedAt: string | null;
  actualPerUser: number | null;
  triggeredByEvent: string | null;
  triggeredByAdmin: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

export function RainHistorySection({ ready }: { ready: boolean }) {
  const [open, setOpen] = useState(false);
  const { data, loading, refresh } = useEventsFetch<RainHistoryRow[]>(
    '/admin/rain/history',
    { limit: '20' },
    { enabled: ready && open },
  );

  const rows = data ?? [];
  const totalDistributed = rows.reduce((s, r) => s + (r.actualPerUser ?? r.perUser) * r.actualParticipants, 0);

  return (
    <section
      className="rounded-2xl mt-8"
      style={{ background: '#0e0d1a', border: '1px solid #1e1a30' }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-3 text-left hover:opacity-90 transition-opacity"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <Droplets size={14} style={{ color: '#ffd97a' }} />
          <h3
            className="text-[13px] font-bold tracking-widest uppercase"
            style={{ fontFamily: 'Cinzel, serif', color: '#e8e2f5' }}
          >
            Rains history
          </h3>
          <span className="text-[10px]" style={{ color: '#6b6488' }}>
            {open ? 'fermer' : 'ouvrir'}
          </span>
        </div>
        {open ? <ChevronUp size={14} style={{ color: '#6b6488' }} /> : <ChevronDown size={14} style={{ color: '#6b6488' }} />}
      </button>

      {open && (
        <div className="px-5 pb-5">
          {loading && !data ? (
            <div className="h-24 rounded animate-pulse" style={{ background: 'rgba(255,255,255,0.02)' }} />
          ) : rows.length === 0 ? (
            <div className="text-center py-8 text-[12px]" style={{ color: '#6b6488' }}>
              Aucun rain lancé pour l&apos;instant.
            </div>
          ) : (
            <>
              <div className="text-[11px] mb-3" style={{ color: '#9990b8' }}>
                {rows.length} rain{rows.length !== 1 ? 's' : ''} · total distribué{' '}
                <strong style={{ color: '#ffd97a' }}>{totalDistributed.toLocaleString('fr-FR')} ⚜</strong>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px] min-w-[620px]" cellPadding={0} cellSpacing={0}>
                  <thead>
                    <tr style={{ color: '#6b6488' }}>
                      <th className="text-left py-2 px-2 font-bold tracking-wider uppercase text-[10px]">Date</th>
                      <th className="text-left py-2 px-2 font-bold tracking-wider uppercase text-[10px]">Par</th>
                      <th className="text-right py-2 px-2 font-bold tracking-wider uppercase text-[10px]">Pool</th>
                      <th className="text-right py-2 px-2 font-bold tracking-wider uppercase text-[10px]">Claims</th>
                      <th className="text-right py-2 px-2 font-bold tracking-wider uppercase text-[10px] hidden md:table-cell">Per user</th>
                      <th className="text-right py-2 px-2 font-bold tracking-wider uppercase text-[10px] hidden sm:table-cell">Distribué</th>
                      <th className="text-left py-2 px-2 font-bold tracking-wider uppercase text-[10px]">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const actualPerUser = r.actualPerUser ?? r.perUser;
                      const distributed = actualPerUser * r.actualParticipants;
                      const statusColor = r.status === 'ACTIVE'
                        ? { bg: 'rgba(255,197,66,0.12)', color: '#ffd97a' }
                        : { bg: 'rgba(107,100,136,0.12)', color: '#9990b8' };
                      return (
                        <tr
                          key={r.id}
                          style={{ borderTop: '1px solid #1a1730' }}
                        >
                          <td className="py-2 px-2 font-mono whitespace-nowrap" style={{ color: '#9990b8' }}>
                            {formatDate(r.startedAt)}
                          </td>
                          <td className="py-2 px-2" style={{ color: '#c8c0e0' }}>
                            {r.triggeredByAdmin}
                            {r.triggeredByEvent && (
                              <span className="ml-1 text-[9px]" style={{ color: '#6b6488' }}>· via event</span>
                            )}
                          </td>
                          <td className="py-2 px-2 text-right font-mono font-bold" style={{ color: '#ffd97a' }}>
                            {r.amount.toLocaleString('fr-FR')} ⚜
                          </td>
                          <td className="py-2 px-2 text-right font-mono" style={{ color: '#c8c0e0' }}>
                            {r.actualParticipants} / {r.maxParticipants}
                          </td>
                          <td className="py-2 px-2 text-right font-mono hidden md:table-cell" style={{ color: '#c8c0e0' }}>
                            {actualPerUser} ⚜
                          </td>
                          <td className="py-2 px-2 text-right font-mono hidden sm:table-cell" style={{ color: '#ffd97a' }}>
                            {distributed.toLocaleString('fr-FR')} ⚜
                          </td>
                          <td className="py-2 px-2">
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold tracking-wider uppercase"
                              style={{ background: statusColor.bg, color: statusColor.color }}
                            >
                              {r.status === 'ACTIVE' && <CircleDashed size={9} />}
                              {r.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 text-right">
                <button
                  onClick={() => refresh()}
                  className="text-[10px] tracking-wider uppercase hover:opacity-80 transition-opacity"
                  style={{ color: '#6b6488' }}
                >
                  Rafraîchir
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
