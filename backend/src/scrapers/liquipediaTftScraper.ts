/**
 * Liquipedia TFT scraper.
 *
 * Discovers upcoming and ongoing TFT tournaments (S and A tier only) from
 * the tft wiki, then for each tournament extracts the participants list +
 * basic metadata (dates, prize pool, region, Twitch).
 *
 * Architecture mirrors `liquipediaScraper.ts` (AoE) on purpose : same
 * circuit-breaker infra, same MediaWiki API preference, same direct-HTML
 * fallback. Differences are TFT-specific :
 *
 *   - Source pages are on the `tft` wiki path (`liquipedia.net/tft/...`)
 *   - Discovery happens on Portal:Tournaments rather than the federated
 *     Upcoming_and_ongoing_matches page (TFT doesn't expose a per-match
 *     widget — only tournament-level pages)
 *   - Output is `Tournament` + `TournamentParticipant` rows (not Match
 *     rows like AoE — TFT is 8-player free-for-all, no head-to-head)
 *
 * Rate budget : LP throttles us to ~1 req / 30s on action=parse, so this
 * scraper batches across cron ticks. One full S/A sweep takes ~3 minutes
 * in the worst case, comfortably under the 30-min cron tick.
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import { prisma } from '../index';
import logger from '../logger';

const LP_USER_AGENT = 'TftMoneyBot/1.0 (https://tft.money; contact@tft.money)';

// ── Tier whitelist ────────────────────────────────────────────────────────
// Liquipedia tiers as observed on the TFT wiki (2026) :
//   S-Tier : Esports World Cup, Space Gods Tactician's Crown
//   A-Tier : Regional Finals (AMER/EMEA/APAC/CN), TFT Pro Circuit Anima Cup,
//            Tactician's Crown qualifier circuit
//   B-Tier : Tactician's Trials, regional Open Cups
// We only ingest S/A — filtering anything below keeps the participant
// pool manageable for the odds engine and matches the betting market's
// natural focus on top events.
function isTierAllowed(tier: string): boolean {
  return tier === 'S' || tier === 'A';
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Shared LP infra ──────────────────────────────────────────────────────
// Reuses the same circuit breaker as the AoE scrapers. If LP hard-blocks
// our Railway IP we trip the same breaker — no point in two scrapers
// fighting over the same rate-limit budget. All three (AoE upcoming, AoE
// live scorer, TFT) share the breaker state.
async function fetchHtml(url: string): Promise<string | null> {
  const { isLpBlocked, lpRouteUrl, lpProxyHeaders, tripCircuitBreaker, resetCircuitBreaker } =
    require('../services/liquipediaLiveScorer');

  if (isLpBlocked()) {
    logger.info(`[LiquipediaTFT] Skipping fetch (circuit breaker open): ${url}`);
    return null;
  }

  // Prefer the MediaWiki API path — same reasoning as the AoE scraper :
  // explicit rate-limit handling + reliable error reporting.
  const mw = await fetchViaMediaWikiApi(url);
  if (mw) {
    resetCircuitBreaker();
    return mw;
  }

  // If the API call just tripped the breaker (429), don't double-fire on
  // the direct HTML URL — same fix we applied to liquipediaScraper.ts on
  // 2026-05-27. Without this, one MW 429 escalates to a 15-min breaker.
  if (isLpBlocked()) {
    logger.info(`[LiquipediaTFT] Skipping direct HTML fallback — MW just tripped breaker (${url})`);
    return null;
  }

  try {
    const res = await axios.get<string>(lpRouteUrl(url), {
      headers: {
        'User-Agent': LP_USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,*/*',
        'Accept-Encoding': 'gzip, deflate, br',
        ...lpProxyHeaders(),
      },
      decompress: true,
      timeout: 25_000,
    });
    if (typeof res.data === 'string' && (
      res.data.includes('captcha') ||
      res.data.includes('token/generate') ||
      res.data.includes('cf-browser-verification')
    )) {
      logger.warn(`[LiquipediaTFT] CAPTCHA wall on ${url}`);
      tripCircuitBreaker();
      return null;
    }
    resetCircuitBreaker();
    return res.data;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      if (status === 429 || status === 503) {
        logger.warn(`[LiquipediaTFT] ${status} on ${url} — tripping breaker`);
        tripCircuitBreaker();
      } else {
        logger.warn(`[LiquipediaTFT] Direct fetch failed: ${err.message} (HTTP ${status ?? 'timeout'})`);
      }
    }
    return null;
  }
}

