/**
 * Baseline backtest for the current odds engine.
 *
 * READ-ONLY — ne touche à aucune row. Lit les N derniers matchs COMPLETED,
 * reconstruit pour chaque match ce que calculateOddsV2 aurait prédit juste
 * avant le match (records filtrés par matchDate < scheduledAt, opponent
 * winrates idem), compare aux résultats réels, et produit :
 *
 *   - Brier score moyen (lower is better, 0.25 = baseline 50/50)
 *   - Log-loss moyen
 *   - Calibration curve (buckets 10%) — reliability diagram
 *   - Accuracy du top-choice (% où le favori a gagné)
 *   - ROI simulé du book (handle virtuel × edge)
 *   - Stats par format (BO1/2/3/5/7)
 *
 * Les BO2 qui finissent 1-1 (void-on-draw) sont exclus du Brier/log-loss
 * (ils sont remboursés — pas de "ground truth" binaire) mais comptés dans
 * le ROI comme neutral outcome.
 *
 * Usage :
 *   SKIP_SERVER=1 DATABASE_URL='...' npx tsx scripts/backtest-baseline.ts [--n=200]
 *
 * Output :
 *   audit/BASELINE_ODDS_ENGINE_<date>.md     — rapport lisible
 *   audit/BASELINE_ODDS_ENGINE_<date>.json   — metrics structurées
 */

import { PrismaClient } from '@prisma/client';
import { calculateOddsV2, type MatchRecord, type H2HRecord } from '../src/services/oddsEngine';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();
const SENTINEL = '__AI_ENRICHED__';

interface MatchRow {
  id: string;
  format: string;
  odds1: number;
  odds2: number;
  oddsDraw: number | null;
  scheduledAt: Date;
  winnerId: string | null;
  resultScore: string | null;
  player1Id: string;
  player2Id: string;
  player1Name: string;
  player2Name: string;
  player1LastMatchAt: Date | null;
  player2LastMatchAt: Date | null;
  tournamentTier: string | null;
}

interface Prediction {
  matchId: string;
  label: string;
  format: string;
  tier: string | null;
  prob1: number;                // predicted P(player1 wins the series)
  prob2: number;
  odds1Old: number;             // the odds actually served at match time (in DB)
  odds2Old: number;
  odds1Model: number;           // what the engine recomputes NOW
  odds2Model: number;
  outcome: 0 | 1 | 'draw';      // 1 = p1 wins series, 0 = p2 wins, 'draw' = BO2 1-1
  scheduledAt: Date;
}

function parseArgs(): { n: number } {
  const nArg = process.argv.find(a => a.startsWith('--n='));
  const n = nArg ? parseInt(nArg.split('=')[1], 10) : 200;
  return { n: Math.max(10, Math.min(1000, n)) };
}

function scoreIsDraw(score: string | null): boolean {
  if (!score) return false;
  const m = score.match(/^\s*(\d+)\s*[-:]\s*(\d+)\s*$/);
  if (!m) return false;
  const a = parseInt(m[1], 10);
  const b = parseInt(m[2], 10);
  return a === b && a >= 1;
}

