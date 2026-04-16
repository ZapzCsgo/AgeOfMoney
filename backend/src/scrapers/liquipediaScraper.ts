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

// All AoE games share a single Liquipedia upcoming matches page at /ageofempires/.
// The individual wiki paths (ageofempires2, ageofempires3, ageofmythology) do NOT
// have their own upcoming matches pages (404). Game detection uses detectGame().
const GAME_WIKIS: { game: string; wikiPath: string }[] = [
  { game: 'AoE4', wikiPath: 'ageofempires' },
];

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

/** Map our internal game code to the Liquipedia wiki path for player pages. */
function wikiForGame(game: string): string {
  switch (game) {
    case 'AoE2': return 'ageofempires2';
    case 'AoE3': return 'ageofempires3';
    case 'AoM':  return 'ageofmythology';
    default:     return 'ageofempires'; // AoE4, AoE1
  }
}

/**
 * Fetch missing player avatars from Liquipedia — run once a day, not during main scrape.
 * Processes max 50 players per run to stay well under rate limits.
 * Players with no avatar on Liquipedia are marked with avatarUrl='' to avoid
 * re-fetching them on every run (null = unchecked, '' = checked/no avatar).
 */
export async function fetchPlayersAvatars(): Promise<void> {
  // Only pick players that haven't been checked yet (avatarUrl is null)
  const players = await prisma.player.findMany({
    where: { avatarUrl: null },
    select: { id: true, name: true, liquipediaSlug: true, game: true },
    take: 50,
  });
  logger.info(`[Liquipedia] Fetching avatars for ${players.length} unchecked players`);
  for (const player of players) {
    const primaryWiki = wikiForGame(player.game);
    // Try the game-specific wiki first, then fall back to the main ageofempires wiki.
    // Many players (e.g. AoE2 pros) have their page on ageofempires even if primaryWiki differs.
    const wikisToTry = primaryWiki === 'ageofempires'
      ? ['ageofempires']
      : [primaryWiki, 'ageofempires'];

    let avatarUrl: string | null = null;
    let usedWiki = primaryWiki;
    for (const wiki of wikisToTry) {
      avatarUrl = await fetchLiquipediaPlayerAvatar(player.liquipediaSlug, wiki);
      if (avatarUrl) { usedWiki = wiki; break; }
      await sleep(1500);
    }

    if (avatarUrl) {
      await prisma.player.update({ where: { id: player.id }, data: { avatarUrl } });
      logger.info(`[Liquipedia] Avatar saved for ${player.name} (${usedWiki})`);
    } else {
      // Mark as checked so we don't keep retrying on every run
      await prisma.player.update({ where: { id: player.id }, data: { avatarUrl: '' } });
      logger.info(`[Liquipedia] No avatar for ${player.name} (tried: ${wikisToTry.join(', ')}) — marked as checked`);
    }
    await sleep(2000);
  }
}

/**
 * Scrape a player's Liquipedia page to get their profile photo.
 * Rate-limited — only call if avatarUrl is null.
 * Returns null if no image found (caller should store '' as sentinel).
 */
