/**
 * Odds Engine v2 — Professional-grade esports betting odds.
 *
 * Six weighted factors determine win probability:
 *
 *  Factor                   Weight    Source
 *  ─────────────────────────────────────────────────────
 *  Competitive winrate      35%       PlayerMatchRecord (tier-weighted, Bayesian, decayed)
 *  Head-to-head history     25%       PlayerMatchRecord (direct matchups, tier-weighted)
 *  Recent form              20%       Last 15 matches (exponential decay)
 *  Tournament tier context  10%       Current match tier (performance varies by stage)
 *  Inactivity / rust        5%        Days since last tournament match
 *  Opponent strength        5%        Opponent's competitive winrate
 *
 * All blending happens in log-odds (logit) space for proper Bayesian calibration.
 *
 * House margin: 7% overround (proportional split), ensuring long-run profitability.
 * Max probability cap: 84% (even Liereyy vs a nobody won't get 1.05 odds).
 * Low-data safety: Bayesian prior of 50% with strength-5 pseudo-observations
 *   pulls odds toward even money when data is sparse.
 *
 * Tier weights for record importance:
 *   S: 4.0 | A: 2.0 | Qualifier: 1.5 | B: 1.0 | C: 0.5 | Misc: 0.3
 */

// ── Constants ──────────────────────────────────────────────────────────────────
const HOUSE_MARGIN_2WAY = 0.06;  // 6% overround for 2-way markets (BO3/5/7)
const HOUSE_MARGIN_3WAY = 0.10;  // 10% overround for 3-way markets (BO2/4 with draw)
const MIN_ODDS = 1.05;
const MAX_ODDS = 20.0;

// Tier weights — a S-tier win counts 4× as much as a B-tier win (2× A-tier).
// These values are currently arbitrary (not backtested); revisit with a
// log-likelihood calibration on completed matches before tuning.
const TIER_WEIGHT: Record<string, number> = {
  S: 4.0,
  A: 2.0,
  Qualifier: 1.5,
  B: 1.0,
  C: 0.5,
  Misc: 0.3,
};

// Bayesian prior: equivalent to 5 matches at 50% winrate
const PRIOR_WINRATE = 0.50;
const PRIOR_STRENGTH = 5;

// Temporal decay: half-life in days
const HALF_LIFE_DAYS = 180;
const DECAY_CONSTANT = Math.LN2 / HALF_LIFE_DAYS;

// ── Helpers ────────────────────────────────────────────────────────────────────
function logit(p: number): number {
  const c = Math.max(0.01, Math.min(0.99, p));
  return Math.log(c / (1 - c));
}
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

// ── Types ──────────────────────────────────────────────────────────────────────
export interface MatchRecord {
  won: boolean;
  tier: string;        // S, A, B, C, Qualifier, Misc
  matchDate: Date | null;
  opponentId?: string | null;
}

export interface H2HRecord {
  winner: 1 | 2;
  tier: string;
  matchDate: Date | null;
  confidence: number;
}

export interface OddsInputV2 {
  // All tournament match records for player 1
  p1Records: MatchRecord[];
  // All tournament match records for player 2
  p2Records: MatchRecord[];
  // Direct H2H between the two players (most recent first)
  h2h: H2HRecord[];
  // Days since last tournament match (0 = played today)
  daysSinceLastMatch1: number;
  daysSinceLastMatch2: number;
  // Current match tier (for tier-context adjustment)
  matchTier?: string;
  // Match format — needed to calculate draw odds for even BOs
  format?: string;
  // Opponent winrates (Map<opponentId, winrate 0-1>) — used to weight each
  // win/loss by opponent strength. A win against a 30% player counts less
  // than a win against a 70% player. When omitted, all opponents default
  // to 0.5 and the factor is effectively inactive.
  opponentWinrates?: Map<string, number>;
}

export interface OddsResult {
  odds1: number;
  odds2: number;
  oddsDraw?: number; // only for even BO formats (BO2, BO4, BO6...)
  prob1: number;
  prob2: number;
  probDraw?: number;
  impliedProb1: number;
  impliedProb2: number;
  margin: number;
}

