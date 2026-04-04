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

const BASE_URL = 'https://liquipedia.net/ageofempires';
const UPCOMING_URL = `${BASE_URL}/Liquipedia:Upcoming_and_ongoing_matches`;

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

function guessTier(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('world championship') || n.includes('red bull') || n.includes('masters') || n.includes('wololo')) return 'S';
  if (
    n.includes('quarterly') || n.includes('open cup') || n.includes('invitational') ||
    n.includes('world team league') || n.includes('wtl') || n.includes('golden league') ||
    n.includes('king of the desert') || n.includes('over the top') || n.includes('holy series')
  ) return 'A';
  if (n.includes('road to') || n.includes('league') || n.includes('cup')) return 'B';
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

export async function scrapeUpcomingMatches(): Promise<void> {
  const startTime = Date.now();
  let matchesFound = 0;
  let matchesSaved = 0;

  try {
    logger.info('[Liquipedia] Starting scrape of upcoming matches');

    const html = await fetchHtml(UPCOMING_URL);
    if (!html) throw new Error('Failed to fetch Liquipedia upcoming matches page');

    const $ = cheerio.load(html);
    const matches: Array<{
      player1: string;
      player1Slug: string;
      player1Country: string;
      player2: string;
      player2Slug: string;
      player2Country: string;
      tournamentName: string;
      tournamentUrl: string;
      scheduledAt: Date;
      format: string;
    }> = [];

    // Each match is a .new-match-style > .match-info block
    $('.match-info').each((_i, el) => {
      try {
        // Timestamp
        const timestampStr = $(el).find('.timer-object[data-timestamp]').attr('data-timestamp');
        const scheduledAt = timestampStr
          ? new Date(parseInt(timestampStr, 10) * 1000)
          : new Date(Date.now() + 24 * 3600 * 1000);

        // Skip past matches (more than 4 hours ago)
        if (scheduledAt < new Date(Date.now() - 4 * 3600 * 1000)) return;

        // Players — left and right opponents
        const leftEl = $(el).find('.match-info-header-opponent-left');
        const rightEl = $(el).find('.match-info-header-opponent:not(.match-info-header-opponent-left)');

        const leftNameEl  = leftEl.find('.name a').first();
        const rightNameEl = rightEl.find('.name a').first();

        // Use href title attr — skip redlinks (page does not exist)
        const leftHref  = leftNameEl.attr('href') || '';
        const rightHref = rightNameEl.attr('href') || '';
        if (leftHref.includes('action=edit') || rightHref.includes('action=edit')) return; // TBD/unknown team
        if (leftNameEl.hasClass('new') || rightNameEl.hasClass('new')) return;

        const player1     = leftNameEl.attr('title')?.trim()  || leftNameEl.text().trim();
        const player1Slug = leftHref.replace('/ageofempires/', '').split('?')[0];
        const player2     = rightNameEl.attr('title')?.trim() || rightNameEl.text().trim();
        const player2Slug = rightHref.replace('/ageofempires/', '').split('?')[0];

        if (!player1 || !player2 || player1 === player2) return;
        if (player1.toLowerCase() === 'tbd' || player2.toLowerCase() === 'tbd') return;
        // Skip team matches (multiple players on a side) — we only do 1v1
        if (leftEl.find('.block-player').length > 1 || rightEl.find('.block-player').length > 1) return;

        // Countries
        const player1Country = leftEl.find('.flag img').first().attr('alt') || '';
        const player2Country = rightEl.find('.flag img').first().attr('alt') || '';

        // Tournament
        const tournEl      = $(el).find('.match-info-tournament a').first();
        const tournamentName = tournEl.text().trim() || 'Unknown Tournament';
        const tournPath    = tournEl.attr('href') || '';
        const tournamentUrl = tournPath.startsWith('http') ? tournPath : `https://liquipedia.net${tournPath}`;

        // Format — the real BO number is in .match-info-header-scoreholder-lower as "(Bo7)"
        const scoreLower = $(el).find('.match-info-header-scoreholder-lower').first().text().trim();
        const boMatch = scoreLower.match(/Bo(\d+)/i);
        const boNum = boMatch ? parseInt(boMatch[1], 10) : null;
        const format = boNum ? `BO${boNum}` : 'BO3';  // exact value, not guessed

        // Only include matches from top-tier tournaments
        const tier = guessTier(tournamentName);
        if (!isTierAllowed(tier)) {
          logger.debug(`[Liquipedia] Skipping low-tier match: ${player1} vs ${player2} (${tournamentName} — tier ${tier})`);
          return;
        }

        matchesFound++;
        matches.push({ player1, player1Slug, player1Country, player2, player2Slug, player2Country, tournamentName, tournamentUrl, scheduledAt, format });
      } catch {
        // skip bad rows
      }
    });

    logger.info(`[Liquipedia] Parsed ${matchesFound} upcoming matches`);

    // ── Persist to DB ──────────────────────────────────────────────────────────
    for (const m of matches) {
      try {
        // Upsert tournament — fetch Twitch channel if we don't have it yet
        const existingTourn = await prisma.tournament.findUnique({
          where: { liquipediaUrl: m.tournamentUrl },
          select: { id: true, twitchChannel: true },
        });
        let twitchChannel = existingTourn?.twitchChannel ?? null;
        if (!twitchChannel && m.tournamentUrl.includes('liquipedia.net')) {
          twitchChannel = await fetchTournamentTwitchChannel(m.tournamentUrl);
        }

        const tournament = await prisma.tournament.upsert({
          where: { liquipediaUrl: m.tournamentUrl },
          // Only update name if we got a real name (don't overwrite good names with 'Unknown Tournament')
          update: {
            ...(m.tournamentName !== 'Unknown Tournament' ? { name: m.tournamentName } : {}),
            isActive: true,
            ...(twitchChannel ? { twitchChannel } : {}),
          },
          create: {
            name: m.tournamentName,
            tier: guessTier(m.tournamentName),
            liquipediaUrl: m.tournamentUrl,
            startDate: m.scheduledAt,
            isActive: true,
            twitchChannel,
          },
        });

        // Upsert player 1
        const p1 = await prisma.player.upsert({
          where: { liquipediaSlug: decodeURIComponent(m.player1Slug) },
          update: {},
          create: {
            name: m.player1,
            liquipediaSlug: decodeURIComponent(m.player1Slug),
            country: m.player1Country || null,
            elo: 1500,
          },
        });

        // Upsert player 2
        const p2 = await prisma.player.upsert({
          where: { liquipediaSlug: decodeURIComponent(m.player2Slug) },
          update: {},
          create: {
            name: m.player2,
            liquipediaSlug: decodeURIComponent(m.player2Slug),
            country: m.player2Country || null,
            elo: 1500,
          },
        });

        // Check if match already exists (same players in either order, same tournament, scheduled within 2h window)
        const windowStart = new Date(m.scheduledAt.getTime() - 2 * 3600 * 1000);
        const windowEnd   = new Date(m.scheduledAt.getTime() + 2 * 3600 * 1000);
        const existing = await prisma.match.findFirst({
          where: {
            OR: [
              { player1Id: p1.id, player2Id: p2.id },
              { player1Id: p2.id, player2Id: p1.id },
            ],
            tournamentId: tournament.id,
            scheduledAt: { gte: windowStart, lte: windowEnd },
          },
        });

        if (existing) continue;

        // Compute basic odds from ELO
        const prob1 = 1 / (1 + Math.pow(10, (p2.elo - p1.elo) / 400));
        const margin = 0.05;
        const odds1 = parseFloat(Math.max(1.05, (1 / prob1) * (1 - margin)).toFixed(2));
        const odds2 = parseFloat(Math.max(1.05, (1 / (1 - prob1)) * (1 - margin)).toFixed(2));

        const betsClosedAt = new Date(m.scheduledAt.getTime() - 5 * 60 * 1000);

        await prisma.match.create({
          data: {
            player1Id: p1.id,
            player2Id: p2.id,
            tournamentId: tournament.id,
            status: 'UPCOMING',
            format: m.format,
            scheduledAt: m.scheduledAt,
            betsClosedAt,
            odds1,
            odds2,
          },
        });

        matchesSaved++;

        // Rate limit — be nice to Liquipedia's DB
        await sleep(200);
      } catch (err) {
        logger.error(`[Liquipedia] Failed to save match ${m.player1} vs ${m.player2}:`, err);
      }
    }

    await prisma.scraperLog.create({
      data: {
        source: 'liquipedia',
        status: 'success',
        matchesFound,
        duration: Date.now() - startTime,
      },
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

    const html = await fetchHtml(UPCOMING_URL);
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