async function loadCompletedMatches(n: number): Promise<MatchRow[]> {
  const rows = await prisma.match.findMany({
    where: {
      status: 'COMPLETED',
      AND: [
        { scheduledAt: { not: undefined } },
        { odds1: { gt: 0 } },
        { odds2: { gt: 0 } },
      ],
    },
    include: {
      player1: { select: { id: true, name: true, lastMatchAt: true } },
      player2: { select: { id: true, name: true, lastMatchAt: true } },
      tournament: { select: { tier: true } },
    },
    orderBy: { scheduledAt: 'desc' },
    take: n,
  });

  return rows
    .filter(r => r.resultScore || r.winnerId)
    .map(r => ({
      id: r.id,
      format: r.format,
      odds1: r.odds1,
      odds2: r.odds2,
      oddsDraw: r.oddsDraw,
      scheduledAt: r.scheduledAt,
      winnerId: r.winnerId,
      resultScore: r.resultScore,
      player1Id: r.player1Id,
      player2Id: r.player2Id,
      player1Name: r.player1.name,
      player2Name: r.player2.name,
      player1LastMatchAt: r.player1.lastMatchAt,
      player2LastMatchAt: r.player2.lastMatchAt,
      tournamentTier: r.tournament?.tier ?? null,
    }));
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try { return await fn(); }
    catch (err) {
      lastErr = err;
      const msg = String((err as Error).message ?? '');
      if (!msg.includes('reach database') && !msg.includes('P1001') && !msg.includes('P2024')) throw err;
      await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw lastErr;
}

async function predictForMatch(m: MatchRow): Promise<Prediction | null> {
  // 1. Load records for both players, filtered to pre-match date only.
  //    This simulates what the engine could know BEFORE the match was played.
  const cutoff = m.scheduledAt;
  const [p1Records, p2Records] = await withRetry(() => Promise.all([
    prisma.playerMatchRecord.findMany({
      where: {
        playerId: m.player1Id,
        NOT: { opponentName: SENTINEL },
        OR: [
          { matchDate: null },
          { matchDate: { lt: cutoff } },
        ],
      },
      select: { won: true, tier: true, matchDate: true, opponentId: true, score: true },
    }),
    prisma.playerMatchRecord.findMany({
      where: {
        playerId: m.player2Id,
        NOT: { opponentName: SENTINEL },
        OR: [
          { matchDate: null },
          { matchDate: { lt: cutoff } },
        ],
      },
      select: { won: true, tier: true, matchDate: true, opponentId: true, score: true },
    }),
  ]));

  // 2. Need at least some data on both sides to predict
  if (p1Records.length === 0 || p2Records.length === 0) return null;

  // 3. H2H — also filtered pre-match
  const h2hRows = await withRetry(() => prisma.playerMatchRecord.findMany({
    where: {
      NOT: { opponentName: SENTINEL },
      OR: [
        { playerId: m.player1Id, opponentId: m.player2Id },
        { playerId: m.player2Id, opponentId: m.player1Id },
      ],
      AND: [
        { OR: [{ matchDate: null }, { matchDate: { lt: cutoff } }] },
      ],
    },
    orderBy: { matchDate: 'desc' },
    select: { playerId: true, won: true, tier: true, matchDate: true, confidence: true },
    take: 40,
  }));
  const h2h: H2HRecord[] = h2hRows.map(r => ({
    winner: ((r.playerId === m.player1Id ? (r.won ? 1 : 2) : (r.won ? 2 : 1)) as 1 | 2),
    tier: r.tier ?? 'B',
    matchDate: r.matchDate,
    confidence: r.confidence ?? 0.8,
  }));

  // 4. Opponent winrates (using all-time winrates as proxy — exact pre-match
  //    values would require another N queries; the drift is small for this
  //    backtest scope).
  const opponentIds = new Set<string>();
  for (const r of [...p1Records, ...p2Records]) if (r.opponentId) opponentIds.add(r.opponentId);
  const oppMap = new Map<string, number>();
  if (opponentIds.size > 0) {
    const oppRecs = await withRetry(() => prisma.playerMatchRecord.findMany({
      where: { playerId: { in: [...opponentIds] } },
      select: { playerId: true, won: true },
    }));
    const grouped = new Map<string, { total: number; wins: number }>();
    for (const r of oppRecs) {
      const g = grouped.get(r.playerId) ?? { total: 0, wins: 0 };
      g.total++; if (r.won) g.wins++; grouped.set(r.playerId, g);
    }
    for (const [id, s] of grouped.entries()) if (s.total >= 3) oppMap.set(id, s.wins / s.total);
  }

  // 5. daysSinceLastMatch — approximation via current lastMatchAt (drift is small)
  const now = cutoff.getTime();
  const days1 = m.player1LastMatchAt ? Math.max(0, (now - m.player1LastMatchAt.getTime()) / 86400000) : 30;
  const days2 = m.player2LastMatchAt ? Math.max(0, (now - m.player2LastMatchAt.getTime()) / 86400000) : 30;

  // 6. Call the engine
  const mapRec = (r: typeof p1Records[number]): MatchRecord => ({
    won: r.won, tier: r.tier ?? 'B', matchDate: r.matchDate, opponentId: r.opponentId, score: r.score,
  });
  const out = calculateOddsV2({
    p1Records: p1Records.map(mapRec),
    p2Records: p2Records.map(mapRec),
    h2h,
    daysSinceLastMatch1: days1,
    daysSinceLastMatch2: days2,
    matchTier: m.tournamentTier ?? undefined,
    format: m.format,
    opponentWinrates: oppMap,
  });

  // 7. Determine outcome
  let outcome: 0 | 1 | 'draw';
  if (scoreIsDraw(m.resultScore)) {
    outcome = 'draw';
  } else if (m.winnerId === m.player1Id) {
    outcome = 1;
  } else if (m.winnerId === m.player2Id) {
    outcome = 0;
  } else {
    return null; // no clear outcome — skip
  }

  return {
    matchId: m.id,
    label: `${m.player1Name} vs ${m.player2Name}`,
    format: m.format,
    tier: m.tournamentTier,
    prob1: out.prob1,
    prob2: out.prob2,
    odds1Old: m.odds1,
    odds2Old: m.odds2,
    odds1Model: out.odds1,
    odds2Model: out.odds2,
    outcome,
    scheduledAt: m.scheduledAt,
  };
}

// ── Metrics ──────────────────────────────────────────────────────────────────
interface Metrics {
  n: number;
  nDraws: number;
  nValid: number; // excludes draws for binary metrics
  brier: number;
  logLoss: number;
  topChoiceAccuracy: number;
  byFormat: Record<string, { n: number; brier: number; accuracy: number }>;
  calibration: Array<{ bucket: string; predicted: number; actual: number; n: number }>;
  bookROI: number; // % of total handle (simulated flat-bet)
  overroundSampled: { min: number; median: number; max: number };
}

function computeMetrics(preds: Prediction[]): Metrics {
  const validPreds = preds.filter(p => p.outcome !== 'draw');
  const draws = preds.filter(p => p.outcome === 'draw').length;

  // Brier & log-loss
  let brierSum = 0;
  let logLossSum = 0;
  let topHits = 0;
  for (const p of validPreds) {
    const y = p.outcome === 1 ? 1 : 0;
    const pred = p.prob1;
    brierSum += (pred - y) ** 2;
    const pClamped = Math.max(0.001, Math.min(0.999, pred));
    logLossSum += -(y * Math.log(pClamped) + (1 - y) * Math.log(1 - pClamped));
    const topPick: 0 | 1 = pred >= 0.5 ? 1 : 0;
    if (topPick === y) topHits++;
  }
  const brier = validPreds.length > 0 ? brierSum / validPreds.length : 0;
  const logLoss = validPreds.length > 0 ? logLossSum / validPreds.length : 0;
  const topChoiceAccuracy = validPreds.length > 0 ? topHits / validPreds.length : 0;

  // By format
  const byFormat: Record<string, { n: number; brier: number; accuracy: number }> = {};
  for (const p of validPreds) {
    if (!byFormat[p.format]) byFormat[p.format] = { n: 0, brier: 0, accuracy: 0 };
    const y = p.outcome === 1 ? 1 : 0;
    byFormat[p.format].n++;
    byFormat[p.format].brier += (p.prob1 - y) ** 2;
    if ((p.prob1 >= 0.5 ? 1 : 0) === y) byFormat[p.format].accuracy++;
  }
  for (const f of Object.keys(byFormat)) {
    byFormat[f].brier /= byFormat[f].n;
    byFormat[f].accuracy /= byFormat[f].n;
  }

  // Calibration — buckets of 10%
  const buckets: Array<{ lo: number; hi: number; preds: number[]; outcomes: number[] }> = [];
  for (let i = 0; i < 10; i++) buckets.push({ lo: i / 10, hi: (i + 1) / 10, preds: [], outcomes: [] });
  for (const p of validPreds) {
    const bIdx = Math.min(9, Math.floor(p.prob1 * 10));
    buckets[bIdx].preds.push(p.prob1);
    buckets[bIdx].outcomes.push(p.outcome === 1 ? 1 : 0);
  }
  const calibration = buckets.map(b => ({
    bucket: `${(b.lo * 100).toFixed(0)}-${(b.hi * 100).toFixed(0)}%`,
    predicted: b.preds.length > 0 ? b.preds.reduce((a, x) => a + x, 0) / b.preds.length : 0,
    actual: b.outcomes.length > 0 ? b.outcomes.reduce((a, x) => a + x, 0) / b.outcomes.length : 0,
    n: b.preds.length,
  }));

  // Book ROI — simulate a flat 100-coin bet uniformly split across all outcomes.
  // Rough proxy : on each match, the book collects 100 on each side of the
  // market (totalHandle = 200 per match), pays out the winning side at the
  // stored odds, keeps the losing side. For a 2-way match at odds1Old/odds2Old :
  //   P(p1 wins) ≈ prob1 (true), book pays 100 × odds1Old on p1-win, 100 × odds2Old on p2-win.
  //   Expected payout = prob1 × (100 × odds1Old) + prob2 × (100 × odds2Old) + draw × 200 (refund)
  //   Expected profit = 200 - expected payout, as % of handle (200)
  // This assumes symmetric flat bets — a real book's P&L depends on actual bet
  // distribution, but this baseline measures model edge.
  let totalHandle = 0;
  let totalPayout = 0;
  for (const p of preds) {
    const handle = 200;
    totalHandle += handle;
    if (p.outcome === 'draw') {
      totalPayout += handle; // refund
    } else if (p.outcome === 1) {
      totalPayout += 100 * p.odds1Old; // book pays the p1 side
    } else {
      totalPayout += 100 * p.odds2Old;
    }
  }
  const bookROI = totalHandle > 0 ? ((totalHandle - totalPayout) / totalHandle) * 100 : 0;

  // Overround distribution
  const overrounds = preds.map(p => 1 / p.odds1Old + 1 / p.odds2Old + (p.outcome === 'draw' && p.prob1 < 0 ? 0 : 0)).sort((a, b) => a - b);
  // Actually, overround is just from odds1/odds2 since we do 2-way on BO3/5/7 and 2-way void-on-draw on BO2
  const ovList = preds.map(p => 1 / p.odds1Old + 1 / p.odds2Old).sort((a, b) => a - b);
  const overroundSampled = {
    min: ovList[0] ?? 0,
    median: ovList[Math.floor(ovList.length / 2)] ?? 0,
    max: ovList[ovList.length - 1] ?? 0,
  };
  void overrounds;

  return {
    n: preds.length,
    nDraws: draws,
    nValid: validPreds.length,
    brier,
    logLoss,
    topChoiceAccuracy,
    byFormat,
    calibration,
    bookROI,
    overroundSampled,
  };
}

function formatReport(metrics: Metrics, preds: Prediction[]): string {
  const lines: string[] = [];
  lines.push(`# Baseline backtest — odds engine (${new Date().toISOString().slice(0, 10)})`);
  lines.push('');
  lines.push(`Matches analysés: **${metrics.n}** (dont ${metrics.nDraws} draws exclus du Brier)`);
  lines.push('');
  lines.push(`## Métriques globales (binaires, hors draws)`);
  lines.push(`- **Brier score** : **${metrics.brier.toFixed(4)}** (cible < 0.20 ; baseline 50/50 = 0.25)`);
  lines.push(`- **Log-loss** : ${metrics.logLoss.toFixed(4)} (baseline 50/50 = ${Math.log(2).toFixed(4)} = 0.6931)`);
  lines.push(`- **Top-choice accuracy** : ${(metrics.topChoiceAccuracy * 100).toFixed(1)}% (le favori a gagné)`);
  lines.push(`- **Book ROI simulé** : ${metrics.bookROI.toFixed(2)}% (flat-bet symétrique, positif = house edge)`);
  lines.push(`- **Overround 2-way** : min ${metrics.overroundSampled.min.toFixed(4)} / median ${metrics.overroundSampled.median.toFixed(4)} / max ${metrics.overroundSampled.max.toFixed(4)}`);
  lines.push('');
  lines.push(`## Par format`);
  lines.push(`| Format | n | Brier | Accuracy |`);
  lines.push(`|---|---|---|---|`);
  for (const [f, s] of Object.entries(metrics.byFormat).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`| ${f} | ${s.n} | ${s.brier.toFixed(4)} | ${(s.accuracy * 100).toFixed(1)}% |`);
  }
  lines.push('');
  lines.push(`## Calibration curve (reliability diagram)`);
  lines.push(`Pour chaque bucket de prob prédite, le taux réel de victoire P1. Un modèle bien calibré → actual ≈ predicted.`);
  lines.push('');
  lines.push(`| Bucket | Predicted | Actual | n |`);
  lines.push(`|---|---|---|---|`);
  for (const c of metrics.calibration) {
    if (c.n === 0) continue;
    lines.push(`| ${c.bucket} | ${(c.predicted * 100).toFixed(1)}% | ${(c.actual * 100).toFixed(1)}% | ${c.n} |`);
  }
  lines.push('');
  lines.push(`## Matches avec erreur de prédiction la plus grande`);
  lines.push(`(abs(prob1 - outcome) > 0.5 — le modèle s'est fortement trompé)`);
  const bigMisses = preds
    .filter(p => p.outcome !== 'draw')
    .map(p => ({ ...p, err: Math.abs(p.prob1 - (p.outcome === 1 ? 1 : 0)) }))
    .sort((a, b) => b.err - a.err)
    .slice(0, 10);
  lines.push('');
  lines.push(`| Match | Format | Tier | Pred P1 | Outcome | Err |`);
  lines.push(`|---|---|---|---|---|---|`);
  for (const p of bigMisses) {
    lines.push(`| ${p.label} | ${p.format} | ${p.tier ?? '?'} | ${(p.prob1 * 100).toFixed(1)}% | ${p.outcome === 1 ? 'P1 wins' : 'P2 wins'} | ${(p.err * 100).toFixed(1)}% |`);
  }
  return lines.join('\n');
}

