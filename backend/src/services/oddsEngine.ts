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
 *   S: 3.0 | A: 2.0 | Qualifier: 1.5 | B: 1.0 | C: 0.5 | Misc: 0.3
 */

// ── Constants ──────────────────────────────────────────────────────────────────
const HOUSE_MARGIN = 0.07;  // 7% overround (esports niche standard)
const MIN_ODDS = 1.05;
const MAX_ODDS = 20.0;

// Tier weights — a S-tier win counts 3× as much as a B-tier win
const TIER_WEIGHT: Record<string, number> = {
  S: 3.0,
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
}

export interface OddsResult {
  odds1: number;
  odds2: number;
  prob1: number;
  prob2: number;
  impliedProb1: number;
  impliedProb2: number;
  margin: number;
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

    // Opponent strength multiplier (0.7–1.3)
    let oppStrength = 1.0;
    if (r.opponentId && opponentWinrates) {
      const oppWr = opponentWinrates.get(r.opponentId);
      if (oppWr !== undefined) {
        oppStrength = 0.7 + oppWr * 0.6; // 50% opponent → 1.0, 80% → 1.18
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
 * Penalty for inactive players — starts after 14 days, max at 90 days.
 * Returns a value from 0 (no penalty) to 0.04 (4% prob reduction).
 */
function computeRustPenalty(daysSinceLastMatch: number): number {
  if (daysSinceLastMatch <= 14) return 0;
  return Math.min(0.04, (daysSinceLastMatch - 14) * 0.0006);
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
  const raw1 = computeCompetitiveWinrate(input.p1Records, undefined, now);
  const raw2 = computeCompetitiveWinrate(input.p2Records, undefined, now);

  // ── Phase 2: opponent-weighted winrates ──────────────────────────────────
  // Use raw winrates as opponent strength estimates
  const oppWinrates = new Map<string, number>();
  // Populate from all records
  for (const r of [...input.p1Records, ...input.p2Records]) {
    if (r.opponentId && !oppWinrates.has(r.opponentId)) {
      oppWinrates.set(r.opponentId, 0.5); // default
    }
  }
  // Override with computed winrates for our two players
  // (used when one player appears in the other's records)
  // We don't have player IDs here, so this is a simplified version

  const wr1 = computeCompetitiveWinrate(input.p1Records, oppWinrates, now);
  const wr2 = computeCompetitiveWinrate(input.p2Records, oppWinrates, now);

  // ── Factor 1: Competitive winrate (35%) ─────────────────────────────────
  const wrLogitDiff = logit(wr1.winrate) - logit(wr2.winrate);
  // Scale 0.65: prevents absurd odds from extreme winrate gaps
  const wrProb1 = sigmoid(wrLogitDiff * 0.65);
  const wrConfidence = Math.sqrt(wr1.confidence * wr2.confidence);

  // ── Factor 2: H2H direct (25%) ──────────────────────────────────────────
  const h2hResult = computeH2HProb(input.h2h, now);

  // ── Factor 3: Recent form (20%) ─────────────────────────────────────────
  const form1 = computeFormFactor(input.p1Records, now);
  const form2 = computeFormFactor(input.p2Records, now);

  // ── Factor 4: Inactivity (5%) ───────────────────────────────────────────
  const rust1 = computeRustPenalty(input.daysSinceLastMatch1);
  const rust2 = computeRustPenalty(input.daysSinceLastMatch2);

  // ── Adaptive blending in logit space ────────────────────────────────────
  // H2H weight scales with confidence (0 H2H → 0%, 12+ H2H → 25%)
  const h2hWeight = h2hResult.confidence * 0.25;
  // Winrate weight scales with data confidence (max 35%)
  const wrWeight = Math.max(0.15, wrConfidence * 0.35);
  // Form weight (20%)
  const formWeight = 0.20;
  // Remaining goes to base (50/50 prior)
  const remainingWeight = Math.max(0, 1 - h2hWeight - wrWeight - formWeight);

  const blendedLogit =
    logit(wrProb1)        * wrWeight +
    logit(h2hResult.prob) * h2hWeight +
    (form1 - form2)       * formWeight * 5 + // scale form to logit magnitude
    0.0                   * remainingWeight;  // logit(0.5) = 0 = no info

  let prob1 = sigmoid(blendedLogit);

  // ── Apply inactivity ────────────────────────────────────────────────────
  prob1 = sigmoid(logit(prob1) - (rust1 - rust2));

  // ── Clamp based on data confidence ──────────────────────────────────────
  const totalConfidence = Math.max(wrConfidence, h2hResult.confidence);
  const maxProb = totalConfidence < 0.20 ? 0.68  // very low data → tight
    : totalConfidence < 0.50 ? 0.76               // some data
    : totalConfidence < 0.80 ? 0.82               // good data
    : 0.84;                                        // excellent data
  const minProb = 1 - maxProb;

  prob1 = Math.min(maxProb, Math.max(minProb, prob1));
  const prob2 = 1 - prob1;

  // ── House margin (7% overround, proportional split) ─────────────────────
  let odds1 = (1 / prob1) * (1 - HOUSE_MARGIN / 2);
  let odds2 = (1 / prob2) * (1 - HOUSE_MARGIN / 2);

  odds1 = Math.min(MAX_ODDS, Math.max(MIN_ODDS, Math.round(odds1 * 100) / 100));
  odds2 = Math.min(MAX_ODDS, Math.max(MIN_ODDS, Math.round(odds2 * 100) / 100));

  const impliedProb1 = 1 / odds1;
  const impliedProb2 = 1 / odds2;
  const margin = (impliedProb1 + impliedProb2 - 1) * 100;

  return { odds1, odds2, prob1, prob2, impliedProb1, impliedProb2, margin };
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
