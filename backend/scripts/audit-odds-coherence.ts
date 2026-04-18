/**
 * Odds coherence audit script.
 *
 * Iterates over all UPCOMING matches and checks:
 *   A1  no-arbitrage overround (main bet + exact score)
 *   A2  cohérence main-bet ↔ exact-score
 *   A3  score set complet pour le format
 *   A4  monotonie (2-0 moins cote que 2-1 pour un favori)
 *
 * Does NOT write anything. Pure read-only, safe to run in prod.
 *
 * Usage: npx tsx scripts/audit-odds-coherence.ts [--json] [--all-statuses]
 */

import { PrismaClient } from '@prisma/client';
import { buildBlendedDistribution, type Bo } from '../src/services/exactScoreModel';
const prisma = new PrismaClient();

interface Violation {
  matchId: string;
  label: string;
  severity: 'P0' | 'P1' | 'P2';
  check: 'A1' | 'A2' | 'A3' | 'A4';
  detail: string;
}

const EXACT_SCORE_MARGIN = 0.15;
const EXACT_SCORE_MAX_ODDS = 15;
const MAIN_2WAY_OVERROUND_LOW = 1.04;
const MAIN_2WAY_OVERROUND_HIGH = 1.09;
const MAIN_3WAY_OVERROUND_LOW = 1.08;
const MAIN_3WAY_OVERROUND_HIGH = 1.14;
const EXACT_OVERROUND_LOW = 1.14;
const EXACT_OVERROUND_HIGH = 1.25;
const MAIN_EXACT_DELTA = 0.08; // max |1/oddsSide - Σ1/oddsExactSide| / (Σ)

