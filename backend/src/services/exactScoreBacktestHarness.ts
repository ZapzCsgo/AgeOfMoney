/**
 * Exact-score backtest harness — pure DB reader, zero side-effects.
 *
 * Baseline de la V1 actuelle (couche théorique binomiale uniquement, pas
 * la couche blend H2H/player — cette dernière dépend de snapshots
 * point-in-time qu'on ne reconstruit pas ici, et elle est quasi inactive
 * tant qu'on n'a pas assez de samples per player anyway).
 *
 * Métriques calculées per-format :
 *   - RPS (Ranked Probability Score) — métrique standard pour pronostics
 *     ordinaux multi-outcomes : (1/(k-1)) × Σ (Pcum_i - Ocum_i)² sur un
 *     ordre "écart du score" (ex BO5 : 3-0 > 3-1 > 3-2 > 2-3 > 1-3 > 0-3).
 *     Plus bas = mieux.
 *   - Brier multi-class — Σ (P_i - O_i)² sommé sur tous les outcomes.
 *   - Log-loss multi-class — -log(P_observed).
 *   - Top-choice accuracy — le score prédit le plus probable est-il sorti ?
 *
 * ⚠️ Warning sample size : avec N=45 matchs complétés réparti sur 4 formats,
 * on est à ~10 observations par format. Pas de robustesse statistique —
 * un swing de 3-4 matchs peut inverser le classement. Le rapport baseline
 * le rappelle en gros.
 */

import { prisma } from '../index';
import { solvePerGameProb } from './oddsEngine';

// ── Score catalogue per format, ordered from most decisive P1 win to
//    most decisive P2 win (utilisé pour le RPS). ──────────────────────
const ORDERED_SCORES: Record<string, readonly string[]> = {
  BO1: ['1-0', '0-1'],
  BO2: ['2-0', '1-1', '0-2'],
  BO3: ['2-0', '2-1', '1-2', '0-2'],
  BO5: ['3-0', '3-1', '3-2', '2-3', '1-3', '0-3'],
  BO7: ['4-0', '4-1', '4-2', '4-3', '3-4', '2-4', '1-4', '0-4'],
};

function parseScore(s: string | null): { a: number; b: number } | null {
  if (!s) return null;
  const m = s.match(/^\s*(\d+)\s*[-:]\s*(\d+)\s*$/);
  if (!m) return null;
  return { a: parseInt(m[1], 10), b: parseInt(m[2], 10) };
}

/**
 * Theoretical binomial distribution — replicated here (vs imported from
 * routes/bets.ts) to keep this service module free of route dependencies
 * and pure/stateless.
 */
function theoreticalDistribution(
  odds1: number,
  odds2: number,
  format: string,
  oddsDraw: number | null | undefined,
): Record<string, number> {
  if (format === 'BO2' && oddsDraw && oddsDraw > 1) {
    const r1 = 1 / odds1;
    const rD = 1 / oddsDraw;
    const r2 = 1 / odds2;
    const norm = r1 + rD + r2;
    return { '2-0': r1 / norm, '1-1': rD / norm, '0-2': r2 / norm };
  }
  const raw1 = 1 / odds1;
  const raw2 = 1 / odds2;
  const norm = raw1 + raw2;
  const pMatch1 = raw1 / norm;
  const p = solvePerGameProb(pMatch1, format);
  const q = 1 - p;

  const d: Record<string, number> = {};
  if (format === 'BO1') {
    d['1-0'] = p; d['0-1'] = q;
  } else if (format === 'BO2') {
    d['2-0'] = p * p; d['1-1'] = 2 * p * q; d['0-2'] = q * q;
  } else if (format === 'BO3') {
    d['2-0'] = p * p; d['2-1'] = 2 * p * p * q; d['1-2'] = 2 * q * q * p; d['0-2'] = q * q;
  } else if (format === 'BO5') {
    d['3-0'] = p * p * p;
    d['3-1'] = 3 * p * p * p * q;
    d['3-2'] = 6 * p * p * p * q * q;
    d['2-3'] = 6 * q * q * q * p * p;
    d['1-3'] = 3 * q * q * q * p;
    d['0-3'] = q * q * q;
  } else if (format === 'BO7') {
    d['4-0'] = p * p * p * p;
    d['4-1'] = 4 * p * p * p * p * q;
    d['4-2'] = 10 * p * p * p * p * q * q;
    d['4-3'] = 20 * p * p * p * p * q * q * q;
    d['3-4'] = 20 * q * q * q * q * p * p * p;
    d['2-4'] = 10 * q * q * q * q * p * p;
    d['1-4'] = 4 * q * q * q * q * p;
    d['0-4'] = q * q * q * q;
  }
  return d;
}

