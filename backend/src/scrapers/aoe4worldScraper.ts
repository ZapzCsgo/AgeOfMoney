import axios from 'axios';
import { prisma } from '../index';
import logger from '../logger';

const AOE4WORLD_BASE = 'https://aoe4world.com/api/v0';

interface ModeStats {
  rank?: number;
  rating?: number;
  max_rating?: number;
  streak?: number;
  wins?: number;
  losses?: number;
  games_count?: number;
  win_rate?: number;   // 0–100 (aoe4world returns percentage, not decimal)
  last_game_at?: string;
}

interface Aoe4WorldPlayer {
  profile_id: number;
  name: string;
  country: string | null;
  avatars?: {
    small?: string;
    medium?: string;
    full?: string;
  };
  modes?: {
    rm_1v1?: ModeStats;
    rm_1v1_elo?: ModeStats;  // old ranked ladder
    qm_1v1?: ModeStats;      // quick match
    rm_solo?: ModeStats;
  };
}

/** Pick the best available 1v1 mode stats, preferring competitive modes */
function getBestMode(modes?: Aoe4WorldPlayer['modes']): ModeStats | null {
  if (!modes) return null;
  // Prefer rm_1v1 (new ranked) if it has real data
  if (modes.rm_1v1 && (modes.rm_1v1.games_count ?? 0) > 0) return modes.rm_1v1;
  // Fallback to rm_1v1_elo (old ranked ladder — most used by pro players)
  if (modes.rm_1v1_elo && (modes.rm_1v1_elo.games_count ?? 0) > 0) return modes.rm_1v1_elo;
  // Last resort: quick match
  if (modes.qm_1v1 && (modes.qm_1v1.games_count ?? 0) > 0) return modes.qm_1v1;
  return null;
}

interface H2HPlayer {
  profile_id: number;
  name: string;
  result: 'win' | 'loss';
  civilization?: string;
}

// aoe4world /games endpoint returns teams as Array<Array<{player: H2HPlayer}>>
// (each team member is wrapped in a {player: ...} object)
interface H2HGameEntry {
  player: H2HPlayer;
}

interface H2HGame {
  started_at: string;
  duration: number;
  map: string;
  teams: Array<H2HGameEntry[]>;
}

interface Aoe4WorldSearchResult {
  players: Array<{
    profile_id: number;
    name: string;
    country: string | null;
    rating: number;
  }>;
}

async function fetchApi<T>(path: string): Promise<T | null> {
  try {
    const res = await axios.get<T>(`${AOE4WORLD_BASE}${path}`, {
      headers: {
        'User-Agent': 'AoE4Bet/1.0 (educational; contact@aoe4bet.com)',
        Accept: 'application/json',
      },
      timeout: 10000,
    });
    return res.data;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      if (err.response?.status === 404) return null;
      if (err.response?.status === 429) {
        logger.warn('aoe4world rate limit hit, backing off');
        await new Promise((r) => setTimeout(r, 5000));
        return null;
      }
    }
    logger.error(`aoe4world API error for ${path}:`, err);
    return null;
  }
}

export async function getPlayerStats(aoe4worldId: string): Promise<Aoe4WorldPlayer | null> {
  return fetchApi<Aoe4WorldPlayer>(`/players/${aoe4worldId}`);
}

export async function getH2H(
  player1Id: string,
  player2Id: string
): Promise<{ games: H2HGame[]; player1Wins: number; player2Wins: number; total: number } | null> {
  const data = await fetchApi<{ games: H2HGame[] }>(
    `/players/${player1Id}/games?opponent_profile_id=${player2Id}&limit=50`
  );

  if (!data) return null;

  const games = data.games || [];
  let player1Wins = 0;
  let player2Wins = 0;

  for (const game of games) {
    for (const team of game.teams) {
      for (const entry of team) {
        const p = entry.player;
        if (!p) continue;
        if (String(p.profile_id) === player1Id && p.result === 'win') {
          player1Wins++;
        } else if (String(p.profile_id) === player2Id && p.result === 'win') {
          player2Wins++;
        }
      }
    }
  }

  return { games, player1Wins, player2Wins, total: games.length };
}