async function fetchViaMediaWikiApi(url: string): Promise<string | null> {
  const m = url.match(/liquipedia\.net\/(tft)\/(.+)/);
  if (!m) return null;
  const { lpRouteUrl, lpProxyHeaders, tripCircuitBreaker } = require('../services/liquipediaLiveScorer');
  const [, wiki, pagePath] = m;
  const pageName = decodeURIComponent(pagePath.split('?')[0]);
  try {
    const res = await axios.get(lpRouteUrl(`https://liquipedia.net/${wiki}/api.php`), {
      params: { action: 'parse', page: pageName, format: 'json', prop: 'text' },
      headers: {
        'User-Agent': LP_USER_AGENT,
        'Accept-Encoding': 'gzip, deflate, br',
        ...lpProxyHeaders(),
      },
      decompress: true,
      timeout: 30_000,
    });
    const html = res.data?.parse?.text?.['*'];
    if (typeof html === 'string' && html.length > 200) {
      logger.info(`[LiquipediaTFT] Fetched via MediaWiki API: ${pageName}`);
      return html;
    }
    const code = res.data?.error?.code ?? 'no-text';
    const info = res.data?.error?.info ?? 'empty';
    logger.warn(`[LiquipediaTFT] API returned no usable HTML for ${pageName}: ${code} ${info}`);
    return null;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      logger.warn(`[LiquipediaTFT] MediaWiki API failed for ${pagePath}: ${err.message} (HTTP ${status ?? 'timeout'})`);
      if (status === 429 || status === 503) tripCircuitBreaker();
    }
    return null;
  }
}

// ── Discovery — Portal:Tournaments ───────────────────────────────────────

export interface ScrapedTournament {
  name: string;
  tier: string;
  liquipediaUrl: string;
  startDate: Date;
  endDate?: Date | null;
  prizePool?: string | null;
  region?: string | null;
  twitchChannel?: string | null;
  competeTftUrl?: string | null;
}

const PORTAL_URL = 'https://liquipedia.net/tft/Portal:Tournaments';

/**
 * Pull the upcoming + ongoing tournaments from the Portal page. Liquipedia
 * splits this into S-tier / A-tier / B-tier accordions, each containing a
 * table of (tournament, dates, prize, location). We extract S+A only.
 *
 * Returns minimal metadata — full participants list comes from a second
 * pass that fetches each tournament page individually.
 */
export async function discoverUpcomingTournaments(): Promise<ScrapedTournament[]> {
  const html = await fetchHtml(PORTAL_URL);
  if (!html) {
    logger.warn('[LiquipediaTFT] Could not fetch Portal:Tournaments — skipping discovery cycle');
    return [];
  }
  const $ = cheerio.load(html);
  const results: ScrapedTournament[] = [];
  const now = Date.now();
  const horizonMs = 120 * 24 * 3600 * 1000; // 120 days forward

  // LP groups tournaments into `.divRow` blocks under tier headers. We walk
  // every divRow and check its parent tier indicator. Empirically the tier
  // is encoded as `lp-{s/a/b/c}-tier` CSS class on a descendant span.
  $('.divRow, tr.divRow').each((_i, el) => {
    try {
      const tierClass = $(el).find('[class*="-tier"]').attr('class') ?? '';
      const tierMatch = tierClass.match(/lp-([sabcd])-tier/i);
      if (!tierMatch) return;
      const tier = tierMatch[1].toUpperCase();
      if (!isTierAllowed(tier)) return;

      const nameLink = $(el).find('.divCell.Tournament a, td.Tournament a').first();
      const name = (nameLink.attr('title') ?? nameLink.text() ?? '').trim();
      const href = nameLink.attr('href') ?? '';
      if (!name || !href) return;

      const liquipediaUrl = href.startsWith('http')
        ? href.split('#')[0]
        : `https://liquipedia.net${href.split('#')[0]}`;

      // Dates — LP renders "Aug 14 - Aug 16, 2026" inside a Date cell
      const dateText = $(el).find('.divCell.Date, td.Date').text().trim();
      const { startDate, endDate } = parseLpDateRange(dateText);
      if (!startDate) return;

      // Skip events past + outside the planning horizon
      if (startDate.getTime() < now - 24 * 3600 * 1000) return;
      if (startDate.getTime() > now + horizonMs) return;

      const prizePool = $(el).find('.divCell.Prize, td.Prize').text().trim() || null;
      const region = $(el).find('.divCell.Location, td.Location').text().trim() || null;

      results.push({ name, tier, liquipediaUrl, startDate, endDate, prizePool, region });
    } catch {
      /* skip malformed rows */
    }
  });

  // Deduplicate on liquipediaUrl — Portal sometimes lists the same event
  // under both ongoing and upcoming accordions during transition windows.
  const seen = new Set<string>();
  const unique = results.filter((t) => {
    if (seen.has(t.liquipediaUrl)) return false;
    seen.add(t.liquipediaUrl);
    return true;
  });

  logger.info(`[LiquipediaTFT] Discovered ${unique.length} S/A-tier tournaments (raw rows: ${results.length})`);
  return unique;
}

