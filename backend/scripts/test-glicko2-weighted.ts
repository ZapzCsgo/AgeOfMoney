/**
 * Test de l'extension weight dans Glicko-2.
 *
 * Attendu :
 * 1. Identité : weight = 1 → identique au Glicko standard.
 * 2. High weight : une S-tier loss (weight 4) doit faire chuter le rating
 *    ~4× plus qu'une C-tier loss (weight 1) contre le même opponent.
 * 3. Weight 0 : match ignoré (edge case, mais la fonction ne crash pas).
 */

import { computeUpdatedRating, TIER_WEIGHTS, tierWeight } from '../src/services/glicko2';

function check(label: string, actual: number, expected: number, tol = 0.01): boolean {
  const diff = Math.abs(actual - expected);
  const ok = diff <= tol;
  console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(40)} expected ${expected.toFixed(4)}, got ${actual.toFixed(4)}`);
  return ok;
}

console.log('\n── Test 1 : weight=1 ≡ Glicko vanilla (non-regression) ──');
const base = { rating: 1500, rd: 200, vol: 0.06 };
const match = { opponentRating: 1400, opponentRd: 30, score: 1 as const };
const vanilla = computeUpdatedRating(base, [match]);
const withWeight1 = computeUpdatedRating(base, [{ ...match, weight: 1.0 }]);
const t1a = check('rating identical', withWeight1.rating, vanilla.rating, 0.0001);
const t1b = check('RD identical', withWeight1.rd, vanilla.rd, 0.0001);

console.log('\n── Test 2 : high weight = plus d\'impact ──');
// Player at 1500 ± 200 perd contre un 1400 ± 30.
// En Glicko standard, rating baisse (perte inattendue).
// Avec weight 4, la baisse doit être beaucoup plus grande.
const lossMatch = { opponentRating: 1400, opponentRd: 30, score: 0 as const };
const stdLoss = computeUpdatedRating(base, [lossMatch]);
const s4Loss = computeUpdatedRating(base, [{ ...lossMatch, weight: 4.0 }]);
console.log(`  Standard loss (w=1) : rating ${stdLoss.rating.toFixed(1)}, RD ${stdLoss.rd.toFixed(1)}`);
console.log(`  S-tier loss (w=4)   : rating ${s4Loss.rating.toFixed(1)}, RD ${s4Loss.rd.toFixed(1)}`);
const t2 = stdLoss.rating > s4Loss.rating;
console.log(`  ${t2 ? '✓' : '✗'} ${'w=4 loss > w=1 loss (plus de chute)'.padEnd(40)} ${stdLoss.rating.toFixed(1)} vs ${s4Loss.rating.toFixed(1)}`);

console.log('\n── Test 3 : batch mixte weighted ──');
// Player joue 3 matchs de tiers différents
const mixed = [
  { opponentRating: 1400, opponentRd: 30, score: 1 as const, weight: TIER_WEIGHTS.S },      // W vs weak opp, S-tier (big impact)
  { opponentRating: 1550, opponentRd: 100, score: 0 as const, weight: TIER_WEIGHTS.B },    // L vs peer, B-tier (medium)
  { opponentRating: 1600, opponentRd: 80, score: 0 as const, weight: TIER_WEIGHTS.C },     // L vs slightly stronger, C-tier (small)
];
const mixedResult = computeUpdatedRating(base, mixed);
console.log(`  Mixed (S W, B L, C L) → rating ${mixedResult.rating.toFixed(1)}, RD ${mixedResult.rd.toFixed(1)}`);
console.log(`  Idem sans weight      → rating ${computeUpdatedRating(base, mixed.map(m => ({ ...m, weight: 1 }))).rating.toFixed(1)}`);

console.log('\n── Test 4 : TIER_WEIGHTS constants ──');
console.log(`  S          : ${tierWeight('S')}`);
console.log(`  Qualifier  : ${tierWeight('Qualifier')}`);
console.log(`  A          : ${tierWeight('A')}`);
console.log(`  B          : ${tierWeight('B')}`);
console.log(`  C          : ${tierWeight('C')}`);
console.log(`  Showmatch  : ${tierWeight('Showmatch')}`);
console.log(`  unknown    : ${tierWeight('unknown')}  (fallback)`);
console.log(`  null       : ${tierWeight(null)}        (fallback)`);

const allOk = t1a && t1b && t2;
console.log(`\n${allOk ? '✅ TESTS PASS' : '❌ TEST FAILED'}`);
process.exit(allOk ? 0 : 1);
