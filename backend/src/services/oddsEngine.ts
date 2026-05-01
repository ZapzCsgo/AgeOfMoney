import { computeWinProbability as glickoWinProb } from './glicko2';

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
// House margin 9% — middle of the 8-10% target range. Reference points:
// Pinnacle 2-3% (volume-driven, sharp), CSGOEmpire 7-8%, DraftKings/FanDuel
// 8-12%. Alpha phase with coins virtuels = marge sert surtout de safety net
// contre les miscalibrations du modèle.
const HOUSE_MARGIN_2WAY = 0.09;  // 9% overround for 2-way markets (BO3/5/7 + BO2 void-on-draw)
const HOUSE_MARGIN_3WAY = 0.10;  // legacy — no longer used since BO2 is now void-on-draw 2-way
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

// Bayesian prior: equivalent to 5 matches at 50% winrate.
// Lowered to 1 when ODDS_ENGINE_BAYES_WEAK_H2H=true (session 3 winner) —
// see flag block below.
const PRIOR_WINRATE = 0.50;

// ── Phase 1 feature flag ──────────────────────────────────────────────────
// Quand ODDS_ENGINE_V2_ENABLED=true, on active : half-life 90j, wrLogitDiff
// scale 1.15, momentum detector, rest factor non-linéaire, SOS boost.
// Default false pour pouvoir A/B tester en prod sans régression.
const V2_ENABLED = process.env.ODDS_ENGINE_V2_ENABLED === 'true';

// ── Odds engine session winners feature flags ──────────────────────────
//
// Two flags, additive : BAYES_WEAK_H2H implies H2H_PRIORITY.
//
// ODDS_ENGINE_H2H_PRIORITY  → variant `s2-combo-h2h-priority`
//   Backtest 2026-05-02 #1 (N=153) : Brier -0.0152, Acc +0.7pp, ECE -0.0171.
//   Overrides : h2hWeightScale 0.30→0.50, h2hConfidenceMaxAt 12→6,
//   formWeight 0.30→0.20.
//
// ODDS_ENGINE_BAYES_WEAK_H2H → variant `v45-bayes-weak-h2h` (session 3 winner)
//   Backtest 2026-05-02 #2 (N=153) : Brier -0.0164, Acc +1.3pp, ECE -0.0190.
//   Strict improvement on H2H_PRIORITY. Adds priorStrength 5→1 on top of
//   the same h2h overrides.
//
// Recommended : enable BAYES_WEAK_H2H directly (it implies H2H_PRIORITY).
// H2H_PRIORITY-only kept for granular A/B testing.
const BAYES_WEAK_H2H_ENABLED = process.env.ODDS_ENGINE_BAYES_WEAK_H2H === 'true';
const H2H_PRIORITY_ENABLED   = BAYES_WEAK_H2H_ENABLED || process.env.ODDS_ENGINE_H2H_PRIORITY === 'true';
if (BAYES_WEAK_H2H_ENABLED) {
  // eslint-disable-next-line no-console
  console.log('[OddsEngine] ODDS_ENGINE_BAYES_WEAK_H2H active — priorStrength=1 + h2h priority overrides');
} else if (H2H_PRIORITY_ENABLED) {
  // eslint-disable-next-line no-console
  console.log('[OddsEngine] ODDS_ENGINE_H2H_PRIORITY active — h2hWeightScale=0.50, h2hConfidenceMaxAt=6, formWeight=0.20');
}
const H2H_WEIGHT_SCALE   = H2H_PRIORITY_ENABLED ? 0.50 : 0.30;
const H2H_CONFIDENCE_MAX = H2H_PRIORITY_ENABLED ? 6    : 12;
const FORM_WEIGHT        = H2H_PRIORITY_ENABLED ? 0.20 : 0.30;
const PRIOR_STRENGTH     = BAYES_WEAK_H2H_ENABLED ? 1 : 5;

// Temporal decay: half-life in days. V1 = 180j (records 6 mois = 0.5×),
// V2 = 90j (records 3 mois = 0.5×) — le baseline a montré que les matches
// anciens pesaient trop et tiraient les probas vers un prior 50/50 obsolète.
const HALF_LIFE_DAYS = V2_ENABLED ? 90 : 180;
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
  score?: string | null; // "3-1", "4-0", etc — used for form dominance bonus
}

export interface H2HRecord {
  winner: 1 | 2;
  tier: string;
  matchDate: Date | null;
  confidence: number;
}

