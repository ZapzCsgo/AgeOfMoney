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
import { AffiliatesSection, AffiliatesResponse } from './AffiliatesSection';
import { UsersSection, UserGrowthResponse } from './UsersSection';
import { CashflowSection } from './CashflowSection';
import { AnomaliesSection } from './AnomaliesSection';
import { SectionFade, InlineError } from './SectionFade';

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

  // Sync the axios module token so apiClient calls carry the JWT. We also
  // surface a `ready` flag so we only start fetching once the token is
  // actually set — otherwise the first request races the effect and fires
  // without Authorization, yielding a flash "Authentication required".
  const accessToken = (session?.user as { accessToken?: string } | undefined)?.accessToken ?? null;
  const [tokenReady, setTokenReady] = useState(false);
  useEffect(() => {
    setAuthToken(accessToken);
    setTokenReady(!!accessToken);
  }, [accessToken]);

  const ready = isOwner && tokenReady;

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

  const overview   = useFinanceFetch<OverviewResponse>('/admin/finance/overview', { range }, { enabled: ready });
  const products   = useFinanceFetch<ProductsResponse>('/admin/finance/products', { range }, { enabled: ready });
  const affiliates = useFinanceFetch<AffiliatesResponse>('/admin/finance/affiliates', { range }, { enabled: ready });
  const users      = useFinanceFetch<UserGrowthResponse>('/admin/finance/users', { range }, { enabled: ready });
  // P&L ignores the range filter — it always shows today / 7d / 30d / lifetime
  // side-by-side. Passing an empty query still makes the hook fetch once.
  const pnl = useFinanceFetch<PnlResponse>('/admin/finance/pnl', {}, { enabled: ready });

  const refreshing = overview.loading || products.loading || pnl.loading || affiliates.loading || users.loading;
  const lastUpdatedAt = Math.max(
    overview.lastUpdatedAt   ?? 0,
    products.lastUpdatedAt   ?? 0,
    pnl.lastUpdatedAt        ?? 0,
    affiliates.lastUpdatedAt ?? 0,
    users.lastUpdatedAt      ?? 0,
  ) || null;

  const handleRefresh = useCallback(async () => {
    await Promise.all([
      overview.refresh(),
      products.refresh(),
      pnl.refresh(),
      affiliates.refresh(),
      users.refresh(),
    ]);
  }, [overview, products, pnl, affiliates, users]);

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

      {/* Errors are surfaced inline inside each section (isolated failures
          don't blank out the whole page). Sections that haven't failed keep
          rendering with whatever data they already have. */}

      {/* P&L Summary — today/7d/30d/lifetime pills */}
      <SectionFade delay={0}>
        {pnl.error && <div className="mb-3"><InlineError message={`P&L : ${pnl.error}`} onRetry={pnl.refresh} /></div>}
        <PnlSection data={pnl.data} loading={pnl.loading && !pnl.data} />
      </SectionFade>

      {/* KPIs for the selected range */}
      <SectionFade delay={0.05}>
        {overview.error && <div className="mb-3"><InlineError message={`Overview : ${overview.error}`} onRetry={overview.refresh} /></div>}
        <div className="mb-6">
          <KpiCards data={overview.data} loading={overview.loading && !overview.data} compare={compare} />
        </div>
      </SectionFade>

      {/* Products */}
      <SectionFade delay={0.1}>
        {products.error && <div className="mb-3"><InlineError message={`Products : ${products.error}`} onRetry={products.refresh} /></div>}
        <ProductsSection data={products.data} loading={products.loading && !products.data} />
      </SectionFade>

      {/* Affiliate program — top 10 affiliates + global KPIs */}
      <SectionFade delay={0.15}>
        {affiliates.error && <div className="mt-8 mb-3"><InlineError message={`Affiliates : ${affiliates.error}`} onRetry={affiliates.refresh} /></div>}
        <AffiliatesSection data={affiliates.data} loading={affiliates.loading && !affiliates.data} />
      </SectionFade>

      {/* User growth & retention — DAU/WAU/MAU + retention curve + signups + deposits histogram */}
      <SectionFade delay={0.2}>
        {users.error && <div className="mt-8 mb-3"><InlineError message={`Users : ${users.error}`} onRetry={users.refresh} /></div>}
        <UsersSection data={users.data} loading={users.loading && !users.data} />
      </SectionFade>

      {/* Cashflow ledger — paginated list of every Transaction with filters + CSV export */}
      <SectionFade delay={0.25}>
        <CashflowSection range={range} ready={ready} />
      </SectionFade>

      {/* Anomalies feed — 5 auto-detectors (sharps / whales / gambling flags / rake) */}
      <SectionFade delay={0.3}>
        <AnomaliesSection ready={ready} />
      </SectionFade>
    </div>
  );
}