/** Check if a BO format allows draws (even numbers: BO2, BO4, BO6...) */
export function formatAllowsDraw(format: string): boolean {
  const bo = parseInt(format.replace(/\D/g, ''), 10);
  return !isNaN(bo) && bo > 0 && bo % 2 === 0;
}

/**
 * Calculate draw probability for even BO formats from a per-game win prob.
 * For BO2: P(draw) = 2 * p * (1-p) where p = prob of winning a single game.
 * For BO4: P(draw) = C(4,2) * p^2 * (1-p)^2 = 6 * p^2 * (1-p)^2
 * General: P(draw in BO_n) = C(n, n/2) * p^(n/2) * (1-p)^(n/2)
 *
 * IMPORTANT: pass a PER-GAME probability here, not a series win probability.
 * Use solvePerGameProb() to convert a series-level probability back to a
 * per-game probability before calling this function.
 */
export function calculateDrawProbability(pPerGame: number, boNum: number): number {
  if (boNum % 2 !== 0) return 0;
  const half = boNum / 2;
  let binom = 1;
  for (let i = 0; i < half; i++) {
    binom = binom * (boNum - i) / (i + 1);
  }
  return binom * Math.pow(pPerGame, half) * Math.pow(1 - pPerGame, half);
}

/**
 * Given a series-win probability `pMatch` in a given BO format, backsolve the
 * underlying per-game probability `p` such that the binomial series model
 * predicts the same series-win probability.
 *
 * Used when we only have series-level data (PlayerMatchRecord.won is a
 * series-win flag) but need a per-game probability to compute draw odds for
 * BO2/BO4 formats.
 */
