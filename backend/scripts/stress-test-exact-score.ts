/**
 * Phase 6 stress-tests du moteur Score Exact — 5 tests empiriques en une passe.
 *
 * Ce script n'écrit RIEN en DB et ne modifie AUCUN code du moteur. Il lit
 * la production (via pooler) et compute des métriques pour le rapport
 * audit/PHASE6_EXACT_SCORE_STRESS_TEST_YYYY-MM-DD.md.
 *
 * Tests :
 *   1. Edge cases numériques (8 cas odds extrêmes)
 *   2. BO1 margin trap (compare main winner vs exact 1-0)
 *   3. Théorie pure vs blend H2H/solo
 *   4. Baseline backtest + random/50-50 reference
 *   5. (rapporté en markdown seulement, pas de compute)
 *
 * Usage :
 *   SKIP_SERVER=1 DATABASE_URL='...' npx tsx scripts/stress-test-exact-score.ts
 */

import { PrismaClient } from '@prisma/client';
import { runExactScoreBacktest } from '../src/services/exactScoreBacktestHarness';
import { buildBlendedDistribution, type Bo } from '../src/services/exactScoreModel';
import { solvePerGameProb } from '../src/services/oddsEngine';
import { writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const EXACT_MARGIN = 0.15;
const EXACT_MAX_ODDS = 10;
const MIN_ODDS_REF = 1.05;     // référence skill odds-engine-aoe4 — PAS appliquée par le moteur actuel, à tester
const MAIN_MARGIN_2WAY = 0.09; // HOUSE_MARGIN_2WAY en main market

const ORDERED_SCORES: Record<string, readonly string[]> = {
  BO1: ['1-0', '0-1'],
  BO2: ['2-0', '1-1', '0-2'],
  BO3: ['2-0', '2-1', '1-2', '0-2'],
  BO5: ['3-0', '3-1', '3-2', '2-3', '1-3', '0-3'],
  BO7: ['4-0', '4-1', '4-2', '4-3', '3-4', '2-4', '1-4', '0-4'],
};

// ── Theoretical distribution (copie du moteur, statique) ─────────────────────
function theoreticalDist(odds1: number, odds2: number, format: string, oddsDraw: number | null = null): Record<string, number> {
  if (format === 'BO2' && oddsDraw && oddsDraw > 1) {
    const r1 = 1 / odds1, rD = 1 / oddsDraw, r2 = 1 / odds2;
    const norm = r1 + rD + r2;
    return { '2-0': r1 / norm, '1-1': rD / norm, '0-2': r2 / norm };
  }
  const raw1 = 1 / odds1, raw2 = 1 / odds2;
  const norm = raw1 + raw2;
  const p = solvePerGameProb(raw1 / norm, format);
  const q = 1 - p;
  const d: Record<string, number> = {};
  if (format === 'BO1') { d['1-0'] = p; d['0-1'] = q; }
  else if (format === 'BO2') { d['2-0'] = p*p; d['1-1'] = 2*p*q; d['0-2'] = q*q; }
  else if (format === 'BO3') { d['2-0'] = p*p; d['2-1'] = 2*p*p*q; d['1-2'] = 2*q*q*p; d['0-2'] = q*q; }
  else if (format === 'BO5') {
    d['3-0'] = p*p*p; d['3-1'] = 3*p*p*p*q; d['3-2'] = 6*p*p*p*q*q;
    d['2-3'] = 6*q*q*q*p*p; d['1-3'] = 3*q*q*q*p; d['0-3'] = q*q*q;
  } else if (format === 'BO7') {
    d['4-0'] = p*p*p*p; d['4-1'] = 4*p*p*p*p*q; d['4-2'] = 10*p*p*p*p*q*q; d['4-3'] = 20*p*p*p*p*q*q*q;
    d['3-4'] = 20*q*q*q*q*p*p*p; d['2-4'] = 10*q*q*q*q*p*p; d['1-4'] = 4*q*q*q*q*p; d['0-4'] = q*q*q*q;
  }
  return d;
}

// V1 : clamp les odds (le bug actuel — l'overround gonfle sur déséquilibre)
function distToOddsV1(dist: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, p] of Object.entries(dist)) {
    const raw = p > 0 ? (1 / p) * (1 - EXACT_MARGIN) : EXACT_MAX_ODDS;
    out[k] = Math.min(EXACT_MAX_ODDS, raw);
  }
  return out;
}