export interface ExactScoreMetrics {
  n: number;
  rps: number;
  brier: number;
  logLoss: number;
  topChoiceAccuracy: number;
}

export interface ExactScoreBacktestResult {
  datestamp: string;
  overall: ExactScoreMetrics;
  byFormat: Record<string, ExactScoreMetrics>;
  /** Per-match rows kept for the worst-error listing in the report. */
  predictions: Array<{
    matchId: string;
    label: string;
    format: string;
    date: string;
    actualScore: string;
    predictedTop: string;
    predictedTopProb: number;
    actualProb: number;
    brier: number;
    rps: number;
  }>;
  skipped: {
    invalidScore: number;
    formatUnknown: number;
    scoreNotInCatalogue: number;
    missingOdds: number;
  };
}

export async function runExactScoreBacktest(): Promise<ExactScoreBacktestResult> {
  const matches = await prisma.match.findMany({
    where: {
      status: 'COMPLETED',
      resultScore: { not: null },
    },
    include: {
      player1: { select: { name: true } },
      player2: { select: { name: true } },
    },
    orderBy: { scheduledAt: 'asc' },
  });

  interface Acc {
    n: number;
    rpsSum: number;
    brierSum: number;
    llSum: number;
    hits: number;
  }
  const byFmtAcc: Record<string, Acc> = {};
  const skipped = { invalidScore: 0, formatUnknown: 0, scoreNotInCatalogue: 0, missingOdds: 0 };
  const predictions: ExactScoreBacktestResult['predictions'] = [];

  for (const m of matches) {
    if (m.odds1 == null || m.odds2 == null) { skipped.missingOdds++; continue; }
    const ordered = ORDERED_SCORES[m.format];
    if (!ordered) { skipped.formatUnknown++; continue; }

    const parsed = parseScore(m.resultScore);
    if (!parsed) { skipped.invalidScore++; continue; }
    const actualKey = `${parsed.a}-${parsed.b}`;
    if (!ordered.includes(actualKey)) { skipped.scoreNotInCatalogue++; continue; }

    const dist = theoreticalDistribution(m.odds1, m.odds2, m.format, m.oddsDraw);

    // Brier multi-class + log-loss + top-choice
    let brier = 0;
    let ll = 0;
    let topProb = 0;
    let topKey = '';
    let actualProb = 0;
    for (const k of ordered) {
      const P = dist[k] ?? 0;
      const O = k === actualKey ? 1 : 0;
      brier += (P - O) * (P - O);
      if (k === actualKey) {
        actualProb = P;
        const cP = Math.max(0.001, Math.min(0.999, P));
        ll = -Math.log(cP);
      }
      if (P > topProb) { topProb = P; topKey = k; }
    }

    // RPS — cumulative squared error on the ordinal axis
    let rps = 0;
    let cumP = 0;
    let cumO = 0;
    for (let i = 0; i < ordered.length - 1; i++) {
      cumP += dist[ordered[i]] ?? 0;
      cumO += ordered[i] === actualKey ? 1 : 0;
      rps += (cumP - cumO) * (cumP - cumO);
    }
    rps /= (ordered.length - 1);

    const acc = byFmtAcc[m.format] ?? { n: 0, rpsSum: 0, brierSum: 0, llSum: 0, hits: 0 };
    acc.n++;
    acc.rpsSum += rps;
    acc.brierSum += brier;
    acc.llSum += ll;
    if (topKey === actualKey) acc.hits++;
    byFmtAcc[m.format] = acc;

    predictions.push({
      matchId: m.id,
      label: `${m.player1?.name ?? '?'} vs ${m.player2?.name ?? '?'}`,
      format: m.format,
      date: m.scheduledAt.toISOString().slice(0, 10),
      actualScore: actualKey,
      predictedTop: topKey,
      predictedTopProb: topProb,
      actualProb,
      brier,
      rps,
    });
  }

  const byFormat: Record<string, ExactScoreMetrics> = {};
  let totalN = 0, totalRps = 0, totalBrier = 0, totalLL = 0, totalHits = 0;
  for (const [fmt, acc] of Object.entries(byFmtAcc)) {
    byFormat[fmt] = {
      n: acc.n,
      rps: acc.rpsSum / acc.n,
      brier: acc.brierSum / acc.n,
      logLoss: acc.llSum / acc.n,
      topChoiceAccuracy: acc.hits / acc.n,
    };
    totalN += acc.n;
    totalRps += acc.rpsSum;
    totalBrier += acc.brierSum;
    totalLL += acc.llSum;
    totalHits += acc.hits;
  }

  const overall: ExactScoreMetrics = {
    n: totalN,
    rps: totalN > 0 ? totalRps / totalN : 0,
    brier: totalN > 0 ? totalBrier / totalN : 0,
    logLoss: totalN > 0 ? totalLL / totalN : 0,
    topChoiceAccuracy: totalN > 0 ? totalHits / totalN : 0,
  };

  return {
    datestamp: new Date().toISOString().slice(0, 10),
    overall,
    byFormat,
    predictions,
    skipped,
  };
}

