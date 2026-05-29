/**
 * CompeteTFT live standings scraper.
 *
 * Riot's official TFT tournament platform (competetft.com) renders brackets
 * and live standings, but exposes no public API. We poll the HTML during
 * the LIVE window only — typically a 2-4 hour burst per tournament — and
 * surface the parsed standings to the settlement path.
 *
 * Design constraints :
 *
 * - HTML structure is React-rendered SPA, but Next.js leaks the page data
 *   via `__NEXT_DATA__` (or a `_next/data/{buildId}/...json` endpoint when
 *   accessed with the right Accept header). We try the JSON path first
 *   because it's stable across css/markup changes.
 *
 * - Poll cadence is aggressive (30s) because we're trying to outpace LP
 *   community editors. To stay polite we limit to ONE in-flight request
 *   per tournament and bail out the moment Tournament.bracketStarted=false.
 *
 * - CompeteTFT may rate-limit anonymous IPs ; we backoff for 10 min on a
 *   429 or 503 and log it. No 2captcha integration here — if Riot blocks
 *   us we just fall back to Liquipedia.
 *
 * - When CompeteTFT data is missing for a participant (the typical case
 *   when a player gets eliminated mid-tournament and disappears from the
 *   "live" view), we DON'T null out their currentRank — we leave it at
 *   the last known value. The settlement pass at end-of-tournament uses
 *   finalRank which is set from a different code path.
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import { prisma } from '../index';
import logger from '../logger';

const COMPETETFT_UA = 'TftMoneyBot/1.0 (https://tft.money; contact@tft.money)';

// ── Backoff state ─────────────────────────────────────────────────────────
// Cheap module-level circuit breaker — if CompeteTFT 429s us, we trip and
// stop polling for COMPETETFT_BACKOFF_MS. Distinct from the LP breaker so
// a CompeteTFT block doesn't disable Liquipedia scraping.
let blockedUntil = 0;
const COMPETETFT_BACKOFF_MS = 10 * 60 * 1000;

function isBlocked(): boolean {
  return Date.now() < blockedUntil;
}

function trip(reason: string): void {
  blockedUntil = Date.now() + COMPETETFT_BACKOFF_MS;
  logger.warn(`[CompeteTFT] Backing off for 10min — ${reason}. Liquipedia fallback will take over.`);
}

// ── Public types ─────────────────────────────────────────────────────────

export interface CompeteTftStanding {
  /**
   * The display name CompeteTFT shows. Usually matches the Liquipedia
   * player name but normalisation may be needed. Caller resolves this to
   * a Player row via name or riotId.
   */
  displayName: string;
  /** Riot ID `gameName#tagLine` when CompeteTFT exposes it. */
  riotId: string | null;
  /** 1-based live rank in the tournament. */
  rank: number;
  /** Cumulative points (TFT scores placements 1-8 = 8-1 pts). */
  points?: number;
}

// ── Fetch ────────────────────────────────────────────────────────────────

async function fetchCompeteTftHtml(url: string): Promise<string | null> {
  if (isBlocked()) {
    logger.info(`[CompeteTFT] Skipping fetch (backoff active until ${new Date(blockedUntil).toISOString()})`);
    return null;
  }
  try {
    const res = await axios.get<string>(url, {
      headers: {
        'User-Agent': COMPETETFT_UA,
        Accept: 'text/html,application/xhtml+xml,*/*',
        'Accept-Encoding': 'gzip, deflate, br',
      },
      decompress: true,
      timeout: 20_000,
    });
    return res.data;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      if (status === 429 || status === 503) {
        trip(`HTTP ${status}`);
        return null;
      }
      if (status === 403) {
        trip('403 (likely Cloudflare bot challenge)');
        return null;
      }
      logger.warn(`[CompeteTFT] Fetch failed for ${url}: ${err.message} (HTTP ${status ?? 'timeout'})`);
    }
    return null;
  }
}

