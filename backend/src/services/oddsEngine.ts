/**
 * Odds Engine — Converts player match history into fair decimal betting odds.
 *
 * Philosophy: ELO is meaningless here (all players start at 1500 with no ranking
 * authority). What matters is actual match results — direct H2H history between
 * the two players, overall competitive winrate from aoe4world (real games played),
 * and recent form/streak.
 *
 * Algorithm priority:
 *  1. H2H direct history (most predictive — same two players, tournament context)
 *  2. Overall competitive winrate (aoe4world rm_1v1, covers all matches)
 *  3. Recent form / streak (hot/cold factor)
 *  4. Inactivity penalty (rust factor)
 *  5. Normalize → apply 5% house margin → decimal odds
 *
 * Adaptive weighting: the more H2H data we have, the more weight it carries.
 * With 0 H2H games: full reliance on overall winrate.
 * With 10+ H2H games: H2H dominates at 50% weight.
 *
 * House margin: 5% overround. The offered odds always sum to slightly more than 1
 * in implied probability, guaranteeing long-run profitability regardless of outcomes.
 */

export interface OddsInput {
  elo1: number;   // kept for interface compat — no longer used in calculation
  elo2: number;
  h2hRecent: { winner: 1 | 2 }[];  // chronological, most recent first
  streak1: number;   // positive = win streak, negative = loss streak
  streak2: number;
  daysSinceLastMatch1: number;
  daysSinceLastMatch2: number;
  winrate1?: number;   // 0–1 decimal from aoe4world (rm_1v1)
  winrate2?: number;
  totalGames1?: number;
  totalGames2?: number;
  peakElo1?: number;   // kept for compat — unused
  peakElo2?: number;
  communityVote1?: number;
  communityVote2?: number;
}

export interface OddsResult {
  odds1: number;
  odds2: number;
  prob1: number;   // model probability for player 1 (0–1)
  prob2: number;
  impliedProb1: number;
  impliedProb2: number;
  margin: number;  // house overround in % (~5)
}

const HOUSE_MARGIN = 0.05;
const MIN_ODDS = 1.03;
const MAX_ODDS = 25.0;

