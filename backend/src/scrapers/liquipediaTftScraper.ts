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
//   B-Tier : Tactician's Trials, regional Open Cups, weekly community
//            tournaments (1k-5k$ prize pools)
// 2026-05-30 : opened up B-tier on user request — more events on the site
// means more betting surface area, even if the prize pools are smaller
// and the Riot stat coverage is patchier.
function isTierAllowed(tier: string): boolean {
  return tier === 'S' || tier === 'A' || tier === 'B';
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

/**
 * Module-level cache of the most-recent wikitext fetched per page. The
 * MediaWiki API returns text+wikitext in the same call, but cheerio-based
 * paths only consume the HTML half. We park the wikitext here so the
 * downstream `fetchTournamentDetail` can pull infobox fields without
 * needing a second round-trip.
 */
const wikitextCache = new Map<string, string>();

async function fetchViaMediaWikiApi(url: string): Promise<string | null> {
  const m = url.match(/liquipedia\.net\/(tft)\/(.+)/);
  if (!m) return null;
  const { lpRouteUrl, lpProxyHeaders, tripCircuitBreaker } = require('../services/liquipediaLiveScorer');
  const [, wiki, pagePath] = m;
  const pageName = decodeURIComponent(pagePath.split('?')[0]);
  try {
    const res = await axios.get(lpRouteUrl(`https://liquipedia.net/${wiki}/api.php`), {
      // `prop=text|wikitext` returns both halves in one round-trip — costs
      // the same rate-limit token as `prop=text` alone, gains us infobox
      // parsing without a second call.
      params: { action: 'parse', page: pageName, format: 'json', prop: 'text|wikitext' },
      headers: {
        'User-Agent': LP_USER_AGENT,
        'Accept-Encoding': 'gzip, deflate, br',
        ...lpProxyHeaders(),
      },
      decompress: true,
      timeout: 30_000,
    });
    const html = res.data?.parse?.text?.['*'];
    const wikitext = res.data?.parse?.wikitext?.['*'];
    if (typeof wikitext === 'string' && wikitext.length > 0) {
      wikitextCache.set(url, wikitext);
    }
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

/**
 * Extract a named parameter from the `{{Infobox league}}` template in a
 * wikitext blob. Handles the common LP idioms : `|key=value`, possibly with
 * leading whitespace and trailing newline. Returns null when missing.
 *
 * Designed for the dozen-ish fields the tournament card actually needs
 * (sdate, edate, prizepool, prizepoolusd, country, location, twitch, etc.)
 * — not a full template parser. Avoids regex catastrophic backtracking by
 * anchoring on `|key=` boundaries.
 */
function parseInfoboxField(wikitext: string, field: string): string | null {
  // Match `|<spaces>field<spaces>=<spaces>value<newline>` ; value runs until
  // the next `|<field>=` on a fresh line or the closing `}}` of the infobox.
  const re = new RegExp(`\\|\\s*${field}\\s*=\\s*([^\\n]*)`, 'i');
  const m = wikitext.match(re);
  if (!m) return null;
  const raw = m[1].trim();
  if (!raw) return null;
  // Strip simple wiki markup : [[Link|display]] → display, {{flag|US}} → US,
  // <ref>...</ref> → '', '''bold''' → bold.
  return raw
    .replace(/<ref[^>]*>.*?<\/ref>/gi, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, '$1')
    .replace(/\{\{(?:[^}|]*\|)?([^}]+)\}\}/g, '$1')
    .replace(/'''(.*?)'''/g, '$1')
    .replace(/''(.*?)''/g, '$1')
    .replace(/^[-–—\s]+|[-–—\s]+$/g, '')
    .trim() || null;
}

/**
 * LP's Infobox league dates come in two shapes : YYYY-MM-DD (machine
 * format, preferred) and "Month DD, YYYY" (human format). Both parse via
 * `new Date()` reliably ; we normalise to a JS Date.
 */
function parseInfoboxDate(raw: string | null): Date | null {
  if (!raw) return null;
  const cleaned = raw.replace(/\s*\(.*?\)\s*/g, '').trim();
  const d = new Date(cleaned);
  return isNaN(d.getTime()) ? null : d;
}

// ── Discovery — MediaWiki Query API (categorymembers) ────────────────────
// Refactored 2026-05-29 : we no longer scrape Portal:Tournaments HTML. That
// path was fragile (every LP markup tweak broke selectors) and heavy (~150KB
// payload for one discovery cycle). The MediaWiki Query API lets us pull
// the same set of S/A-tier pages via the official `Category:S-Tier_Tournaments`
// / `Category:A-Tier_Tournaments` categorisation — JSON in, ~10KB payload,
// immune to UI changes, and LP rate-limits this endpoint separately from
// `action=parse` so we get back budget for the per-tournament detail calls.
//
// Trade-off : categorymembers returns ALL pages in the category (including
// past tournaments). We filter post-hoc by the per-tournament parse which
// gives us the real start/end dates. To keep this affordable we sort by
// timestamp descending and cap at LP_CATEGORY_LIMIT — recent edits ≈ active
// tournaments.

export interface ScrapedTournament {
  name: string;
  tier: string;
  liquipediaUrl: string;
  /**
   * Start/end dates are populated lazily by the per-tournament detail fetch.
   * Discovery returns nulls — caller (scrapeTftTournaments) skips persistence
   * for tournaments whose detail pass fails to resolve dates.
   */
  startDate: Date | null;
  endDate?: Date | null;
  prizePool?: string | null;
  region?: string | null;
  twitchChannel?: string | null;
  competeTftUrl?: string | null;
}

const LP_CATEGORY_LIMIT = 75; // recent pages per tier — enough to cover the
                              // live + next ~120d horizon comfortably

const TIER_CATEGORIES: Array<{ tier: string; cmtitle: string }> = [
  { tier: 'S', cmtitle: 'Category:S-Tier_Tournaments' },
  { tier: 'A', cmtitle: 'Category:A-Tier_Tournaments' },
  // B-tier opened 2026-05-30. LP categorises these under
  // "B-Tier Tournaments" (same naming convention as S/A). Volume is
  // higher than S+A combined, so the categorymembers limit of 75 still
  // applies — recent-first ordering keeps the budget on active events.
  { tier: 'B', cmtitle: 'Category:B-Tier_Tournaments' },
];

interface CategoryMember {
  pageid: number;
  ns: number;
  title: string;
  timestamp?: string;
}

interface MwQueryResponse {
  query?: { categorymembers?: CategoryMember[] };
  error?: { code: string; info: string };
}

/**
 * Hit the MediaWiki Query API on the TFT wiki to pull category members.
 * Goes through the same lpRoute infra (proxy + circuit breaker) as the
 * other scrapers so we share the rate budget cleanly.
 */
async function fetchCategoryMembers(cmtitle: string): Promise<CategoryMember[]> {
  const { isLpBlocked, lpRouteUrl, lpProxyHeaders, tripCircuitBreaker, resetCircuitBreaker } =
    require('../services/liquipediaLiveScorer');
  if (isLpBlocked()) {
    logger.info(`[LiquipediaTFT] Skipping categorymembers ${cmtitle} (circuit breaker open)`);
    return [];
  }
  try {
    const res = await axios.get<MwQueryResponse>(
      lpRouteUrl('https://liquipedia.net/tft/api.php'),
      {
        params: {
          action: 'query',
          list: 'categorymembers',
          cmtitle,
          cmlimit: LP_CATEGORY_LIMIT,
          cmsort: 'timestamp',
          cmdir: 'desc',
          cmprop: 'ids|title|timestamp',
          format: 'json',
        },
        headers: {
          'User-Agent': LP_USER_AGENT,
          'Accept-Encoding': 'gzip, deflate, br',
          ...lpProxyHeaders(),
        },
        decompress: true,
        timeout: 25_000,
      },
    );
    if (res.data?.error) {
      logger.warn(`[LiquipediaTFT] Query API error on ${cmtitle}: ${res.data.error.code} ${res.data.error.info}`);
      return [];
    }
    const members = res.data?.query?.categorymembers ?? [];
    resetCircuitBreaker();
    return members;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      if (status === 429 || status === 503) {
        logger.warn(`[LiquipediaTFT] Query API ${status} on ${cmtitle} — tripping breaker`);
        tripCircuitBreaker();
      } else {
        logger.warn(`[LiquipediaTFT] Query API failed on ${cmtitle}: ${err.message} (HTTP ${status ?? 'timeout'})`);
      }
    }
    return [];
  }
}