export interface OddsInputV2 {
  p1Records: MatchRecord[];
  p2Records: MatchRecord[];
  h2h: H2HRecord[];
  daysSinceLastMatch1: number;
  daysSinceLastMatch2: number;
  matchTier?: string;
  format?: string;
  opponentWinrates?: Map<string, number>;
  // Phase 2 : Glicko-2 ratings. Triggers V2 path when all 4 are provided.
  glickoRating1?: number;
  glickoRd1?: number;
  glickoRating2?: number;
  glickoRd2?: number;
  // Phase 3 : override mode. Par défaut on laisse les env vars décider.
  // Tests/backtest peuvent forcer explicitement un mode particulier.
  forceMode?: 'v1-only' | 'v2-only' | 'ensemble' | 'ensemble-platt';
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
/**
 * Convert a per-game win probability `p` to the **market-level** win
 * probability for the given BO format.
 *
 * For odd-BO formats (BO1/3/5/7) the market is 2-way "who wins the series":
 *   BO1 → p
 *   BO3 → p²(3 - 2p)       = p²(3-2p)
 *   BO5 → p³(1 + 3(1-p) + 6(1-p)²)
 *   BO7 → p⁴(1 + 4(1-p) + 10(1-p)² + 20(1-p)³)
 *
 * For even-BO formats (BO2/BO4) the market is 2-way **void on draw**, so
 * we return the CONDITIONAL prob p1 sweeps | no draw:
 *   BO2 → p² / (p² + (1-p)²)
 *   BO4 → P(p1 wins 3-1 or 4-0) / (P(p1 wins 3-1 or 4-0) + mirror)
 *
 * Unit test (p = 0.7) :
 *   BO1 → 0.70
 *   BO3 → 0.784
 *   BO5 → 0.8369
 *   BO7 → 0.874
 *   BO2 → 0.49 / (0.49 + 0.09) = 0.8448
 */
export function seriesWinProb(pPerGame: number, format: string): number {
  const p = Math.max(0, Math.min(1, pPerGame));
  const q = 1 - p;
  if (format === 'BO1') return p;
  if (format === 'BO3') return p * p * (3 - 2 * p);
  if (format === 'BO5') return p * p * p * (1 + 3 * q + 6 * q * q);
  if (format === 'BO7') return p * p * p * p * (1 + 4 * q + 10 * q * q + 20 * q * q * q);
  if (format === 'BO2') {
    // Void-on-draw : return P(p1 sweeps | no draw)
    const pSweep = p * p;
    const qSweep = q * q;
    const denom = pSweep + qSweep;
    return denom > 0 ? pSweep / denom : 0.5;
  }
  if (format === 'BO4') {
    // BO4 rare. First-to-3, ties broken by... well, BO4 can end 2-2 (draw).
    // P(p1 sweeps: 3-0 or 3-1) vs P(p2 sweeps: 0-3 or 1-3), conditional on no draw.
    const p1Win = p * p * p + 3 * p * p * p * q;
    const p2Win = q * q * q + 3 * q * q * q * p;
    const denom = p1Win + p2Win;
    return denom > 0 ? p1Win / denom : 0.5;
  }
  return p;
}

export function solvePerGameProb(pMatch: number, format: string): number {
  if (pMatch <= 0 || pMatch >= 1) return pMatch;
  let lo = 0.001, hi = 0.999;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (seriesWinProb(mid, format) < pMatch) lo = mid; else hi = mid;
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
/**
 * V2 : Strength of Schedule — bonus logit additif si le joueur a passé son
 * temps à affronter des joueurs forts (moyenne opp-WR > 0.60 → +0.10 logit,
 * < 0.40 → -0.10 logit). Corrige le cas où un joueur avec 70% WR qui ne
 * joue que contre des 30%-ers serait pris pour plus fort qu'il n'est.
 */
function computeSOS(records: MatchRecord[], opponentWinrates: Map<string, number>): number {
  if (!V2_ENABLED) return 0;
  let totalOppWr = 0;
  let n = 0;
  for (const r of records) {
    if (!r.opponentId) continue;
    const wr = opponentWinrates.get(r.opponentId);
    if (wr === undefined) continue;
    totalOppWr += wr;
    n++;
  }
  if (n < 5) return 0; // pas assez de data opp-WR
  const avgOppWr = totalOppWr / n;
  // Linear map: 0.40 → -0.10, 0.50 → 0, 0.60 → +0.10 (capé ±0.15)
  return Math.max(-0.15, Math.min(0.15, (avgOppWr - 0.50) * 1.0));
}

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
  // Confidence: cap at 1.0. Default reaches ~0.5 at 6 H2H matches and 1.0
  // at 12; H2H_PRIORITY pulls full confidence in by 6 matches.
  const confidence = Math.min(1.0, h2h.length / H2H_CONFIDENCE_MAX);

  return { prob: smoothed, confidence };
}

// ── Core: Recent Form (hot-streak / cold-streak detector) ─────────────────────
/**
 * Recent form factor from the last 12 matches, weighted by:
 *   - Recency (exponential decay, half-life ~4 matches)
 *   - Tier importance (S = 2.5×, A = 1.8×, Qualifier = 1.3×, B = 1.0×, C = 0.5×)
 *   - Score dominance if available (3-0 / 4-0 / 5-0 counts 1.5×; close wins 1×)
 *
 * Returns a logit adjustment in the range roughly -0.60..+0.60. Previous
 * version capped at ±0.06 which was invisible in the blend. MarineLord's
 * 10-in-a-row dominant wins over Wam01 / 1puppypaw / Numudan (all S/Qualifier)
 * now actually move the needle by ~+0.45 logit.
 */
function computeFormFactor(records: MatchRecord[], now = Date.now()): number {
  void now; // recency handled by ordering, not absolute time here

  // Sort by date desc, take last 12 — fresh signal, not a long tail
  const recent = records
    .filter(r => r.matchDate)
    .sort((a, b) => (b.matchDate?.getTime() ?? 0) - (a.matchDate?.getTime() ?? 0))
    .slice(0, 12);

  if (recent.length < 3) return 0;

  const TIER_MULT: Record<string, number> = {
    S: 2.5, A: 1.8, Qualifier: 1.3, B: 1.0, C: 0.5, Misc: 0.3,
  };

  /** Dominance multiplier from the score string (player's perspective). */
  const dominance = (score?: string | null): number => {
    if (!score) return 1.0;
    const m = score.match(/^\s*(\d+)\s*[-:]\s*(\d+)\s*$/);
    if (!m) return 1.0;
    const won = parseInt(m[1], 10);
    const lost = parseInt(m[2], 10);
    if (won > lost && lost === 0 && won >= 3) return 1.6; // sweep 3-0, 4-0, 5-0
    if (won > lost && won - lost >= 2) return 1.25;       // clean 3-1 / 4-1
    if (lost > won && won === 0 && lost >= 3) return 1.6; // swept
    if (lost > won && lost - won >= 2) return 1.25;
    return 1.0;
  };

  /** Is this record actually a 1-1 / 2-2 draw (refund outcome in void-on-draw)? */
  const isDraw = (score?: string | null): boolean => {
    if (!score) return false;
    const m = score.match(/^\s*(\d+)\s*[-:]\s*(\d+)\s*$/);
    if (!m) return false;
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    return a === b && a >= 1;
  };

  let weightedWinScore = 0;
  let totalWeight = 0;
  const perMatchDecay = 0.85;

  for (let i = 0; i < recent.length; i++) {
    const recencyW = Math.pow(perMatchDecay, i);
    const tierW = TIER_MULT[recent[i].tier] ?? 1.0;
    const drawFlag = isDraw(recent[i].score);
    // Draws count half-weight and add 0.5 win credit — they shouldn't drag a
    // player's form down as hard as a decisive loss (BO2 1-1 refunds users,
    // they didn't actually "lose"). Anh Huy had 6 of his last 10 matches end
    // 1-1; treating those as losses made the model think he was on a
    // catastrophic cold streak when really he was mostly drawing.
    if (drawFlag) {
      const w = recencyW * tierW * 0.5;
      totalWeight += w;
      weightedWinScore += w * 0.5; // neutral credit
    } else {
      const domW = dominance(recent[i].score);
      const w = recencyW * tierW * domW;
      totalWeight += w;
      if (recent[i].won) weightedWinScore += w;
    }
  }

  const formWinrate = totalWeight > 0 ? weightedWinScore / totalWeight : 0.5;
  // Map (0..1) → (-1.25..+1.25) logit adjustment. A perfect dominant S-tier
  // streak (ML sweeping Wam01 / 1puppypaw / Numudan 3-0, 4-0) pulls close to
  // +1.2, which combined with the base skill signal produces the 1.10-1.15
  // odds range that sharp books offer on crushing favorites.
  let formLogit = (formWinrate - 0.5) * 2.50;

  // V2 : momentum detector — bonus additif pour les streaks ≥3 consécutifs
  // depuis le match le plus récent. +0.05 logit par win consécutive (cap +0.25),
  // -0.05 par loss décisive consécutive (cap -0.25). Les 1-1 brisent la streak
  // dans les deux sens (neutral).
  if (V2_ENABLED && recent.length >= 3) {
    let streakWins = 0;
    let streakLosses = 0;
    for (const r of recent) {
      if (isDraw(r.score)) break; // draws break the streak (neutral)
      if (r.won) {
        if (streakLosses > 0) break;
        streakWins++;
      } else {
        if (streakWins > 0) break;
        streakLosses++;
      }
    }
    if (streakWins >= 3) {
      formLogit += Math.min(0.25, (streakWins - 2) * 0.05);
    } else if (streakLosses >= 3) {
      formLogit -= Math.min(0.25, (streakLosses - 2) * 0.05);
    }
  }

  return formLogit;
}

// ── Core: Rest / Fatigue / Rust factor ─────────────────────────────────────────
/**
 * V1 : pénalité linéaire rust (inactivité > 45j).
 * V2 : courbe non-linéaire — pénalise à la fois fatigue (< 24h = match joué
 * la veille, potentiellement fatigué) et rust (> 30j = pas joué depuis
 * longtemps).
 *
 * Retourne une valeur logit (pas prob) à SOUSTRAIRE. Positif = pénalité.
 */
function computeRustPenalty(daysSinceLastMatch: number): number {
  if (V2_ENABLED) {
    // Fatigue : 0-24h → +0.03 logit de pénalité
    if (daysSinceLastMatch < 1) return 0.03;
    // Zone optimale : 1-7 jours
    if (daysSinceLastMatch <= 7) return 0;
    // Normal : 7-30 jours (joueur actif)
    if (daysSinceLastMatch <= 30) return 0;
    // Rust : > 30 jours, pénalité progressive capée à 0.15 logit
    return Math.min(0.15, 0.05 + (daysSinceLastMatch - 30) * 0.002);
  }
  // V1 : linéaire après 45j, max 0.04
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
  // V1 = WR heuristique ; V2 (Phase 2) = Glicko-2 P(A wins single game) si
  // les ratings sont fournis. Glicko est un signal bien plus précis de skill
  // que le WR global Bayesian (uncertainty modelisée, rating calibré contre
  // tous les opponents chronologiquement).
  const wrLogitDiff = logit(wr1.winrate) - logit(wr2.winrate);
  const WR_LOGIT_SCALE = V2_ENABLED ? 1.15 : 1.0;
  const sos1 = computeSOS(input.p1Records, oppWinrates);
  const sos2 = computeSOS(input.p2Records, oppWinrates);
  const wrHeuristicProb1 = sigmoid(wrLogitDiff * WR_LOGIT_SCALE + (sos1 - sos2));

  // Glicko s'active dès que les 4 inputs sont fournis par le caller,
  // indépendamment de V2_ENABLED. Le flag contrôle uniquement les features
  // Phase 1 (time decay, momentum, SOS). Permettre au backtest de tester
  // Glicko pur sans activer Phase 1, et vice-versa.
  const hasGlicko =
    input.glickoRating1 !== undefined && input.glickoRd1 !== undefined &&
    input.glickoRating2 !== undefined && input.glickoRd2 !== undefined;
  // Bug #1 fix : Glicko retourne P(win d'un game). Le blending downstream
  // attend une P(win du match). Convertir via seriesWinProb selon format.
  // Pour p_map=0.7 → BO1 0.70, BO3 0.784, BO5 0.8369, BO7 0.874.
  const glickoP = hasGlicko
    ? glickoWinProb(
        input.glickoRating1!, input.glickoRd1!,
        input.glickoRating2!, input.glickoRd2!,
      )
    : null;
  const matchFormat = input.format ?? 'BO3';
  const wrProb1 = hasGlicko && glickoP !== null
    ? seriesWinProb(glickoP, matchFormat)
    : wrHeuristicProb1;
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
  // Tier-specific winrates are the primary signal when available on BOTH
  // players. When only ONE side has data at the match tier, we apply a
  // "step-up penalty" to the side with no history: never having qualified
  // for the match tier is itself a negative signal (a C-tier regular thrown
  // into an S-tier match is at a disadvantage vs the S-tier regular, even
  // if their overall WR is ok).
  const TIER_LEVEL: Record<string, number> = {
    S: 5, A: 4, Qualifier: 3, B: 2, C: 1, Misc: 0,
  };
  /** Highest tier the player has real (≥4-record) data at. */
  function highestPlayedTier(records: MatchRecord[]): number {
    let best = -1;
    for (const tier of Object.keys(TIER_LEVEL)) {
      if (computeTierSpecificWinrate(records, tier) !== null) {
        best = Math.max(best, TIER_LEVEL[tier] ?? 0);
      }
    }
    return best;
  }

  let tierContextLogit = 0;
  let tierContextAvailable = false;
  if (input.matchTier) {
    const p1TierWr = computeTierSpecificWinrate(input.p1Records, input.matchTier);
    const p2TierWr = computeTierSpecificWinrate(input.p2Records, input.matchTier);
    if (p1TierWr !== null && p2TierWr !== null) {
      tierContextLogit = (logit(p1TierWr) - logit(p2TierWr)) * 0.5;
      tierContextAvailable = true;
    } else if (p1TierWr !== null || p2TierWr !== null) {
      // Asymmetric — one side has tier data, the other doesn't. Apply a
      // step-up penalty to the no-data side based on how far below the
      // match tier their highest-played tier sits.
      const matchLevel = TIER_LEVEL[input.matchTier] ?? 2;
      const p1High = highestPlayedTier(input.p1Records);
      const p2High = highestPlayedTier(input.p2Records);
      // 0.25 logit per tier step below the match tier (capped at 3 steps = 0.75).
      // Example : JIF Music never played A-tier, highest is Qualifier → match=A
      // (level 4) vs JIF=3 → 1 step → +0.25 logit penalty against JIF.
      if (p1TierWr !== null && p2High < matchLevel) {
        const steps = Math.min(3, matchLevel - p2High);
        tierContextLogit = (logit(p1TierWr) - logit(0.45)) * 0.5 + 0.25 * steps;
        tierContextAvailable = true;
      } else if (p2TierWr !== null && p1High < matchLevel) {
        const steps = Math.min(3, matchLevel - p1High);
        tierContextLogit = (logit(0.45) - logit(p2TierWr)) * 0.5 - 0.25 * steps;
        tierContextAvailable = true;
      }
    }
  }

  // ── Adaptive blending in logit space (normalized) ──────────────────────
  // Each factor contributes weight proportional to its confidence. If a
  // factor is unavailable (no H2H, no match tier), we DON'T blend in a
  // 50/50 prior for the missing slot — that would wash out real signal
  // from the other factors. Instead we renormalize so the present weights
  // sum to 1, and the skill gap is preserved.
  const h2hWeight    = h2hResult.confidence * H2H_WEIGHT_SCALE;
  const wrWeight     = Math.max(0.35, wrConfidence * 0.50);
  // Form weight 0.30 by default ; bumped down to 0.20 under H2H_PRIORITY
  // (the form factor was identified as adding noise on the 2026-05-02
  // backtest — `form-weight-0` actually beat baseline by Brier -0.0101).
  const formWeight   = FORM_WEIGHT;
  // Only count tier-context weight when we actually have comparable data on
  // BOTH players. If one of them has never played at this tier we skip it —
  // the renormalization below redistributes the weight to the other factors.
  const tierCtxWeight = tierContextAvailable ? 0.10 : 0;
  const weightSum    = h2hWeight + wrWeight + formWeight + tierCtxWeight;
  // NOTE: form diff is already in logit units now (was *5 to compensate the
  // old ±0.06 range — not needed anymore).
  const blendedLogit = weightSum > 0 ? (
    logit(wrProb1)        * wrWeight +
    logit(h2hResult.prob) * h2hWeight +
    (form1 - form2)       * formWeight +
    tierContextLogit      * tierCtxWeight
  ) / weightSum : 0;

  let prob1 = sigmoid(blendedLogit);

  // ── Apply inactivity ────────────────────────────────────────────────────
  prob1 = sigmoid(logit(prob1) - (rust1 - rust2));

  // ── Clamp based on data confidence ──────────────────────────────────────
  // Ceiling raised to 0.92 for excellent-data matchups — sharp books cap
  // crushing favorites around 0.88-0.93 implied prob (odds ~1.08-1.12).
  const totalConfidence = Math.max(wrConfidence, h2hResult.confidence);
  const maxProb = totalConfidence < 0.20 ? 0.70  // very low data → tight
    : totalConfidence < 0.50 ? 0.80               // some data
    : totalConfidence < 0.80 ? 0.87               // good data
    : 0.92;                                        // excellent data (400+ records + huge skill gap)
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
    // Bug #1 fix : quand Glicko est dispo, on a directement la per-game
    // prob (glickoP). Pas besoin de backsolver via BO3 depuis la series prob.
    // Sans Glicko, on backsolve depuis prob1 comme avant.
    const pPerGame = hasGlicko && glickoP !== null
      ? glickoP
      : solvePerGameProb(prob1, 'BO3');
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
