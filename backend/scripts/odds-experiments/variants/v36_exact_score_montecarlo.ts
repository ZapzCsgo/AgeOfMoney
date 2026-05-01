/**
 * Variant v36 — Exact-score Monte Carlo backtest.
 *
 * Distinct from the binary-outcome harness in run-all.ts : here we measure
 * how well the exact-score distribution (P(2-0), P(2-1), P(0-2), P(1-2)
 * for BO3 ; analogous for BO5/BO7) matches reality.
 *
 * Pipeline :
 *   1. Read snapshot from .snapshot.json (same one run-all.ts uses).
 *   2. For each match in the measurement window, derive `pPerGame` via
 *      `solvePerGameProb(prob1FromBaseline, format)`. Baseline = the
 *      tunable engine with DEFAULT_HYPERPARAMS (matches prod V1).
 *   3. Two predictions per match :
 *        a) Closed-form analyticalExactScore (cheap, ~zero variance).
 *        b) Monte Carlo simulateExactScore (10k sims, deterministic seed).
 *   4. Score each prediction with :
 *        - Brier multi (sum (p_i - y_i)^2 over all legal scores)
 *        - Log-loss on the actual final score's predicted prob
 *        - Top-1 accuracy (was the highest-prob score the actual one?)
 *   5. Write audit/ODDS_EXACT_SCORE_2026-05-02.md.
 *
 * Usage : cd backend && npx tsx scripts/odds-experiments/variants/v36_exact_score_montecarlo.ts
 *         (requires snapshot — run scripts/odds-experiments/snapshot-data.ts first when DB is back)
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { calculateOddsTuned, DEFAULT_HYPERPARAMS, type MatchRecord, type H2HRecord, type TunedInput } from '../tunable-engine';
import {
  simulateExactScore, analyticalExactScore, legalScores,
  type ExactBoFormat, type ExactScoreKey, type ExactScoreDistribution,
} from '../../../src/services/odds/exactScore';

interface PmrSnapshot {
  playerId: string; opponentId: string | null; won: boolean;
  tier: string | null; matchDate: string | null; score: string | null; confidence: number | null;
}
interface MatchSnapshot {
  id: string; scheduledAt: string; player1Id: string; player2Id: string;
  player1Name: string; player2Name: string;
  player1LastMatchAt: string | null; player2LastMatchAt: string | null;
  winnerId: string | null; resultScore: string | null; format: string; tournamentTier: string | null;
}
interface Snapshot { snapshotAt: string; pmr: PmrSnapshot[]; matches: MatchSnapshot[] }

function seriesWinProb(p: number, format: string): number {
  const q = 1 - p;
  if (format === 'BO1') return p;
  if (format === 'BO3') return p * p * (3 - 2 * p);
  if (format === 'BO5') return p * p * p * (1 + 3 * q + 6 * q * q);
  if (format === 'BO7') return p * p * p * p * (1 + 4 * q + 10 * q * q + 20 * q * q * q);
  return p;
}

function solvePerGameProb(pMatch: number, format: string): number {
  if (pMatch <= 0 || pMatch >= 1) return pMatch;
  let lo = 0.001, hi = 0.999;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (seriesWinProb(mid, format) < pMatch) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

interface PredEntry {
  matchId: string;
  format: ExactBoFormat;
  actual: ExactScoreKey;
  analytical: ExactScoreDistribution;
  monteCarlo: ExactScoreDistribution;
}

function brierMulti(dist: ExactScoreDistribution, actual: ExactScoreKey, scores: ExactScoreKey[]): number {
  let s = 0;
  for (const k of scores) {
    const p = dist[k] ?? 0;
    const y = k === actual ? 1 : 0;
    s += (p - y) ** 2;
  }
  return s;
}

function logLoss(dist: ExactScoreDistribution, actual: ExactScoreKey): number {
  const p = Math.max(0.001, Math.min(0.999, dist[actual] ?? 0));
  return -Math.log(p);
}

function top1Hit(dist: ExactScoreDistribution, actual: ExactScoreKey): boolean {
  let bestK: string | null = null, bestP = -1;
  for (const [k, v] of Object.entries(dist)) if ((v ?? 0) > bestP) { bestP = v ?? 0; bestK = k; }
  return bestK === actual;
}

async function main() {
  const snapshotPath = join(__dirname, '..', '.snapshot.json');
  if (!existsSync(snapshotPath)) {
    console.error(`Missing ${snapshotPath} — run scripts/odds-experiments/snapshot-data.ts first.`);
    process.exit(2);
  }
  const snap: Snapshot = JSON.parse(readFileSync(snapshotPath, 'utf-8'));

  const pmrByPlayer = new Map<string, Array<Omit<PmrSnapshot, 'matchDate'> & { matchDate: Date | null }>>();
  for (const r of snap.pmr) {
    const list = pmrByPlayer.get(r.playerId) ?? [];
    list.push({ ...r, matchDate: r.matchDate ? new Date(r.matchDate) : null });
    pmrByPlayer.set(r.playerId, list);
  }
  for (const list of pmrByPlayer.values()) {
    list.sort((a, b) => (a.matchDate?.getTime() ?? 0) - (b.matchDate?.getTime() ?? 0));
  }

  const recordsBefore = (playerId: string, cutoff: Date): MatchRecord[] => {
    const list = pmrByPlayer.get(playerId) ?? [];
    return list
      .filter(r => !r.matchDate || r.matchDate < cutoff)
      .map(r => ({ won: r.won, tier: r.tier ?? 'B', matchDate: r.matchDate, opponentId: r.opponentId, score: r.score }));
  };
  const h2hBefore = (p1: string, p2: string, cutoff: Date): H2HRecord[] => {
    const l = pmrByPlayer.get(p1) ?? [];
    const result: H2HRecord[] = [];
    for (const r of l) {
      if (r.opponentId !== p2) continue;
      if (r.matchDate && r.matchDate >= cutoff) continue;
      result.push({
        winner: (r.won ? 1 : 2) as 1 | 2,
        tier: r.tier ?? 'B', matchDate: r.matchDate,
        confidence: r.confidence ?? 0.8,
      });
    }
    return result.sort((a, b) => (b.matchDate?.getTime() ?? 0) - (a.matchDate?.getTime() ?? 0)).slice(0, 40);
  };

  const events = snap.matches
    .filter(m => m.resultScore && /^\d+-\d+$/.test(m.resultScore))
    .filter(m => ['BO3', 'BO5', 'BO7'].includes(m.format))
    .map(m => ({
      ...m,
      scheduledAt: new Date(m.scheduledAt),
      player1LastMatchAt: m.player1LastMatchAt ? new Date(m.player1LastMatchAt) : null,
      player2LastMatchAt: m.player2LastMatchAt ? new Date(m.player2LastMatchAt) : null,
    }));

  console.log(`[v36] ${events.length} odd-BO completed matches in snapshot`);

  const N = 200;
  const window = events.slice(-N);
  console.log(`[v36] Measurement window : last ${window.length} matches (asked --n=${N})`);

  const preds: PredEntry[] = [];
  for (const ev of window) {
    const p1Recs = recordsBefore(ev.player1Id, ev.scheduledAt);
    const p2Recs = recordsBefore(ev.player2Id, ev.scheduledAt);
    if (p1Recs.length === 0 || p2Recs.length === 0) continue;

    const h2h = h2hBefore(ev.player1Id, ev.player2Id, ev.scheduledAt);
    const now = ev.scheduledAt.getTime();
    const days1 = ev.player1LastMatchAt ? Math.max(0, (now - ev.player1LastMatchAt.getTime()) / 86400000) : 30;
    const days2 = ev.player2LastMatchAt ? Math.max(0, (now - ev.player2LastMatchAt.getTime()) / 86400000) : 30;

    const baseInput: TunedInput = {
      p1Records: p1Recs, p2Records: p2Recs, h2h,
      daysSinceLastMatch1: days1, daysSinceLastMatch2: days2,
      matchTier: ev.tournamentTier ?? undefined, format: ev.format,
    };
    const tuned = calculateOddsTuned(baseInput, DEFAULT_HYPERPARAMS);
    const pPerGame = solvePerGameProb(tuned.prob1, ev.format);

    const fmt = ev.format as ExactBoFormat;
    const analytical = analyticalExactScore(pPerGame, fmt);
    const monteCarlo = simulateExactScore({ pPerGame, format: fmt, simCount: 10_000, seed: 42 });

    preds.push({ matchId: ev.id, format: fmt, actual: ev.resultScore as ExactScoreKey, analytical, monteCarlo });
  }
  console.log(`[v36] ${preds.length} predictions made`);

  const buckets: Record<ExactBoFormat, PredEntry[]> = { BO3: [], BO5: [], BO7: [] };
  for (const p of preds) buckets[p.format].push(p);

  function aggregate(entries: PredEntry[], pick: (e: PredEntry) => ExactScoreDistribution) {
    if (entries.length === 0) return { brier: NaN, logLoss: NaN, top1: NaN, n: 0 };
    let bsum = 0, lsum = 0, hits = 0;
    for (const e of entries) {
      const d = pick(e);
      const scores = legalScores(e.format);
      bsum += brierMulti(d, e.actual, scores);
      lsum += logLoss(d, e.actual);
      if (top1Hit(d, e.actual)) hits++;
    }
    return { brier: bsum / entries.length, logLoss: lsum / entries.length, top1: hits / entries.length, n: entries.length };
  }

  const lines: string[] = [];
  const datestamp = new Date().toISOString().slice(0, 10);
  lines.push(`# Exact-score backtest — v36 Monte Carlo vs analytical (${datestamp})\n`);
  lines.push(`Snapshot : ${snap.snapshotAt}`);
  lines.push(`Predictions : ${preds.length} (BO3=${buckets.BO3.length} BO5=${buckets.BO5.length} BO7=${buckets.BO7.length})`);
  lines.push(`MC sims per prediction : 10 000 (seed 42, deterministic)\n`);
  lines.push(`## Results by format\n`);
  lines.push(`| Format | Method | Brier (multi) ↓ | Log loss ↓ | Top-1 acc ↑ | n |`);
  lines.push(`|--------|--------|-----------------|------------|-------------|---|`);
  for (const fmt of ['BO3', 'BO5', 'BO7'] as ExactBoFormat[]) {
    const ana = aggregate(buckets[fmt], e => e.analytical);
    const mc  = aggregate(buckets[fmt], e => e.monteCarlo);
    lines.push(`| ${fmt} | analytical | ${ana.brier.toFixed(4)} | ${ana.logLoss.toFixed(4)} | ${(ana.top1 * 100).toFixed(1)}% | ${ana.n} |`);
    lines.push(`| ${fmt} | monteCarlo | ${mc.brier.toFixed(4)} | ${mc.logLoss.toFixed(4)} | ${(mc.top1 * 100).toFixed(1)}% | ${mc.n} |`);
  }

  lines.push(`\n## All formats combined`);
  const allAna = aggregate(preds, e => e.analytical);
  const allMc  = aggregate(preds, e => e.monteCarlo);
  lines.push(`- analytical : Brier ${allAna.brier.toFixed(4)}, LL ${allAna.logLoss.toFixed(4)}, Top-1 ${(allAna.top1 * 100).toFixed(1)}%`);
  lines.push(`- monteCarlo : Brier ${allMc.brier.toFixed(4)}, LL ${allMc.logLoss.toFixed(4)}, Top-1 ${(allMc.top1 * 100).toFixed(1)}%`);

  lines.push(`\n## Verdict\n`);
  if (Math.abs(allAna.brier - allMc.brier) < 0.005) {
    lines.push(`MC and analytical agree within Brier 0.005 — expected, since with iid \`pPerGame\` the MC is a noisy estimator of the closed form. Use analytical in prod (zero variance, no PRNG, faster).`);
  } else {
    lines.push(`MC and analytical diverge by Brier ${Math.abs(allAna.brier - allMc.brier).toFixed(4)} — investigate (likely PRNG seed sensitivity or tail-event undersampling).`);
  }
  lines.push(`\nReal upside of MC kicks in once \`perMapProb\` is wired (per-game data needed — schema work : add Game.civ + Game.map per BO game in PMR).`);

  const outDir = join(__dirname, '..', '..', '..', '..', 'audit');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `ODDS_EXACT_SCORE_${datestamp}.md`);
  writeFileSync(outPath, lines.join('\n'));
  console.log(`\n[v36] Wrote ${outPath}`);
  console.log(`\n=== Summary ===`);
  console.log(`Analytical : Brier ${allAna.brier.toFixed(4)}  LL ${allAna.logLoss.toFixed(4)}  Top1 ${(allAna.top1 * 100).toFixed(1)}%`);
  console.log(`Monte Carlo: Brier ${allMc.brier.toFixed(4)}  LL ${allMc.logLoss.toFixed(4)}  Top1 ${(allMc.top1 * 100).toFixed(1)}%`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