export function formatExactScoreMarkdown(r: ExactScoreBacktestResult): string {
  const lines: string[] = [];
  lines.push(`# Baseline Score Exact — V1 théorique (${r.datestamp})`);
  lines.push('');
  lines.push('> ⚠️ **WARNING sample size** : N=' + r.overall.n + ' matchs (répartis sur ~4 formats).');
  lines.push('> Les chiffres par format sont sur ~5-15 observations chacun. **Aucune robustesse statistique**.');
  lines.push('> Un swing de 3-4 matchs peut inverser n\'importe quel classement.');
  lines.push('> **À re-mesurer quand N ≥ 200 matchs COMPLETED** avant toute décision sur la V2.');
  lines.push('');
  lines.push('## Résultats globaux');
  lines.push('| N | RPS | Brier multi-class | Log-loss | Top-choice accuracy |');
  lines.push('|---|---|---|---|---|');
  lines.push(`| ${r.overall.n} | ${r.overall.rps.toFixed(4)} | ${r.overall.brier.toFixed(4)} | ${r.overall.logLoss.toFixed(4)} | ${(r.overall.topChoiceAccuracy * 100).toFixed(1)}% |`);
  lines.push('');
  lines.push('## Par format');
  lines.push('| Format | N | RPS | Brier | Log-loss | Top-acc |');
  lines.push('|---|---|---|---|---|---|');
  for (const [fmt, m] of Object.entries(r.byFormat).sort()) {
    lines.push(`| ${fmt} | ${m.n} | ${m.rps.toFixed(4)} | ${m.brier.toFixed(4)} | ${m.logLoss.toFixed(4)} | ${(m.topChoiceAccuracy * 100).toFixed(1)}% |`);
  }
  lines.push('');
  if (r.skipped.invalidScore || r.skipped.formatUnknown || r.skipped.scoreNotInCatalogue || r.skipped.missingOdds) {
    lines.push('## Skipped');
    lines.push('| Raison | N |');
    lines.push('|---|---|');
    if (r.skipped.missingOdds) lines.push(`| Odds manquantes | ${r.skipped.missingOdds} |`);
    if (r.skipped.formatUnknown) lines.push(`| Format inconnu | ${r.skipped.formatUnknown} |`);
    if (r.skipped.invalidScore) lines.push(`| resultScore non parsable | ${r.skipped.invalidScore} |`);
    if (r.skipped.scoreNotInCatalogue) lines.push(`| Score inattendu pour le format (ex: BO5 terminé 2-1) | ${r.skipped.scoreNotInCatalogue} |`);
    lines.push('');
  }
  return lines.join('\n');
}
