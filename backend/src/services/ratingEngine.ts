/**
 * Glicko-2 rating engine — DB wrapper layer.
 *
 * Pure math lives in `./glicko2.ts` (no DB imports, no side effects — safe
 * for scripts). This module adds prisma persistence + domain-specific
 * helpers (getOrInit, updateAfterMatch, etc.).
 *
 * Reference: Mark Glickman, "Example of the Glicko-2 system" (2013).
 * http://www.glicko.net/glicko/glicko2.pdf
 */

import { prisma } from '../index';
import {
  computeUpdatedRating,
  computeWinProbability,
  DEFAULT_RATING,
  DEFAULT_RD,
  DEFAULT_VOL,
  type RatingTriple,
  type MatchResult,
} from './glicko2';

// Re-export pure functions so existing callers using ratingEngine keep working.
export { computeUpdatedRating, computeWinProbability, type RatingTriple, type MatchResult };

export const GLICKO2_DEFAULTS = {
  RATING: DEFAULT_RATING,
  RD: DEFAULT_RD,
  VOL: DEFAULT_VOL,
};

/**
 * Get a player's current rating, creating a default entry if absent.
 *
 * Uses $queryRawUnsafe / $executeRawUnsafe to stay compatible even when
 * `prisma generate` hasn't been re-run after the migration (common case
 * when the dev server holds the generated DLL).
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

export async function updateBothPlayersForMatch(
  player1Id: string,
  player2Id: string,
  /** outcome from player1's perspective : 1 = p1 wins, 0.5 = draw, 0 = p2 wins */
  outcome: 0 | 0.5 | 1,
  /** Optional tier string (S/A/B/C/Qualifier/Misc) — applied as weight via tierWeight(). */
  tier?: string | null,
): Promise<void> {
  const [r1, r2] = await Promise.all([getOrInitRating(player1Id), getOrInitRating(player2Id)]);
  const { tierWeight } = await import('./glicko2');
  const weight = tierWeight(tier);

  const p1New = computeUpdatedRating(
    { rating: r1.rating, rd: r1.rd, vol: r1.vol },
    [{ opponentRating: r2.rating, opponentRd: r2.rd, score: outcome, weight }],
  );
  const p2Score = outcome === 1 ? 0 : outcome === 0 ? 1 : 0.5;
  const p2New = computeUpdatedRating(
    { rating: r2.rating, rd: r2.rd, vol: r2.vol },
    [{ opponentRating: r1.rating, opponentRd: r1.rd, score: p2Score, weight }],
  );

  await Promise.all([
    persistRating(player1Id, p1New.rating, p1New.rd, p1New.vol, r1.gamesPlayed + 1),
    persistRating(player2Id, p2New.rating, p2New.rd, p2New.vol, r2.gamesPlayed + 1),
  ]);
}
