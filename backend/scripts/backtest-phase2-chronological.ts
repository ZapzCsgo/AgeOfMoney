/**
 * Phase 2 backtest — chronological, no data leakage.
 *
 * Pour chaque match, on :
 *   1. Replay tous les matches antérieurs chronologiquement pour reconstruire
 *      les ratings Glicko AU MOMENT du match (pre-match snapshot).
 *   2. Demande à calculateOddsV2 une prédiction avec ces ratings pre-match.
 *   3. Compare au résultat réel, accumule Brier/log-loss/accuracy.
 *   4. Puis APPLIQUE le résultat pour mettre à jour les ratings (prochain match
 *      utilisera le rating post-ce-match).
 *
 * Pas de data leakage : les ratings utilisés pour prédire le match N ne
 * contiennent jamais l'information du match N lui-même.
 *
 * Usage : SKIP_SERVER=1 DATABASE_URL='...' npx tsx scripts/backtest-phase2-chronological.ts [--n=50] [--v1|--v2]
 */

import { PrismaClient } from '@prisma/client';
import { calculateOddsV2, type MatchRecord, type H2HRecord } from '../src/services/oddsEngine';
import { computeUpdatedRating, DEFAULT_RATING, DEFAULT_RD, DEFAULT_VOL, type RatingTriple } from '../src/services/glicko2';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();
const SENTINEL = '__AI_ENRICHED__';

interface MatchEvent {
  id: string;
  date: Date;
  player1Id: string;
  player2Id: string;
  player1Name: string;
  player2Name: string;
  winnerId: string | null;
  resultScore: string | null;
  format: string;
  tournamentTier: string | null;
  player1LastMatchAt: Date | null;
  player2LastMatchAt: Date | null;
  source: 'platform' | 'pmr';
}

function parseScore(score: string | null): { p1: number; p2: number; isDraw: boolean } {
  if (!score) return { p1: 0, p2: 0, isDraw: false };
  const m = score.match(/^\s*(\d+)\s*[-:]\s*(\d+)\s*$/);
  if (!m) return { p1: 0, p2: 0, isDraw: false };
  const a = parseInt(m[1], 10);
  const b = parseInt(m[2], 10);
  return { p1: a, p2: b, isDraw: a === b && a >= 1 };
}

async function collectMatchEvents(): Promise<MatchEvent[]> {
  const events: MatchEvent[] = [];

  const platform = await prisma.match.findMany({
    where: { status: 'COMPLETED', scheduledAt: { not: undefined } },
    include: {
      player1: { select: { id: true, name: true, lastMatchAt: true } },
      player2: { select: { id: true, name: true, lastMatchAt: true } },
      tournament: { select: { tier: true } },
    },
    orderBy: { scheduledAt: 'asc' },
  });

  for (const m of platform) {
    if (!m.resultScore && !m.winnerId) continue;
    events.push({
      id: m.id,
      date: m.scheduledAt,
      player1Id: m.player1Id,
      player2Id: m.player2Id,
      player1Name: m.player1.name,
      player2Name: m.player2.name,
      winnerId: m.winnerId,
      resultScore: m.resultScore,
      format: m.format,
      tournamentTier: m.tournament?.tier ?? null,
      player1LastMatchAt: m.player1.lastMatchAt,
      player2LastMatchAt: m.player2.lastMatchAt,
      source: 'platform',
    });
  }

  return events.sort((a, b) => a.date.getTime() - b.date.getTime());
}

async function loadPlayerRecordsBeforeDate(playerId: string, cutoff: Date): Promise<MatchRecord[]> {
  const rows = await prisma.playerMatchRecord.findMany({
    where: {
      playerId,
      NOT: { opponentName: SENTINEL },
      OR: [{ matchDate: null }, { matchDate: { lt: cutoff } }],
    },
    select: { won: true, tier: true, matchDate: true, opponentId: true, score: true },
  });
  return rows.map(r => ({
    won: r.won, tier: r.tier ?? 'B', matchDate: r.matchDate,
    opponentId: r.opponentId, score: r.score,
  }));
}