// V2 : force les scores qui seraient cappés à implied=1/CAP, puis scale les
// scores normaux pour garder total_implied = 1/(1-margin) = 1.1765 (17.6 %
// overround). Miroir exact de distributionToEntriesV2 dans bets.ts.
function distToOddsV2(dist: Record<string, number>): Record<string, number> {
  const keys = Object.keys(dist);
  if (keys.length === 0) return {};
  const rawTotal = Object.values(dist).reduce((a, b) => a + b, 0);
  if (rawTotal <= 0) return {};
  const p: Record<string, number> = {};
  for (const k of keys) p[k] = (dist[k] ?? 0) / rawTotal;

  const targetOverround = 1 / (1 - EXACT_MARGIN);
  const implied: Record<string, number> = {};
  for (const k of keys) implied[k] = p[k] / (1 - EXACT_MARGIN);

  const IMPLIED_CAP = 1 / EXACT_MAX_ODDS;
  const capped: string[] = [], normal: string[] = [];
  for (const k of keys) (implied[k] < IMPLIED_CAP ? capped : normal).push(k);

  const newImplied: Record<string, number> = {};
  for (const k of capped) newImplied[k] = IMPLIED_CAP;
  const cappedTotalNew = capped.length * IMPLIED_CAP;
  const normalTotalOld = normal.reduce((s, k) => s + implied[k], 0);
  const normalTargetTotal = targetOverround - cappedTotalNew;

  if (normal.length === 0 || normalTargetTotal <= 0 || normalTotalOld <= 0) {
    for (const k of keys) newImplied[k] = Math.max(IMPLIED_CAP, implied[k]);
  } else {
    const scale = normalTargetTotal / normalTotalOld;
    for (const k of normal) newImplied[k] = implied[k] * scale;
  }

  const out: Record<string, number> = {};
  for (const k of keys) {
    const raw = 1 / newImplied[k];
    out[k] = Math.min(EXACT_MAX_ODDS, raw);
  }
  return out;
}

function distToOdds(dist: Record<string, number>): Record<string, number> {
  return process.env.ODDS_ENGINE_EXACT_V2_ENABLED === 'true'
    ? distToOddsV2(dist)
    : distToOddsV1(dist);
}

function parseScoreKey(s: string): { a: number; b: number } | null {
  const m = s.match(/^\s*(\d+)\s*[-:]\s*(\d+)\s*$/);
  return m ? { a: parseInt(m[1], 10), b: parseInt(m[2], 10) } : null;
}

function rpsFromDist(dist: Record<string, number>, actualKey: string, ordered: readonly string[]): number {
  let rps = 0, cumP = 0, cumO = 0;
  for (let i = 0; i < ordered.length - 1; i++) {
    cumP += dist[ordered[i]] ?? 0;
    cumO += ordered[i] === actualKey ? 1 : 0;
    rps += (cumP - cumO) * (cumP - cumO);
  }
  return rps / (ordered.length - 1);
}

