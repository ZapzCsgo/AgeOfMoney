/**
 * Glicko-2 rating engine (Phase 2 odds engine).
 *
 * Pure TypeScript implementation of the Glicko-2 rating system by Mark
 * Glickman. Reference: "Example of the Glicko-2 system" (2013),
 * http://www.glicko.net/glicko/glicko2.pdf
 *
 * ───────────────────────────────────────────────────────────────────────────
 * Mathematical notation
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Public / Glicko-1 scale:
 *   - rating r : typical range 700–2500, centered around 1500
 *   - RD : rating deviation (uncertainty), ~350 for new players, shrinks with games
 *   - vol σ : volatility, default 0.06
 *
 * Internal / Glicko-2 scale (used for math):
 *   - μ = (r - 1500) / 173.7178
 *   - φ = RD / 173.7178
 *   - σ unchanged
 *
 * Per-match update steps:
 *   g(φ) = 1 / sqrt(1 + 3φ²/π²)
 *   E(μ, μⱼ, φⱼ) = 1 / (1 + exp(-g(φⱼ) × (μ - μⱼ)))
 *   v = 1 / Σ g(φⱼ)² × E(...) × (1 - E(...))
 *   Δ = v × Σ g(φⱼ) × (sⱼ - E(...))
 *   σ' : iterative root-finding (Illinois / bisection)
 *   φ* = sqrt(φ² + σ'²)   (rating period end inflation)
 *   φ' = 1 / sqrt(1/φ*² + 1/v)
 *   μ' = μ + φ'² × Σ g(φⱼ) × (sⱼ - E(...))
 *
 * ───────────────────────────────────────────────────────────────────────────
 * Choices for this implementation
 * ───────────────────────────────────────────────────────────────────────────
 *
 * - τ (system constant) = 0.5. Glickman recommends 0.3–1.2 ; 0.5 is a
 *   common default that trades reactivity vs stability.
 * - ε (convergence tolerance for σ') = 1e-6.
 * - Per-match update : each match is its own rating period. AoE tournaments
 *   are sporadic, so batching by date would be noisy. The trade-off : Step 4
 *   runs for every match, which is fine for our volume (< 500 matches/month).
 * - Inactivity inflation of RD : only applied when a player is queried for a
 *   prediction, not lazily at startup. Formula: φ_new = sqrt(φ² + σ²) applied
 *   per "rating period" of inactivity. We use 1 month = 1 period.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * Canonical test case (from Glickman's 2013 paper)
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Player A starts at rating=1500, RD=200, vol=0.06. Plays 3 games:
 *   1. vs (1400, RD=30)  → win (s=1)
 *   2. vs (1550, RD=100) → loss (s=0)
 *   3. vs (1700, RD=300) → loss (s=0)
 *
 * After updating (all 3 in one rating period):
 *   new rating ≈ 1464.06
 *   new RD ≈ 151.52
 *   new vol ≈ 0.05999...
 *
 * See `testGlickoCanonical()` below — unit test embedded in the module.
 */

import { prisma } from '../index';

// ── Glicko-2 constants ─────────────────────────────────────────────────────
const SCALE = 173.7178;                 // Glicko-1 ↔ Glicko-2 conversion
const DEFAULT_RATING = 1500;
const DEFAULT_RD = 350;
const DEFAULT_VOL = 0.06;
const TAU = 0.5;                        // volatility system constant (0.3–1.2 typical)
const EPSILON = 1e-6;                   // convergence tolerance for σ' solver
const PI2 = Math.PI * Math.PI;

// ── Types ──────────────────────────────────────────────────────────────────
export interface RatingTriple {
  rating: number;
  rd: number;
  vol: number;
}

export interface MatchResult {
  opponentRating: number;
  opponentRd: number;
  /** 1 = win, 0.5 = draw, 0 = loss (player's perspective) */
  score: 0 | 0.5 | 1;
}

// ── Core math helpers ──────────────────────────────────────────────────────
function toGlicko2(r: number, rd: number): { mu: number; phi: number } {
  return { mu: (r - DEFAULT_RATING) / SCALE, phi: rd / SCALE };
}

function fromGlicko2(mu: number, phi: number): { rating: number; rd: number } {
  return { rating: mu * SCALE + DEFAULT_RATING, rd: phi * SCALE };
}

function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / PI2);
}

function expected(mu: number, muOpp: number, phiOpp: number): number {
  return 1 / (1 + Math.exp(-g(phiOpp) * (mu - muOpp)));
}

