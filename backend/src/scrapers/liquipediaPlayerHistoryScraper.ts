/**
 * Liquipedia Player History Scraper
 *
 * Scrapes the /Matches subpage of a Liquipedia player profile to extract
 * real tournament match results. Stores them as PlayerMatchRecord entries
 * with source='liquipedia' and the correct game field.
 *
 * The /Matches page is rendered by a Lua module ({{Player matches table}})
 * and returns an HTML table with columns:
 *   [0] Date  [1] Tier  [2] Type  [5] Tournament  [6] Player  [8] Score  [10] Opponent
 *
 * Some players have paginated subpages (e.g. /Matches/2024-Present). The
 * scraper follows redirects automatically.
 *
 * Only S-tier and A-tier matches are stored (B/C are noise for odds).
 */

import axios from 'axios';
import { prisma } from '../index';
import logger from '../logger';

const ALLOWED_TIERS = new Set(['S-Tier', 'A-Tier']);

// Map wiki path → game code
const WIKI_TO_GAME: Record<string, string> = {
  ageofempires: 'AoE4',  // default wiki, AoE4 unless overridden
  ageofempires2: 'AoE2',
  ageofempires3: 'AoE3',
  ageofmythology: 'AoM',
};

interface LpMatchRow {
  date: Date;
  tier: string;
  tournament: string;
  playerName: string;
  opponentName: string;
  score: string;       // "3 : 1", "W : L", etc.
  playerWon: boolean;
  playerScore: number;
  opponentScore: number;
}

/**
 * Parse the rendered HTML table from a LP /Matches page into structured rows.
 */
