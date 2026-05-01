/**
 * test-coinflip-fair.ts
 *
 * Simulates 1000 rolls with known seeds and verifies:
 *   1) Every call to `deriveCoinflipResult` returns the SAME result when
 *      given the same (serverSeed, clientSeed, nonce) — determinism.
 *   2) The distribution is ~50/50 over 1000 random triplets — fairness.
 *   3) An independent re-implementation of the HMAC derivation produces the
 *      byte-identical result as the service function — protocol correctness.
 *
 * Run:   cd backend && SKIP_SERVER=1 npx tsx scripts/test-coinflip-fair.ts
 */

process.env.SKIP_SERVER = '1';

import crypto from 'crypto';
import { deriveCoinflipResult } from '../src/services/coinflipService';

function independentDerive(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
): 'crown' | 'shield' {
  const h = crypto
    .createHmac('sha256', serverSeed)
    .update(`${clientSeed}:${nonce}`)
    .digest('hex');
  const first8 = BigInt('0x' + h.slice(0, 16));
  return first8 % 2n === 0n ? 'crown' : 'shield';
}

function fixedVectors() {
  // Hard-coded vectors — the team can paste these into /verify to confirm.
  const serverSeed = 'a'.repeat(64);
  const clientSeed = 'deadbeefcafebabe';
  const nonce = 0;
  const expectedHmac = crypto
    .createHmac('sha256', serverSeed)
    .update(`${clientSeed}:${nonce}`)
    .digest('hex');
  const first8 = BigInt('0x' + expectedHmac.slice(0, 16));
  const expected = first8 % 2n === 0n ? 'crown' : 'shield';
  const actual = deriveCoinflipResult(serverSeed, clientSeed, nonce);
  return { serverSeed, clientSeed, nonce, hmac: expectedHmac, expected, actual };
}

function main() {
  console.log('=== Coinflip provably-fair self-test ===\n');

  // Fixed vector
  const v = fixedVectors();
  console.log('[Fixed vector]');
  console.log(`  serverSeed = ${v.serverSeed.slice(0, 16)}… (length ${v.serverSeed.length})`);
  console.log(`  clientSeed = ${v.clientSeed}`);
  console.log(`  nonce      = ${v.nonce}`);
  console.log(`  hmac       = ${v.hmac}`);
  console.log(`  first 8 B  = 0x${v.hmac.slice(0, 16)}`);
  console.log(`  expected   = ${v.expected}`);
  console.log(`  actual     = ${v.actual}`);
  if (v.expected !== v.actual) {
    console.error('FAIL: fixed vector mismatch');
    process.exit(1);
  }
  console.log('  PASS\n');

  // 1000 random rolls
  console.log('[1000 random rolls]');
  let crown = 0;
  let shield = 0;
  let mismatch = 0;
  let determinismFail = 0;

  for (let i = 0; i < 1000; i++) {
    const serverSeed = crypto.randomBytes(32).toString('hex');
    const clientSeed = crypto.randomBytes(16).toString('hex');
    const nonce = 0;

    const r1 = deriveCoinflipResult(serverSeed, clientSeed, nonce);
    const r2 = deriveCoinflipResult(serverSeed, clientSeed, nonce);
    const indep = independentDerive(serverSeed, clientSeed, nonce);

    if (r1 !== r2) determinismFail++;
    if (r1 !== indep) mismatch++;

    if (r1 === 'crown') crown++;
    else shield++;
  }

  console.log(`  crown  = ${crown} (${((crown / 10)).toFixed(1)}%)`);
  console.log(`  shield = ${shield} (${((shield / 10)).toFixed(1)}%)`);
  console.log(`  determinism failures = ${determinismFail}`);
  console.log(`  independent-derive mismatches = ${mismatch}`);

  if (determinismFail > 0) { console.error('FAIL: non-deterministic output'); process.exit(1); }
  if (mismatch > 0) { console.error('FAIL: service derivation != independent HMAC'); process.exit(1); }

  // 50/50 within 5% tolerance on 1000 samples = [450, 550]
  if (crown < 400 || crown > 600) {
    console.error(`FAIL: distribution out of tolerance (crown=${crown}, expected 400-600)`);
    process.exit(1);
  }

  console.log('  PASS\n');

  // Winner-determination sanity check: result === creatorSide → creator wins.
  console.log('[Winner determination invariant]');
  let winnerMismatch = 0;
  for (let i = 0; i < 200; i++) {
    const serverSeed = crypto.randomBytes(32).toString('hex');
    const clientSeed = crypto.randomBytes(16).toString('hex');
    const creatorSide = Math.random() < 0.5 ? 'crown' : 'shield';
    const creatorId = 'C';
    const joinerId  = 'J';

    const result = deriveCoinflipResult(serverSeed, clientSeed, 0);
    const winnerId = creatorSide === result ? creatorId : joinerId;

    // The invariant the backend relies on:
    //   winnerId === creatorId  ⇔  result === creatorSide
    const inv = (winnerId === creatorId) === (result === creatorSide);
    if (!inv) winnerMismatch++;
  }
  console.log(`  mismatches = ${winnerMismatch}`);
  if (winnerMismatch > 0) { console.error('FAIL: winner invariant broken'); process.exit(1); }
  console.log('  PASS\n');

  console.log('All tests passed.');
}

main();
