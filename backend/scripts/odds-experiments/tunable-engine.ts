/**
 * Tunable clone of `oddsEngine.calculateOddsV2`, with every magic number
 * exposed via a `Hyperparams` object. Used by the variant harness in this
 * folder — DOES NOT touch the production engine.
 *
 * Defaults reproduce the production V1 path (V2_ENABLED=false, no Glicko).
 * Pass overrides per variant to A/B test each axis independently.
 */
import { computeWinProbability as glickoWinProb } from '../../src/services/glicko2';

const SCALE_GLICKO = 173.7178;

export interface Hyperparams {
  // Temporal decay
  halfLifeDays: number;            // 180 (V1) | 90 (V2)
  // Bayesian prior
  priorWinrate: number;            // 0.50
  priorStrength: number;           // 5
  // Tier weights for record importance
  tierWeight: Record<string, number>;
  // Form factor
  formMaxLogit: number;            // 2.50 = (formWr - 0.5) * 2.50 mapping
  formPerMatchDecay: number;       // 0.85
  formStreakBonus: number;         // 0.05 par win consécutive (V2 only)
  formStreakCap: number;           // 0.25
  formEnabled: boolean;            // gate streak bonus
  formCount: number;               // last N matches considered (12)
  // Winrate logit scale
  wrLogitScale: number;            // 1.0 (V1) | 1.15 (V2)
  // SOS (strength of schedule)
  sosScale: number;                // 0 (off) | 1.0 (V2)
  sosCap: number;                  // 0.15
  sosMinMatches: number;           // 5
  // Opponent strength linear map: oppStrength = a + b * oppWr
  opponentStrengthA: number;       // 0.4
  opponentStrengthB: number;       // 1.2
  // Rust / fatigue
  rustMode: 'v1' | 'v2-nonlinear'; // v1 = linear after 45d cap 0.04 ; v2 = piecewise
  // H2H
  h2hSmoothingScale: number;       // 0.85
  h2hConfidenceMaxAt: number;      // 12 H2H matches → confidence 1
  // Adaptive blend weights
  h2hWeightScale: number;          // 0.30
  wrWeightFloor: number;           // 0.35
  wrWeightScale: number;           // 0.50
  formWeight: number;              // 0.30
  tierCtxWeight: number;           // 0.10
  // Confidence-based clamps (max prob)
  maxProbLowConf: number;          // 0.70
  maxProbMedConf: number;          // 0.80
  maxProbGoodConf: number;         // 0.87
  maxProbExcellentConf: number;    // 0.92
  // House margin
  houseMargin2way: number;         // 0.09
  // BO2 draw shrinkage
  drawShrinkageEvenBo: number;     // 0.70
  // Step-up penalty (asymmetric tier data)
  stepUpPenaltyPerStep: number;    // 0.25
  stepUpMaxSteps: number;          // 3
  // Glicko enable
  useGlicko: boolean;              // false
  // ── Session 3 (2026-05-02) extensions ────────────────────────────────
  // Patch reset : records with matchDate < this Date get their weight
  // multiplied by `patchResetMultiplier`. Off when Date is null.
  patchResetDate?: Date | null;
  patchResetMultiplier?: number;   // 0.50 = halve pre-patch importance
  // Consistency bonus : if variance of last 20 results < threshold,
  // pull odds toward the mean prediction (less extreme). Off when 0.
  consistencyBonus?: number;       // 0..0.20 logit scale on the variance gap
  // Format-specific winrate weight : if a player's records are split by
  // BO format, weight current-format records this many ×. 1.0 = neutral.
  formatMatchBoost?: number;       // default 1.0
  // Streak detector window (last N) for explicit streak bonus
  streakWindow?: number;           // default 5
}

export const DEFAULT_HYPERPARAMS: Hyperparams = {
  halfLifeDays: 180,
  priorWinrate: 0.5,
  priorStrength: 5,
  tierWeight: { S: 4.0, A: 2.0, Qualifier: 1.5, B: 1.0, C: 0.5, Misc: 0.3 },
  formMaxLogit: 2.5,
  formPerMatchDecay: 0.85,
  formStreakBonus: 0.05,
  formStreakCap: 0.25,
  formEnabled: false,
  formCount: 12,
  wrLogitScale: 1.0,
  sosScale: 0,
  sosCap: 0.15,
  sosMinMatches: 5,
  opponentStrengthA: 0.4,
  opponentStrengthB: 1.2,
  rustMode: 'v1',
  h2hSmoothingScale: 0.85,
  h2hConfidenceMaxAt: 12,
  h2hWeightScale: 0.30,
  wrWeightFloor: 0.35,
  wrWeightScale: 0.50,
  formWeight: 0.30,
  tierCtxWeight: 0.10,
  maxProbLowConf: 0.70,
  maxProbMedConf: 0.80,
  maxProbGoodConf: 0.87,
  maxProbExcellentConf: 0.92,
  houseMargin2way: 0.09,
  drawShrinkageEvenBo: 0.70,
  stepUpPenaltyPerStep: 0.25,
  stepUpMaxSteps: 3,
  useGlicko: false,
  patchResetDate: null,
  patchResetMultiplier: 1.0,
  consistencyBonus: 0,
  formatMatchBoost: 1.0,
  streakWindow: 5,
};

