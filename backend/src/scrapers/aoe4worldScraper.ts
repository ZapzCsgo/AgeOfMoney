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

async function fetchApi<T>(path: string, opts: { timeoutMs?: number; retries?: number } = {}): Promise<T | null> {
  const timeoutMs = opts.timeoutMs ?? 15000;
  const maxRetries = opts.retries ?? 1;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await axios.get<T>(`${AOE4WORLD_BASE}${path}`, {
        headers: {
          'User-Agent': 'AoE4Bet/1.0 (educational; contact@aoe4bet.com)',
          Accept: 'application/json',
        },
        timeout: timeoutMs,
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
        // Timeout or network error → retry once with a quick delay
        if ((err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET') && attempt < maxRetries) {
          logger.warn(`aoe4world ${path} attempt ${attempt + 1} failed (${err.code}), retrying in 2s`);
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
      }
      logger.error(`aoe4world API error for ${path} (attempt ${attempt + 1}/${maxRetries + 1}): ${(err as Error)?.message ?? err}`);
      return null;
    }
  }
  return null;
}

export async function getPlayerStats(aoe4worldId: string): Promise<Aoe4WorldPlayer | null> {
  return fetchApi<Aoe4WorldPlayer>(`/players/${aoe4worldId}`);
}

export async function getH2H(
  player1Id: string,
  player2Id: string
): Promise<{ games: H2HGame[]; player1Wins: number; player2Wins: number; total: number } | null> {
  // leaderboard=rm_custom → only custom/tournament games (not ranked ladder)
  const data = await fetchApi<{ games: H2HGame[] }>(
    `/players/${player1Id}/games?opponent_profile_id=${player2Id}&leaderboard=rm_custom&limit=50`
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
    // Big payload — server response can be slow, give it 30s and one retry
    const data = await fetchApi<{ tournaments: TournamentListItem[] }>('/tournaments?limit=200', { timeoutMs: 30000, retries: 2 });
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

export type UpdatePlayerResult =
  | { success: true }
  | { success: false; reason: 'player_not_found' | 'profile_unresolvable' | 'stats_api_failed' | 'db_update_failed' | 'no_data'; detail: string };

export async function updatePlayerFromAoe4World(
  playerId: string,
  knownProIds?: Set<string>
): Promise<UpdatePlayerResult> {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { id: true, name: true, liquipediaSlug: true, aoe4worldId: true, totalGames: true },
  });

  if (!player) return { success: false, reason: 'player_not_found', detail: `playerId=${playerId} not in DB` };

  let aoe4worldId = player.aoe4worldId;

  // If no ID yet, try to find it with multiple strategies
  if (!aoe4worldId) {
    aoe4worldId = await resolveAoe4WorldId({ name: player.name, liquipediaSlug: player.liquipediaSlug });
    if (!aoe4worldId) {
      logger.debug(`[aoe4world] Could not find profile for: ${player.name}`);
      return { success: false, reason: 'profile_unresolvable', detail: `no aoe4world profile match for slug=${player.liquipediaSlug}` };
    }
  }

  const stats = await getPlayerStats(aoe4worldId);
  if (!stats) return { success: false, reason: 'stats_api_failed', detail: `getPlayerStats(${aoe4worldId}) returned null — check aoe4world API health` };

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

  // Winrate from pro-vs-pro custom games (rm_custom, not ranked) — purely tournament context
  if (proRecord && proRecord.totalGames >= 3) {
    updateData.winrate = proRecord.winrate;
    updateData.totalGames = proRecord.totalGames;
    logger.info(`[aoe4world] ${player.name}: tournament pro record ${(proRecord.winrate * 100).toFixed(1)}% over ${proRecord.totalGames}g`);
  } else {
    logger.debug(`[aoe4world] ${player.name}: insufficient tournament pro matchup data (<3 games vs known pros)`);
  }

  // Store avatar/lastMatch from aoe4world for display — ELO intentionally not used in odds
  const bestMode = getBestMode(stats.modes);
  if (bestMode?.last_game_at) updateData.lastMatchAt = new Date(bestMode.last_game_at);
  // Do NOT store ranked elo/peakElo — ranked performance is irrelevant for tournament odds

  // Retry the update once on Postgres `statement_timeout` (Supabase pooler
  // kills any single statement that exceeds 8s by default). One retry after
  // a 250 ms wait clears almost every transient lock; repeated 57014 means
  // real contention or pool saturation, in which case we give up cleanly.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await prisma.player.update({
        where: { id: playerId },
        data: updateData,
      });
      break;
    } catch (err: unknown) {
      // Prisma errors come in several shapes — pull whatever we can from each.
      const errObj = err as {
        code?: string;
        message?: string;
        name?: string;
        meta?: { code?: string; message?: string };
      } | null;
      const code = errObj?.code ?? errObj?.meta?.code ?? '';
      const rawMsg = errObj?.message ?? errObj?.meta?.message ?? '';
      const name = errObj?.name ?? '';
      const ctorName = err instanceof Error ? err.constructor.name : typeof err;
      const fallback = !rawMsg && !code ? `(empty error, ctor=${ctorName}, name=${name || '?'})` : '';
      const msgFirstLine = (rawMsg || fallback).split('\n')[0];
      const isTimeout = code === '57014' || /statement timeout/i.test(rawMsg);
      if (!isTimeout || attempt === 2) {
        logger.warn(
          `[aoe4world] player.update failed for ${player.name} ` +
          `(code=${code || 'none'}, ctor=${ctorName}): ${msgFirstLine}`,
        );
        return { success: false, reason: 'db_update_failed', detail: `${ctorName}/${code || 'no-code'}: ${msgFirstLine}` };
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  return { success: true };
}

export async function updateAllPlayerStats(): Promise<void> {
  const startTime = Date.now();
  let updated = 0;
  let errors = 0;
  // Categorize per-player failures so a 100-% failure batch is actionable
  // instead of a silent "0 updated, 50 errors" line. Bug #2 prod 2026-05-02 :
  // every batch was failing with no detail because the per-player paths
  // returned `false` silently in resolveAoe4WorldId/getPlayerStats null cases.
  const failureBuckets: Record<string, number> = {};
  const failureExamples: Record<string, string> = {};
  const bumpFailure = (kind: string, example: string) => {
    failureBuckets[kind] = (failureBuckets[kind] ?? 0) + 1;
    if (!failureExamples[kind]) failureExamples[kind] = example;
  };

  try {
    // Filter to AoE4 players only — aoe4world.com only has AoE4 profiles, so
    // looking up an AoE2 / AoE3 / AoM player there always returns null and
    // pollutes the batch with `profile_unresolvable` failures (root cause of
    // the 100 % failure rate observed 2026-05-02 prelaunch). Of 535 players
    // ~250+ are non-AoE4 and were dragging every batch's lastUpdatedAt-asc
    // ordering to the top.
    const players = await prisma.player.findMany({
      where: { game: 'AoE4' },
      select: { id: true, name: true },
      orderBy: { lastUpdatedAt: 'asc' },
      take: 50,
    });

    // Build comprehensive pro player set from aoe4world tournament API + our DB
    const knownProIds = await buildProPlayerSet();

    logger.info(`Updating stats for ${players.length} players from aoe4world (${knownProIds.size} known pro IDs)`);

    // Per-player try/catch so one slow update can't abort the whole batch.
    // Before this, a single statement_timeout (57014) on player N killed
    // enrichment for players N+1..50 in the same cycle.
    for (const player of players) {
      try {
        const result = await updatePlayerFromAoe4World(player.id, new Set(knownProIds));
        // updatePlayerFromAoe4World now returns a discriminated result so
        // we can attribute failures to the right cause.
        if (result.success) {
          updated++;
        } else {
          errors++;
          bumpFailure(result.reason, `${player.name}: ${result.detail}`);
        }
      } catch (err) {
        errors++;
        const msg = err instanceof Error ? err.message : String(err);
        bumpFailure('exception', `${player.name}: ${msg.split('\n')[0]}`);
        logger.warn(`[aoe4world] Skipping ${player.name} after exception: ${msg.split('\n')[0]}`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    // Detailed breakdown — replaces the silent "N errors" line.
    const breakdownStrs = Object.entries(failureBuckets)
      .sort((a, b) => b[1] - a[1])
      .map(([kind, n]) => `${kind}=${n}`);
    const successRate = players.length > 0 ? updated / players.length : 1;

    await prisma.scraperLog.create({
      data: {
        source: 'aoe4world',
        status: errors === 0 ? 'success' : 'partial',
        matchesFound: updated,
        duration: Date.now() - startTime,
        error: errors > 0 ? `${errors} failed (${breakdownStrs.join(', ')})` : undefined,
      },
    });

    logger.info(`Player stats update complete: ${updated} updated, ${errors} errors${errors > 0 ? ` [${breakdownStrs.join(', ')}]` : ''}`);

    // Per-bucket sample so the operator sees one example reason per category.
    for (const [kind, example] of Object.entries(failureExamples)) {
      logger.warn(`[aoe4world] Failure example (${kind}): ${example}`);
    }

    // Bug #2 alert : if more than half the batch failed, escalate the log
    // level so it shows up in monitoring dashboards. Two consecutive
    // sub-50 % batches almost certainly means a systemic issue (API down,
    // schema drift, rate limit, expired key) — not noise.
    if (players.length >= 5 && successRate < 0.5) {
      logger.error(
        `[aoe4world] ALERT — batch success rate ${(successRate * 100).toFixed(0)}% (${updated}/${players.length}). ` +
        `Top failure modes: ${breakdownStrs.slice(0, 3).join(', ')}. ` +
        `Investigate aoe4world API health, env vars, or rate limits.`,
      );
    }
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

  // ── 3. Ensure both players have history seeded ─────────────────────────────
  // For AoE4 matches: seed from aoe4world (only AoE4 data exists there).
  // For non-AoE4 matches (AoE2/AoM/AoE3): fall back to Liquipedia — the
  // Claude-AI supplement was removed on 2026-04-19.
  // Count uses a defensive try/catch — `game` column may not exist on stale schemas.
  {
    const safeCount = async (playerId: string): Promise<number> => {
      try {
        return await prisma.playerMatchRecord.count({
          where: { playerId, game: match.game, NOT: { opponentName: '__claude_cache__' } },
        });
      } catch {
        return await prisma.playerMatchRecord.count({
          where: { playerId, NOT: { opponentName: '__claude_cache__' } },
        }).catch(() => 0);
      }
    };
    const [p1Count, p2Count] = await Promise.all([
      safeCount(match.player1Id),
      safeCount(match.player2Id),
    ]);

    // Auto-seed new players via Liquipedia direct scraper (all games)
    // Sequential, respects circuit breaker — LP is the primary source.
    {
      const { scrapePlayerHistoryFromLiquipedia } = await import('./liquipediaPlayerHistoryScraper');
      if (p1Count === 0) {
        logger.info(`[Enrich] New player ${match.player1.name} — seeding from Liquipedia`);
        await scrapePlayerHistoryFromLiquipedia(match.player1Id, match.game).catch(() => {});
        await new Promise(r => setTimeout(r, 3000)); // 3s delay before next LP request
      }
      if (p2Count === 0) {
        logger.info(`[Enrich] New player ${match.player2.name} — seeding from Liquipedia`);
        await scrapePlayerHistoryFromLiquipedia(match.player2Id, match.game).catch(() => {});
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }

  // ── 4. H2H history (tournament-only, ranked ignored) ────────────────────
  let h2hRecent: { winner: 1 | 2 }[] = [];

  // Priority 1: PMR tournament match records (scraped via Liquipedia — was
  // previously named "AI H2H" but the backing scraper is gone; reads come
  // straight from PlayerMatchRecord now).
  {
    const { getPlayerH2HFromHistory } = await import('../services/h2hHistory');
    const pmrH2H = await getPlayerH2HFromHistory(match.player1Id, match.player2Id, match.game);
    if (pmrH2H.length > 0) {
      h2hRecent = pmrH2H.slice(0, 20).map(r => ({ winner: r.winner }));
      logger.debug(`[Odds] H2H from PMR tournament records: ${pmrH2H.length} games for ${match.player1.name} vs ${match.player2.name}`);
    }
  }

  // Priority 2: platform match results (AgeOfMoney completed matches, same game only)
  if (h2hRecent.length < 20) {
    const dbH2H = await prisma.match.findMany({
      where: {
        status: 'COMPLETED',
        winnerId: { not: null },
        game: match.game,
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
    const needed = Math.max(0, 20 - h2hRecent.length);
    const dbMapped = dbH2H.slice(0, needed).map((m) => ({
      winner: m.winnerId === match.player1Id ? (1 as const) : (2 as const),
    }));
    h2hRecent = [...h2hRecent, ...dbMapped];
  }

  // Priority 3: aoe4world custom/tournament games only (rm_custom, not ranked)
  if (h2hRecent.length < 20 && match.player1.aoe4worldId && match.player2.aoe4worldId) {
    const h2h = await getH2H(match.player1.aoe4worldId, match.player2.aoe4worldId);
    if (h2h && h2h.games.length > 0) {
      const needed = Math.max(0, 20 - h2hRecent.length);
      const aoe4Mapped = h2h.games.slice(0, needed).map((g) => {
        const p1Win = g.teams.some((team) =>
          team.some((entry) => String(entry.player.profile_id) === match.player1.aoe4worldId && entry.player.result === 'win')
        );
        return { winner: p1Win ? (1 as const) : (2 as const) };
      });
      h2hRecent = [...h2hRecent, ...aoe4Mapped];
    }
  }

  // ── 5. Calculate odds via V2 engine ────────────────────────────────────────
  // Uses the same full-record + format path as the 10-min fast recalc in
  // cron/jobs.ts — MUST pass `format` so BO2/BO4 get a 3-way market with
  // correctly calibrated `oddsDraw`. The legacy `calculateOddsFromPlayers`
  // silently dropped `format`, leaving `oddsDraw` stale in DB while
  // overwriting `odds1/odds2` with 2-way-margin numbers → arbitrage.
  const { calculateOddsV2 } = await import('../services/oddsEngine');
  const SENTINEL_OPPONENT = '__AI_ENRICHED__';
  const [p1Records, p2Records, tournament] = await Promise.all([
    prisma.playerMatchRecord.findMany({
      where: { playerId: match.player1Id, game: match.game, NOT: { opponentName: SENTINEL_OPPONENT } },
      select: { won: true, tier: true, matchDate: true, opponentId: true, score: true },
    }),
    prisma.playerMatchRecord.findMany({
      where: { playerId: match.player2Id, game: match.game, NOT: { opponentName: SENTINEL_OPPONENT } },
      select: { won: true, tier: true, matchDate: true, opponentId: true, score: true },
    }),
    match.tournamentId
      ? prisma.tournament.findUnique({ where: { id: match.tournamentId }, select: { tier: true } })
      : Promise.resolve(null),
  ]);

  // H2H for V2 needs tier/matchDate/confidence — the PMR-backed lookup above
  // already returns these, so call it again to get the full shape. Cheap: it
  // reads from PlayerMatchRecord without API calls.
  const { getPlayerH2HFromHistory } = await import('../services/h2hHistory');
  const h2hFull = await getPlayerH2HFromHistory(match.player1Id, match.player2Id, match.game);

  // Opponent-winrate map — weights wins by opponent strength. Farming weak
  // opponents in weekly tournaments no longer inflates WR vs the real field.
  const opponentIds = new Set<string>();
  for (const r of [...p1Records, ...p2Records]) if (r.opponentId) opponentIds.add(r.opponentId);
  const oppWinrateMap = new Map<string, number>();
  if (opponentIds.size > 0) {
    const oppRecords = await prisma.playerMatchRecord.findMany({
      where: { playerId: { in: [...opponentIds] }, game: match.game },
      select: { playerId: true, won: true },
    });
    const grouped = new Map<string, { total: number; wins: number }>();
    for (const r of oppRecords) {
      const g = grouped.get(r.playerId) ?? { total: 0, wins: 0 };
      g.total++;
      if (r.won) g.wins++;
      grouped.set(r.playerId, g);
    }
    for (const [id, s] of grouped.entries()) {
      if (s.total >= 3) oppWinrateMap.set(id, s.wins / s.total);
    }
  }

  // Phase 2 : fetch Glicko ratings si V2 flag ON
  let glicko1: { rating: number; rd: number } | undefined;
  let glicko2: { rating: number; rd: number } | undefined;
  if (process.env.ODDS_ENGINE_V2_ENABLED === 'true') {
    const glickoRows = await prisma.$queryRawUnsafe<Array<{
      playerid: string; rating: number; rd: number;
    }>>(
      `SELECT "playerId" AS playerid, rating, rd FROM "PlayerRating" WHERE "playerId" IN ($1, $2)`,
      match.player1.id, match.player2.id,
    ).catch(() => [] as Array<{ playerid: string; rating: number; rd: number }>);
    for (const r of glickoRows) {
      const entry = { rating: Number(r.rating), rd: Number(r.rd) };
      if (r.playerid === match.player1.id) glicko1 = entry;
      else if (r.playerid === match.player2.id) glicko2 = entry;
    }
  }

  const newOdds = calculateOddsV2({
    p1Records: p1Records.map(r => ({ won: r.won, tier: r.tier ?? 'B', matchDate: r.matchDate, opponentId: r.opponentId, score: r.score })),
    p2Records: p2Records.map(r => ({ won: r.won, tier: r.tier ?? 'B', matchDate: r.matchDate, opponentId: r.opponentId, score: r.score })),
    h2h: h2hFull,
    daysSinceLastMatch1: profile1.daysSince,
    daysSinceLastMatch2: profile2.daysSince,
    matchTier: tournament?.tier ?? undefined,
    format: match.format,
    opponentWinrates: oppWinrateMap,
    glickoRating1: glicko1?.rating,
    glickoRd1: glicko1?.rd,
    glickoRating2: glicko2?.rating,
    glickoRd2: glicko2?.rd,
  });

  // Update odds in DB — always write oddsDraw (null for BO1/BO3/BO5/BO7,
  // number for BO2/BO4) so it never ends up stale from a previous format.
  await prisma.match.update({
    where: { id: matchId },
    data: { odds1: newOdds.odds1, odds2: newOdds.odds2, oddsDraw: newOdds.oddsDraw ?? null },
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
