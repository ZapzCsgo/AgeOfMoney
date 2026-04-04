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
async function queryPlayerHistory(playerName: string): Promise<AIPlayerHistoryResponse | null> {
  const prompt = `You are an AoE4 esports data specialist. Your task is to retrieve the tournament match history for the player "${playerName}" from your knowledge of Liquipedia (liquipedia.net/ageofempires), aoe4world.com, and official tournament records.

Search your knowledge of these sources to find up to 50 professional tournament matches for "${playerName}" in Age of Empires IV:

**Sources to reference:**
- liquipedia.net/ageofempires — the primary wiki for all AoE4 tournament brackets, results, and scores
- aoe4world.com — tracks custom/tournament games with exact scores
- Official tournament pages: Red Bull Wololo, Quarterly Rumble, WTL, Golden League, Wololo Legacy, King of the Desert, Hidden Cup, Nations Cup

**Include ALL match types:**
- Group stage matches (including round-robin)
- Bracket matches (quarters, semis, finals)
- Qualifier matches
- Bo1, Bo3, Bo5, Bo7 — all formats

**Score format:** wins-losses from ${playerName}'s perspective.
Example: if ${playerName} won 3-1 in a BO5, write "3-1" and "won": true

**Confidence guide:**
- 0.9-1.0 = exact score and opponent confirmed on Liquipedia
- 0.7-0.8 = match result known, score may be approximate
- 0.6 = match happened, details uncertain
- Below 0.6 = omit

**Goal: return as many of the 50 most recent matches as possible.** Be thorough — check your knowledge of all S-tier and A-tier events this player has competed in.

Respond with ONLY valid JSON (no markdown, no text outside the JSON):
{
  "player": "${playerName}",
  "total_known": <number>,
  "matches": [
    {
      "opponent": "exact opponent name as on Liquipedia",
      "tournament": "full tournament name as on Liquipedia",
      "date": "YYYY-MM",
      "won": true,
      "score": "3-1",
      "format": "BO5",
      "confidence": 0.85,
      "source_url": "https://liquipedia.net/ageofempires/... or null"
    }
  ],
  "notes": "brief note on data completeness"
}

If you have no data on this player's AoE4 tournament matches after checking all sources, return total_known: 0 with empty matches array.`;

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
export async function enrichPlayerWithAI(
  playerId: string,
  playerName: string,
  force = false,
): Promise<number> {
  if (!process.env.ANTHROPIC_API_KEY) return 0;

  if (!force) {
    const existing = await prisma.playerMatchRecord.count({
      where: { playerId },
    });
    if (existing >= MIN_RECORDS_BEFORE_SKIP) {
      logger.debug(`[AI History] Skipping ${playerName} — already has ${existing} total records`);
      return existing;
    }
  }

  logger.info(`[AI History] Querying Claude for ${playerName}'s tournament history…`);
  const response = await queryPlayerHistory(playerName);

  if (!response || !response.matches?.length) {
    logger.info(`[AI History] No data from Claude for ${playerName}`);
    return 0;
  }

  const nameMap = await buildPlayerNameMap();
  const stored = await storePlayerHistory(playerId, playerName, response.matches, nameMap);

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
): Promise<{ winner: 1 | 2; confidence: number }[]> {
  // Get player names for cross-matching
  const [p1, p2] = await Promise.all([
    prisma.player.findUnique({ where: { id: player1Id }, select: { name: true } }),
    prisma.player.findUnique({ where: { id: player2Id }, select: { name: true } }),
  ]);
  if (!p1 || !p2) return [];

  // Records where opponentId is resolved
  const byId = await prisma.playerMatchRecord.findMany({
    where: {
      OR: [
        { playerId: player1Id, opponentId: player2Id },
        { playerId: player2Id, opponentId: player1Id },
      ],
    },
    orderBy: { matchDate: 'desc' },
  });

  // Also try name-based matching for unresolved opponents
  const p1Name = p1.name.toLowerCase();
  const p2Name = p2.name.toLowerCase();
  const p1Stripped = p1Name.replace(/^[a-z]+\.\s*/, '');
  const p2Stripped = p2Name.replace(/^[a-z]+\.\s*/, '');

  const byName = await prisma.playerMatchRecord.findMany({
    where: {
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
  });

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
    where: { playerId },
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
