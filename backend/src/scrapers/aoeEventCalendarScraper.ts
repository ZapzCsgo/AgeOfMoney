/**
 * Age of Empires Official Event Calendar Scraper
 *
 * Fetches all upcoming esports events from https://www.ageofempires.com/eventscalendar/
 * via the WordPress admin-ajax.php endpoint used by the page itself.
 *
 * Returns events for ALL AoE games (age2, age3, age4, ageM, etc.)
 * tagged with their game type. The Liquipedia scraper then finds individual
 * matches within these tournaments.
 *
 * Game codes from the API:
 *   age4 → AoE4 | age2 → AoE2 | age3 → AoE3 | ageM → AoM | age1 → AoE1
 */

import axios from 'axios';
import { prisma } from '../index';
import logger from '../logger';

const CALENDAR_URL = 'https://www.ageofempires.com/eventscalendar/';
const AJAX_URL     = 'https://www.ageofempires.com/wp-admin/admin-ajax.php';

// Map AoE calendar game codes to our internal game names
const GAME_MAP: Record<string, string> = {
  age4: 'AoE4',
  age2: 'AoE2',
  age3: 'AoE3',
  ageM: 'AoM',   // Age of Mythology
  age1: 'AoE1',
  aoe:  'AoE4',  // fallback
};

interface AoeCalendarEvent {
  id: number;
  title: string;
  game: string;       // "age4", "age2", etc.
  eventType: string;  // "esports", "community", etc.
  formats: string;    // "1v1", "team", etc.
  permalink: string;  // slug for the event page
  start: string;      // "YYYY-MM-DD HH:mm:ss"
  end: string;
}

/** Fetch nonce from the calendar page HTML */
async function fetchNonce(): Promise<string | null> {
  const res = await axios.get<string>(CALENDAR_URL, {
    headers: { 'User-Agent': 'AgeOfMoney/1.0 (contact@ageofmoney.com)', Accept: 'text/html' },
    timeout: 15000,
  });
  const match = res.data.match(/nonce="([a-f0-9]+)"/);
  return match?.[1] ?? null;
}

/** POST to admin-ajax.php with the nonce to get all events */
async function fetchEvents(nonce: string): Promise<AoeCalendarEvent[]> {
  const res = await axios.post<AoeCalendarEvent[]>(
    AJAX_URL,
    `action=getEvents&nonce=${nonce}`,
    {
      headers: {
        'User-Agent': 'AgeOfMoney/1.0 (contact@ageofmoney.com)',
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: CALENDAR_URL,
      },
      timeout: 15000,
    }
  );
  return Array.isArray(res.data) ? res.data : [];
}

/**
 * Sync the AoE events calendar into our Tournament table.
 * Creates/updates tournaments with their game type.
 * Filters to esports events only (skips community/content events).
 * Returns list of upserted tournaments with game info.
 */
