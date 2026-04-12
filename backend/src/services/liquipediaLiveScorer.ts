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
import { distributePayout, distributeDrawPayout, refundBets } from './betService';
import logger from '../logger';

const gunzip = promisify(zlib.gunzip);

// Wiki path is determined per-match from the tournament's Liquipedia URL.
// All AoE wikis share the same MediaWiki API at /{wiki}/api.php.
const LP_API_FOR = (wikiPath: string) => `https://liquipedia.net/${wikiPath}/api.php`;
const LP_API_KEY = process.env.LIQUIPEDIA_API_KEY;
const LP_PROXY_URL = process.env.LP_PROXY_URL; // e.g. http://user:pass@1.2.3.4:3128

function buildHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    'User-Agent': 'AgeOfMoney/1.0 (contact@ageofmoney.com)',
    'Accept-Encoding': 'gzip', // Liquipedia REQUIRES gzip (406 otherwise)
  };
  if (LP_API_KEY) h.Authorization = `Apikey ${LP_API_KEY}`;
  return h;
}

/**
 * Build axios proxy config from LP_PROXY_URL env var.
 * Supports http://user:pass@host:port and http://host:port formats.
 * When set, ALL Liquipedia requests route through this proxy so we're
 * not dependent on Railway's shared outbound IP.
 */
function buildProxyConfig(): object | undefined {
  if (!LP_PROXY_URL) return undefined;
  try {
    const u = new URL(LP_PROXY_URL);
    const cfg: Record<string, unknown> = {
      host: u.hostname,
      port: parseInt(u.port, 10) || 3128,
      protocol: u.protocol.replace(':', ''),
    };
    if (u.username) cfg.auth = { username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) };
    return { proxy: cfg };
  } catch { return undefined; }
}

// Cache wikitext per page — serves all concurrent match checks from same page
const wikiCache: Record<string, { text: string; fetchedAt: number }> = {};
const CACHE_TTL = 25_000; // 25s — reuse within a poll cycle (min interval is 30s)

// ── Circuit breaker ──────────────────────────────────────────────────────────
// When Liquipedia hard-blocks our IP, hammering it more makes the block last
// longer. After consecutive 429s, refuse to fire ANY request until a backoff
// window passes. The backoff grows exponentially up to 1h so we recover
// gracefully without spamming the logs every 5s.
let lpBlockedUntil = 0;
let consecutive429s = 0;
const BACKOFF_MIN = [2, 5, 10, 20, 30, 60]; // minutes per consecutive failure (start at 2min)

/** Check if Liquipedia is currently blocked by the circuit breaker. */
export function isLpBlocked(): boolean { return Date.now() < lpBlockedUntil; }

export function tripCircuitBreaker(): void {
  consecutive429s++;
  const idx = Math.min(consecutive429s - 1, BACKOFF_MIN.length - 1);
  const minutes = BACKOFF_MIN[idx];
  lpBlockedUntil = Date.now() + minutes * 60_000;
  logger.warn(`[LPScorer] 429 from Liquipedia (${consecutive429s} consecutive) — circuit breaker open for ${minutes}min, no more LP requests until ${new Date(lpBlockedUntil).toISOString()}`);

  // Auto-unblock: if 2captcha key is configured, attempt to solve the
  // reCAPTCHA and unblock the IP automatically. The function verifies with
  // a real LP API request before resetting the breaker (no more false positives).
  if (process.env.TWOCAPTCHA_API_KEY && consecutive429s >= 2) {
    logger.info('[LPScorer] TWOCAPTCHA_API_KEY detected — attempting auto-unblock...');
    attemptAutoUnblock().then(result => {
      if (result.success) {
        logger.info(`[LPScorer] Auto-unblock succeeded: ${result.message}`);
      } else {
        logger.warn(`[LPScorer] Auto-unblock failed: ${result.message}`);
      }
    }).catch(err => logger.warn(`[LPScorer] Auto-unblock error: ${err.message}`));
  }
}

/**
 * Attempt to automatically unblock our IP from Liquipedia's rate limit.
 *
 * Verified flow (from real LP page inspection):
 *  1. GET /token/generate → returns plain text with an unblock URL:
 *     "Please visit the following URL in a browser to unblock X.X.X.X:
 *      https://liquipedia.net/token/unblock?token=..."
 *  2. GET that unblock URL → returns HTML with reCAPTCHA v2 + terms checkbox
 *  3. Solve reCAPTCHA via 2captcha.com ($0.003 per solve)
 *  4. POST the unblock URL with g-recaptcha-response + terms agreement
 *  5. IP unblocked → verify with a real LP API request → reset circuit breaker
 *
 * If IP is not blocked, /token/generate returns:
 *   "This IP address is not blocked."
 *
 * Requires TWOCAPTCHA_API_KEY env var. Without it, logs the unblock URL
 * for the admin to visit manually in a browser.
 */
