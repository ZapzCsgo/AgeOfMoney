/**
 * Liquipedia Live Score Poller
 *
 * Parses the wikitext of the active tournament page on Liquipedia every 60s.
 * For each LIVE match in our DB that has a liquipediaUrl, it finds the matching
 * Match block, counts map winners, and updates p1Score / p2Score in real-time.
 *
 * Liquipedia is updated manually by community editors during matches — typically
 * within seconds/minutes of each game ending, making it the most reliable free
 * source for tournament BO scores.
 */

import axios from 'axios';
import zlib from 'zlib';
import { promisify } from 'util';
import Bottleneck from 'bottleneck';
import { prisma } from '../index';
import { getIo } from '../socket';
import { distributePayout } from './betService';
import logger from '../logger';

const gunzip = promisify(zlib.gunzip);

const LP_API = 'https://liquipedia.net/ageofempires/api.php';
const HEADERS = {
  'User-Agent': 'AgeOfMoney/1.0 (contact@ageofmoney.com)',
  'Accept-Encoding': 'gzip', // Liquipedia REQUIRES gzip (406 otherwise)
};

// Cache wikitext per page — serves all concurrent match checks from same page
const wikiCache: Record<string, { text: string; fetchedAt: number }> = {};
const CACHE_TTL = 4_000; // 4s — reuse only within a single poll burst (interval is 5s)

// Bottleneck limiter: 1 request at a time, 2s between each, max 25/min
// At 5s interval with cache, same-page matches share one fetch so real rate stays low
const lpLimiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 2000,           // minimum 2s between requests regardless of cache
  reservoir: 25,           // max 25 requests per refill period
  reservoirRefreshAmount: 25,
  reservoirRefreshInterval: 60_000, // refill every 60s
});

lpLimiter.on('failed', async (error, jobInfo) => {
  if (jobInfo.retryCount < 2) {
    logger.warn(`[LPScorer] Request failed (attempt ${jobInfo.retryCount + 1}), retrying in 5s: ${error.message}`);
    return 5000; // retry after 5s
  }
});

async function fetchWikitext(page: string): Promise<string | null> {
  const now = Date.now();
  if (wikiCache[page] && now - wikiCache[page].fetchedAt < CACHE_TTL) {
    return wikiCache[page].text;
  }

  try {
    const res = await lpLimiter.schedule(() => axios.get(LP_API, {
      params: { action: 'parse', page, prop: 'wikitext', format: 'json' },
      headers: HEADERS,
      timeout: 15000,
      responseType: 'arraybuffer', // receive raw gzip bytes
      decompress: false,           // don't auto-decompress (we do it manually)
    }));

    if (res.status === 429) {
      logger.warn('[LPScorer] Rate limited by Liquipedia — draining limiter reservoir for 60s');
      lpLimiter.updateSettings({ reservoir: 0 });
      setTimeout(() => lpLimiter.updateSettings({ reservoir: 20 }), 60_000);
      return null;
    }

    // Decompress gzip response manually
    let jsonStr: string;
    try {
      const decompressed = await gunzip(res.data as Buffer);
      jsonStr = decompressed.toString('utf-8');
    } catch {
      jsonStr = Buffer.from(res.data as Buffer).toString('utf-8');
    }

    const parsed = JSON.parse(jsonStr);
    const text = parsed?.parse?.wikitext?.['*'] ?? null;
    if (text) wikiCache[page] = { text, fetchedAt: Date.now() };
    return text;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 429) {
      logger.warn('[LPScorer] Rate limited by Liquipedia — draining limiter reservoir for 60s');
      lpLimiter.updateSettings({ reservoir: 0 });
      setTimeout(() => lpLimiter.updateSettings({ reservoir: 20 }), 60_000);
    } else {
      logger.warn(`[LPScorer] Failed to fetch wikitext for "${page}":`, err);
    }
    return null;
  }
}

/**
 * Parse all {{Match ...}} blocks from wikitext and return structured data.
 * Each block contains opponent names, date, bestof, and map results.
 */
interface LpMatch {
  opponent1: string;
  opponent2: string;
  date: string;
  bestof: number;
  maps: Array<{ map: string; winner: 1 | 2 | null }>;
  p1Score: number;
  p2Score: number;
  finishedMaps: number;
}