// Logit / sigmoid helpers for log-odds blending
function logit(p: number): number {
  const clamped = Math.max(0.01, Math.min(0.99, p));
  return Math.log(clamped / (1 - clamped));
}
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function calculateOdds(input: OddsInput): OddsResult {
  const {
    h2hRecent,
    streak1, streak2,
    daysSinceLastMatch1, daysSinceLastMatch2,
    winrate1, winrate2,
    totalGames1, totalGames2,
  } = input;

  const games1 = totalGames1 ?? 0;
  const games2 = totalGames2 ?? 0;
  const wr1 = winrate1 ?? 0.50;
  const wr2 = winrate2 ?? 0.50;

  // ── 1. Winrate component via log-odds (Bradley-Terry logit model) ─────────
  // logit spread amplifies real quality gaps:
  // wr1=0.80 vs wr2=0.55 → logit diff ≈ 1.19 → prob1 ≈ 77% → odds ≈ 1.24 / 4.0
  // wr1=0.90 vs wr2=0.50 → logit diff ≈ 2.20 → prob1 ≈ 90% → odds ≈ 1.06 / 9.5
  const logitDiff = logit(wr1) - logit(wr2);
  // Scale 0.65: amplifies gaps without producing absurd 1.04 odds for top players.
  // Example: wr1=90% vs wr2=55% → prob1≈78% → odds ≈ 1.22 / 4.30
  const wrProb1 = sigmoid(logitDiff * 0.65);
  const wrConf1 = Math.min(1.0, games1 / 25);
  const wrConf2 = Math.min(1.0, games2 / 25);
  const wrConfidence = Math.sqrt(wrConf1 * wrConf2);

  // ── 2. H2H component (direct matchup history, recency-weighted) ──────────
  const h2h = h2hRecent.slice(0, 20);
  let h2hProb1 = 0.50;
  let h2hConfidence = 0;
  if (h2h.length > 0) {
    let p1Score = 0, totalWeight = 0;
    h2h.forEach((m, i) => {
      const weight = 1 / (i + 1);
      totalWeight += weight;
      if (m.winner === 1) p1Score += weight;
    });
    // Use logit on H2H too, to avoid extreme compression from small samples
    const rawH2h = p1Score / totalWeight;
    h2hProb1 = sigmoid(logit(rawH2h) * 0.9);
    h2hConfidence = Math.min(1.0, h2h.length / 12);
  }

  // ── 3. Adaptive blending (log-odds space) ────────────────────────────────
  // Operate in log-odds space so blending is symmetric and well-calibrated
  const h2hWeight = h2hConfidence * 0.45;
  const wrWeight = (1 - h2hWeight) * Math.max(0.60, wrConfidence);
  const baseWeight = Math.max(0, 1 - h2hWeight - wrWeight);

  const blendedLogit =
    logit(h2hProb1) * h2hWeight +
    logit(wrProb1) * wrWeight +
    0.0 * baseWeight;  // 0.0 = logit(0.5) = no info
  let prob1 = sigmoid(blendedLogit);

  // ── 4. Form / streak ──────────────────────────────────────────────────────
  // ±4% max — applies in log-odds space for consistency
  const streakEffect1 = Math.tanh(streak1 / 4) * 0.04;
  const streakEffect2 = Math.tanh(streak2 / 4) * 0.04;
  prob1 = sigmoid(logit(prob1) + (streakEffect1 - streakEffect2));

  // ── 5. Inactivity penalty ─────────────────────────────────────────────────
  const rust1 = daysSinceLastMatch1 > 30 ? Math.min(0.025, (daysSinceLastMatch1 - 30) * 0.0006) : 0;
  const rust2 = daysSinceLastMatch2 > 30 ? Math.min(0.025, (daysSinceLastMatch2 - 30) * 0.0006) : 0;
  prob1 = sigmoid(logit(prob1) - (rust1 - rust2));

  // ── 6. Clamp ─────────────────────────────────────────────────────────────
  // Low data: cap at 80% (prevents 1.05 odds on unknown players)
  // High data: allow up to 95% (MarineLorD vs weak opponent = ~1.10)
  const dataConfidence = Math.max(wrConf1, wrConf2, h2hConfidence);
  // Realistic caps: even the best pros rarely exceed 82-85% in bookmaker odds
  const maxProb = dataConfidence < 0.25 ? 0.72
    : dataConfidence < 0.60 ? 0.80
    : 0.84;
  const minProb = 1 - maxProb;

  const p1Clamped = Math.min(maxProb, Math.max(minProb, prob1));
  const p2Clamped = 1 - p1Clamped;
  const finalProb1 = p1Clamped;
  const finalProb2 = p2Clamped;

  // ── 8. Decimal odds with 5% house margin ─────────────────────────────────
  let odds1 = (1 / finalProb1) * (1 - HOUSE_MARGIN);
  let odds2 = (1 / finalProb2) * (1 - HOUSE_MARGIN);

  odds1 = Math.min(MAX_ODDS, Math.max(MIN_ODDS, odds1));
  odds2 = Math.min(MAX_ODDS, Math.max(MIN_ODDS, odds2));
  odds1 = Math.round(odds1 * 100) / 100;
  odds2 = Math.round(odds2 * 100) / 100;

  const impliedProb1 = 1 / odds1;
  const impliedProb2 = 1 / odds2;
  const margin = (impliedProb1 + impliedProb2 - 1) * 100;

  return { odds1, odds2, prob1: finalProb1, prob2: finalProb2, impliedProb1, impliedProb2, margin };
}

/**
 * Initial odds for a brand-new match with no prior data.
 * Returns 50/50 with house margin applied.
 * Used immediately after scraping before enrichment runs.
 */
export function quickOddsFromElo(_elo1: number, _elo2: number): { odds1: number; odds2: number } {
  return calculateOdds({
    elo1: 1500, elo2: 1500,
    h2hRecent: [],
    streak1: 0, streak2: 0,
    daysSinceLastMatch1: 0, daysSinceLastMatch2: 0,
  });
}

