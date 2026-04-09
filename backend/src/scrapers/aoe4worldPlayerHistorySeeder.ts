/**
 * aoe4world Player History Seeder
 *
 * Seeds PlayerMatchRecord from real aoe4world data using TWO strategies:
 *
 * Strategy 1 — H2H vs known pros:
 *   Fetches /players/{id}/games?opponent_profile_id={id} for each known pro.
 *   Good for verifying results against top players.
 *
 * Strategy 2 — All custom games:
 *   Fetches /players/{id}/games?leaderboard=custom&limit=100
 *   Catches tournament games even against players not in the pro set.
 *
 * Both strategies group consecutive games (within 3h) into BO match records.
 * Strategy 2 is invoked automatically when H2H seeding yields fewer than 50 records.
 *
 * Data source: aoe4world.com API v0
 */

import axios from 'axios';
import { prisma } from '../index';
import logger from '../logger';
import { buildProPlayerSet, getH2H } from './aoe4worldScraper';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GROUP_WINDOW_MS = 3 * 60 * 60 * 1000; // 3h window to group games into BO match
const AOE4WORLD_BASE = 'https://aoe4world.com/api/v0';

// ---------------------------------------------------------------------------
// Shared fetch helper (axios-based, not exported from aoe4worldScraper)
// ---------------------------------------------------------------------------

