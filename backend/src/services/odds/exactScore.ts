/**
 * Exact-score Monte Carlo simulator (Session 2 — 2026-05-02).
 *
 * Treat each map as an independent biased coin with player-1 win probability
 * `pPerGame`. Simulate the series to first-to-N wins (N=2 BO3, N=3 BO5/BO7)
 * and aggregate the empirical distribution of final scores.
 *
 * For iid maps (single `pPerGame` value) this is mathematically equivalent
 * to the closed-form negative binomial — it's a sanity scaffolding more than
 * an improvement over the analytical distribution. Its real value comes when
 * we wire per-map probabilities (the user's "civ matchup" / "map preference"
 * Phase 4 data, blocked on schema work).
 *
 * Deterministic via mulberry32 PRNG so backtests are reproducible.
 */

export type ExactBoFormat = 'BO3' | 'BO5' | 'BO7';
export type ExactScoreKey = `${number}-${number}`;
export type ExactScoreDistribution = Partial<Record<ExactScoreKey, number>>;

/** Number of wins required to clinch the series. */
export function winsToClinch(format: ExactBoFormat): number {
  if (format === 'BO3') return 2;
  if (format === 'BO5') return 3;
  return 4; // BO7
}

/** All legal final scores for a series, P1's score first. */
export function legalScores(format: ExactBoFormat): ExactScoreKey[] {
  const need = winsToClinch(format);
  const scores: ExactScoreKey[] = [];
  for (let losses = 0; losses < need; losses++) {
    scores.push(`${need}-${losses}` as ExactScoreKey);
    scores.push(`${losses}-${need}` as ExactScoreKey);
  }
  return scores;
}

/** Mulberry32 PRNG — small, fast, decent statistical quality. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SimulateOptions {
  pPerGame: number;
  format: ExactBoFormat;
  /** Default 10 000. Higher = tighter distribution, slower. */
  simCount?: number;
  /** Default Date.now() — pass an integer for reproducibility. */
  seed?: number;
  /**
   * Optional per-map probabilities. When provided, the i-th map of the
   * series uses `perMapProb[i]` instead of the iid `pPerGame` fallback. If
   * shorter than the maximum map count, missing entries fall back.
   */
  perMapProb?: number[];
}

/**
 * Simulate `simCount` series and return the empirical distribution of final
 * scores as { "2-1": 0.42, ... } summing to 1.
 */
export function simulateExactScore(opts: SimulateOptions): ExactScoreDistribution {
  const { pPerGame, format, perMapProb } = opts;
  const simCount = opts.simCount ?? 10_000;
  const rng = mulberry32(opts.seed ?? Date.now());
  const need = winsToClinch(format);

  const counts = new Map<ExactScoreKey, number>();
  for (let s = 0; s < simCount; s++) {
    let p1 = 0, p2 = 0;
    let mapIdx = 0;
    while (p1 < need && p2 < need) {
      const p = (perMapProb && mapIdx < perMapProb.length) ? perMapProb[mapIdx] : pPerGame;
      if (rng() < p) p1++;
      else p2++;
      mapIdx++;
    }
    const key = `${p1}-${p2}` as ExactScoreKey;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const dist: ExactScoreDistribution = {};
  for (const [k, n] of counts.entries()) dist[k] = n / simCount;
  return dist;
}

/**
 * Closed-form negative-binomial distribution of final scores. Useful as a
 * reference oracle in tests and as a fast path when we don't need per-map
 * variation.
 *
 * P(series ends N-k) = C(N+k-1, k) * p^N * (1-p)^k     for player 1 winning N-k.
 * (negative binomial : prob to get N-th success after exactly k failures)
 */
export function analyticalExactScore(p: number, format: ExactBoFormat): ExactScoreDistribution {
  const need = winsToClinch(format);
  const dist: ExactScoreDistribution = {};
  const q = 1 - p;
  // P1 wins N-k
  for (let losses = 0; losses < need; losses++) {
    const c = binomCoeff(need + losses - 1, losses);
    dist[`${need}-${losses}` as ExactScoreKey] = c * Math.pow(p, need) * Math.pow(q, losses);
  }
  // P2 wins N-k
  for (let losses = 0; losses < need; losses++) {
    const c = binomCoeff(need + losses - 1, losses);
    dist[`${losses}-${need}` as ExactScoreKey] = c * Math.pow(q, need) * Math.pow(p, losses);
  }
  return dist;
}

function binomCoeff(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 1; i <= k; i++) r = r * (n - k + i) / i;
  return r;
}
