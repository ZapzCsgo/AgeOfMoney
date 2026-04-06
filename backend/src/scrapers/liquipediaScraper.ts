/**
 * Liquipedia scraper — fetches upcoming AoE matches from the public upcoming matches page.
 * Uses real CSS classes confirmed from live HTML inspection.
 * Rate limit: max 1 request per 30 seconds per Liquipedia policy.
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import { prisma } from '../index';
import logger from '../logger';
import { enrichAllUpcomingMatches } from './aoe4worldScraper';

// All AoE game wikis to scrape
const GAME_WIKIS: { game: string; wikiPath: string }[] = [
  { game: 'AoE4', wikiPath: 'ageofempires' },
  { game: 'AoE2', wikiPath: 'ageofempires2' },
  { game: 'AoE3', wikiPath: 'ageofempires3' },
  { game: 'AoM',  wikiPath: 'ageofmythology' },
];

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Scrape a player's Liquipedia page to get their profile photo.
 * Rate-limited — only call if avatarUrl is null.
 */
async function fetchLiquipediaPlayerAvatar(slug: string): Promise<string | null> {
  const html = await fetchHtml(`https://liquipedia.net/ageofempires/${encodeURIComponent(slug)}`);
  if (!html) return null;
  await sleep(1500); // respect rate limit between player page fetches
  const $ = cheerio.load(html);
  // Try common Liquipedia player page image selectors
  const img = (
    $('.infobox-image-image img').first().attr('src') ||
    $('.image-box img').first().attr('src') ||
    $('div.player-info img').first().attr('src') ||
    $('figure.image img').first().attr('src')
  );
  if (!img) return null;
  return img.startsWith('http') ? img : `https://liquipedia.net${img}`;
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await axios.get<string>(url, {
      headers: {
        'User-Agent': 'AgeOfMoney/1.0 (contact@ageofmoney.com)',
        'Accept-Encoding': 'gzip',
        'Accept': 'text/html,application/xhtml+xml',
      },
      decompress: true,
      timeout: 20000,
    });
    return res.data;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      logger.error(`Liquipedia fetch failed: ${err.message} (${err.response?.status})`);
    }
    return null;
  }
}

/** Detect game from tournament name when wiki URL is ambiguous (/ageofempires/ covers all games) */
function detectGame(name: string, wikiGame: string): string {
  const n = name.toLowerCase();
  if (n.includes('age of empires iv') || n.includes('aoe4') || n.includes('age iv') ||
      n.includes('world team league') || n.includes('wtl') || n.includes('quarterly')) return 'AoE4';
  if (n.includes('homestead') || n.includes('epohers') || n.includes('king of the desert') ||
      n.includes('kotd') || n.includes('age of empires ii') || n.includes('aoe ii') ||
      n.includes('elite classic') || n.includes('daut cup') || n.includes('over the top') ||
      n.includes('holy series') || n.includes('golden league')) return 'AoE2';
  if (n.includes('age of mythology') || n.includes('aom') || n.includes('mytholog')) return 'AoM';
  if (n.includes('age of empires iii') || n.includes('aoe3') || n.includes('age iii')) return 'AoE3';
  return wikiGame; // fallback: trust the wiki being scraped
}

function guessTier(name: string): string {
  const n = name.toLowerCase();
  // Tier S — major international events
  if (
    n.includes('world championship') || n.includes('red bull') || n.includes('masters') ||
    n.includes('wololo') || n.includes('hidden cup') || n.includes('nations cup') ||
    n.includes('elite classic') || n.includes('epohers world') ||
    n.includes('warlords') || n.includes('t90') || n.includes('titans league') ||
    n.includes('pandora') || n.includes('brazilian dynasty') ||
    n.includes('homestead') || n.includes('king of the desert') || n.includes('kotd')
  ) return 'S';
  // Tier A — major recurring events
  if (
    n.includes('quarterly') || n.includes('open cup') || n.includes('invitational') ||
    n.includes('world team league') || n.includes('wtl') || n.includes('golden league') ||
    n.includes('over the top') || n.includes('holy series') || n.includes('daut cup') ||
    n.includes('showcase') || n.includes('clash') || n.includes('rumble') ||
    n.includes('over the top') || n.includes('king') || n.includes('super series') ||
    n.includes('championship')
  ) return 'A';
  if (n.includes('road to') || n.includes('league') || n.includes('cup') || n.includes('series')) return 'B';
  return 'C';
}