export interface MatchRecord {
  won: boolean;
  tier: string;
  matchDate: Date | null;
  opponentId?: string | null;
  score?: string | null;
  /** Optional, used by v43 format-specific variants */
  format?: string | null;
}

export interface H2HRecord {
  winner: 1 | 2;
  tier: string;
  matchDate: Date | null;
  confidence: number;
}

export interface TunedInput {
  p1Records: MatchRecord[];
  p2Records: MatchRecord[];
  h2h: H2HRecord[];
  daysSinceLastMatch1: number;
  daysSinceLastMatch2: number;
  matchTier?: string;
  format?: string;
  opponentWinrates?: Map<string, number>;
  glickoRating1?: number;
  glickoRd1?: number;
  glickoRating2?: number;
  glickoRd2?: number;
}

export interface TunedResult {
  prob1: number;
  prob2: number;
  odds1: number;
  odds2: number;
  probDraw?: number;
}

const logit = (p: number) => {
  const c = Math.max(0.01, Math.min(0.99, p));
  return Math.log(c / (1 - c));
};
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

function tierWinrate(records: MatchRecord[], tier: string, hp: Hyperparams, minRecords = 4): number | null {
  const f = records.filter(r => r.tier === tier);
  if (f.length < minRecords) return null;
  void hp;
  return f.filter(r => r.won).length / f.length;
}

function compSOS(records: MatchRecord[], oppWr: Map<string, number>, hp: Hyperparams): number {
  if (hp.sosScale === 0) return 0;
  let total = 0, n = 0;
  for (const r of records) {
    if (!r.opponentId) continue;
    const wr = oppWr.get(r.opponentId);
    if (wr === undefined) continue;
    total += wr;
    n++;
  }
  if (n < hp.sosMinMatches) return 0;
  const avg = total / n;
  return Math.max(-hp.sosCap, Math.min(hp.sosCap, (avg - 0.5) * hp.sosScale));
}

function compWinrate(records: MatchRecord[], oppWr: Map<string, number> | undefined, hp: Hyperparams, now: number, currentMatchFormat?: string): { winrate: number; confidence: number; effN: number } {
  const decayConst = Math.LN2 / hp.halfLifeDays;
  let weightedWins = hp.priorWinrate * hp.priorStrength;
  let totalWeight = hp.priorStrength;
  for (const r of records) {
    const ageDays = r.matchDate ? (now - r.matchDate.getTime()) / 86_400_000 : 365;
    const recency = Math.exp(-decayConst * ageDays);
    const tierW = hp.tierWeight[r.tier] ?? 1.0;
    let oppStrength = 1.0;
    if (r.opponentId && oppWr) {
      const w = oppWr.get(r.opponentId);
      if (w !== undefined) oppStrength = hp.opponentStrengthA + w * hp.opponentStrengthB;
    }
    // v41 patch reset : down-weight pre-patch records.
    let patchMul = 1.0;
    if (hp.patchResetDate && r.matchDate && r.matchDate < hp.patchResetDate) {
      patchMul = hp.patchResetMultiplier ?? 1.0;
    }
    // v43 format match boost : up-weight records of the same BO format.
    let formatMul = 1.0;
    if ((hp.formatMatchBoost ?? 1.0) !== 1.0 && currentMatchFormat && r.format === currentMatchFormat) {
      formatMul = hp.formatMatchBoost!;
    }
    const matchWeight = recency * tierW * oppStrength * patchMul * formatMul;
    totalWeight += matchWeight;
    if (r.won) weightedWins += matchWeight;
  }
  const winrate = weightedWins / totalWeight;
  const effN = totalWeight - hp.priorStrength;
  const confidence = 1 - Math.exp(-effN / 20);
  return { winrate, confidence: Math.max(0, confidence), effN };
}

