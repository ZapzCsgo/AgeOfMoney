/**
 * Phase 3 diagnostic — 3-config backtest (V1 / V2 blended / V2 pur) +
 * dump des 10 pires erreurs V2 pour analyse qualitative.
 *
 * AUCUN changement en prod. Pure lecture, calculs locaux. Écrit un
 * markdown audit/PHASE3_DIAGNOSTIC_2026-04-19.md.
 *
 * Usage : DATABASE_URL='...' npx tsx scripts/backtest-phase3-diagnostic.ts [--n=50]
 */

import { PrismaClient } from '@prisma/client';
import { calculateOddsV2, seriesWinProb, type MatchRecord, type H2HRecord } from '../src/services/oddsEngine';
import { computeUpdatedRating, computeWinProbability as glickoWinProb, DEFAULT_RATING, DEFAULT_RD, DEFAULT_VOL, type RatingTriple } from '../src/services/glicko2';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();
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
  tournamentName: string | null;
  player1LastMatchAt: Date | null;
  player2LastMatchAt: Date | null;
}

function parseScore(s: string | null): { isDraw: boolean } {
  if (!s) return { isDraw: false };
  const m = s.match(/^\s*(\d+)\s*[-:]\s*(\d+)\s*$/);
  if (!m) return { isDraw: false };
  const a = parseInt(m[1], 10); const b = parseInt(m[2], 10);
  return { isDraw: a === b && a >= 1 };
}

/** V2 pur : seriesWinProb(glickoP, format) → clamps → margin */
function v2PurProb(glickoP: number, format: string): { prob: number; odds: number } {
  let prob = seriesWinProb(glickoP, format);
  // Apply same confidence cap as engine at "excellent data" level
  prob = Math.max(0.08, Math.min(0.92, prob));
  let odds = 1 / (prob * (1 + HOUSE_MARGIN));
  odds = Math.min(MAX_ODDS, Math.max(MIN_ODDS, Math.round(odds * 100) / 100));
  return { prob, odds };
}

