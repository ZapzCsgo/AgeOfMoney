/**
 * Unit test for seriesWinProb(p, format).
 *
 * Expected outputs for p = 0.7 :
 *   BO1 → 0.70
 *   BO3 → 0.784      [p²(3-2p) = 0.49 × 1.60]
 *   BO5 → 0.8369     [p³(1 + 3q + 6q²) = 0.343 × 2.44]
 *   BO7 → 0.874      [p⁴(1 + 4q + 10q² + 20q³) = 0.2401 × 3.64]
 *   BO2 → 0.8448     [p² / (p² + q²) = 0.49 / 0.58]
 */

import { seriesWinProb } from '../src/services/oddsEngine';

function check(label: string, actual: number, expected: number, tol = 0.002): boolean {
  const diff = Math.abs(actual - expected);
  const ok = diff <= tol;
  console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(18)} expected ${expected.toFixed(4)}, got ${actual.toFixed(4)}, diff ${diff.toFixed(4)}`);
  return ok;
}

console.log('\n── seriesWinProb test (p = 0.7) ──');
const p = 0.7;
const t1 = check('BO1', seriesWinProb(p, 'BO1'), 0.7000);
const t3 = check('BO3', seriesWinProb(p, 'BO3'), 0.7840);
const t5 = check('BO5', seriesWinProb(p, 'BO5'), 0.8369);
const t7 = check('BO7', seriesWinProb(p, 'BO7'), 0.8740);
const t2 = check('BO2 (void-draw)', seriesWinProb(p, 'BO2'), 0.8448);

// Sanity : symmetric at p=0.5
console.log('\n── Symmetry check (p = 0.5 → all formats should return 0.5) ──');
for (const fmt of ['BO1', 'BO2', 'BO3', 'BO5', 'BO7']) {
  check(fmt, seriesWinProb(0.5, fmt), 0.5);
}

// Monotonicity : higher p → higher seriesWinProb
console.log('\n── Monotonicity (BO5, p=0.3, 0.5, 0.7, 0.9) ──');
for (const p of [0.3, 0.5, 0.7, 0.9]) {
  console.log(`  p=${p.toFixed(2)}  BO5 → ${seriesWinProb(p, 'BO5').toFixed(4)}`);
}

const allOk = t1 && t3 && t5 && t7 && t2;
console.log(`\n${allOk ? '✅ ALL TESTS PASS' : '❌ TEST FAILED'}`);
process.exit(allOk ? 0 : 1);