function compH2H(h2h: H2HRecord[], hp: Hyperparams, now: number): { prob: number; confidence: number } {
  if (h2h.length === 0) return { prob: 0.5, confidence: 0 };
  const decayConst = Math.LN2 / hp.halfLifeDays;
  let p1Score = 0, totalWeight = 0;
  for (const r of h2h) {
    const ageDays = r.matchDate ? (now - r.matchDate.getTime()) / 86_400_000 : 365;
    const recency = Math.exp(-decayConst * ageDays);
    const tierW = hp.tierWeight[r.tier] ?? 1.0;
    const w = recency * tierW * r.confidence;
    totalWeight += w;
    if (r.winner === 1) p1Score += w;
  }
  const raw = totalWeight > 0 ? p1Score / totalWeight : 0.5;
  const smoothed = sigmoid(logit(raw) * hp.h2hSmoothingScale);
  const confidence = Math.min(1.0, h2h.length / hp.h2hConfidenceMaxAt);
  return { prob: smoothed, confidence };
}

function compForm(records: MatchRecord[], hp: Hyperparams): number {
  const TIER_MULT: Record<string, number> = { S: 2.5, A: 1.8, Qualifier: 1.3, B: 1.0, C: 0.5, Misc: 0.3 };
  const recent = records
    .filter(r => r.matchDate)
    .sort((a, b) => (b.matchDate?.getTime() ?? 0) - (a.matchDate?.getTime() ?? 0))
    .slice(0, hp.formCount);
  if (recent.length < 3) return 0;

  const dominance = (s?: string | null): number => {
    if (!s) return 1.0;
    const m = s.match(/^\s*(\d+)\s*[-:]\s*(\d+)\s*$/);
    if (!m) return 1.0;
    const won = parseInt(m[1], 10), lost = parseInt(m[2], 10);
    if (won > lost && lost === 0 && won >= 3) return 1.6;
    if (won > lost && won - lost >= 2) return 1.25;
    if (lost > won && won === 0 && lost >= 3) return 1.6;
    if (lost > won && lost - won >= 2) return 1.25;
    return 1.0;
  };
  const isDraw = (s?: string | null): boolean => {
    if (!s) return false;
    const m = s.match(/^\s*(\d+)\s*[-:]\s*(\d+)\s*$/);
    if (!m) return false;
    return parseInt(m[1], 10) === parseInt(m[2], 10) && parseInt(m[1], 10) >= 1;
  };

  let weightedScore = 0, totalWeight = 0;
  for (let i = 0; i < recent.length; i++) {
    const recencyW = Math.pow(hp.formPerMatchDecay, i);
    const tierW = TIER_MULT[recent[i].tier] ?? 1.0;
    if (isDraw(recent[i].score)) {
      const w = recencyW * tierW * 0.5;
      totalWeight += w;
      weightedScore += w * 0.5;
    } else {
      const domW = dominance(recent[i].score);
      const w = recencyW * tierW * domW;
      totalWeight += w;
      if (recent[i].won) weightedScore += w;
    }
  }
  const formWr = totalWeight > 0 ? weightedScore / totalWeight : 0.5;
  let formLogit = (formWr - 0.5) * hp.formMaxLogit;

  if (hp.formEnabled && recent.length >= 3) {
    let sw = 0, sl = 0;
    for (const r of recent) {
      if (isDraw(r.score)) break;
      if (r.won) { if (sl > 0) break; sw++; } else { if (sw > 0) break; sl++; }
    }
    if (sw >= 3) formLogit += Math.min(hp.formStreakCap, (sw - 2) * hp.formStreakBonus);
    else if (sl >= 3) formLogit -= Math.min(hp.formStreakCap, (sl - 2) * hp.formStreakBonus);
  }
  return formLogit;
}

function compRust(daysSince: number, hp: Hyperparams): number {
  if (hp.rustMode === 'v2-nonlinear') {
    if (daysSince < 1) return 0.03;
    if (daysSince <= 30) return 0;
    return Math.min(0.15, 0.05 + (daysSince - 30) * 0.002);
  }
  if (daysSince <= 45) return 0;
  return Math.min(0.04, (daysSince - 45) * 0.0005);
}

function seriesWinProb(p: number, format: string): number {
  const q = 1 - p;
  if (format === 'BO1') return p;
  if (format === 'BO3') return p * p * (3 - 2 * p);
  if (format === 'BO5') return p * p * p * (1 + 3 * q + 6 * q * q);
  if (format === 'BO7') return p * p * p * p * (1 + 4 * q + 10 * q * q + 20 * q * q * q);
  if (format === 'BO2') {
    const ps = p * p, qs = q * q;
    const d = ps + qs;
    return d > 0 ? ps / d : 0.5;
  }
  if (format === 'BO4') {
    const p1 = p * p * p + 3 * p * p * p * q;
    const p2 = q * q * q + 3 * q * q * q * p;
    const d = p1 + p2;
    return d > 0 ? p1 / d : 0.5;
  }
  return p;
}

