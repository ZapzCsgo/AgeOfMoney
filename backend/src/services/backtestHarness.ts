/**
 * Backtest harness — wrapper réutilisable autour de la logique de
 * `scripts/backtest-phase3-diagnostic.ts`. Exposé en fonction pour que le
 * cron weeklyOddsEngineBacktest puisse le rappeler sans forker un process.
 *
 * Zéro side-effect sur la DB (pure lecture). Retourne les 3 configs
 * metrics + les 10 worst errors. Caller gère la persistance.
 */

import { prisma } from '../index';
import { calculateOddsV2, seriesWinProb, type MatchRecord, type H2HRecord } from './oddsEngine';
import { computeUpdatedRating, computeWinProbability as glickoWinProb, DEFAULT_RATING, DEFAULT_RD, DEFAULT_VOL, type RatingTriple } from './glicko2';

const SENTINEL = '__AI_ENRICHED__';
const SCALE = 173.7178;
const HOUSE_MARGIN = 0.09;
const MIN_ODDS = 1.05;
const MAX_ODDS = 20;

interface PmrRow {
  playerId: string;
  opponentId: string | null;
  opponentName: string;
  won: boolean;
  tier: string | null;
  matchDate: Date | null;
  score: string | null;
  confidence: number | null;
  tournamentName: string;
}

function parseScore(s: string | null): { isDraw: boolean } {
  if (!s) return { isDraw: false };
  const m = s.match(/^\s*(\d+)\s*[-:]\s*(\d+)\s*$/);
  if (!m) return { isDraw: false };
  const a = parseInt(m[1], 10); const b = parseInt(m[2], 10);
  return { isDraw: a === b && a >= 1 };
}

function v2PurProb(glickoP: number, format: string): { prob: number; odds: number } {
  let prob = seriesWinProb(glickoP, format);
  prob = Math.max(0.08, Math.min(0.92, prob));
  let odds = 1 / (prob * (1 + HOUSE_MARGIN));
  odds = Math.min(MAX_ODDS, Math.max(MIN_ODDS, Math.round(odds * 100) / 100));
  return { prob, odds };
}

export interface ConfigMetrics {
  brier: number;
  logLoss: number;
  accuracy: number;
  buckets: Array<{ predMean: number; actMean: number; n: number }>;
}

export interface WorstError {
  label: string;
  format: string;
  tier: string | null;
  date: string;
  probV1: number; probV2: number; probV2pur: number;
  outcome: 0 | 1;
  p1Name: string; p2Name: string;
  p1Rating: number; p1Rd: number;
  p2Rating: number; p2Rd: number;
  glickoP: number;
  h2hCount: number;
}

export interface BacktestResult {
  n: number;
  datestamp: string;
  v1: ConfigMetrics;
  v2: ConfigMetrics;
  v2pur: ConfigMetrics;
  worst: WorstError[];
}

