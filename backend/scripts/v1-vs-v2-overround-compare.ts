/**
 * Compare per-match l'overround réel (V1) vs ciblé (V2) sur les 138 matchs
 * COMPLETED en DB. Sert la validation Phase 6 — prouve empiriquement que V2
 * stabilise la margin sur le catalogue de matchs réels.
 *
 * Usage :
 *   SKIP_SERVER=1 DATABASE_URL='...' npx tsx scripts/v1-vs-v2-overround-compare.ts
 */

import { PrismaClient } from '@prisma/client';
import { solvePerGameProb } from '../src/services/oddsEngine';

const prisma = new PrismaClient();
const EXACT_MARGIN = 0.15;
const EXACT_MAX_ODDS = 10;

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

function v1Odds(dist: Record<string, number>): number[] {
  return Object.values(dist).map(p =>
    Math.min(EXACT_MAX_ODDS, p > 0 ? (1 - EXACT_MARGIN) / p : EXACT_MAX_ODDS)
  );
}

function v2Odds(dist: Record<string, number>): number[] {
  const keys = Object.keys(dist);
  if (!keys.length) return [];
  const rawTotal = Object.values(dist).reduce((a, b) => a + b, 0);
  if (rawTotal <= 0) return [];
  const p: Record<string, number> = {};
  for (const k of keys) p[k] = dist[k] / rawTotal;
  const targetOverround = 1 / (1 - EXACT_MARGIN);
  const implied: Record<string, number> = {};
  for (const k of keys) implied[k] = p[k] / (1 - EXACT_MARGIN);
  const CAP_IMPL = 1 / EXACT_MAX_ODDS;
  const capped: string[] = [], normal: string[] = [];
  for (const k of keys) (implied[k] < CAP_IMPL ? capped : normal).push(k);
  const newImpl: Record<string, number> = {};
  for (const k of capped) newImpl[k] = CAP_IMPL;
  const cappedNewT = capped.length * CAP_IMPL;
  const normalOldT = normal.reduce((s, k) => s + implied[k], 0);
  const normalNewT = targetOverround - cappedNewT;
  if (!normal.length || normalNewT <= 0 || normalOldT <= 0) {
    for (const k of keys) newImpl[k] = Math.max(CAP_IMPL, implied[k]);
  } else {
    const scale = normalNewT / normalOldT;
    for (const k of normal) newImpl[k] = implied[k] * scale;
  }
  return keys.map(k => Math.min(EXACT_MAX_ODDS, 1 / newImpl[k]));
}

async function main() {
  const matches = await prisma.match.findMany({
    where: { status: 'COMPLETED', odds1: { gt: 1 }, odds2: { gt: 1 } },
    select: { id: true, format: true, odds1: true, odds2: true, oddsDraw: true, resultScore: true },
    orderBy: { scheduledAt: 'asc' },
  });

  interface Stat { n: number; v1Sum: number; v2Sum: number; v1Max: number; v2Max: number; worstDelta: { id: string; v1: number; v2: number; format: string } | null }
  const byFmt: Record<string, Stat> = {};
  const allV1: number[] = [], allV2: number[] = [];
  let worstV1 = 1, worstV1Id = '', worstV1Fmt = '';

  for (const m of matches) {
    if (m.format === 'BO1') continue; // V1 also returns [] for BO1 now
    const dist = theoreticalDist(m.odds1, m.odds2, m.format, m.oddsDraw ?? null);
    const oV1 = v1Odds(dist);
    const oV2 = v2Odds(dist);
    const overV1 = oV1.reduce((s, o) => s + 1 / o, 0);
    const overV2 = oV2.reduce((s, o) => s + 1 / o, 0);

    const s = byFmt[m.format] ?? { n: 0, v1Sum: 0, v2Sum: 0, v1Max: 0, v2Max: 0, worstDelta: null };
    s.n++;
    s.v1Sum += overV1; s.v2Sum += overV2;
    s.v1Max = Math.max(s.v1Max, overV1);
    s.v2Max = Math.max(s.v2Max, overV2);
    if (!s.worstDelta || overV1 - overV2 > s.worstDelta.v1 - s.worstDelta.v2) {
      s.worstDelta = { id: m.id, v1: overV1, v2: overV2, format: m.format };
    }
    byFmt[m.format] = s;
    allV1.push(overV1); allV2.push(overV2);

    if (overV1 > worstV1) { worstV1 = overV1; worstV1Id = m.id; worstV1Fmt = m.format; }
  }

  console.log('\n=== OVERROUND V1 vs V2 — par format ===\n');
  console.log('| Format | N | V1 moyenne | V1 max | V2 moyenne | V2 max | Gain moyen user |');
  console.log('|---|---|---|---|---|---|---|');
  for (const [fmt, s] of Object.entries(byFmt).sort()) {
    const v1M = s.v1Sum / s.n, v2M = s.v2Sum / s.n;
    console.log(`| ${fmt} | ${s.n} | ${v1M.toFixed(4)} | ${s.v1Max.toFixed(4)} | ${v2M.toFixed(4)} | ${s.v2Max.toFixed(4)} | ${((v1M - v2M) * 100).toFixed(2)} pp |`);
  }

  const v1Avg = allV1.reduce((a, b) => a + b, 0) / allV1.length;
  const v2Avg = allV2.reduce((a, b) => a + b, 0) / allV2.length;
  const v1Over20 = allV1.filter(o => o > 1.20).length;
  const v2Over20 = allV2.filter(o => o > 1.20).length;
  const v1Over25 = allV1.filter(o => o > 1.25).length;
  const v2Over25 = allV2.filter(o => o > 1.25).length;

  console.log(`\nGLOBAL (N=${allV1.length})`);
  console.log(`  V1 avg overround : ${v1Avg.toFixed(4)}   (max ${Math.max(...allV1).toFixed(4)})`);
  console.log(`  V2 avg overround : ${v2Avg.toFixed(4)}   (max ${Math.max(...allV2).toFixed(4)})`);
  console.log(`  V1 matches avec overround > 1.20 : ${v1Over20} / ${allV1.length}  (${(v1Over20/allV1.length*100).toFixed(1)}%)`);
  console.log(`  V2 matches avec overround > 1.20 : ${v2Over20} / ${allV2.length}  (${(v2Over20/allV2.length*100).toFixed(1)}%)`);
  console.log(`  V1 matches avec overround > 1.25 (hors norme) : ${v1Over25} / ${allV1.length}`);
  console.log(`  V2 matches avec overround > 1.25 : ${v2Over25} / ${allV2.length}`);
  console.log(`\n  Pire V1 overround : ${worstV1.toFixed(4)} (${worstV1Fmt} ${worstV1Id})`);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