/** Only scrape matches from top-tier tournaments (S and A) to ensure data quality and avoid match fixing */
function isTierAllowed(tier: string): boolean {
  return tier === 'S' || tier === 'A';
}

/**
 * Scrape a Liquipedia tournament page to find its Twitch channel.
 * Returns the channel slug (e.g. "ageofempires"), not the full URL.
 */
async function fetchTournamentTwitchChannel(liquipediaUrl: string): Promise<string | null> {
  const html = await fetchHtml(liquipediaUrl);
  if (!html) return null;
  await sleep(1500);
  const $ = cheerio.load(html);
  // Twitch links appear as href="https://www.twitch.tv/channelname" in infobox
  let channel: string | null = null;
  $('a[href*="twitch.tv/"]').each((_i, el) => {
    const href = $(el).attr('href') || '';
    const m = href.match(/twitch\.tv\/([a-zA-Z0-9_]+)/);
    if (m && m[1].toLowerCase() !== 'liquipedia') {
      channel = m[1];
      return false; // break
    }
  });
  return channel;
}

/** Parse match-info blocks from a Liquipedia upcoming page */
function parseMatchBlocks(html: string, wikiPath: string, game: string): Array<{
  player1: string; player1Slug: string; player1Country: string;
  player2: string; player2Slug: string; player2Country: string;
  tournamentName: string; tournamentUrl: string;
  scheduledAt: Date; format: string; game: string;
}> {
  const $ = cheerio.load(html);
  const results: ReturnType<typeof parseMatchBlocks> = [];
  const slugPrefix = `/${wikiPath}/`;

  $('.match-info').each((_i, el) => {
    try {
      const timestampStr = $(el).find('.timer-object[data-timestamp]').attr('data-timestamp');
      const scheduledAt = timestampStr
        ? new Date(parseInt(timestampStr, 10) * 1000)
        : new Date(Date.now() + 24 * 3600 * 1000);
      if (scheduledAt < new Date(Date.now() - 4 * 3600 * 1000)) return;

      const leftEl  = $(el).find('.match-info-header-opponent-left');
      const rightEl = $(el).find('.match-info-header-opponent:not(.match-info-header-opponent-left)');
      const leftNameEl  = leftEl.find('.name a').first();
      const rightNameEl = rightEl.find('.name a').first();

      const leftHref  = leftNameEl.attr('href') || '';
      const rightHref = rightNameEl.attr('href') || '';
      if (leftHref.includes('action=edit') || rightHref.includes('action=edit')) return;
      if (leftNameEl.hasClass('new') || rightNameEl.hasClass('new')) return;

      const player1     = leftNameEl.attr('title')?.trim()  || leftNameEl.text().trim();
      const player1Slug = decodeURIComponent(leftHref.replace(slugPrefix, '').split('?')[0]);
      const player2     = rightNameEl.attr('title')?.trim() || rightNameEl.text().trim();
      const player2Slug = decodeURIComponent(rightHref.replace(slugPrefix, '').split('?')[0]);

      if (!player1 || !player2 || player1 === player2) return;
      if (player1.toLowerCase() === 'tbd' || player2.toLowerCase() === 'tbd') return;
      if (leftEl.find('.block-player').length > 1 || rightEl.find('.block-player').length > 1) return;
      const teamPattern = /^team\s+|esports?\s*[ab]?$|\s+esports?$|esports?\s+[ab]$/i;
      if (teamPattern.test(player1) || teamPattern.test(player2)) return;

      const player1Country = leftEl.find('.flag img').first().attr('alt') || '';
      const player2Country = rightEl.find('.flag img').first().attr('alt') || '';

      const tournEl      = $(el).find('.match-info-tournament a').first();
      const tournamentName = tournEl.text().trim() || 'Unknown Tournament';
      const tournPath    = tournEl.attr('href') || '';
      const tournamentUrl = tournPath.startsWith('http') ? tournPath : `https://liquipedia.net${tournPath}`;

      const scoreLower = $(el).find('.match-info-header-scoreholder-lower').first().text().trim();
      const boMatch = scoreLower.match(/Bo(\d+)/i);
      const format = boMatch ? `BO${parseInt(boMatch[1], 10)}` : 'BO3';

      const tier = guessTier(tournamentName);
      if (!isTierAllowed(tier)) return;

      results.push({ player1, player1Slug, player1Country, player2, player2Slug, player2Country, tournamentName, tournamentUrl, scheduledAt, format, game });
    } catch { /* skip bad rows */ }
  });

  return results;
}

