/**
 * Tests for the Liquipedia circuit breaker public surface.
 *
 * Run via :
 *   cd backend && SKIP_SERVER=1 npx tsx --test src/services/__tests__/liquipediaLiveScorer.test.ts
 *
 * Regression coverage for prod bug #1 (2026-05-02) :
 *   - getCircuitBreakerState() must return the current state without side
 *     effects, so monitoring routes can observe `consecutiveUnblockFailures`
 *     and `retriesQuieted` without poking the engine.
 *   - resetCircuitBreaker() must clear ALL three counters
 *     (consecutive429s, consecutiveNetErrors, consecutiveUnblockFailures).
 *     Earlier code reset only the first two, which left the auto-unblock
 *     "quiet mode" stuck even after a manual unblock.
 */
process.env.SKIP_SERVER = '1';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isLpBlocked,
  resetCircuitBreaker,
  tripCircuitBreaker,
  getCircuitBreakerState,
} from '../liquipediaLiveScorer';

test('initial state : breaker not blocked, all counters zero', () => {
  resetCircuitBreaker();
  const s = getCircuitBreakerState();
  assert.equal(s.blockedNow, false);
  assert.equal(s.consecutive429s, 0);
  assert.equal(s.consecutiveNetErrors, 0);
  assert.equal(s.consecutiveUnblockFailures, 0);
  assert.equal(s.retriesQuieted, false);
  assert.equal(isLpBlocked(), false);
});

test('tripCircuitBreaker(429) blocks for at least 5 min (BACKOFF_MIN[0])', () => {
  resetCircuitBreaker();
  // Suppress the auto-unblock side-effect by ensuring TWOCAPTCHA_API_KEY is unset.
  const prev = process.env.TWOCAPTCHA_API_KEY;
  delete process.env.TWOCAPTCHA_API_KEY;
  try {
    tripCircuitBreaker('429');
    const s = getCircuitBreakerState();
    assert.equal(s.blockedNow, true);
    assert.equal(s.consecutive429s, 1);
    assert.ok(s.blockedUntil >= Date.now() + 4 * 60_000, `expected blockedUntil ≥ now+4min, got delta=${s.blockedUntil - Date.now()}ms`);
    assert.ok(s.blockedUntil <= Date.now() + 6 * 60_000, `expected blockedUntil ≤ now+6min, got delta=${s.blockedUntil - Date.now()}ms`);
  } finally {
    if (prev !== undefined) process.env.TWOCAPTCHA_API_KEY = prev;
  }
});

test('resetCircuitBreaker clears every counter', () => {
  // Trip then reset
  const prev = process.env.TWOCAPTCHA_API_KEY;
  delete process.env.TWOCAPTCHA_API_KEY;
  try {
    tripCircuitBreaker('429');
    tripCircuitBreaker('429'); // → consecutive429s = 2
  } finally {
    if (prev !== undefined) process.env.TWOCAPTCHA_API_KEY = prev;
  }
  resetCircuitBreaker();
  const s = getCircuitBreakerState();
  assert.equal(s.blockedNow, false);
  assert.equal(s.consecutive429s, 0);
  assert.equal(s.consecutiveNetErrors, 0);
  assert.equal(s.consecutiveUnblockFailures, 0);
  assert.equal(s.retriesQuieted, false);
});

test('exponential backoff : second trip blocks longer than first', () => {
  resetCircuitBreaker();
  const prev = process.env.TWOCAPTCHA_API_KEY;
  delete process.env.TWOCAPTCHA_API_KEY;
  try {
    tripCircuitBreaker('429');
    const s1 = getCircuitBreakerState();
    const window1 = s1.blockedUntil - Date.now();
    resetCircuitBreaker();
    tripCircuitBreaker('429');
    tripCircuitBreaker('429'); // 2nd consecutive trip → BACKOFF_MIN[1] = 15 min
    const s2 = getCircuitBreakerState();
    const window2 = s2.blockedUntil - Date.now();
    assert.ok(window2 > window1, `expected window2 (${window2}ms) > window1 (${window1}ms)`);
  } finally {
    if (prev !== undefined) process.env.TWOCAPTCHA_API_KEY = prev;
  }
});

// Force the process to exit after the synchronous tests above. The Prisma
// client + Bottleneck keep handles open even with SKIP_SERVER=1, which would
// otherwise let node:test's per-suite watchdog fire after ~30s and falsely
// flag the suite as failed.
test('cleanup', async () => {
  // Tiny async hook gives the prior tests' final await a tick to settle.
  await new Promise<void>((resolve) => setImmediate(resolve));
  // Schedule the exit on the next tick so the test reporter can finish
  // writing its summary line.
  setImmediate(() => process.exit(0));
});