async function main() {
  const nArg = process.argv.find(a => a.startsWith('--n='));
  const n = nArg ? parseInt(nArg.split('=')[1], 10) : 50;

  console.log(`[Diag] Loading data in batches…`);
  const allPmr: PmrRow[] = [];
  const BATCH = 5000;
  for (let offset = 0; ; offset += BATCH) {
    const chunk = await prisma.playerMatchRecord.findMany({
      where: { NOT: { opponentName: SENTINEL } },
      select: {
        playerId: true, opponentId: true, opponentName: true, won: true, tier: true,
        matchDate: true, score: true, confidence: true, tournamentName: true,
      },
      orderBy: { id: 'asc' },
      take: BATCH,
      skip: offset,
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
    console.log(`  ${allPmr.length} PMR rows`);
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

  console.log(`[Diag] ${allPmr.length} PMR + ${matches.length} matches`);

  // Index PMR by playerId
  const pmrByPlayer = new Map<string, PmrRow[]>();
  for (const r of allPmr) {
    const list = pmrByPlayer.get(r.playerId) ?? [];
    list.push(r);
    pmrByPlayer.set(r.playerId, list);
  }
  for (const list of pmrByPlayer.values()) {
    list.sort((a, b) => (a.matchDate?.getTime() ?? 0) - (b.matchDate?.getTime() ?? 0));
  }

  const recordsBefore = (pid: string, cutoff: Date): MatchRecord[] => {
    const list = pmrByPlayer.get(pid) ?? [];
    return list
      .filter(r => !r.matchDate || r.matchDate < cutoff)
      .map(r => ({ won: r.won, tier: r.tier ?? 'B', matchDate: r.matchDate, opponentId: r.opponentId, score: r.score }));
  };

  const h2hBefore = (p1: string, p2: string, cutoff: Date): H2HRecord[] => {
    const l1 = pmrByPlayer.get(p1) ?? [];
    const result: H2HRecord[] = [];
    for (const r of l1) {
      if (r.opponentId !== p2) continue;
      if (r.matchDate && r.matchDate >= cutoff) continue;
      result.push({
        winner: (r.won ? 1 : 2) as 1 | 2,
        tier: r.tier ?? 'B', matchDate: r.matchDate, confidence: r.confidence ?? 0.8,
      });
    }
    return result.sort((a, b) => (b.matchDate?.getTime() ?? 0) - (a.matchDate?.getTime() ?? 0)).slice(0, 40);
  };

  const events: MatchEvent[] = matches
    .filter(m => m.resultScore || m.winnerId)
    .map(m => ({
      id: m.id, date: m.scheduledAt,
      player1Id: m.player1Id, player2Id: m.player2Id,
      player1Name: m.player1.name, player2Name: m.player2.name,
      winnerId: m.winnerId, resultScore: m.resultScore,
      format: m.format, tournamentTier: m.tournament?.tier ?? null,
      tournamentName: m.tournament?.name ?? null,
      player1LastMatchAt: m.player1.lastMatchAt, player2LastMatchAt: m.player2.lastMatchAt,
    }));

  const measurementStart = Math.max(0, events.length - n);

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
    matchId: string;
    label: string;
    format: string;
    tier: string | null;
    tournamentName: string | null;
    date: Date;
    probV1: number;
    probV2: number;
    probV2pur: number;
    oddsV1: number;
    oddsV2: number;
    oddsV2pur: number;
    outcome: 0 | 1;
    p1Name: string;
    p2Name: string;
    p1Id: string;
    p2Id: string;
    p1Rating: number;
    p1Rd: number;
    p2Rating: number;
    p2Rd: number;
    glickoP: number;
    h2hCount: number;
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
          format: ev.format, tier: ev.tournamentTier, tournamentName: ev.tournamentName, date: ev.date,
          probV1: outV1.prob1, probV2: outV2.prob1, probV2pur,
          oddsV1: outV1.odds1, oddsV2: outV2.odds1, oddsV2pur,
          outcome, p1Name: ev.player1Name, p2Name: ev.player2Name,
          p1Id: ev.player1Id, p2Id: ev.player2Id,
          p1Rating: r1.rating, p1Rd: r1.rd, p2Rating: r2.rating, p2Rd: r2.rd,
          glickoP, h2hCount: h2h.length,
        });
      }
    }

    // update ratings for next iter
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

  console.log(`[Diag] ${predictions.length} predictions valid\n`);

  // ── Compute metrics for 3 configs ──────────────────────────────────────
  function metrics(key: 'probV1' | 'probV2' | 'probV2pur') {
    let brierSum = 0, logLossSum = 0, hits = 0;
    const buckets: Array<{ preds: number[]; outs: number[] }> = [];
    for (let i = 0; i < 10; i++) buckets.push({ preds: [], outs: [] });
    for (const p of predictions) {
      const pred = p[key];
      const y = p.outcome;
      brierSum += (pred - y) ** 2;
      const c = Math.max(0.001, Math.min(0.999, pred));
      logLossSum += -(y * Math.log(c) + (1 - y) * Math.log(1 - c));
      if ((pred >= 0.5 ? 1 : 0) === y) hits++;
      const b = Math.min(9, Math.floor(pred * 10));
      buckets[b].preds.push(pred);
      buckets[b].outs.push(y);
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

  const mV1 = metrics('probV1');
  const mV2 = metrics('probV2');
  const mV2pur = metrics('probV2pur');

  // ── Worst V2 errors ─────────────────────────────────────────────────────
  const worst = [...predictions]
    .map(p => ({ ...p, errV2: Math.abs(p.probV2 - p.outcome) }))
    .sort((a, b) => b.errV2 - a.errV2)
    .slice(0, 10);

  // Last 5 matches of each player in the worst list
  const playerLastMatches = new Map<string, Array<{ date: string; opp: string; tier: string; won: boolean; score: string | null }>>();
  for (const w of worst) {
    for (const pid of [w.p1Id, w.p2Id]) {
      if (playerLastMatches.has(`${pid}|${w.date.toISOString()}`)) continue;
      const last5 = (pmrByPlayer.get(pid) ?? [])
        .filter(r => r.matchDate && r.matchDate < w.date)
        .slice(-5)
        .map(r => ({
          date: r.matchDate!.toISOString().slice(0, 10),
          opp: r.opponentName,
          tier: r.tier ?? '?',
          won: r.won,
          score: r.score,
        }));
      playerLastMatches.set(`${pid}|${w.date.toISOString()}`, last5);
    }
  }

  // ── Generate markdown ──────────────────────────────────────────────────
  const lines: string[] = [];
  lines.push(`# Phase 3 Glicko — diagnostic (2026-04-19)`);
  lines.push('');
  lines.push(`N = ${predictions.length} predictions valides (hors draws).`);
  lines.push('');
  lines.push('## 1. Comparaison 3 configs');
  lines.push('');
  lines.push('| Config | Brier | Log-loss | Accuracy |');
  lines.push('|---|---|---|---|');
  lines.push(`| **A — V1 blended** (prod actuel) | ${mV1.brier.toFixed(4)} | ${mV1.logLoss.toFixed(4)} | ${(mV1.accuracy * 100).toFixed(1)}% |`);
  lines.push(`| **B — V2 blended** (Glicko dans le blend) | ${mV2.brier.toFixed(4)} | ${mV2.logLoss.toFixed(4)} | ${(mV2.accuracy * 100).toFixed(1)}% |`);
  lines.push(`| **C — V2 pur** (Glicko seul + binomiale) | ${mV2pur.brier.toFixed(4)} | ${mV2pur.logLoss.toFixed(4)} | ${(mV2pur.accuracy * 100).toFixed(1)}% |`);
  lines.push('');

  const bestConfig = [
    { name: 'A (V1)', brier: mV1.brier, acc: mV1.accuracy },
    { name: 'B (V2 blended)', brier: mV2.brier, acc: mV2.accuracy },
    { name: 'C (V2 pur)', brier: mV2pur.brier, acc: mV2pur.accuracy },
  ].sort((a, b) => a.brier - b.brier)[0];

  lines.push(`**Meilleur Brier** : ${bestConfig.name}`);
  lines.push('');

  // Verdict automatique
  const deltaCvsB = mV2pur.brier - mV2.brier;
  const deltaCvsA = mV2pur.brier - mV1.brier;
  let verdict1: string;
  if (mV2pur.brier < mV2.brier - 0.005) {
    verdict1 = `🟢 **C < B** de ${Math.abs(deltaCvsB).toFixed(4)} → le blending POLLUE Glicko. Tuner form/H2H quand Glicko dispo.`;
  } else if (mV2pur.brier > mV2.brier + 0.005) {
    verdict1 = `🔴 **C > B** de ${deltaCvsB.toFixed(4)} → Glicko a besoin du blending, il manque quelque chose seul.`;
  } else {
    verdict1 = `🟡 **C ≈ B** (Δ ${deltaCvsB.toFixed(4)}) → le blending n'aide ni ne nuit à Glicko.`;
  }
  lines.push(`### Verdict config C vs B`);
  lines.push(verdict1);
  lines.push('');

  let verdict2: string;
  if (mV2pur.brier < mV1.brier - 0.02) {
    verdict2 = `🟢 **C bat V1** de ${Math.abs(deltaCvsA).toFixed(4)} — Glicko pur domine. Considérer activation progressive.`;
  } else if (mV2pur.brier > mV1.brier + 0.02) {
    verdict2 = `🔴 **C pire que V1** de ${deltaCvsA.toFixed(4)} — Glicko pur n'est pas prêt.`;
  } else {
    verdict2 = `🟡 **C ≈ V1** (Δ ${deltaCvsA.toFixed(4)}) — pas de gain clair, pas de perte claire. Attendre plus de data.`;
  }
  lines.push(`### Verdict config C vs A (V1 prod)`);
  lines.push(verdict2);
  lines.push('');

  // ── Calibration comparaison ─────────────────────────────────────────────
  lines.push('## 2. Calibration comparée (buckets 10%)');
  lines.push('');
  lines.push('| Bucket | V1 pred | V1 act | V2 pred | V2 act | V2pur pred | V2pur act | n_V1 |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (let i = 0; i < 10; i++) {
    const b1 = mV1.buckets[i]; const b2 = mV2.buckets[i]; const bp = mV2pur.buckets[i];
    if (b1.n === 0 && b2.n === 0 && bp.n === 0) continue;
    const f = (x: number) => (x * 100).toFixed(0) + '%';
    lines.push(`| ${(i * 10).toString().padStart(2)}-${((i + 1) * 10).toString().padStart(2)}% | ${f(b1.predMean)} | ${f(b1.actMean)} | ${f(b2.predMean)} | ${f(b2.actMean)} | ${f(bp.predMean)} | ${f(bp.actMean)} | ${b1.n} |`);
  }
  lines.push('');

  // ── Top 10 V2 misses ────────────────────────────────────────────────────
  lines.push('## 3. Top 10 pires erreurs V2 (diagnostic qualitatif)');
  lines.push('');
  for (let idx = 0; idx < worst.length; idx++) {
    const w = worst[idx];
    const result = w.outcome === 1 ? w.p1Name : w.p2Name;
    lines.push(`### #${idx + 1} — ${w.label} (${w.format}, tier ${w.tier ?? '?'})`);
    lines.push('');
    lines.push(`- **Date** : ${w.date.toISOString().slice(0, 10)} · **Tournoi** : ${w.tournamentName ?? '?'}`);
    lines.push(`- **Ratings Glicko** :`);
    lines.push(`  - ${w.p1Name} : ${w.p1Rating.toFixed(0)} ± ${w.p1Rd.toFixed(0)}`);
    lines.push(`  - ${w.p2Name} : ${w.p2Rating.toFixed(0)} ± ${w.p2Rd.toFixed(0)}`);
    lines.push(`- **Prédictions** :`);
    lines.push(`  - V1 : prob ${(w.probV1 * 100).toFixed(1)}% (odds ${w.oddsV1})`);
    lines.push(`  - V2 blended : prob ${(w.probV2 * 100).toFixed(1)}% (odds ${w.oddsV2}) ← erreur ${(Math.abs(w.probV2 - w.outcome) * 100).toFixed(1)}%`);
    lines.push(`  - V2 pur : prob ${(w.probV2pur * 100).toFixed(1)}% (odds ${w.oddsV2pur})`);
    lines.push(`  - Glicko single-game : ${(w.glickoP * 100).toFixed(1)}%`);
    lines.push(`- **Résultat réel** : ${result} a gagné (score ${w.outcome === 1 ? '1' : '0'})`);
    lines.push(`- **H2H count** : ${w.h2hCount} matchs entre eux avant cette date`);
    for (const pid of [w.p1Id, w.p2Id]) {
      const name = pid === w.p1Id ? w.p1Name : w.p2Name;
      const last5 = playerLastMatches.get(`${pid}|${w.date.toISOString()}`) ?? [];
      lines.push(`- **5 derniers matchs de ${name}** :`);
      if (last5.length === 0) {
        lines.push('  - (aucun historique disponible)');
      } else {
        for (const m of last5) {
          lines.push(`  - ${m.date} · tier ${m.tier} · ${m.won ? 'W' : 'L'} ${m.score ?? ''} vs ${m.opp}`);
        }
      }
    }
    lines.push('');
  }

  // Catégorisation automatique (best effort)
  lines.push('## 4. Catégorisation des 10 pires erreurs');
  lines.push('');
  lines.push('Heuristiques automatiques (à raffiner manuellement dans la discussion) :');
  lines.push('');
  let catA = 0, catB = 0, catC = 0;
  for (const w of worst) {
    const favRating = w.probV2 > 0.5 ? w.p1Rating : w.p2Rating;
    const undRating = w.probV2 > 0.5 ? w.p2Rating : w.p1Rating;
    const favRd = w.probV2 > 0.5 ? w.p1Rd : w.p2Rd;
    const undRd = w.probV2 > 0.5 ? w.p2Rd : w.p1Rd;
    let cat: string;
    if (favRd > 150 || undRd > 150) {
      cat = '**b) rating faux** (high RD, donnée insuffisante)';
      catB++;
    } else if (Math.abs(favRating - undRating) > 300 && w.probV2 > 0.75) {
      cat = '**a) upset vrai** (big gap rating, high confidence correct, just unlucky)';
      catA++;
    } else if (Math.abs(w.probV1 - w.outcome) < Math.abs(w.probV2 - w.outcome) - 0.15) {
      cat = '**c) V1-only signal** (V1 a vu juste, V2 ignore form/H2H)';
      catC++;
    } else {
      cat = '**a/b mixte** (à examiner)';
      catA++;
    }
    lines.push(`- ${w.label} : ${cat}`);
  }
  lines.push('');
  lines.push(`**Répartition** : a=${catA} (${(catA / worst.length * 100).toFixed(0)}%) · b=${catB} (${(catB / worst.length * 100).toFixed(0)}%) · c=${catC} (${(catC / worst.length * 100).toFixed(0)}%)`);
  lines.push('');

  // Recommandation
  lines.push('## 5. Recommandation');
  lines.push('');
  if (mV2pur.brier < mV1.brier - 0.02) {
    lines.push('**Glicko a un futur.** Config C (Glicko pur) bat V1. Next : retirer le blending, tuner les clamps, backtest 100+ matchs.');
  } else if (mV2pur.brier > mV1.brier + 0.02 && mV2.brier > mV1.brier + 0.02) {
    lines.push('**Glicko ne vaut pas le coup sur ce dataset.** Ni blended ni pur ne battent V1. Move on jusqu\'à N=200+ matchs COMPLETED pour backtest plus robuste. Le code Glicko reste committed dormant, on peut y revenir.');
  } else {
    lines.push('**Signal ambigu.** Les 3 configs sont dans un mouchoir. Petit sample. Attendre plus de data pour conclure.');
  }
  lines.push('');
  lines.push(`Brier final : V1=${mV1.brier.toFixed(4)}, V2 blended=${mV2.brier.toFixed(4)}, V2 pur=${mV2pur.brier.toFixed(4)}.`);

  const outDir = join(process.cwd(), '..', 'audit');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const mdPath = join(outDir, 'PHASE3_DIAGNOSTIC_2026-04-19.md');
  writeFileSync(mdPath, lines.join('\n'));
  console.log(`Report saved: ${mdPath}`);

  // Also save raw JSON
  const jsonPath = join(outDir, 'PHASE3_DIAGNOSTIC_2026-04-19.json');
  writeFileSync(jsonPath, JSON.stringify({
    metrics: { v1: mV1, v2: mV2, v2pur: mV2pur },
    worst,
    playerLastMatches: Array.from(playerLastMatches.entries()),
  }, null, 2));

  await prisma.$disconnect();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
