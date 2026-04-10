/**
 * AI Player History Scraper — seeds each pro player's tournament match history
 * using Claude API, storing results in PlayerMatchRecord.
 *
 * Strategy:
 * - One Claude call per player → last 50 tournament matches
 * - Results cached permanently in DB (no re-fetch unless force=true)
 * - Opponent names resolved to Player IDs when possible
 * - H2H between any two players derived from stored records
 *
 * Run once for all pros via enrichAllProPlayers(), then only on new players.
 */

import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../index';
import logger from '../logger';

const AI_MODEL = 'claude-opus-4-6'; // Opus required — Sonnet refuses niche AoE4 esports data, Opus provides it
const MIN_RECORDS_BEFORE_SKIP = 50; // skip player if already has this many total records

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

interface AIPlayerMatch {
  opponent: string;
  tournament: string;
  date: string;           // YYYY-MM or YYYY-MM-DD
  won: boolean;           // true = this player won
  score: string;          // "3-1" from this player's perspective
  format: string;         // "BO3", "BO5"
  confidence: number;     // 0-1
  source_url?: string;
}

interface AIPlayerHistoryResponse {
  player: string;
  total_known: number;
  matches: AIPlayerMatch[];
  notes?: string;
}

/**
 * Query Claude for a player's last 50 tournament matches.
 */
const GAME_FULL_NAMES: Record<string, string> = {
  'AoE4': 'Age of Empires IV',
  'AoE2': 'Age of Empires II: Definitive Edition',
  'AoE3': 'Age of Empires III: Definitive Edition',
  'AoM':  'Age of Mythology: Retold',
  'AoE1': 'Age of Empires I',
};

const GAME_LIQUIPEDIA_WIKI: Record<string, string> = {
  'AoE4': 'liquipedia.net/ageofempires',
  'AoE2': 'liquipedia.net/ageofempires2',
  'AoE3': 'liquipedia.net/ageofempires3',
  'AoM':  'liquipedia.net/ageofmythology',
};

async function queryPlayerHistory(playerName: string, game = 'AoE4'): Promise<AIPlayerHistoryResponse | null> {
  const gameFull = GAME_FULL_NAMES[game] ?? 'Age of Empires IV';
  const wiki = GAME_LIQUIPEDIA_WIKI[game] ?? 'liquipedia.net/ageofempires';
  const prompt = `You are an ${game} esports data specialist. Your task is to retrieve the tournament match history for "${playerName}" in ${gameFull} from your knowledge of Liquipedia (${wiki}), aoe4world.com (if applicable), and official tournament records.

**Important:** "${playerName}" may be:
- An individual ${game} pro player (most common)
- A team competing in WTL (World Team League) — if so, list their individual 1v1 matches within WTL seasons
- A player known by an alias or abbreviated tag — check common variations

Search ALL your knowledge to find up to 50 professional tournament matches for "${playerName}" in ${gameFull}:

**Sources to reference:**
- ${wiki} — primary wiki for all brackets, results, scores
- Official tournament pages for ${gameFull}
- WTL (World Team League) if applicable — team league with individual 1v1 matches per round
- Red Bull Wololo, Quarterly Rumble, Golden League, Wololo Legacy, King of the Desert, Hidden Cup, Nations Cup, Over The Top, Holy Series (for AoE4)
- For AoE2: Red Bull Wololo, T90's Titans League, Brazilian Dynasty, Warlords, Homestead Cup, DauT Cup, etc.
- For AoM: Pandora's Box, AoM community tournaments

**Include ALL match types:**
- WTL/team-league matches (round-robin and playoffs) — VERY IMPORTANT for team-league players
- Group stage, bracket, qualifier matches
- Bo1, Bo3, Bo5, Bo7 — all formats
- ONLY include ${gameFull} matches — ignore other Age of Empires titles

**Score format:** wins-losses from ${playerName}'s perspective.
Example: won 3-1 in BO5 → "score": "3-1", "won": true

**Confidence guide:**
- 0.9-1.0 = exact score and opponent confirmed on Liquipedia
- 0.7-0.8 = match result known, score approximate
- 0.6 = match happened, details uncertain
- Below 0.6 = omit

**Goal: be as thorough as possible.** Even for less-known players, search WTL, regional cups, and qualifier brackets.

Respond with ONLY valid JSON (no markdown, no text outside the JSON):
{
  "player": "${playerName}",
  "total_known": <number>,
  "matches": [
    {
      "opponent": "exact opponent name as on Liquipedia",
      "tournament": "full tournament name",
      "date": "YYYY-MM",
      "won": true,
      "score": "3-1",
      "format": "BO3",
      "confidence": 0.85,
      "source_url": "https://liquipedia.net/ageofempires/... or null"
    }
  ],
  "notes": "brief note on data completeness or player identity"
}

If you have no data after checking all sources, return total_known: 0 with empty matches array.`;

  try {
    const response = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 6000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    if (!text) return null;

    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(clean) as AIPlayerHistoryResponse;
    return parsed;
  } catch (err) {
    logger.error(`[AI History] Claude query failed for ${playerName}:`, err);
    return null;
  }
}

