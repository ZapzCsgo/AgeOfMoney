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

  for (const event of relevant) {
    const game = GAME_MAP[event.game] ?? 'AoE4';
    const liquipediaSlug = LIQUIPEDIA_GAME_SLUG[game] ?? 'ageofempires';
    const liquipediaUrl  = `https://liquipedia.net/${liquipediaSlug}/${event.permalink
      .split('/').pop()?.replace(/-/g, '_') ?? event.permalink}`;

    const tier = guessTier(event.title, game);

    try {
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

  return synced;
}

function guessTier(name: string, game: string): string {
  const n = name.toLowerCase();
  if (n.includes('red bull') || n.includes('wololo') || n.includes('world championship') || n.includes('masters')) return 'S';
  if (n.includes('quarterly') || n.includes('invitational') || n.includes('wtl') ||
      n.includes('golden league') || n.includes('king of the desert') || n.includes('holy series') ||
      n.includes('over the top') || n.includes('titans')) return 'A';
  if (n.includes('cup') || n.includes('league') || n.includes('road to') || n.includes('homestead')) return 'B';
  return 'C';
}
