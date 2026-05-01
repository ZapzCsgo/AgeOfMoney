/**
 * Phase 2 backtest — preloads all PlayerMatchRecord in memory, then
 * replays chronologically. Much faster than the DB-per-match variant
 * which hit the pooler connection timeout.
 *
 * For each match in the measurement window, predicts V1 (heuristic) and
 * V2 (Glicko-2) side by side using PRE-match data only. No data leakage.
 *
 * Usage : SKIP_SERVER=1 DATABASE_URL='...' npx tsx scripts/backtest-phase2-v2.ts [--n=50]
 */

import { PrismaClient } from '@prisma/client';
import { calculateOddsV2, type MatchRecord, type H2HRecord } from '../src/services/oddsEngine';
import { computeUpdatedRating, DEFAULT_RATING, DEFAULT_RD, DEFAULT_VOL, type RatingTriple } from '../src/services/glicko2';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();
const SENTINEL = '__AI_ENRICHED__';

interface PmrRow {
  playerId: string;
  opponentId: string | null;
  won: boolean;
  tier: string | null;
  matchDate: Date | null;
  score: string | null;
  confidence: number | null;
}

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
}

function parseScore(score: string | null): { isDraw: boolean } {
  if (!score) return { isDraw: false };
  const m = score.match(/^\s*(\d+)\s*[-:]\s*(\d+)\s*$/);
  if (!m) return { isDraw: false };
  const a = parseInt(m[1], 10);
  const b = parseInt(m[2], 10);
  return { isDraw: a === b && a >= 1 };
}