// ── Parse __NEXT_DATA__ blob ─────────────────────────────────────────────

interface NextDataShape {
  props?: {
    pageProps?: {
      tournament?: {
        standings?: Array<{
          rank: number;
          summonerName?: string;
          riotId?: string;
          points?: number;
        }>;
        bracket?: unknown;
      };
      // Some routes nest under tournamentData / liveData — try both
      tournamentData?: {
        standings?: Array<{ rank: number; player?: { displayName?: string; riotId?: string }; points?: number }>;
      };
    };
  };
}

/**
 * Extract __NEXT_DATA__ JSON from the HTML and walk it for the standings
 * array. Shape is brittle — we accept multiple paths and silently fall
 * back to HTML parsing if none match.
 */
function parseNextData(html: string): CompeteTftStanding[] {
  const m = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]+?)<\/script>/);
  if (!m) return [];
  try {
    const json = JSON.parse(m[1]) as NextDataShape;
    const tournamentStandings = json.props?.pageProps?.tournament?.standings;
    if (Array.isArray(tournamentStandings) && tournamentStandings.length > 0) {
      return tournamentStandings
        .filter((s) => s && typeof s.rank === 'number')
        .map((s) => ({
          displayName: s.summonerName ?? s.riotId?.split('#')[0] ?? '',
          riotId: s.riotId ?? null,
          rank: s.rank,
          points: s.points,
        }))
        .filter((s) => s.displayName);
    }
    const altStandings = json.props?.pageProps?.tournamentData?.standings;
    if (Array.isArray(altStandings) && altStandings.length > 0) {
      return altStandings
        .filter((s) => s && typeof s.rank === 'number')
        .map((s) => ({
          displayName: s.player?.displayName ?? '',
          riotId: s.player?.riotId ?? null,
          rank: s.rank,
          points: s.points,
        }))
        .filter((s) => s.displayName);
    }
  } catch {
    /* malformed JSON — fall through to HTML parsing */
  }
  return [];
}

/**
 * HTML fallback — when __NEXT_DATA__ doesn't include the standings (some
 * pages stream them post-hydration), we parse the DOM directly. Brittle ;
 * expect this to break with every CompeteTFT redesign.
 */
function parseStandingsHtml(html: string): CompeteTftStanding[] {
  const $ = cheerio.load(html);
  const results: CompeteTftStanding[] = [];
  $('[data-testid="standings-row"], .standings-row, tr.player-row').each((_i, el) => {
    const rankText = $(el).find('[data-testid="rank"], .rank, td:first-child').text().trim();
    const rank = parseInt(rankText, 10);
    if (!rank) return;
    const nameEl = $(el).find('[data-testid="player-name"], .player-name, .name').first();
    const displayName = nameEl.text().trim();
    if (!displayName) return;
    const riotIdAttr = nameEl.attr('data-riot-id') ?? null;
    const pointsText = $(el).find('[data-testid="points"], .points').text().trim();
    const points = parseInt(pointsText, 10) || undefined;
    results.push({ displayName, riotId: riotIdAttr, rank, points });
  });
  return results;
}

export async function fetchLiveStandings(competeTftUrl: string): Promise<CompeteTftStanding[]> {
  const html = await fetchCompeteTftHtml(competeTftUrl);
  if (!html) return [];
  // Try Next data first — survives markup changes
  const fromData = parseNextData(html);
  if (fromData.length > 0) {
    logger.info(`[CompeteTFT] Parsed ${fromData.length} standings from __NEXT_DATA__ (${competeTftUrl})`);
    return fromData;
  }
  const fromHtml = parseStandingsHtml(html);
  if (fromHtml.length > 0) {
    logger.info(`[CompeteTFT] Parsed ${fromHtml.length} standings from HTML fallback (${competeTftUrl})`);
  } else {
    logger.warn(`[CompeteTFT] No standings parsed (${competeTftUrl}) — page structure may have changed`);
  }
  return fromHtml;
}