let unblockRunning = false;
export async function attemptAutoUnblock(): Promise<{ success: boolean; message: string }> {
  if (unblockRunning) return { success: false, message: 'Auto-unblock already in progress' };
  unblockRunning = true;
  const CAPTCHA_KEY = process.env.TWOCAPTCHA_API_KEY;

  try {
    // ── Step 1: get the unblock URL from /token/generate ──────────────────
    const tokenRes = await axios.get('https://liquipedia.net/token/generate', {
      headers: { 'User-Agent': 'AgeOfMoney/1.0 (contact@ageofmoney.com)' },
      timeout: 15000,
    });
    const tokenText = typeof tokenRes.data === 'string' ? tokenRes.data : '';

    // If IP is already unblocked, verify and reset
    if (tokenText.includes('not blocked')) {
      logger.info('[LPScorer] Auto-unblock: LP says IP is not blocked — verifying...');
      const verified = await verifyLpAccess();
      if (verified) {
        resetCircuitBreaker();
        return { success: true, message: 'IP is not blocked (verified)' };
      }
      return { success: false, message: 'LP says not blocked but API still returns 429' };
    }

    // Extract the unblock URL
    const urlMatch = tokenText.match(/(https:\/\/liquipedia\.net\/token\/unblock\?token=[^\s]+)/);
    if (!urlMatch) {
      logger.warn(`[LPScorer] Auto-unblock: could not find unblock URL in token/generate response`);
      return { success: false, message: 'No unblock URL found in token/generate response' };
    }
    const unblockUrl = urlMatch[1];
    logger.info(`[LPScorer] Auto-unblock: got unblock URL for IP`);

    if (!CAPTCHA_KEY) {
      logger.warn(`[LPScorer] Auto-unblock: reCAPTCHA required but TWOCAPTCHA_API_KEY not set. Visit manually: ${unblockUrl}`);
      return { success: false, message: `CAPTCHA required, no 2captcha key. Manual URL: ${unblockUrl}` };
    }

    // ── Step 2: fetch the unblock page to get the reCAPTCHA sitekey ───────
    // We fetch from Railway's IP so the page shows the CAPTCHA for that IP.
    const unblockRes = await axios.get(unblockUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 15000,
    });
    const unblockHtml = typeof unblockRes.data === 'string' ? unblockRes.data : '';

    // Extract sitekey from data-sitekey="..." (no quotes around value in LP's HTML)
    const sitekeyMatch = unblockHtml.match(/data-sitekey=["']?([^"'\s>]+)["']?/);
    if (!sitekeyMatch) {
      logger.warn(`[LPScorer] Auto-unblock: could not find reCAPTCHA sitekey. Page snippet: ${unblockHtml.slice(0, 500)}`);
      return { success: false, message: 'No reCAPTCHA sitekey found on unblock page' };
    }
    const sitekey = sitekeyMatch[1];

    // Extract the token from the hidden input (needed for the POST)
    const tokenMatch = unblockHtml.match(/name=["']?token["']?\s+value=["']?([^"'\s>]+)/);
    const formToken = tokenMatch?.[1] ?? '';

    logger.info(`[LPScorer] Auto-unblock: found reCAPTCHA sitekey (${sitekey.slice(0, 15)}...), sending to 2captcha...`);

    // ── Step 3: solve reCAPTCHA via 2captcha ──────────────────────────────
    const submitRes = await axios.get('https://2captcha.com/in.php', {
      params: {
        key: CAPTCHA_KEY,
        method: 'userrecaptcha',
        googlekey: sitekey,
        pageurl: unblockUrl,
        json: 1,
      },
      timeout: 15000,
    });

    if (submitRes.data?.status !== 1) {
      return { success: false, message: `2captcha submit failed: ${JSON.stringify(submitRes.data)}` };
    }

    const taskId = submitRes.data.request;
    logger.info(`[LPScorer] Auto-unblock: 2captcha task ${taskId}, waiting for solution (~15-30s)...`);

    // Poll for solution (max ~120s)
    let solution = '';
    for (let i = 0; i < 24; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const pollRes = await axios.get('https://2captcha.com/res.php', {
        params: { key: CAPTCHA_KEY, action: 'get', id: taskId, json: 1 },
        timeout: 10000,
      });
      if (pollRes.data?.status === 1) {
        solution = pollRes.data.request;
        break;
      }
      if (pollRes.data?.request !== 'CAPCHA_NOT_READY') {
        return { success: false, message: `2captcha error: ${JSON.stringify(pollRes.data)}` };
      }
    }

    if (!solution) {
      return { success: false, message: '2captcha timeout (120s)' };
    }

    logger.info('[LPScorer] Auto-unblock: reCAPTCHA solved, submitting to Liquipedia...');

    // ── Step 4: POST to /unblock (the form action is /unblock, NOT the token URL) ──
    await axios.post('https://liquipedia.net/unblock',
      new URLSearchParams({
        'r': '/',
        'token': formToken,
        'g-recaptcha-response': solution,
        'agree': '1',
      }).toString(),
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': unblockUrl,
        },
        timeout: 15000,
        maxRedirects: 5,
      }
    );

    // ── Step 5: verify the IP is actually unblocked ───────────────────────
    // Give LP a moment to propagate the unblock
    await new Promise(r => setTimeout(r, 2000));

    const verified = await verifyLpAccess();
    if (verified) {
      logger.info('[LPScorer] Auto-unblock: SUCCESS — IP unblocked and verified!');
      resetCircuitBreaker();
      return { success: true, message: 'IP unblocked via 2captcha and verified' };
    } else {
      logger.warn('[LPScorer] Auto-unblock: CAPTCHA submitted but LP still returns 429');
      return { success: false, message: 'CAPTCHA submitted but verification failed — IP may still be blocked' };
    }

  } catch (err: any) {
    logger.warn(`[LPScorer] Auto-unblock error: ${err.message}`);
    return { success: false, message: err.message };
  } finally {
    unblockRunning = false;
  }
}

