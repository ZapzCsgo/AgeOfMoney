/**
 * TFT outright "tournament winner" odds engine.
 *
 * Inputs per participant :
 *   - Ranked strength score (tier + LP from Riot tft-league-v1)
 *   - Form score        (weighted recent placement from tft-match-v1)
 *   - Sample size       (how confident we are in the form signal)
 *
 * Output : a column of odds across all participants of one tournament that
 * sum to an overround of (1 + HOUSE_MARGIN). Each odd is also stored as an
 * `oddsBasis` JSON blob on TournamentParticipant so the admin UI can show
 * the reasoning (and the model can be backtested later).
 *
 * Design notes :
 *
 * - We deliberately do NOT use Riot's tournament-specific endpoints (they're
 *   gated and our ToS posture is already thin). Solo-queue ranked is a
 *   strong-enough proxy : Challenger players almost always go deep in pro
 *   events, and recent placements capture set-meta proficiency.
 *
 * - Players with no Riot data get a baseline score (Gold IV equivalent).
 *   The admin UI exposes a `manualOdds` field for wildcards / new players ;
 *   when set, manualOdds takes precedence over the computed odd and is
 *   NEVER overwritten on recalc.
 *
 * - Recalc is idempotent — running it twice in the same minute with the
 *   same Riot snapshots produces identical odds (to ±0.01) thanks to the
 *   deterministic softmax + rounding.
 *
 * - Bracket lock — once Tournament.bracketStarted = true, the cron stops
 *   recalculating odds for that tournament. The bet form locks anyway via
 *   the API route, but skipping the work here saves a Riot API call per
 *   participant per tick.
 */

import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../index';
import logger from '../logger';
import { snapshotPlayer, type RiotPlayerSnapshot } from './riotTftClient';

// ── Tunables ─────────────────────────────────────────────────────────────
// Calibrated empirically against past TFT Set Championship results. If the
// odds feel wrong post-launch, sweep these in `scripts/odds-experiments/`
// rather than editing in-place — same workflow as the AoE odds backtest.

const HOUSE_MARGIN  = 0.08; // 8 % overround — same target as AoE pricing
const MIN_ODDS      = 1.5;
const MAX_ODDS      = 50.0;
const SOFTMAX_TEMP  = 4.5;  // higher = more concentrated on favorites

// Weights — sum to 1
const W_RANKED      = 0.4;  // current LP / tier
const W_FORM        = 0.6;  // recent 20-game placement

// Score for a player with no Riot data — Gold IV equivalent (≈ median amateur).
// Tournament-class players are usually Master+, so a baseline player will be
// priced as a longshot, which matches reality for wildcards / regional qualifiers.
const BASELINE_RANKED_SCORE = 1500;
const BASELINE_FORM         = 4.5; // 4.5 = average placement (1-8 range)

/**
 * Convert a Riot snapshot into a single normalised strength score in [0, 1].
 * Higher = stronger.
 */
export function normalisedStrength(snap: RiotPlayerSnapshot | null): number {
  // Ranked component
  const rankedRaw = snap?.rankedStrength ?? BASELINE_RANKED_SCORE;
  const rankedNorm = Math.max(0, Math.min(1, rankedRaw / 3600)); // CHALLENGER is ~3600

  // Form component — invert placement (1 best, 8 worst → 1 best, 0 worst)
  // and discount when sample is small.
  const formRaw   = snap?.formScore ?? BASELINE_FORM;
  const formNorm  = Math.max(0, Math.min(1, (8 - formRaw) / 7));
  const formConf  = snap && snap.sampleSize >= 10 ? 1.0
                 : snap && snap.sampleSize >= 5  ? 0.6
                 : 0.3;
  const formShrunk = formNorm * formConf + 0.5 * (1 - formConf); // shrink to neutral

  return rankedNorm * W_RANKED + formShrunk * W_FORM;
}

// ── Softmax + margin ─────────────────────────────────────────────────────