async function loadH2HBeforeDate(p1: string, p2: string, cutoff: Date): Promise<H2HRecord[]> {
  const rows = await prisma.playerMatchRecord.findMany({
    where: {
      NOT: { opponentName: SENTINEL },
      OR: [
        { playerId: p1, opponentId: p2 },
        { playerId: p2, opponentId: p1 },
      ],
      AND: [{ OR: [{ matchDate: null }, { matchDate: { lt: cutoff } }] }],
    },
    select: { playerId: true, won: true, tier: true, matchDate: true, confidence: true },
    orderBy: { matchDate: 'desc' },
    take: 40,
  });
  return rows.map(r => ({
    winner: ((r.playerId === p1 ? (r.won ? 1 : 2) : (r.won ? 2 : 1)) as 1 | 2),
    tier: r.tier ?? 'B',
    matchDate: r.matchDate,
    confidence: r.confidence ?? 0.8,
  }));
}

interface Prediction {
  matchId: string;
  label: string;
  format: string;
  prob1: number;
  odds1: number;
  odds2: number;
  outcome: 0 | 1 | 'draw';
  p1Rating: number;
  p2Rating: number;
}

async function runBacktest(v2: boolean, limitLastN: number) {
  const ratings = new Map<string, RatingTriple>();
  const getRating = (id: string): RatingTriple =>
    ratings.get(id) ?? { rating: DEFAULT_RATING, rd: DEFAULT_RD, vol: DEFAULT_VOL };

  console.log(`[Backtest] Loading all match events…`);
  const events = await collectMatchEvents();
  console.log(`[Backtest] ${events.length} events. Running chronological replay…`);

  const predictions: Prediction[] = [];
  const startPredictingAt = Math.max(0, events.length - limitLastN);

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const drawInfo = parseScore(ev.resultScore);

    // Predict this match (if we're in the "measurement window")
    if (i >= startPredictingAt) {
      const [p1Recs, p2Recs, h2h] = await Promise.all([
        loadPlayerRecordsBeforeDate(ev.player1Id, ev.date),
        loadPlayerRecordsBeforeDate(ev.player2Id, ev.date),
        loadH2HBeforeDate(ev.player1Id, ev.player2Id, ev.date),
      ]);

      if (p1Recs.length > 0 && p2Recs.length > 0) {
        const now = ev.date.getTime();
        const days1 = ev.player1LastMatchAt ? Math.max(0, (now - ev.player1LastMatchAt.getTime()) / 86400000) : 30;
        const days2 = ev.player2LastMatchAt ? Math.max(0, (now - ev.player2LastMatchAt.getTime()) / 86400000) : 30;

        const r1 = getRating(ev.player1Id);
        const r2 = getRating(ev.player2Id);

        const out = calculateOddsV2({
          p1Records: p1Recs,
          p2Records: p2Recs,
          h2h,
          daysSinceLastMatch1: days1,
          daysSinceLastMatch2: days2,
          matchTier: ev.tournamentTier ?? undefined,
          format: ev.format,
          glickoRating1: v2 ? r1.rating : undefined,
          glickoRd1: v2 ? r1.rd : undefined,
          glickoRating2: v2 ? r2.rating : undefined,
          glickoRd2: v2 ? r2.rd : undefined,
        });

        let outcome: 0 | 1 | 'draw';
        if (drawInfo.isDraw) outcome = 'draw';
        else if (ev.winnerId === ev.player1Id) outcome = 1;
        else if (ev.winnerId === ev.player2Id) outcome = 0;
        else continue;

        predictions.push({
          matchId: ev.id,
          label: `${ev.player1Name} vs ${ev.player2Name}`,
          format: ev.format,
          prob1: out.prob1,
          odds1: out.odds1,
          odds2: out.odds2,
          outcome,
          p1Rating: r1.rating,
          p2Rating: r2.rating,
        });
      }
    }

    // Update Glicko ratings from this match's outcome (for next iterations)
    const r1 = getRating(ev.player1Id);
    const r2 = getRating(ev.player2Id);
    let score1: 0 | 0.5 | 1;
    if (drawInfo.isDraw) score1 = 0.5;
    else if (ev.winnerId === ev.player1Id) score1 = 1;
    else if (ev.winnerId === ev.player2Id) score1 = 0;
    else continue;

    const r1New = computeUpdatedRating(r1, [{ opponentRating: r2.rating, opponentRd: r2.rd, score: score1 }]);
    const score2: 0 | 0.5 | 1 = score1 === 1 ? 0 : score1 === 0 ? 1 : 0.5;
    const r2New = computeUpdatedRating(r2, [{ opponentRating: r1.rating, opponentRd: r1.rd, score: score2 }]);
    ratings.set(ev.player1Id, r1New);
    ratings.set(ev.player2Id, r2New);

    if ((i + 1) % 500 === 0) process.stdout.write(`  ${i + 1}/${events.length}\r`);
  }

  console.log(`\n[Backtest] ${predictions.length} predictions made (last ${limitLastN} matches)`);
  return predictions;
}