async function main() {
  const nArg = process.argv.find(a => a.startsWith('--n='));
  const n = nArg ? parseInt(nArg.split('=')[1], 10) : 50;

  console.log(`\n🎯 Phase 2 backtest (chronological, last ${n} matches)\n`);

  console.log('[Backtest] Loading data in batches (pooler-friendly)…');
  // Batching pour éviter timeout sur les 23k+ PMR rows via le pooler
  const allPmr: PmrRow[] = [];
  const BATCH = 5000;
  for (let offset = 0; ; offset += BATCH) {
    const chunk = await prisma.playerMatchRecord.findMany({
      where: { NOT: { opponentName: SENTINEL } },
      select: { playerId: true, opponentId: true, won: true, tier: true, matchDate: true, score: true, confidence: true },
      orderBy: { id: 'asc' },
      take: BATCH,
      skip: offset,
    }).catch(async () => {
      // retry once on pooler drop
      await new Promise(r => setTimeout(r, 3000));
      return prisma.playerMatchRecord.findMany({
        where: { NOT: { opponentName: SENTINEL } },
        select: { playerId: true, opponentId: true, won: true, tier: true, matchDate: true, score: true, confidence: true },
        orderBy: { id: 'asc' },
        take: BATCH,
        skip: offset,
      });
    });
    if (chunk.length === 0) break;
    allPmr.push(...(chunk as PmrRow[]));
    console.log(`  loaded ${allPmr.length} PMR rows…`);
    if (chunk.length < BATCH) break;
  }
  const matches = await prisma.match.findMany({
    where: { status: 'COMPLETED', scheduledAt: { not: undefined } },
    include: {
      player1: { select: { id: true, name: true, lastMatchAt: true } },
      player2: { select: { id: true, name: true, lastMatchAt: true } },
      tournament: { select: { tier: true } },
    },
    orderBy: { scheduledAt: 'asc' },
  });

  console.log(`[Backtest] Loaded ${allPmr.length} PMR rows + ${matches.length} match events`);

  // Index PMR by playerId, sorted by matchDate
  const pmrByPlayer = new Map<string, PmrRow[]>();
  for (const r of allPmr) {
    const list = pmrByPlayer.get(r.playerId) ?? [];
    list.push(r as PmrRow);
    pmrByPlayer.set(r.playerId, list);
  }
  for (const list of pmrByPlayer.values()) {
    list.sort((a, b) => (a.matchDate?.getTime() ?? 0) - (b.matchDate?.getTime() ?? 0));
  }

  // Helper : filter records for player BEFORE a cutoff date
  const recordsBefore = (playerId: string, cutoff: Date): MatchRecord[] => {
    const list = pmrByPlayer.get(playerId) ?? [];
    return list
      .filter(r => !r.matchDate || r.matchDate < cutoff)
      .map(r => ({
        won: r.won,
        tier: r.tier ?? 'B',
        matchDate: r.matchDate,
        opponentId: r.opponentId,
        score: r.score,
      }));
  };

  // Helper : H2H between two players before cutoff
  const h2hBefore = (p1: string, p2: string, cutoff: Date): H2HRecord[] => {
    const l1 = pmrByPlayer.get(p1) ?? [];
    const result: H2HRecord[] = [];
    for (const r of l1) {
      if (r.opponentId !== p2) continue;
      if (r.matchDate && r.matchDate >= cutoff) continue;
      result.push({
        winner: (r.won ? 1 : 2) as 1 | 2,
        tier: r.tier ?? 'B',
        matchDate: r.matchDate,
        confidence: r.confidence ?? 0.8,
      });
    }
    return result.sort((a, b) => (b.matchDate?.getTime() ?? 0) - (a.matchDate?.getTime() ?? 0)).slice(0, 40);
  };

  // Prepare match events
  const events: MatchEvent[] = matches
    .filter(m => m.resultScore || m.winnerId)
    .map(m => ({
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
    }));

  console.log(`[Backtest] ${events.length} events with known outcome`);

  const measurementStart = Math.max(0, events.length - n);

  // Replay chronologically with Glicko-2 ratings updated in-memory
  interface RatingState extends RatingTriple { lastMatchDate: Date | null }
  const ratings = new Map<string, RatingState>();
  const getR = (id: string): RatingState =>
    ratings.get(id) ?? { rating: DEFAULT_RATING, rd: DEFAULT_RD, vol: DEFAULT_VOL, lastMatchDate: null };

  /** Bug #2 fix : RD inflation pour inactivité avant d'utiliser le rating. */
  const SCALE = 173.7178;
  const inflateRd = (s: RatingState, asOf: Date): RatingState => {
    if (!s.lastMatchDate) return s;
    const monthsIdle = Math.max(0, (asOf.getTime() - s.lastMatchDate.getTime()) / (30 * 24 * 60 * 60 * 1000));
    if (monthsIdle < 1) return s;
    const phi = s.rd / SCALE;
    const phiIdle = Math.sqrt(phi * phi + monthsIdle * s.vol * s.vol);
    return { ...s, rd: Math.min(DEFAULT_RD, phiIdle * SCALE) };
  };

  interface Pred {
    matchId: string;
    label: string;
    format: string;
    probV1: number;
    probV2: number;
    oddsV1p1: number;
    oddsV2p1: number;
    outcome: 0 | 1 | 'draw';
    p1Rating: number;
    p2Rating: number;
  }
  const predictions: Pred[] = [];

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const drawInfo = parseScore(ev.resultScore);
    let outcome: 0 | 1 | 'draw';
    if (drawInfo.isDraw) outcome = 'draw';
    else if (ev.winnerId === ev.player1Id) outcome = 1;
    else if (ev.winnerId === ev.player2Id) outcome = 0;
    else { continue; }

    // Predict if in measurement window
    if (i >= measurementStart) {
      const p1Recs = recordsBefore(ev.player1Id, ev.date);
      const p2Recs = recordsBefore(ev.player2Id, ev.date);
      if (p1Recs.length > 0 && p2Recs.length > 0) {
        const h2h = h2hBefore(ev.player1Id, ev.player2Id, ev.date);
        const now = ev.date.getTime();
        const days1 = ev.player1LastMatchAt ? Math.max(0, (now - ev.player1LastMatchAt.getTime()) / 86400000) : 30;
        const days2 = ev.player2LastMatchAt ? Math.max(0, (now - ev.player2LastMatchAt.getTime()) / 86400000) : 30;
        const r1 = inflateRd(getR(ev.player1Id), ev.date);
        const r2 = inflateRd(getR(ev.player2Id), ev.date);

        const baseInput = {
          p1Records: p1Recs, p2Records: p2Recs, h2h,
          daysSinceLastMatch1: days1, daysSinceLastMatch2: days2,
          matchTier: ev.tournamentTier ?? undefined,
          format: ev.format,
        };

        const outV1 = calculateOddsV2(baseInput);
        const outV2 = calculateOddsV2({
          ...baseInput,
          glickoRating1: r1.rating, glickoRd1: r1.rd,
          glickoRating2: r2.rating, glickoRd2: r2.rd,
        });

        predictions.push({
          matchId: ev.id,
          label: `${ev.player1Name} vs ${ev.player2Name}`,
          format: ev.format,
          probV1: outV1.prob1,
          probV2: outV2.prob1,
          oddsV1p1: outV1.odds1,
          oddsV2p1: outV2.odds1,
          outcome,
          p1Rating: r1.rating,
          p2Rating: r2.rating,
        });
      }
    }

    // Update ratings regardless (need full history for future predictions)
    const r1Pre = inflateRd(getR(ev.player1Id), ev.date);
    const r2Pre = inflateRd(getR(ev.player2Id), ev.date);
    const score1: 0 | 0.5 | 1 = drawInfo.isDraw ? 0.5 : outcome === 1 ? 1 : 0;
    const score2: 0 | 0.5 | 1 = score1 === 1 ? 0 : score1 === 0 ? 1 : 0.5;
    const r1N = computeUpdatedRating(r1Pre, [{ opponentRating: r2Pre.rating, opponentRd: r2Pre.rd, score: score1 }]);
    const r2N = computeUpdatedRating(r2Pre, [{ opponentRating: r1Pre.rating, opponentRd: r1Pre.rd, score: score2 }]);
    ratings.set(ev.player1Id, { ...r1N, lastMatchDate: ev.date });
    ratings.set(ev.player2Id, { ...r2N, lastMatchDate: ev.date });

    if ((i + 1) % 500 === 0) console.log(`  processed ${i + 1}/${events.length}`);
  }

  console.log(`\n[Backtest] ${predictions.length} predictions made`);

  // ── Compute metrics for V1 and V2 ─────────────────────────────────────
  const valid = predictions.filter(p => p.outcome !== 'draw');
  const draws = predictions.length - valid.length;

  function metrics(probKey: 'probV1' | 'probV2'): {
    brier: number; logLoss: number; accuracy: number;
    buckets: Array<{ predMean: number; actMean: number; n: number }>;
  } {
    let brierSum = 0, logLossSum = 0, hits = 0;
    const buckets: Array<{ preds: number[]; outs: number[] }> = [];
    for (let i = 0; i < 10; i++) buckets.push({ preds: [], outs: [] });

    for (const p of valid) {
      const pred = p[probKey];
      const y = p.outcome === 1 ? 1 : 0;
      brierSum += (pred - y) ** 2;
      const c = Math.max(0.001, Math.min(0.999, pred));
      logLossSum += -(y * Math.log(c) + (1 - y) * Math.log(1 - c));
      if ((pred >= 0.5 ? 1 : 0) === y) hits++;
      buckets[Math.min(9, Math.floor(pred * 10))].preds.push(pred);
      buckets[Math.min(9, Math.floor(pred * 10))].outs.push(y);
    }
    return {
      brier: brierSum / valid.length,
      logLoss: logLossSum / valid.length,
      accuracy: hits / valid.length,
      buckets: buckets.map(b => ({
        predMean: b.preds.length ? b.preds.reduce((a, x) => a + x, 0) / b.preds.length : 0,
        actMean: b.outs.length ? b.outs.reduce((a, x) => a + x, 0) / b.outs.length : 0,
        n: b.preds.length,
      })),
    };
  }

  const m1 = metrics('probV1');
  const m2 = metrics('probV2');

  console.log(`\n═══ Résultats (n=${valid.length} valides, ${draws} draws exclus) ═══\n`);
  console.log(`                V1 (heuristique)      V2 (Glicko-2)        Δ`);
  console.log(`Brier        :  ${m1.brier.toFixed(4)}                ${m2.brier.toFixed(4)}              ${(m2.brier - m1.brier).toFixed(4)}  ${m2.brier < m1.brier ? '✓ mieux' : '✗ pire'}`);
  console.log(`Log-loss     :  ${m1.logLoss.toFixed(4)}                ${m2.logLoss.toFixed(4)}              ${(m2.logLoss - m1.logLoss).toFixed(4)}  ${m2.logLoss < m1.logLoss ? '✓ mieux' : '✗ pire'}`);
  console.log(`Accuracy     :  ${(m1.accuracy * 100).toFixed(1)}%                 ${(m2.accuracy * 100).toFixed(1)}%               ${((m2.accuracy - m1.accuracy) * 100).toFixed(1)}pts  ${m2.accuracy > m1.accuracy ? '✓ mieux' : m2.accuracy < m1.accuracy ? '✗ pire' : '='}`);

  console.log(`\n── Calibration curve ──`);
  console.log(`Bucket    V1 pred   V1 act    V2 pred   V2 act    n_V1  n_V2`);
  for (let i = 0; i < 10; i++) {
    const b1 = m1.buckets[i];
    const b2 = m2.buckets[i];
    if (b1.n === 0 && b2.n === 0) continue;
    console.log(`${(i * 10).toString().padStart(2)}-${((i + 1) * 10).toString().padStart(2)}%    ${(b1.predMean * 100).toFixed(1)}%    ${(b1.actMean * 100).toFixed(1)}%    ${(b2.predMean * 100).toFixed(1)}%    ${(b2.actMean * 100).toFixed(1)}%    ${b1.n}    ${b2.n}`);
  }

  const verdict =
    m2.brier < m1.brier && m2.accuracy >= m1.accuracy
      ? '✅ V2 BETTER — consider activating ODDS_ENGINE_V2_ENABLED'
      : m2.brier > m1.brier
        ? '🔴 V2 WORSE — keep flag OFF'
        : '🟡 MIXED — inspect + larger sample';
  console.log(`\n${verdict}`);

  const outDir = join(process.cwd(), '..', 'audit');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const datestamp = new Date().toISOString().slice(0, 10);
  const jsonPath = join(outDir, `PHASE2_BACKTEST_${datestamp}.json`);
  writeFileSync(jsonPath, JSON.stringify({ v1: m1, v2: m2, predictions }, null, 2));
  console.log(`\nReport saved: ${jsonPath}`);

  await prisma.$disconnect();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