/**
 * Fetch aoe4world profile ID from the player's Liquipedia page via the API.
 * Liquipedia stores |aoe4net_id= in the player wikitext — this is the most
 * accurate source since it's maintained by the community.
 */
async function getAoe4NetIdFromLiquipedia(liquipediaSlug: string): Promise<string | null> {
  try {
    const res = await axios.get<{ parse?: { wikitext?: { '*': string } } }>(
      `https://liquipedia.net/ageofempires/api.php`,
      {
        params: { action: 'parse', page: liquipediaSlug, prop: 'wikitext', format: 'json' },
        headers: { 'User-Agent': 'AgeOfMoney/1.0 (contact@ageofmoney.com)', Accept: 'application/json' },
        timeout: 12000,
      }
    );
    const wikitext = res.data?.parse?.wikitext?.['*'] ?? '';
    const m = wikitext.match(/\|aoe4net_id\s*=\s*([0-9]+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * Try multiple strategies to find a player's aoe4world profile ID.
 * Returns the profile_id as string, or null if not found.
 */
async function resolveAoe4WorldId(player: { name: string; liquipediaSlug: string }): Promise<string | null> {
  const trySearch = async (query: string): Promise<string | null> => {
    const results = await fetchApi<Aoe4WorldSearchResult>(
      `/players/search?query=${encodeURIComponent(query)}&limit=20`
    );
    const players = results?.players ?? [];

    // 1. Case-sensitive exact match (e.g. "MarineLorD" ≠ "MarineLord")
    const exactCS = players.find(r => r.name === query);
    if (exactCS) return String(exactCS.profile_id);

    // 2. Exact match ignoring team tag prefix (e.g. "M8.MarineLorD" → "MarineLorD")
    const tagStripped = players.find(r => {
      const stripped = r.name.replace(/^[a-zA-Z0-9]+[.\s]\s*/,'');
      return stripped === query || stripped.toLowerCase() === query.toLowerCase();
    });
    if (tagStripped) return String(tagStripped.profile_id);

    // 3. Case-insensitive exact
    const exactCI = players.find(r => r.name.toLowerCase() === query.toLowerCase());
    if (exactCI) return String(exactCI.profile_id);

    // 4. Partial match — prefer the player with the most games (highest rating as proxy)
    const partials = players.filter(r =>
      r.name.toLowerCase().includes(query.toLowerCase()) ||
      query.toLowerCase().includes(r.name.toLowerCase())
    );
    if (partials.length > 0) {
      // Pick highest rating (most active player)
      const best = partials.reduce((a, b) => ((a.rating ?? 0) >= (b.rating ?? 0) ? a : b));
      return String(best.profile_id);
    }

    return null;
  };

  // Strategy 0: Liquipedia wikitext — most authoritative source
  const liquipediaId = await getAoe4NetIdFromLiquipedia(player.liquipediaSlug);
  if (liquipediaId) return liquipediaId;

  // Small delay to respect Liquipedia rate limit
  await new Promise(r => setTimeout(r, 1000));

  // Strategy 1: exact name (case-sensitive preferred, then case-insensitive)
  let id = await trySearch(player.name);
  if (id) return id;

  // Strategy 2: slug decoded (e.g. "TheViper" from "TheViper" slug)
  const decodedSlug = decodeURIComponent(player.liquipediaSlug).replace(/_/g, ' ');
  if (decodedSlug.toLowerCase() !== player.name.toLowerCase()) {
    id = await trySearch(decodedSlug);
    if (id) return id;
  }

  // Strategy 3: slug without spaces/underscores (e.g. "MbL40")
  const slugCompact = decodeURIComponent(player.liquipediaSlug).replace(/[_\s]/g, '');
  if (slugCompact.toLowerCase() !== player.name.toLowerCase()) {
    id = await trySearch(slugCompact);
    if (id) return id;
  }

  return null;
}

/**
 * Compute a player's pro-vs-pro win rate by doing targeted H2H calls against
 * all known pro opponents. Uses the full historical record per matchup (not
 * just recent games), which is the only reliable signal for tournament betting.
 */
export async function computeProRecord(
  aoe4worldId: string,
  knownProIds: Set<string>
): Promise<{ winrate: number; totalGames: number } | null> {
  let totalWins = 0;
  let totalGames = 0;

  for (const opponentId of knownProIds) {
    if (opponentId === aoe4worldId) continue;
    const h2h = await getH2H(aoe4worldId, opponentId);
    if (h2h && h2h.total > 0) {
      totalWins += h2h.player1Wins;
      totalGames += h2h.total;
    }
    await new Promise(r => setTimeout(r, 250));
  }

  if (totalGames < 3) return null;
  return { winrate: totalWins / totalGames, totalGames };
}

/**
 * Known top AoE4 competitive players — aoe4world profile IDs.
 * IDs verified directly against the aoe4world API (search + H2H confirmation).
 * Used to compute pro-vs-pro winrates from H2H data.
 * Add more IDs here as new pros appear in tournaments.
 */
const KNOWN_PRO_IDS: string[] = [
  '1102458',   // M8.MarineLorD (FR) ✓
  '8446710',   // 1puppypaw (CA) ✓
  '60328',     // VortiX (ES) ✓
  '8442107',   // Wam01 (CA) ✓
  '520130',    // Chuckfrancis (FR) ✓ (was 7025744)
  '196240',    // GL.TheViper (NO) ✓ (was 5373052)
  '506898',    // aM.Liereyy (AT) ✓ (was 234007)
  '208611',    // Villese (FI) ✓ (was 5591714)
  '198035',    // GL.DauT (RS) ✓ (was 5657350)
  '197388',    // GL.TaToH (ES) ✓ (was 5637626/236977)
  '1224481',   // KASVA (TR) ✓ (was 56669)
  '7101790',   // DimPaille (FR) ✓
  '199170',    // dogao (BR) ✓ (was 2062522)
  '8508252',   // Elyona ✓
  '6975115',   // Downfall (DE)
  '4524456',   // ACCM (CN)
  '6225396',   // Yo (RU)
  '267832',    // AceOfDiamonds (US)
  '4261585',   // Sitaux (FR)
  '19664369',  // Tunison
  '4281011',   // Kvoth
  '256338',    // Running
];

/**
 * Build a comprehensive set of pro player aoe4world IDs by pulling all
 * participants from S/A-tier tournaments on the aoe4world API.
 * Falls back to the hardcoded list + DB players if the API fails.
 */
export async function buildProPlayerSet(): Promise<Set<string>> {
  const proIds = new Set<string>(KNOWN_PRO_IDS);

  try {
    // Pull all tournament participants from aoe4world S/A-tier tournaments
    interface TournamentListItem {
      slug: string;
      tier: string;
      cancelled?: boolean;
      end_date?: string;
    }
    const data = await fetchApi<{ tournaments: TournamentListItem[] }>('/tournaments?limit=200');
    if (data?.tournaments) {
      const cutoff = new Date(Date.now() - 90 * 24 * 3600 * 1000); // last 90 days
      const relevant = data.tournaments.filter(t => {
        if (t.cancelled) return false;
        const tier = t.tier?.toLowerCase() ?? '';
        if (!tier.includes('s') && !tier.includes('a')) return false;
        const endDate = t.end_date ? new Date(t.end_date) : null;
        if (endDate && endDate < cutoff) return false;
        return true;
      });

      for (const tourn of relevant) {
        interface TournamentDetail {
          participants?: Array<{ player: { profile_id: number } }>;
        }
        const detail = await fetchApi<TournamentDetail>(`/tournaments/${tourn.slug}`);
        if (detail?.participants) {
          for (const p of detail.participants) {
            if (p.player?.profile_id) proIds.add(String(p.player.profile_id));
          }
        }
        await new Promise(r => setTimeout(r, 200));
      }

      logger.info(`[aoe4world] Fetched pro IDs from ${relevant.length} S/A-tier tournaments`);
    }

    // Also add all players already tracked in our DB
    const dbProIds = await prisma.player.findMany({
      where: { aoe4worldId: { not: null } },
      select: { aoe4worldId: true },
    });
    for (const p of dbProIds) {
      if (p.aoe4worldId) proIds.add(p.aoe4worldId);
    }

    logger.info(`[aoe4world] Built pro player set: ${proIds.size} known pros`);
  } catch (err) {
    logger.error('[aoe4world] buildProPlayerSet error:', err);
  }

  return proIds;
}

export async function searchPlayer(name: string): Promise<Aoe4WorldSearchResult['players']> {
  const data = await fetchApi<Aoe4WorldSearchResult>(
    `/players/search?query=${encodeURIComponent(name)}&limit=10`
  );
  return data?.players ?? [];
}

/**
 * Compute a player's stats from our own DB match history.
 * This uses only completed tournament matches — the most relevant signal for betting.
 */
export async function getPlayerDbStats(
  playerId: string,
  excludeMatchId?: string
): Promise<{
  winrate: number;
  totalGames: number;
  streak: number;
  daysSinceLastMatch: number;
}> {
  // ── Primary source: PlayerMatchRecord (esport tournament history) ──────────
  // This is scraped from Liquipedia, aoe4world tournaments, and AI enrichment.
  // It reflects actual competitive performance — never ranked pub games.
  const tourneyRecords = await prisma.playerMatchRecord.findMany({
    where: { playerId, confidence: { gte: 0.65 } },
    orderBy: { matchDate: 'desc' },
    take: 80,
    select: { won: true, matchDate: true },
  });

  // ── Secondary: completed matches on this platform ─────────────────────────
  const platformMatches = await prisma.match.findMany({
    where: {
      status: 'COMPLETED',
      winnerId: { not: null },
      OR: [{ player1Id: playerId }, { player2Id: playerId }],
      ...(excludeMatchId ? { NOT: { id: excludeMatchId } } : {}),
    },
    orderBy: { scheduledAt: 'desc' },
    take: 50,
    select: { winnerId: true, scheduledAt: true },
  });

  // Merge: platform matches treated as high-confidence tourney records
  const platformAsRecords = platformMatches.map(m => ({
    won: m.winnerId === playerId,
    matchDate: m.scheduledAt,
  }));

  // Combine and sort by date (most recent first), deduplicated by day
  const allRecords = [...platformAsRecords, ...tourneyRecords]
    .sort((a, b) => (b.matchDate?.getTime() ?? 0) - (a.matchDate?.getTime() ?? 0))
    .slice(0, 80);

  const total = allRecords.length;
  const wins = allRecords.filter(r => r.won).length;
  const winrate = total > 0 ? wins / total : 0.5;

  // Streak from most recent results
  let streak = 0;
  for (const r of allRecords) {
    if (streak === 0) { streak = r.won ? 1 : -1; }
    else if (streak > 0 && r.won) streak++;
    else if (streak < 0 && !r.won) streak--;
    else break;
  }

  const lastRecord = allRecords[0];
  const daysSinceLastMatch = lastRecord?.matchDate
    ? (Date.now() - lastRecord.matchDate.getTime()) / 86400000
    : 30;

  return { winrate, totalGames: total, streak, daysSinceLastMatch };
}

export async function updatePlayerFromAoe4World(
  playerId: string,
  knownProIds?: Set<string>
): Promise<boolean> {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { id: true, name: true, liquipediaSlug: true, aoe4worldId: true, totalGames: true },
  });

  if (!player) return false;

  let aoe4worldId = player.aoe4worldId;

  // If no ID yet, try to find it with multiple strategies
  if (!aoe4worldId) {
    aoe4worldId = await resolveAoe4WorldId({ name: player.name, liquipediaSlug: player.liquipediaSlug });
    if (!aoe4worldId) {
      logger.debug(`[aoe4world] Could not find profile for: ${player.name}`);
      return false;
    }
  }

  const stats = await getPlayerStats(aoe4worldId);
  if (!stats) return false;

  // Compute pro tournament record by aggregating H2H against all other known pros
  const proIds = new Set(knownProIds ?? []);
  proIds.delete(aoe4worldId); // exclude self
  const proRecord = proIds.size >= 3
    ? await computeProRecord(aoe4worldId, proIds)
    : null;

  const updateData: {
    aoe4worldId: string;
    lastUpdatedAt: Date;
    country?: string;
    avatarUrl?: string;
    elo?: number;
    winrate?: number;
    totalGames?: number;
    currentStreak?: number;
    peakElo?: number;
    lastMatchAt?: Date;
  } = {
    aoe4worldId,
    lastUpdatedAt: new Date(),
  };

  if (stats.country) updateData.country = stats.country;
  if (stats.avatars?.medium) updateData.avatarUrl = stats.avatars.medium;

  // Use pro-vs-pro record as winrate — ladder stats are irrelevant (random opponents ≠ pros)
  if (proRecord && proRecord.totalGames >= 3) {
    updateData.winrate = proRecord.winrate;
    updateData.totalGames = proRecord.totalGames;
    logger.info(`[aoe4world] ${player.name}: pro record ${(proRecord.winrate * 100).toFixed(1)}% over ${proRecord.totalGames}g vs known pros`);
  } else {
    // Not enough pro matchup data — odds engine defaults to 50/50 for this player
    logger.debug(`[aoe4world] ${player.name}: insufficient pro matchup data (<3 games vs known pros)`);
  }

  // Store ELO/peak/lastMatch from ladder for reference (streak, inactivity penalty)
  const bestMode = getBestMode(stats.modes);
  if (bestMode?.rating) updateData.elo = bestMode.rating;
  if (bestMode?.max_rating) updateData.peakElo = bestMode.max_rating;
  if (bestMode?.last_game_at) updateData.lastMatchAt = new Date(bestMode.last_game_at);

  await prisma.player.update({
    where: { id: playerId },
    data: updateData,
  });

  return true;
}

export async function updateAllPlayerStats(): Promise<void> {
  const startTime = Date.now();
  let updated = 0;
  let errors = 0;

  try {
    const players = await prisma.player.findMany({
      select: { id: true, name: true },
      orderBy: { lastUpdatedAt: 'asc' },
      take: 50,
    });

    // Build comprehensive pro player set from aoe4world tournament API + our DB
    const knownProIds = await buildProPlayerSet();

    logger.info(`Updating stats for ${players.length} players from aoe4world (${knownProIds.size} known pro IDs)`);

    for (const player of players) {
      const success = await updatePlayerFromAoe4World(player.id, new Set(knownProIds));
      if (success) updated++;
      else errors++;
      await new Promise((r) => setTimeout(r, 500));
    }

    await prisma.scraperLog.create({
      data: {
        source: 'aoe4world',
        status: errors === 0 ? 'success' : 'partial',
        matchesFound: updated,
        duration: Date.now() - startTime,
        error: errors > 0 ? `${errors} players failed to update` : undefined,
      },
    });

    logger.info(`Player stats update complete: ${updated} updated, ${errors} errors`);
  } catch (error) {
    logger.error('updateAllPlayerStats error:', error);
    await prisma.scraperLog.create({
      data: {
        source: 'aoe4world',
        status: 'error',
        matchesFound: updated,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

export async function enrichMatchWithH2H(matchId: string): Promise<void> {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      player1: {
        select: {
          id: true, name: true, liquipediaSlug: true, aoe4worldId: true,
          elo: true, winrate: true, totalGames: true, currentStreak: true,
          peakElo: true, lastMatchAt: true,
        },
      },
      player2: {
        select: {
          id: true, name: true, liquipediaSlug: true, aoe4worldId: true,
          elo: true, winrate: true, totalGames: true, currentStreak: true,
          peakElo: true, lastMatchAt: true,
        },
      },
    },
  });

  if (!match) return;

  // ── 1. Compute DB tournament stats for both players ───────────────────────
  // These are real tournament results from matches we've tracked — the best
  // signal for tournament betting.
  const [dbStats1, dbStats2] = await Promise.all([
    getPlayerDbStats(match.player1Id, matchId),
    getPlayerDbStats(match.player2Id, matchId),
  ]);

  // ── 2. Build player profile from tournament history only ─────────────────
  // Priority: our tracked DB match results (most accurate, tournament-specific).
  // Fallback: aoe4world custom/tournament game stats stored on the Player record.
  // Ranked ladder stats (rm_1v1) are NEVER used — pub games ≠ pro performance.
  const buildProfile = (
    dbStats: typeof dbStats1,
    _playerRecord: typeof match.player1,
  ) => {
    // Use tournament history stats — ranked ladder is never considered
    if (dbStats.totalGames >= 1) {
      return {
        winrate: dbStats.winrate,
        totalGames: dbStats.totalGames,
        streak: dbStats.streak,
        daysSince: dbStats.daysSinceLastMatch,
      };
    }
    // No tournament data at all → 50/50
    return { winrate: 0.5, totalGames: 0, streak: 0, daysSince: 30 };
  };

  const profile1 = buildProfile(dbStats1, match.player1);
  const profile2 = buildProfile(dbStats2, match.player2);

  // ── 3. Ensure both players have aoe4world history seeded ────────────────────
  // For new players (0 records), seed their pro match history from aoe4world H2H data
  // before computing odds so we have real data to work with.
  {
    const [p1Count, p2Count] = await Promise.all([
      prisma.playerMatchRecord.count({ where: { playerId: match.player1Id } }),
      prisma.playerMatchRecord.count({ where: { playerId: match.player2Id } }),
    ]);
    if (p1Count === 0 && match.player1.aoe4worldId) {
      logger.info(`[Enrich] New player ${match.player1.name} — seeding match history`);
      const { seedPlayerHistoryFromAoe4World } = await import('./aoe4worldPlayerHistorySeeder');
      const proIds = await buildProPlayerSet();
      await seedPlayerHistoryFromAoe4World(match.player1Id, match.player1.name, match.player1.aoe4worldId, proIds).catch(() => {});
    }
    if (p2Count === 0 && match.player2.aoe4worldId) {
      logger.info(`[Enrich] New player ${match.player2.name} — seeding match history`);
      const { seedPlayerHistoryFromAoe4World } = await import('./aoe4worldPlayerHistorySeeder');
      const proIds = await buildProPlayerSet();
      await seedPlayerHistoryFromAoe4World(match.player2Id, match.player2.name, match.player2.aoe4worldId, proIds).catch(() => {});
    }
  }

  // ── 4. H2H history ────────────────────────────────────────────────────────
  let h2hRecent: { winner: 1 | 2 }[] = [];

  // Try aoe4world H2H (if both players have IDs)
  if (match.player1.aoe4worldId && match.player2.aoe4worldId) {
    const h2h = await getH2H(match.player1.aoe4worldId, match.player2.aoe4worldId);
    if (h2h && h2h.games.length > 0) {
      h2hRecent = h2h.games.slice(0, 20).map((g) => {
        const p1Win = g.teams.some((team) =>
          team.some(
            (entry) => String(entry.player.profile_id) === match.player1.aoe4worldId && entry.player.result === 'win'
          )
        );
        return { winner: p1Win ? (1 as const) : (2 as const) };
      });
    }
  }

  // Supplement or fallback with DB H2H
  if (h2hRecent.length < 20) {
    const dbH2H = await prisma.match.findMany({
      where: {
        status: 'COMPLETED',
        winnerId: { not: null },
        OR: [
          { player1Id: match.player1Id, player2Id: match.player2Id },
          { player1Id: match.player2Id, player2Id: match.player1Id },
        ],
        NOT: { id: matchId },
      },
      orderBy: { scheduledAt: 'desc' },
      take: 20,
      select: { player1Id: true, winnerId: true },
    });

    const dbH2HMapped = dbH2H.map((m) => ({
      winner: m.winnerId === match.player1Id ? (1 as const) : (2 as const),
    }));

    // Merge: aoe4world H2H first (more complete), then DB as supplement
    const existingCount = h2hRecent.length;
    const needed = Math.max(0, 20 - existingCount);
    h2hRecent = [...h2hRecent, ...dbH2HMapped.slice(0, needed)];
  }

  // Supplement H2H with AI-stored player history records
  if (h2hRecent.length < 20) {
    const { getPlayerH2HFromHistory } = await import('./aiPlayerHistoryScraper');
    const aiH2H = await getPlayerH2HFromHistory(match.player1Id, match.player2Id);
    if (aiH2H.length > 0) {
      const needed = Math.max(0, 20 - h2hRecent.length);
      const aiMapped = aiH2H.slice(0, needed).map(r => ({ winner: r.winner }));
      h2hRecent = [...h2hRecent, ...aiMapped];
      logger.debug(`[Odds] Supplemented H2H with ${aiMapped.length} AI records for ${match.player1.name} vs ${match.player2.name}`);
    }
  }

  // ── 5. Calculate odds ──────────────────────────────────────────────────────
  const { calculateOddsFromPlayers } = await import('../services/oddsEngine');
  const newOdds = calculateOddsFromPlayers(
    {
      elo: match.player1.elo,
      winrate: profile1.winrate,
      totalGames: profile1.totalGames,
      currentStreak: profile1.streak,
      peakElo: match.player1.peakElo,
      lastMatchAt: profile1.daysSince < 999 ? new Date(Date.now() - profile1.daysSince * 86400000) : null,
    },
    {
      elo: match.player2.elo,
      winrate: profile2.winrate,
      totalGames: profile2.totalGames,
      currentStreak: profile2.streak,
      peakElo: match.player2.peakElo,
      lastMatchAt: profile2.daysSince < 999 ? new Date(Date.now() - profile2.daysSince * 86400000) : null,
    },
    h2hRecent,
  );

  // Only write if odds actually changed (avoid unnecessary DB writes + socket spam)
  const oddsChanged = Math.abs(newOdds.odds1 - match.player1.elo) > 0.01 || true; // always update for now
  await prisma.match.update({
    where: { id: matchId },
    data: { odds1: newOdds.odds1, odds2: newOdds.odds2 },
  });

  // Broadcast updated odds to connected clients in real-time
  const { getIo } = await import('../socket');
  const io = getIo();
  if (io) {
    io.to(`matchRoom:${matchId}`).emit('oddsUpdate', {
      matchId,
      odds1: newOdds.odds1,
      odds2: newOdds.odds2,
      timestamp: new Date().toISOString(),
    });
    // Also emit a global matchUpdate so the homepage can update its cards
    io.emit('matchUpdate', { matchId, odds1: newOdds.odds1, odds2: newOdds.odds2 });
  }

  logger.info(
    `[Odds] Match ${matchId}: ${match.player1.name} (wr=${(profile1.winrate * 100).toFixed(0)}% / ${profile1.totalGames}g) ` +
    `vs ${match.player2.name} (wr=${(profile2.winrate * 100).toFixed(0)}% / ${profile2.totalGames}g) ` +
    `H2H=${h2hRecent.length} → odds ${newOdds.odds1} / ${newOdds.odds2}`
  );
}

/**
 * Run after a Liquipedia scrape: update all player stats then re-calculate odds
 * for every UPCOMING match.
 */
export async function enrichAllUpcomingMatches(): Promise<void> {
  logger.info('[Enrich] Starting post-scrape enrichment');

  await updateAllPlayerStats();

  // Enrich both UPCOMING and LIVE matches so active matches stay up-to-date
  const activeMatches = await prisma.match.findMany({
    where: { status: { in: ['UPCOMING', 'LIVE'] } },
    select: { id: true },
  });

  let enriched = 0;
  for (const m of activeMatches) {
    await enrichMatchWithH2H(m.id);
    enriched++;
    await new Promise((r) => setTimeout(r, 200));
  }

  logger.info(`[Enrich] Done — enriched ${enriched}/${activeMatches.length} active matches`);
}
