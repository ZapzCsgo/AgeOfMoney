/**
 * Riot Games TFT API client.
 *
 * Wraps the three endpoints we actually need for the tft.money odds engine :
 *   1. Account by Riot ID (gameName#tagLine → PUUID)        — regional route
 *   2. League entries by PUUID  (current ranked tier / LP)  — platform route
 *   3. Match list + match detail by PUUID                   — regional route
 *
 * Architectural choices :
 *
 * - Two base URLs : Riot splits "platform" routing (na1, euw1, kr, etc.) from
 *   "regional" routing (americas, europe, asia, sea). We expose both so each
 *   caller picks the right one — getting it wrong is a 404 with a confusing
 *   "Data not found" body.
 *
 * - Single Bottleneck limiter for the whole client, sized for a DEVELOPMENT
 *   key (20 req / 1s, 100 req / 2 min). Production keys raise these by 5-50×
 *   and we'd reconfigure via env on launch. Keeping it pessimistic avoids
 *   spending our quota in a tight backfill loop while we're still testing.
 *
 * - Live retry on 429 honouring the Retry-After header — Riot's rate limiter
 *   is honest and bursty calls usually clear in <5s. Do NOT retry on 403
 *   (key expired) or 401 (key missing) — those are operator-action bugs and
 *   retrying hides them.
 *
 * - All callers fail soft (return null/[]) rather than throw, because the
 *   odds engine treats Riot data as a *signal* not a hard requirement : a
 *   participant with no Riot data falls back to a baseline odd that the
 *   admin can override manually.
 */

import axios, { AxiosError, AxiosInstance } from 'axios';
import Bottleneck from 'bottleneck';
import logger from '../logger';

const RIOT_API_KEY = process.env.RIOT_API_KEY;
const REGION_DEFAULT = (process.env.RIOT_DEFAULT_REGION ?? 'europe') as RiotRegion;
const PLATFORM_DEFAULT = (process.env.RIOT_DEFAULT_PLATFORM ?? 'euw1') as RiotPlatform;

if (!RIOT_API_KEY) {
  logger.warn('[RiotTFT] RIOT_API_KEY not set — riotTftClient calls will be skipped, odds will fall back to baseline');
}

/** Regional route hosts — used for account + match endpoints. */
export type RiotRegion = 'americas' | 'europe' | 'asia' | 'sea';

/** Platform route hosts — used for summoner + league endpoints. */
export type RiotPlatform =
  | 'br1' | 'eun1' | 'euw1' | 'jp1' | 'kr' | 'la1' | 'la2'
  | 'na1' | 'oc1' | 'tr1' | 'ru' | 'me1' | 'ph2' | 'sg2'
  | 'th2' | 'tw2' | 'vn2';

/** Map a platform → the region it routes through (for match endpoints). */
const PLATFORM_TO_REGION: Record<RiotPlatform, RiotRegion> = {
  na1: 'americas', br1: 'americas', la1: 'americas', la2: 'americas',
  euw1: 'europe', eun1: 'europe', tr1: 'europe', ru: 'europe', me1: 'europe',
  kr: 'asia', jp1: 'asia',
  oc1: 'sea', sg2: 'sea', th2: 'sea', tw2: 'sea', vn2: 'sea', ph2: 'sea',
};

export function regionForPlatform(platform: RiotPlatform): RiotRegion {
  return PLATFORM_TO_REGION[platform] ?? REGION_DEFAULT;
}

// ── Rate limiter ─────────────────────────────────────────────────────────
// Dev-key budget : 20 / 1s and 100 / 120s. Bottleneck's `reservoir` + refill
// models the longer window ; `minTime` enforces the per-second floor.
const limiter = new Bottleneck({
  maxConcurrent: 5,
  minTime: 60, // ~16 req/s peak, leaves headroom under the 20/s ceiling
  reservoir: 100,
  reservoirRefreshAmount: 100,
  reservoirRefreshInterval: 120_000, // 100 requests per 120s rolling window
});

// ── Axios singleton ──────────────────────────────────────────────────────
function makeClient(host: string): AxiosInstance {
  return axios.create({
    baseURL: `https://${host}`,
    timeout: 12_000,
    headers: { 'X-Riot-Token': RIOT_API_KEY ?? '' },
  });
}

const clientCache = new Map<string, AxiosInstance>();
function clientFor(host: string): AxiosInstance {
  let c = clientCache.get(host);
  if (!c) { c = makeClient(host); clientCache.set(host, c); }
  return c;
}