function computeMetrics(preds: Prediction[], label: string) {
  const valid = preds.filter(p => p.outcome !== 'draw');
  const draws = preds.filter(p => p.outcome === 'draw').length;

  let brierSum = 0, logLossSum = 0, topHits = 0;
  for (const p of valid) {
    const y = p.outcome === 1 ? 1 : 0;
    brierSum += (p.prob1 - y) ** 2;
    const c = Math.max(0.001, Math.min(0.999, p.prob1));
    logLossSum += -(y * Math.log(c) + (1 - y) * Math.log(1 - c));
    if ((p.prob1 >= 0.5 ? 1 : 0) === y) topHits++;
  }
  const brier = valid.length > 0 ? brierSum / valid.length : 0;
  const logLoss = valid.length > 0 ? logLossSum / valid.length : 0;
  const accuracy = valid.length > 0 ? topHits / valid.length : 0;

  // Calibration
  const buckets: Array<{ preds: number[]; outs: number[] }> = [];
  for (let i = 0; i < 10; i++) buckets.push({ preds: [], outs: [] });
  for (const p of valid) {
    const b = Math.min(9, Math.floor(p.prob1 * 10));
    buckets[b].preds.push(p.prob1);
    buckets[b].outs.push(p.outcome === 1 ? 1 : 0);
  }

  console.log(`\n── ${label} ──`);
  console.log(`  n=${preds.length} (${draws} draws excluded) → ${valid.length} valid`);
  console.log(`  Brier       : ${brier.toFixed(4)}`);
  console.log(`  Log-loss    : ${logLoss.toFixed(4)}`);
  console.log(`  Top-choice  : ${(accuracy * 100).toFixed(1)}%`);
  console.log(`  Calibration :`);
  for (let i = 0; i < 10; i++) {
    const b = buckets[i];
    if (b.preds.length === 0) continue;
    const predMean = b.preds.reduce((a, x) => a + x, 0) / b.preds.length;
    const actMean = b.outs.reduce((a, x) => a + x, 0) / b.outs.length;
    console.log(`    ${(i * 10).toString().padStart(2)}-${((i + 1) * 10).toString().padStart(2)}%  pred=${(predMean * 100).toFixed(1)}%  actual=${(actMean * 100).toFixed(1)}%  n=${b.preds.length}`);
  }
  return { brier, logLoss, accuracy, n: valid.length, draws, buckets, preds };
}

async function main() {
  const nArg = process.argv.find(a => a.startsWith('--n='));
  const n = nArg ? parseInt(nArg.split('=')[1], 10) : 50;

  console.log(`\n🎯 Phase 2 backtest (last ${n} matches, chronological replay)\n`);

  const v1 = await runBacktest(false, n);
  const v2 = await runBacktest(true, n);

  const m1 = computeMetrics(v1, 'V1 (WR heuristique)');
  const m2 = computeMetrics(v2, 'V2 (Glicko-2)');

  console.log('\n═══ Résumé comparatif ═══');
  console.log(`              V1            V2            Δ`);
  console.log(`Brier      : ${m1.brier.toFixed(4)}        ${m2.brier.toFixed(4)}        ${(m2.brier - m1.brier).toFixed(4)}`);
  console.log(`Log-loss   : ${m1.logLoss.toFixed(4)}        ${m2.logLoss.toFixed(4)}        ${(m2.logLoss - m1.logLoss).toFixed(4)}`);
  console.log(`Accuracy   : ${(m1.accuracy * 100).toFixed(1)}%         ${(m2.accuracy * 100).toFixed(1)}%         ${((m2.accuracy - m1.accuracy) * 100).toFixed(1)}pts`);

  const verdict = m2.brier < m1.brier && m2.accuracy > m1.accuracy
    ? '✅ V2 BETTER — consider activating ODDS_ENGINE_V2_ENABLED'
    : m2.brier > m1.brier ? '🔴 V2 WORSE — keep flag OFF'
    : '🟡 MIXED — needs larger sample';
  console.log(`\n${verdict}`);

  // Save JSON report
  const outDir = join(process.cwd(), '..', 'audit');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const datestamp = new Date().toISOString().slice(0, 10);
  const jsonPath = join(outDir, `PHASE2_BACKTEST_${datestamp}.json`);
  writeFileSync(jsonPath, JSON.stringify({ v1: m1, v2: m2 }, null, 2));
  console.log(`\nReport saved: ${jsonPath}`);

  await prisma.$disconnect();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