function solvePerGameProb(pMatch: number, format: string): number {
  if (pMatch <= 0 || pMatch >= 1) return pMatch;
  let lo = 0.001, hi = 0.999;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (seriesWinProb(mid, format) < pMatch) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function calculateDrawProbability(pPerGame: number, boNum: number): number {
  if (boNum % 2 !== 0) return 0;
  const half = boNum / 2;
  let binom = 1;
  for (let i = 0; i < half; i++) binom = binom * (boNum - i) / (i + 1);
  return binom * Math.pow(pPerGame, half) * Math.pow(1 - pPerGame, half);
}

const TIER_LEVEL: Record<string, number> = { S: 5, A: 4, Qualifier: 3, B: 2, C: 1, Misc: 0 };

export function calculateOddsTuned(input: TunedInput, hp: Hyperparams = DEFAULT_HYPERPARAMS): TunedResult {
  const now = Date.now();

  // Opponent winrate map (auto-fill 0.5 if caller didn't pass)
  const oppWr = input.opponentWinrates ?? new Map<string, number>();
  if (!input.opponentWinrates) {
    for (const r of [...input.p1Records, ...input.p2Records]) {
      if (r.opponentId && !oppWr.has(r.opponentId)) oppWr.set(r.opponentId, 0.5);
    }
  }

  const wr1 = compWinrate(input.p1Records, oppWr, hp, now, input.format);
  const wr2 = compWinrate(input.p2Records, oppWr, hp, now, input.format);

  const wrLogitDiff = logit(wr1.winrate) - logit(wr2.winrate);
  const sos1 = compSOS(input.p1Records, oppWr, hp);
  const sos2 = compSOS(input.p2Records, oppWr, hp);
  const wrHeuristicProb = sigmoid(wrLogitDiff * hp.wrLogitScale + (sos1 - sos2));

  const hasGlicko = hp.useGlicko &&
    input.glickoRating1 !== undefined && input.glickoRd1 !== undefined &&
    input.glickoRating2 !== undefined && input.glickoRd2 !== undefined;
  const glickoP = hasGlicko
    ? glickoWinProb(input.glickoRating1!, input.glickoRd1!, input.glickoRating2!, input.glickoRd2!)
    : null;
  const matchFormat = input.format ?? 'BO3';
  const wrProb1 = hasGlicko && glickoP !== null
    ? seriesWinProb(glickoP, matchFormat)
    : wrHeuristicProb;
  const wrConfidence = Math.sqrt(wr1.confidence * wr2.confidence);

  const h2hResult = compH2H(input.h2h, hp, now);

  const form1 = compForm(input.p1Records, hp);
  const form2 = compForm(input.p2Records, hp);

  const rust1 = compRust(input.daysSinceLastMatch1, hp);
  const rust2 = compRust(input.daysSinceLastMatch2, hp);

  // Tier-context
  let tierContextLogit = 0;
  let tierContextAvailable = false;
  if (input.matchTier) {
    const p1Tier = tierWinrate(input.p1Records, input.matchTier, hp);
    const p2Tier = tierWinrate(input.p2Records, input.matchTier, hp);
    const highest = (recs: MatchRecord[]): number => {
      let best = -1;
      for (const t of Object.keys(TIER_LEVEL)) {
        if (tierWinrate(recs, t, hp) !== null) best = Math.max(best, TIER_LEVEL[t]);
      }
      return best;
    };
    if (p1Tier !== null && p2Tier !== null) {
      tierContextLogit = (logit(p1Tier) - logit(p2Tier)) * 0.5;
      tierContextAvailable = true;
    } else if (p1Tier !== null || p2Tier !== null) {
      const matchLevel = TIER_LEVEL[input.matchTier] ?? 2;
      const p1H = highest(input.p1Records);
      const p2H = highest(input.p2Records);
      if (p1Tier !== null && p2H < matchLevel) {
        const steps = Math.min(hp.stepUpMaxSteps, matchLevel - p2H);
        tierContextLogit = (logit(p1Tier) - logit(0.45)) * 0.5 + hp.stepUpPenaltyPerStep * steps;
        tierContextAvailable = true;
      } else if (p2Tier !== null && p1H < matchLevel) {
        const steps = Math.min(hp.stepUpMaxSteps, matchLevel - p1H);
        tierContextLogit = (logit(0.45) - logit(p2Tier)) * 0.5 - hp.stepUpPenaltyPerStep * steps;
        tierContextAvailable = true;
      }
    }
  }

  // Adaptive blend
  const h2hWeight = h2hResult.confidence * hp.h2hWeightScale;
  const wrWeight = Math.max(hp.wrWeightFloor, wrConfidence * hp.wrWeightScale);
  const formWeight = hp.formWeight;
  const tierCtxWeight = tierContextAvailable ? hp.tierCtxWeight : 0;
  const weightSum = h2hWeight + wrWeight + formWeight + tierCtxWeight;
  const blendedLogit = weightSum > 0 ? (
    logit(wrProb1) * wrWeight +
    logit(h2hResult.prob) * h2hWeight +
    (form1 - form2) * formWeight +
    tierContextLogit * tierCtxWeight
  ) / weightSum : 0;

  let prob1 = sigmoid(blendedLogit);
  prob1 = sigmoid(logit(prob1) - (rust1 - rust2));

  // v42 consistency : if both players are highly consistent (low variance
  // on their last 20 results), pull the prediction toward 0.5 because the
  // engine's confidence is already extracting most of the signal — the
  // residual high-confidence prediction is more likely overfit. Conversely,
  // if at least one player is highly inconsistent, leave the prob alone
  // (we shouldn't penalize confidence on the only signal we have).
  if ((hp.consistencyBonus ?? 0) > 0) {
    const variance = (recs: MatchRecord[]) => {
      const last = recs.filter(r => r.matchDate)
        .sort((a, b) => (b.matchDate?.getTime() ?? 0) - (a.matchDate?.getTime() ?? 0))
        .slice(0, 20);
      if (last.length < 5) return 0.25; // not enough data → neutral
      const wins = last.filter(r => r.won).length / last.length;
      return wins * (1 - wins); // Bernoulli variance, max 0.25
    };
    const v1 = variance(input.p1Records);
    const v2 = variance(input.p2Records);
    const minV = Math.min(v1, v2);
    // minV close to 0 = both highly consistent, close to 0.25 = noisy
    const shrinkFactor = Math.max(0, 1 - minV / 0.20);
    const shrinkage = hp.consistencyBonus! * shrinkFactor;
    prob1 = sigmoid(logit(prob1) * (1 - shrinkage));
  }

  const totalConfidence = Math.max(wrConfidence, h2hResult.confidence);
  const maxProb = totalConfidence < 0.20 ? hp.maxProbLowConf
    : totalConfidence < 0.50 ? hp.maxProbMedConf
    : totalConfidence < 0.80 ? hp.maxProbGoodConf
    : hp.maxProbExcellentConf;
  const minProb = 1 - maxProb;
  prob1 = Math.min(maxProb, Math.max(minProb, prob1));
  let prob2 = 1 - prob1;

  let odds1 = 1 / (prob1 * (1 + hp.houseMargin2way));
  let odds2 = 1 / (prob2 * (1 + hp.houseMargin2way));
  odds1 = Math.min(20, Math.max(1.05, Math.round(odds1 * 100) / 100));
  odds2 = Math.min(20, Math.max(1.05, Math.round(odds2 * 100) / 100));

  const format = input.format ?? 'BO3';
  const boNum = parseInt(format.replace(/\D/g, ''), 10) || 3;
  let probDraw: number | undefined;
  if (boNum % 2 === 0) {
    const pPerGame = hasGlicko && glickoP !== null ? glickoP : solvePerGameProb(prob1, 'BO3');
    probDraw = calculateDrawProbability(pPerGame, boNum) * hp.drawShrinkageEvenBo;
    probDraw = Math.max(0.05, Math.min(0.45, probDraw));
    const winTotal = prob1 + prob2;
    const condProb1 = winTotal > 0 ? prob1 / winTotal : 0.5;
    const condProb2 = winTotal > 0 ? prob2 / winTotal : 0.5;
    odds1 = Math.min(20, Math.max(1.05, Math.round(1 / (condProb1 * (1 + hp.houseMargin2way)) * 100) / 100));
    odds2 = Math.min(20, Math.max(1.05, Math.round(1 / (condProb2 * (1 + hp.houseMargin2way)) * 100) / 100));
    prob1 = condProb1;
    prob2 = condProb2;
  }

  void SCALE_GLICKO;
  return { prob1, prob2, odds1, odds2, probDraw };
}