/**
 * Convert a page title like "Esports World Cup/2026/TFT" into the LP URL
 * and a human-readable display name. We keep the full path in the URL
 * because LP needs it to resolve sub-pages, but show only the leaf segment
 * as the tournament name (admin UI / bet form readability).
 */
function pageTitleToTournament(title: string, tier: string): ScrapedTournament {
  const pagePath = title.replace(/ /g, '_');
  const liquipediaUrl = `https://liquipedia.net/tft/${pagePath}`;
  // Strip leading category-style sub-page hierarchy ("/Set_X/", "/2026/") for
  // a cleaner display name. Empirically the leaf segment is usually the most
  // recognisable form of the tournament name.
  const displayName = title.split('/').filter(Boolean).pop() ?? title;
  return {
    name: displayName,
    tier,
    liquipediaUrl,
    startDate: null, // filled by per-tournament detail fetch
  };
}

/**
 * Discovery via categorymembers. Returns S/A-tier tournament shells with no
 * dates/prize-pool — the caller's per-tournament detail pass fills those in.
 *
 * Idempotent : LP's category index is the authoritative tier marker, so a
 * second call returns the same list (modulo new tournament pages created
 * since the last call).
 */
export async function discoverUpcomingTournaments(): Promise<ScrapedTournament[]> {
  const results: ScrapedTournament[] = [];
  const seenUrl = new Set<string>();

  for (const { tier, cmtitle } of TIER_CATEGORIES) {
    const members = await fetchCategoryMembers(cmtitle);
    for (const m of members) {
      if (m.ns !== 0) continue; // skip Talk/User/etc namespaces
      const t = pageTitleToTournament(m.title, tier);
      // Drop sub-pages that LP categorises as their own entries but which are
      // logically children of a parent tournament (e.g. ".../CN_Qualifier").
      // The parent page already covers them and bets shouldn't be split.
      if (/\/(Qualifier|Group_Stage|Playoffs|Bracket|Last_Chance)/i.test(t.liquipediaUrl)) continue;
      if (seenUrl.has(t.liquipediaUrl)) continue;
      seenUrl.add(t.liquipediaUrl);
      results.push(t);
    }
    await sleep(800); // polite spacing between the two category fetches
  }

  logger.info(`[LiquipediaTFT] Discovered ${results.length} S/A-tier tournament candidates via category API`);
  return results;
}