function parseMatches(wikitext: string): LpMatch[] {
  const results: LpMatch[] = [];

  // Extract Match blocks by finding each {{Match start and its balanced closing }}
  // This is more robust than splitting on |R which can appear inside nested templates
  const matchBlocks: string[] = [];
  const matchStart = /\{\{Match\b/g;
  let ms: RegExpExecArray | null;
  while ((ms = matchStart.exec(wikitext)) !== null) {
    let depth = 0;
    let i = ms.index;
    let end = -1;
    while (i < wikitext.length) {
      if (wikitext[i] === '{' && wikitext[i + 1] === '{') { depth++; i += 2; }
      else if (wikitext[i] === '}' && wikitext[i + 1] === '}') { depth--; if (depth === 0) { end = i + 2; break; } i += 2; }
      else i++;
    }
    if (end > ms.index) matchBlocks.push(wikitext.slice(ms.index, end));
  }

  for (const block of matchBlocks) {
    // Extract opponent names
    const opp1 = block.match(/\|opponent1=\{\{SoloOpponent\|([^|}]+)/)?.[1]?.trim();
    const opp2 = block.match(/\|opponent2=\{\{SoloOpponent\|([^|}]+)/)?.[1]?.trim();
    if (!opp1 || !opp2) continue;

    const date = block.match(/\|date=([^\n|]+)/)?.[1]?.trim() ?? '';
    const bestof = parseInt(block.match(/\|bestof=(\d+)/)?.[1] ?? '3');

    // Extract map results
    const mapRegex = /\|map=([^|}\n]+).*?\|winner=(\d?)/gs;
    const maps: Array<{ map: string; winner: 1 | 2 | null }> = [];
    let m;
    const blockClean = block.replace(/\n\s*/g, ' ');
    while ((m = mapRegex.exec(blockClean)) !== null) {
      const mapName = m[1].trim();
      const w = m[2] ? parseInt(m[2]) : null;
      maps.push({ map: mapName, winner: (w === 1 || w === 2) ? w : null });
    }

    const p1Score = maps.filter(m => m.winner === 1).length;
    const p2Score = maps.filter(m => m.winner === 2).length;
    const finishedMaps = maps.filter(m => m.winner !== null).length;

    results.push({ opponent1: opp1, opponent2: opp2, date, bestof, maps, p1Score, p2Score, finishedMaps });
  }

  return results;
}

/** Normalize player name for fuzzy matching (lowercase, strip clan tags, spaces) */
function normalizeName(name: string): string {
  return name
    .replace(/^\w+\./g, '')  // strip "M8.", "aM.", etc.
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

function namesMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

/**
 * Find the Liquipedia tournament page slug from a liquipediaUrl.
 * e.g. "https://liquipedia.net/ageofempires/Red_Bull_Wololo/Londinium/AoE4" → "Red_Bull_Wololo/Londinium/AoE4"
 */
function extractLiquipediaPage(url: string): string | null {
  // Strip #anchor and trailing slashes, then decode
  const m = url.match(/liquipedia\.net\/ageofempires\/([^#]+)/);
  return m ? decodeURIComponent(m[1].replace(/\/$/, '')) : null;
}

async function syncMatchScore(matchId: string): Promise<void> {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      player1:    { select: { id: true, name: true } },
      player2:    { select: { id: true, name: true } },
      tournament: { select: { name: true, liquipediaUrl: true } },
    },
  });

  if (!match || match.status !== 'LIVE' || match.winnerId) return;

  // Determine Liquipedia page to fetch
  // Priority: match.liquipediaUrl → tournament.liquipediaUrl
  const lpUrl = match.liquipediaUrl ?? match.tournament?.liquipediaUrl;
  if (!lpUrl) {
    logger.debug(`[LPScorer] Match ${matchId}: no Liquipedia URL — skipping`);
    return;
  }

  let page = extractLiquipediaPage(lpUrl);
  if (!page) return;

  // For tournament-level URLs, try appending /AoE4 for tournament bracket page
  const wikitext = await fetchWikitext(page) ?? await fetchWikitext(page + '/AoE4');
  if (!wikitext) return;

  const lpMatches = parseMatches(wikitext);

  // Find the match that corresponds to our DB match
  const lpMatch = lpMatches.find(lm =>
    (namesMatch(lm.opponent1, match.player1.name) && namesMatch(lm.opponent2, match.player2.name)) ||
    (namesMatch(lm.opponent1, match.player2.name) && namesMatch(lm.opponent2, match.player1.name))
  );

  if (!lpMatch) {
    logger.debug(`[LPScorer] Match ${matchId}: ${match.player1.name} vs ${match.player2.name} not found in LP wikitext`);
    return;
  }

  // Determine which way around the players are
  const reversed = namesMatch(lpMatch.opponent1, match.player2.name);
  const p1Score = reversed ? lpMatch.p2Score : lpMatch.p1Score;
  const p2Score = reversed ? lpMatch.p1Score : lpMatch.p2Score;

  // Use DB format as authoritative source for wins needed (LP bestof can be missing/wrong)
  const dbNeeded = Math.ceil((parseInt(match.format.replace(/\D/g, ''), 10) || 3) / 2);
  const lpNeeded = lpMatch.bestof > 0 ? Math.ceil(lpMatch.bestof / 2) : dbNeeded;
  // Take the higher of the two — be conservative, don't complete early
  const needed = Math.max(dbNeeded, lpNeeded);
  const resolvedWinnerId = p1Score >= needed ? match.player1.id
    : p2Score >= needed ? match.player2.id
    : null;

  const scoresUnchanged = p1Score === match.p1Score && p2Score === match.p2Score;

  // Skip if nothing changed AND match doesn't need resolving
  if (scoresUnchanged && !resolvedWinnerId) return;

  if (!scoresUnchanged) {
    logger.info(`[LPScorer] Match ${matchId} (${match.player1.name} vs ${match.player2.name}): LP score ${p1Score}-${p2Score} (was ${match.p1Score}-${match.p2Score})`);
  } else {
    logger.info(`[LPScorer] Match ${matchId}: score unchanged at ${p1Score}-${p2Score} but match needs resolving (needed=${needed})`);
  }

  const io = getIo();

  if (resolvedWinnerId) {
    const resultScore = `${p1Score}-${p2Score}`;
    await prisma.match.update({
      where: { id: matchId },
      data: { p1Score, p2Score, status: 'COMPLETED', winnerId: resolvedWinnerId, resultScore, betsOpen: false, currentGameId: null },
    });

    await distributePayout(matchId, resolvedWinnerId);

    if (io) {
      io.to(`matchRoom:${matchId}`).emit('matchResult', { matchId, winnerId: resolvedWinnerId, resultScore, verifiedBy: 'liquipedia' });
      io.emit('matchUpdate', { matchId, status: 'COMPLETED', winnerId: resolvedWinnerId, resultScore, p1Score, p2Score });
    }

    logger.info(`[LPScorer] Match ${matchId} RESOLVED via Liquipedia: ${resolvedWinnerId === match.player1.id ? match.player1.name : match.player2.name} wins ${resultScore}`);
  } else {
    await prisma.match.update({
      where: { id: matchId },
      data: { p1Score, p2Score },
    });

    if (io) {
      io.to(`matchRoom:${matchId}`).emit('boEnded', { matchId, p1Score, p2Score });
      io.emit('matchUpdate', { matchId, p1Score, p2Score });
    }
  }
}

let scorerInterval: ReturnType<typeof setInterval> | null = null;

export function startLiquipediaLiveScorer(): void {
  if (scorerInterval) return;
  logger.info('[LPScorer] Starting Liquipedia live scorer (5s interval)');

  // Run immediately on start
  runScorer();

  scorerInterval = setInterval(runScorer, 5_000);
}

async function runScorer(): Promise<void> {
  try {
    const liveMatches = await prisma.match.findMany({
      where: { status: 'LIVE', winnerId: null },
      select: { id: true },
    });

    // Run concurrently — Bottleneck inside fetchWikitext handles LP rate limiting
    // Cache (25s TTL) means multiple matches on same page share one fetch
    await Promise.all(liveMatches.map(m => syncMatchScore(m.id)));
  } catch (err) {
    logger.error('[LPScorer] runScorer error:', err);
  }
}

export function stopLiquipediaLiveScorer(): void {
  if (scorerInterval) {
    clearInterval(scorerInterval);
    scorerInterval = null;
  }
}

export { syncMatchScore };

/**
 * Debug: returns raw LP data for a match so admins can diagnose sync issues.
 */
export async function debugLpMatch(matchId: string): Promise<Record<string, unknown>> {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      player1:    { select: { id: true, name: true } },
      player2:    { select: { id: true, name: true } },
      tournament: { select: { name: true, liquipediaUrl: true } },
    },
  });

  if (!match) return { error: 'Match not found' };

  const lpUrl = match.liquipediaUrl ?? match.tournament?.liquipediaUrl;
  if (!lpUrl) return {
    error: 'No liquipediaUrl set on match or tournament',
    match: { id: matchId, player1: match.player1.name, player2: match.player2.name },
  };

  const page = extractLiquipediaPage(lpUrl);
  if (!page) return { error: 'Could not extract page slug from URL', url: lpUrl };

  const wikitext = await fetchWikitext(page) ?? await fetchWikitext(page + '/AoE4');
  if (!wikitext) return { error: 'Failed to fetch wikitext', page };

  const lpMatches = parseMatches(wikitext);
  const p1 = match.player1.name;
  const p2 = match.player2.name;

  const found = lpMatches.find(lm =>
    (namesMatch(lm.opponent1, p1) && namesMatch(lm.opponent2, p2)) ||
    (namesMatch(lm.opponent1, p2) && namesMatch(lm.opponent2, p1))
  );

  return {
    page,
    urlUsed: lpUrl,
    dbScore: `${match.p1Score}-${match.p2Score}`,
    dbStatus: match.status,
    player1: p1,
    player2: p2,
    lpMatchesFound: lpMatches.length,
    allOpponentPairs: lpMatches.map(m => ({ opp1: m.opponent1, opp2: m.opponent2, score: `${m.p1Score}-${m.p2Score}`, bestof: m.bestof })),
    matchedBlock: found ?? null,
    diagnosis: found
      ? `Found: ${found.opponent1} vs ${found.opponent2}, score ${found.p1Score}-${found.p2Score}, bestof=${found.bestof}`
      : `NOT FOUND — none of the ${lpMatches.length} LP matches matched "${p1}" vs "${p2}"`,
  };
}
