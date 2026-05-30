'use client';

import Link from 'next/link';
import { LineChart, ExternalLink } from 'lucide-react';

/**
 * Placeholder FinanceDashboard. The full port (CashflowSection,
 * PnlSection, UsersSection, ProductsSection, KpiCards, useFinanceFetch
 * hook) was started by a subagent that hit its token budget before
 * stitching the pieces together. The orphan sub-components live in
 * `_components/` and can be plumbed back together in a follow-up pass.
 *
 * Until then : we render a coherent placeholder that links the user
 * to the AoM finance dashboard at `ageof.money/admin/finance`, which
 * already works (same backend, same data — only the UI shell isn't
 * here yet).
 */
export function FinanceDashboard() {
  return (
    <div className="min-h-screen bg-tft-bg text-tft-text">
      <section className="relative overflow-hidden border-b border-tft-border">
        <div className="absolute inset-0 bg-hex-grid opacity-[0.06] pointer-events-none" aria-hidden="true" />
        <div className="absolute top-1/2 right-0 -translate-y-1/2 w-[420px] h-[420px] rounded-full bg-tft-purple/15 blur-[100px] pointer-events-none" aria-hidden="true" />
        <div className="relative max-w-5xl mx-auto px-6 py-12">
          <p className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-purple-bright mb-2">
            Admin · Finance
          </p>
          <h1 className="font-display font-bold text-3xl md:text-4xl text-tft-text leading-tight mb-2">
            Tableau de bord finance
          </h1>
          <p className="text-tft-text-dim text-sm max-w-2xl">
            Dashboard cashflow + PnL + top utilisateurs. Port en cours sur tft.money.
            En attendant, utilise la version d&apos;AgeOfMoney — mêmes données, même backend.
          </p>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-6 py-12">
        <div className="rounded-md border border-tft-border bg-tft-bg-card p-8 flex items-center gap-5">
          <div className="shrink-0 w-14 h-14 rounded-md bg-tft-purple/15 border border-tft-purple/40 flex items-center justify-center">
            <LineChart size={26} className="text-tft-purple-bright" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-display font-semibold text-lg text-tft-text mb-1">
              Port partiel — composants déjà ici
            </p>
            <p className="text-sm text-tft-text-dim mb-3 leading-relaxed">
              KpiCards, Donut, LineChart, Sparkline, PnlSection, ProductsSection, DateRangePicker,
              InfoTooltip et SectionFade sont déjà portés. Il reste FinanceDashboard,
              CashflowSection, UsersSection et le hook useFinanceFetch à câbler.
            </p>
            <Link
              href="https://ageof.money/admin/finance"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-sm bg-tft-purple hover:bg-tft-purple-bright transition-colors font-ui text-[12px] font-semibold uppercase tracking-wider text-white"
            >
              Ouvrir sur AgeOfMoney
              <ExternalLink size={12} />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