export function solvePerGameProb(pMatch: number, format: string): number {
  const seriesWin = (p: number): number => {
    if (format === 'BO1') return p;
    if (format === 'BO3') return p * p * (3 - 2 * p);
    if (format === 'BO5') return p * p * p * (1 + 3 * (1 - p) + 6 * (1 - p) * (1 - p));
    if (format === 'BO7') return p * p * p * p * (1 + 4 * (1 - p) + 10 * (1 - p) * (1 - p) + 20 * (1 - p) * (1 - p) * (1 - p));
    return p;
  };
  if (pMatch <= 0 || pMatch >= 1) return pMatch;
  let lo = 0.001, hi = 0.999;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (seriesWin(mid) < pMatch) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// ── Core: Tier-specific winrate ───────────────────────────────────────────────
/**
 * Compute win rate at a specific tier level.
 * Returns null when fewer than MIN_RECORDS records exist at that tier — not enough
 * data to draw a meaningful conclusion.
 */
function computeTierSpecificWinrate(records: MatchRecord[], tier: string, minRecords = 4): number | null {
  const filtered = records.filter(r => r.tier === tier);
  if (filtered.length < minRecords) return null;
  return filtered.filter(r => r.won).length / filtered.length;
}

// ── Core: Competitive Winrate ──────────────────────────────────────────────────
/**
 * Bayesian tier-weighted winrate with exponential temporal decay.
 *
 * Each match's contribution is scaled by:
 *   - Tier weight (S=3x, A=2x, B=1x, etc.)
 *   - Recency (half-life 180 days — 6 months ago = 0.5× weight)
 *   - Opponent strength (if opponent winrate is known, scale 0.7–1.3×)
 *
 * Returns { winrate: 0-1, confidence: 0-1, effectiveN: number }
 */
function computeCompetitiveWinrate(
  records: MatchRecord[],
  opponentWinrates?: Map<string, number>,
  now = Date.now(),
): { winrate: number; confidence: number; effectiveN: number } {
  let weightedWins = PRIOR_WINRATE * PRIOR_STRENGTH;
  let totalWeight = PRIOR_STRENGTH;

  for (const r of records) {
    // Temporal decay
    const ageDays = r.matchDate ? (now - r.matchDate.getTime()) / 86_400_000 : 365;
    const recency = Math.exp(-DECAY_CONSTANT * ageDays);

    // Tier weight
    const tierW = TIER_WEIGHT[r.tier] ?? 1.0;

    // Opponent strength multiplier (0.4–1.6). A win against a weak 20%-WR
    // opponent counts ~0.6× a baseline win; a win against a 80%-WR top pro
    // counts ~1.4×. Amplified from the original 0.7-1.3 range so "farming
    // weeklies against randoms" stops inflating someone's WR against the
    // real competition — the core complaint behind MarineLord 1.58 odds.
    let oppStrength = 1.0;
    if (r.opponentId && opponentWinrates) {
      const oppWr = opponentWinrates.get(r.opponentId);
      if (oppWr !== undefined) {
        // 20% opponent → 0.64, 50% → 1.0, 80% → 1.36
        oppStrength = 0.4 + oppWr * 1.2;
      }
    }

    const matchWeight = recency * tierW * oppStrength;
    totalWeight += matchWeight;
    if (r.won) weightedWins += matchWeight;
  }

  const winrate = weightedWins / totalWeight;
  const effectiveN = totalWeight - PRIOR_STRENGTH;
  // Confidence saturates at ~40 effective matches
  const confidence = 1 - Math.exp(-effectiveN / 20);

  return { winrate, confidence: Math.max(0, confidence), effectiveN };
}

// ── Core: H2H Probability ──────────────────────────────────────────────────────
/**
 * Calculate P(player1 wins) from direct H2H records, weighted by tier and recency.
 */
function computeH2HProb(h2h: H2HRecord[], now = Date.now()): { prob: number; confidence: number } {
  if (h2h.length === 0) return { prob: 0.5, confidence: 0 };

  let p1Score = 0;
  let totalWeight = 0;

  for (const r of h2h) {
    const ageDays = r.matchDate ? (now - r.matchDate.getTime()) / 86_400_000 : 365;
    const recency = Math.exp(-DECAY_CONSTANT * ageDays);
    const tierW = TIER_WEIGHT[r.tier] ?? 1.0;
    const weight = recency * tierW * r.confidence;

    totalWeight += weight;
    if (r.winner === 1) p1Score += weight;
  }

  const rawProb = totalWeight > 0 ? p1Score / totalWeight : 0.5;
  // Apply logit smoothing to avoid extremes from small samples
  const smoothed = sigmoid(logit(rawProb) * 0.85);
  // Confidence: cap at 1.0, reaches ~0.5 at 6 H2H matches
  const confidence = Math.min(1.0, h2h.length / 12);

  return { prob: smoothed, confidence };
}

// ── Core: Recent Form ──────────────────────────────────────────────────────────
/**
 * Recent form factor from the last 15 matches (all tiers).
 * Returns a value from -0.06 to +0.06 in logit space.
 */
function computeFormFactor(records: MatchRecord[], now = Date.now()): number {
  // Sort by date descending, take last 15
  const recent = records
    .filter(r => r.matchDate)
    .sort((a, b) => (b.matchDate?.getTime() ?? 0) - (a.matchDate?.getTime() ?? 0))
    .slice(0, 15);

  if (recent.length < 3) return 0; // not enough data

  let score = 0;
  let totalWeight = 0;
  const perMatchDecay = 0.85; // each older match counts 15% less

  for (let i = 0; i < recent.length; i++) {
    const weight = Math.pow(perMatchDecay, i);
    totalWeight += weight;
    if (recent[i].won) score += weight;
  }

  const formWinrate = score / totalWeight;
  // Map to -0.06..+0.06 logit adjustment
  return (formWinrate - 0.5) * 0.12;
}

// ── Core: Inactivity Penalty ───────────────────────────────────────────────────
/**
 * Penalty for inactive players — starts after 45 days, max at 120 days.
 * AoE tournaments are spaced out; 3-4 weeks between events is normal.
 * Returns a value from 0 (no penalty) to 0.04 (4% prob reduction).
 */
function computeRustPenalty(daysSinceLastMatch: number): number {
  if (daysSinceLastMatch <= 45) return 0;
  return Math.min(0.04, (daysSinceLastMatch - 45) * 0.0005);
}

// ── Main: Calculate Odds ───────────────────────────────────────────────────────
/**
 * Calculate fair odds from full player data.
 *
 * The algorithm runs in two phases:
 *  Phase 1: compute individual competitive winrates (pass 1, no opponent weighting)
 *  Phase 2: recompute with opponent strength weighting using pass-1 winrates
 *
 * Then blends 6 factors in logit space and applies house margin.
 */
export function calculateOddsV2(input: OddsInputV2): OddsResult {
  const now = Date.now();

  // ── Phase 1: raw competitive winrates (no opponent weighting) ────────────
  // Required to set the confidence floor even when no opponent winrates are
  // supplied by the caller.
  const raw1 = computeCompetitiveWinrate(input.p1Records, undefined, now);
  const raw2 = computeCompetitiveWinrate(input.p2Records, undefined, now);
  void raw1; void raw2; // reserved for future opponent-adjustment logic

  // ── Phase 2: opponent-weighted winrates ──────────────────────────────────
  // If the caller passed real opponent winrates (from a DB query in the
  // cron/recalc paths), use them. Otherwise default to a flat 0.5 map which
  // makes the opponent-strength factor inactive.
  const oppWinrates = input.opponentWinrates ?? new Map<string, number>();
  if (!input.opponentWinrates) {
    for (const r of [...input.p1Records, ...input.p2Records]) {
      if (r.opponentId && !oppWinrates.has(r.opponentId)) {
        oppWinrates.set(r.opponentId, 0.5);
      }
    }
  }

  const wr1 = computeCompetitiveWinrate(input.p1Records, oppWinrates, now);
  const wr2 = computeCompetitiveWinrate(input.p2Records, oppWinrates, now);

  // ── Factor 1: Competitive winrate (35%) ─────────────────────────────────
  const wrLogitDiff = logit(wr1.winrate) - logit(wr2.winrate);
  // Scale 0.90: let the skill gap actually matter. Old 0.65 dampened too much
  // and produced cotes 1.58 for a legend like MarineLorD (85% tier-weighted WR)
  // vs a mid-tier player like JIF Music (50%). Bumped so a 35-point WR gap
  // maps to a more realistic 75/25 split instead of 60/40.
  const wrProb1 = sigmoid(wrLogitDiff * 0.90);
  const wrConfidence = Math.sqrt(wr1.confidence * wr2.confidence);

  // ── Factor 2: H2H direct (25%) ──────────────────────────────────────────
  const h2hResult = computeH2HProb(input.h2h, now);

  // ── Factor 3: Recent form (20%) ─────────────────────────────────────────
  const form1 = computeFormFactor(input.p1Records, now);
  const form2 = computeFormFactor(input.p2Records, now);

  // ── Factor 4: Inactivity (5%) ───────────────────────────────────────────
  const rust1 = computeRustPenalty(input.daysSinceLastMatch1);
  const rust2 = computeRustPenalty(input.daysSinceLastMatch2);

  // ── Factor 4: Tier-context performance (10%) ────────────────────────────
  // When the current match has a known tier, compare each player's winrate
  // specifically at that tier vs their overall winrate.
  // E.g., a player who performs at 75% in S-tier but only 60% overall gets
  // a positive boost for S-tier matches — captures "big-stage players".
  let tierContextLogit = 0;
  if (input.matchTier) {
    const p1TierWr = computeTierSpecificWinrate(input.p1Records, input.matchTier);
    const p2TierWr = computeTierSpecificWinrate(input.p2Records, input.matchTier);
    // Use tier-specific WR where we have enough data, otherwise fall back to overall
    const eff1 = p1TierWr ?? wr1.winrate;
    const eff2 = p2TierWr ?? wr2.winrate;
    if (p1TierWr !== null || p2TierWr !== null) {
      // 0.5× dampening: prevents overcorrection from small tier-specific samples
      tierContextLogit = (logit(eff1) - logit(eff2)) * 0.5;
    }
  }

  // ── Adaptive blending in logit space (normalized) ──────────────────────
  // Each factor contributes weight proportional to its confidence. If a
  // factor is unavailable (no H2H, no match tier), we DON'T blend in a
  // 50/50 prior for the missing slot — that would wash out real signal
  // from the other factors. Instead we renormalize so the present weights
  // sum to 1, and the skill gap is preserved.
  const h2hWeight    = h2hResult.confidence * 0.30;
  const wrWeight     = Math.max(0.35, wrConfidence * 0.50);
  const formWeight   = 0.15;
  const tierCtxWeight = input.matchTier ? 0.10 : 0;
  const weightSum    = h2hWeight + wrWeight + formWeight + tierCtxWeight;
  const blendedLogit = weightSum > 0 ? (
    logit(wrProb1)        * wrWeight +
    logit(h2hResult.prob) * h2hWeight +
    (form1 - form2)       * formWeight * 5 +
    tierContextLogit      * tierCtxWeight
  ) / weightSum : 0;

  let prob1 = sigmoid(blendedLogit);

  // ── Apply inactivity ────────────────────────────────────────────────────
  prob1 = sigmoid(logit(prob1) - (rust1 - rust2));

  // ── Clamp based on data confidence ──────────────────────────────────────
  // Ceiling raised for high-confidence matchups — a legend vs a mid-tier
  // grinder with 400+ vs 100+ records should be able to hit 1.15-1.20 odds.
  const totalConfidence = Math.max(wrConfidence, h2hResult.confidence);
  const maxProb = totalConfidence < 0.20 ? 0.70  // very low data → tight
    : totalConfidence < 0.50 ? 0.80               // some data
    : totalConfidence < 0.80 ? 0.86               // good data
    : 0.90;                                        // excellent data (400+ records, huge skill gap)
  const minProb = 1 - maxProb;

  prob1 = Math.min(maxProb, Math.max(minProb, prob1));
  let prob2 = 1 - prob1;

  // ── House margin (6% overround for 2-way) ───────────────────────────────
  // Formula: odds = 1 / (prob * (1 + margin)) → ensures overround = margin
  let odds1 = 1 / (prob1 * (1 + HOUSE_MARGIN_2WAY));
  let odds2 = 1 / (prob2 * (1 + HOUSE_MARGIN_2WAY));

  odds1 = Math.min(MAX_ODDS, Math.max(MIN_ODDS, Math.round(odds1 * 100) / 100));
  odds2 = Math.min(MAX_ODDS, Math.max(MIN_ODDS, Math.round(odds2 * 100) / 100));

  // ── BO2/BO4 "draw void" market (Pinnacle-style) ────────────────────────
  // For even BO formats, we offer 2 outcomes only — P1 wins the match or
  // P2 wins the match. A 1-1 (or 2-2 for BO4) draw refunds all bets.
  //
  // This matches the CS2 / Dota 2 / LoL group-stage convention and produces
  // tighter, more attractive odds (1.90/2.10 range) than a 3-way market.
  //
  // Math: given the unconditional series probs prob1, probDraw, prob2, the
  // conditional "P1 wins given no draw" is prob1 / (prob1 + prob2). We still
  // compute probDraw internally so the solver knows the matchup's closeness,
  // but we don't expose it as a bettable market.
  const format = input.format ?? 'BO3';
  const boNum = parseInt(format.replace(/\D/g, ''), 10) || 3;
  let probDraw: number | undefined;
  if (boNum % 2 === 0) {
    const pPerGame = solvePerGameProb(prob1, 'BO3');
    // Shrinkage: pure binomial peaks at 50% at p=0.5, empirically BO2 draws
    // cluster around 30-40% in AoE/CS/LoL.
    const DRAW_SHRINKAGE_EVEN_BO = 0.70;
    probDraw = calculateDrawProbability(pPerGame, boNum) * DRAW_SHRINKAGE_EVEN_BO;
    probDraw = Math.max(0.05, Math.min(0.45, probDraw));
    // Conditional 2-way probabilities (given non-draw) — what the market prices.
    // prob1, prob2 keep their original values (they'll be reported as conditional
    // on "no draw" via normalization below).
    const winTotal = prob1 + prob2; // already sums to 1 before this block, but
    // be defensive: if we ever change the blending above, this stays correct.
    const condProb1 = winTotal > 0 ? prob1 / winTotal : 0.5;
    const condProb2 = winTotal > 0 ? prob2 / winTotal : 0.5;
    // Apply 2-way margin to the conditional probs → tight odds like 1.90/2.10
    odds1 = Math.min(MAX_ODDS, Math.max(MIN_ODDS, Math.round(1 / (condProb1 * (1 + HOUSE_MARGIN_2WAY)) * 100) / 100));
    odds2 = Math.min(MAX_ODDS, Math.max(MIN_ODDS, Math.round(1 / (condProb2 * (1 + HOUSE_MARGIN_2WAY)) * 100) / 100));
    // Report conditional probs in the result so downstream UIs see what the
    // market actually prices. Unconditional probDraw is reported separately.
    prob1 = condProb1;
    prob2 = condProb2;
  }

  const impliedProb1 = 1 / odds1;
  const impliedProb2 = 1 / odds2;
  const margin = (impliedProb1 + impliedProb2 - 1) * 100;

  // oddsDraw intentionally undefined — BO2/BO4 are 2-way void-on-draw markets.
  return { odds1, odds2, prob1, prob2, probDraw, impliedProb1, impliedProb2, margin };
}

// ── Legacy compatibility wrappers ──────────────────────────────────────────────

export interface OddsInput {
  elo1: number;
  elo2: number;
  h2hRecent: { winner: 1 | 2 }[];
  streak1: number;
  streak2: number;
  daysSinceLastMatch1: number;
  daysSinceLastMatch2: number;
  winrate1?: number;
  winrate2?: number;
  totalGames1?: number;
  totalGames2?: number;
  peakElo1?: number;
  peakElo2?: number;
  communityVote1?: number;
  communityVote2?: number;
}

/**
 * Legacy calculateOdds — wraps the V2 engine for backward compat.
 * Used by code that doesn't yet pass full MatchRecord arrays.
 */
export function calculateOdds(input: OddsInput): OddsResult {
  // Synthesize fake records from legacy winrate data
  const fakeRecords = (wr: number, games: number): MatchRecord[] => {
    const records: MatchRecord[] = [];
    const wins = Math.round(wr * games);
    for (let i = 0; i < games; i++) {
      records.push({ won: i < wins, tier: 'B', matchDate: new Date(Date.now() - i * 7 * 86400000), opponentId: null });
    }
    return records;
  };

  return calculateOddsV2({
    p1Records: fakeRecords(input.winrate1 ?? 0.5, input.totalGames1 ?? 0),
    p2Records: fakeRecords(input.winrate2 ?? 0.5, input.totalGames2 ?? 0),
    h2h: input.h2hRecent.map(r => ({ ...r, tier: 'B', matchDate: null, confidence: 0.8 })),
    daysSinceLastMatch1: input.daysSinceLastMatch1,
    daysSinceLastMatch2: input.daysSinceLastMatch2,
  });
}

/**
 * Initial odds for a brand-new match with no prior data.
 */
export function quickOddsFromElo(_elo1: number, _elo2: number): { odds1: number; odds2: number } {
  return calculateOddsV2({
    p1Records: [], p2Records: [], h2h: [],
    daysSinceLastMatch1: 0, daysSinceLastMatch2: 0,
  });
}

/**
 * Legacy wrapper for code that passes player DB objects + H2H array.
 */
export function calculateOddsFromPlayers(
  p1: { elo: number; winrate: number; totalGames: number; currentStreak: number; peakElo: number | null; lastMatchAt: Date | null },
  p2: { elo: number; winrate: number; totalGames: number; currentStreak: number; peakElo: number | null; lastMatchAt: Date | null },
  h2hRecent: { winner: 1 | 2 }[]
): { odds1: number; odds2: number } {
  const now = Date.now();
  const days1 = p1.lastMatchAt ? (now - p1.lastMatchAt.getTime()) / 86400000 : 30;
  const days2 = p2.lastMatchAt ? (now - p2.lastMatchAt.getTime()) / 86400000 : 30;

  return calculateOdds({
    elo1: p1.elo, elo2: p2.elo,
    winrate1: p1.winrate, winrate2: p2.winrate,
    totalGames1: p1.totalGames, totalGames2: p2.totalGames,
    streak1: p1.currentStreak, streak2: p2.currentStreak,
    daysSinceLastMatch1: days1, daysSinceLastMatch2: days2,
    h2hRecent,
  });
}

// ── Volume-based odds adjustment (unchanged from v1) ───────────────────────────

export interface BetRecord {
  amount: number;
  oddsAtBet: number;
  selectedPlayer: 1 | 2;
}

export function adjustOddsAdvanced(
  baseOdds1: number,
  baseOdds2: number,
  bets: BetRecord[]
): { odds1: number; odds2: number } {
  if (bets.length === 0) return { odds1: baseOdds1, odds2: baseOdds2 };

  const totalRawVolume = bets.reduce((s, b) => s + b.amount, 0);
  if (totalRawVolume < 100) return { odds1: baseOdds1, odds2: baseOdds2 };

  const bettorsOnSide1 = bets.filter(b => b.selectedPlayer === 1).length;
  const bettorsOnSide2 = bets.filter(b => b.selectedPlayer === 2).length;
  if (bets.length < 3 || bettorsOnSide1 === 0 || bettorsOnSide2 === 0) {
    return { odds1: baseOdds1, odds2: baseOdds2 };
  }

  function betWeight(amount: number): number {
    if (amount >= 200) return 3.0;
    if (amount >= 100) return 2.0;
    if (amount >= 50)  return 1.0;
    return 0.5;
  }

  let weightedVol1 = 0, weightedVol2 = 0;
  let liability1 = 0, liability2 = 0;

  for (const bet of bets) {
    const w = betWeight(bet.amount);
    const maxPayout = bet.amount * bet.oddsAtBet;
    if (bet.selectedPlayer === 1) {
      weightedVol1 += bet.amount * w;
      liability1 += maxPayout;
    } else {
      weightedVol2 += bet.amount * w;
      liability2 += maxPayout;
    }
  }

  const totalWeightedVol = weightedVol1 + weightedVol2;
  const totalLiability = liability1 + liability2;

  const liabilitySignal = totalLiability > 0 ? (liability1 - liability2) / totalLiability : 0;
  const sharpSignal = totalWeightedVol > 0 ? (weightedVol1 - weightedVol2) / totalWeightedVol : 0;
  const combinedSignal = liabilitySignal * 0.60 + sharpSignal * 0.40;

  if (Math.abs(combinedSignal) < 0.12) return { odds1: baseOdds1, odds2: baseOdds2 };

  const adjustmentMag = Math.min(0.20, (Math.abs(combinedSignal) - 0.12) * 0.50);
  let odds1 = baseOdds1;
  let odds2 = baseOdds2;

  if (combinedSignal > 0) {
    odds1 = Math.max(MIN_ODDS, odds1 - adjustmentMag);
    odds2 = Math.min(MAX_ODDS, odds2 + adjustmentMag * 0.4);
  } else {
    odds2 = Math.max(MIN_ODDS, odds2 - adjustmentMag);
    odds1 = Math.min(MAX_ODDS, odds1 + adjustmentMag * 0.4);
  }

  return {
    odds1: Math.round(odds1 * 100) / 100,
    odds2: Math.round(odds2 * 100) / 100,
  };
}

/** @deprecated Use adjustOddsAdvanced instead */
export function adjustOddsForVolume(
  currentOdds1: number,
  currentOdds2: number,
  volume1: number,
  volume2: number
): { odds1: number; odds2: number } {
  const fakeBets: BetRecord[] = [
    ...(volume1 > 0 ? [{ amount: volume1, oddsAtBet: currentOdds1, selectedPlayer: 1 as const }] : []),
    ...(volume2 > 0 ? [{ amount: volume2, oddsAtBet: currentOdds2, selectedPlayer: 2 as const }] : []),
  ];
  return adjustOddsAdvanced(currentOdds1, currentOdds2, fakeBets);
}