function parseMatchesHtml(html: string): LpMatchRow[] {
  const results: LpMatchRow[] = [];

  // Extract table rows
  const rowRegex = /<tr[^>]*>(.*?)<\/tr>/gs;
  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const cellRegex = /<td[^>]*>(.*?)<\/td>/gs;
    const cells: string[] = [];
    let cell;
    while ((cell = cellRegex.exec(match[1])) !== null) {
      // Strip HTML tags, decode entities
      cells.push(
        cell[1]
          .replace(/<[^>]+>/g, '')
          .replace(/&#160;/g, ' ')
          .replace(/&#58;/g, ':')
          .replace(/&amp;/g, '&')
          .trim()
      );
    }

    if (cells.length < 11) continue;

    const dateStr = cells[0];
    const tier = cells[1];
    const tournament = cells[5];
    const playerName = cells[6];
    const scoreRaw = cells[8];
    const opponentName = cells[10];

    if (!playerName || !opponentName || !scoreRaw) continue;

    // Only S/A tier
    if (!ALLOWED_TIERS.has(tier)) continue;

    // Parse score: "3 : 1" or "W : L" (W=win, L=loss, no numeric)
    const scoreMatch = scoreRaw.match(/(\d+)\s*:\s*(\d+)/);
    let playerScore = 0;
    let opponentScore = 0;
    let playerWon = false;

    if (scoreMatch) {
      playerScore = parseInt(scoreMatch[1], 10);
      opponentScore = parseInt(scoreMatch[2], 10);
      playerWon = playerScore > opponentScore;
    } else if (/W\s*:\s*L/i.test(scoreRaw)) {
      playerWon = true;
      playerScore = 1;
      opponentScore = 0;
    } else if (/L\s*:\s*W/i.test(scoreRaw)) {
      playerWon = false;
      playerScore = 0;
      opponentScore = 1;
    } else {
      continue; // can't parse score
    }

    // Parse date
    const date = new Date(dateStr.replace(/ - .*$/, ''));
    if (isNaN(date.getTime())) continue;

    results.push({
      date,
      tier,
      tournament,
      playerName,
      opponentName,
      score: `${playerScore}-${opponentScore}`,
      playerWon,
      playerScore,
      opponentScore,
    });
  }

  return results;
}

/**
 * Determine the Liquipedia slug for a player from their DB record.
 * Uses the liquipediaSlug field if available, otherwise falls back to the name.
 */
function getPlayerSlug(player: { name: string; liquipediaSlug?: string | null }): string {
  if (player.liquipediaSlug) return player.liquipediaSlug;
  return player.name.replace(/ /g, '_');
}

/**
 * Fetch the /Matches page for a player from Liquipedia.
 * Handles redirects (e.g. /Matches → /Matches/2024-Present).
 * Tries multiple wiki paths if the game is ambiguous.
 */
async function fetchMatchesPage(slug: string, game: string): Promise<{ html: string; wiki: string } | null> {
  // Respect the shared circuit breaker — don't hit LP if we're blocked
  try {
    const { isLpBlocked } = require('../services/liquipediaLiveScorer');
    if (isLpBlocked()) {
      logger.info(`[LPHistory] ${slug}: skipped (circuit breaker active)`);
      return null;
    }
  } catch {}

  const wikiPrimary = 'ageofempires'; // All AoE games live on the main wiki

  const pageName = `${slug}/Matches`;

  try {
    const res = await axios.get(`https://liquipedia.net/${wikiPrimary}/api.php`, {
      params: { action: 'parse', page: pageName, prop: 'text', format: 'json' },
      headers: { 'User-Agent': 'AgeOfMoney/1.0 (contact@ageofmoney.com)' },
      timeout: 20000,
      decompress: true,
    });

    const html = res.data?.parse?.text?.['*'] ?? '';

    // Check for redirect (e.g. Dark/Matches → Dark/Matches/2024-Present)
    const redirectMatch = html.match(/href="\/([^/"]+)\/([^"]+)"/);
    if (redirectMatch && html.includes('redirectText')) {
      const redirectWiki = redirectMatch[1]; // e.g. "ageofempires"
      const redirectPage = decodeURIComponent(redirectMatch[2]); // e.g. "Dark/Matches/2024-Present"
      logger.info(`[LPHistory] ${slug}: redirect → ${redirectWiki}/${redirectPage}`);

      const res2 = await axios.get(`https://liquipedia.net/${redirectWiki}/api.php`, {
        params: { action: 'parse', page: redirectPage, prop: 'text', format: 'json' },
        headers: { 'User-Agent': 'AgeOfMoney/1.0 (contact@ageofmoney.com)' },
        timeout: 20000,
        decompress: true,
      });

      return { html: res2.data?.parse?.text?.['*'] ?? '', wiki: redirectWiki };
    }

    return { html, wiki: wikiPrimary };
  } catch (err: any) {
    if (err?.response?.status === 429) {
      // Respect circuit breaker
      try {
        const { tripCircuitBreaker } = require('../services/liquipediaLiveScorer');
        tripCircuitBreaker();
      } catch {}
    }
    logger.warn(`[LPHistory] Failed to fetch matches page for ${slug}: ${err.message}`);
    return null;
  }
}

/**
 * Scrape a player's tournament match history from Liquipedia and store
 * as PlayerMatchRecord entries. Only S/A tier matches are kept.
 *
 * @param playerId  The DB player ID
 * @param game      The game to tag records with (AoE2, AoE4, etc.)
 * @param force     If true, re-scrape even if records already exist
 * @returns Number of new records stored
 */
export async function scrapePlayerHistoryFromLiquipedia(
  playerId: string,
  game: string = 'AoE4',
  force: boolean = false,
): Promise<number> {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { name: true, liquipediaSlug: true },
  });
  if (!player) return 0;

  // Check if we already have LP records (skip if not forcing)
  if (!force) {
    const existing = await prisma.playerMatchRecord.count({
      where: { playerId, source: 'liquipedia' },
    });
    if (existing >= 10) {
      logger.info(`[LPHistory] ${player.name}: already has ${existing} LP records, skipping (use force=true to rescrape)`);
      return 0;
    }
  }

  const slug = getPlayerSlug(player);
  logger.info(`[LPHistory] Scraping matches for ${player.name} (slug: ${slug}, game: ${game})`);

  const result = await fetchMatchesPage(slug, game);
  if (!result || !result.html) {
    logger.warn(`[LPHistory] ${player.name}: no matches page found`);
    return 0;
  }

  const matches = parseMatchesHtml(result.html);
  logger.info(`[LPHistory] ${player.name}: found ${matches.length} S/A-tier matches on LP`);

  let stored = 0;
  for (const m of matches) {
    try {
      // Determine the BO format from scores
      const totalGames = m.playerScore + m.opponentScore;
      const format = totalGames <= 1 ? 'BO1' :
                     totalGames <= 3 ? 'BO3' :
                     totalGames <= 5 ? 'BO5' :
                     totalGames <= 7 ? 'BO7' : `BO${totalGames * 2 - 1}`;

      // Try to find the opponent in our DB
      const opponent = await prisma.player.findFirst({
        where: {
          OR: [
            { name: { equals: m.opponentName, mode: 'insensitive' } },
            { liquipediaSlug: m.opponentName.replace(/ /g, '_') },
          ],
        },
        select: { id: true },
      });

      await prisma.playerMatchRecord.upsert({
        where: {
          playerId_opponentName_tournamentName_matchDate: {
            playerId,
            opponentName: m.opponentName,
            tournamentName: m.tournament,
            matchDate: m.date,
          },
        },
        create: {
          playerId,
          opponentName: m.opponentName,
          opponentId: opponent?.id ?? null,
          game,
          won: m.playerWon,
          score: m.score,
          tournamentName: m.tournament,
          matchDate: m.date,
          format,
          source: 'liquipedia',
          confidence: 0.95,
        },
        update: {
          game,
          won: m.playerWon,
          score: m.score,
          source: 'liquipedia',
          confidence: 0.95,
          ...(opponent?.id ? { opponentId: opponent.id } : {}),
        },
      });
      stored++;
    } catch (err: any) {
      // Skip duplicates or errors
      if (!err.message?.includes('Unique constraint')) {
        logger.debug(`[LPHistory] ${player.name}: failed to store match vs ${m.opponentName}: ${err.message}`);
      }
    }
  }

  logger.info(`[LPHistory] ${player.name}: stored ${stored}/${matches.length} LP match records (game: ${game})`);
  return stored;
}