async function fetchAoe4World<T>(path: string): Promise<T | null> {
  try {
    const res = await axios.get<T>(`${AOE4WORLD_BASE}${path}`, {
      headers: { 'User-Agent': 'AoE4Bet/1.0', Accept: 'application/json' },
      timeout: 10000,
    });
    return res.data;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BoMatch {
  opponentAoe4Id: string;
  opponentName: string;
  playerWins: number;
  opponentWins: number;
  startedAt: Date;
  games: number;
}

interface Aoe4WorldGamesResponse {
  games: Array<{
    started_at: string;
    teams: Array<
      Array<{
        player: {
          profile_id: number;
          name: string;
          result: 'win' | 'loss';
        };
      }>
    >;
  }>;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Group consecutive games into BO matches based on timestamp proximity.
 */
function groupGamesIntoMatches(
  games: Array<{
    startedAt: string;
    playerWon: boolean;
    opponentName: string;
    opponentAoe4Id: string;
  }>,
): BoMatch[] {
  if (games.length === 0) return [];

  const sorted = [...games].sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
  );

  const matches: BoMatch[] = [];
  let current: BoMatch | null = null;
  let currentEnd = 0;

  for (const g of sorted) {
    const ts = new Date(g.startedAt).getTime();

    if (!current || ts - currentEnd > GROUP_WINDOW_MS) {
      if (current) matches.push(current);
      current = {
        opponentAoe4Id: g.opponentAoe4Id,
        opponentName: g.opponentName,
        playerWins: g.playerWon ? 1 : 0,
        opponentWins: g.playerWon ? 0 : 1,
        startedAt: new Date(g.startedAt),
        games: 1,
      };
      currentEnd = ts + 30 * 60 * 1000; // assume each game is ~30min
    } else {
      current.playerWins += g.playerWon ? 1 : 0;
      current.opponentWins += g.playerWon ? 0 : 1;
      current.games++;
      currentEnd = ts + 30 * 60 * 1000;
    }
  }
  if (current) matches.push(current);

  return matches;
}

/**
 * Resolve opponent aoe4worldId → DB player ID.
 */
async function resolveOpponentDbId(aoe4worldId: string): Promise<string | null> {
  const p = await prisma.player.findFirst({
    where: { aoe4worldId },
    select: { id: true },
  });
  return p?.id ?? null;
}

/**
 * Upsert a list of BoMatch records for a given player into PlayerMatchRecord.
 * Returns the number of records successfully stored.
 */
async function upsertBoMatches(
  playerId: string,
  playerName: string,
  matches: BoMatch[],
): Promise<number> {
  // Resolve opponent DB IDs in batch
  const opponentAoe4Ids = new Set(matches.map(m => m.opponentAoe4Id));
  const idMap = new Map<string, string | null>();
  for (const oid of opponentAoe4Ids) {
    idMap.set(oid, await resolveOpponentDbId(oid));
  }

  let stored = 0;
  for (const match of matches) {
    const opponentId = idMap.get(match.opponentAoe4Id) ?? undefined;
    const won = match.playerWins > match.opponentWins;
    const score = `${match.playerWins}-${match.opponentWins}`;
    const format =
      match.games <= 1 ? 'BO1' : match.games <= 3 ? 'BO3' : match.games <= 5 ? 'BO5' : 'BO7';

    try {
      await prisma.playerMatchRecord.upsert({
        where: {
          playerId_opponentName_tournamentName_matchDate: {
            playerId,
            opponentName: match.opponentName,
            tournamentName: 'aoe4world',
            matchDate: match.startedAt,
          },
        },
        create: {
          playerId,
          opponentName: match.opponentName,
          opponentId: opponentId ?? undefined,
          won,
          score,
          tournamentName: 'aoe4world',
          matchDate: match.startedAt,
          format,
          source: 'aoe4world',
          confidence: 1.0,
        },
        update: { won, score, opponentId: opponentId ?? undefined },
      });
      stored++;
    } catch {
      logger.debug(
        `[Seeder] Skipped duplicate: ${playerName} vs ${match.opponentName} @ ${match.startedAt.toISOString()}`,
      );
    }
  }

  return stored;
}

// ---------------------------------------------------------------------------
// Strategy 2: all custom games
// ---------------------------------------------------------------------------

/**
 * Seed match history for a player by fetching all their custom (tournament)
 * games from aoe4world, regardless of opponent.
 *
 * Hits: GET /players/{aoe4worldId}/games?leaderboard=custom&limit=100
 *
 * Returns the number of match records stored.
 */
export async function seedPlayerAllCustomGames(
  playerId: string,
  playerName: string,
  playerAoe4Id: string,
): Promise<number> {
  const data = await fetchAoe4World<Aoe4WorldGamesResponse>(
    `/players/${playerAoe4Id}/games?leaderboard=custom&limit=100`,
  );

  if (!data || data.games.length === 0) {
    logger.debug(`[Seeder] ${playerName}: no custom games found on aoe4world`);
    return 0;
  }

  const rawGames: Array<{
    startedAt: string;
    playerWon: boolean;
    opponentName: string;
    opponentAoe4Id: string;
  }> = [];

  for (const game of data.games) {
    let playerWon = false;
    let opponentName = '';
    let opponentProfileId = '';
    let foundPlayer = false;

    for (const team of game.teams) {
      for (const entry of team) {
        if (String(entry.player.profile_id) === playerAoe4Id) {
          playerWon = entry.player.result === 'win';
          foundPlayer = true;
        } else {
          opponentName = entry.player.name;
          opponentProfileId = String(entry.player.profile_id);
        }
      }
    }

    if (!foundPlayer || !opponentName) continue;

    rawGames.push({
      startedAt: game.started_at ?? new Date().toISOString(),
      playerWon,
      opponentName,
      opponentAoe4Id: opponentProfileId,
    });
  }

  if (rawGames.length === 0) {
    logger.debug(`[Seeder] ${playerName}: no parseable custom games`);
    return 0;
  }

  const matches = groupGamesIntoMatches(rawGames);

  // Take the 50 most recent
  const recent = matches
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
    .slice(0, 50);

  const stored = await upsertBoMatches(playerId, playerName, recent);

  logger.info(
    `[Seeder] ${playerName}: stored ${stored}/${recent.length} records from all-custom-games strategy`,
  );
  return stored;
}

// ---------------------------------------------------------------------------
// Strategy 1: H2H vs known pros
// ---------------------------------------------------------------------------

/**
 * Seed tournament match history for a single player from aoe4world H2H data
 * (1v1 tournament games against known pro players only, rm_custom leaderboard).
 *
 * Skips players that already have 50+ records (unless force=true).
 *
 * Returns number of match records stored.
 */
export async function seedPlayerHistoryFromAoe4World(
  playerId: string,
  playerName: string,
  playerAoe4Id: string,
  proIds: Set<string>,
  force = false,
): Promise<number> {
  if (!force) {
    const existing = await prisma.playerMatchRecord.count({
      where: { playerId, source: 'aoe4world', NOT: { opponentName: '__claude_cache__' } },
    });
    if (existing >= 50) {
      logger.debug(
        `[Seeder] ${playerName} already has ${existing} aoe4world records — skipping`,
      );
      return existing;
    }
  }

  const allGames: Array<{
    startedAt: string;
    playerWon: boolean;
    opponentName: string;
    opponentAoe4Id: string;
  }> = [];

  // Fetch H2H against each known pro
  for (const opponentAoe4Id of proIds) {
    if (opponentAoe4Id === playerAoe4Id) continue;

    const h2h = await getH2H(playerAoe4Id, opponentAoe4Id);
    if (!h2h || h2h.games.length === 0) continue;

    for (const game of h2h.games) {
      let playerWon = false;
      let opponentName = '';
      let foundPlayer = false;

      for (const team of game.teams) {
        for (const entry of team) {
          if (String(entry.player.profile_id) === playerAoe4Id) {
            playerWon = entry.player.result === 'win';
            foundPlayer = true;
          } else {
            opponentName = entry.player.name;
          }
        }
      }

      if (!foundPlayer || !opponentName) continue;

      allGames.push({
        startedAt: game.started_at ?? new Date().toISOString(),
        playerWon,
        opponentName,
        opponentAoe4Id,
      });
    }

    await new Promise(r => setTimeout(r, 200)); // gentle rate limit
  }

  let h2hStored = 0;

  if (allGames.length === 0) {
    logger.debug(`[Seeder] ${playerName}: no H2H games found against known pros`);
  } else {
    const matches = groupGamesIntoMatches(allGames);

    // Take the 50 most recent
    const recent = matches
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, 50);

    h2hStored = await upsertBoMatches(playerId, playerName, recent);

    logger.info(
      `[Seeder] ${playerName}: stored ${h2hStored}/${recent.length} match records from H2H strategy`,
    );
  }

  // Only H2H vs known pros — no fallback to all-custom-games (which included
  // practice matches, random opponents, and non-tournament games).
  return h2hStored;
}

// ---------------------------------------------------------------------------
// Bulk seeder
// ---------------------------------------------------------------------------

/**
 * Seed all players in DB that have an aoe4worldId and fewer than 50 records.
 * Uses H2H vs known pros strategy only (rm_custom leaderboard).
 */
export async function seedAllPlayerHistories(force = false): Promise<void> {
  const players = await prisma.player.findMany({
    where: { aoe4worldId: { not: null } },
    select: { id: true, name: true, aoe4worldId: true },
  });

  logger.info(
    `[Seeder] Starting history seeding for ${players.length} players with aoe4world IDs`,
  );

  const proIds = await buildProPlayerSet();
  let enriched = 0;

  for (const player of players) {
    if (!player.aoe4worldId) continue;

    const count = await seedPlayerHistoryFromAoe4World(
      player.id,
      player.name,
      player.aoe4worldId,
      proIds,
      force,
    );

    if (count > 0) enriched++;
    await new Promise(r => setTimeout(r, 500)); // 500ms between players
  }

  logger.info(`[Seeder] Done — enriched ${enriched}/${players.length} players`);
}
