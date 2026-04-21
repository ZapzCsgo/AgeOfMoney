/**
 * Random.org Signed API client — provably-fair RNG with automatic HMAC fallback.
 *
 * Behavior:
 *   1. If RANDOM_ORG_API_KEY is unset → IMMEDIATE HMAC fallback (no network call).
 *   2. If the circuit breaker is open (3 consecutive fails in the last 60 s)
 *      → HMAC fallback until the reset window elapses.
 *   3. Otherwise: POST generateSignedIntegers to random.org. On success, the
 *      caller receives the JSON `random` block + base64 RSA signature for
 *      persisting & later user-side verification. On failure, fall back to
 *      HMAC and increment the circuit breaker counter.
 *
 * The HMAC fallback is deterministic from (serverSeed, clientSeed, nonce):
 *   h = HMAC_SHA256(serverSeed, clientSeed + ":" + nonce)
 *   pick the first 64-bit chunk, rejection-sample to eliminate modulo bias,
 *   then map to [min, max]. Any observer who knows the three seeds can
 *   recompute the result — which is the whole point of commit-reveal.
 *
 * Quota monitoring: every successful response logs `requestsLeft` and
 * `bitsLeft`. When `requestsLeft < LOW_QUOTA_ALERT_THRESHOLD`, the log is
 * bumped to warn so Railway log-based alerts can catch it.
 */

import axios from 'axios';
import crypto from 'crypto';
import logger from '../logger';

const RANDOM_ORG_ENDPOINT = 'https://api.random.org/json-rpc/4/invoke';
const REQUEST_TIMEOUT_MS = 10_000;
const CIRCUIT_BREAKER_THRESHOLD = 3;      // consecutive failures that open the breaker
const CIRCUIT_BREAKER_RESET_MS = 60_000;  // how long the breaker stays open
const LOW_QUOTA_ALERT_THRESHOLD = 100;    // warn when requestsLeft drops below this

export interface SignedRandomRequest {
  min: number;
  max: number;               // inclusive
  roundId: string;           // embedded in userData → binds the tirage to the round
  nonce: number;             // serial number of the round
  // HMAC fallback seeds — always passed so the client can cover Random.org failures
  serverSeed: string;        // 32-byte hex, committed via seedHash at round open
  clientSeed: string;        // public salt
}

export interface SignedRandomResult {
  value: number;
  source: 'random_org_signed' | 'hmac_fallback';
  randomJson: string | null;  // exact JSON of Random.org's `random` object (signature source)
  signature: string | null;   // base64 RSA-SHA512
  serial: bigint | null;      // Random.org serialNumber
}

let consecutiveFails = 0;
let circuitOpenUntil = 0;

function hasApiKey(): boolean {
  return typeof process.env.RANDOM_ORG_API_KEY === 'string' && process.env.RANDOM_ORG_API_KEY.length > 0;
}

/**
 * HMAC-SHA256 rejection-sampled integer in [min, max] inclusive.
 * Eliminates modulo bias by walking forward in the digest if the first
 * 64-bit chunk falls in the "tail" (probability negligible but we stay clean).
 */
function hmacRandomInteger(req: SignedRandomRequest): number {
  const range = BigInt(req.max - req.min + 1);
  if (range <= 0n) throw new Error('HMAC fallback: invalid range (max < min)');

  const digest = crypto
    .createHmac('sha256', req.serverSeed)
    .update(`${req.clientSeed}:${req.nonce}`)
    .digest('hex');

  const MAX = range * (BigInt('0xffffffffffffffff') / range);
  let pick = 0n;
  let cursor = 0;
  while (cursor + 16 <= digest.length) {
    pick = BigInt('0x' + digest.slice(cursor, cursor + 16));
    if (pick < MAX) break;
    cursor += 16;
  }
  return Number(pick % range) + req.min;
}