export async function runDiagnosticBacktest(limitLastN = 50): Promise<BacktestResult> {
  // Load PMR in batches (pooler-friendly)
  const allPmr: PmrRow[] = [];
  const BATCH = 5000;
  for (let offset = 0; ; offset += BATCH) {
    const chunk = await prisma.playerMatchRecord.findMany({
      where: { NOT: { opponentName: SENTINEL } },
      select: {
        playerId: true, opponentId: true, opponentName: true, won: true, tier: true,
        matchDate: true, score: true, confidence: true, tournamentName: true,
      },
      orderBy: { id: 'asc' }, take: BATCH, skip: offset,
    }).catch(async () => {
      await new Promise(r => setTimeout(r, 3000));
      return prisma.playerMatchRecord.findMany({
        where: { NOT: { opponentName: SENTINEL } },
        select: {
          playerId: true, opponentId: true, opponentName: true, won: true, tier: true,
          matchDate: true, score: true, confidence: true, tournamentName: true,
        },
        orderBy: { id: 'asc' }, take: BATCH, skip: offset,
      });
    });
    if (chunk.length === 0) break;
    allPmr.push(...(chunk as PmrRow[]));
    if (chunk.length < BATCH) break;
  }

  const matches = await prisma.match.findMany({
    where: { status: 'COMPLETED', scheduledAt: { not: undefined } },
    include: {
      player1: { select: { id: true, name: true, lastMatchAt: true } },
      player2: { select: { id: true, name: true, lastMatchAt: true } },
      tournament: { select: { tier: true, name: true } },
    },
    orderBy: { scheduledAt: 'asc' },
  });

  const pmrByPlayer = new Map<string, PmrRow[]>();
  for (const r of allPmr) {
    const list = pmrByPlayer.get(r.playerId) ?? [];
    list.push(r); pmrByPlayer.set(r.playerId, list);
  }
  for (const list of pmrByPlayer.values()) {
    list.sort((a, b) => (a.matchDate?.getTime() ?? 0) - (b.matchDate?.getTime() ?? 0));
  }

  const recordsBefore = (pid: string, cutoff: Date): MatchRecord[] => {
    const list = pmrByPlayer.get(pid) ?? [];
    return list.filter(r => !r.matchDate || r.matchDate < cutoff)
      .map(r => ({ won: r.won, tier: r.tier ?? 'B', matchDate: r.matchDate, opponentId: r.opponentId, score: r.score }));
  };
  const h2hBefore = (p1: string, p2: string, cutoff: Date): H2HRecord[] => {
    const l1 = pmrByPlayer.get(p1) ?? [];
    const res: H2HRecord[] = [];
    for (const r of l1) {
      if (r.opponentId !== p2) continue;
      if (r.matchDate && r.matchDate >= cutoff) continue;
      res.push({ winner: (r.won ? 1 : 2) as 1 | 2, tier: r.tier ?? 'B', matchDate: r.matchDate, confidence: r.confidence ?? 0.8 });
    }
    return res.sort((a, b) => (b.matchDate?.getTime() ?? 0) - (a.matchDate?.getTime() ?? 0)).slice(0, 40);
  };

  const events = matches
    .filter(m => m.resultScore || m.winnerId)
    .map(m => ({
      id: m.id, date: m.scheduledAt,
      player1Id: m.player1Id, player2Id: m.player2Id,
      player1Name: m.player1.name, player2Name: m.player2.name,
      winnerId: m.winnerId, resultScore: m.resultScore,
      format: m.format, tournamentTier: m.tournament?.tier ?? null,
      player1LastMatchAt: m.player1.lastMatchAt, player2LastMatchAt: m.player2.lastMatchAt,
    }));

  const measurementStart = Math.max(0, events.length - limitLastN);

  interface RatingState extends RatingTriple { lastMatchDate: Date | null }
  const ratings = new Map<string, RatingState>();
  const getR = (id: string): RatingState =>
    ratings.get(id) ?? { rating: DEFAULT_RATING, rd: DEFAULT_RD, vol: DEFAULT_VOL, lastMatchDate: null };
  const inflateRd = (s: RatingState, asOf: Date): RatingState => {
    if (!s.lastMatchDate) return s;
    const monthsIdle = Math.max(0, (asOf.getTime() - s.lastMatchDate.getTime()) / (30 * 24 * 60 * 60 * 1000));
    if (monthsIdle < 1) return s;
    const phi = s.rd / SCALE;
    const phiIdle = Math.sqrt(phi * phi + monthsIdle * s.vol * s.vol);
    return { ...s, rd: Math.min(DEFAULT_RD, phiIdle * SCALE) };
  };

  interface Pred {
    matchId: string; label: string; format: string; tier: string | null; date: Date;
    probV1: number; probV2: number; probV2pur: number;
    oddsV1: number; oddsV2: number; oddsV2pur: number;
    outcome: 0 | 1;
    p1Name: string; p2Name: string; p1Id: string; p2Id: string;
    p1Rating: number; p1Rd: number; p2Rating: number; p2Rd: number;
    glickoP: number; h2hCount: number;
  }
  const predictions: Pred[] = [];

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const drawInfo = parseScore(ev.resultScore);
    let outcome: 0 | 1 | null;
    if (drawInfo.isDraw) outcome = null;
    else if (ev.winnerId === ev.player1Id) outcome = 1;
    else if (ev.winnerId === ev.player2Id) outcome = 0;
    else outcome = null;

    if (i >= measurementStart && outcome !== null) {
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
        const glickoP = glickoWinProb(r1.rating, r1.rd, r2.rating, r2.rd);
        const { prob: probV2pur, odds: oddsV2pur } = v2PurProb(glickoP, ev.format);

        predictions.push({
          matchId: ev.id, label: `${ev.player1Name} vs ${ev.player2Name}`,
          format: ev.format, tier: ev.tournamentTier, date: ev.date,
          probV1: outV1.prob1, probV2: outV2.prob1, probV2pur,
          oddsV1: outV1.odds1, oddsV2: outV2.odds1, oddsV2pur,
          outcome,
          p1Name: ev.player1Name, p2Name: ev.player2Name,
          p1Id: ev.player1Id, p2Id: ev.player2Id,
          p1Rating: r1.rating, p1Rd: r1.rd, p2Rating: r2.rating, p2Rd: r2.rd,
          glickoP, h2hCount: h2h.length,
        });
      }
    }

    const r1Pre = inflateRd(getR(ev.player1Id), ev.date);
    const r2Pre = inflateRd(getR(ev.player2Id), ev.date);
    const score1: 0 | 0.5 | 1 = drawInfo.isDraw ? 0.5 : outcome === 1 ? 1 : outcome === 0 ? 0 : 0.5;
    if (outcome === null && !drawInfo.isDraw) continue;
    const score2: 0 | 0.5 | 1 = score1 === 1 ? 0 : score1 === 0 ? 1 : 0.5;
    const r1N = computeUpdatedRating(r1Pre, [{ opponentRating: r2Pre.rating, opponentRd: r2Pre.rd, score: score1 }]);
    const r2N = computeUpdatedRating(r2Pre, [{ opponentRating: r1Pre.rating, opponentRd: r1Pre.rd, score: score2 }]);
    ratings.set(ev.player1Id, { ...r1N, lastMatchDate: ev.date });
    ratings.set(ev.player2Id, { ...r2N, lastMatchDate: ev.date });
  }

  function metrics(key: 'probV1' | 'probV2' | 'probV2pur'): ConfigMetrics {
    if (predictions.length === 0) return { brier: 0, logLoss: 0, accuracy: 0, buckets: [] };
    let brierSum = 0, logLossSum = 0, hits = 0;
    const buckets: Array<{ preds: number[]; outs: number[] }> = [];
    for (let i = 0; i < 10; i++) buckets.push({ preds: [], outs: [] });
    for (const p of predictions) {
      const pred = p[key]; const y = p.outcome;
      brierSum += (pred - y) ** 2;
      const c = Math.max(0.001, Math.min(0.999, pred));
      logLossSum += -(y * Math.log(c) + (1 - y) * Math.log(1 - c));
      if ((pred >= 0.5 ? 1 : 0) === y) hits++;
      const b = Math.min(9, Math.floor(pred * 10));
      buckets[b].preds.push(pred); buckets[b].outs.push(y);
    }
    return {
      brier: brierSum / predictions.length,
      logLoss: logLossSum / predictions.length,
      accuracy: hits / predictions.length,
      buckets: buckets.map(b => ({
        predMean: b.preds.length ? b.preds.reduce((a, x) => a + x, 0) / b.preds.length : 0,
        actMean: b.outs.length ? b.outs.reduce((a, x) => a + x, 0) / b.outs.length : 0,
        n: b.preds.length,
      })),
    };
  }

  const worst: WorstError[] = [...predictions]
    .map(p => ({ p, err: Math.abs(p.probV2 - p.outcome) }))
    .sort((a, b) => b.err - a.err)
    .slice(0, 10)
    .map(({ p }) => ({
      label: p.label, format: p.format, tier: p.tier, date: p.date.toISOString().slice(0, 10),
      probV1: p.probV1, probV2: p.probV2, probV2pur: p.probV2pur,
      outcome: p.outcome,
      p1Name: p.p1Name, p2Name: p.p2Name,
      p1Rating: p.p1Rating, p1Rd: p.p1Rd,
      p2Rating: p.p2Rating, p2Rd: p.p2Rd,
      glickoP: p.glickoP, h2hCount: p.h2hCount,
    }));

  return {
    n: predictions.length,
    datestamp: new Date().toISOString().slice(0, 10),
    v1: metrics('probV1'),
    v2: metrics('probV2'),
    v2pur: metrics('probV2pur'),
    worst,
  };
}

