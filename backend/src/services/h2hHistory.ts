/**
 * Pure DB lookup of head-to-head records between two players.
 *
 * Previously lived inside `aiPlayerHistoryScraper.ts`, but the function
 * itself is a plain Prisma query — no Claude / Anthropic dependency. Moved
 * into its own service module when the AI scrapers were removed on
 * 2026-04-19 (user stopped paying for the Anthropic API).
 *
 * Callers that used to `import('../scrapers/aiPlayerHistoryScraper')` for
 * `getPlayerH2HFromHistory` now `import('../services/h2hHistory')` instead.
 */

import { prisma } from '../index';

/**
 * Sentinel opponent name once written by the AI cache. We keep the constant
 * exported so that readers (odds recalc, admin panel) can exclude those
 * rows even after the scraper itself is gone. A one-shot DB cleanup deletes
 * these rows, but the filter here is a safety net in case any survive.
 */
export const SENTINEL_OPPONENT = '__claude_cache__';
export const LEGACY_SENTINEL_OPPONENT = '__AI_ENRICHED__';

export interface H2HRecord {
  winner: 1 | 2;
  tier: string;
  matchDate: Date | null;
  confidence: number;
}

/**
 * Return the H2H record list between two players, newest first, merged
 * from :
 *   - `PlayerMatchRecord` rows where `opponentId` resolves to the other
 *     player (ideal case, post-Phase 5 P0 backfill covers most of them),
 *   - `PlayerMatchRecord` rows with `opponentId = null` but an
 *     `opponentName` that fuzzy-matches the other player's name (legacy
 *     orphans).
 */
export async function getPlayerH2HFromHistory(
  player1Id: string,
  player2Id: string,
  game?: string,
): Promise<H2HRecord[]> {
  const [p1, p2] = await Promise.all([
    prisma.player.findUnique({ where: { id: player1Id }, select: { name: true } }),
    prisma.player.findUnique({ where: { id: player2Id }, select: { name: true } }),
  ]);
  if (!p1 || !p2) return [];

  const gameFilter = game ? { game } : {};
  const notSentinel = {
    NOT: {
      opponentName: { in: [SENTINEL_OPPONENT, LEGACY_SENTINEL_OPPONENT] },
    },
  };

  const byId = await prisma.playerMatchRecord.findMany({
    where: {
      ...gameFilter,
      ...notSentinel,
      OR: [
        { playerId: player1Id, opponentId: player2Id },
        { playerId: player2Id, opponentId: player1Id },
      ],
    },
    orderBy: { matchDate: 'desc' },
  }).catch(() => prisma.playerMatchRecord.findMany({
    where: {
      ...notSentinel,
      OR: [
        { playerId: player1Id, opponentId: player2Id },
        { playerId: player2Id, opponentId: player1Id },
      ],
    },
    orderBy: { matchDate: 'desc' },
  }));

  const p1Name = p1.name.toLowerCase();
  const p2Name = p2.name.toLowerCase();
  const p1Stripped = p1Name.replace(/^[a-z]+\.\s*/, '');
  const p2Stripped = p2Name.replace(/^[a-z]+\.\s*/, '');

  const byName = await prisma.playerMatchRecord.findMany({
    where: {
      ...gameFilter,
      ...notSentinel,
      opponentId: null,
      OR: [
        {
          playerId: player1Id,
          opponentName: { contains: p2Stripped.length >= 4 ? p2Stripped : p2Name, mode: 'insensitive' },
        },
        {
          playerId: player2Id,
          opponentName: { contains: p1Stripped.length >= 4 ? p1Stripped : p1Name, mode: 'insensitive' },
        },
      ],
    },
    orderBy: { matchDate: 'desc' },
  }).catch(() => []);

  const seen = new Set<string>();
  const all = [...byId, ...byName];
  const unique = all.filter(r => {
    const key = `${r.playerId}_${r.tournamentName}_${r.matchDate?.toISOString() ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique.map(r => ({
    winner: (r.playerId === player1Id ? r.won : !r.won) ? (1 as const) : (2 as const),
    tier: (r as { tier?: string | null }).tier ?? 'B',
    matchDate: r.matchDate,
    confidence: r.confidence ?? 0.8,
  }));
}
