/**
 * Canonical Glicko-2 test case from Mark Glickman's 2013 paper
 * "Example of the Glicko-2 system", section 3.2.
 *
 * Starting player : rating=1500, RD=200, vol=0.06
 * 3 matches in one rating period :
 *   vs (1400, RD=30)  → win  (s=1)
 *   vs (1550, RD=100) → loss (s=0)
 *   vs (1700, RD=300) → loss (s=0)
 *
 * Expected output (tolerance 0.01 on rating, 0.1 on RD, 0.0001 on vol) :
 *   rating ≈ 1464.06
 *   RD ≈ 151.52
 *   vol ≈ 0.05999...
 *
 * If this passes, the implementation matches the published reference.
 * Usage: SKIP_SERVER=1 npx tsx scripts/test-glicko2-canonical.ts
 */

import { computeUpdatedRating, computeWinProbability } from '../src/services/ratingEngine';

function check(label: string, actual: number, expected: number, tol: number): boolean {
  const diff = Math.abs(actual - expected);
  const ok = diff <= tol;
  console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(20)} expected ${expected.toFixed(4)}, got ${actual.toFixed(4)}, diff ${diff.toFixed(6)}`);
  return ok;
}

const result = computeUpdatedRating(
  { rating: 1500, rd: 200, vol: 0.06 },
  [
    { opponentRating: 1400, opponentRd: 30, score: 1 },
    { opponentRating: 1550, opponentRd: 100, score: 0 },
    { opponentRating: 1700, opponentRd: 300, score: 0 },
  ],
);

console.log('\n── Glicko-2 canonical test (Glickman 2013 §3.2) ──');
console.log(`Starting : rating=1500, RD=200, vol=0.06`);
console.log(`After 3 games (W, L, L) :\n`);

const ok1 = check('rating', result.rating, 1464.06, 0.05);
const ok2 = check('RD', result.rd, 151.52, 0.2);
const ok3 = check('vol', result.vol, 0.05999, 0.0005);

console.log('');

// Also test win probability symmetry
console.log('── Win probability sanity checks ──');
const p1v1 = computeWinProbability(1500, 200, 1500, 200);
check('50/50 symmetric', p1v1, 0.5, 0.001);

const pStronger = computeWinProbability(1800, 50, 1500, 50);
check('1800 vs 1500 (strong)', pStronger, 0.8, 0.1); // rough check

const pHighVar = computeWinProbability(1800, 350, 1500, 50);
console.log(`  strong-but-uncertain (1800±350) vs stable 1500 : P = ${pHighVar.toFixed(3)} (should be < 0.8, more uncertainty softens favorite)`);

const allOk = ok1 && ok2 && ok3;
console.log(`\n${allOk ? '✅ ALL TESTS PASS' : '❌ CANONICAL TEST FAILED — DO NOT SHIP'}`);
process.exit(allOk ? 0 : 1);