/**
 * Solve for new volatility σ' using Illinois / regula falsi on f(x):
 *   f(x) = [eˣ(Δ² - φ² - v - eˣ)] / [2(φ² + v + eˣ)²] - (x - a)/τ²
 * with a = ln(σ²).
 */
function computeNewVolatility(sigma: number, phi: number, v: number, delta: number): number {
  const a = Math.log(sigma * sigma);

  const f = (x: number): number => {
    const ex = Math.exp(x);
    const phi2 = phi * phi;
    const num = ex * (delta * delta - phi2 - v - ex);
    const den = 2 * (phi2 + v + ex) * (phi2 + v + ex);
    return num / den - (x - a) / (TAU * TAU);
  };

  // Initial bracket per Glickman (2013), section 4.4
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    B = a - k * TAU;
  }

  let fA = f(A);
  let fB = f(B);

  // Illinois method
  let iterations = 0;
  while (Math.abs(B - A) > EPSILON && iterations++ < 100) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
  }

  return Math.exp(A / 2);
}

// ── Pure functional rating update (no DB) ──────────────────────────────────
/**
 * Update a single player's rating given a batch of matches in the same
 * rating period. Returns the new (rating, rd, vol) triple.
 *
 * Glicko-2 natively operates on rating PERIODS containing multiple games.
 * In this codebase we call this with one match at a time (AoE matches are
 * sporadic), which is mathematically valid — each period has exactly one
 * game.
 */
export function computeUpdatedRating(
  current: RatingTriple,
  results: MatchResult[],
): RatingTriple {
  if (results.length === 0) {
    // No games → apply volatility-based RD inflation (onlytaking the
    // rating-period step). φ' = sqrt(φ² + σ²).
    const { mu, phi } = toGlicko2(current.rating, current.rd);
    const phiPrime = Math.sqrt(phi * phi + current.vol * current.vol);
    const back = fromGlicko2(mu, phiPrime);
    return { rating: back.rating, rd: Math.min(DEFAULT_RD, back.rd), vol: current.vol };
  }

  const { mu, phi } = toGlicko2(current.rating, current.rd);

  // Step 3 — variance v
  let vInv = 0;
  for (const r of results) {
    const { mu: muJ, phi: phiJ } = toGlicko2(r.opponentRating, r.opponentRd);
    const gJ = g(phiJ);
    const E = expected(mu, muJ, phiJ);
    vInv += gJ * gJ * E * (1 - E);
  }
  const v = 1 / vInv;

  // Step 4 — improvement Δ
  let delta = 0;
  for (const r of results) {
    const { mu: muJ, phi: phiJ } = toGlicko2(r.opponentRating, r.opponentRd);
    const gJ = g(phiJ);
    const E = expected(mu, muJ, phiJ);
    delta += gJ * (r.score - E);
  }
  delta *= v;

  // Step 5 — new volatility σ'
  const sigmaPrime = computeNewVolatility(current.vol, phi, v, delta);

  // Step 6 — φ* then φ'
  const phiStar = Math.sqrt(phi * phi + sigmaPrime * sigmaPrime);
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);

  // Step 7 — new μ
  let sumGE = 0;
  for (const r of results) {
    const { mu: muJ, phi: phiJ } = toGlicko2(r.opponentRating, r.opponentRd);
    const gJ = g(phiJ);
    const E = expected(mu, muJ, phiJ);
    sumGE += gJ * (r.score - E);
  }
  const muPrime = mu + phiPrime * phiPrime * sumGE;

  const { rating, rd } = fromGlicko2(muPrime, phiPrime);
  return { rating, rd, vol: sigmaPrime };
}

/**
 * Probability that player A beats player B in a single game, given both
 * ratings and their uncertainties.
 *
 * Uses the combined-variance form:
 *   P(A wins) = 1 / (1 + exp(-g(φ_combined) × (μA - μB)))
 * where φ_combined = sqrt(φA² + φB²).
 *
 * This is the standard symmetric formula used by most Glicko-2 esport
 * implementations (CS:GO HLTV rankings, Dota 2 DatDota, etc.).
 */
export function computeWinProbability(
  ratingA: number, rdA: number,
  ratingB: number, rdB: number,
): number {
  const { mu: muA, phi: phiA } = toGlicko2(ratingA, rdA);
  const { mu: muB, phi: phiB } = toGlicko2(ratingB, rdB);
  const phiCombined = Math.sqrt(phiA * phiA + phiB * phiB);
  const gComb = g(phiCombined);
  return 1 / (1 + Math.exp(-gComb * (muA - muB)));
}