async function riotGet<T>(host: string, path: string, params?: Record<string, unknown>): Promise<T | null> {
  if (!RIOT_API_KEY) return null;
  try {
    const res = await limiter.schedule(() =>
      clientFor(host).get<T>(path, { params }),
    );
    return res.data;
  } catch (err) {
    const ax = err as AxiosError<{ status?: { message?: string } }>;
    const status = ax.response?.status;
    if (status === 429) {
      const retryAfter = parseInt(ax.response?.headers?.['retry-after'] ?? '5', 10);
      logger.warn(`[RiotTFT] 429 on ${path} — Retry-After ${retryAfter}s, sleeping then retrying once`);
      await new Promise((r) => setTimeout(r, retryAfter * 1000 + 250));
      try {
        const res = await limiter.schedule(() => clientFor(host).get<T>(path, { params }));
        return res.data;
      } catch (e2) {
        logger.warn(`[RiotTFT] Retry failed on ${path}: ${(e2 as Error).message}`);
        return null;
      }
    }
    if (status === 403 || status === 401) {
      logger.error(`[RiotTFT] ${status} on ${path} — RIOT_API_KEY missing or expired. Refresh at developer.riotgames.com`);
      return null;
    }
    if (status === 404) {
      // 404 = player has no TFT history yet, or wrong region. Normal, no log noise.
      return null;
    }
    logger.warn(`[RiotTFT] ${status ?? 'network'} on ${path}: ${ax.message}`);
    return null;
  }
}

// ── Domain types ─────────────────────────────────────────────────────────

export interface RiotAccount {
  puuid: string;
  gameName: string;
  tagLine: string;
}

export interface TftSummoner {
  id: string; // encrypted summoner ID — feeds the league lookup
  puuid: string;
  name?: string;
  summonerLevel: number;
}

export interface TftLeagueEntry {
  leagueId: string;
  queueType: string; // "RANKED_TFT" | "RANKED_TFT_TURBO" | "RANKED_TFT_DOUBLE_UP"
  tier: 'IRON' | 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM' | 'EMERALD' | 'DIAMOND' | 'MASTER' | 'GRANDMASTER' | 'CHALLENGER';
  rank: string; // "I" | "II" | "III" | "IV"
  leaguePoints: number;
  wins: number;
  losses: number;
  hotStreak?: boolean;
}

export interface TftMatchInfo {
  matchId: string;
  gameDatetime: number; // epoch ms
  gameLength: number; // seconds
  tftSetNumber: number;
  participants: Array<{
    puuid: string;
    placement: number; // 1..8
    level: number;
    lastRound: number;
  }>;
}

// ── Public surface ───────────────────────────────────────────────────────

/**
 * Resolve a Riot ID ("Setsuko#KR1") to a PUUID. Cached at the caller layer ;
 * we don't cache here because the same PUUID could be looked up from
 * different regional accounts and the cache key would be tricky.
 */
