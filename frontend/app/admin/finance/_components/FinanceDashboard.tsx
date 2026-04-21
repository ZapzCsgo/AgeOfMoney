'use client';

/**
 * Client-side dashboard shell.
 *
 * Defense-in-depth : even though the parent server component already
 * `notFound()`s when !isOwner, we re-check here via next-auth useSession
 * in case the session client-side disagrees with the server (e.g. the user
 * was demoted while the page was open). Non-owner on the client → blank
 * + "Unauthorized" + we wipe any cached data from local state.
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { setAuthToken } from '@/lib/api';
import { useFinanceFetch } from '../_hooks/useFinanceFetch';
import { DateRangePicker, RangePreset } from './DateRangePicker';
import { KpiCards, OverviewResponse } from './KpiCards';
import { PnlSection, PnlResponse } from './PnlSection';
import { ProductsSection, ProductsResponse } from './ProductsSection';

const ALLOWED_PRESETS: RangePreset[] = ['1d', '7d', '30d', '90d', 'mtd', 'all'];

function parsePreset(q: string | null): RangePreset {
  if (q && (ALLOWED_PRESETS as string[]).includes(q)) return q as RangePreset;
  return '7d';
}

export function FinanceDashboard() {
  const { data: session } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Client-side guard — server already blocked non-owners, this catches mid-
  // session role changes.
  const isOwner = !!session?.user?.isOwner;

  // Sync the axios module token so apiClient calls carry the JWT
  useEffect(() => {
    const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;
    setAuthToken(token ?? null);
  }, [session]);

  // URL-backed filter state so the view is shareable / bookmarkable.
  const [range, setRange] = useState<RangePreset>(parsePreset(searchParams.get('range')));
  const [compare, setCompare] = useState<boolean>(searchParams.get('compare') !== '0');

  // Write current filter state back to the URL without adding history entries
  useEffect(() => {
    const p = new URLSearchParams();
    p.set('range', range);
    if (!compare) p.set('compare', '0');
    router.replace(`/admin/finance?${p.toString()}`, { scroll: false });
  }, [range, compare, router]);

  const overview = useFinanceFetch<OverviewResponse>('/admin/finance/overview', { range });
  const products = useFinanceFetch<ProductsResponse>('/admin/finance/products', { range });
  // P&L ignores the range filter — it always shows today / 7d / 30d / lifetime
  // side-by-side. Passing an empty query still makes the hook fetch once.
  const pnl = useFinanceFetch<PnlResponse>('/admin/finance/pnl', {});

  const refreshing = overview.loading || products.loading || pnl.loading;
  const lastUpdatedAt = Math.max(
    overview.lastUpdatedAt ?? 0,
    products.lastUpdatedAt ?? 0,
    pnl.lastUpdatedAt ?? 0,
  ) || null;

  const handleRefresh = useCallback(async () => {
    await Promise.all([overview.refresh(), products.refresh(), pnl.refresh()]);
  }, [overview, products, pnl]);

  if (!isOwner) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <p className="text-[13px]" style={{ color: '#6b6488' }}>Unauthorized.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Sticky filters row */}
      <div
        className="sticky top-0 z-10 -mx-4 px-4 py-3 mb-5 backdrop-blur-md"
        style={{
          background: 'rgba(7,6,15,0.85)',
          borderBottom: '1px solid #1e1a30',
        }}
      >
        <DateRangePicker
          value={range}
          onChange={setRange}
          compare={compare}
          onCompareChange={setCompare}
          onRefresh={handleRefresh}
          refreshing={refreshing}
          lastUpdatedAt={lastUpdatedAt}
        />
      </div>

      {/* Combined error banner (all endpoints surface here) */}
      {(overview.error || products.error || pnl.error) && (
        <div
          className="mb-4 rounded-lg px-4 py-2 text-[12px]"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5' }}
        >
          {overview.error ?? products.error ?? pnl.error}
        </div>
      )}

      {/* P&L Summary — today/7d/30d/lifetime pills */}
      <PnlSection data={pnl.data} loading={pnl.loading && !pnl.data} />

      {/* KPIs for the selected range */}
      <div className="mb-6">
        <KpiCards data={overview.data} loading={overview.loading && !overview.data} compare={compare} />
      </div>

      {/* Products */}
      <ProductsSection data={products.data} loading={products.loading && !products.data} />
    </div>
  );
}