// Binomial helpers — local copy to avoid importing from route files
function solvePerGameProb(pMatch: number, format: string): number {
  const seriesWin = (p: number): number => {
    if (format === 'BO1') return p;
    if (format === 'BO3') return p * p * (3 - 2 * p);
    if (format === 'BO5') return p * p * p * (1 + 3 * (1 - p) + 6 * (1 - p) * (1 - p));
    if (format === 'BO7') return p * p * p * p * (1 + 4 * (1 - p) + 10 * (1 - p) * (1 - p) + 20 * (1 - p) * (1 - p) * (1 - p));
    return p;
  };
  if (pMatch <= 0 || pMatch >= 1) return pMatch;
  let lo = 0.001, hi = 0.999;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (seriesWin(mid) < pMatch) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

type Dist = Record<string, number>;

function theoreticalDistribution(odds1: number, odds2: number, format: string, oddsDraw?: number | null): Dist {
  if (format === 'BO2' && oddsDraw && oddsDraw > 1) {
    const r1 = 1 / odds1, rD = 1 / oddsDraw, r2 = 1 / odds2;
    const n = r1 + rD + r2;
    return { '2-0': r1 / n, '1-1': rD / n, '0-2': r2 / n };
  }
  const raw1 = 1 / odds1, raw2 = 1 / odds2;
  const norm = raw1 + raw2;
  const pMatch1 = raw1 / norm;
  const p = solvePerGameProb(pMatch1, format);
  const q = 1 - p;
  const d: Dist = {};
  if (format === 'BO1') { d['1-0'] = p; d['0-1'] = q; }
  else if (format === 'BO2') { d['2-0'] = p * p; d['1-1'] = 2 * p * q; d['0-2'] = q * q; }
  else if (format === 'BO3') { d['2-0'] = p * p; d['2-1'] = 2 * p * p * q; d['0-2'] = q * q; d['1-2'] = 2 * q * q * p; }
  else if (format === 'BO5') {
    d['3-0'] = p ** 3; d['3-1'] = 3 * p ** 3 * q; d['3-2'] = 6 * p ** 3 * q * q;
    d['0-3'] = q ** 3; d['1-3'] = 3 * q ** 3 * p; d['2-3'] = 6 * q ** 3 * p * p;
  } else if (format === 'BO7') {
    d['4-0'] = p ** 4; d['4-1'] = 4 * p ** 4 * q; d['4-2'] = 10 * p ** 4 * q * q; d['4-3'] = 20 * p ** 4 * q ** 3;
    d['0-4'] = q ** 4; d['1-4'] = 4 * q ** 4 * p; d['2-4'] = 10 * q ** 4 * p * p; d['3-4'] = 20 * q ** 4 * p ** 3;
  }
  return d;
}

function distToOdds(dist: Dist): Record<string, number> {
  const o: Record<string, number> = {};
  for (const [k, prob] of Object.entries(dist)) {
    const raw = prob > 0 ? (1 / prob) * (1 - EXACT_SCORE_MARGIN) : EXACT_SCORE_MAX_ODDS;
    o[k] = Math.min(raw, EXACT_SCORE_MAX_ODDS);
  }
  return o;
}

function expectedScoresForFormat(format: string): string[] {
  switch (format) {
    case 'BO1': return ['1-0', '0-1'];
    case 'BO2': return ['2-0', '1-1', '0-2'];
    case 'BO3': return ['2-0', '2-1', '0-2', '1-2'];
    case 'BO5': return ['3-0', '3-1', '3-2', '0-3', '1-3', '2-3'];
    case 'BO7': return ['4-0', '4-1', '4-2', '4-3', '0-4', '1-4', '2-4', '3-4'];
    default: return [];
  }
}

function scoresWherePlayerWins(format: string, player: 1 | 2): string[] {
  const all = expectedScoresForFormat(format);
  return all.filter(s => {
    const [a, b] = s.split('-').map(Number);
    return player === 1 ? a > b : b > a;
  });
}

async function auditMatch(match: {
  id: string; format: string; odds1: number; odds2: number; oddsDraw: number | null;
  player1Id: string; player2Id: string; player1Name: string; player2Name: string;
  tournamentTier?: string | null;
}): Promise<Violation[]> {
  const v: Violation[] = [];
  const label = `${match.player1Name} vs ${match.player2Name}`;
  const { odds1, odds2, oddsDraw, format } = match;

  // ── A1: overround main ────────────────────────────────────────────────────
  const hasDraw = !!oddsDraw;
  const mainOverround = 1 / odds1 + 1 / odds2 + (hasDraw ? 1 / oddsDraw! : 0);
  if (hasDraw) {
    if (mainOverround < MAIN_3WAY_OVERROUND_LOW || mainOverround > MAIN_3WAY_OVERROUND_HIGH) {
      v.push({
        matchId: match.id, label, severity: 'P1', check: 'A1',
        detail: `main 3-way overround = ${mainOverround.toFixed(4)} (target [${MAIN_3WAY_OVERROUND_LOW}, ${MAIN_3WAY_OVERROUND_HIGH}])`,
      });
    }
    if (mainOverround < 1.0) {
      v.push({
        matchId: match.id, label, severity: 'P0', check: 'A1',
        detail: `ARBITRAGE GARANTI sur main — overround = ${mainOverround.toFixed(4)} < 1.00 (free money user)`,
      });
    }
  } else {
    if (mainOverround < MAIN_2WAY_OVERROUND_LOW || mainOverround > MAIN_2WAY_OVERROUND_HIGH) {
      v.push({
        matchId: match.id, label, severity: 'P1', check: 'A1',
        detail: `main 2-way overround = ${mainOverround.toFixed(4)} (target [${MAIN_2WAY_OVERROUND_LOW}, ${MAIN_2WAY_OVERROUND_HIGH}])`,
      });
    }
    if (mainOverround < 1.0) {
      v.push({
        matchId: match.id, label, severity: 'P0', check: 'A1',
        detail: `ARBITRAGE GARANTI sur main — overround = ${mainOverround.toFixed(4)} < 1.00 (free money user)`,
      });
    }
  }

  if (format === 'BO1') return v;

  // ── Exact score distribution ──────────────────────────────────────────────
  const theoretical = theoreticalDistribution(odds1, odds2, format, oddsDraw);
  let dist: Dist = theoretical;
  if (format !== 'BO2' && format !== 'BO1') {
    try {
      dist = await buildBlendedDistribution(
        theoretical, match.id, match.player1Id, match.player2Id,
        format as Bo, odds1, odds2, match.tournamentTier ?? undefined,
      );
    } catch (err) {
      v.push({
        matchId: match.id, label, severity: 'P2', check: 'A1',
        detail: `blend failed, fallback to theoretical: ${(err as Error).message}`,
      });
    }
  }
  const exactOdds = distToOdds(dist);

  // ── A3: score set complet ─────────────────────────────────────────────────
  const expectedScores = expectedScoresForFormat(format);
  const actualScores = Object.keys(exactOdds);
  const missing = expectedScores.filter(s => !actualScores.includes(s));
  const extra = actualScores.filter(s => !expectedScores.includes(s));
  if (missing.length > 0) {
    v.push({
      matchId: match.id, label, severity: 'P0', check: 'A3',
      detail: `missing scores: [${missing.join(', ')}]`,
    });
  }
  if (extra.length > 0) {
    v.push({
      matchId: match.id, label, severity: 'P0', check: 'A3',
      detail: `extra scores (impossible): [${extra.join(', ')}]`,
    });
  }

  // ── A1: overround exact ───────────────────────────────────────────────────
  const exactOverround = Object.values(exactOdds).reduce((s, o) => s + 1 / o, 0);
  if (exactOverround < EXACT_OVERROUND_LOW || exactOverround > EXACT_OVERROUND_HIGH) {
    const sev: 'P1' | 'P2' = exactOverround > EXACT_OVERROUND_HIGH ? 'P2' : 'P1';
    v.push({
      matchId: match.id, label, severity: sev, check: 'A1',
      detail: `exact overround = ${exactOverround.toFixed(4)} (target [${EXACT_OVERROUND_LOW}, ${EXACT_OVERROUND_HIGH}])`,
    });
  }
  if (exactOverround < 1.0) {
    v.push({
      matchId: match.id, label, severity: 'P0', check: 'A1',
      detail: `ARBITRAGE GARANTI sur exact — overround = ${exactOverround.toFixed(4)} < 1.00`,
    });
  }

  // ── A2: cohérence main ↔ exact (BO3+) ─────────────────────────────────────
  if (format !== 'BO2' && format !== 'BO1') {
    const p1ExactImpl = scoresWherePlayerWins(format, 1)
      .reduce((s, k) => s + (exactOdds[k] ? 1 / exactOdds[k] : 0), 0);
    const p2ExactImpl = scoresWherePlayerWins(format, 2)
      .reduce((s, k) => s + (exactOdds[k] ? 1 / exactOdds[k] : 0), 0);
    const mainP1Impl = 1 / odds1;
    const mainP2Impl = 1 / odds2;
    // Normaliser pour comparer des probabilités (pas des implied avec marge)
    const p1ExactNorm = p1ExactImpl / exactOverround;
    const p2ExactNorm = p2ExactImpl / exactOverround;
    const mainP1Norm = mainP1Impl / mainOverround;
    const mainP2Norm = mainP2Impl / mainOverround;
    const d1 = Math.abs(p1ExactNorm - mainP1Norm);
    const d2 = Math.abs(p2ExactNorm - mainP2Norm);
    if (d1 > MAIN_EXACT_DELTA) {
      v.push({
        matchId: match.id, label, severity: 'P1', check: 'A2',
        detail: `P1 main=${mainP1Norm.toFixed(3)} vs exact=${p1ExactNorm.toFixed(3)} (Δ=${d1.toFixed(3)} > ${MAIN_EXACT_DELTA})`,
      });
    }
    if (d2 > MAIN_EXACT_DELTA) {
      v.push({
        matchId: match.id, label, severity: 'P1', check: 'A2',
        detail: `P2 main=${mainP2Norm.toFixed(3)} vs exact=${p2ExactNorm.toFixed(3)} (Δ=${d2.toFixed(3)} > ${MAIN_EXACT_DELTA})`,
      });
    }
  }

  // ── A2: cohérence draw BO2 ────────────────────────────────────────────────
  if (format === 'BO2' && hasDraw && exactOdds['1-1']) {
    const mainDrawNorm = (1 / oddsDraw!) / mainOverround;
    const exactDrawNorm = (1 / exactOdds['1-1']) / exactOverround;
    const d = Math.abs(mainDrawNorm - exactDrawNorm);
    if (d > MAIN_EXACT_DELTA) {
      v.push({
        matchId: match.id, label, severity: 'P1', check: 'A2',
        detail: `BO2 draw main=${mainDrawNorm.toFixed(3)} vs exact=${exactDrawNorm.toFixed(3)} (Δ=${d.toFixed(3)})`,
      });
    }
  }

  // ── A4: monotonie ─────────────────────────────────────────────────────────
  if (format === 'BO3' || format === 'BO5' || format === 'BO7') {
    const needed = format === 'BO3' ? 2 : format === 'BO5' ? 3 : 4;
    const p1IsFav = odds1 < odds2;
    const favSide = p1IsFav ? 1 : 2;
    const favScores = scoresWherePlayerWins(format, favSide)
      .map(s => {
        const [a, b] = s.split('-').map(Number);
        const loserGames = Math.min(a, b);
        return { score: s, loserGames, prob: dist[s] ?? 0 };
      })
      .sort((a, b) => a.loserGames - b.loserGames); // 2-0 first, then 2-1, etc.

    // Monotonie attendue : pour le favori, sweep (loserGames=0) doit être LE plus probable
    // → prob(2-0) ≥ prob(2-1) ≥ prob(2-needed-1)
    for (let i = 0; i < favScores.length - 1; i++) {
      const cur = favScores[i];
      const next = favScores[i + 1];
      if (cur.prob < next.prob) {
        v.push({
          matchId: match.id, label, severity: 'P1', check: 'A4',
          detail: `monotonie cassée pour favori (P${favSide}) : P(${cur.score})=${cur.prob.toFixed(3)} < P(${next.score})=${next.prob.toFixed(3)}`,
        });
      }
    }
  }

  return v;
}

async function main() {
  const jsonOut = process.argv.includes('--json');
  const allStatuses = process.argv.includes('--all-statuses');

  const matches = await prisma.match.findMany({
    where: allStatuses ? {} : { status: 'UPCOMING' },
    include: {
      player1: { select: { id: true, name: true } },
      player2: { select: { id: true, name: true } },
      tournament: { select: { tier: true } },
    },
    orderBy: { scheduledAt: 'asc' },
    take: 500,
  });

  if (!jsonOut) {
    console.log(`[Audit] Scanning ${matches.length} matches (${allStatuses ? 'all statuses' : 'UPCOMING only'})`);
  }

  const allViolations: Violation[] = [];
  for (const m of matches) {
    const violations = await auditMatch({
      id: m.id,
      format: m.format,
      odds1: m.odds1,
      odds2: m.odds2,
      oddsDraw: m.oddsDraw,
      player1Id: m.player1Id,
      player2Id: m.player2Id,
      player1Name: m.player1.name,
      player2Name: m.player2.name,
      tournamentTier: m.tournament?.tier,
    });
    allViolations.push(...violations);
    if (!jsonOut && violations.length > 0) {
      console.log(`\n❌ ${m.player1.name} vs ${m.player2.name} (${m.format}, ${m.id.slice(0, 8)}) — ${violations.length} violation(s)`);
      for (const vx of violations) {
        console.log(`  [${vx.severity}] ${vx.check}: ${vx.detail}`);
      }
    }
  }

  if (jsonOut) {
    console.log(JSON.stringify(allViolations, null, 2));
  } else {
    console.log(`\n── Summary ─────────────────────────────────────`);
    console.log(`Matches scanned : ${matches.length}`);
    console.log(`Total violations: ${allViolations.length}`);
    const bySeverity = allViolations.reduce((acc, v) => ({ ...acc, [v.severity]: (acc[v.severity] ?? 0) + 1 }), {} as Record<string, number>);
    console.log(`  P0 (critical) : ${bySeverity.P0 ?? 0}`);
    console.log(`  P1 (high)     : ${bySeverity.P1 ?? 0}`);
    console.log(`  P2 (medium)   : ${bySeverity.P2 ?? 0}`);
    const byCheck = allViolations.reduce((acc, v) => ({ ...acc, [v.check]: (acc[v.check] ?? 0) + 1 }), {} as Record<string, number>);
    console.log(`\nBy check: A1=${byCheck.A1 ?? 0} A2=${byCheck.A2 ?? 0} A3=${byCheck.A3 ?? 0} A4=${byCheck.A4 ?? 0}`);

    if ((bySeverity.P0 ?? 0) > 0) {
      console.log(`\n⚠️  P0 violations present — arbitrage/score-set bugs need IMMEDIATE attention.`);
      process.exitCode = 2;
    } else if (allViolations.length > 0) {
      process.exitCode = 1;
    }
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('[Audit] Fatal:', err);
  process.exit(1);
});