/**
 * Build a name→id lookup map for all players currently in DB.
 * Used to resolve opponent names to IDs when storing.
 */
async function buildPlayerNameMap(): Promise<Map<string, string>> {
  const players = await prisma.player.findMany({ select: { id: true, name: true } });
  const map = new Map<string, string>();
  for (const p of players) {
    map.set(p.name.toLowerCase(), p.id);
    // Also index common aliases (strip clan tags like "GL.", "aM.", "BF.")
    const stripped = p.name.replace(/^[A-Za-z]+\.\s*/, '').toLowerCase();
    if (stripped !== p.name.toLowerCase()) map.set(stripped, p.id);
  }
  return map;
}

/**
 * Try to resolve an opponent name string to a DB player ID.
 * Does fuzzy matching on stripped clan tags.
 */
function resolveOpponentId(opponentName: string, nameMap: Map<string, string>): string | null {
  const lower = opponentName.toLowerCase().trim();

  // Exact match
  if (nameMap.has(lower)) return nameMap.get(lower)!;

  // Strip clan tag prefix (e.g. "GL.TheViper" → "theviper")
  const stripped = lower.replace(/^[a-z]+\.\s*/, '');
  if (nameMap.has(stripped)) return nameMap.get(stripped)!;

  // Partial match — opponent name contains a known player name or vice versa
  for (const [known, id] of nameMap) {
    if (known.length >= 4 && (lower.includes(known) || known.includes(stripped))) {
      return id;
    }
  }

  return null;
}

/**
 * Store AI match records for a player. Returns count of stored records.
 */
async function storePlayerHistory(
  playerId: string,
  playerName: string,
  matches: AIPlayerMatch[],
  nameMap: Map<string, string>,
  game = 'AoE4',
): Promise<number> {
  let stored = 0;

  for (const match of matches) {
    if (match.confidence < 0.6) continue;
    if (!match.opponent || !match.tournament) continue;

    const opponentId = resolveOpponentId(match.opponent, nameMap);

    let matchDate: Date | null = null;
    try {
      const dateStr = match.date.length === 7 ? match.date + '-15' : match.date;
      matchDate = new Date(dateStr);
      if (isNaN(matchDate.getTime())) matchDate = null;
    } catch { matchDate = null; }

    try {
      await prisma.playerMatchRecord.upsert({
        where: {
          playerId_opponentName_tournamentName_matchDate: {
            playerId,
            opponentName: match.opponent,
            tournamentName: match.tournament,
            matchDate: matchDate ?? new Date('2020-01-01'),
          },
        },
        create: {
          playerId,
          opponentName: match.opponent,
          opponentId: opponentId ?? undefined,
          game,
          won: match.won,
          score: match.score ?? null,
          tournamentName: match.tournament,
          matchDate,
          format: match.format ?? null,
          source: 'ai',
          sourceUrl: match.source_url ?? null,
          confidence: match.confidence,
        },
        update: {
          game,
          won: match.won,
          score: match.score ?? null,
          opponentId: opponentId ?? undefined,
          confidence: match.confidence,
        },
      });
      stored++;
    } catch {
      logger.debug(`[AI History] Skipped duplicate: ${playerName} vs ${match.opponent} @ ${match.tournament}`);
    }
  }

  return stored;
}

