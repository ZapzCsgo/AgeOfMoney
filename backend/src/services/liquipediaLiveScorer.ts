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
import { distributePayout, refundBets } from './betService';
import logger from '../logger';

const gunzip = promisify(zlib.gunzip);

// Wiki path is determined per-match from the tournament's Liquipedia URL.
// All AoE wikis share the same MediaWiki API at /{wiki}/api.php.
const LP_API_FOR = (wikiPath: string) => `https://liquipedia.net/${wikiPath}/api.php`;
const LP_API_KEY = process.env.LIQUIPEDIA_API_KEY;
const LP_PROXY_URL = process.env.LP_PROXY_URL; // e.g. http://user:pass@1.2.3.4:3128

// ── Cloudflare Worker proxy (URL-rewrite mode) ──────────────────────────────
// Distinct from LP_PROXY_URL (HTTP CONNECT proxy). When LP_WORKER_URL is set,
// every Liquipedia URL is rewritten from
//     https://liquipedia.net/<path>?<query>
// to
//     <LP_WORKER_URL>/lp/<path>?<query>
// and the request carries `X-Proxy-Auth: <LP_WORKER_AUTH>` so the worker can
// reject requests from anyone else. The worker forwards the request from
// Cloudflare's edge IP, which isn't on Railway's blocked egress pool.
const LP_WORKER_URL = process.env.LP_WORKER_URL?.replace(/\/$/, '');
const LP_WORKER_AUTH = process.env.LP_WORKER_AUTH;

if (LP_WORKER_URL) {
  logger.info(`[LPScorer] LP proxy mode active — routing requests via ${LP_WORKER_URL}`);
}

/**
 * Rewrites a Liquipedia URL to go through the CF Worker proxy if configured.
 * No-op when LP_WORKER_URL is unset or the URL doesn't target liquipedia.net.
 *
 * Exported so the other LP scrapers (liquipediaScraper, liquipediaPlayer-
 * HistoryScraper) can route their traffic through the same worker.
 */
export function lpRouteUrl(targetUrl: string): string {
  if (!LP_WORKER_URL) return targetUrl;
  try {
    const u = new URL(targetUrl);
    if (u.hostname !== 'liquipedia.net') return targetUrl;
    return `${LP_WORKER_URL}/lp${u.pathname}${u.search}`;
  } catch {
    return targetUrl;
  }
}

function buildHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    'User-Agent': 'AgeOfMoney/1.0 (contact@ageofmoney.com)',
    'Accept-Encoding': 'gzip', // Liquipedia REQUIRES gzip (406 otherwise)
  };
  if (LP_API_KEY) h.Authorization = `Apikey ${LP_API_KEY}`;
  if (LP_WORKER_URL && LP_WORKER_AUTH) h['X-Proxy-Auth'] = LP_WORKER_AUTH;
  return h;
}

/**
 * Headers other LP scrapers can use to opt into the CF Worker proxy. Includes
 * X-Proxy-Auth when LP_WORKER_URL + LP_WORKER_AUTH are set; otherwise empty.
 * Spread it into existing axios headers, no-op when worker mode is off.
 */