/** Make a lightweight LP API request to verify the IP is not rate-limited. */
async function verifyLpAccess(): Promise<boolean> {
  try {
    const res = await axios.get(LP_API_FOR('ageofempires'), {
      params: { action: 'query', meta: 'siteinfo', format: 'json' },
      headers: buildHeaders(),
      timeout: 10000,
      responseType: 'arraybuffer',
      decompress: false,
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

export function resetCircuitBreaker(): void {
  if (consecutive429s > 0) {
    logger.info('[LPScorer] Liquipedia request succeeded — circuit breaker reset');
  }
  consecutive429s = 0;
  lpBlockedUntil = 0;
}

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
  // NEVER retry on 429 — retrying a rate-limited request just makes the IP
  // ban last longer. Only retry transient network errors.
  if (axios.isAxiosError(error) && error.response?.status === 429) return null;
  if (jobInfo.retryCount < 1) {
    logger.warn(`[LPScorer] Request failed (attempt ${jobInfo.retryCount + 1}), retrying in 5s: ${error.message}`);
    return 5000;
  }
  return null;
});

async function fetchWikitext(wikiPath: string, page: string): Promise<string | null> {
  // Circuit breaker: if Liquipedia blocked us, do not even try
  if (Date.now() < lpBlockedUntil) return null;

  const cacheKey = `${wikiPath}:${page}`;
  const now = Date.now();
  if (wikiCache[cacheKey] && now - wikiCache[cacheKey].fetchedAt < CACHE_TTL) {
    return wikiCache[cacheKey].text;
  }

  try {
    const res = await lpLimiter.schedule(() => axios.get(LP_API_FOR(wikiPath), {
      params: { action: 'parse', page, prop: 'wikitext', format: 'json' },
      headers: buildHeaders(),
      timeout: 15000,
      responseType: 'arraybuffer', // receive raw gzip bytes
      decompress: false,           // don't auto-decompress (we do it manually)
    }));

    if (res.status === 429) {
      tripCircuitBreaker();
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
    if (text) wikiCache[cacheKey] = { text, fetchedAt: Date.now() };
    resetCircuitBreaker(); // success → clear any prior backoff
    return text;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 429) {
      tripCircuitBreaker();
    } else {
      logger.warn(`[LPScorer] Failed to fetch wikitext for "${wikiPath}/${page}":`, err);
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
  walkover: boolean;
}

/**
 * Walk a string from a position pointing at `{{` and return the index of the
 * matching `}}` (exclusive). Returns -1 if no balanced closer is found.
 */
function findBalancedTemplateEnd(text: string, start: number): number {
  if (text[start] !== '{' || text[start + 1] !== '{') return -1;
  let depth = 0;
  let i = start;
  while (i < text.length) {
    if (text[i] === '{' && text[i + 1] === '{') { depth++; i += 2; }
    else if (text[i] === '}' && text[i + 1] === '}') {
      depth--;
      i += 2;
      if (depth === 0) return i;
    }
    else i++;
  }
  return -1;
}

/**
 * Extract a {{SoloOpponent|name|...|score=N}} template attached to a given
 * `|opponentN=` key. Handles balanced braces (nested templates inside) and
 * multi-line content. Returns the player name + the score field if present.
 */
function extractSoloOpponent(block: string, oppKey: 'opponent1' | 'opponent2'): { name: string; score: number | null; isWalkover: boolean } | null {
  const marker = `|${oppKey}=`;
  const idx = block.indexOf(marker);
  if (idx === -1) return null;
  const tplStart = idx + marker.length;
  if (block[tplStart] !== '{' || block[tplStart + 1] !== '{') return null;
  const tplEnd = findBalancedTemplateEnd(block, tplStart);
  if (tplEnd === -1) return null;
  const inside = block.slice(tplStart + 2, tplEnd - 2); // strip the {{ }}
  // Quick sanity check: must be a SoloOpponent template
  if (!/^SoloOpponent\b/.test(inside)) return null;

  // Split into top-level pipe parts (don't split inside nested {{...}})
  const parts: string[] = [];
  let buf = '';
  let depth = 0;
  for (let i = 0; i < inside.length; i++) {
    const ch = inside[i];
    if (ch === '{' && inside[i + 1] === '{') { depth++; buf += '{{'; i++; continue; }
    if (ch === '}' && inside[i + 1] === '}') { depth--; buf += '}}'; i++; continue; }
    if (ch === '|' && depth === 0) { parts.push(buf); buf = ''; continue; }
    buf += ch;
  }
  parts.push(buf);
  // parts[0] = "SoloOpponent", parts[1] = positional player name
  const name = (parts[1] ?? '').trim();
  if (!name) return null;
  let score: number | null = null;
  let isWalkover = false;
  for (const p of parts.slice(2)) {
    const m = p.match(/^\s*score\s*=\s*(.+?)\s*$/);
    if (m) {
      const val = m[1].trim();
      if (/^\d+$/.test(val)) { score = parseInt(val, 10); }
      else if (/^-?\d+$/.test(val) && parseInt(val, 10) < 0) { isWalkover = true; score = -1; } // score=-1
      else if (/^(W|FF|L|DQ|WO|w|ff)$/i.test(val)) { isWalkover = true; score = -1; }
      else if (val === '-') { isWalkover = true; score = -1; } // score=-
      break;
    }
  }
  return { name, score, isWalkover };
}

function parseMatches(wikitext: string): LpMatch[] {
  const results: LpMatch[] = [];

  // Extract Match blocks by finding each {{Match start and its balanced closing }}
  // This is more robust than splitting on |R which can appear inside nested templates
  const matchBlocks: string[] = [];
  const matchStart = /\{\{Match\b/g;
  let ms: RegExpExecArray | null;
  while ((ms = matchStart.exec(wikitext)) !== null) {
    const end = findBalancedTemplateEnd(wikitext, ms.index);
    if (end > ms.index) matchBlocks.push(wikitext.slice(ms.index, end));
  }

  for (const block of matchBlocks) {
    // ── Opponents (balanced-brace extraction, picks up |score=N if present) ──
    const opp1Info = extractSoloOpponent(block, 'opponent1');
    const opp2Info = extractSoloOpponent(block, 'opponent2');
    if (!opp1Info || !opp2Info) continue;
    const opp1 = opp1Info.name;
    const opp2 = opp2Info.name;

    const date = block.match(/\|date=([^\n|]+)/)?.[1]?.trim() ?? '';
    const bestof = parseInt(block.match(/\|bestof=(\d+)/)?.[1] ?? '3');

    // ── Walkover detection ──────────────────────────────────────────────────
    const isWalkover = opp1Info.isWalkover || opp2Info.isWalkover;
    // Check top-level walkover indicators: |walkover=1, |walkover=2, |walkover=true, |finished=true with |winner= but 0 maps
    const walkoverMatch = block.match(/\|walkover\s*=\s*(\w+)/);
    let topLevelWalkover = 0;
    if (walkoverMatch) {
      const wv = walkoverMatch[1];
      if (wv === '1' || wv === '2') topLevelWalkover = parseInt(wv, 10);
      else if (/^(true|yes|ff|wo|l|dq)$/i.test(wv)) topLevelWalkover = -1; // generic walkover, pick winner from |winner=
    }
    // Also check for |winner= at Match level (may be on same line as |walkover=)
    const matchWinner = block.match(/\|winner\s*=\s*(\d)/)?.[1];
    if (!isWalkover && topLevelWalkover === 0 && matchWinner) {
      // If there's a match-level winner but zero finished maps, it's likely a walkover
      const hasMapResults = /\|map\d+\s*=\s*\{\{Map/.test(block) || /\|winner\s*=\s*\d/g.test(
        block.replace(/^\|winner\s*=\s*\d\s*$/m, '') // remove the match-level winner
      );
      if (!hasMapResults) topLevelWalkover = parseInt(matchWinner, 10);
    }

    // ── Score signals — try them in order of reliability ────────────────────
    // Signal 1: score field inside the SoloOpponent template (most reliable —
    //   editors usually update this first when a map ends).
    let sigTplScore: { p1: number; p2: number } | null = null;
    if (isWalkover || topLevelWalkover !== 0) {
      // Walkover: winner gets needed wins, loser gets 0
      let winnerIs1: boolean;
      if (topLevelWalkover === 1) winnerIs1 = true;
      else if (topLevelWalkover === 2) winnerIs1 = false;
      else if (topLevelWalkover === -1 && matchWinner) winnerIs1 = matchWinner === '1';
      else winnerIs1 = opp2Info.isWalkover; // opp2 forfeits → opp1 wins
      sigTplScore = { p1: winnerIs1 ? Math.ceil(bestof / 2) : 0, p2: winnerIs1 ? 0 : Math.ceil(bestof / 2) };
    } else if (opp1Info.score !== null && opp1Info.score >= 0 && opp2Info.score !== null && opp2Info.score >= 0) {
      sigTplScore = { p1: opp1Info.score, p2: opp2Info.score };
    }

    // Signal 2: top-level |opponent1score= / |opponent2score= on the Match.
    const tlS1Raw = block.match(/\|opponent1score\s*=\s*(\S+)/)?.[1];
    const tlS2Raw = block.match(/\|opponent2score\s*=\s*(\S+)/)?.[1];
    let sigTopLevel: { p1: number; p2: number } | null = null;
    if (tlS1Raw && tlS2Raw) {
      const isWO1 = /^(W|FF|L|DQ)$/i.test(tlS1Raw);
      const isWO2 = /^(W|FF|L|DQ)$/i.test(tlS2Raw);
      if (isWO1 || isWO2) {
        // Walkover: the side with W/FF loses, the other wins
        const winnerIs1 = isWO2;
        sigTopLevel = { p1: winnerIs1 ? Math.ceil(bestof / 2) : 0, p2: winnerIs1 ? 0 : Math.ceil(bestof / 2) };
      } else if (/^\d+$/.test(tlS1Raw) && /^\d+$/.test(tlS2Raw)) {
        sigTopLevel = { p1: parseInt(tlS1Raw, 10), p2: parseInt(tlS2Raw, 10) };
      }
    }

    // Signal 3: count |winner=1 / |winner=2 occurrences anywhere in the block.
    // Catches both legacy `|map=X|...|winner=N` and modern
    // `|mapN={{Map|...|winner=X}}` formats in one shot.
    let countedWinner1 = 0;
    let countedWinner2 = 0;
    const winnerRe = /\|winner\s*=\s*(\d)/g;
    let wm: RegExpExecArray | null;
    while ((wm = winnerRe.exec(block)) !== null) {
      if (wm[1] === '1') countedWinner1++;
      else if (wm[1] === '2') countedWinner2++;
    }
    const sigCounted = { p1: countedWinner1, p2: countedWinner2 };

    // Pick the strongest signal: prefer direct score fields, then counted maps.
    // We prefer ANY signal whose total > 0, falling back to 0-0 only if all
    // three signals say so (genuinely no progress yet).
    const sigs = [sigTplScore, sigTopLevel, sigCounted].filter(Boolean) as { p1: number; p2: number }[];
    const best = sigs.find(s => s.p1 + s.p2 > 0) ?? sigs[0] ?? { p1: 0, p2: 0 };
    const p1Score = best.p1;
    const p2Score = best.p2;

    const finishedMaps = countedWinner1 + countedWinner2;
    // maps[] kept for the LpMatch shape — the live scorer only consumes scores.
    const maps: Array<{ map: string; winner: 1 | 2 | null }> = [];

    const wo = isWalkover || topLevelWalkover !== 0;
    results.push({ opponent1: opp1, opponent2: opp2, date, bestof, maps, p1Score, p2Score, finishedMaps, walkover: wo });
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
 * Extract { wikiPath, page } from a Liquipedia URL — supports all AoE wikis.
 * e.g. "https://liquipedia.net/ageofempires2/Hidden_Cup_5" → { wikiPath: "ageofempires2", page: "Hidden_Cup_5" }
 */
function extractLiquipediaPage(url: string): { wikiPath: string; page: string } | null {
  // Match any /ageofempires*, /ageofmythology, etc. wiki path
  const m = url.match(/liquipedia\.net\/(ageofempires2|ageofempires3|ageofmythology|ageofempires)\/([^#]+)/);
  if (!m) return null;
  return { wikiPath: m[1], page: decodeURIComponent(m[2].replace(/\/$/, '')) };
}

/** Map our internal game code → the Liquipedia wiki path that hosts that game. */
function wikiPathForGame(game: string): string {
  switch (game) {
    case 'AoE2': return 'ageofempires2';
    case 'AoE3': return 'ageofempires3';
    case 'AoM':  return 'ageofmythology';
    default:     return 'ageofempires'; // AoE4 and AoE1 both live here
  }
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
    logger.info(`[LPScorer] Match ${matchId}: no Liquipedia URL — skipping`);
    return;
  }

  const extracted = extractLiquipediaPage(lpUrl);
  if (!extracted) return;
  const { page, wikiPath: urlWikiPath } = extracted;
  // The URL is the source of truth for *where the page lives*. Some AoE2/AoE3
  // tournaments are hosted on /ageofempires/ (the AoE4 wiki) via the federated
  // upcoming-matches widget — using match.game to pick the wiki would miss them.
  // We try the URL's wiki first, then fall back to the game's expected wiki.
  const fallbackWiki = wikiPathForGame(match.game);
  const wikiCandidates = urlWikiPath === fallbackWiki ? [urlWikiPath] : [urlWikiPath, fallbackWiki];

  let wikitext: string | null = null;
  for (const wp of wikiCandidates) {
    wikitext = await fetchWikitext(wp, page) ?? await fetchWikitext(wp, page + '/AoE4');
    if (wikitext) break;
  }
  if (!wikitext) {
    logger.info(`[LPScorer] Match ${matchId}: could not fetch wikitext for page "${page}" (wiki candidates: ${wikiCandidates.join(', ')})`);
    return;
  }

  const lpMatches = parseMatches(wikitext);
  logger.info(`[LPScorer] Match ${matchId}: parsed ${lpMatches.length} match blocks from "${page}"`);

  // Find the match that corresponds to our DB match
  const lpMatch = lpMatches.find(lm =>
    (namesMatch(lm.opponent1, match.player1.name) && namesMatch(lm.opponent2, match.player2.name)) ||
    (namesMatch(lm.opponent1, match.player2.name) && namesMatch(lm.opponent2, match.player1.name))
  );

  if (!lpMatch) {
    // Log ALL opponent pairs from the wikitext so we can diagnose name mismatches
    const pairs = lpMatches.map(m => `${m.opponent1} vs ${m.opponent2}`).join(' | ');
    logger.info(`[LPScorer] Match ${matchId}: "${match.player1.name}" vs "${match.player2.name}" NOT FOUND in LP wikitext. LP has ${lpMatches.length} matches: [${pairs}]`);
    return;
  }

  // Determine which way around the players are
  const reversed = namesMatch(lpMatch.opponent1, match.player2.name);
  const p1Score = reversed ? lpMatch.p2Score : lpMatch.p1Score;
  const p2Score = reversed ? lpMatch.p1Score : lpMatch.p2Score;

  // Use DB format as authoritative source for wins needed (LP bestof can be missing/wrong)
  const boNum = parseInt(match.format.replace(/\D/g, ''), 10) || 3;
  const dbNeeded = Math.ceil(boNum / 2);
  const lpNeeded = lpMatch.bestof > 0 ? Math.ceil(lpMatch.bestof / 2) : dbNeeded;
  // Take the higher of the two — be conservative, don't complete early
  const needed = Math.max(dbNeeded, lpNeeded);

  let resolvedWinnerId: string | null = null;
  // BO2 special case: 1-1 is a draw, not a win — only 2-0 is decisive
  const isBO2 = boNum === 2 || lpMatch.bestof === 2;
  if (isBO2) {
    // In BO2: winner must have MORE wins than opponent (2-0). 1-1 = draw = no winner.
    if (p1Score > p2Score && p1Score >= needed) resolvedWinnerId = match.player1.id;
    else if (p2Score > p1Score && p2Score >= needed) resolvedWinnerId = match.player2.id;
    // 1-1 → resolvedWinnerId stays null → match stays LIVE, will eventually be CANCELLED
  } else {
    resolvedWinnerId = p1Score >= needed ? match.player1.id
      : p2Score >= needed ? match.player2.id
      : null;
  }

  // BO2 draw detection: 1-1 is a completed draw → refund all bets
  const isBO2Draw = isBO2 && p1Score === p2Score && p1Score >= 1 && !resolvedWinnerId;

  const scoresUnchanged = p1Score === match.p1Score && p2Score === match.p2Score;

  // Skip if nothing changed AND match doesn't need resolving
  if (scoresUnchanged && !resolvedWinnerId && !isBO2Draw) return;

  if (!scoresUnchanged) {
    logger.info(`[LPScorer] Match ${matchId} (${match.player1.name} vs ${match.player2.name}): LP score ${p1Score}-${p2Score} (was ${match.p1Score}-${match.p2Score})`);
  } else {
    logger.info(`[LPScorer] Match ${matchId}: score unchanged at ${p1Score}-${p2Score} but match needs resolving (needed=${needed})`);
  }

  const io = getIo();

  // Even BO draw (BO2 1-1, BO4 2-2, etc.): match completed with no winner — draw bets win
  if (isBO2Draw) {
    const resultScore = `${p1Score}-${p2Score}`;
    logger.info(`[LPScorer] Match ${matchId}: even BO draw (${resultScore}) — draw bets win, player bets lose`);
    await prisma.match.update({
      where: { id: matchId },
      data: { p1Score, p2Score, status: 'COMPLETED', resultScore, betsOpen: false, currentGameId: null },
    });
    await distributeDrawPayout(matchId);
    io?.emit('matchUpdate', { matchId, status: 'COMPLETED', p1Score, p2Score });
    return;
  }

  if (resolvedWinnerId) {
    const resultScore = `${p1Score}-${p2Score}`;

    // Walkover/forfeit → cancel the match and refund all bets (no real match played)
    if (lpMatch.walkover) {
      logger.info(`[LPScorer] Match ${matchId}: walkover detected — cancelling and refunding bets`);
      await prisma.match.update({
        where: { id: matchId },
        data: { p1Score, p2Score, status: 'CANCELLED', resultScore, betsOpen: false, currentGameId: null },
      });
      await refundBets(matchId, 'Match annulé — forfait/walkover (pas de match joué)');
      io?.emit('matchUpdate', { matchId, status: 'CANCELLED', p1Score, p2Score });
      return;
    }

    await prisma.match.update({
      where: { id: matchId },
      data: { p1Score, p2Score, status: 'COMPLETED', winnerId: resolvedWinnerId, resultScore, betsOpen: false, currentGameId: null },
    });

    await distributePayout(matchId, resolvedWinnerId);

    // Append result to PlayerMatchRecord — this is how non-AoE4 H2H grows
    // organically once Claude has been called once per (player, game).
    {
      const p1Won = resolvedWinnerId === match.player1.id;
      const tournamentName = match.tournament?.name ?? 'Tournament';
      for (const [playerId, opponentId, opponentName, won] of [
        [match.player1.id, match.player2.id, match.player2.name, p1Won],
        [match.player2.id, match.player1.id, match.player1.name, !p1Won],
      ] as [string, string, string, boolean][]) {
        await prisma.playerMatchRecord.upsert({
          where: {
            playerId_opponentName_tournamentName_matchDate: {
              playerId,
              opponentName,
              tournamentName,
              matchDate: match.scheduledAt,
            },
          },
          create: {
            playerId, opponentName, opponentId,
            game: match.game,
            won,
            score: won ? resultScore : resultScore.split('-').reverse().join('-'),
            tournamentName,
            matchDate: match.scheduledAt,
            format: match.format,
            source: 'platform',
            confidence: 1.0,
          },
          update: {
            game: match.game,
            won,
            score: won ? resultScore : resultScore.split('-').reverse().join('-'),
          },
        }).catch(() => {});
      }
    }

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

let scorerTimeout: ReturnType<typeof setTimeout> | null = null;
let lastLoggedInterval = 0;

/**
 * Compute the poll interval based on how many unique LP pages we need to
 * fetch.  Target: stay under ~400 req/h to never trigger a 429.
 *
 *   unique pages │ interval │  req/h
 *   ─────────────┼──────────┼───────
 *       1–4      │   30s    │  ≤480  (safe with cache dedup → real ~120-240)
 *       5–7      │   60s    │  ≤420
 *       8–12     │   90s    │  ≤480
 *       13+      │  120s    │  safe
 *
 * In practice, matches from the same tournament share one page, so even with
 * 17 matches the unique-page count rarely exceeds 3-4.
 */
function computeInterval(uniquePages: number): number {
  if (uniquePages <= 4) return 30_000;
  if (uniquePages <= 7) return 60_000;
  if (uniquePages <= 12) return 90_000;
  return 120_000;
}

export function startLiquipediaLiveScorer(): void {
  if (scorerTimeout) return;
  logger.info('[LPScorer] Starting Liquipedia live scorer (adaptive interval, 30s base)');
  runScorer();
}

async function runScorer(): Promise<void> {
  try {
    // Circuit breaker: if we're blocked, skip this cycle entirely but keep
    // scheduling so we resume automatically when the window expires.
    if (Date.now() < lpBlockedUntil) {
      scorerTimeout = setTimeout(runScorer, 30_000);
      return;
    }

    const liveMatches = await prisma.match.findMany({
      where: { status: 'LIVE', winnerId: null },
      select: { id: true, liquipediaUrl: true, tournament: { select: { liquipediaUrl: true } } },
    });

    if (liveMatches.length === 0) {
      // No live matches — idle at 60s to avoid pointless DB queries
      scorerTimeout = setTimeout(runScorer, 60_000);
      return;
    }

    // Count unique LP page URLs to decide the poll interval
    const uniquePages = new Set(
      liveMatches
        .map((m: any) => m.liquipediaUrl ?? m.tournament?.liquipediaUrl)
        .filter(Boolean)
    ).size;

    const interval = computeInterval(uniquePages);

    // Log the interval only when it changes
    if (interval !== lastLoggedInterval) {
      logger.info(`[LPScorer] ${liveMatches.length} live matches on ${uniquePages} unique LP pages → polling every ${interval / 1000}s`);
      lastLoggedInterval = interval;
    }

    // Sync all matches — Bottleneck + cache ensure same-page matches share
    // a single HTTP fetch within the same cycle
    await Promise.all(liveMatches.map((m: any) => syncMatchScore(m.id)));

    // Schedule next cycle
    scorerTimeout = setTimeout(runScorer, interval);
  } catch (err) {
    logger.error('[LPScorer] runScorer error:', err);
    scorerTimeout = setTimeout(runScorer, 30_000);
  }
}

export function stopLiquipediaLiveScorer(): void {
  if (scorerTimeout) {
    clearTimeout(scorerTimeout);
    scorerTimeout = null;
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

  const extracted = extractLiquipediaPage(lpUrl);
  if (!extracted) return { error: 'Could not extract page slug from URL', url: lpUrl };
  const { page, wikiPath: urlWikiPath } = extracted;
  const fallbackWiki = wikiPathForGame(match.game);
  const wikiCandidates = urlWikiPath === fallbackWiki ? [urlWikiPath] : [urlWikiPath, fallbackWiki];

  let wikitext: string | null = null;
  let wikiPath = urlWikiPath;
  for (const wp of wikiCandidates) {
    wikitext = await fetchWikitext(wp, page) ?? await fetchWikitext(wp, page + '/AoE4');
    if (wikitext) { wikiPath = wp; break; }
  }
  if (!wikitext) return { error: 'Failed to fetch wikitext', page, wikiCandidates };

  const lpMatches = parseMatches(wikitext);
  const p1 = match.player1.name;
  const p2 = match.player2.name;

  const found = lpMatches.find(lm =>
    (namesMatch(lm.opponent1, p1) && namesMatch(lm.opponent2, p2)) ||
    (namesMatch(lm.opponent1, p2) && namesMatch(lm.opponent2, p1))
  );

  return {
    page,
    wikiPath,
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
