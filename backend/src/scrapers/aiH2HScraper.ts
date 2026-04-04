/**
 * AI H2H Scraper — Uses Claude API to retrieve historical pro match data.
 *
 * When aoe4world has sparse H2H data between two players (< MIN_H2H_THRESHOLD),
 * we ask Claude to recall their tournament match history from its training data.
 * Results are stored in H2HRecord table and used to enrich odds calculations.
 *
 * Format requested: structured JSON to minimize parsing errors.
 * Confidence < 0.6 = skipped (Claude is uncertain).
 */

import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../index';
import logger from '../logger';

const MIN_H2H_THRESHOLD = 5;   // only call AI if aoe4world has fewer than this
const AI_MODEL = 'claude-haiku-4-5-20251001';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

interface AIMatchRecord {
  tournament: string;
  date: string;           // YYYY-MM or YYYY-MM-DD
  winner: string;         // exact player name
  score: string;          // "3-1", "2-0", etc.
  format: string;         // "BO5", "BO3"
  confidence: number;     // 0-1, how sure Claude is about this specific match
  source_url?: string;    // Liquipedia URL if known
}

interface AIH2HResponse {
  player1: string;
  player2: string;
  total_known: number;
  matches: AIMatchRecord[];
  notes?: string;
}

/**
 * Query Claude for historical H2H between two pro players.
 * Returns parsed match records or null on failure.
 */
async function queryClaudeH2H(
  player1Name: string,
  player2Name: string
): Promise<AIH2HResponse | null> {
  const prompt = `You are an AoE4 (Age of Empires 4) esports historian with comprehensive knowledge of competitive matches up to your training cutoff.

List ALL known tournament matches between ${player1Name} and ${player2Name} in professional AoE4 competitions.

Rules:
- Only include matches you are confident actually happened (confidence >= 0.6)
- Include all S-tier and A-tier tournament matches (Wololo, Red Bull, Quarterly Series, WTL, etc.)
- Include qualifier matches if you remember them
- Do NOT invent matches — if you are unsure, set confidence lower
- Dates can be approximate (YYYY-MM is fine)
- Score format: "winner_games-loser_games" e.g. "3-1" for BO5

Respond ONLY with a JSON object in this exact format (no markdown, no explanation):
{
  "player1": "${player1Name}",
  "player2": "${player2Name}",
  "total_known": <number>,
  "matches": [
    {
      "tournament": "tournament name",
      "date": "YYYY-MM",
      "winner": "${player1Name} or ${player2Name}",
      "score": "X-Y",
      "format": "BO3 or BO5",
      "confidence": 0.0-1.0,
      "source_url": "https://liquipedia.net/... or null"
    }
  ],
  "notes": "optional notes about uncertainty"
}`;

  try {
    const response = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    if (!text) return null;

    // Strip any accidental markdown fences
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(clean) as AIH2HResponse;
    return parsed;
  } catch (err) {
    logger.error(`[AI H2H] Claude query failed for ${player1Name} vs ${player2Name}:`, err);
    return null;
  }
}

/**
 * Check if we already have enough AI records for this pair.
 */
async function existingAiRecordCount(player1Id: string, player2Id: string): Promise<number> {
  return prisma.h2HRecord.count({
    where: {
      source: 'ai',
      OR: [
        { player1Id, player2Id },
        { player1Id: player2Id, player2Id: player1Id },
      ],
    },
  });
}

/**
 * Store AI-inferred match records in DB.
 * Skips duplicates (same tournament + date) and low-confidence entries.
 */
async function storeAiRecords(
  player1Id: string,
  player2Id: string,
  player1Name: string,
  player2Name: string,
  records: AIMatchRecord[]
): Promise<number> {
  let stored = 0;

  for (const record of records) {
    if (record.confidence < 0.6) continue;
    if (!record.winner || !record.score) continue;

    const winnerId = record.winner.toLowerCase().includes(player1Name.toLowerCase())
      ? player1Id
      : player2Id;

    // Parse date
    let matchDate: Date | null = null;
    try {
      matchDate = new Date(record.date.length === 7 ? record.date + '-15' : record.date);
      if (isNaN(matchDate.getTime())) matchDate = null;
    } catch { matchDate = null; }

    try {
      await prisma.h2HRecord.upsert({
        where: {
          player1Id_player2Id_tournamentName_matchDate: {
            player1Id,
            player2Id,
            tournamentName: record.tournament ?? '',
            matchDate: matchDate ?? new Date('2020-01-01'),
          },
        },
        create: {
          player1Id,
          player2Id,
          winnerId,
          score: record.score,
          tournamentName: record.tournament,
          matchDate,
          format: record.format,
          source: 'ai',
          sourceUrl: record.source_url ?? null,
          confidence: record.confidence,
        },
        update: {
          confidence: record.confidence,
          score: record.score,
          winnerId,
        },
      });
      stored++;
    } catch (err) {
      // Skip duplicates silently
      logger.debug(`[AI H2H] Skipped duplicate: ${record.tournament} ${record.date}`);
    }
  }

  return stored;
}

