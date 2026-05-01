/**
 * Variant v46 — Ensemble voting.
 *
 * Reads the snapshot, runs the top-N variants from a pre-computed Brier
 * leaderboard, and averages their `prob1` predictions weighted inversely
 * by Brier (lower Brier = higher voting weight).
 *
 * Why not in variants.ts ? An ensemble can't be expressed as a single
 * Hyperparams override — it needs to call multiple variants and combine
 * their outputs. This script reads `audit/ODDS_VARIANTS_<date>.json` (the
 * dump from run-all.ts) so the pipeline is :
 *   1. snapshot-data.ts            (one DB read)
 *   2. run-all.ts                  (writes ODDS_VARIANTS_<date>.json)
 *   3. v46_ensemble.ts             (reads it, computes ensemble, writes its own report)
 *
 * Usage : cd backend && npx tsx scripts/odds-experiments/variants/v46_ensemble.ts \
 *           [--top=5] [--in=<path>]
 */
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';

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

function fmt(n: number, d = 4): string { return Number.isFinite(n) ? n.toFixed(d) : 'n/a'; }
function fmtPct(n: number, d = 1): string { return Number.isFinite(n) ? (n * 100).toFixed(d) + '%' : 'n/a'; }

function main() {
  const topArg = process.argv.find(a => a.startsWith('--top='))?.split('=')[1];
  const topN = topArg ? parseInt(topArg, 10) : 5;
  const datestamp = new Date().toISOString().slice(0, 10);
  const inPath = process.argv.find(a => a.startsWith('--in='))?.split('=')[1]
    ?? join(__dirname, '..', '..', '..', '..', 'audit', `ODDS_VARIANTS_${datestamp}.json`);
  if (!existsSync(inPath)) {
    console.error(`[v46] Missing ${inPath} — run-all.ts must produce it first.`);
    process.exit(2);
  }
  const dump: Dump = JSON.parse(readFileSync(inPath, 'utf-8'));
  console.log(`[v46] Loaded ${dump.results.length} variants from ${inPath}`);

  // Pick top N by Brier, excluding placeholders + the v46 ensemble itself.
  const sorted = [...dump.results]
    .filter(r => !r.id.includes('placeholder') && !r.id.includes('ensemble'))
    .sort((a, b) => a.brier - b.brier)
    .slice(0, topN);
  console.log(`[v46] Top ${topN} by Brier :`);
  sorted.forEach((r, i) => console.log(`  ${i + 1}. ${r.id} (Brier ${fmt(r.brier)})`));

  // Voting weights : inverse-Brier normalized.
  const weights = sorted.map(r => 1 / Math.max(1e-6, r.brier));
  const wSum = weights.reduce((a, b) => a + b, 0);
  const normW = weights.map(w => w / wSum);
  console.log(`[v46] Voting weights : ${normW.map(w => fmt(w, 3)).join(', ')}`);

  // Build the ensemble prediction per match : weighted average of prob1
  // across the top-N. Keys must match across all variants ; if not (due
  // to early-window cuts), fall back to whatever variants have a prediction.
  const matchIds = new Set<string>();
  for (const v of sorted) {
    for (const p of dump.predictionsByVariant[v.id] ?? []) matchIds.add(p.matchId);
  }
  const ensPreds: Pred[] = [];
  for (const matchId of matchIds) {
    let probSum = 0, wTotal = 0;
    let outcome: 0 | 1 | 'draw' = 'draw';
    let format = '';
    for (let i = 0; i < sorted.length; i++) {
      const p = (dump.predictionsByVariant[sorted[i].id] ?? []).find(x => x.matchId === matchId);
      if (!p) continue;
      probSum += p.prob1 * normW[i];
      wTotal += normW[i];
      outcome = p.outcome;
      format = p.format;
    }
    if (wTotal > 0) {
      ensPreds.push({ matchId, prob1: probSum / wTotal, outcome, format });
    }
  }

  // Score it
  const valid = ensPreds.filter(p => p.outcome !== 'draw');
  let bsum = 0, lsum = 0, hits = 0;
  const buckets: Array<{ p: number[]; y: number[] }> = Array.from({ length: 10 }, () => ({ p: [], y: [] }));
  for (const p of valid) {
    const y = p.outcome === 1 ? 1 : 0;
    bsum += (p.prob1 - y) ** 2;
    const c = Math.max(0.001, Math.min(0.999, p.prob1));
    lsum += -(y * Math.log(c) + (1 - y) * Math.log(1 - c));
    if ((p.prob1 >= 0.5 ? 1 : 0) === y) hits++;
    const idx = Math.min(9, Math.floor(p.prob1 * 10));
    buckets[idx].p.push(p.prob1); buckets[idx].y.push(y);
  }
  const brier = bsum / valid.length;
  const logLoss = lsum / valid.length;
  const accuracy = hits / valid.length;
  let ece = 0;
  for (const b of buckets) {
    if (b.p.length === 0) continue;
    const pmean = b.p.reduce((a, x) => a + x, 0) / b.p.length;
    const obs = b.y.reduce((a, x) => a + x, 0) / b.y.length;
    ece += (b.p.length / valid.length) * Math.abs(pmean - obs);
  }

  const baseline = dump.results.find(r => r.id === 'baseline');

  const lines: string[] = [];
  lines.push(`# v46 — Ensemble voting result (${datestamp})\n`);
  lines.push(`Snapshot : ${dump.snapshotAt}`);
  lines.push(`Top-N constituents : ${topN} (inverse-Brier weighting)`);
  lines.push(`\n## Constituents\n`);
  lines.push(`| Rank | Variant | Brier | Voting weight |`);
  lines.push(`|------|---------|-------|---------------|`);
  sorted.forEach((r, i) => lines.push(`| ${i + 1} | \`${r.id}\` | ${fmt(r.brier)} | ${fmt(normW[i], 3)} |`));

  lines.push(`\n## Ensemble metrics (n=${valid.length} non-draw)\n`);
  lines.push(`| Metric | Ensemble | Baseline | Δ |`);
  lines.push(`|--------|----------|----------|---|`);
  lines.push(`| Brier ↓ | ${fmt(brier)} | ${baseline ? fmt(baseline.brier) : 'n/a'} | ${baseline ? fmt(brier - baseline.brier, 4) : 'n/a'} |`);
  lines.push(`| Log loss ↓ | ${fmt(logLoss)} | ${baseline ? fmt(baseline.logLoss) : 'n/a'} | ${baseline ? fmt(logLoss - baseline.logLoss, 4) : 'n/a'} |`);
  lines.push(`| ECE ↓ | ${fmt(ece)} | ${baseline ? fmt(baseline.ece) : 'n/a'} | ${baseline ? fmt(ece - baseline.ece, 4) : 'n/a'} |`);
  lines.push(`| Accuracy ↑ | ${fmtPct(accuracy)} | ${baseline ? fmtPct(baseline.accuracy) : 'n/a'} | ${baseline ? fmtPct(accuracy - baseline.accuracy) : 'n/a'} |`);

  lines.push(`\n## Verdict\n`);
  if (baseline && brier < baseline.brier) {
    const winner = sorted[0];
    lines.push(`Ensemble Brier ${fmt(brier)} is **better** than baseline ${fmt(baseline.brier)} by ${fmt(baseline.brier - brier, 4)}.`);
    lines.push(`Compared to the single-best constituent \`${winner.id}\` (Brier ${fmt(winner.brier)}) :`);
    if (brier < winner.brier) {
      lines.push(`- Ensemble **also beats** the single best by ${fmt(winner.brier - brier, 4)}. Recommend deploying ensemble.`);
    } else {
      lines.push(`- Ensemble is **worse than** the single best by ${fmt(brier - winner.brier, 4)}. Diversification didn't help — prefer the single winner \`${winner.id}\`.`);
    }
  } else {
    lines.push(`Ensemble didn't beat baseline. Investigate : top-N may share too much correlation.`);
  }

  const outPath = join(__dirname, '..', '..', '..', '..', 'audit', `ODDS_V46_ENSEMBLE_${datestamp}.md`);
  writeFileSync(outPath, lines.join('\n'));
  console.log(`\n[v46] Wrote ${outPath}`);
  console.log(`[v46] Ensemble : Brier=${fmt(brier)}  LL=${fmt(logLoss)}  ECE=${fmt(ece)}  Acc=${fmtPct(accuracy)}`);
}

main();