/**
 * Enrich a single player's tournament history via Claude.
 * Skips if already has >= MIN_RECORDS_BEFORE_SKIP AI records (unless force=true).
 */
// ─── Sentinel-based credit cache ──────────────────────────────────────────
// We use a special PlayerMatchRecord row as a "we already called Claude
// for this (player, game)" marker. This works on the existing schema, no
// new column needed → survives broken migrations.
//
// The sentinel never appears in real H2H queries because they filter on
// real opponentName / tournamentName values that don't match these magic
// strings. confidence=0 also keeps it out of stat calculations.
const SENTINEL_OPPONENT = '__claude_cache__';
const sentinelDate = new Date('1970-01-01T00:00:00Z');
const sentinelTournName = (game: string) => `__claude_attempted_${game}__`;

async function hasClaudeBeenAttempted(playerId: string, game: string): Promise<boolean> {
  try {
    const sentinel = await prisma.playerMatchRecord.findFirst({
      where: {
        playerId,
        opponentName: SENTINEL_OPPONENT,
        tournamentName: sentinelTournName(game),
      },
      select: { id: true },
    });
    return !!sentinel;
  } catch {
    return false;
  }
}

async function markClaudeAttempted(playerId: string, game: string): Promise<void> {
  try {
    await prisma.playerMatchRecord.upsert({
      where: {
        playerId_opponentName_tournamentName_matchDate: {
          playerId,
          opponentName: SENTINEL_OPPONENT,
          tournamentName: sentinelTournName(game),
          matchDate: sentinelDate,
        },
      },
      create: {
        playerId,
        opponentName: SENTINEL_OPPONENT,
        tournamentName: sentinelTournName(game),
        matchDate: sentinelDate,
        won: false,
        confidence: 0,
        source: 'cache',
      },
      update: { confidence: 0 },
    });
  } catch (err) {
    logger.warn(`[AI History] Failed to mark Claude attempt for ${playerId}/${game}: ${(err as Error)?.message}`);
  }
}

async function clearClaudeAttempt(playerId: string, game: string): Promise<void> {
  try {
    await prisma.playerMatchRecord.deleteMany({
      where: {
        playerId,
        opponentName: SENTINEL_OPPONENT,
        tournamentName: sentinelTournName(game),
      },
    });
  } catch { /* no-op */ }
}

export async function enrichPlayerWithAI(
  playerId: string,
  playerName: string,
  force = false,
  game = 'AoE4',
): Promise<number> {
  if (!process.env.ANTHROPIC_API_KEY) return 0;

  // Credit-saving guard: never call Claude twice for the same (player, game).
  // The sentinel is checked first — it's the source of truth for "we tried".
  // When force=true (admin Re-seed), we wipe the sentinel so the call proceeds.
  if (force) {
    await clearClaudeAttempt(playerId, game);
  } else {
    if (await hasClaudeBeenAttempted(playerId, game)) {
      logger.debug(`[AI History] Skipping ${playerName} — Claude already called for ${game}`);
      // Return real record count (excluding the sentinel)
      const realCount = await prisma.playerMatchRecord.count({
        where: { playerId, NOT: { opponentName: SENTINEL_OPPONENT } },
      }).catch(() => 0);
      return realCount;
    }

    // Hard cap: if the player already has >= 50 real records, no need to call Claude.
    const existing = await prisma.playerMatchRecord.count({
      where: { playerId, NOT: { opponentName: SENTINEL_OPPONENT } },
    }).catch(() => 0);
    if (existing >= MIN_RECORDS_BEFORE_SKIP) {
      logger.debug(`[AI History] Skipping ${playerName} — already has ${existing} records`);
      await markClaudeAttempted(playerId, game);
      return existing;
    }
  }

  logger.info(`[AI History] Querying Claude for ${playerName}'s ${game} tournament history…`);
  const response = await queryPlayerHistory(playerName, game);

  // Mark the attempt regardless of result — credit is already spent.
  // This MUST happen before any early return so retries are blocked.
  await markClaudeAttempted(playerId, game);

  if (!response || !response.matches?.length) {
    logger.info(`[AI History] No ${game} data from Claude for ${playerName} (sentinel set, won't retry)`);
    return 0;
  }

  const nameMap = await buildPlayerNameMap();
  const stored = await storePlayerHistory(playerId, playerName, response.matches, nameMap, game);

  // Tag the player's primary game when we get real data back.
  // Wrapped in catch because Player.game column may not exist yet on stale schemas.
  if (stored > 0) {
    await prisma.player.update({ where: { id: playerId }, data: { game } }).catch(() => {});
  }

  logger.info(
    `[AI History] ${playerName}: stored ${stored}/${response.matches.length} matches` +
    (response.notes ? ` (notes: ${response.notes})` : '')
  );

  return stored;
}