/**
 * Main entry — enrich H2H for a specific match if data is sparse.
 * Called from enrichMatchWithH2H when aoe4world returns < MIN_H2H_THRESHOLD games.
 */
export async function enrichH2HWithAI(
  player1Id: string,
  player2Id: string,
  player1Name: string,
  player2Name: string,
  currentH2HCount: number
): Promise<{ player1Wins: number; player2Wins: number; total: number }> {
  const result = { player1Wins: 0, player2Wins: 0, total: 0 };

  if (!process.env.ANTHROPIC_API_KEY) {
    logger.debug('[AI H2H] No ANTHROPIC_API_KEY set, skipping');
    return result;
  }

  if (currentH2HCount >= MIN_H2H_THRESHOLD) return result;

  // Check if we already fetched AI data for this pair
  const existing = await existingAiRecordCount(player1Id, player2Id);
  if (existing > 0) {
    // Already have AI data — just aggregate and return
    return aggregateH2HRecords(player1Id, player2Id);
  }

  logger.info(`[AI H2H] Querying Claude for ${player1Name} vs ${player2Name} (only ${currentH2HCount} games in aoe4world)`);

  const response = await queryClaudeH2H(player1Name, player2Name);
  if (!response || !response.matches?.length) {
    logger.info(`[AI H2H] No data from Claude for ${player1Name} vs ${player2Name}`);
    return result;
  }

  const stored = await storeAiRecords(player1Id, player2Id, player1Name, player2Name, response.matches);
  logger.info(`[AI H2H] Stored ${stored}/${response.matches.length} records for ${player1Name} vs ${player2Name}`);

  return aggregateH2HRecords(player1Id, player2Id);
}

/**
 * Get all H2H records (AI + manual) for a player pair from DB.
 */
export async function getStoredH2HRecords(
  player1Id: string,
  player2Id: string
): Promise<{ winner: 1 | 2; confidence: number }[]> {
  const records = await prisma.h2HRecord.findMany({
    where: {
      OR: [
        { player1Id, player2Id },
        { player1Id: player2Id, player2Id: player1Id },
      ],
    },
    orderBy: { matchDate: 'desc' },
  });

  return records.map(r => ({
    winner: r.winnerId === player1Id ? 1 : 2,
    confidence: r.confidence,
  }));
}

async function aggregateH2HRecords(
  player1Id: string,
  player2Id: string
): Promise<{ player1Wins: number; player2Wins: number; total: number }> {
  const records = await prisma.h2HRecord.findMany({
    where: {
      OR: [
        { player1Id, player2Id },
        { player1Id: player2Id, player2Id: player1Id },
      ],
    },
  });

  const player1Wins = records.filter(r => r.winnerId === player1Id).length;
  const player2Wins = records.filter(r => r.winnerId === player2Id).length;
  return { player1Wins, player2Wins, total: records.length };
}

/**
 * Batch enrichment — run AI H2H for all upcoming matches with sparse data.
 * Adds a 3s delay between Claude calls to avoid rate limits.
 */
export async function enrichAllSparseH2H(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    logger.warn('[AI H2H] ANTHROPIC_API_KEY not set — skipping AI enrichment');
    return;
  }

  const upcomingMatches = await prisma.match.findMany({
    where: { status: 'UPCOMING' },
    include: {
      player1: { select: { id: true, name: true, aoe4worldId: true } },
      player2: { select: { id: true, name: true, aoe4worldId: true } },
    },
  });

  logger.info(`[AI H2H] Checking ${upcomingMatches.length} upcoming matches for sparse H2H`);

  for (const match of upcomingMatches) {
    const existing = await existingAiRecordCount(match.player1Id, match.player2Id);
    if (existing > 0) continue; // already enriched

    await enrichH2HWithAI(
      match.player1Id,
      match.player2Id,
      match.player1.name,
      match.player2.name,
      0
    );

    await new Promise(r => setTimeout(r, 3000)); // 3s between Claude calls
  }

  logger.info('[AI H2H] Batch enrichment complete');
}