export function formatBacktestMarkdown(r: BacktestResult): string {
  const lines: string[] = [];
  lines.push(`# Weekly odds-engine backtest — ${r.datestamp}`);
  lines.push('');
  lines.push(`N = ${r.n} predictions valides.`);
  lines.push('');
  lines.push(`| Config | Brier | Log-loss | Accuracy |`);
  lines.push(`|---|---|---|---|`);
  lines.push(`| A V1 blended (prod) | ${r.v1.brier.toFixed(4)} | ${r.v1.logLoss.toFixed(4)} | ${(r.v1.accuracy * 100).toFixed(1)}% |`);
  lines.push(`| B V2 blended (Glicko dans blend) | ${r.v2.brier.toFixed(4)} | ${r.v2.logLoss.toFixed(4)} | ${(r.v2.accuracy * 100).toFixed(1)}% |`);
  lines.push(`| C V2 pur (Glicko seul) | ${r.v2pur.brier.toFixed(4)} | ${r.v2pur.logLoss.toFixed(4)} | ${(r.v2pur.accuracy * 100).toFixed(1)}% |`);
  lines.push('');
  lines.push(`## Top 10 worst V2 errors`);
  lines.push('');
  for (const w of r.worst) {
    const result = w.outcome === 1 ? w.p1Name : w.p2Name;
    lines.push(`- **${w.label}** (${w.format}, tier ${w.tier ?? '?'}, ${w.date}) — V2=${(w.probV2 * 100).toFixed(0)}%, réel=${result} gagne`);
    lines.push(`  - Glicko ratings : ${w.p1Name} ${w.p1Rating.toFixed(0)}±${w.p1Rd.toFixed(0)} vs ${w.p2Name} ${w.p2Rating.toFixed(0)}±${w.p2Rd.toFixed(0)}`);
  }
  return lines.join('\n');
}