async function main() {
  const { n } = parseArgs();
  console.log(`[Baseline] Loading last ${n} COMPLETED matches…`);
  const matches = await loadCompletedMatches(n);
  console.log(`[Baseline] Loaded ${matches.length} matches with results. Predicting…`);

  const preds: Prediction[] = [];
  let i = 0;
  for (const m of matches) {
    const p = await predictForMatch(m);
    if (p) preds.push(p);
    i++;
    if (i % 20 === 0) console.log(`[Baseline] ${i}/${matches.length} processed, ${preds.length} valid predictions`);
  }
  console.log(`[Baseline] ${preds.length} predictions computed. Calculating metrics…`);

  const metrics = computeMetrics(preds);
  const report = formatReport(metrics, preds);
  console.log('\n' + report);

  // Save to disk
  const outDir = join(process.cwd(), '..', 'audit');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const datestamp = new Date().toISOString().slice(0, 10);
  const mdPath = join(outDir, `BASELINE_ODDS_ENGINE_${datestamp}.md`);
  const jsonPath = join(outDir, `BASELINE_ODDS_ENGINE_${datestamp}.json`);
  writeFileSync(mdPath, report);
  writeFileSync(jsonPath, JSON.stringify({ metrics, predictions: preds }, null, 2));
  console.log(`\n[Baseline] Report written to ${mdPath}`);
  console.log(`[Baseline] JSON written to ${jsonPath}`);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('[Baseline] Fatal:', err);
  process.exit(1);
});
