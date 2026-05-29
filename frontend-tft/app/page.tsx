'use client';

import Link from 'next/link';
import { ShieldCheck, Zap, Coins, Headphones, ChevronRight } from 'lucide-react';
import { RecentWinsTicker } from '@/components/home/RecentWinsTicker';
import { ActionStack }      from '@/components/home/ActionStack';
import { LiveFeed }         from '@/components/home/LiveFeed';
import { CoinRain }         from '@/components/home/CoinRain';
import { HotTournaments }   from '@/components/home/HotTournaments';

/**
 * tft.money homepage — gambling-first layout (refonte 2026-05-29).
 *
 * Above the fold :
 *   - RecentWinsTicker  (full-width horizontal marquee just under navbar)
 *   - ActionStack       (left 60 %  : login/wallet + LiveNow + HotPick)
 *   - LiveFeed          (right 40 % : stat strip + jackpot + activity)
 *
 * Below the fold :
 *   - HotTournaments    (3-column card grid of live + upcoming)
 *   - micro-trust strip (single thin row, NOT a hero section)
 *
 * The "How it works / Trust / FAQ" landing-style sections that used to
 * live here have moved to /how-it-works, /fairness, and a future /faq.
 * The home is now action-only ; explanations belong on linked pages.
 */
export default function HomePage() {
  return (
    <div className="relative">
      <RecentWinsTicker />
      <HeroGrid />
      <HotTournaments />
      <TrustMicroStrip />
    </div>
  );
}

/* ─────────────────────── Hero grid ─────────────────────── */
function HeroGrid() {
  return (
    <section className="relative overflow-hidden bg-hero-arcane">
      {/* Layered backgrounds — order matters : hex grid behind everything,
          purple/cyan halos blurred on top, coin rain at the front of the
          background layer but still pointer-events-none. */}
      <div className="absolute inset-0 bg-hex-grid opacity-25 pointer-events-none" aria-hidden="true" />
      <div className="absolute -top-32 -left-32 w-[480px] h-[480px] rounded-full bg-tft-purple/15 blur-[120px] pointer-events-none" aria-hidden="true" />
      <div className="absolute -bottom-32 -right-32 w-[520px] h-[520px] rounded-full bg-tft-cyan/10 blur-[140px] pointer-events-none" aria-hidden="true" />
      <CoinRain count={22} />

      <div className="relative max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8 grid lg:grid-cols-[1.6fr_1fr] gap-4 md:gap-6">
        <ActionStack />
        <LiveFeed />
      </div>
    </section>
  );
}

/* ─────────────────────── Micro trust strip ─────────────────────── */
const TRUST_ITEMS = [
  { icon: ShieldCheck, label: 'Provably fair',         desc: 'Sources Riot officielles' },
  { icon: Zap,         label: 'Dépôts crypto · 2 min', desc: 'BTC ETH USDT LTC SOL'     },
  { icon: Coins,       label: 'Retraits instantanés',  desc: 'Traités sous 5 min'       },
  { icon: Headphones,  label: 'Support 24/7',          desc: 'FR + EN sur Discord'      },
] as const;

function TrustMicroStrip() {
  return (
    <section className="relative border-t border-tft-border bg-tft-bg/80">
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-6">
          {TRUST_ITEMS.map((t) => (
            <div key={t.label} className="flex items-center gap-3">
              <div className="shrink-0 w-8 h-8 rounded-md bg-tft-bg-card border border-tft-border flex items-center justify-center">
                <t.icon size={14} className="text-tft-mint" />
              </div>
              <div className="min-w-0">
                <p className="font-ui text-[11px] font-semibold text-tft-text leading-tight truncate">{t.label}</p>
                <p className="font-ui text-[10px] text-tft-text-muted leading-tight truncate">{t.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3 pt-3 border-t border-tft-border text-center">
          <Link
            href="/how-it-works"
            className="inline-flex items-center gap-1 text-[11px] text-tft-text-faint hover:text-tft-cyan-bright transition-colors font-ui"
          >
            Comment ça marche, dans le détail
            <ChevronRight size={11} />
          </Link>
        </div>
      </div>
    </section>
  );
}