export function lpProxyHeaders(): Record<string, string> {
  return LP_WORKER_URL && LP_WORKER_AUTH ? { 'X-Proxy-Auth': LP_WORKER_AUTH } : {};
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
let consecutiveNetErrors = 0;
const BACKOFF_MIN = [2, 5, 10, 20, 30, 60]; // minutes per consecutive failure (start at 2min)
const NET_ERROR_THRESHOLD = 5; // trip circuit breaker after this many consecutive network errors

/** Check if Liquipedia is currently blocked by the circuit breaker. */
export function isLpBlocked(): boolean { return Date.now() < lpBlockedUntil; }

export function tripCircuitBreaker(reason: '429' | 'network' = '429'): void {
  consecutive429s++;
  consecutiveNetErrors = 0; // reset net counter when breaker trips
  const idx = Math.min(consecutive429s - 1, BACKOFF_MIN.length - 1);
  const minutes = BACKOFF_MIN[idx];
  lpBlockedUntil = Date.now() + minutes * 60_000;
  logger.warn(`[LPScorer] ${reason === '429' ? '429' : 'Too many network errors'} from Liquipedia (${consecutive429s} consecutive) — circuit breaker open for ${minutes}min, no more LP requests until ${new Date(lpBlockedUntil).toISOString()}`);

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
 *  2. GET that unblock URL → returns HTML with a CAPTCHA + terms checkbox.
 *     LP now ships Cloudflare Turnstile (sitekey prefix "0x..."), but older
 *     pages used reCAPTCHA v2 (sitekey prefix "6L..."). We autodetect from the
 *     scraped sitekey and pick the correct 2captcha method + response field.
 *  3. Solve via 2captcha (Turnstile ≈ $0.001, reCAPTCHA v2 ≈ $0.003 per solve).
 *  4. POST the unblock URL with the right response field name + terms agreement.
 *  5. IP unblocked → verify with a real LP API request → reset circuit breaker.
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
    const tokenRes = await axios.get(lpRouteUrl('https://liquipedia.net/token/generate'), {
      headers: {
        'User-Agent': 'AgeOfMoney/1.0 (contact@ageofmoney.com)',
        ...(LP_WORKER_URL && LP_WORKER_AUTH ? { 'X-Proxy-Auth': LP_WORKER_AUTH } : {}),
      },
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
      logger.warn(`[LPScorer] Auto-unblock: CAPTCHA required but TWOCAPTCHA_API_KEY not set. Visit manually: ${unblockUrl}`);
      return { success: false, message: `CAPTCHA required, no 2captcha key. Manual URL: ${unblockUrl}` };
    }

    // ── Step 2: fetch the unblock page and scrape the CAPTCHA widget ──────
    // We fetch from Railway's IP so the page shows the CAPTCHA for that IP.
    // Capture cookies — MediaWiki sets a session cookie on the GET that the
    // matching POST must echo back to be accepted (otherwise the form submit
    // is treated as cookie-less and silently rejected).
    const unblockRes = await axios.get(lpRouteUrl(unblockUrl), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...(LP_WORKER_URL && LP_WORKER_AUTH ? { 'X-Proxy-Auth': LP_WORKER_AUTH } : {}),
      },
      timeout: 15000,
    });
    const unblockHtml = typeof unblockRes.data === 'string' ? unblockRes.data : '';
    const setCookieHeaders = unblockRes.headers['set-cookie'] ?? [];
    // Reduce each "name=value; Path=/; HttpOnly" line down to "name=value" and
    // join with "; " for a single Cookie header on the POST.
    const cookieHeader = (Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders])
      .map((c) => String(c).split(';')[0])
      .filter(Boolean)
      .join('; ');

    // Extract sitekey from data-sitekey="..." (no quotes around value in LP's HTML)
    const sitekeyMatch = unblockHtml.match(/data-sitekey=["']?([^"'\s>]+)["']?/);
    if (!sitekeyMatch) {
      logger.warn(`[LPScorer] Auto-unblock: could not find CAPTCHA sitekey. Page snippet: ${unblockHtml.slice(0, 500)}`);
      return { success: false, message: 'No CAPTCHA sitekey found on unblock page' };
    }
    const sitekey = sitekeyMatch[1];

    // ── DEBUG : enumerate every hidden input the form ships ───────────────
    // The agent investigation flagged "medium confidence" on missing CSRF
    // tokens / wpEditToken. Log them all once so we can see exactly what
    // LP renders without having to reproduce the blocked-IP scenario locally.
    const hiddenInputs = [...unblockHtml.matchAll(
      /<input[^>]*type=["']?hidden["']?[^>]*>/gi,
    )].map((m) => m[0]);
    if (hiddenInputs.length > 0) {
      logger.info(`[LPScorer] Auto-unblock: hidden inputs on form: ${hiddenInputs.join(' || ')}`);
    } else {
      logger.info(`[LPScorer] Auto-unblock: no <input type=hidden> matches found on the page`);
    }
    // Also log the form action attribute and the cookie names we captured.
    const formActionMatch = unblockHtml.match(/<form[^>]*action=["']([^"']+)["'][^>]*>/i);
    const cookieNames = (Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders])
      .map((c) => String(c).split('=')[0])
      .filter(Boolean)
      .join(',');
    logger.info(`[LPScorer] Auto-unblock: form action="${formActionMatch?.[1] ?? '(none)'}", cookies=[${cookieNames}]`);

    // Autodetect captcha type from sitekey prefix:
    //   "0x..." → Cloudflare Turnstile (method=turnstile, field=cf-turnstile-response)
    //   "6L..." → Google reCAPTCHA v2  (method=userrecaptcha, field=g-recaptcha-response)
    const isTurnstile = sitekey.startsWith('0x');
    const captchaKind = isTurnstile ? 'Turnstile' : 'reCAPTCHA';

    // Turnstile widgets sometimes ship data-action / data-cdata that must be
    // echoed back to 2captcha, otherwise the returned token is rejected by CF.
    // These are optional — only attached if present on the widget div.
    const actionMatch = isTurnstile
      ? unblockHtml.match(/data-action=["']?([^"'\s>]+)["']?/)
      : null;
    const cdataMatch = isTurnstile
      ? unblockHtml.match(/data-cdata=["']?([^"'\s>]+)["']?/)
      : null;

    // Extract the token from the hidden input (needed for the POST)
    const tokenMatch = unblockHtml.match(/name=["']?token["']?\s+value=["']?([^"'\s>]+)/);
    const formToken = tokenMatch?.[1] ?? '';

    logger.info(`[LPScorer] Auto-unblock: found ${captchaKind} sitekey (${sitekey.slice(0, 15)}...), sending to 2captcha...`);

    // ── Step 3: submit to 2captcha with the right method + param ──────────
    const submitParams: Record<string, string | number> = {
      key: CAPTCHA_KEY,
      method: isTurnstile ? 'turnstile' : 'userrecaptcha',
      pageurl: unblockUrl,
      json: 1,
    };
    if (isTurnstile) {
      submitParams.sitekey = sitekey;
      if (actionMatch?.[1]) submitParams.action = actionMatch[1];
      if (cdataMatch?.[1])  submitParams.data   = cdataMatch[1];
    } else {
      submitParams.googlekey = sitekey;
    }

    const submitRes = await axios.get('https://2captcha.com/in.php', {
      params: submitParams,
      timeout: 15000,
    });

    if (submitRes.data?.status !== 1) {
      return { success: false, message: `2captcha submit failed: ${JSON.stringify(submitRes.data)}` };
    }

    const taskId = submitRes.data.request;
    logger.info(`[LPScorer] Auto-unblock: 2captcha task ${taskId} (${captchaKind}), waiting for solution (~15-30s)...`);

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

    logger.info(`[LPScorer] Auto-unblock: ${captchaKind} solved, submitting to Liquipedia...`);

    // ── Step 4: POST to the SAME unblock URL we GET'd ─────────────────────
    // The route is `/token/unblock?token=<T>` — the token is validated from
    // the query string, NOT the form body. Earlier code POSTed to a bogus
    // `/unblock` path that silently resolved to the wiki homepage (200), so
    // axios never threw and we thought it succeeded while LP discarded the
    // submission. Body carries only the captcha solution + terms agreement.
    //
    // Turnstile    → cf-turnstile-response
    // reCAPTCHA v2 → g-recaptcha-response
    const responseField = isTurnstile ? 'cf-turnstile-response' : 'g-recaptcha-response';
    const formBody: Record<string, string> = {
      [responseField]: solution,
      agree: '1',
    };
    // Belt-and-suspenders : if the form had a hidden CSRF/edit token, echo
    // it back too. Harmless if the server ignores it.
    if (formToken) formBody.token = formToken;

    const postRes = await axios.post(lpRouteUrl(unblockUrl),
      new URLSearchParams(formBody).toString(),
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': unblockUrl,
          ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
          ...(LP_WORKER_URL && LP_WORKER_AUTH ? { 'X-Proxy-Auth': LP_WORKER_AUTH } : {}),
        },
        timeout: 15000,
        // Don't follow redirects — a 302 is the success signal here. With
        // maxRedirects:5 axios silently lands on the homepage and returns
        // 200, masking the actual response code.
        maxRedirects: 0,
        validateStatus: (s) => s < 500,
      }
    );
    logger.info(`[LPScorer] Auto-unblock: POST returned status=${postRes.status}, location=${postRes.headers?.location ?? '(none)'}`);

    // When the POST returns 200 instead of 302, LP rendered the form again
    // — usually with an error message in the HTML (e.g. "invalid token",
    // "captcha failed", "session expired"). Log a snippet of the body so
    // we can diagnose without having to reproduce the blocked-IP state.
    if (postRes.status === 200 && typeof postRes.data === 'string') {
      // Extract the most useful chunk : any error class or success message,
      // falling back to first 400 chars of the visible body.
      const errMatch = postRes.data.match(
        /<div[^>]*class=["'][^"']*(?:error|warning|success|notice)[^"']*["'][^>]*>([\s\S]{0,400}?)<\/div>/i,
      );
      const snippet = errMatch?.[1]?.replace(/\s+/g, ' ').trim()
        ?? postRes.data.replace(/\s+/g, ' ').slice(0, 400);
      logger.info(`[LPScorer] Auto-unblock: POST 200 body snippet: ${snippet}`);
    }

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
    const res = await axios.get(lpRouteUrl(LP_API_FOR('ageofempires')), {
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
  consecutiveNetErrors = 0;
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

  // Track consecutive network errors — if LP is resetting connections (not 429),
  // we still need to back off. Trip the circuit breaker after N consecutive failures.
  consecutiveNetErrors++;
  if (consecutiveNetErrors >= NET_ERROR_THRESHOLD) {
    tripCircuitBreaker('network');
    return null; // don't retry, breaker is open
  }

  const errMsg = error instanceof Error ? error.message : String(error);
  if (jobInfo.retryCount < 1) {
    logger.warn(`[LPScorer] Request failed (attempt ${jobInfo.retryCount + 1}), retrying in 5s: ${errMsg}`);
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
    const res = await lpLimiter.schedule(() => axios.get(lpRouteUrl(LP_API_FOR(wikiPath)), {
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
      tripCircuitBreaker('429');
    } else {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn(`[LPScorer] Failed to fetch wikitext for "${wikiPath}/${page}": ${errMsg}`);
    }
    return null;
  }
}

// ── Rendered HTML fallback ─────────────────────────────────────────────────
// Bracket-based pages use Lua modules that store scores in data sub-pages.
// The raw wikitext has {{Match}} placeholders with 0-0 scores, while the
// rendered HTML shows the real scores. When wikitext parsing finds nothing
// useful, we fall back to parsing the rendered bracket HTML.

const htmlCache: Record<string, { text: string; fetchedAt: number }> = {};

async function fetchRenderedHtml(wikiPath: string, page: string): Promise<string | null> {
  if (Date.now() < lpBlockedUntil) return null;
  const cacheKey = `html:${wikiPath}:${page}`;
  const now = Date.now();
  if (htmlCache[cacheKey] && now - htmlCache[cacheKey].fetchedAt < CACHE_TTL) {
    return htmlCache[cacheKey].text;
  }
  try {
    const res = await lpLimiter.schedule(() => axios.get(lpRouteUrl(LP_API_FOR(wikiPath)), {
      params: { action: 'parse', page, prop: 'text', format: 'json' },
      headers: buildHeaders(),
      timeout: 20000,
      responseType: 'arraybuffer',
      decompress: false,
    }));
    if (res.status === 429) { tripCircuitBreaker(); return null; }
    let jsonStr: string;
    try {
      const decompressed = await gunzip(res.data as Buffer);
      jsonStr = decompressed.toString('utf-8');
    } catch {
      jsonStr = Buffer.from(res.data as Buffer).toString('utf-8');
    }
    const parsed = JSON.parse(jsonStr);
    const html = parsed?.parse?.text?.['*'] ?? null;
    if (html) htmlCache[cacheKey] = { text: html, fetchedAt: Date.now() };
    resetCircuitBreaker();
    return html;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 429) tripCircuitBreaker();
    return null;
  }
}

/**
 * Parse bracket scores from the rendered HTML. The bracket renders as nested
 * divs with class "bracket-game" containing player names and scores.
 * Returns the same LpMatch shape for compatibility with the rest of the scorer.
 */
function parseBracketHtml(html: string): LpMatch[] {
  const results: LpMatch[] = [];

  // LP bracket cells: each match is a <div class="bracket-popup-wrapper"> or
  // the bracket row has two opponent divs. We look for the simplified bracket
  // row pattern: pairs of opponent-name + score inside the bracket table.
  //
  // Pattern: bracket cells contain:
  //   <span class="name">PlayerName</span> ... <span class="...score...">3</span>
  //   <span class="name">PlayerName</span> ... <span class="...score...">0</span>
  //
  // We also handle the common LP bracket HTML structure where each match row has:
  //   <div ...> <span>Player1</span> <span>score1</span> </div>
  //   <div ...> <span>Player2</span> <span>score2</span> </div>

  // Strategy: find all bracket-game blocks, each containing two opponents with scores
  // LP uses .bracket-cell-r* and .bracket-cell-l* classes for bracket entries.
  // Each match pair has the structure:
  //   <span class="team-template-text"><a ...>Name</a></span> ... score
  // Simplified: extract all player+score pairs from bracket rows.

  // Regex approach: find opponent rows in bracket HTML
  // Each bracket entry has: team-template-text with player name, then a score nearby
  const bracketRowRegex = /<span[^>]*class="[^"]*team-template-text[^"]*"[^>]*>.*?<a[^>]*>([^<]+)<\/a>.*?<\/span>.*?<span[^>]*class="[^"]*bracket-score[^"]*"[^>]*>(\d+|W|L|FF)?<\/span>/gs;

  const pairs: Array<{ name: string; score: number }> = [];
  let rm;
  while ((rm = bracketRowRegex.exec(html)) !== null) {
    const name = rm[1].trim();
    const scoreStr = rm[2]?.trim() ?? '';
    const score = /^\d+$/.test(scoreStr) ? parseInt(scoreStr, 10) : 0;
    pairs.push({ name, score });
  }

  // Group into consecutive pairs (each match = 2 consecutive entries)
  for (let i = 0; i + 1 < pairs.length; i += 2) {
    const a = pairs[i];
    const b = pairs[i + 1];
    if (!a.name || !b.name) continue;
    const bestof = Math.max(a.score, b.score) > 0 ? (Math.max(a.score, b.score) * 2 - 1) : 5;
    results.push({
      opponent1: a.name,
      opponent2: b.name,
      date: '',
      bestof,
      maps: [],
      p1Score: a.score,
      p2Score: b.score,
      finishedMaps: a.score + b.score,
      walkover: false,
    });
  }

  // Fallback: try simpler table-based bracket format (some LP pages use tables)
  if (results.length === 0) {
    // Look for bracket table cells with player names and scores
    // Pattern: <td ...>PlayerName</td> ... <td ...>score</td>
    const cellRegex = /<span[^>]*class="[^"]*name[^"]*"[^>]*>.*?<a[^>]*>([^<]+)<\/a>.*?<\/span>/gs;
    const scoreRegex = /<span[^>]*class="[^"]*score[^"]*"[^>]*>(\d+|W|L|FF)?<\/span>/gs;
    const names: string[] = [];
    const scores: number[] = [];
    let cm;
    while ((cm = cellRegex.exec(html)) !== null) names.push(cm[1].trim());
    while ((cm = scoreRegex.exec(html)) !== null) {
      const s = cm[1]?.trim() ?? '';
      scores.push(/^\d+$/.test(s) ? parseInt(s, 10) : 0);
    }
    for (let i = 0; i + 1 < names.length && i + 1 < scores.length; i += 2) {
      if (!names[i] || !names[i + 1]) continue;
      results.push({
        opponent1: names[i],
        opponent2: names[i + 1],
        date: '',
        bestof: 5,
        maps: [],
        p1Score: scores[i] ?? 0,
        p2Score: scores[i + 1] ?? 0,
        finishedMaps: (scores[i] ?? 0) + (scores[i + 1] ?? 0),
        walkover: false,
      });
    }
  }

  return results;
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

    // Signal 3: count |winner=1 / |winner=2 INSIDE nested templates only (depth≥2).
    // The {{Match}} block itself has a top-level |winner=N marking the overall winner —
    // counting it alongside map winners inflates the score by 1 (3-0 shows as 4-0).
    // depth≥2 means we're inside a nested {{Map}}, {{Game}}, etc. sub-template.
    let countedWinner1 = 0;
    let countedWinner2 = 0;
    {
      let depth = 0;
      for (let i = 0; i < block.length; i++) {
        if (block[i] === '{' && block[i + 1] === '{') { depth++; i++; continue; }
        if (block[i] === '}' && block[i + 1] === '}') { depth--; i++; continue; }
        // depth 1 = top-level Match params; depth≥2 = inside a map sub-template
        if (depth >= 2 && block[i] === '|') {
          const sub = block.slice(i + 1, i + 25);
          const wm = sub.match(/^winner\s*=\s*([12])/);
          if (wm) {
            if (wm[1] === '1') countedWinner1++;
            else countedWinner2++;
          }
        }
      }
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
      tournament: { select: { name: true, liquipediaUrl: true, tier: true } },
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
    // Flag this match as a wikitext miss for the current cycle. runScorer
    // aggregates these at the end of the cycle and applies the threshold +
    // LP-outage logic (see currentCycleWikitextMisses).
    currentCycleWikitextMisses.add(matchId);
    return;
  }

  // Wikitext fetched successfully — reset the miss counter in case we had
  // a transient 404 run that's now recovered (admin fixed the URL, etc.).
  matchWikitextMissCount.delete(matchId);

  let lpMatches = parseMatches(wikitext);
  logger.info(`[LPScorer] Match ${matchId}: parsed ${lpMatches.length} match blocks from "${page}"`);

  // Find the match that corresponds to our DB match
  let lpMatch = lpMatches.find(lm =>
    (namesMatch(lm.opponent1, match.player1.name) && namesMatch(lm.opponent2, match.player2.name)) ||
    (namesMatch(lm.opponent1, match.player2.name) && namesMatch(lm.opponent2, match.player1.name))
  );

  // ── HTML fallback for bracket pages ──────────────────────────────────────
  // If we found the match in wikitext but both scores are 0, the page likely
  // uses a Lua bracket module with scores in data sub-pages. Try the rendered
  // HTML which has the actual scores after Lua expansion.
  if (lpMatch && lpMatch.p1Score === 0 && lpMatch.p2Score === 0) {
    const wikiPath2 = urlWikiPath;
    const renderedHtml = await fetchRenderedHtml(wikiPath2, page);
    if (renderedHtml) {
      const htmlMatches = parseBracketHtml(renderedHtml);
      if (htmlMatches.length > 0) {
        const htmlMatch = htmlMatches.find(lm =>
          (namesMatch(lm.opponent1, match.player1.name) && namesMatch(lm.opponent2, match.player2.name)) ||
          (namesMatch(lm.opponent1, match.player2.name) && namesMatch(lm.opponent2, match.player1.name))
        );
        if (htmlMatch && (htmlMatch.p1Score + htmlMatch.p2Score > 0)) {
          logger.info(`[LPScorer] Match ${matchId}: wikitext had 0-0, HTML fallback found ${htmlMatch.p1Score}-${htmlMatch.p2Score} (${htmlMatch.opponent1} vs ${htmlMatch.opponent2})`);
          lpMatch = htmlMatch;
        }
      }
    }
  }

  if (!lpMatch) {
    // Track consecutive misses — auto-cancel ghost matches that will never resolve
    const missCount = (matchNotFoundCount.get(matchId) ?? 0) + 1;
    matchNotFoundCount.set(matchId, missCount);

    // Fast-path : if the match is already > 1 h past scheduledAt AND we
    // got a parseable wikitext (lpMatches.length > 0 = page format is OK,
    // our pair is just absent), this is a ghost — the LP page genuinely
    // doesn't list this matchup. Cancel immediately rather than waiting
    // NOT_FOUND_CANCEL_THRESHOLD cycles. Survives Railway redeploys
    // (which reset the in-memory counter) since the decision is made
    // off match.scheduledAt, a persisted field.
    const now = Date.now();
    const ageMs = now - match.scheduledAt.getTime();
    const fastCancel = ageMs > 60 * 60_000 && lpMatches.length > 0;

    if (missCount <= 3 || missCount === NOT_FOUND_CANCEL_THRESHOLD || fastCancel) {
      const pairs = lpMatches.map(m => `${m.opponent1} vs ${m.opponent2}`).join(' | ');
      logger.info(`[LPScorer] Match ${matchId}: "${match.player1.name}" vs "${match.player2.name}" NOT FOUND in LP wikitext (miss ${missCount}/${NOT_FOUND_CANCEL_THRESHOLD}, age=${Math.round(ageMs / 60_000)}min, fast=${fastCancel}). LP has ${lpMatches.length} matches: [${pairs}]`);
    }

    if (missCount >= NOT_FOUND_CANCEL_THRESHOLD || fastCancel) {
      // Ghost match — cancel and refund
      logger.warn(`[LPScorer] Match ${matchId}: "${match.player1.name}" vs "${match.player2.name}" NOT FOUND${fastCancel ? ' (fast-cancel: page parses but pair absent and >1h past start)' : ` after ${missCount} checks`} — auto-cancelling + refunding bets`);
      const { refundBets } = await import('./betService');
      await prisma.match.update({
        where: { id: matchId },
        data: { status: 'CANCELLED', betsOpen: false },
      });
      await refundBets(matchId, `Match annulé — données incorrectes ("${match.player1.name}" vs "${match.player2.name}" introuvable sur Liquipedia)`);
      const io = getIo();
      io?.emit('matchUpdate', { matchId, status: 'CANCELLED' });
      matchNotFoundCount.delete(matchId);
    }
    return;
  }

  // Match found — clear any prior miss count
  matchNotFoundCount.delete(matchId);

  // Determine which way around the players are
  const reversed = namesMatch(lpMatch.opponent1, match.player2.name);
  const p1Score = reversed ? lpMatch.p2Score : lpMatch.p1Score;
  const p2Score = reversed ? lpMatch.p1Score : lpMatch.p2Score;

  // DB format is usually authoritative (LP bestof from parsed wikitext can
  // be missing). BUT : when a player's LP score exceeds what the DB format
  // can physically produce (e.g. DB says BO5 / dbNeeded=3 but LP shows 4
  // wins), the DB format is DEMONSTRABLY wrong and we self-correct. Typical
  // cause : the bracket overview at scrape time labelled early rounds
  // "Bo5" while the playoff match on its own detail page is actually "Bo7".
  // See liquipediaScraper.ts:488 for the initial-parse fallback that
  // missed the true format.
  let boNum = parseInt(match.format.replace(/\D/g, ''), 10) || 3;
  let dbNeeded = Math.ceil(boNum / 2);
  if (lpMatch.bestof >= 3 && lpMatch.bestof > boNum && Math.max(p1Score, p2Score) > dbNeeded) {
    const correctedBo = lpMatch.bestof;
    logger.warn(
      `[LPScorer] Match ${matchId}: auto-correcting format BO${boNum} → BO${correctedBo} ` +
      `(LP score ${p1Score}-${p2Score} exceeds BO${boNum} max)`,
    );
    await prisma.match.update({
      where: { id: matchId },
      data: { format: `BO${correctedBo}` },
    });
    match.format = `BO${correctedBo}`;
    boNum = correctedBo;
    dbNeeded = Math.ceil(boNum / 2);
  }
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

  // Even BO draw (BO2 1-1, BO4 2-2, etc.): match completed with no winner.
  // Model change (2026-04): we now run a 2-way "void on draw" market — on
  // a draw, ALL bets are refunded (stake returned). This matches the
  // Pinnacle/CSGOEmpire convention for BO2 markets. Legacy draw bets
  // (selectedPlayer=0) are also refunded — cleaner than paying them out in
  // a model we no longer offer.
  if (isBO2Draw) {
    const resultScore = `${p1Score}-${p2Score}`;
    logger.info(`[LPScorer] Match ${matchId}: even BO draw (${resultScore}) — refunding all bets (void-on-draw market)`);
    await prisma.match.update({
      where: { id: matchId },
      data: { p1Score, p2Score, status: 'COMPLETED', resultScore, betsOpen: false, currentGameId: null },
    });
    await refundBets(matchId, `Match nul ${resultScore} — paris remboursés (void on draw)`);

    // Phase 2 : draw = score 0.5 côté Glicko (Phase 4 : tier-weighted)
    if (process.env.ODDS_ENGINE_V2_ENABLED === 'true') {
      try {
        const { updateBothPlayersForMatch } = await import('./ratingEngine');
        await updateBothPlayersForMatch(match.player1.id, match.player2.id, 0.5, match.tournament?.tier);
      } catch (err) { logger.warn('[LPScorer] Glicko update (draw) failed:', err); }
    }

    // Store the draw outcome in PlayerMatchRecord so the odds model can learn
    // empirical draw rates. Without this, the training data contains zero
    // draws and the model systematically under-predicts them.
    const tournamentName = match.tournament?.name ?? 'Tournament';
    for (const [playerId, opponentId, opponentName] of [
      [match.player1.id, match.player2.id, match.player2.name],
      [match.player2.id, match.player1.id, match.player1.name],
    ] as [string, string, string][]) {
      await prisma.playerMatchRecord.upsert({
        where: {
          playerId_opponentName_tournamentName_matchDate: {
            playerId, opponentName, tournamentName, matchDate: match.scheduledAt,
          },
        },
        create: {
          playerId, opponentName, opponentId,
          game: match.game,
          won: false, // neither player won the series
          score: resultScore,
          tournamentName,
          matchDate: match.scheduledAt,
          format: match.format,
          source: 'platform',
          confidence: 1.0,
        },
        update: { won: false, score: resultScore, game: match.game },
      }).catch(() => {});
    }

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
    // organically as platform matches complete.
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

    // Phase 2 : mise à jour Glicko-2 ratings (gated par V2 flag).
    if (process.env.ODDS_ENGINE_V2_ENABLED === 'true') {
      try {
        const { updateBothPlayersForMatch } = await import('./ratingEngine');
        const outcome = resolvedWinnerId === match.player1.id ? 1 : 0;
        await updateBothPlayersForMatch(match.player1.id, match.player2.id, outcome, match.tournament?.tier);
      } catch (err) { logger.warn('[LPScorer] Glicko update failed:', err); }
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

// Track consecutive "NOT FOUND" per match — auto-cancel ghost matches that
// the scorer can never resolve instead of waiting 8h.
const matchNotFoundCount = new Map<string, number>();
const NOT_FOUND_CANCEL_THRESHOLD = 10; // cancel after ~5 min of polling (10 × 30s)

// ── Wikitext-unfetchable safety net ────────────────────────────────────────
// If we can never fetch the wikitext at all (404 Liquipedia page — typical
// when the stored liquipediaUrl is a bad mint from the AoE events calendar),
// the old path just logged and returned → match stayed LIVE until the 8h
// tickMatchStatuses timeout. Instead, count consecutive wikitext-fetch
// failures per match and auto-cancel + refund after WIKITEXT_MISS_THRESHOLD.
//
// Two guardrails prevent false positives:
//   - Only count misses AFTER scheduledAt + grace window (pre-start glitches
//     aren't the scorer's problem).
//   - If ≥ LP_OUTAGE_THRESHOLD different matches miss wikitext on the SAME
//     cycle, assume Liquipedia itself is down and skip all increments this
//     round.
const matchWikitextMissCount = new Map<string, { misses: number; firstMissAt: number }>();
const WIKITEXT_MISS_THRESHOLD     = 15;       // 15 consecutive cycles
const WIKITEXT_MISS_GRACE_MS      = 30 * 60_000; // only count misses ≥ 30 min past scheduledAt
const LP_OUTAGE_THRESHOLD         = 3;        // ≥3 distinct matches missing in same cycle = LP down
// Per-cycle buffer — populated by syncMatchScore, consumed by runScorer.
let currentCycleWikitextMisses: Set<string> = new Set();

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

// State for the periodic "breaker open" log + auto-unblock retry. Both are
// rate-limited to once every BLOCKER_RETRY_INTERVAL_MS so we don't spam Railway
// logs (one entry every 5 min while blocked) and don't burn 2captcha credits
// on a tight loop.
let lastBlockerLogAt = 0;
let lastUnblockRetryAt = 0;
const BLOCKER_LOG_INTERVAL_MS = 5 * 60_000;
const UNBLOCK_RETRY_INTERVAL_MS = 5 * 60_000;

function maybeLogBlockerStatus(): void {
  const now = Date.now();
  if (now - lastBlockerLogAt < BLOCKER_LOG_INTERVAL_MS) return;
  lastBlockerLogAt = now;
  const remainingMin = Math.max(0, Math.round((lpBlockedUntil - now) / 60_000));
  logger.info(`[LPScorer] Circuit breaker still open — ${remainingMin}min remaining (until ${new Date(lpBlockedUntil).toISOString()})`);
}

function maybeRetryAutoUnblock(): void {
  if (!process.env.TWOCAPTCHA_API_KEY) return;
  const now = Date.now();
  if (now - lastUnblockRetryAt < UNBLOCK_RETRY_INTERVAL_MS) return;
  lastUnblockRetryAt = now;
  logger.info('[LPScorer] Retrying auto-unblock (breaker still open, periodic retry)');
  attemptAutoUnblock().then((result) => {
    if (result.success) {
      logger.info(`[LPScorer] Auto-unblock retry succeeded: ${result.message}`);
    } else {
      logger.warn(`[LPScorer] Auto-unblock retry failed: ${result.message}`);
    }
  }).catch((err) => logger.warn(`[LPScorer] Auto-unblock retry error: ${err.message}`));
}

export function startLiquipediaLiveScorer(): void {
  if (scorerTimeout) return;
  logger.info('[LPScorer] Starting Liquipedia live scorer (adaptive interval, 30s base)');
  runScorer();
}

/**
 * Consume this cycle's wikitext-miss set :
 *   - If ≥ LP_OUTAGE_THRESHOLD distinct matches missed, assume Liquipedia
 *     itself is down, log once, and skip all counter increments this round.
 *   - Otherwise bump each match's persistent counter. Once a match has
 *     missed WIKITEXT_MISS_THRESHOLD cycles in a row AND is at least
 *     WIKITEXT_MISS_GRACE_MS past scheduledAt, auto-cancel + refund it.
 *
 * Extracted so runScorer stays readable and the counter map stays local to
 * this module.
 */
async function evaluateWikitextMisses(misses: Set<string>): Promise<void> {
  if (misses.size === 0) return;

  if (misses.size >= LP_OUTAGE_THRESHOLD) {
    logger.warn(
      `[LPScorer] Detected likely LP outage (${misses.size} matches missing wikitext simultaneously), skipping miss counter this cycle`,
    );
    return;
  }

  const now = Date.now();
  for (const matchId of misses) {
    // Fetch the match to check its age — pre-scheduledAt or in the grace
    // window, wikitext misses are often transient (tournament page not
    // published yet, bracket generating, etc.) and shouldn't count.
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      select: {
        id: true, status: true, scheduledAt: true, liquipediaUrl: true,
        player1: { select: { name: true } },
        player2: { select: { name: true } },
        tournament: { select: { liquipediaUrl: true } },
      },
    });
    if (!match || match.status !== 'LIVE') {
      matchWikitextMissCount.delete(matchId);
      continue;
    }
    if (match.scheduledAt.getTime() + WIKITEXT_MISS_GRACE_MS > now) {
      // Too early — don't count.
      continue;
    }

    const prior = matchWikitextMissCount.get(matchId);
    const misses2 = (prior?.misses ?? 0) + 1;
    const firstMissAt = prior?.firstMissAt ?? now;
    matchWikitextMissCount.set(matchId, { misses: misses2, firstMissAt });

    if (misses2 >= WIKITEXT_MISS_THRESHOLD) {
      const badUrl = match.liquipediaUrl ?? match.tournament?.liquipediaUrl ?? '(none)';
      logger.warn(
        `[LPScorer] Match ${matchId} auto-cancelled after ${misses2} consecutive wikitext fetch failures (URL: ${badUrl})`,
      );
      try {
        await prisma.match.update({
          where: { id: matchId },
          data: { status: 'CANCELLED', betsOpen: false, verificationFlag: false },
        });
        const { refundBets } = await import('./betService');
        await refundBets(
          matchId,
          `Match annulé — Liquipedia URL introuvable (${match.player1.name} vs ${match.player2.name}). Si le match a bien eu lieu, un admin doit corriger l'URL manuellement.`,
        );
        const io = getIo();
        io?.emit('matchUpdate', { matchId, status: 'CANCELLED' });
      } catch (err) {
        logger.error(`[LPScorer] Failed to auto-cancel ${matchId}:`, err);
      } finally {
        matchWikitextMissCount.delete(matchId);
      }
    }
  }
}

async function runScorer(): Promise<void> {
  try {
    // Circuit breaker: if we're blocked, skip this cycle but periodically
    // (a) log the remaining time so the silence is observable, and (b) retry
    // the auto-unblock — the original "fire once at trip" strategy meant a
    // single transient 2captcha hiccup left the scorer mute for the full
    // 60 min breaker window. We retry every 5 min until either the unblock
    // succeeds (resetCircuitBreaker) or the breaker expires naturally.
    if (Date.now() < lpBlockedUntil) {
      maybeLogBlockerStatus();
      maybeRetryAutoUnblock();
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
    currentCycleWikitextMisses = new Set();
    await Promise.all(liveMatches.map((m: any) => syncMatchScore(m.id)));

    // ── Wikitext-miss evaluation pass ────────────────────────────────────
    // syncMatchScore populates currentCycleWikitextMisses when a match's LP
    // page 404s / times out. Evaluate all misses in a single pass so the
    // "LP outage" heuristic has a complete view of this cycle.
    await evaluateWikitextMisses(currentCycleWikitextMisses);

    // Schedule next cycle
    scorerTimeout = setTimeout(runScorer, interval);
  } catch (err) {
    // Log message only — passing raw error objects to winston can crash
    // safe-stable-stringify when the error wraps a TLS socket (circular refs).
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(`[LPScorer] runScorer error: ${errMsg}`);
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
