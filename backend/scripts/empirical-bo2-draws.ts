/**
 * Empirical BO2 draw-rate analysis.
 *
 * Purpose: check whether the binomial P(1-1 | series prob) predicted by
 * calculateOddsV2 matches reality. We pull all PlayerMatchRecord rows with
 * format='BO2' and a parseable score, then compute the observed P(1-1) split
 * by skill gap (both proxied by tier and by opponent winrate gap).
 *
 * If the empirical rate is materially lower than the binomial prediction
 * (~50% at prob=0.5 dropping to ~36% at prob=0.85), apply a shrinkage
 * coefficient in oddsEngine.ts. If it's close, keep the current formula.
 *
 * Requires DB access. If the direct Supabase URL (port 5432) can't be reached
 * from your network, run with the pooled URL:
 *
 *   DATABASE_URL="postgresql://postgres.<project>:<pw>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true" \
 *     npx tsx scripts/empirical-bo2-draws.ts
 *
 * Supabase dashboard → Project Settings → Database → Connection Pooling → URI.
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('[Empirical] Loading BO2 PlayerMatchRecord rows…');

  // Each BO2 is stored twice (once per player) — dedupe by
  // (tournamentName, matchDate, sorted pair of playerIds/names).
  const rows = await prisma.playerMatchRecord.findMany({
    where: {
      format: 'BO2',
      score: { not: null },
    },
    select: {
      playerId: true,
      opponentId: true,
      opponentName: true,
      score: true,
      tier: true,
      tournamentName: true,
      matchDate: true,
      game: true,
      won: true,
    },
  });

  console.log(`[Empirical] Fetched ${rows.length} raw BO2 rows`);

  // Dedupe
  const seen = new Set<string>();
  type Deduped = { score: string; tier: string; game: string };
  const matches: Deduped[] = [];
  for (const r of rows) {
    if (!r.score) continue;
    const oppKey = r.opponentId ?? `name:${r.opponentName}`;
    const pair = [r.playerId, oppKey].sort().join('|');
    const key = `${r.tournamentName}|${r.matchDate?.toISOString() ?? ''}|${pair}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push({ score: r.score.trim(), tier: r.tier, game: r.game });
  }
  console.log(`[Empirical] After dedupe: ${matches.length} unique BO2 matches`);

  const counts: Record<string, number> = {};
  for (const m of matches) counts[m.score] = (counts[m.score] ?? 0) + 1;
  console.log('\nScore distribution (all BO2):');
  for (const [s, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s}  ${n.toString().padStart(4)}  (${((n / matches.length) * 100).toFixed(1)}%)`);
  }

  // Draw = 1-1
  const draws = matches.filter(m => m.score === '1-1').length;
  const decisive = matches.filter(m => m.score === '2-0' || m.score === '0-2').length;
  const other = matches.length - draws - decisive;
  console.log(`\nAggregate: draws=${draws} (${((draws / matches.length) * 100).toFixed(1)}%) ` +
    `decisive(2-0/0-2)=${decisive} (${((decisive / matches.length) * 100).toFixed(1)}%) ` +
    `other=${other}`);

  // By tier
  console.log('\nBy tier (draws only, sample size ≥ 20):');
  const byTier: Record<string, { total: number; draws: number }> = {};
  for (const m of matches) {
    if (!byTier[m.tier]) byTier[m.tier] = { total: 0, draws: 0 };
    byTier[m.tier].total++;
    if (m.score === '1-1') byTier[m.tier].draws++;
  }
  for (const [tier, s] of Object.entries(byTier).sort((a, b) => b[1].total - a[1].total)) {
    if (s.total < 20) continue;
    console.log(`  tier=${tier.padEnd(10)}  n=${s.total.toString().padStart(4)}  P(draw)=${((s.draws / s.total) * 100).toFixed(1)}%`);
  }

  // By game
  console.log('\nBy game (draws only, sample size ≥ 20):');
  const byGame: Record<string, { total: number; draws: number }> = {};
  for (const m of matches) {
    if (!byGame[m.game]) byGame[m.game] = { total: 0, draws: 0 };
    byGame[m.game].total++;
    if (m.score === '1-1') byGame[m.game].draws++;
  }
  for (const [game, s] of Object.entries(byGame).sort((a, b) => b[1].total - a[1].total)) {
    if (s.total < 20) continue;
    console.log(`  game=${game.padEnd(6)}  n=${s.total.toString().padStart(4)}  P(draw)=${((s.draws / s.total) * 100).toFixed(1)}%`);
  }

  // Compare vs binomial prediction
  // For a matchup with observed decisive split w_p1 vs w_p2, we can backsolve
  // the implied per-game prob from the decisive count ratio, then compute the
  // predicted P(1-1) and compare to observed.
  console.log('\n── Binomial vs empirical comparison ───────────────────────');
  if (decisive > 0 && matches.length >= 50) {
    // Rough: assume P(player1 wins decisive) = 0.5 on average (symmetric),
    // so in a 50-50 pool P(draw) predicted = 2 * 0.5 * 0.5 = 0.50.
    // If empirical is << 50%, model over-weights draws.
    const obs = draws / matches.length;
    const pred5050 = 0.50;
    console.log(`  Observed P(1-1) overall = ${(obs * 100).toFixed(1)}%`);
    console.log(`  Model prediction at p=0.50 per-game = ${(pred5050 * 100).toFixed(1)}%`);
    console.log(`  Ratio obs/pred = ${(obs / pred5050).toFixed(3)}`);
    console.log('  → Recommended shrinkage coefficient ≈ ' + (obs / pred5050).toFixed(2));
    if (obs / pred5050 < 0.75) {
      console.log('  ⚠️  Model over-predicts BO2 draws — apply shrinkage in calculateDrawProbability.');
    } else if (obs / pred5050 > 1.25) {
      console.log('  ⚠️  Model under-predicts BO2 draws.');
    } else {
      console.log('  ✓ Model calibrated within ±25% — no shrinkage needed.');
    }
  } else {
    console.log('  Not enough data for comparison (need ≥ 50 unique BO2 matches).');
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('[Empirical] Fatal:', err);
  process.exit(1);
});