// ═══════════════════════════════════════════════════════════════════════
// TEST 1 — Edge cases numériques
// ═══════════════════════════════════════════════════════════════════════
function test1_edgeCases(): string {
  const cases: Array<{ odds1: number; odds2: number; format: string; oddsDraw?: number; label: string }> = [
    { odds1: 1.05, odds2: 15.0, format: 'BO3', label: 'favori écrasant BO3' },
    { odds1: 1.05, odds2: 15.0, format: 'BO5', label: 'favori écrasant BO5' },
    { odds1: 1.05, odds2: 15.0, format: 'BO7', label: 'favori écrasant BO7' },
    { odds1: 1.08, odds2: 10.0, format: 'BO2', oddsDraw: 8.0, label: 'gros favori BO2 (draw 8.0)' },
    { odds1: 1.25, odds2: 4.0, format: 'BO5', label: 'favori marqué BO5' },
    { odds1: 1.9, odds2: 1.9, format: 'BO5', label: '50/50 BO5' },
    { odds1: 3.0, odds2: 1.4, format: 'BO3', label: 'underdog BO3' },
    { odds1: 10.0, odds2: 1.05, format: 'BO7', label: 'upset écrasant BO7' },
  ];

  const lines: string[] = [];
  lines.push('## Test 1 — Edge cases numériques');
  lines.push('');
  lines.push('Règles vérifiées par cas :');
  lines.push('- (A) Aucune odd < 1.05 (MIN_ODDS skill)');
  lines.push('- (B) Aucune odd > 10.0 (EXACT_SCORE_MAX_ODDS)');
  lines.push('- (C) Σ probas = 1.00 ± 1e-6');
  lines.push('- (D) Overround ∈ [1.12, 1.22]');
  lines.push('- (E) Si 50/50, P symétrique (|P(i) - P(miroir)| < 1e-9)');
  lines.push('');
  lines.push('| Cas | Min odd | Max odd | Σ probas | Overround | Sym? | Verdict |');
  lines.push('|---|---|---|---|---|---|---|');

  let anyFail = false;
  const details: string[] = [];

  for (const c of cases) {
    const dist = theoreticalDist(c.odds1, c.odds2, c.format, c.oddsDraw ?? null);
    const odds = distToOdds(dist);
    const probs = Object.values(dist);
    const sumP = probs.reduce((a, b) => a + b, 0);
    const oddsVals = Object.values(odds);
    const minOdd = Math.min(...oddsVals);
    const maxOdd = Math.max(...oddsVals);
    const impliedSum = oddsVals.reduce((a, o) => a + 1 / o, 0);

    const failures: string[] = [];
    if (minOdd < 1.05 - 1e-9) failures.push(`(A) minOdd=${minOdd.toFixed(3)} < 1.05`);
    if (maxOdd > 10.0 + 1e-9) failures.push(`(B) maxOdd=${maxOdd.toFixed(3)} > 10.0`);
    if (Math.abs(sumP - 1.0) > 1e-6) failures.push(`(C) Σ=${sumP.toFixed(6)} ≠ 1`);
    if (impliedSum < 1.12 || impliedSum > 1.22) failures.push(`(D) overround ${impliedSum.toFixed(4)} hors [1.12, 1.22]`);

    // Symmetry check if 50/50
    let symOk = '—';
    if (c.odds1 === c.odds2) {
      const ord = ORDERED_SCORES[c.format];
      let okSym = true;
      for (let i = 0; i < Math.floor(ord.length / 2); i++) {
        const a = dist[ord[i]] ?? 0;
        const b = dist[ord[ord.length - 1 - i]] ?? 0;
        if (Math.abs(a - b) > 1e-9) { okSym = false; break; }
      }
      symOk = okSym ? 'OK' : 'FAIL';
      if (!okSym) failures.push('(E) non-symétrique à 50/50');
    }

    const verdict = failures.length ? '❌ FAIL' : '✅ OK';
    if (failures.length) anyFail = true;

    lines.push(`| ${c.label} (${c.format} ${c.odds1}/${c.odds2}${c.oddsDraw ? ` draw ${c.oddsDraw}` : ''}) | ${minOdd.toFixed(3)} | ${maxOdd.toFixed(3)} | ${sumP.toFixed(6)} | ${impliedSum.toFixed(4)} | ${symOk} | ${verdict} |`);
    if (failures.length) details.push(`- ${c.label}: ${failures.join('; ')}`);

    details.push(`  - probas : ${Object.entries(dist).map(([k, v]) => `${k}=${(v * 100).toFixed(1)}%`).join(', ')}`);
    details.push(`  - odds : ${Object.entries(odds).map(([k, v]) => `${k}=${v.toFixed(2)}`).join(', ')}`);
  }

  lines.push('');
  lines.push('**Verdict global test 1** : ' + (anyFail ? '❌ au moins un cas KO' : '✅ tous les cas passent'));
  lines.push('');
  lines.push('### Détails par cas');
  lines.push('');
  for (const d of details) lines.push(d);
  lines.push('');

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════
// TEST 2 — BO1 margin trap
// ═══════════════════════════════════════════════════════════════════════
async function test2_bo1MarginTrap(prisma: PrismaClient): Promise<string> {
  const lines: string[] = [];
  lines.push('## Test 2 — BO1 margin trap (main winner vs exact "1-0")');
  lines.push('');
  lines.push(
    'Hypothèse : sur un BO1, `exact "1-0"` et `main winner P1` sont le même événement. ' +
    'Mais l\'un applique 15% de margin (exact), l\'autre 9% (main 2-way). ' +
    'Si l\'écart dépasse 3%, le marché exact est un piège UX (même bet, payé moins).'
  );
  lines.push('');

  // Fetch BO1 matches — upcoming/live/completed, doesn't matter, we just compare odds
  const matches = await prisma.match.findMany({
    where: { format: 'BO1', odds1: { gt: 1 }, odds2: { gt: 1 } },
    select: {
      id: true, format: true, odds1: true, odds2: true, scheduledAt: true, status: true,
      player1: { select: { name: true } }, player2: { select: { name: true } },
    },
    orderBy: { scheduledAt: 'desc' },
    take: 100,
  });

  lines.push(`Matchs BO1 inspectés : ${matches.length}`);
  lines.push('');

  interface Row {
    id: string; label: string; status: string;
    odds1Main: number; odds2Main: number;
    odds10Exact: number; odds01Exact: number;
    gap1: number; gap2: number; worstGap: number;
  }

  const rows: Row[] = [];
  for (const m of matches) {
    const dist = theoreticalDist(m.odds1, m.odds2, 'BO1');
    const od = distToOdds(dist);
    const odds10 = od['1-0'] ?? EXACT_MAX_ODDS;
    const odds01 = od['0-1'] ?? EXACT_MAX_ODDS;
    // gap = (main - exact) / main : fraction of payout "lost" en passant par exact
    const gap1 = m.odds1 > 0 ? (m.odds1 - odds10) / m.odds1 : 0;
    const gap2 = m.odds2 > 0 ? (m.odds2 - odds01) / m.odds2 : 0;
    rows.push({
      id: m.id,
      label: `${m.player1.name} vs ${m.player2.name}`,
      status: m.status,
      odds1Main: m.odds1, odds2Main: m.odds2,
      odds10Exact: odds10, odds01Exact: odds01,
      gap1, gap2,
      worstGap: Math.max(Math.abs(gap1), Math.abs(gap2)),
    });
  }

  rows.sort((a, b) => b.worstGap - a.worstGap);

  lines.push('### 10 matchs BO1 avec les plus gros écarts (pire des 2 sides)');
  lines.push('');
  lines.push('| Match | Statut | Main P1 | Exact 1-0 | Gap P1 | Main P2 | Exact 0-1 | Gap P2 |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const r of rows.slice(0, 10)) {
    lines.push(
      `| ${r.label} | ${r.status} | ${r.odds1Main.toFixed(2)} | ${r.odds10Exact.toFixed(2)} | **${(r.gap1 * 100).toFixed(1)}%** | ` +
      `${r.odds2Main.toFixed(2)} | ${r.odds01Exact.toFixed(2)} | **${(r.gap2 * 100).toFixed(1)}%** |`
    );
  }
  lines.push('');

  // Aggregate
  if (rows.length > 0) {
    const gaps = rows.flatMap(r => [r.gap1, r.gap2]);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const max = Math.max(...gaps);
    const min = Math.min(...gaps);
    lines.push(`**Résumé écarts** : moyenne ${(mean * 100).toFixed(2)}%, max ${(max * 100).toFixed(2)}%, min ${(min * 100).toFixed(2)}%`);
    lines.push('');
    const trap = mean > 0.03;
    lines.push(`**Verdict** : ${trap ? '❌ TRAP CONFIRMÉ' : '✅ RAS'} — écart moyen ${mean > 0.03 ? '>' : '≤'} 3%`);
    if (trap) {
      lines.push('');
      lines.push(
        'Explication math : formule odds main = 1/(p × 1.09) = 0.917/p. ' +
        'Formule odds exact = (1-0.15)/p = 0.85/p. ' +
        'Ratio fixe exact/main = 0.85/0.917 = 0.927 → l\'exact-score paie ~7.3% moins que le main pour le MÊME événement sur BO1.'
      );
    }
  } else {
    lines.push('**Aucun match BO1 en DB** — test non applicable. Vérifier quand des BO1 seront ajoutés.');
  }
  lines.push('');

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════
// TEST 3 — Théorie pure vs blend H2H/solo
// ═══════════════════════════════════════════════════════════════════════
async function test3_pureVsBlend(prisma: PrismaClient): Promise<string> {
  const lines: string[] = [];
  lines.push('## Test 3 — Théorie pure vs blend H2H/solo');
  lines.push('');
  lines.push(
    '> ⚠️ **Data leakage** : le blend utilise l\'état courant de `PlayerMatchRecord` ' +
    '(pas de snapshot point-in-time). Un match de 2026-03 "voit" des records de 2026-04. ' +
    'Ce test est donc **optimiste en faveur du blend** — si malgré ça le blend perd, ' +
    'c\'est un signal fort.'
  );
  lines.push('');

  const matches = await prisma.match.findMany({
    where: {
      status: 'COMPLETED',
      resultScore: { not: null },
      format: { in: ['BO3', 'BO5', 'BO7'] }, // blend n'agit pas en BO1/BO2
    },
    select: {
      id: true, format: true, resultScore: true, odds1: true, odds2: true, oddsDraw: true,
      player1Id: true, player2Id: true,
      player1: { select: { name: true } }, player2: { select: { name: true } },
      tournament: { select: { tier: true } },
    },
    orderBy: { scheduledAt: 'asc' },
  });

  let purSumRps = 0, blendSumRps = 0;
  let purSumBrier = 0, blendSumBrier = 0;
  let purSumLl = 0, blendSumLl = 0;
  let n = 0;
  let blendActivated = 0;

  interface MatchDelta { label: string; format: string; actual: string; purRps: number; blendRps: number; delta: number }
  const deltas: MatchDelta[] = [];

  for (const m of matches) {
    const parsed = parseScoreKey(m.resultScore ?? '');
    if (!parsed) continue;
    const ord = ORDERED_SCORES[m.format];
    if (!ord) continue;
    const actualKey = `${parsed.a}-${parsed.b}`;
    if (!ord.includes(actualKey)) continue;

    const pure = theoreticalDist(m.odds1, m.odds2, m.format, m.oddsDraw);
    const blend = await buildBlendedDistribution(
      pure, m.id, m.player1Id, m.player2Id, m.format as Bo, m.odds1, m.odds2,
      m.tournament?.tier ?? undefined, m.oddsDraw,
    );

    const differs = ord.some(k => Math.abs((blend[k] ?? 0) - (pure[k] ?? 0)) > 1e-4);
    if (differs) blendActivated++;

    const purRps = rpsFromDist(pure, actualKey, ord);
    const blendRps = rpsFromDist(blend, actualKey, ord);

    let purB = 0, blendB = 0, purLl = 0, blendLl = 0;
    for (const k of ord) {
      const Pp = pure[k] ?? 0;
      const Pb = blend[k] ?? 0;
      const O = k === actualKey ? 1 : 0;
      purB += (Pp - O) ** 2;
      blendB += (Pb - O) ** 2;
      if (k === actualKey) {
        purLl = -Math.log(Math.max(0.001, Math.min(0.999, Pp)));
        blendLl = -Math.log(Math.max(0.001, Math.min(0.999, Pb)));
      }
    }

    purSumRps += purRps; blendSumRps += blendRps;
    purSumBrier += purB; blendSumBrier += blendB;
    purSumLl += purLl; blendSumLl += blendLl;
    n++;

    deltas.push({
      label: `${m.player1.name} vs ${m.player2.name}`,
      format: m.format, actual: actualKey,
      purRps, blendRps, delta: blendRps - purRps,
    });
  }

  lines.push(`Matchs testés : ${n} (BO3/5/7 avec resultScore)`);
  lines.push(`Blend s\'est activé sur : ${blendActivated} matchs (sinon retour pure theory car data insuffisante)`);
  lines.push('');

  if (n === 0) {
    lines.push('Aucun match testable. Test 3 non conclusif.');
    return lines.join('\n');
  }

  const purRps = purSumRps / n, blendRps = blendSumRps / n;
  const purBrier = purSumBrier / n, blendBrier = blendSumBrier / n;
  const purLl = purSumLl / n, blendLl = blendSumLl / n;

  lines.push('| Métrique | Pure théorie | Blend (actuel prod) | Δ (blend - pure) |');
  lines.push('|---|---|---|---|');
  lines.push(`| RPS | ${purRps.toFixed(4)} | ${blendRps.toFixed(4)} | ${(blendRps - purRps >= 0 ? '+' : '') + (blendRps - purRps).toFixed(4)} |`);
  lines.push(`| Brier | ${purBrier.toFixed(4)} | ${blendBrier.toFixed(4)} | ${(blendBrier - purBrier >= 0 ? '+' : '') + (blendBrier - purBrier).toFixed(4)} |`);
  lines.push(`| Log-loss | ${purLl.toFixed(4)} | ${blendLl.toFixed(4)} | ${(blendLl - purLl >= 0 ? '+' : '') + (blendLl - purLl).toFixed(4)} |`);
  lines.push('');

  const delta = blendRps - purRps;
  let verdict: string;
  if (delta < -0.02) verdict = '✅ **BLEND AMÉLIORE** (RPS − 0.02 ou mieux). Garder.';
  else if (delta > 0.02) verdict = '❌ **BLEND DÉGRADE** (RPS + 0.02 ou pire). ROLLBACK recommandé (revenir à pure théorie, désactiver buildBlendedDistribution).';
  else verdict = '🟡 **AMBIGU** (|Δ| ≤ 0.02, dans le bruit). Garder V1 par défaut mais à re-mesurer quand N ≥ 200. Le corridor + les tier-weights semblent ne rien casser, mais n\'apportent rien de visible non plus sur ce sample.';
  lines.push(`**Verdict test 3** : ${verdict}`);
  lines.push('');

  // Top 5 where blend helps most, top 5 where it hurts most
  deltas.sort((a, b) => a.delta - b.delta);
  lines.push('### 5 matchs où le blend AMÉLIORE le plus la prédiction');
  lines.push('');
  lines.push('| Match | Format | Actual | RPS pure | RPS blend | Δ |');
  lines.push('|---|---|---|---|---|---|');
  for (const d of deltas.slice(0, 5)) {
    lines.push(`| ${d.label} | ${d.format} | ${d.actual} | ${d.purRps.toFixed(3)} | ${d.blendRps.toFixed(3)} | ${d.delta.toFixed(3)} |`);
  }
  lines.push('');
  lines.push('### 5 matchs où le blend DÉGRADE le plus la prédiction');
  lines.push('');
  lines.push('| Match | Format | Actual | RPS pure | RPS blend | Δ |');
  lines.push('|---|---|---|---|---|---|');
  for (const d of deltas.slice(-5).reverse()) {
    lines.push(`| ${d.label} | ${d.format} | ${d.actual} | ${d.purRps.toFixed(3)} | ${d.blendRps.toFixed(3)} | +${d.delta.toFixed(3)} |`);
  }
  lines.push('');

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════
// TEST 4 — Baseline backtest (+ random + 50-50 references)
// ═══════════════════════════════════════════════════════════════════════
async function test4_baselineWithReferences(prisma: PrismaClient): Promise<string> {
  const lines: string[] = [];
  lines.push('## Test 4 — Baseline backtest + références (random, 50/50)');
  lines.push('');
  lines.push(
    '> ⚠️ **Sample size** : N=138 matchs répartis sur 4 formats. ~5–15 observations par format sur BO2/BO3/BO7. ' +
    'Swing de 3-4 matchs peut renverser un classement. Indicatif, pas statistiquement robuste.'
  );
  lines.push('');

  const result = await runExactScoreBacktest();

  // References
  // (a) Random uniform over the format's score catalogue
  // (b) Pure 50/50 (assume p=0.5 for all, ignore odds)
  const matches = await prisma.match.findMany({
    where: { status: 'COMPLETED', resultScore: { not: null } },
    select: { format: true, resultScore: true },
  });

  interface RefAcc { n: number; rpsSum: number; }
  const rndByFmt: Record<string, RefAcc> = {};
  const p50ByFmt: Record<string, RefAcc> = {};
  for (const m of matches) {
    const ord = ORDERED_SCORES[m.format];
    if (!ord) continue;
    const parsed = parseScoreKey(m.resultScore ?? '');
    if (!parsed) continue;
    const actualKey = `${parsed.a}-${parsed.b}`;
    if (!ord.includes(actualKey)) continue;

    // (a) Random uniform
    const uniformProb = 1 / ord.length;
    const uniformDist: Record<string, number> = {};
    for (const k of ord) uniformDist[k] = uniformProb;
    const uniformRps = rpsFromDist(uniformDist, actualKey, ord);

    // (b) 50/50 theoretical
    const p5050 = theoreticalDist(1.9, 1.9, m.format);
    const p5050Rps = rpsFromDist(p5050, actualKey, ord);

    (rndByFmt[m.format] ??= { n: 0, rpsSum: 0 }).n++;
    rndByFmt[m.format].rpsSum += uniformRps;
    (p50ByFmt[m.format] ??= { n: 0, rpsSum: 0 }).n++;
    p50ByFmt[m.format].rpsSum += p5050Rps;
  }

  lines.push('### Comparaison par format');
  lines.push('');
  lines.push('| Format | N | V1 RPS | Random uniforme RPS | 50/50 théorie RPS | V1 gain vs random | V1 gain vs 50/50 |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const [fmt, m] of Object.entries(result.byFormat).sort()) {
    const rnd = rndByFmt[fmt];
    const p50 = p50ByFmt[fmt];
    const rndRps = rnd ? rnd.rpsSum / rnd.n : 0;
    const p50Rps = p50 ? p50.rpsSum / p50.n : 0;
    lines.push(`| ${fmt} | ${m.n} | **${m.rps.toFixed(4)}** | ${rndRps.toFixed(4)} | ${p50Rps.toFixed(4)} | ${(rndRps - m.rps).toFixed(4)} | ${(p50Rps - m.rps).toFixed(4)} |`);
  }
  lines.push('');
  lines.push('(Gain positif = V1 bat le référent.)');
  lines.push('');

  // Overall
  let rndTotN = 0, rndTotSum = 0, p50TotN = 0, p50TotSum = 0;
  for (const a of Object.values(rndByFmt)) { rndTotN += a.n; rndTotSum += a.rpsSum; }
  for (const a of Object.values(p50ByFmt)) { p50TotN += a.n; p50TotSum += a.rpsSum; }
  const rndRpsAll = rndTotN ? rndTotSum / rndTotN : 0;
  const p50RpsAll = p50TotN ? p50TotSum / p50TotN : 0;
  lines.push(`**Overall** : V1 RPS = ${result.overall.rps.toFixed(4)} · Random = ${rndRpsAll.toFixed(4)} (V1 gagne ${(rndRpsAll - result.overall.rps).toFixed(4)}) · 50/50 théorie = ${p50RpsAll.toFixed(4)} (V1 gagne ${(p50RpsAll - result.overall.rps).toFixed(4)})`);
  lines.push('');

  const beatsRandom = result.overall.rps < rndRpsAll;
  const beats5050 = result.overall.rps < p50RpsAll;
  lines.push(`**Verdict test 4** : V1 ${beatsRandom ? 'bat' : 'NE BAT PAS'} le random uniforme · V1 ${beats5050 ? 'bat' : 'NE BAT PAS'} la théorie 50/50.`);
  if (beatsRandom && beats5050) {
    lines.push('Le moteur exploite bien les odds main. Pas de drapeau rouge sur la calibration de base.');
  } else if (!beatsRandom) {
    lines.push('⚠️ Le moteur ne bat PAS un random uniforme — calibration de base cassée, enquêter.');
  } else {
    lines.push('⚠️ Le moteur ne bat PAS la théorie 50/50 — signe que les odds main ne sont pas bien exploitées, ou que le sample est trop déséquilibré.');
  }
  lines.push('');

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════
async function main() {
  const prisma = new PrismaClient();
  const stamp = new Date().toISOString().slice(0, 10);

  console.log('Running Phase 6 stress tests…');
  const t1 = test1_edgeCases();
  console.log('Test 1 done.');
  const t2 = await test2_bo1MarginTrap(prisma);
  console.log('Test 2 done.');
  const t3 = await test3_pureVsBlend(prisma);
  console.log('Test 3 done.');
  const t4 = await test4_baselineWithReferences(prisma);
  console.log('Test 4 done.');

  const report = [
    `# Phase 6 — Stress tests Score Exact (${stamp})`,
    '',
    '> **Objectif** : valider empiriquement que le moteur Score Exact en prod fait ce qu\'on pense qu\'il fait,',
    '> AVANT toute implémentation V2. 5 tests : edge cases numériques, BO1 margin trap, théorie pure vs blend,',
    '> baseline vs références naïves, et audit stratégique du BO1.',
    '',
    '> ⚠️ **Aucun code du moteur modifié par ces tests.** Pure lecture + compute local.',
    '',
    '---',
    '',
    t1,
    '---',
    '',
    t2,
    '---',
    '',
    t3,
    '---',
    '',
    t4,
    '---',
    '',
    // Test 5 is markdown only — written in the final report
  ].join('\n');

  const outDir = join(process.cwd(), '..', 'audit');
  const outPath = existsSync(outDir)
    ? join(outDir, `PHASE6_EXACT_SCORE_STRESS_TEST_${stamp}.md`)
    : join(process.cwd(), `PHASE6_EXACT_SCORE_STRESS_TEST_${stamp}.md`);
  writeFileSync(outPath, report);
  console.log(`\nReport saved: ${outPath}`);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('[StressTest] Fatal:', err);
  process.exit(1);
});