// ── Persist into TournamentParticipant.currentRank ───────────────────────

/**
 * Resolve a CompeteTFT standing to a TournamentParticipant row. We match
 * on (a) riotId → player.riotPuuid via account lookup when the field is
 * known, (b) player.name (case-insensitive) as a fallback. Returns null
 * when neither path identifies the player.
 */
async function resolveParticipantId(
  tournamentId: string,
  s: CompeteTftStanding,
): Promise<string | null> {
  // riotId is the strongest signal — match on player.riotPuuid via the
  // Riot account API. We only do this opportunistically because we don't
  // want to spend the Riot quota inside the live scoring loop. Cached
  // playerId is fine.
  if (s.riotId && s.riotId.includes('#')) {
    const [gameName, tagLine] = s.riotId.split('#');
    const player = await prisma.player.findFirst({
      where: {
        OR: [
          { name: { equals: gameName, mode: 'insensitive' } },
          { liquipediaSlug: { contains: gameName, mode: 'insensitive' } },
        ],
        game: 'TFT',
      },
      select: { id: true },
    });
    if (player) {
      const participant = await prisma.tournamentParticipant.findUnique({
        where: { tournamentId_playerId: { tournamentId, playerId: player.id } },
        select: { id: true },
      });
      if (participant) return participant.id;
    }
    void tagLine; // not used yet — placeholder for future Riot account → puuid lookup
  }

  // Fallback : exact display name match
  const player = await prisma.player.findFirst({
    where: { name: { equals: s.displayName, mode: 'insensitive' }, game: 'TFT' },
    select: { id: true },
  });
  if (!player) return null;
  const participant = await prisma.tournamentParticipant.findUnique({
    where: { tournamentId_playerId: { tournamentId, playerId: player.id } },
    select: { id: true },
  });
  return participant?.id ?? null;
}

/**
 * Update live standings for one tournament. Called from the cron poller
 * every 30s while the tournament is `bracketStarted = true`.
 */
export async function refreshLiveStandingsFromCompeteTft(tournamentId: string): Promise<number> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { id: true, competeTftUrl: true, bracketStarted: true, endDate: true },
  });
  if (!tournament || !tournament.competeTftUrl) return 0;
  // Settled tournaments don't need live updates — settlement runs its own path
  if (tournament.endDate && tournament.endDate.getTime() < Date.now() - 12 * 3600 * 1000) return 0;

  const standings = await fetchLiveStandings(tournament.competeTftUrl);
  if (standings.length === 0) return 0;

  let updated = 0;
  for (const s of standings) {
    const participantId = await resolveParticipantId(tournament.id, s);
    if (!participantId) continue;
    await prisma.tournamentParticipant.update({
      where: { id: participantId },
      data: { currentRank: s.rank },
    });
    updated++;
  }
  await prisma.tournament.update({
    where: { id: tournament.id },
    data: { lastLiveSync: new Date(), liveSyncSource: 'competetft' },
  });
  logger.info(`[CompeteTFT] ${tournament.id}: updated ${updated}/${standings.length} ranks`);
  return updated;
}

/**
 * Cron entry — finds tournaments with bracketStarted=true AND a
 * competeTftUrl, refreshes each. Skipped if backoff is active.
 */
export async function pollAllLiveTftTournaments(): Promise<void> {
  if (isBlocked()) return;
  const tournaments = await prisma.tournament.findMany({
    where: {
      game: 'TFT',
      bracketStarted: true,
      competeTftUrl: { not: null },
      // Active window : from 1h before start to 12h after endDate
      OR: [
        { endDate: null },
        { endDate: { gt: new Date(Date.now() - 12 * 3600 * 1000) } },
      ],
    },
    select: { id: true },
    take: 8, // safety cap — we shouldn't have 8+ S/A TFT tournaments running concurrently
  });
  for (const t of tournaments) {
    await refreshLiveStandingsFromCompeteTft(t.id);
  }
}
