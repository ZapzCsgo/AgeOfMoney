/**
 * Post-process audit/ODDS_VARIANTS_<date>.json to add ROI + per-variant
 * comparative table. Reads the per-prediction dump produced by run-all.ts.
 *
 * ROI strategy : "fixed-1u back the variant's top pick at the IMPLIED odds
 * the variant itself produces" (1 / (prob1 * (1 + margin))). Margin per
 * variant taken from the variant's hyperparams. Comparable across variants
 * because each one carries its own pricing.
 *
 * Usage : npx tsx scripts/odds-experiments/analyze-roi.ts [--in=<path>] [--out=<path>]
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { VARIANTS } from './variants';
import { DEFAULT_HYPERPARAMS } from './tunable-engine';

interface Pred { matchId: string; prob1: number; outcome: 0 | 1 | 'draw'; format: string }
interface VariantMetrics {
  id: string; description: string;
  brier: number; logLoss: number; ece: number; accuracy: number;
  nValid: number; nDrawsExcluded: number;
}
interface Dump {
  snapshotAt: string;
  results: VariantMetrics[];
  predictionsByVariant: Record<string, Pred[]>;
}

interface Row extends VariantMetrics {
  margin: number;
  /** Average odds player1 gets when variant says prob1 > 0.5, before margin */
  avgImpliedOddsP1: number;
  /** Net P/L per bet placed (profit = odds-1 on win, -1 on loss). 1u stake. */
  roiPerBet: number;
  /** Hit rate on the variant's "top pick" (prob1 >= 0.5 → bet P1, else bet P2). */
  topPickHitRate: number;
  /** Sharpe-like : mean(P/L)/std(P/L) — useful for sizing. NaN if no variance. */
  roiSharpe: number;
  /** Estimated egress per prediction in production (bytes). Scales with cache hits. */
  egressBytesPerPrediction: number;
}

function findHyperparams(id: string) {
  const v = VARIANTS.find(x => x.id === id);
  return { ...DEFAULT_HYPERPARAMS, ...(v?.overrides ?? {}) };
}

function compute(): Row[] {
  const datestamp = new Date().toISOString().slice(0, 10);
  const inPath = process.argv.find(a => a.startsWith('--in='))?.split('=')[1]
    ?? join(__dirname, '..', '..', '..', 'audit', `ODDS_VARIANTS_${datestamp}.json`);
  const dump: Dump = JSON.parse(readFileSync(inPath, 'utf-8'));
  console.log(`[analyze-roi] Loaded ${dump.results.length} variants from ${inPath}`);

  const rows: Row[] = [];
  for (const m of dump.results) {
    const preds = dump.predictionsByVariant[m.id] ?? [];
    const hp = findHyperparams(m.id);
    const margin = hp.houseMargin2way;

    let totalImpliedOddsP1 = 0, picks = 0;
    let pl = 0, hits = 0, betCount = 0;
    const plPerBet: number[] = [];

    for (const p of preds) {
      if (p.outcome === 'draw') continue;
      const probWin = Math.max(0.05, Math.min(0.95, p.prob1 >= 0.5 ? p.prob1 : 1 - p.prob1));
      const odds = 1 / (probWin * (1 + margin));
      const won = (p.prob1 >= 0.5 ? 1 : 0) === p.outcome;
      const result = won ? odds - 1 : -1;
      pl += result;
      plPerBet.push(result);
      if (won) hits++;
      betCount++;
      if (p.prob1 >= 0.5) { totalImpliedOddsP1 += 1 / (p.prob1 * (1 + margin)); picks++; }
    }
    const avgOddsP1 = picks > 0 ? totalImpliedOddsP1 / picks : 0;
    const roiPerBet = betCount > 0 ? pl / betCount : 0;
    const topHit = betCount > 0 ? hits / betCount : 0;

    let sharpe = NaN;
    if (plPerBet.length >= 2) {
      const mean = plPerBet.reduce((a, b) => a + b, 0) / plPerBet.length;
      const variance = plPerBet.reduce((a, x) => a + (x - mean) ** 2, 0) / plPerBet.length;
      const std = Math.sqrt(variance);
      sharpe = std > 0 ? mean / std : NaN;
    }

    // Egress estimate per prediction in PROD (after cache fixes from commit 05516e5):
    // - first hit per (player, game) costs full PMR fetch (~50 KB)
    // - subsequent hits within 5 min TTL : ~0 from cache
    // - engine math itself doesn't read DB
    // Steady-state assumption: 9 active matches × 2 players sharing pool of ~30
    // tracked players → ~30 PMR fetches per 5 min window → ~50 KB / pred amortized
    // Variants that need Glicko (PlayerRating raw query) add ~1 KB per match.
    const baseEgress = 50_000; // bytes
    const glickoExtra = hp.useGlicko ? 1_000 : 0;
    const egress = baseEgress + glickoExtra;

    rows.push({
      ...m,
      margin,
      avgImpliedOddsP1: avgOddsP1,
      roiPerBet,
      topPickHitRate: topHit,
      roiSharpe: sharpe,
      egressBytesPerPrediction: egress,
    });
  }
  return rows;
}