/**
 * Parse strings like "Aug 14 - Aug 16, 2026" / "Jul 21 - 25, 2026" /
 * "Sep 2026". LP is reasonably consistent but year placement wanders, so
 * we normalise by always extracting trailing year and prepending it to
 * each side when missing.
 */
export function parseLpDateRange(s: string): { startDate: Date | null; endDate: Date | null } {
  if (!s) return { startDate: null, endDate: null };
  const yearMatch = s.match(/(\d{4})/);
  const year = yearMatch ? yearMatch[1] : String(new Date().getFullYear());
  const cleaned = s.replace(/(\d{4})/, '').replace(/[,–—]/g, '-').trim();
  const parts = cleaned.split('-').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { startDate: null, endDate: null };

  const buildDate = (token: string): Date | null => {
    if (!token) return null;
    // "Aug 14" → "Aug 14 2026"
    const withYear = /\d{4}/.test(token) ? token : `${token} ${year}`;
    const d = new Date(withYear);
    return isNaN(d.getTime()) ? null : d;
  };

  if (parts.length === 1) {
    const d = buildDate(parts[0]);
    return { startDate: d, endDate: d };
  }

  const start = buildDate(parts[0]);
  // Right-hand side may be just "16" (day only) — inherit the left month
  let endTok = parts[1];
  if (/^\d{1,2}$/.test(endTok) && start) {
    const monthMatch = parts[0].match(/([A-Za-z]{3,9})/);
    const month = monthMatch ? monthMatch[1] : null;
    if (month) endTok = `${month} ${endTok}`;
  }
  const end = buildDate(endTok);
  return { startDate: start, endDate: end };
}

// ── Per-tournament detail extraction ─────────────────────────────────────

export interface ScrapedParticipant {
  name: string;
  liquipediaSlug: string;
  country: string | null;
  /** Optional Riot ID (`gameName#tagLine`) when LP exposes it on the page. */
  riotId: string | null;
}

export interface ScrapedTournamentDetail {
  participants: ScrapedParticipant[];
  twitchChannel: string | null;
  competeTftUrl: string | null;
  /** When the bracket has started, late odds changes are frozen. */
  bracketStarted: boolean;
  /** Live standings if the LP page exposes a finished/in-progress bracket. */
  liveStandings: Array<{ liquipediaSlug: string; rank: number }>;
}