async function fetchLiquipediaPlayerAvatar(slug: string, wiki = 'ageofempires'): Promise<string | null> {
  const html = await fetchHtml(`https://liquipedia.net/${wiki}/${encodeURIComponent(slug)}`);
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

// Honest User-Agent per Liquipedia policy — identifies the project + contact
const LP_USER_AGENT = 'AgeOfMoneyBot/1.0 (https://ageof.money; contact@ageof.money)';

/**
 * Try the MediaWiki API first (action=parse) — this is the officially sanctioned
 * free endpoint and is far less likely to 403 than raw HTML scraping.
 * Falls back to direct HTML fetch if the API fails.
 */
async function fetchHtml(url: string, retries = 3): Promise<string | null> {
  // Respect the shared circuit breaker — if Liquipedia is blocking us,
  // don't even try (both the scorer and this scraper trip the same breaker).
  const { isLpBlocked, tripCircuitBreaker, resetCircuitBreaker } = require('../services/liquipediaLiveScorer');
  if (isLpBlocked()) {
    logger.debug(`[Liquipedia] Skipping fetch (circuit breaker active): ${url}`);
    return null;
  }

  // Try MediaWiki API first for Liquipedia pages
  const mwHtml = await fetchViaMediaWikiApi(url);
  if (mwHtml) {
    resetCircuitBreaker();
    return mwHtml;
  }

  // Fallback: direct HTML fetch — NO retry on 429 (retrying a rate-limited
  // request just extends the IP ban). Only retry on transient errors.
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await axios.get<string>(url, {
        headers: {
          'User-Agent': LP_USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
        },
        decompress: true,
        timeout: 25000,
      });

      if (typeof res.data === 'string' && (
        res.data.includes('captcha') ||
        res.data.includes('token/generate') ||
        res.data.includes('cf-browser-verification')
      )) {
        logger.warn(`[Liquipedia] Blocked/CAPTCHA on ${url} (attempt ${attempt}/${retries})`);
        tripCircuitBreaker();
        return null;
      }

      resetCircuitBreaker();
      return res.data;
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        if (status === 429 || status === 503) {
          logger.warn(`[Liquipedia] ${status} on ${url} — tripping circuit breaker, no retry`);
          tripCircuitBreaker();
          return null; // do NOT retry 429/503
        }
        logger.warn(`[Liquipedia] Direct fetch failed (attempt ${attempt}/${retries}): ${err.message} (HTTP ${status ?? 'timeout'})`);
        if (attempt < retries) {
          await sleep(attempt * 5000);
          continue;
        }
      }
      return null;
    }
  }
  return null;
}

/**
 * Fetch a Liquipedia page via the MediaWiki API (action=parse).
 * This is the official free access method — 1 req/30s rate limit but no IP bans.
 * Returns the parsed HTML content, or null if it fails.
 */
async function fetchViaMediaWikiApi(url: string): Promise<string | null> {
  // Only works for liquipedia.net URLs
  const match = url.match(/liquipedia\.net\/([^/]+)\/(.+)/);
  if (!match) return null;

  const { isLpBlocked, tripCircuitBreaker } = require('../services/liquipediaLiveScorer');
  if (isLpBlocked()) return null;

  const [, wiki, pagePath] = match;
  const pageName = decodeURIComponent(pagePath.split('?')[0]);
  const apiUrl = `https://liquipedia.net/${wiki}/api.php`;

  try {
    const res = await axios.get(apiUrl, {
      params: {
        action: 'parse',
        page: pageName,
        format: 'json',
        prop: 'text',
      },
      headers: {
        'User-Agent': LP_USER_AGENT,
        'Accept-Encoding': 'gzip, deflate, br',
      },
      decompress: true,
      timeout: 30000,
    });

    const html = res.data?.parse?.text?.['*'];
    if (html && typeof html === 'string' && html.length > 100) {
      logger.info(`[Liquipedia] Fetched via MediaWiki API: ${pageName}`);
      return html;
    }
    return null;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      logger.warn(`[Liquipedia] MediaWiki API failed for ${pageName}: ${err.message} (HTTP ${status ?? 'timeout'})`);
      if (status === 429 || status === 503) tripCircuitBreaker();
    }
    return null;
  }
}

/**
 * Game detection — URL is the authoritative source.
 * The tournament URL always contains the wiki slug (ageofempires2, ageofmythology, etc.)
 * which maps 1:1 to the game. Name-based keywords are only a last resort.
 */
function detectGame(tournamentUrl: string, name: string, wikiGame: string, playerHrefs: string[] = []): string {
  // Player hrefs are interwiki links — when both players link to the same game wiki,
  // that's the strongest signal (stronger than tournament URL, which can be wrong
  // if the tournament page lives on a different wiki than the players).
  const hrefGames = playerHrefs.map(h => {
    if (h.includes('/ageofempires2/'))  return 'AoE2';
    if (h.includes('/ageofempires3/'))  return 'AoE3';
    if (h.includes('/ageofmythology/')) return 'AoM';
    if (h.includes('/ageofempires/'))   return 'AoE4';
    return null;
  }).filter(Boolean) as string[];
  if (hrefGames.length > 0 && hrefGames.every(g => g === hrefGames[0])) return hrefGames[0];

  // Tournament URL — usually correct
  if (tournamentUrl.includes('/ageofempires2/')) return 'AoE2';
  if (tournamentUrl.includes('/ageofempires3/')) return 'AoE3';
  if (tournamentUrl.includes('/ageofmythology/')) return 'AoM';
  if (tournamentUrl.includes('/ageofempires/'))   return 'AoE4';

  // Fallback: broad name keywords
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
  // VERY conservative — only flag the few tournament series that are
  // unambiguously S-tier on Liquipedia. Everything else falls to 'C' so it
  // gets filtered out by isTierAllowed(); names like "Invitational", "WTL",
  // "Championship" or "Pro League" are NOT reliable signals (e.g. WTL
  // Invitational Season is actually B-tier on Liquipedia).
  const n = name.toLowerCase();
  if (n.includes('world championship') || n.includes('red bull') ||
      n.includes('wololo') || n.includes('hidden cup') || n.includes('warlords') ||
      n.includes('t90') || n.includes('pandora')) return 'S';
  return 'C';
}