function fmt(n: number, d = 4): string { return Number.isFinite(n) ? n.toFixed(d) : 'n/a'; }
function fmtPct(n: number, d = 1): string { return Number.isFinite(n) ? (n * 100).toFixed(d) + '%' : 'n/a'; }

function main() {
  const rows = compute();
  rows.sort((a, b) => a.brier - b.brier);

  // Top-K helpers
  const top = (key: keyof Row, asc = true, k = 5) => [...rows].sort((a, b) => {
    const av = a[key] as number, bv = b[key] as number;
    if (!Number.isFinite(av)) return 1;
    if (!Number.isFinite(bv)) return -1;
    return asc ? av - bv : bv - av;
  }).slice(0, k);

  const datestamp = new Date().toISOString().slice(0, 10);
  const outPath = process.argv.find(a => a.startsWith('--out='))?.split('=')[1]
    ?? join(__dirname, '..', '..', '..', 'audit', `ODDS_RESULTS_FULL_${datestamp}.md`);
  const lines: string[] = [];

  lines.push(`# Odds Engine — Full Comparative Results (${datestamp})\n`);
  lines.push(`Generated by \`scripts/odds-experiments/analyze-roi.ts\` from \`audit/ODDS_VARIANTS_${datestamp}.json\`.\n`);
  lines.push(`Snapshot taken at the time of \`run-all.ts\`. Window : last ${rows[0]?.nValid ?? 0} non-draw matches.`);
  lines.push(`\n## Métriques par variant (sorted by Brier ↓)\n`);
  lines.push(`| Rank | Variant | Brier | LogLoss | ECE | Accuracy | ROI/bet | Top-pick hit | Sharpe | Margin | Egress B/pred |`);
  lines.push(`|------|---------|-------|---------|-----|----------|---------|--------------|--------|--------|---------------|`);
  rows.forEach((r, i) => {
    lines.push(
      `| ${i + 1} | \`${r.id}\` | ${fmt(r.brier)} | ${fmt(r.logLoss)} | ${fmt(r.ece)} | ${fmtPct(r.accuracy)} | ${fmt(r.roiPerBet, 4)} | ${fmtPct(r.topPickHitRate)} | ${fmt(r.roiSharpe, 3)} | ${fmt(r.margin, 3)} | ${r.egressBytesPerPrediction} |`
    );
  });

  lines.push(`\n## Top 5 par métrique\n`);
  const sectionTop = (label: string, key: keyof Row, asc = true) => {
    lines.push(`### ${label}\n`);
    for (const r of top(key, asc)) {
      const val = r[key] as number;
      lines.push(`- \`${r.id}\` — ${key} = ${typeof val === 'number' ? fmt(val) : val}, accuracy ${fmtPct(r.accuracy)}, ROI ${fmt(r.roiPerBet, 4)}`);
    }
    lines.push('');
  };
  sectionTop('Brier ↓ (probabilistic accuracy)', 'brier', true);
  sectionTop('Log loss ↓', 'logLoss', true);
  sectionTop('ECE ↓ (calibration)', 'ece', true);
  sectionTop('Accuracy ↑', 'accuracy', false);
  sectionTop('ROI per 1u bet ↑', 'roiPerBet', false);
  sectionTop('Top-pick hit rate ↑', 'topPickHitRate', false);
  sectionTop('Sharpe (mean/std P/L) ↑', 'roiSharpe', false);

  // Recommendation
  const baseline = rows.find(r => r.id === 'baseline');
  const candidates = rows.filter(r =>
    r.brier < (baseline?.brier ?? 1) - 0.005
    && r.accuracy >= (baseline?.accuracy ?? 0)
    && r.ece < (baseline?.ece ?? 1) - 0.005
  );
  const ranked = candidates.sort((a, b) => a.brier - b.brier);

  lines.push(`\n## Recommandation argumentée\n`);
  if (baseline) {
    lines.push(`**Baseline référence** : Brier ${fmt(baseline.brier)} | Acc ${fmtPct(baseline.accuracy)} | ECE ${fmt(baseline.ece)} | ROI ${fmt(baseline.roiPerBet, 4)}.\n`);
  }
  if (ranked.length === 0) {
    lines.push(`Aucun variant ne bat le baseline simultanément sur Brier (-0.005), ECE (-0.005), et accuracy (>=). À surveiller mais pas de switch recommandé.`);
  } else {
    const winner = ranked[0];
    lines.push(`**Recommandation : adopter \`${winner.id}\`**\n`);
    lines.push(`Métriques :`);
    lines.push(`- Brier ${fmt(winner.brier)} (Δ ${fmt(winner.brier - (baseline?.brier ?? 0), 4)})`);
    lines.push(`- Accuracy ${fmtPct(winner.accuracy)} (Δ ${fmtPct(winner.accuracy - (baseline?.accuracy ?? 0))})`);
    lines.push(`- ECE ${fmt(winner.ece)} (Δ ${fmt(winner.ece - (baseline?.ece ?? 0), 4)})`);
    lines.push(`- ROI ${fmt(winner.roiPerBet, 4)} (Δ ${fmt(winner.roiPerBet - (baseline?.roiPerBet ?? 0), 4)})`);
    lines.push(`- Egress identique au baseline (${winner.egressBytesPerPrediction} B/pred)\n`);
    lines.push(`Description : ${winner.description}\n`);
    if (ranked.length > 1) {
      lines.push(`Alternatifs viables (Brier < baseline - 0.005, calibration améliorée) :`);
      ranked.slice(1, 4).forEach(r => lines.push(`- \`${r.id}\` (Brier ${fmt(r.brier)}, Acc ${fmtPct(r.accuracy)}, ROI ${fmt(r.roiPerBet, 4)})`));
    }
  }

  lines.push(`\n## Caveat — ROI methodology\n`);
  lines.push(`ROI computed as if betting 1 unit on each match's top pick at the variant's own implied odds (1 / (prob × (1+margin))). This is a fair head-to-head benchmark across variants but does NOT reflect a real ROI vs the bookmaker — it would only do so if the variant's odds matched what users actually saw at bet time. The current production engine prices odds; the leaderboard ROI here is a comparative number, not a forecast of profit.\n`);
  lines.push(`A variant with Brier-better-than-baseline + ROI-positive on this metric is genuinely better calibrated AND would (if priced) extract more value from the user side. A negative ROI doesn't indicate the engine is unprofitable in prod — it indicates the implied odds are giving back too much to the bettor.\n`);

  writeFileSync(outPath, lines.join('\n'));
  console.log(`[analyze-roi] Wrote ${outPath}`);
  console.log(`\nTop by Brier:`);
  rows.slice(0, 5).forEach((r, i) => console.log(`  ${i + 1}. ${r.id.padEnd(28)} Brier=${fmt(r.brier)} Acc=${fmtPct(r.accuracy)} ROI=${fmt(r.roiPerBet, 4)}`));
}

main();