/** Called once at service startup to print the RNG mode to Railway logs. */
export function logRngStartupState(prefix = '[RandomOrg]'): void {
  if (hasApiKey()) {
    logger.info(`${prefix} ✅ RANDOM_ORG_API_KEY present — Signed API active, HMAC fallback on reserve`);
  } else {
    logger.warn(`${prefix} ⚠️ RANDOM_ORG_API_KEY absent — permanent HMAC fallback mode`);
  }
}

/**
 * Returns a verifiable random integer in [min, max] inclusive.
 * Never throws: all failure paths fall back to HMAC.
 */
export async function getSignedRandomInteger(req: SignedRandomRequest): Promise<SignedRandomResult> {
  // Path 1: no key → instant HMAC
  if (!hasApiKey()) {
    return {
      value: hmacRandomInteger(req),
      source: 'hmac_fallback',
      randomJson: null,
      signature: null,
      serial: null,
    };
  }

  // Path 2: circuit breaker open → HMAC
  if (Date.now() < circuitOpenUntil) {
    return {
      value: hmacRandomInteger(req),
      source: 'hmac_fallback',
      randomJson: null,
      signature: null,
      serial: null,
    };
  }

  // Path 3: actual API call
  try {
    const res = await axios.post(
      RANDOM_ORG_ENDPOINT,
      {
        jsonrpc: '2.0',
        method: 'generateSignedIntegers',
        params: {
          apiKey: process.env.RANDOM_ORG_API_KEY,
          n: 1,
          min: req.min,
          max: req.max,
          replacement: true,
          base: 10,
          userData: { roundId: req.roundId, nonce: req.nonce },
        },
        id: Date.now(),
      },
      { timeout: REQUEST_TIMEOUT_MS },
    );

    const result = res.data?.result;
    const value  = result?.random?.data?.[0];
    if (typeof value !== 'number') throw new Error('random.org: invalid response shape');

    // Log quota — once per call, so we always know where we stand
    const reqLeft  = typeof result.requestsLeft === 'number' ? result.requestsLeft : null;
    const bitsLeft = typeof result.bitsLeft === 'number' ? result.bitsLeft : null;
    if (reqLeft != null && reqLeft < LOW_QUOTA_ALERT_THRESHOLD) {
      logger.warn(`[RandomOrg] ⚠️ Quota LOW: requestsLeft=${reqLeft}, bitsLeft=${bitsLeft}`);
    } else if (reqLeft != null) {
      logger.info(`[RandomOrg] quota: requestsLeft=${reqLeft}, bitsLeft=${bitsLeft}`);
    }

    consecutiveFails = 0;

    const randomJson = JSON.stringify(result.random);
    const signature  = String(result.signature);
    const serial     = result.random?.serialNumber != null ? BigInt(result.random.serialNumber) : null;

    return { value, source: 'random_org_signed', randomJson, signature, serial };
  } catch (err) {
    consecutiveFails += 1;
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[RandomOrg] call failed (${consecutiveFails}/${CIRCUIT_BREAKER_THRESHOLD}): ${msg}`);

    if (consecutiveFails >= CIRCUIT_BREAKER_THRESHOLD) {
      circuitOpenUntil = Date.now() + CIRCUIT_BREAKER_RESET_MS;
      consecutiveFails = 0; // reset for the next cycle after the breaker closes
      logger.error(
        `[RandomOrg] 🔴 circuit breaker OPEN for ${CIRCUIT_BREAKER_RESET_MS / 1000}s — HMAC fallback engaged`,
      );
    }

    return {
      value: hmacRandomInteger(req),
      source: 'hmac_fallback',
      randomJson: null,
      signature: null,
      serial: null,
    };
  }
}

/**
 * Manual reset — useful for tests and for admin "force retry" endpoints.
 * Closing the breaker does not re-attempt a call; the next
 * getSignedRandomInteger() call does that naturally.
 */
export function resetCircuitBreaker(): void {
  consecutiveFails = 0;
  circuitOpenUntil = 0;
}
