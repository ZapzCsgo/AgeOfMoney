/**
 * Sanity tests for exactScore Monte Carlo. Run via:
 *   cd backend && npx tsx --test src/services/odds/__tests__/exactScore.test.ts
 *
 * Uses node's built-in test runner; no jest/vitest dependency needed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  simulateExactScore, analyticalExactScore, legalScores, winsToClinch,
} from '../exactScore';

test('legalScores BO3 returns 4 scores (2-0,0-2,2-1,1-2)', () => {
  const ls = legalScores('BO3').sort();
  assert.deepEqual(ls, ['0-2', '1-2', '2-0', '2-1']);
});

test('legalScores BO5 returns 6 scores', () => {
  assert.equal(legalScores('BO5').length, 6);
});

test('winsToClinch maps formats correctly', () => {
  assert.equal(winsToClinch('BO3'), 2);
  assert.equal(winsToClinch('BO5'), 3);
  assert.equal(winsToClinch('BO7'), 4);
});

test('analyticalExactScore at p=0.5 BO3 sums to 1', () => {
  const dist = analyticalExactScore(0.5, 'BO3');
  const sum = Object.values(dist).reduce<number>((a, b) => a + (b ?? 0), 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `sum=${sum}`);
});

test('analyticalExactScore at p=0.5 BO3 is symmetric', () => {
  const dist = analyticalExactScore(0.5, 'BO3');
  assert.ok(Math.abs((dist['2-0'] ?? 0) - (dist['0-2'] ?? 0)) < 1e-9);
  assert.ok(Math.abs((dist['2-1'] ?? 0) - (dist['1-2'] ?? 0)) < 1e-9);
});

test('analyticalExactScore at p=0.7 BO3 matches expected', () => {
  const dist = analyticalExactScore(0.7, 'BO3');
  // P(2-0) = p^2 = 0.49
  assert.ok(Math.abs((dist['2-0'] ?? 0) - 0.49) < 1e-9);
  // P(2-1) = C(2,1) * p^2 * q = 2 * 0.49 * 0.3 = 0.294
  assert.ok(Math.abs((dist['2-1'] ?? 0) - 0.294) < 1e-9);
  // P(0-2) = q^2 = 0.09
  assert.ok(Math.abs((dist['0-2'] ?? 0) - 0.09) < 1e-9);
  // P(1-2) = C(2,1) * q^2 * p = 2 * 0.09 * 0.7 = 0.126
  assert.ok(Math.abs((dist['1-2'] ?? 0) - 0.126) < 1e-9);
});

test('simulateExactScore is deterministic given seed', () => {
  const a = simulateExactScore({ pPerGame: 0.6, format: 'BO5', simCount: 5_000, seed: 42 });
  const b = simulateExactScore({ pPerGame: 0.6, format: 'BO5', simCount: 5_000, seed: 42 });
  assert.deepEqual(a, b);
});

test('simulateExactScore @50k sims approximates analytical (BO3 p=0.65)', () => {
  const sim = simulateExactScore({ pPerGame: 0.65, format: 'BO3', simCount: 50_000, seed: 1 });
  const ana = analyticalExactScore(0.65, 'BO3');
  for (const k of legalScores('BO3')) {
    const diff = Math.abs((sim[k] ?? 0) - (ana[k] ?? 0));
    assert.ok(diff < 0.01, `key=${k} sim=${sim[k]} ana=${ana[k]} diff=${diff}`);
  }
});

test('simulateExactScore distribution sums to ~1', () => {
  const dist = simulateExactScore({ pPerGame: 0.4, format: 'BO7', simCount: 10_000, seed: 7 });
  const sum = Object.values(dist).reduce<number>((a, b) => a + (b ?? 0), 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});

test('perMapProb override is honored', () => {
  // 3 maps where P1 always wins → series ends 2-0 deterministically
  const dist = simulateExactScore({
    pPerGame: 0.5, format: 'BO3', simCount: 1_000, seed: 99,
    perMapProb: [1, 1, 1],
  });
  assert.equal(dist['2-0'], 1);
});