/**
 * Fetch tier + Twitch channel from a Liquipedia tournament page.
 * Tier is read from the infobox `lp-{s/a/b/c/d}-tier` CSS class or "X-Tier" text.
 * Results are cached in the DB — only call for new/unknown tournaments.
 */
export async function fetchTournamentInfo(liquipediaUrl: string): Promise<{ twitchChannel: string | null; tier: string | null; gameFromInfobox: string | null }> {
  const html = await fetchHtml(liquipediaUrl);
  if (!html) return { twitchChannel: null, tier: null, gameFromInfobox: null };
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
  // Tier — Strategy 2: look for "S-Tier" / "A-Tier" anywhere in text (not just exact match)
  // Handles cases like "Qualifier (S-Tier Tournaments)" or "S-Tier" with surrounding content
  if (!tier) {
    $('td, .infobox-cell-2, .wikitable td, .fo-nttax-infobox td, div, span, a').each((_i, el) => {
      const text = $(el).text().trim();
      const m = text.match(/\b([SABCD])[- ]?Tier\b/i);
      if (m) { tier = m[1].toUpperCase(); return false; }
    });
  }
  // Tier — Strategy 3: look for tier in link hrefs (e.g. "/S-Tier_Tournaments")
  if (!tier) {
    $('a[href*="Tier_Tournaments"]').each((_i, el) => {
      const href = $(el).attr('href') || '';
      const m = href.match(/\/([SABCD])-Tier_Tournaments/i);
      if (m) { tier = m[1].toUpperCase(); return false; }
    });
  }

  // Game from infobox — most reliable signal. Look for the "Game:" row
  // in the league infobox. Liquipedia always sets this consistently.
  // Use word-boundary regex so "Empires" never accidentally matches "i".
  let gameFromInfobox: string | null = null;
  const classify = (raw: string): string | null => {
    const v = raw.trim();
    if (/age of mythology/i.test(v)) return 'AoM';
    if (/age of empires\s*(?:iv|4)\b/i.test(v)) return 'AoE4';
    if (/age of empires\s*(?:iii|3)\b/i.test(v)) return 'AoE3';
    if (/age of empires\s*(?:ii|2)\b/i.test(v)) return 'AoE2';
    if (/age of empires(?:\s|$|:|\(|\.)/i.test(v) && !/\b(?:ii|iii|iv|2|3|4)\b/i.test(v)) return 'AoE1';
    return null;
  };

  // Strategy A: structured infobox cell ("Game:" → value)
  $('.fo-nttax-infobox-wrapper .infobox-cell-2, .infobox-cell-2').each((_i, el) => {
    const label = $(el).text().trim().toLowerCase();
    if (label === 'game:' || label === 'game') {
      gameFromInfobox = classify($(el).next().text());
      if (gameFromInfobox) return false;
    }
  });
  // Strategy B: any link to "/Age_of_*" within the infobox area
  if (!gameFromInfobox) {
    $('.fo-nttax-infobox a, .infobox a').each((_i, el) => {
      const href = $(el).attr('href') || '';
      if (/\/Age_of_Mythology/i.test(href))                            { gameFromInfobox = 'AoM';  return false; }
      if (/\/Age_of_Empires_IV/i.test(href))                           { gameFromInfobox = 'AoE4'; return false; }
      if (/\/Age_of_Empires_III/i.test(href))                          { gameFromInfobox = 'AoE3'; return false; }
      if (/\/Age_of_Empires_II($|[^I])/i.test(href) || /\/Age_of_Empires_II:/i.test(href)) { gameFromInfobox = 'AoE2'; return false; }
      // AoE1 is the bare "Age_of_Empires" page (no II/III/IV suffix)
      if (/\/Age_of_Empires(?:_\(|$|:)/i.test(href) && !/_II|_III|_IV/i.test(href)) { gameFromInfobox = 'AoE1'; return false; }
    });
  }
  // Strategy C: page title h1 — fallback when infobox cell wasn't found
  if (!gameFromInfobox) {
    const title = $('#firstHeading, h1').first().text();
    gameFromInfobox = classify(title);
  }

  return { twitchChannel, tier, gameFromInfobox };
}

/** Parse match-info blocks from a Liquipedia upcoming page */
function parseMatchBlocks(html: string, wikiPath: string, game: string): Array<{
  player1: string; player1Slug: string; player1Country: string; player1Href: string;
  player2: string; player2Slug: string; player2Country: string; player2Href: string;
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
      // Skip team org names: "Team X", "X Esports", "X Esports A/B", "Old School B", "Rulers of Rome A"
      const teamPattern = /^team\s+|esports?\s*[ab]?$|\s+esports?$|esports?\s+[ab]$|\s+[AB]$/;
      if (teamPattern.test(player1) || teamPattern.test(player2)) return;

      const player1Country = leftEl.find('.flag img').first().attr('alt') || '';
      const player2Country = rightEl.find('.flag img').first().attr('alt') || '';

      // MediaWiki API HTML nests the name in .match-info-tournament-name a;
      // the old selector .match-info-tournament a hit the icon link (empty text).
      const tournEl        = $(el).find('.match-info-tournament-name a').first();
      const tournElFallback = tournEl.length ? tournEl : $(el).find('.match-info-tournament a').first();
      const tournamentName = tournElFallback.text().trim() || 'Unknown Tournament';
      const tournPath      = tournElFallback.attr('href') || '';
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
      // Only filter here when we have a definitive tier from the HTML badge.
      // When blockTier is null (no badge), let the match through — the real tier
      // will be resolved from the tournament page during the persist step.
      if (blockTier && !isTierAllowed(blockTier)) return;

      results.push({ player1, player1Slug, player1Country, player1Href: leftHref, player2, player2Slug, player2Country, player2Href: rightHref, tournamentName, tournamentUrl, scheduledAt, format, game, blockTier });
    } catch { /* skip bad rows */ }
  });

  return results;
}