/**
 * Recalculate odds for a match with full player data from the DB.
 * Called after aoe4world stats are updated and H2H is loaded.
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
    elo1: p1.elo,
    elo2: p2.elo,
    winrate1: p1.winrate,
    winrate2: p2.winrate,
    totalGames1: p1.totalGames,
    totalGames2: p2.totalGames,
    streak1: p1.currentStreak,
    streak2: p2.currentStreak,
    daysSinceLastMatch1: days1,
    daysSinceLastMatch2: days2,
    h2hRecent,
  });
}

export interface BetRecord {
  amount: number;
  oddsAtBet: number;
  selectedPlayer: 1 | 2;
}

/**
 * Professional-grade odds adjustment using liability management and sharp/square money weighting.
 *
 * Two signals are combined:
 *  1. Liability management (60% weight) — how exposed are we to each side winning?
 *     If player1 bettors stand to collect 3000 coins and player2 bettors only 800, we're
 *     overexposed to player1 winning → shorten player1 odds to attract less action there.
 *  2. Sharp money direction (40% weight) — large bets are weighted 2–3× vs small casual bets.
 *     A single 200-coin bet signals more information than ten 20-coin bets.
 *     Following sharp money narrows odds on the side smart money backs.
 *
 * This function is idempotent: always pass the DB model odds as base (never previously adjusted
 * odds), so there is no compounding. Model odds live in DB; adjusted odds are computed live.
 *
 * Dead zone: imbalance < 12% → no adjustment (noise suppression).
 * Max adjustment: ±0.20 odds units per side.
 */
export function adjustOddsAdvanced(
  baseOdds1: number,
  baseOdds2: number,
  bets: BetRecord[]
): { odds1: number; odds2: number } {
  if (bets.length === 0) return { odds1: baseOdds1, odds2: baseOdds2 };

  const totalRawVolume = bets.reduce((s, b) => s + b.amount, 0);
  if (totalRawVolume < 100) return { odds1: baseOdds1, odds2: baseOdds2 };

  // Require at least 3 bets total AND action on both sides before moving the line.
  // With fewer participants there is no real market signal — moving odds on 1-2 bettors
  // would punish early bettors and produce artificial line movement.
  const bettorsOnSide1 = bets.filter((b) => b.selectedPlayer === 1).length;
  const bettorsOnSide2 = bets.filter((b) => b.selectedPlayer === 2).length;
  if (bets.length < 3 || bettorsOnSide1 === 0 || bettorsOnSide2 === 0) {
    return { odds1: baseOdds1, odds2: baseOdds2 };
  }

  // Sharp/square weighting by bet size — larger stakes carry more information
  function betWeight(amount: number): number {
    if (amount >= 200) return 3.0;  // whale / sharp
    if (amount >= 100) return 2.0;  // semi-sharp
    if (amount >= 50)  return 1.0;  // regular
    return 0.5;                      // square / casual
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

  // Signal 1: liability imbalance (positive = overexposed on player1 side)
  const liabilitySignal = totalLiability > 0
    ? (liability1 - liability2) / totalLiability
    : 0;

  // Signal 2: sharp money direction (positive = sharp money on player1)
  const sharpSignal = totalWeightedVol > 0
    ? (weightedVol1 - weightedVol2) / totalWeightedVol
    : 0;

  // Combined signal: protect the book first, then follow sharp money
  const combinedSignal = liabilitySignal * 0.60 + sharpSignal * 0.40;

  // Dead zone: suppress noise for minor imbalances
  if (Math.abs(combinedSignal) < 0.12) return { odds1: baseOdds1, odds2: baseOdds2 };

  // Scale adjustment: 0 at dead zone boundary → max 0.20 at full signal
  const adjustmentMag = Math.min(0.20, (Math.abs(combinedSignal) - 0.12) * 0.50);

  let odds1 = baseOdds1;
  let odds2 = baseOdds2;

  if (combinedSignal > 0) {
    // Overexposed on player1 → shorten p1 odds, slightly lengthen p2
    odds1 = Math.max(MIN_ODDS, odds1 - adjustmentMag);
    odds2 = Math.min(MAX_ODDS, odds2 + adjustmentMag * 0.4);
  } else {
    // Overexposed on player2 → shorten p2 odds, slightly lengthen p1
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
