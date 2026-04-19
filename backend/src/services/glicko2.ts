/**
 * Glicko-2 PURE math module — no DB, no side effects. Import this in
 * scripts that need the rating formulas without booting the full backend
 * (cron jobs, socket.io, etc. that get triggered by importing from
 * `../index`).
 *
 * Reference: Mark Glickman, "Example of the Glicko-2 system" (2013).
 * http://www.glicko.net/glicko/glicko2.pdf
 */

const SCALE = 173.7178;
export const DEFAULT_RATING = 1500;
export const DEFAULT_RD = 350;
export const DEFAULT_VOL = 0.06;
const TAU = 0.5;
const EPSILON = 1e-6;
const PI2 = Math.PI * Math.PI;

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
  /**
   * Optional tier-based weight (default 1.0). Multiplies the match's
   * information contribution to `v` and `Δ`. Extension standard de Glicko-2
   * pour games pondérés (ex: Chess.com qui distingue rapid vs bullet,
   * Dota 2 DatDota pour Majors vs petits tournois).
   *
   * Math : v = 1 / Σ wⱼ·g(φⱼ)²·E·(1-E), Δ = v · Σ wⱼ·g(φⱼ)·(sⱼ-E).
   *
   * Avec w=1 pour tous, on recover le Glicko-2 standard exact.
   */
  weight?: number;
}

/**
 * Tier-based weights for match results, utilisés par le replay chronologique.
 * Phase 4 fix : Glicko vanilla pondérait toutes les wins pareil, ce qui
 * polluait les ratings des joueurs qui alternent gros tournois et farm de
 * petits tournois. Cf. PHASE3_DIAGNOSTIC : 100% des pires erreurs V2 étaient
 * "rating faux" causé par ce problème.
 */
export const TIER_WEIGHTS: Record<string, number> = {
  S: 4.0,
  Qualifier: 2.5,
  A: 2.0,
  B: 1.0,
  C: 0.4,
  Showmatch: 0.3,
  Misc: 0.3,
};

export function tierWeight(tier: string | null | undefined): number {
  if (!tier) return 1.0;
  return TIER_WEIGHTS[tier] ?? 1.0;
}

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

function computeNewVolatility(sigma: number, phi: number, v: number, delta: number): number {
  const a = Math.log(sigma * sigma);

  const f = (x: number): number => {
    const ex = Math.exp(x);
    const phi2 = phi * phi;
    const num = ex * (delta * delta - phi2 - v - ex);
    const den = 2 * (phi2 + v + ex) * (phi2 + v + ex);
    return num / den - (x - a) / (TAU * TAU);
  };

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

export function computeUpdatedRating(
  current: RatingTriple,
  results: MatchResult[],
): RatingTriple {
  if (results.length === 0) {
    const { mu, phi } = toGlicko2(current.rating, current.rd);
    const phiPrime = Math.sqrt(phi * phi + current.vol * current.vol);
    const back = fromGlicko2(mu, phiPrime);
    return { rating: back.rating, rd: Math.min(DEFAULT_RD, back.rd), vol: current.vol };
  }

  const { mu, phi } = toGlicko2(current.rating, current.rd);

  // Tier-weighted extension : chaque match a un weight optionnel (default 1).
  // Avec tous weights = 1, on recover Glicko-2 standard exact (non-regression
  // garantie par le test canonique de Glickman).
  let vInv = 0;
  for (const r of results) {
    const w = r.weight ?? 1.0;
    const { mu: muJ, phi: phiJ } = toGlicko2(r.opponentRating, r.opponentRd);
    const gJ = g(phiJ);
    const E = expected(mu, muJ, phiJ);
    vInv += w * gJ * gJ * E * (1 - E);
  }
  const v = 1 / vInv;

  let delta = 0;
  for (const r of results) {
    const w = r.weight ?? 1.0;
    const { mu: muJ, phi: phiJ } = toGlicko2(r.opponentRating, r.opponentRd);
    const gJ = g(phiJ);
    const E = expected(mu, muJ, phiJ);
    delta += w * gJ * (r.score - E);
  }
  delta *= v;

  const sigmaPrime = computeNewVolatility(current.vol, phi, v, delta);
  const phiStar = Math.sqrt(phi * phi + sigmaPrime * sigmaPrime);
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);

  let sumGE = 0;
  for (const r of results) {
    const w = r.weight ?? 1.0;
    const { mu: muJ, phi: phiJ } = toGlicko2(r.opponentRating, r.opponentRd);
    const gJ = g(phiJ);
    const E = expected(mu, muJ, phiJ);
    sumGE += w * gJ * (r.score - E);
  }
  const muPrime = mu + phiPrime * phiPrime * sumGE;

  const { rating, rd } = fromGlicko2(muPrime, phiPrime);
  return { rating, rd, vol: sigmaPrime };
}

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