/**
 * Batch enrich ALL pro players in DB.
 * Adds 4s delay between Claude calls to stay within rate limits.
 * Set force=true to re-fetch even if records already exist.
 */
export async function enrichAllProPlayers(force = false): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    logger.warn('[AI History] ANTHROPIC_API_KEY not set — skipping');
    return;
  }

  const players = await prisma.player.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  logger.info(`[AI History] Starting batch enrichment for ${players.length} players`);

  let enriched = 0;
  let skipped = 0;

  for (const player of players) {
    try {
      const count = await enrichPlayerWithAI(player.id, player.name, force);
      if (count > 0) enriched++;
      else skipped++;
    } catch (err) {
      logger.error(`[AI History] Failed for ${player.name}:`, err);
    }
    // Respect rate limits — 4s between calls
    await new Promise(r => setTimeout(r, 4000));
  }

  logger.info(`[AI History] Batch complete — enriched: ${enriched}, skipped: ${skipped}`);
}

/**
 * Get H2H records between two players derived from their stored match history.
 * Checks both players' records for matches against each other.
 */
export async function getPlayerH2HFromHistory(
  player1Id: string,
  player2Id: string,
  game?: string,
): Promise<{ winner: 1 | 2; tier: string; matchDate: Date | null; confidence: number }[]> {
  // Get player names for cross-matching
  const [p1, p2] = await Promise.all([
    prisma.player.findUnique({ where: { id: player1Id }, select: { name: true } }),
    prisma.player.findUnique({ where: { id: player2Id }, select: { name: true } }),
  ]);
  if (!p1 || !p2) return [];

  // game column may not exist on stale schemas — skip the filter if it errors
  const gameFilter = game ? { game } : {};
  // Always exclude the sentinel cache rows from H2H lookups
  const notSentinel = { NOT: { opponentName: SENTINEL_OPPONENT } };

  // Records where opponentId is resolved
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

  // Also try name-based matching for unresolved opponents
  const p1Name = p1.name.toLowerCase();
  const p2Name = p2.name.toLowerCase();
  const p1Stripped = p1Name.replace(/^[a-z]+\.\s*/, '');
  const p2Stripped = p2Name.replace(/^[a-z]+\.\s*/, '');

  const byName = await prisma.playerMatchRecord.findMany({
    where: {
      ...gameFilter,
      ...notSentinel,
      opponentId: null, // only unresolved ones
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

  // Merge and deduplicate (by tournament + date)
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
    tier: (r as any).tier ?? 'B',
    matchDate: r.matchDate,
    confidence: r.confidence,
  }));
}

/**
 * Get stats summary for a player's stored match history.
 */
export async function getPlayerHistoryStats(playerId: string): Promise<{
  total: number;
  wins: number;
  losses: number;
  winrate: number;
  aiRecords: number;
}> {
  const records = await prisma.playerMatchRecord.findMany({
    where: { playerId, NOT: { opponentName: SENTINEL_OPPONENT } },
    select: { won: true, source: true },
  });

  const wins = records.filter(r => r.won).length;
  const total = records.length;
  const aiRecords = records.filter(r => r.source === 'ai').length;

  return {
    total,
    wins,
    losses: total - wins,
    winrate: total > 0 ? wins / total : 0.5,
    aiRecords,
  };
}