// Mutex to prevent concurrent scraper runs (race condition creates duplicates)
let scrapeLock = false;

export async function scrapeUpcomingMatches(): Promise<void> {
  if (scrapeLock) {
    logger.info('[Liquipedia] Scrape already in progress — skipping concurrent run');
    return;
  }
  scrapeLock = true;
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
      await sleep(5000); // 5s between wikis — safe margin against rate limiting
    }

    logger.info(`[Liquipedia] Total: ${matchesFound} upcoming matches across all wikis`);

    // ── Persist to DB ──────────────────────────────────────────────────────────
    // Cache tournament info fetches to avoid repeated requests for the same URL
    const tournInfoCache = new Map<string, { twitchChannel: string | null; tier: string | null; gameFromInfobox: string | null }>();

    for (const m of allMatches) {
      try {
        const existingTourn = await prisma.tournament.findUnique({
          where: { liquipediaUrl: m.tournamentUrl },
          select: { id: true, twitchChannel: true, game: true, tier: true },
        });

        // Fetch the tournament page when:
        //  - brand new tournament (we have nothing yet), OR
        //  - we have no tier info, OR
        //  - the tournament is on /ageofempires/ (AoE4 wiki) but we suspect it's
        //    actually a cross-wiki match — fetching the infobox is the only way
        //    to be 100% sure of the game.
        let twitchChannel = existingTourn?.twitchChannel ?? null;
        let scrapedTier: string | null = m.blockTier ?? existingTourn?.tier ?? null;
        let gameFromInfobox: string | null = null;
        const needsTierFetch = !scrapedTier && m.tournamentUrl.includes('liquipedia.net');
        const isNewTournament = !existingTourn && m.tournamentUrl.includes('liquipedia.net');
        // Always re-probe game when tournament URL is on the AoE4 wiki — that's
        // where cross-wiki matches sneak in via the federated upcoming widget.
        const needsGameProbe = m.tournamentUrl.includes('/ageofempires/') && !m.tournamentUrl.includes('/ageofempires2/') && !m.tournamentUrl.includes('/ageofempires3/');
        if (isNewTournament || needsTierFetch || needsGameProbe) {
          // Use cached result if we already fetched this tournament URL
          const cacheKey = m.tournamentUrl.split('#')[0]; // strip anchors
          let info = tournInfoCache.get(cacheKey);
          if (!info) {
            await sleep(3000); // respect rate limit between tournament page fetches
            info = await fetchTournamentInfo(m.tournamentUrl);
            tournInfoCache.set(cacheKey, info);
          }
          twitchChannel = info.twitchChannel ?? twitchChannel;
          scrapedTier   = info.tier ?? scrapedTier;
          gameFromInfobox = info.gameFromInfobox ?? null;
        }

        // Game detection priority:
        //  1. Infobox `Game:` field on the tournament page (most reliable)
        //  2. Player interwiki hrefs (when both point to the same wiki)
        //  3. Tournament URL prefix
        //  4. Name keywords
        const correctGame = gameFromInfobox
          ?? detectGame(m.tournamentUrl, m.tournamentName, m.game, [m.player1Href, m.player2Href]);
        if (gameFromInfobox && gameFromInfobox !== 'AoE4') {
          logger.info(`[Liquipedia] Cross-wiki match detected: "${m.tournamentName}" → ${gameFromInfobox} (from infobox)`);
        }
        const correctTier = scrapedTier ?? guessTierFallback(m.tournamentName);

        // Skip matches from low-tier tournaments (only S and A allowed)
        if (!isTierAllowed(correctTier)) {
          logger.debug(`[Liquipedia] Skipping ${m.player1} vs ${m.player2} — tier ${correctTier} (${m.tournamentName})`);
          continue;
        }

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
            // Merge: update the stale record with the real Liquipedia URL + authoritative data.
            // Apply the same `game` overwrite protection as the regular update branch:
            // never overwrite a manually-corrected non-AoE4 game unless the infobox
            // probe gave us a high-confidence verdict.
            const dupExisting = await prisma.tournament.findUnique({
              where: { id: duplicate.id },
              select: { game: true },
            });
            const dupHighConfidenceGame = !!gameFromInfobox;
            const dupShouldUpdateGame = dupExisting?.game === 'AoE4' || dupHighConfidenceGame;
            logger.info(`[Liquipedia] Merging duplicate tournament "${duplicate.name}" → "${m.tournamentName}"${dupShouldUpdateGame ? '' : ` (preserving game=${dupExisting?.game})`}`);
            tournament = await prisma.tournament.update({
              where: { id: duplicate.id },
              data: {
                liquipediaUrl: m.tournamentUrl,
                name: m.tournamentName,
                ...(dupShouldUpdateGame ? { game: correctGame } : {}),
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
          // Only overwrite `game` when:
          //  - the existing classification is the schema default 'AoE4', OR
          //  - the new value comes from a HIGH-confidence source (infobox probe)
          // This prevents auto-detection from undoing a manual admin fix on
          // every cron tick.
          const existingGame = existingTourn?.game;
          const highConfidenceGame = !!gameFromInfobox; // infobox is the only definitive signal
          const shouldUpdateGame = existingGame === 'AoE4' || highConfidenceGame;
          tournament = await prisma.tournament.update({
            where: { liquipediaUrl: m.tournamentUrl },
            data: {
              ...(m.tournamentName !== 'Unknown Tournament' ? { name: m.tournamentName } : {}),
              ...(shouldUpdateGame ? { game: correctGame } : {}),
              tier: correctTier,
              isActive: true,
              ...(twitchChannel ? { twitchChannel } : {}),
            },
          });
        }

        // Tag the player with the game we just detected so they're properly
        // classified BEFORE any enrichment. We only set on create to avoid
        // overwriting players who have been manually classified or who play
        // multiple games (the AI enrichment path may update this later).
        const tournGameForPlayer = (tournament as { game?: string }).game ?? correctGame;
        const p1 = await prisma.player.upsert({
          where: { liquipediaSlug: m.player1Slug },
          update: {},
          create: { name: m.player1, liquipediaSlug: m.player1Slug, country: m.player1Country || null, elo: 1500, game: tournGameForPlayer },
        });
        const p2 = await prisma.player.upsert({
          where: { liquipediaSlug: m.player2Slug },
          update: {},
          create: { name: m.player2, liquipediaSlug: m.player2Slug, country: m.player2Country || null, elo: 1500, game: tournGameForPlayer },
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

        // ── Postponement detection ──────────────────────────────────────────────
        // If Liquipedia now shows a FUTURE scheduledAt (≥30 min from now) for these
        // players but a LIVE match already exists with a past scheduledAt, it means
        // the match was postponed/rescheduled. We update the existing record rather
        // than creating a duplicate, which would cause the LIVE match to be
        // auto-cancelled after 8h with no result.
        if (m.scheduledAt > new Date(Date.now() + 30 * 60 * 1000)) {
          const livePostponed = await prisma.match.findFirst({
            where: {
              OR: [{ player1Id: p1.id, player2Id: p2.id }, { player1Id: p2.id, player2Id: p1.id }],
              tournamentId: tournament.id,
              status: 'LIVE',
              winnerId: null,
              scheduledAt: { lt: new Date() },
            },
            select: { id: true, scheduledAt: true },
          });
          if (livePostponed) {
            await prisma.match.update({
              where: { id: livePostponed.id },
              data: {
                status: 'UPCOMING',
                scheduledAt: m.scheduledAt,
                betsClosedAt: new Date(m.scheduledAt.getTime() - 5 * 60 * 1000),
                betsOpen: true,
                verificationFlag: false,
              },
            });
            const { getIo } = require('../socket');
            const io = getIo();
            io?.to(`matchRoom:${livePostponed.id}`).emit('matchStatusUpdate', { matchId: livePostponed.id, status: 'UPCOMING' });
            io?.emit('matchUpdate', { matchId: livePostponed.id, status: 'UPCOMING', scheduledAt: m.scheduledAt.toISOString() });
            logger.info(`[Liquipedia] Postponement detected: match ${livePostponed.id} reverted LIVE→UPCOMING, new time: ${m.scheduledAt.toISOString()} (was ${livePostponed.scheduledAt.toISOString()})`);
            continue;
          }
        }

        // If an UPCOMING/LIVE match already exists for these players within ±2h,
        // make sure its game/tournament link reflects what we just (re-)detected
        // — old matches from a wrong wiki classification get healed here.
        const existing = await prisma.match.findFirst({
          where: {
            OR: [{ player1Id: p1.id, player2Id: p2.id }, { player1Id: p2.id, player2Id: p1.id }],
            scheduledAt: { gte: windowStart, lte: windowEnd },
            status: { in: ['UPCOMING', 'LIVE'] },
          },
          select: { id: true, game: true, tournamentId: true },
        });
        if (existing) {
          const tournGameNow = (tournament as { game?: string }).game ?? correctGame;
          if (existing.game !== tournGameNow || existing.tournamentId !== tournament.id) {
            await prisma.match.update({
              where: { id: existing.id },
              data: { game: tournGameNow, tournamentId: tournament.id },
            });
            logger.info(`[Liquipedia] Healed match ${existing.id}: game ${existing.game}→${tournGameNow}`);
          }
          continue;
        }

        const prob1 = 1 / (1 + Math.pow(10, (p2.elo - p1.elo) / 400));
        const margin = 0.05;
        const odds1 = parseFloat(Math.max(1.05, (1 / prob1) * (1 - margin)).toFixed(2));
        const odds2 = parseFloat(Math.max(1.05, (1 / (1 - prob1)) * (1 - margin)).toFixed(2));

        // Calculate draw odds for even BO formats (BO2, BO4...)
        const { formatAllowsDraw, calculateDrawProbability } = await import('../services/oddsEngine');
        let oddsDraw: number | null = null;
        if (formatAllowsDraw(m.format)) {
          const boNum = parseInt(m.format.replace(/\D/g, ''), 10);
          const drawProb = Math.max(0.05, calculateDrawProbability(prob1, boNum));
          oddsDraw = parseFloat(Math.max(1.05, (1 / drawProb) * (1 - margin)).toFixed(2));
        }

        const tournGame = (tournament as { game?: string }).game ?? m.game;
        await prisma.match.create({
          data: {
            player1Id: p1.id, player2Id: p2.id, tournamentId: tournament.id,
            game: tournGame, status: 'UPCOMING', format: m.format,
            scheduledAt: m.scheduledAt,
            betsClosedAt: new Date(m.scheduledAt.getTime() - 5 * 60 * 1000),
            odds1, odds2, oddsDraw,
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
  } finally {
    scrapeLock = false;
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

