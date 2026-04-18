/**
 * Local BO2 odds reproducer — no DB, no network.
 *
 * Runs calculateOddsV2 for two synthetic scenarios matching the prod matches
 * observed with broken/weird odds, to check whether:
 *   - the V2 engine is producing internally coherent odds when format='BO2'
 *   - the per-game probability and probDraw are in a sensible range
 *
 * Usage: npx tsx scripts/test-odds-bo2.ts
 */

import { calculateOddsV2, solvePerGameProb, calculateDrawProbability, type MatchRecord, type H2HRecord } from '../src/services/oddsEngine';

function synth(wr: number, n: number, tier: string = 'B'): MatchRecord[] {
  const wins = Math.round(wr * n);
  const out: MatchRecord[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ won: i < wins, tier, matchDate: new Date(Date.now() - i * 7 * 86400000), opponentId: null });
  }
  return out;
}

function show(label: string, o: ReturnType<typeof calculateOddsV2>) {
  const overround = 1 / o.odds1 + 1 / o.odds2 + (o.oddsDraw ? 1 / o.oddsDraw : 0);
  console.log(`\n── ${label} ────────────────────────────────`);
  console.log(`prob1=${o.prob1.toFixed(4)}  prob2=${o.prob2.toFixed(4)}  probDraw=${o.probDraw?.toFixed(4) ?? 'n/a'}`);
  console.log(`odds1=${o.odds1}  odds2=${o.odds2}  oddsDraw=${o.oddsDraw ?? 'n/a'}`);
  console.log(`1/odds1 + 1/odds2 + 1/oddsDraw = ${overround.toFixed(4)} (overround ${((overround - 1) * 100).toFixed(2)}%)`);
  console.log(`margin reported = ${o.margin.toFixed(2)}%`);
}

// ── Scenario 1: Truy Mệnh vs Không Được Khóc (~63/37 pre-draw favorite) ──────
// Observed in prod: odds1=2.69 oddsDraw=1.90 odds2=4.97 → Σ ≈ 1.099 (OK)
// But P(draw) ≈ 48% — suspicious for BO2 competitive play.
const s1 = calculateOddsV2({
  p1Records: synth(0.65, 50, 'B'), // stronger player
  p2Records: synth(0.42, 40, 'B'),
  h2h: [],
  daysSinceLastMatch1: 7,
  daysSinceLastMatch2: 14,
  matchTier: 'S',
  format: 'BO2',
});
show('Scenario 1 — asymmetric BO2 (prob1≈0.63)', s1);

// ── Scenario 2: HeHe vs U98 (close-ish pre-draw) ────────────────────────────
// Observed in prod: odds1=3.92 oddsDraw=14.20 odds2=3.38 → Σ ≈ 0.621 (ARBITRAGE!)
// Hypothesis: odds1/odds2 were refreshed by legacy path (2-way margin, no
// format), leaving oddsDraw stale. Let's see what V2 actually produces fresh.
const s2 = calculateOddsV2({
  p1Records: synth(0.50, 30, 'B'), // balanced matchup
  p2Records: synth(0.53, 30, 'B'),
  h2h: [],
  daysSinceLastMatch1: 5,
  daysSinceLastMatch2: 5,
  matchTier: 'S',
  format: 'BO2',
});
show('Scenario 2 — near-even BO2', s2);

// ── Scenario 3: without format (legacy path) ─────────────────────────────────
// This is what calculateOddsFromPlayers → calculateOdds → calculateOddsV2
// produces — no format, no oddsDraw returned.
const s3 = calculateOddsV2({
  p1Records: synth(0.50, 30, 'B'),
  p2Records: synth(0.53, 30, 'B'),
  h2h: [],
  daysSinceLastMatch1: 5,
  daysSinceLastMatch2: 5,
  matchTier: 'S',
  // no format → 2-way margin only, oddsDraw undefined
});
show('Scenario 3 — LEGACY PATH (no format) — demonstrates bug', s3);
console.log('^^ Legacy path: oddsDraw is undefined. If DB already has a stale');
console.log('   oddsDraw row and we only update odds1/odds2, we get arbitrage.');

// ── Calibration sanity check: binomial BO2 draw for various prob1 ───────────
console.log('\n── BO2 binomial draw sensitivity (series prob → pPerGame → pDraw) ──');
for (const pSeries of [0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85]) {
  const pPerGame = solvePerGameProb(pSeries, 'BO3');
  const pDraw = calculateDrawProbability(pPerGame, 2);
  console.log(`  P(series)=${pSeries.toFixed(2)}  →  p/game=${pPerGame.toFixed(3)}  →  P(1-1)=${pDraw.toFixed(3)}`);
}
console.log('\nNote: at prob1=0.65 series, predicted P(1-1) ≈ 0.49 — high.');
console.log('Backsolving via BO3 produces p/game close to 0.56, giving near-maximal draw.');
console.log('If empirical BO2 draw rate is ≤ 0.30, apply a shrinkage coefficient in calculateOddsV2.');