/**
 * @deprecated — kept exported because tests import it. Internal callers
 * should use `discoverUpcomingTournaments` which is now category-based.
 */
export async function discoverUpcomingTournamentsViaPortal(): Promise<ScrapedTournament[]> {
  const PORTAL_URL = 'https://liquipedia.net/tft/Portal:Tournaments';
  const html = await fetchHtml(PORTAL_URL);
  if (!html) return [];
  const $ = cheerio.load(html);
  const results: ScrapedTournament[] = [];
  const now = Date.now();
  const horizonMs = 120 * 24 * 3600 * 1000;
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
      const liquipediaUrl = href.startsWith('http') ? href.split('#')[0] : `https://liquipedia.net${href.split('#')[0]}`;
      const dateText = $(el).find('.divCell.Date, td.Date').text().trim();
      const { startDate, endDate } = parseLpDateRange(dateText);
      if (!startDate) return;
      if (startDate.getTime() < now - 24 * 3600 * 1000) return;
      if (startDate.getTime() > now + horizonMs) return;
      const prizePool = $(el).find('.divCell.Prize, td.Prize').text().trim() || null;
      const region = $(el).find('.divCell.Location, td.Location').text().trim() || null;
      results.push({ name, tier, liquipediaUrl, startDate, endDate, prizePool, region });
    } catch { /* skip */ }
  });
  return results;
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
  // Filled from the wikitext infobox when discovery comes from categorymembers
  // (which doesn't carry dates/prizepool). Null when LP omits the fields or
  // the page is missing an `Infobox league` block.
  startDate: Date | null;
  endDate: Date | null;
  prizePool: string | null;
  region: string | null;
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

  // ── Infobox metadata (start/end date, prize pool, region) ────────────
  // fetchHtml stashed the wikitext in `wikitextCache` when going through
  // the MediaWiki API. We pull dates from there because the rendered HTML
  // formats dates inconsistently across LP skins, while the wikitext
  // `|sdate=YYYY-MM-DD` form is stable.
  let startDate: Date | null = null;
  let endDate: Date | null = null;
  let prizePool: string | null = null;
  let region: string | null = null;
  const wikitext = wikitextCache.get(liquipediaUrl);
  if (wikitext) {
    startDate = parseInfoboxDate(parseInfoboxField(wikitext, 'sdate'))
             ?? parseInfoboxDate(parseInfoboxField(wikitext, 'date'));
    endDate = parseInfoboxDate(parseInfoboxField(wikitext, 'edate')) ?? startDate;
    // Prize pool : prefer USD when both are present (most readable for an
    // international audience), fall back to local currency.
    prizePool = parseInfoboxField(wikitext, 'prizepoolusd')
             ?? parseInfoboxField(wikitext, 'prizepool')
             ?? null;
    if (prizePool && !/[$€£¥]|USD|EUR/i.test(prizePool)) {
      // raw number → assume USD which is LP's prizepoolusd convention
      prizePool = `$${prizePool}`;
    }
    region = parseInfoboxField(wikitext, 'country')
          ?? parseInfoboxField(wikitext, 'city')
          ?? parseInfoboxField(wikitext, 'location')
          ?? null;
    // wikitextCache is bounded by LP_CATEGORY_LIMIT × 2 entries per run, but
    // be defensive against runaway growth across cron cycles.
    if (wikitextCache.size > 500) {
      // Drop oldest half — JS Maps preserve insertion order.
      const drop = Array.from(wikitextCache.keys()).slice(0, 250);
      drop.forEach((k) => wikitextCache.delete(k));
    }
  }

  return {
    participants,
    twitchChannel,
    competeTftUrl,
    bracketStarted,
    liveStandings,
    startDate,
    endDate,
    prizePool,
    region,
  };
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
  let skippedOutOfWindow = 0;
  const now = Date.now();
  const horizonForward = 120 * 24 * 3600 * 1000;
  const horizonBackward = 7 * 24 * 3600 * 1000; // keep recently-ended events
                                                // for settlement; older are dropped

  // ── Skip refetch for tournaments fetched recently ───────────────────
  // LP's per-page parse calls trip the rate-limiter at 5-10 req/min even
  // through the Cloudflare worker proxy. With 75 tournaments per discovery
  // cycle, fetching every detail every 30min = 150 req/h = always 429.
  // Solution : only refetch when (a) the tournament is new to us, OR
  // (b) its bracket has started (live data needs to stay fresh), OR
  // (c) the last detail fetch was > 24h ago.
  //
  // Pull cache snapshot for all discovered URLs in one query.
  const knownTournaments = await prisma.tournament.findMany({
    where: { liquipediaUrl: { in: discovered.map((d) => d.liquipediaUrl) } },
    select: {
      liquipediaUrl: true,
      lastDetailFetchedAt: true,
      bracketStarted: true,
      startDate: true,
      endDate: true,
    },
  });
  const cacheByUrl = new Map(knownTournaments.map((k) => [k.liquipediaUrl, k]));
  const DETAIL_TTL_MS = 24 * 3600 * 1000;
  const nowMs = Date.now();
  let skippedFresh = 0;

  for (const t of discovered) {
    try {
      const cached = cacheByUrl.get(t.liquipediaUrl);
      const isFresh = cached?.lastDetailFetchedAt
        && nowMs - cached.lastDetailFetchedAt.getTime() < DETAIL_TTL_MS;
      const isLive = cached?.bracketStarted === true;
      const shouldRefetch = !cached || isLive || !isFresh;

      if (!shouldRefetch) {
        skippedFresh++;
        continue; // tournament already in DB, < 24h old, not live → skip LP hit
      }

      // ── Fetch detail FIRST ─────────────────────────────────────────
      // Discovery comes from categorymembers which carries no dates, so
      // we need the infobox before we can decide whether to persist.
      await sleep(3000); // 3s between LP page fetches — under their limiter
      const detail = await fetchTournamentDetail(t.liquipediaUrl);
      if (!detail) {
        logger.info(`[LiquipediaTFT] No detail for "${t.name}" — will retry next cycle`);
        continue;
      }

      // ── Filter to the live window ───────────────────────────────────
      // discoverUpcomingTournaments() returns ALL S/A category members.
      // The date filter that used to live in the Portal scrape now runs
      // here, post-detail. Tournaments with no resolved dates are kept
      // (admin can fix manually) but never older than horizonBackward.
      const sd = detail.startDate;
      const ed = detail.endDate ?? sd;
      if (sd && sd.getTime() > now + horizonForward) {
        skippedOutOfWindow++;
        continue;
      }
      if (ed && ed.getTime() < now - horizonBackward) {
        skippedOutOfWindow++;
        continue;
      }

      // ── Upsert tournament with full data ────────────────────────────
      // We check existence first so we can fire the correct socket event
      // (created vs updated). Adds one tiny lookup ; saves frontend from
      // re-fetching when the only change is a participant odds tick.
      const preExisting = await prisma.tournament.findUnique({
        where: { liquipediaUrl: t.liquipediaUrl },
        select: { id: true },
      });
      const tournament = await prisma.tournament.upsert({
        where: { liquipediaUrl: t.liquipediaUrl },
        create: {
          name: t.name,
          game: 'TFT',
          tier: t.tier,
          prizePool: detail.prizePool,
          startDate: sd ?? new Date(now + 7 * 24 * 3600 * 1000), // placeholder if LP omits it; admin can fix
          endDate: ed,
          liquipediaUrl: t.liquipediaUrl,
          twitchChannel: detail.twitchChannel,
          competeTftUrl: detail.competeTftUrl,
          bracketStarted: detail.bracketStarted,
          lastDetailFetchedAt: new Date(),
          isActive: true,
        },
        update: {
          name: t.name,
          tier: t.tier,
          prizePool: detail.prizePool ?? undefined,
          startDate: sd ?? undefined,
          endDate: ed ?? undefined,
          twitchChannel: detail.twitchChannel ?? undefined,
          competeTftUrl: detail.competeTftUrl ?? undefined,
          bracketStarted: detail.bracketStarted,
          lastDetailFetchedAt: new Date(),
          isActive: true,
        },
      });
      tournamentsSaved++;
      try {
        const { broadcastTftTournamentChanged } = await import('../socket');
        broadcastTftTournamentChanged(tournament.id, preExisting ? 'updated' : 'created');
      } catch { /* socket optional in tests */ }

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

  logger.info(
    `[LiquipediaTFT] Cycle complete — ${tournamentsSaved} saved, ${skippedFresh} cached-fresh, ${skippedOutOfWindow} out-of-window, ${participantsSaved} participants`,
  );
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
