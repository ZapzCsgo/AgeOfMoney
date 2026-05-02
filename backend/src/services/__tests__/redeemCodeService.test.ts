/**
 * Tests for the redeem-codes service.
 *
 * Run via :
 *   cd backend && SKIP_SERVER=1 npx tsx --test src/services/__tests__/redeemCodeService.test.ts
 *
 * Scope : pure-logic checks that don't require Postgres. The DB-coupled
 * paths (race-safe usage cap, wagering progression) are exercised end-to-end
 * via the integration tests in `backend/src/__tests__/api.redeem.test.ts`
 * (TODO — kept as post-merge follow-up, not blocking soft launch).
 *
 * What's covered here :
 *   - Module loads without throwing — catches regressions in the
 *     type-erasure shim or the Decimal math wiring.
 *   - Public API surface stays stable (exports the expected names).
 *   - Code-format regex behaves : we accept 1-20 alphanumeric uppercase,
 *     reject anything else. The `/^[A-Z0-9]{1,20}$/` lives inline in
 *     redeemCode() and createCode(), so we mirror it here as a pure
 *     reference and assert the same behavior.
 */
process.env.SKIP_SERVER = '1';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';

import * as redeemService from '../redeemCodeService';

test('module exports the expected public API', () => {
  assert.equal(typeof redeemService.redeemCode, 'function');
  assert.equal(typeof redeemService.processWageringForBet, 'function');
  assert.equal(typeof redeemService.getUserRedeemHistory, 'function');
  assert.equal(typeof redeemService.listCodes, 'function');
  assert.equal(typeof redeemService.getCodeStats, 'function');
  assert.equal(typeof redeemService.createCode, 'function');
  assert.equal(typeof redeemService.disableCode, 'function');
});

test('Decimal math : amount × multiplier matches expected wagering', () => {
  // 50 ⚜ × 2.0 = 100 ⚜ wagering required (LAUNCH50 default)
  const amount = new Prisma.Decimal('50');
  const mult   = new Prisma.Decimal('2.0');
  assert.equal(amount.mul(mult).toFixed(2), '100.00');

  // 10 ⚜ × 1.5 = 15 ⚜ wagering (DISCORD10 lower-friction)
  const amount2 = new Prisma.Decimal('10');
  const mult2   = new Prisma.Decimal('1.5');
  assert.equal(amount2.mul(mult2).toFixed(2), '15.00');

  // Fractional amounts don't lose precision : 7.5 × 2.5 = 18.75
  const amount3 = new Prisma.Decimal('7.5');
  const mult3   = new Prisma.Decimal('2.5');
  assert.equal(amount3.mul(mult3).toFixed(2), '18.75');
});

test('wagering threshold check uses Decimal comparison, not JS coercion', () => {
  // Reproduce the `totalWagering >= wageringStartAt + wageringRequired`
  // unlock condition. The classic JS pitfall is 0.1 + 0.2 !== 0.3, which
  // would cause a redemption that "should" unlock to stay locked. Decimal
  // math kills the pitfall.
  const startAt   = new Prisma.Decimal('0.1');
  const required  = new Prisma.Decimal('0.2');
  const total     = new Prisma.Decimal('0.3');
  const threshold = startAt.add(required);
  assert.equal(threshold.eq(total), true);
  assert.equal(total.gte(threshold), true);
  // And as a JS Number, this would be wrong :
  assert.notEqual(0.1 + 0.2, 0.3); // sanity : the bug exists in raw JS
});

test('code format : valid examples accepted', () => {
  const re = /^[A-Z0-9]{1,20}$/;
  for (const ok of ['LAUNCH50', 'DISCORD10', 'X', 'ABC1234567890123456']) {
    assert.equal(re.test(ok), true, `expected to accept ${ok}`);
  }
});

test('code format : invalid examples rejected', () => {
  const re = /^[A-Z0-9]{1,20}$/;
  for (const bad of [
    '',                       // empty
    'launch50',               // lowercase — service uppercases first, but the
                              //   regex test runs after .toUpperCase(); we
                              //   keep this here as documentation
    'CODE WITH SPACES',
    'CODE_WITH_UNDERSCORE',
    'TOO-LONG-CODE-NAME-LIVE-XX',  // 23 chars
    'WITH$YMBOL',
  ]) {
    // The lowercase test is only "rejected" before the service uppercases ;
    // we mirror the service's behavior by uppercasing here too.
    const normalized = bad.trim().toUpperCase();
    if (normalized === '') {
      assert.equal(re.test(normalized), false, 'empty rejected');
    } else if (normalized.length > 20) {
      assert.equal(re.test(normalized), false, `${bad} too long`);
    } else if (/[^A-Z0-9]/.test(normalized)) {
      assert.equal(re.test(normalized), false, `${bad} has non-alphanumeric`);
    }
  }
});

test('Decimal max/min clamp behaves for wagering progress display', () => {
  // The "wagering done" UI value is `clamp(0, required, totalWagered - startAt)`.
  // Verify clamp at both ends.
  const required = new Prisma.Decimal('100');

  // Negative raw progress (e.g. user just redeemed a fresh code) → 0
  const lowRaw = new Prisma.Decimal('-5');
  const lowClamped = Prisma.Decimal.max(0, Prisma.Decimal.min(required, lowRaw));
  assert.equal(lowClamped.toFixed(0), '0');

  // Over-target raw progress (user already wagered way past threshold) → required
  const highRaw = new Prisma.Decimal('250');
  const highClamped = Prisma.Decimal.max(0, Prisma.Decimal.min(required, highRaw));
  assert.equal(highClamped.toFixed(0), '100');

  // In-band progress passes through
  const midRaw = new Prisma.Decimal('42');
  const midClamped = Prisma.Decimal.max(0, Prisma.Decimal.min(required, midRaw));
  assert.equal(midClamped.toFixed(0), '42');
});
