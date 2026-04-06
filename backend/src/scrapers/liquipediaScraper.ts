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

/**
 * Game detection — URL is the authoritative source.
 * The tournament URL always contains the wiki slug (ageofempires2, ageofmythology, etc.)
 * which maps 1:1 to the game. Name-based keywords are only a last resort.
 */
function detectGame(tournamentUrl: string, name: string, wikiGame: string): string {
  // Primary: tournament URL — definitive and never wrong
  if (tournamentUrl.includes('/ageofempires2/')) return 'AoE2';
  if (tournamentUrl.includes('/ageofempires3/')) return 'AoE3';
  if (tournamentUrl.includes('/ageofmythology/')) return 'AoM';
  if (tournamentUrl.includes('/ageofempires/'))   return 'AoE4';
  // Fallback: broad name keywords (only reached if URL is external/unknown)
  const n = name.toLowerCase();
  if (n.includes('age of empires ii') || n.includes('aoe2') || n.includes('aoe ii')) return 'AoE2';
  if (n.includes('age of empires iii') || n.includes('aoe3') || n.includes('age iii')) return 'AoE3';
  if (n.includes('age of mythology') || n.includes('aom') || n.includes('mytholog')) return 'AoM';
  if (n.includes('age of empires iv') || n.includes('aoe4') || n.includes('age iv')) return 'AoE4';
  return wikiGame;
}

/** Extract a Liquipedia tier letter (S/A/B/C/D) from a CSS class string. */
function parseTierFromClass(cls: string): string | null {
  const m = cls.match(/lp-([sabcd])-tier/i);
  return m ? m[1].toUpperCase() : null;
}

/** Only scrape matches from top-tier tournaments (S and A) */
function isTierAllowed(tier: string): boolean {
  return tier === 'S' || tier === 'A';
}

/**
 * Fallback tier guesser — used ONLY when Liquipedia page scrape fails.
 * Prefer `fetchTournamentInfo` for the real value.
 */
function guessTierFallback(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('world championship') || n.includes('red bull') || n.includes('masters') ||
      n.includes('wololo') || n.includes('hidden cup') || n.includes('warlords') ||
      n.includes('t90') || n.includes('pandora')) return 'S';
  if (n.includes('quarterly') || n.includes('invitational') || n.includes('wtl') ||
      n.includes('world team league') || n.includes('showcase') || n.includes('clash') ||
      n.includes('championship') || n.includes('global series') || n.includes('pro league')) return 'A';
  if (n.includes('league') || n.includes('cup') || n.includes('series') || n.includes('road to')) return 'B';
  return 'C';
}

/**
 * Fetch tier + Twitch channel from a Liquipedia tournament page.
 * Tier is read from the infobox `lp-{s/a/b/c/d}-tier` CSS class or "X-Tier" text.
 * Results are cached in the DB — only call for new/unknown tournaments.
 */
async function fetchTournamentInfo(liquipediaUrl: string): Promise<{ twitchChannel: string | null; tier: string | null }> {
  const html = await fetchHtml(liquipediaUrl);
  if (!html) return { twitchChannel: null, tier: null };
  await sleep(1500);
  const $ = cheerio.load(html);

  // Twitch channel
  let twitchChannel: string | null = null;
  $('a[href*="twitch.tv/"]').each((_i, el) => {
    const href = $(el).attr('href') || '';
    const m = href.match(/twitch\.tv\/([a-zA-Z0-9_]+)/);
    if (m && m[1].toLowerCase() !== 'liquipedia') {
      twitchChannel = m[1];
      return false;
    }
  });

  // Tier — Strategy 1: lp-{s/a/b/c/d}-tier CSS class (official Liquipedia tier badge)
  let tier: string | null = null;
  $('[class*="-tier"]').each((_i, el) => {
    const t = parseTierFromClass($(el).attr('class') || '');
    if (t) { tier = t; return false; }
  });
  // Tier — Strategy 2: "S-Tier" / "A-Tier" text in infobox cells
  if (!tier) {
    $('td, .infobox-cell-2, .wikitable td, .fo-nttax-infobox td').each((_i, el) => {
      const text = $(el).text().trim();
      const m = text.match(/^([SABCD])[- ]?Tier$/i);
      if (m) { tier = m[1].toUpperCase(); return false; }
    });
  }

  return { twitchChannel, tier };
}