export async function syncAoeEventCalendar(): Promise<{ name: string; game: string; id: string }[]> {
  logger.info('[AoeCalendar] Fetching events from ageofempires.com...');

  const nonce = await fetchNonce();
  if (!nonce) {
    logger.warn('[AoeCalendar] Could not extract nonce from page');
    return [];
  }

  const events = await fetchEvents(nonce);
  logger.info(`[AoeCalendar] Got ${events.length} total events`);

  const now = new Date();
  const twoMonthsFromNow = new Date(Date.now() + 60 * 24 * 3600 * 1000);

  // Filter: esports only, currently ongoing or starting within 2 months, 1v1 format
  const relevant = events.filter(e => {
    const end = new Date(e.end);
    const start = new Date(e.start);
    return (
      e.eventType === 'esports' &&
      end >= now &&
      start <= twoMonthsFromNow
    );
  });

  logger.info(`[AoeCalendar] ${relevant.length} relevant esports events (ongoing/upcoming within 2 months)`);

  const synced: { name: string; game: string; id: string }[] = [];

  const normalizeName = (n: string) =>
    n.toLowerCase()
      .replace(/\s*(age of empires|aoe)\s*(iv|ii|iii|[1-4]|mythology|retold)[\s:]*/gi, ' ')
      .replace(/\s*-\s*(playoffs?|group\s*[a-z]?|qualifiers?|round\s*\d+|season\s*\d+).*$/i, '')
      .replace(/\s+/g, ' ').trim();

  for (const event of relevant) {
    const game = GAME_MAP[event.game] ?? 'AoE4';
    const tier = guessTier(event.title, game);

    try {
      // No URL minting. AoE calendar permalinks don't always map to real
      // Liquipedia slugs (e.g. "membtv-warlords-v-showmatch-2" → the guessed
      // `.../ageofempires2/membtv_warlords_v_showmatch_2` 404s; the real LP
      // page is `MembTV_Warlords_V/Showmatch/2` or `Warlords_V/...`). Storing
      // a bogus URL kept the live scorer stuck 404-ing forever.
      //
      // Source of truth for liquipediaUrl is liquipediaScraper.ts (reads the
      // real href from the LP upcoming-matches widget). The AoE calendar only
      // announces events — it enriches an existing Tournament row, and if
      // none exists it creates one with `liquipediaUrl=null`, which the LP
      // scraper later backfills via its name-based dedup path.
      const myNorm = normalizeName(event.title);
      const candidates = await prisma.tournament.findMany({
        where: {
          game,
          startDate: { gte: new Date(Date.now() - 90 * 24 * 3600 * 1000) },
        },
        select: { id: true, name: true, liquipediaUrl: true },
      });
      const realRecord = candidates.find((c) => {
        const eNorm = normalizeName(c.name);
        return myNorm === eNorm || myNorm.startsWith(eNorm) || eNorm.startsWith(myNorm);
      });

      if (realRecord) {
        // Enrich existing tournament (created by LP scraper with the real URL,
        // or by an earlier calendar pass). NEVER touch `game` — LP infobox
        // probe is authoritative and cross-game events lie in the calendar.
        const tourn = await prisma.tournament.update({
          where: { id: realRecord.id },
          data: { tier, isActive: true, startDate: new Date(event.start), endDate: new Date(event.end) },
        });
        synced.push({ name: event.title, game, id: tourn.id });
      } else {
        // Fresh event with no LP counterpart yet — create with URL = null and
        // let the LP scraper backfill when it federates the bracket.
        const tourn = await prisma.tournament.create({
          data: {
            name: event.title,
            game,
            tier,
            liquipediaUrl: null,
            startDate: new Date(event.start),
            endDate: new Date(event.end),
            isActive: true,
          },
        });
        synced.push({ name: event.title, game, id: tourn.id });
      }
    } catch (err) {
      logger.warn(`[AoeCalendar] Failed to upsert tournament "${event.title}": ${err}`);
    }
  }

  logger.info(`[AoeCalendar] Synced ${synced.length} tournaments`);

  // ── Match-game self-healing ───────────────────────────────────────────────
  // Align match.game with their tournament.game. This is safe — tournament.game
  // is the source of truth, and the URL-based "self-healing" that used to
  // overwrite tournament.game from the URL prefix has been removed (it was
  // wrong for cross-wiki tournaments and undid every manual fix).
  const mismatched = await prisma.match.findMany({
    where: { tournament: { isNot: null } },
    select: { id: true, game: true, tournament: { select: { game: true } } },
  });
  let fixedMatches = 0;
  for (const m of mismatched) {
    const tg = m.tournament?.game;
    if (tg && tg !== m.game) {
      await prisma.match.update({ where: { id: m.id }, data: { game: tg } });
      fixedMatches++;
    }
  }
  if (fixedMatches > 0) logger.info(`[AoeCalendar] Aligned ${fixedMatches} matches with their tournament.game`);

  return synced;
}

/**
 * Provisional tier from event name — used only until the Liquipedia scraper
 * fetches the real tier from the tournament page infobox.
 */
function guessTier(name: string, _game: string): string {
  // VERY conservative — only flag tournaments that are unambiguously top-tier S.
  // Everything else falls to 'C' so it gets filtered out of the S/A-only UI;
  // the real tier (and any genuine A-tier upgrades) come from the Liquipedia
  // infobox via fetchTournamentInfo() during the persist step.
  const n = name.toLowerCase();
  if (n.includes('red bull') || n.includes('wololo') || n.includes('world championship') ||
      n.includes('hidden cup') || n.includes('warlords') || n.includes('t90')) return 'S';
  return 'C';
}