export async function scrapeUpcomingMatches(): Promise<void> {
  const startTime = Date.now();
  let matchesFound = 0;
  let matchesSaved = 0;

  try {
    logger.info('[Liquipedia] Starting scrape of upcoming matches (all AoE wikis)');

    // Scrape all AoE wikis — 3s delay between requests to avoid rate limits
    const allMatches: ReturnType<typeof parseMatchBlocks> = [];
    for (const { game, wikiPath } of GAME_WIKIS) {
      const url = `https://liquipedia.net/${wikiPath}/Liquipedia:Upcoming_and_ongoing_matches`;
      const html = await fetchHtml(url);
      if (!html) { logger.warn(`[Liquipedia] Failed to fetch ${game} upcoming page`); continue; }
      const parsed = parseMatchBlocks(html, wikiPath, game);
      logger.info(`[Liquipedia] ${game}: ${parsed.length} tier S/A matches found`);
      allMatches.push(...parsed);
      matchesFound += parsed.length;
      await sleep(3000); // respect Liquipedia rate limit between pages
    }

    logger.info(`[Liquipedia] Total: ${matchesFound} upcoming matches across all wikis`);

    // ── Persist to DB ──────────────────────────────────────────────────────────
    for (const m of allMatches) {
      try {
        const existingTourn = await prisma.tournament.findUnique({
          where: { liquipediaUrl: m.tournamentUrl },
          select: { id: true, twitchChannel: true, game: true },
        });
        let twitchChannel = existingTourn?.twitchChannel ?? null;
        if (!twitchChannel && m.tournamentUrl.includes('liquipedia.net')) {
          twitchChannel = await fetchTournamentTwitchChannel(m.tournamentUrl);
        }

        const correctGame = detectGame(m.tournamentName, m.game);
        const tournament = await prisma.tournament.upsert({
          where: { liquipediaUrl: m.tournamentUrl },
          update: {
            ...(m.tournamentName !== 'Unknown Tournament' ? { name: m.tournamentName } : {}),
            game: correctGame,
            isActive: true,
            ...(twitchChannel ? { twitchChannel } : {}),
          },
          create: {
            name: m.tournamentName,
            game: correctGame,
            tier: guessTier(m.tournamentName),
            liquipediaUrl: m.tournamentUrl,
            startDate: m.scheduledAt,
            isActive: true,
            twitchChannel,
          },
        });

        const p1 = await prisma.player.upsert({
          where: { liquipediaSlug: m.player1Slug },
          update: {},
          create: { name: m.player1, liquipediaSlug: m.player1Slug, country: m.player1Country || null, elo: 1500 },
        });
        const p2 = await prisma.player.upsert({
          where: { liquipediaSlug: m.player2Slug },
          update: {},
          create: { name: m.player2, liquipediaSlug: m.player2Slug, country: m.player2Country || null, elo: 1500 },
        });

        // Skip if a COMPLETED match already exists for these players in this tournament (any time)
        const completedMatch = await prisma.match.findFirst({
          where: {
            OR: [{ player1Id: p1.id, player2Id: p2.id }, { player1Id: p2.id, player2Id: p1.id }],
            tournamentId: tournament.id,
            status: 'COMPLETED',
          },
        });
        if (completedMatch) continue;

        // Skip if an UPCOMING/LIVE match already exists within ±2h window
        const windowStart = new Date(m.scheduledAt.getTime() - 2 * 3600 * 1000);
        const windowEnd   = new Date(m.scheduledAt.getTime() + 2 * 3600 * 1000);
        const existing = await prisma.match.findFirst({
          where: {
            OR: [{ player1Id: p1.id, player2Id: p2.id }, { player1Id: p2.id, player2Id: p1.id }],
            tournamentId: tournament.id,
            scheduledAt: { gte: windowStart, lte: windowEnd },
          },
        });
        if (existing) continue;

        const prob1 = 1 / (1 + Math.pow(10, (p2.elo - p1.elo) / 400));
        const margin = 0.05;
        const odds1 = parseFloat(Math.max(1.05, (1 / prob1) * (1 - margin)).toFixed(2));
        const odds2 = parseFloat(Math.max(1.05, (1 / (1 - prob1)) * (1 - margin)).toFixed(2));

        const tournGame = (tournament as { game?: string }).game ?? m.game;
        await prisma.match.create({
          data: {
            player1Id: p1.id, player2Id: p2.id, tournamentId: tournament.id,
            game: tournGame, status: 'UPCOMING', format: m.format,
            scheduledAt: m.scheduledAt,
            betsClosedAt: new Date(m.scheduledAt.getTime() - 5 * 60 * 1000),
            odds1, odds2,
          },
        });
        matchesSaved++;

        if (process.env.ANTHROPIC_API_KEY) {
          (async () => {
            const { enrichPlayerWithAI } = await import('./aiPlayerHistoryScraper');
            const { enrichAllUpcomingMatches } = await import('./aoe4worldScraper');
            for (const [pid, pname] of [[p1.id, p1.name], [p2.id, p2.name]] as [string, string][]) {
              const count = await prisma.playerMatchRecord.count({ where: { playerId: pid } });
              if (count < 10) {
                await enrichPlayerWithAI(pid, pname, false, tournGame);
                await sleep(3000);
              }
            }
            await enrichAllUpcomingMatches().catch(() => {});
          })().catch(err => logger.warn(`[Liquipedia] AI enrichment failed for new match: ${err}`));
        }

        await sleep(200);
      } catch (err) {
        logger.error(`[Liquipedia] Failed to save match ${m.player1} vs ${m.player2}:`, err);
      }
    }

    await prisma.scraperLog.create({
      data: { source: 'liquipedia', status: 'success', matchesFound, duration: Date.now() - startTime },
    });

    logger.info(`[Liquipedia] Done: ${matchesFound} found, ${matchesSaved} new saved`);

    // ── Fetch Liquipedia avatars for players without one ──────────────────────
    const playersWithoutAvatar = await prisma.player.findMany({
      where: { avatarUrl: null },
      select: { id: true, liquipediaSlug: true },
      take: 10, // process max 10 per scrape cycle to avoid hammering Liquipedia
    });
    for (const player of playersWithoutAvatar) {
      const avatarUrl = await fetchLiquipediaPlayerAvatar(player.liquipediaSlug);
      if (avatarUrl) {
        await prisma.player.update({ where: { id: player.id }, data: { avatarUrl } });
        logger.info(`[Liquipedia] Avatar saved for ${player.liquipediaSlug}`);
      }
    }

    // ── Trigger aoe4world enrichment in background (stats + H2H odds) ────────
    enrichAllUpcomingMatches().catch(err =>
      logger.error('[Liquipedia] Post-scrape enrichment failed:', err)
    );

  } catch (err) {
    logger.error('[Liquipedia] Scrape failed:', err);
    await prisma.scraperLog.create({
      data: {
        source: 'liquipedia',
        status: 'error',
        matchesFound,
        duration: Date.now() - startTime,
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

/**
 * Scrape recent results from the Liquipedia upcoming page.
 *
 * The same page shows matches whose scheduled time is in the past. For finished
 * matches, the score cells contain numeric values (e.g. "2" and "1") instead of
 * a countdown timer. We parse those scores and update our DB accordingly.
 *
 * Winner detection: the side with the highest score is the winner, provided the
 * score is consistent with the BO format (e.g. score of 2 in a BO3 = winner).
 */
export async function scrapeRecentResults(): Promise<void> {
  const resultsToUpdate: Array<{
    p1Slug: string;
    p2Slug: string;
    scheduledAt: Date;
    resultScore: string;
    winnerSlug: string;
  }> = [];

  try {
    logger.info('[Liquipedia] Scanning for recent results...');

    const html = await fetchHtml('https://liquipedia.net/ageofempires/Liquipedia:Upcoming_and_ongoing_matches');
    if (!html) return;

    const $ = cheerio.load(html);
    let updated = 0;

    $('.match-info').each((_i, el) => {
      try {
        // Only process matches whose timestamp is in the past
        const timestampStr = $(el).find('.timer-object[data-timestamp]').attr('data-timestamp');
        if (!timestampStr) return;
        const scheduledAt = new Date(parseInt(timestampStr, 10) * 1000);
        if (scheduledAt > new Date()) return; // still upcoming

        // ── Extract player slugs ───────────────────────────────────────────
        const leftEl  = $(el).find('.match-info-header-opponent-left');
        const rightEl = $(el).find('.match-info-header-opponent:not(.match-info-header-opponent-left)');
        const leftHref  = leftEl.find('.name a').first().attr('href') || '';
        const rightHref = rightEl.find('.name a').first().attr('href') || '';
        if (!leftHref || !rightHref) return;
        const p1Slug = decodeURIComponent(leftHref.replace('/ageofempires/', '').split('?')[0]);
        const p2Slug = decodeURIComponent(rightHref.replace('/ageofempires/', '').split('?')[0]);
        if (!p1Slug || !p2Slug) return;

        // ── Extract score ──────────────────────────────────────────────────
        // The scoreholder-top contains either a countdown timer OR final scores.
        // We look for individual score cells (.score, .cell-scores, or direct text).
        const scoreHolder = $(el).find('.match-info-header-scoreholder-top').first();
        // Try to find two separate score elements
        let leftScore: number | null = null;
        let rightScore: number | null = null;

        // Strategy 1: look for score span elements
        const scoreSpans = scoreHolder.find('.score, [class*="score"]');
        if (scoreSpans.length >= 2) {
          const s1 = parseInt(scoreSpans.eq(0).text().trim(), 10);
          const s2 = parseInt(scoreSpans.eq(1).text().trim(), 10);
          if (!isNaN(s1) && !isNaN(s2)) { leftScore = s1; rightScore = s2; }
        }

        // Strategy 2: fall back to raw text parsing — look for "N : N" or "N - N"
        if (leftScore === null) {
          const rawText = scoreHolder.text().replace(/\s+/g, ' ').trim();
          // Remove countdown text (contains letters like "d", "h", "m")
          if (!/[a-zA-Z]/.test(rawText)) {
            const nums = rawText.match(/\d+/g);
            if (nums && nums.length === 2) {
              leftScore = parseInt(nums[0], 10);
              rightScore = parseInt(nums[1], 10);
            }
          }
        }

        if (leftScore === null || rightScore === null) return;
        if (leftScore === 0 && rightScore === 0) return; // no games played yet

        // ── Determine winner from BO format ───────────────────────────────
        const scoreLower = $(el).find('.match-info-header-scoreholder-lower').first().text().trim();
        const boMatch = scoreLower.match(/Bo(\d+)/i);
        const boTotal = boMatch ? parseInt(boMatch[1], 10) : 3;
        const winsNeeded = Math.ceil(boTotal / 2);

        const p1Won = leftScore >= winsNeeded;
        const p2Won = rightScore >= winsNeeded;
        if (!p1Won && !p2Won) return; // match ongoing (not final yet)

        // ── Update our DB async (can't await in .each, schedule via promise) ─
        const resultScore = `${leftScore}-${rightScore}`;
        const winnerSlug = p1Won ? p1Slug : p2Slug;
        resultsToUpdate.push({ p1Slug, p2Slug, scheduledAt, resultScore, winnerSlug });
      } catch { /* skip bad rows */ }
    });

    // Process accumulated results
    for (const result of resultsToUpdate) {
      try {
        const p1 = await prisma.player.findUnique({ where: { liquipediaSlug: result.p1Slug }, select: { id: true } });
        const p2 = await prisma.player.findUnique({ where: { liquipediaSlug: result.p2Slug }, select: { id: true } });
        if (!p1 || !p2) continue;

        const windowStart = new Date(result.scheduledAt.getTime() - 3 * 3600 * 1000);
        const windowEnd   = new Date(result.scheduledAt.getTime() + 3 * 3600 * 1000);

        const match = await prisma.match.findFirst({
          where: {
            OR: [
              { player1Id: p1.id, player2Id: p2.id },
              { player1Id: p2.id, player2Id: p1.id },
            ],
            scheduledAt: { gte: windowStart, lte: windowEnd },
            status: { in: ['UPCOMING', 'LIVE'] },
          },
          select: { id: true, player1Id: true, player2Id: true },
        });

        if (!match) continue;

        const winnerId = result.winnerSlug === result.p1Slug ? match.player1Id : match.player2Id;

        await prisma.match.update({
          where: { id: match.id },
          data: { status: 'COMPLETED', winnerId, resultScore: result.resultScore, betsOpen: false },
        });

        // Distribute payouts (15min delay handled in distributePayouts cron)
        logger.info(`[Liquipedia] Match ${match.id} completed: ${result.resultScore} — winner: ${result.winnerSlug}`);
        updated++;
      } catch (err) {
        logger.error('[Liquipedia] Failed to update result:', err);
      }
    }

    if (updated > 0) {
      logger.info(`[Liquipedia] Updated ${updated} match result(s) from recent results`);
    }
  } catch (err) {
    logger.error('[Liquipedia] scrapeRecentResults failed:', err);
  }
}