/** Parse match-info blocks from a Liquipedia upcoming page */
function parseMatchBlocks(html: string, wikiPath: string, game: string): Array<{
  player1: string; player1Slug: string; player1Country: string;
  player2: string; player2Slug: string; player2Country: string;
  tournamentName: string; tournamentUrl: string;
  scheduledAt: Date; format: string; game: string;
  blockTier: string | null; // tier read directly from match block HTML (null = unknown)
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

      const tournEl        = $(el).find('.match-info-tournament a').first();
      const tournamentName = tournEl.text().trim() || 'Unknown Tournament';
      const tournPath      = tournEl.attr('href') || '';
      const tournamentUrl  = tournPath.startsWith('http') ? tournPath : `https://liquipedia.net${tournPath}`;

      const scoreLower = $(el).find('.match-info-header-scoreholder-lower').first().text().trim();
      const boMatch = scoreLower.match(/Bo(\d+)/i);
      const format = boMatch ? `BO${parseInt(boMatch[1], 10)}` : 'BO3';

      // Try to read tier badge directly from the match block HTML (lp-{s/a/b/c}-tier class)
      let blockTier: string | null = null;
      $(el).find('[class*="-tier"]').each((_i2, el2) => {
        const t = parseTierFromClass($(el2).attr('class') || '');
        if (t) { blockTier = t; return false; }
      });
      // If no tier badge in block, fall back to name-based guess
      const tier = blockTier ?? guessTierFallback(tournamentName);
      if (!isTierAllowed(tier)) return;

      results.push({ player1, player1Slug, player1Country, player2, player2Slug, player2Country, tournamentName, tournamentUrl, scheduledAt, format, game, blockTier });
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
          select: { id: true, twitchChannel: true, game: true, tier: true },
        });

        // Fetch tournament page when: new tournament, missing twitch channel, or tier never
        // properly set (still at default 'C' from a previous guess). This caches result in DB
        // so we only hit Liquipedia once per tournament.
        let twitchChannel = existingTourn?.twitchChannel ?? null;
        let scrapedTier: string | null = m.blockTier; // use tier from match block if present
        const needsPageFetch = m.tournamentUrl.includes('liquipedia.net') &&
          (!existingTourn || !twitchChannel || !scrapedTier);
        if (needsPageFetch) {
          const info = await fetchTournamentInfo(m.tournamentUrl);
          twitchChannel = info.twitchChannel ?? twitchChannel;
          scrapedTier   = info.tier ?? scrapedTier;
        }

        // Game from URL is definitive; tier from Liquipedia page is authoritative
        const correctGame = detectGame(m.tournamentUrl, m.tournamentName, m.game);
        const correctTier = scrapedTier ?? guessTierFallback(m.tournamentName);

        // ── Tournament deduplication ───────────────────────────────────────────
        // The AoE event calendar creates tournaments with guessed URLs before the
        // Liquipedia scraper finds the real URL. We detect this case by looking for
        // a same-game tournament whose name is a substring of (or contains) ours.
        // When found, we fix its URL to the real one rather than creating a duplicate.
        let tournament = existingTourn
          ? await prisma.tournament.findUnique({ where: { liquipediaUrl: m.tournamentUrl } })
          : null;

        if (!tournament) {
          const normalizeName = (n: string) =>
            n.toLowerCase()
              .replace(/\s*(age of empires|aoe)\s*(iv|ii|iii|[1-4]|mythology|retold)[\s:]*/gi, ' ')
              .replace(/\s*-\s*(playoffs?|group\s*[a-z]?|qualifiers?|round\s*\d+|season\s*\d+).*$/i, '')
              .replace(/\s+/g, ' ').trim();

          const myNorm = normalizeName(m.tournamentName);
          const candidates = await prisma.tournament.findMany({
            where: {
              game: correctGame,
              startDate: { gte: new Date(Date.now() - 90 * 24 * 3600 * 1000) },
              NOT: { liquipediaUrl: m.tournamentUrl },
            },
            select: { id: true, name: true, liquipediaUrl: true },
          });

          const duplicate = candidates.find(c => {
            const cNorm = normalizeName(c.name);
            return myNorm === cNorm || myNorm.startsWith(cNorm) || cNorm.startsWith(myNorm);
          });

          if (duplicate) {
            // Merge: update the stale record with the real Liquipedia URL + authoritative data
            logger.info(`[Liquipedia] Merging duplicate tournament "${duplicate.name}" → "${m.tournamentName}"`);
            tournament = await prisma.tournament.update({
              where: { id: duplicate.id },
              data: {
                liquipediaUrl: m.tournamentUrl,
                name: m.tournamentName,
                game: correctGame,
                tier: correctTier,
                isActive: true,
                ...(twitchChannel ? { twitchChannel } : {}),
              },
            });
          } else {
            tournament = await prisma.tournament.create({
              data: {
                name: m.tournamentName,
                game: correctGame,
                tier: correctTier,
                liquipediaUrl: m.tournamentUrl,
                startDate: m.scheduledAt,
                isActive: true,
                twitchChannel,
              },
            });
          }
        } else {
          tournament = await prisma.tournament.update({
            where: { liquipediaUrl: m.tournamentUrl },
            data: {
              ...(m.tournamentName !== 'Unknown Tournament' ? { name: m.tournamentName } : {}),
              game: correctGame,
              tier: correctTier,
              isActive: true,
              ...(twitchChannel ? { twitchChannel } : {}),
            },
          });
        }

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

        const windowStart = new Date(m.scheduledAt.getTime() - 2 * 3600 * 1000);
        const windowEnd   = new Date(m.scheduledAt.getTime() + 2 * 3600 * 1000);

        // Skip if a COMPLETED match already exists within ±12h (prevents duplicate on rescrape,
        // but allows rematches in later rounds / playoff brackets scheduled on different days)
        const completedMatch = await prisma.match.findFirst({
          where: {
            OR: [{ player1Id: p1.id, player2Id: p2.id }, { player1Id: p2.id, player2Id: p1.id }],
            tournamentId: tournament.id,
            status: 'COMPLETED',
            scheduledAt: { gte: new Date(m.scheduledAt.getTime() - 12 * 3600 * 1000), lte: new Date(m.scheduledAt.getTime() + 12 * 3600 * 1000) },
          },
        });
        if (completedMatch) continue;

        // Skip if any UPCOMING/LIVE match already exists for these players within ±2h
        // (cross-tournament check handles the same match appearing on multiple wikis)
        const existing = await prisma.match.findFirst({
          where: {
            OR: [{ player1Id: p1.id, player2Id: p2.id }, { player1Id: p2.id, player2Id: p1.id }],
            scheduledAt: { gte: windowStart, lte: windowEnd },
            status: { in: ['UPCOMING', 'LIVE'] },
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