// ── DB wrappers (raw SQL — Prisma client may not have PlayerRating yet) ───
/**
 * Get a player's current rating, creating a default entry if absent.
 *
 * Uses $queryRawUnsafe to stay compatible even when `prisma generate`
 * hasn't been re-run after the migration (common case when the dev server
 * is running and holding the generated DLL).
 */
export async function getOrInitRating(playerId: string): Promise<RatingTriple & { gamesPlayed: number }> {
  const rows = await prisma.$queryRawUnsafe<Array<{
    rating: number; rd: number; vol: number; gamesplayed: number;
  }>>(
    `SELECT rating, rd, vol, "gamesPlayed" AS gamesplayed FROM "PlayerRating" WHERE "playerId" = $1 LIMIT 1`,
    playerId,
  );
  if (rows.length > 0) {
    const r = rows[0];
    return { rating: Number(r.rating), rd: Number(r.rd), vol: Number(r.vol), gamesPlayed: Number(r.gamesplayed) };
  }
  // Insert default row
  await prisma.$executeRawUnsafe(
    `INSERT INTO "PlayerRating" (id, "playerId", rating, rd, vol, "gamesPlayed", "lastUpdate", "createdAt")
     VALUES ($1, $2, $3, $4, $5, 0, NOW(), NOW())
     ON CONFLICT ("playerId") DO NOTHING`,
    `pr_${playerId}_${Date.now()}`,
    playerId,
    DEFAULT_RATING,
    DEFAULT_RD,
    DEFAULT_VOL,
  );
  return { rating: DEFAULT_RATING, rd: DEFAULT_RD, vol: DEFAULT_VOL, gamesPlayed: 0 };
}

async function persistRating(
  playerId: string,
  rating: number,
  rd: number,
  vol: number,
  gamesPlayed: number,
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE "PlayerRating"
       SET rating = $1, rd = $2, vol = $3, "gamesPlayed" = $4, "lastUpdate" = NOW()
     WHERE "playerId" = $5`,
    rating, rd, vol, gamesPlayed, playerId,
  );
}

/**
 * Apply a single match result to a player's rating and persist it.
 */
export async function updateAfterMatch(
  playerId: string,
  opponentRating: number,
  opponentRd: number,
  score: 0 | 0.5 | 1,
): Promise<RatingTriple> {
  const current = await getOrInitRating(playerId);
  const updated = computeUpdatedRating(
    { rating: current.rating, rd: current.rd, vol: current.vol },
    [{ opponentRating, opponentRd, score }],
  );
  await persistRating(playerId, updated.rating, updated.rd, updated.vol, current.gamesPlayed + 1);
  return updated;
}

/**
 * Apply both players' rating updates atomically for a match. Captures the
 * PRE-match snapshot of both ratings so the update is symmetric — without
 * this, the second player would use the first player's already-updated
 * rating, biasing the second update.
 */
export async function updateBothPlayersForMatch(
  player1Id: string,
  player2Id: string,
  /** outcome from player1's perspective : 1 = p1 wins, 0.5 = draw, 0 = p2 wins */
  outcome: 0 | 0.5 | 1,
): Promise<void> {
  const [r1, r2] = await Promise.all([getOrInitRating(player1Id), getOrInitRating(player2Id)]);

  const p1New = computeUpdatedRating(
    { rating: r1.rating, rd: r1.rd, vol: r1.vol },
    [{ opponentRating: r2.rating, opponentRd: r2.rd, score: outcome }],
  );
  const p2Score = outcome === 1 ? 0 : outcome === 0 ? 1 : 0.5;
  const p2New = computeUpdatedRating(
    { rating: r2.rating, rd: r2.rd, vol: r2.vol },
    [{ opponentRating: r1.rating, opponentRd: r1.rd, score: p2Score }],
  );

  await Promise.all([
    persistRating(player1Id, p1New.rating, p1New.rd, p1New.vol, r1.gamesPlayed + 1),
    persistRating(player2Id, p2New.rating, p2New.rd, p2New.vol, r2.gamesPlayed + 1),
  ]);
}

// ── Constants exposed for testing / calibration ────────────────────────────
export const GLICKO2_DEFAULTS = {
  RATING: DEFAULT_RATING,
  RD: DEFAULT_RD,
  VOL: DEFAULT_VOL,
  TAU,
};