function softmax(scores: number[], temperature: number): number[] {
  if (scores.length === 0) return [];
  const max = Math.max(...scores);
  const exps = scores.map((s) => Math.exp((s - max) * temperature));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

/**
 * Apply HOUSE_MARGIN to raw probabilities → decimal odds. Returns odds
 * normalised so 1/sum(odd) ≈ 1 + margin (true overround).
 */
function probabilitiesToOdds(probs: number[]): number[] {
  if (probs.length === 0) return [];
  const targetOverround = 1 + HOUSE_MARGIN;
  // Raw odds = 1 / p (fair odds). Inflate by overround proportionally.
  const fair = probs.map((p) => (p > 0 ? 1 / p : MAX_ODDS));
  const overround = fair.reduce((a, o) => a + 1 / o, 0); // ~1.0 if probs sum to 1
  const scale = overround / targetOverround;
  const odds = fair.map((o) => o * scale);
  // Clamp
  return odds.map((o) => Math.min(MAX_ODDS, Math.max(MIN_ODDS, Number(o.toFixed(2)))));
}

// ── Public surface ───────────────────────────────────────────────────────

interface ComputedOdd {
  participantId: string;
  playerId: string;
  playerName: string;
  computedOdds: number;
  probability: number;
  basis: {
    riotPuuid: string | null;
    rankedStrength: number;
    avgPlacement: number | null;
    formScore: number | null;
    sampleSize: number;
    score: number;       // normalised strength score [0, 1]
    isBaseline: boolean; // true → fell back to baseline (no Riot data)
    manualOverride: boolean;
  };
}

/**
 * Compute odds for one tournament. Pulls fresh Riot snapshots for every
 * participant who has a riotPuuid ; writes the result to the DB.
 *
 * Bracket-locked tournaments are skipped silently.
 */
export async function recomputeTournamentOdds(tournamentId: string): Promise<ComputedOdd[]> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: {
      id: true,
      name: true,
      game: true,
      bracketStarted: true,
      participants: {
        include: {
          player: { select: { id: true, name: true, riotPuuid: true } },
        },
      },
    },
  });

  if (!tournament || tournament.game !== 'TFT') {
    logger.warn(`[TFTOdds] Tournament ${tournamentId} not found or not TFT — skipping`);
    return [];
  }
  if (tournament.bracketStarted) {
    logger.info(`[TFTOdds] Tournament "${tournament.name}" bracket already started — odds frozen`);
    return [];
  }
  if (tournament.participants.length < 2) {
    logger.info(`[TFTOdds] Tournament "${tournament.name}" has <2 participants — nothing to price`);
    return [];
  }

  // ── 1. Fetch a Riot snapshot for every participant with a PUUID ──────
  // We do this sequentially through the riotTftClient's Bottleneck, so it
  // naturally honours the per-second rate limit. snapshotPlayer makes ~22
  // API calls per player (1 summoner + 1 league + 20 match details), so a
  // 24-participant tournament costs ~530 calls — well over 1 second but
  // still under 2 minutes on a dev key.
  const snapshots = new Map<string, RiotPlayerSnapshot | null>();
  for (const p of tournament.participants) {
    if (!p.player.riotPuuid) {
      snapshots.set(p.id, null);
      continue;
    }
    try {
      const snap = await snapshotPlayer(p.player.riotPuuid);
      snapshots.set(p.id, snap);
      if (snap?.currentTier) {
        // Cache the human-readable tier on Player for admin display
        await prisma.player.update({
          where: { id: p.player.id },
          data: { tftCurrentTier: snap.currentTier },
        }).catch(() => { /* not critical */ });
      }
    } catch (err) {
      logger.warn(`[TFTOdds] Snapshot failed for ${p.player.name}: ${(err as Error).message}`);
      snapshots.set(p.id, null);
    }
  }

  // ── 2. Compute strength scores ────────────────────────────────────────
  const items = tournament.participants.map((p) => {
    const snap = snapshots.get(p.id) ?? null;
    const score = normalisedStrength(snap);
    return { participant: p, snap, score };
  });

  // ── 3. Softmax → probabilities → odds ────────────────────────────────
  const probabilities = softmax(items.map((i) => i.score), SOFTMAX_TEMP);
  const odds = probabilitiesToOdds(probabilities);

  // ── 4. Write back, respecting manualOdds overrides ────────────────────
  const computed: ComputedOdd[] = [];
  for (let i = 0; i < items.length; i++) {
    const { participant, snap, score } = items[i];
    const computedOdd = odds[i];
    const hasManual = participant.manualOdds !== null && participant.manualOdds !== undefined;
    const finalOdd  = hasManual ? Number(participant.manualOdds!.toString()) : computedOdd;

    const basis: ComputedOdd['basis'] = {
      riotPuuid: participant.player.riotPuuid,
      rankedStrength: snap?.rankedStrength ?? BASELINE_RANKED_SCORE,
      avgPlacement: snap?.avgPlacement ?? null,
      formScore: snap?.formScore ?? null,
      sampleSize: snap?.sampleSize ?? 0,
      score: Number(score.toFixed(4)),
      isBaseline: !snap,
      manualOverride: hasManual,
    };

    await prisma.tournamentParticipant.update({
      where: { id: participant.id },
      data: {
        // Only the computed value gets written here — manualOdds is left
        // alone so the admin can revert by clearing it in the UI.
        odds: new Decimal(computedOdd.toFixed(4)),
        oddsBasis: basis as unknown as object,
      },
    });

    computed.push({
      participantId: participant.id,
      playerId: participant.player.id,
      playerName: participant.player.name,
      computedOdds: finalOdd,
      probability: probabilities[i],
      basis,
    });
  }

  // Sanity-check overround — log if we drift outside [6%, 10%]
  const totalImpliedProb = computed.reduce((a, c) => a + 1 / c.computedOdds, 0);
  const overround = totalImpliedProb - 1;
  if (overround < 0.06 || overround > 0.10) {
    logger.warn(
      `[TFTOdds] Tournament "${tournament.name}" overround ${(overround * 100).toFixed(2)}% — ` +
      `outside target band [6%, 10%]. Check SOFTMAX_TEMP / HOUSE_MARGIN.`,
    );
  }
  logger.info(
    `[TFTOdds] "${tournament.name}": priced ${computed.length} participants, ` +
    `overround=${(overround * 100).toFixed(2)}%, favorite=${computed.reduce((a, b) => a.computedOdds < b.computedOdds ? a : b).playerName} @ ${computed.reduce((a, b) => a.computedOdds < b.computedOdds ? a : b).computedOdds}×`,
  );

  return computed;
}

/**
 * Cron entry — find all TFT tournaments that are still open for betting
 * (bracketStarted=false AND start within 14 days) and recompute odds for
 * each. Spaced out so we don't exhaust the Riot quota in one tick.
 */
export async function recomputeAllOpenTftOdds(): Promise<void> {
  const tournaments = await prisma.tournament.findMany({
    where: {
      game: 'TFT',
      bracketStarted: false,
      isActive: true,
      startDate: {
        gte: new Date(Date.now() - 24 * 3600 * 1000),
        lte: new Date(Date.now() + 14 * 24 * 3600 * 1000),
      },
    },
    select: { id: true },
  });
  logger.info(`[TFTOdds] Recomputing odds for ${tournaments.length} open tournaments`);
  for (const t of tournaments) {
    try {
      await recomputeTournamentOdds(t.id);
    } catch (err) {
      logger.error(`[TFTOdds] Failed to recompute ${t.id}:`, err);
    }
  }
}

// ── Exposed for tests ─────────────────────────────────────────────────────
export const __internal = { softmax, probabilitiesToOdds, HOUSE_MARGIN, SOFTMAX_TEMP };