export async function fetchTournamentDetail(
  liquipediaUrl: string,
): Promise<ScrapedTournamentDetail | null> {
  const html = await fetchHtml(liquipediaUrl);
  if (!html) return null;
  const $ = cheerio.load(html);
  await sleep(800); // spread out across the LP rate budget

  // Twitch channel — first `twitch.tv/X` link not pointing at Liquipedia
  let twitchChannel: string | null = null;
  $('a[href*="twitch.tv/"]').each((_i, el) => {
    const href = $(el).attr('href') ?? '';
    const m = href.match(/twitch\.tv\/([a-zA-Z0-9_]+)/);
    if (m && m[1].toLowerCase() !== 'liquipedia') {
      twitchChannel = m[1];
      return false;
    }
  });

  // CompeteTFT link — Riot's official tournament page, drives live polling
  let competeTftUrl: string | null = null;
  $('a[href*="competetft.com"]').each((_i, el) => {
    const href = $(el).attr('href') ?? '';
    if (href && /competetft\.com\/[^"]+/i.test(href)) {
      competeTftUrl = href.split('#')[0];
      return false;
    }
  });

  // Bracket started signal — LP shows a "Status: Ongoing" / "Status: Finished"
  // row in the infobox. Anything other than "Upcoming" closes our market.
  let bracketStarted = false;
  $('.fo-nttax-infobox td, .infobox-cell-2').each((_i, el) => {
    const text = $(el).text().trim().toLowerCase();
    if (/^status[:\s]/i.test(text) && !/upcoming/i.test(text)) {
      bracketStarted = true;
      return false;
    }
  });

  // Participants — LP uses several patterns here. We try them in priority
  // order :
  //   1. `.teamcard` / `.opponent-block` (preferred — has explicit roster)
  //   2. `.participanttable` (table of players for solo events)
  //   3. raw player links inside `#mw-content-text` (worst-case fallback)
  const participants: ScrapedParticipant[] = [];
  const seenSlugs = new Set<string>();

  function pushParticipant(nameRaw: string, href: string, country: string | null, riotId: string | null) {
    const name = nameRaw.trim();
    if (!name) return;
    const slug = decodeURIComponent(href.replace(/^\/tft\//, '').split('?')[0]);
    if (!slug || seenSlugs.has(slug)) return;
    if (/^(tbd|tba|tbn|bye|n\/a)$/i.test(name)) return;
    seenSlugs.add(slug);
    participants.push({ name, liquipediaSlug: slug, country, riotId });
  }

  // Pattern 1 — participant cards
  $('.participantTable-entry, .teamcard .teamcard-inner').each((_i, el) => {
    const link = $(el).find('a').first();
    const name = (link.attr('title') ?? link.text() ?? '').trim();
    const href = link.attr('href') ?? '';
    if (!name || !href) return;
    const country = $(el).find('.flag img').first().attr('alt') ?? null;
    const riotIdHint = $(el).find('[class*="riot"]').text().trim();
    const riotId = riotIdHint && /[A-Za-z0-9]+#[A-Za-z0-9]+/.test(riotIdHint) ? riotIdHint : null;
    pushParticipant(name, href, country, riotId);
  });

  // Pattern 2 — participant table
  if (participants.length < 4) {
    $('.participanttable tr').each((_i, el) => {
      const link = $(el).find('td a').first();
      const name = (link.attr('title') ?? link.text() ?? '').trim();
      const href = link.attr('href') ?? '';
      if (!name || !href) return;
      const country = $(el).find('.flag img').first().attr('alt') ?? null;
      pushParticipant(name, href, country, null);
    });
  }

  // Live standings — if the page shows a finished bracket, LP renders the
  // ranking under `.placement` / `.bracket-result`. We parse it to feed
  // the settlement path.
  const liveStandings: ScrapedTournamentDetail['liveStandings'] = [];
  $('.placement-row, .bracket-standings tr').each((_i, el) => {
    const rankText = $(el).find('.placement-number, .rank').text().trim();
    const rank = parseInt(rankText, 10);
    const slugHref = $(el).find('a').first().attr('href') ?? '';
    if (!rank || !slugHref) return;
    const slug = decodeURIComponent(slugHref.replace(/^\/tft\//, '').split('?')[0]);
    if (slug && rank >= 1 && rank <= 64) liveStandings.push({ liquipediaSlug: slug, rank });
  });

  return { participants, twitchChannel, competeTftUrl, bracketStarted, liveStandings };
}

// ── Persist ──────────────────────────────────────────────────────────────

/**
 * Full scrape cycle : discover S/A tournaments → fetch detail for each →
 * upsert Tournament + Player + TournamentParticipant rows. Idempotent : a
 * second call with no new tournaments is a no-op except for participant
 * lists that have changed (e.g. wildcards added to the bracket).
 *
 * Odds are not computed here — that's tftOddsEngine's job, called from
 * cron after this scrape completes.
 */
export async function scrapeTftTournaments(): Promise<{ tournaments: number; participants: number }> {
  const startTime = Date.now();
  logger.info('[LiquipediaTFT] Starting TFT tournament scrape');

  const discovered = await discoverUpcomingTournaments();
  if (discovered.length === 0) {
    logger.info('[LiquipediaTFT] Discovery returned 0 tournaments — bailing out');
    return { tournaments: 0, participants: 0 };
  }

  let tournamentsSaved = 0;
  let participantsSaved = 0;

  for (const t of discovered) {
    try {
      // ── Upsert tournament shell ─────────────────────────────────────
      const tournament = await prisma.tournament.upsert({
        where: { liquipediaUrl: t.liquipediaUrl },
        create: {
          name: t.name,
          game: 'TFT',
          tier: t.tier,
          prizePool: t.prizePool,
          startDate: t.startDate,
          endDate: t.endDate,
          liquipediaUrl: t.liquipediaUrl,
          isActive: true,
        },
        update: {
          name: t.name,
          tier: t.tier,
          prizePool: t.prizePool,
          startDate: t.startDate,
          endDate: t.endDate,
          isActive: true,
        },
      });
      tournamentsSaved++;

      // ── Fetch detail (rate-limited via fetchHtml's LP infra) ────────
      await sleep(3000); // 3s between tournament page fetches — under LP's limiter
      const detail = await fetchTournamentDetail(t.liquipediaUrl);
      if (!detail) {
        logger.info(`[LiquipediaTFT] No detail for "${t.name}" — keeping shell, will retry next cycle`);
        continue;
      }

      // ── Patch tournament with metadata from detail ──────────────────
      await prisma.tournament.update({
        where: { id: tournament.id },
        data: {
          twitchChannel: detail.twitchChannel,
          competeTftUrl: detail.competeTftUrl,
          bracketStarted: detail.bracketStarted,
        },
      });

      // ── Upsert players + participants ───────────────────────────────
      for (const p of detail.participants) {
        const player = await prisma.player.upsert({
          where: { liquipediaSlug: p.liquipediaSlug },
          create: {
            name: p.name,
            liquipediaSlug: p.liquipediaSlug,
            country: p.country,
            game: 'TFT',
            elo: 1500, // baseline — replaced by Riot snapshot in tftOddsEngine
          },
          update: {
            // Conservative — only fill blanks, don't overwrite admin-set
            // values (country/avatar can be manually corrected in admin UI).
            country: p.country ?? undefined,
          },
          select: { id: true, name: true },
        });

        await prisma.tournamentParticipant.upsert({
          where: {
            tournamentId_playerId: { tournamentId: tournament.id, playerId: player.id },
          },
          create: {
            tournamentId: tournament.id,
            playerId: player.id,
            // Baseline odd : 1/N * margin — replaced by tftOddsEngine after
            // Riot stats are pulled. Using 0 would break the bet form.
            odds: 1 / Math.max(detail.participants.length, 1) * (1 - 0.08),
          },
          update: {}, // odds are recalculated by tftOddsEngine, not here
        });
        participantsSaved++;
      }

      logger.info(`[LiquipediaTFT] Saved "${t.name}" (${t.tier}-tier) — ${detail.participants.length} participants`);
    } catch (err) {
      logger.error(`[LiquipediaTFT] Failed on "${t.name}":`, err);
    }
  }

  await prisma.scraperLog.create({
    data: {
      source: 'liquipedia-tft',
      status: 'success',
      matchesFound: tournamentsSaved,
      duration: Date.now() - startTime,
    },
  }).catch(() => { /* scraperLog is best-effort */ });

  logger.info(`[LiquipediaTFT] Done: ${tournamentsSaved} tournaments, ${participantsSaved} participants saved`);
  return { tournaments: tournamentsSaved, participants: participantsSaved };
}

/**
 * Lighter-weight refresh of live standings only — called from cron every
 * 5 min while a tournament has `bracketStarted = true` AND
 * `liveSyncSource != 'competetft'`. CompeteTFT wins when present (faster
 * updates) ; this Liquipedia path is the fallback for tournaments without
 * a competeTftUrl, plus the source of truth for final settlement.
 */
export async function refreshLiveStandings(tournamentId: string): Promise<number> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { id: true, liquipediaUrl: true, bracketStarted: true, endDate: true },
  });
  if (!tournament?.liquipediaUrl) return 0;

  const detail = await fetchTournamentDetail(tournament.liquipediaUrl);
  if (!detail || detail.liveStandings.length === 0) return 0;

  // Map LP slugs back to our participant rows
  const slugs = detail.liveStandings.map((s) => s.liquipediaSlug);
  const players = await prisma.player.findMany({
    where: { liquipediaSlug: { in: slugs } },
    select: { id: true, liquipediaSlug: true },
  });
  const slugToPlayerId = new Map(players.map((p) => [p.liquipediaSlug, p.id]));

  let updated = 0;
  for (const s of detail.liveStandings) {
    const playerId = slugToPlayerId.get(s.liquipediaSlug);
    if (!playerId) continue;
    await prisma.tournamentParticipant.updateMany({
      where: { tournamentId: tournament.id, playerId },
      data: { currentRank: s.rank },
    });
    updated++;
  }

  await prisma.tournament.update({
    where: { id: tournament.id },
    data: { lastLiveSync: new Date(), liveSyncSource: 'liquipedia' },
  });

  logger.info(`[LiquipediaTFT] Refreshed standings for "${tournament.id}" — ${updated} ranks updated`);
  return updated;
}
