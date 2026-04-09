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

// Map AoE game names to Liquipedia wiki game slugs (for building Liquipedia URLs)
export const LIQUIPEDIA_GAME_SLUG: Record<string, string> = {
  AoE4: 'ageofempires',
  AoE2: 'ageofempires2',
  AoE3: 'ageofempires3',
  AoM:  'ageofmythology',
  AoE1: 'ageofempires',
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
    const liquipediaSlug = LIQUIPEDIA_GAME_SLUG[game] ?? 'ageofempires';
    // Construct a best-guess Liquipedia URL from the AoE calendar permalink
    const liquipediaUrl  = `https://liquipedia.net/${liquipediaSlug}/${event.permalink
      .split('/').pop()?.replace(/-/g, '_') ?? event.permalink}`;

    const tier = guessTier(event.title, game);

    try {
      // Before upserting with our guessed URL, check if the Liquipedia scraper already
      // created this tournament with its real URL. If so, just update that record.
      const myNorm = normalizeName(event.title);
      const existing = await prisma.tournament.findFirst({
        where: {
          game,
          NOT: { liquipediaUrl },
          startDate: { gte: new Date(Date.now() - 90 * 24 * 3600 * 1000) },
        },
        select: { id: true, name: true, liquipediaUrl: true },
      });
      const realRecord = existing && (() => {
        const eNorm = normalizeName(existing.name);
        return myNorm === eNorm || myNorm.startsWith(eNorm) || eNorm.startsWith(myNorm) ? existing : null;
      })();

      if (realRecord) {
        // The Liquipedia scraper already has the real URL — just update dates/tier
        const tourn = await prisma.tournament.update({
          where: { id: realRecord.id },
          data: { tier, isActive: true, startDate: new Date(event.start), endDate: new Date(event.end) },
        });
        synced.push({ name: event.title, game, id: tourn.id });
      } else {
        const tourn = await prisma.tournament.upsert({
          where: { liquipediaUrl },
          update: {
            name: event.title,
            game,
            tier,
            isActive: true,
            startDate: new Date(event.start),
            endDate: new Date(event.end),
          },
          create: {
            name: event.title,
            game,
            tier,
            liquipediaUrl,
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

  // Self-healing: fix any tournaments whose game field doesn't match their Liquipedia URL
  const urlToGame = (url: string): string => {
    if (url.includes('/ageofempires2/'))  return 'AoE2';
    if (url.includes('/ageofempires3/'))  return 'AoE3';
    if (url.includes('/ageofmythology/')) return 'AoM';
    return 'AoE4';
  };
  const allTournaments = await prisma.tournament.findMany({ select: { id: true, liquipediaUrl: true, game: true } });
  let fixed = 0;
  for (const t of allTournaments) {
    const correct = urlToGame(t.liquipediaUrl);
    if (t.game !== correct) {
      await prisma.tournament.update({ where: { id: t.id }, data: { game: correct } });
      fixed++;
    }
  }
  if (fixed > 0) logger.info(`[AoeCalendar] Fixed game field for ${fixed} tournaments`);

  // Self-healing: align match.game with their tournament.game
  // (old matches were created with the schema default 'AoE4')
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
  if (fixedMatches > 0) logger.info(`[AoeCalendar] Fixed game field for ${fixedMatches} matches`);

  return synced;
}

/**
 * Provisional tier from event name — used only until the Liquipedia scraper
 * fetches the real tier from the tournament page infobox.
 */
function guessTier(name: string, _game: string): string {
  const n = name.toLowerCase();
  if (n.includes('red bull') || n.includes('wololo') || n.includes('world championship') ||
      n.includes('masters') || n.includes('hidden cup') || n.includes('warlords') || n.includes('t90')) return 'S';
  if (n.includes('quarterly') || n.includes('invitational') || n.includes('wtl') ||
      n.includes('world team league') || n.includes('golden league') || n.includes('king of the desert') ||
      n.includes('holy series') || n.includes('over the top') || n.includes('titans') ||
      n.includes('mythic clan') || n.includes('nations cup') || n.includes('global series') ||
      n.includes('pro league') || n.includes('championship')) return 'A';
  if (n.includes('cup') || n.includes('league') || n.includes('road to') || n.includes('homestead') || n.includes('series')) return 'B';
  return 'C';
}