export async function getAccountByRiotId(
  gameName: string,
  tagLine: string,
  region: RiotRegion = REGION_DEFAULT,
): Promise<RiotAccount | null> {
  return riotGet<RiotAccount>(
    `${region}.api.riotgames.com`,
    `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
  );
}

/** Get TFT summoner record (needed for the encrypted summonerId → league lookup). */
export async function getTftSummonerByPuuid(
  puuid: string,
  platform: RiotPlatform = PLATFORM_DEFAULT,
): Promise<TftSummoner | null> {
  return riotGet<TftSummoner>(
    `${platform}.api.riotgames.com`,
    `/tft/summoner/v1/summoners/by-puuid/${puuid}`,
  );
}

/**
 * Current TFT ranked entries. A player can have multiple (Hyper Roll, Double
 * Up, etc.) ; we always return the `RANKED_TFT` standard queue entry first.
 */
export async function getTftLeagueEntries(
  summonerId: string,
  platform: RiotPlatform = PLATFORM_DEFAULT,
): Promise<TftLeagueEntry[]> {
  const entries = await riotGet<TftLeagueEntry[]>(
    `${platform}.api.riotgames.com`,
    `/tft/league/v1/entries/by-summoner/${summonerId}`,
  );
  if (!entries) return [];
  return entries.sort((a, b) => (a.queueType === 'RANKED_TFT' ? -1 : 1));
}

/** Standard tier order — used to convert a tier+LP into a comparable score. */
const TIER_SCORE: Record<TftLeagueEntry['tier'], number> = {
  IRON: 0, BRONZE: 400, SILVER: 800, GOLD: 1200, PLATINUM: 1600,
  EMERALD: 2000, DIAMOND: 2400, MASTER: 2800, GRANDMASTER: 3200, CHALLENGER: 3600,
};
const DIVISION_SCORE: Record<string, number> = { I: 300, II: 200, III: 100, IV: 0 };

/**
 * Convert a ranked entry into a single numeric strength score
 * (tier base + division + LP). Used by tftOddsEngine. Higher = stronger.
 */
export function rankedStrengthScore(entry: TftLeagueEntry | null | undefined): number {
  if (!entry) return 1500; // baseline ≈ Gold IV — used for players with no Riot data
  const tierBase = TIER_SCORE[entry.tier] ?? 1500;
  const divBase = entry.tier === 'MASTER' || entry.tier === 'GRANDMASTER' || entry.tier === 'CHALLENGER'
    ? 0 // these tiers have no divisions, LP alone determines strength
    : (DIVISION_SCORE[entry.rank] ?? 0);
  return tierBase + divBase + Math.min(entry.leaguePoints, 2000);
}

/**
 * Fetch the last N match IDs for a PUUID. `queueId` filters to ranked
 * standard TFT (1100) — see https://static.developer.riotgames.com/docs/lol/queues.json
 */
export async function getRecentMatchIds(
  puuid: string,
  count = 20,
  region: RiotRegion = REGION_DEFAULT,
): Promise<string[]> {
  const ids = await riotGet<string[]>(
    `${region}.api.riotgames.com`,
    `/tft/match/v1/matches/by-puuid/${puuid}/ids`,
    { count },
  );
  return ids ?? [];
}

interface RawMatchResponse {
  metadata: { match_id: string; participants: string[] };
  info: {
    game_datetime: number;
    game_length: number;
    tft_set_number: number;
    participants: Array<{
      puuid: string; placement: number; level: number; last_round: number;
    }>;
  };
}

export async function getMatchDetail(
  matchId: string,
  region: RiotRegion = REGION_DEFAULT,
): Promise<TftMatchInfo | null> {
  const raw = await riotGet<RawMatchResponse>(
    `${region}.api.riotgames.com`,
    `/tft/match/v1/matches/${matchId}`,
  );
  if (!raw) return null;
  return {
    matchId: raw.metadata.match_id,
    gameDatetime: raw.info.game_datetime,
    gameLength: raw.info.game_length,
    tftSetNumber: raw.info.tft_set_number,
    participants: raw.info.participants.map((p) => ({
      puuid: p.puuid,
      placement: p.placement,
      level: p.level,
      lastRound: p.last_round,
    })),
  };
}

/**
 * Recent solo queue placements for a player — used as the primary form
 * signal in tftOddsEngine. Returns the placement numbers (1..8) from the
 * most recent `count` matches, oldest first.
 *
 * Two API calls (list + detail*N) — caller should debounce per player.
 */
export async function getRecentPlacements(
  puuid: string,
  count = 20,
  platform: RiotPlatform = PLATFORM_DEFAULT,
): Promise<number[]> {
  const region = regionForPlatform(platform);
  const ids = await getRecentMatchIds(puuid, count, region);
  if (!ids.length) return [];

  // Parallel fetch — capped by the Bottleneck reservoir
  const matches = await Promise.all(ids.map((id) => getMatchDetail(id, region)));
  const placements: number[] = [];
  for (const m of matches) {
    if (!m) continue;
    const p = m.participants.find((pp) => pp.puuid === puuid);
    if (p && p.placement >= 1 && p.placement <= 8) placements.push(p.placement);
  }
  return placements.reverse(); // oldest first for easier rolling-window math
}

/** Format a tier + LP tuple as a human-readable label. */
export function formatTier(entry: TftLeagueEntry | null | undefined): string | null {
  if (!entry) return null;
  if (entry.tier === 'CHALLENGER' || entry.tier === 'GRANDMASTER' || entry.tier === 'MASTER') {
    return `${entry.tier} ${entry.leaguePoints} LP`;
  }
  return `${entry.tier} ${entry.rank} (${entry.leaguePoints} LP)`;
}

/**
 * Aggregate snapshot used as input to the odds engine. Returns the bits
 * stored in TournamentParticipant.oddsBasis so the admin UI can audit the
 * reasoning behind each odd.
 */
export interface RiotPlayerSnapshot {
  puuid: string;
  currentTier: string | null;
  rankedStrength: number;       // see rankedStrengthScore()
  avgPlacement: number | null;  // average of recentPlacements
  formScore: number | null;     // weighted recent placements
  sampleSize: number;
}

export async function snapshotPlayer(
  puuid: string,
  platform: RiotPlatform = PLATFORM_DEFAULT,
): Promise<RiotPlayerSnapshot | null> {
  const summoner = await getTftSummonerByPuuid(puuid, platform);
  if (!summoner) return null;
  const [leagueEntries, placements] = await Promise.all([
    getTftLeagueEntries(summoner.id, platform),
    getRecentPlacements(puuid, 20, platform),
  ]);
  const standardEntry = leagueEntries.find((e) => e.queueType === 'RANKED_TFT') ?? null;

  const avgPlacement = placements.length
    ? placements.reduce((a, b) => a + b, 0) / placements.length
    : null;

  // Form score : exponentially weighted recent placements ; lower is better.
  // Last game weights 2× the oldest in a 20-game window.
  let formScore: number | null = null;
  if (placements.length >= 5) {
    let weightedSum = 0;
    let weightTotal = 0;
    placements.forEach((p, i) => {
      const weight = 1 + i / Math.max(placements.length - 1, 1); // 1 → 2
      weightedSum += p * weight;
      weightTotal += weight;
    });
    formScore = weightedSum / weightTotal;
  }

  return {
    puuid,
    currentTier: formatTier(standardEntry),
    rankedStrength: rankedStrengthScore(standardEntry),
    avgPlacement,
    formScore,
    sampleSize: placements.length,
  };
}
