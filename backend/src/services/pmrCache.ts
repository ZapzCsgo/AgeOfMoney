/**
 * In-memory PlayerMatchRecord cache.
 *
 * Reduces Supabase egress for the cron `recalcActiveMatchOdds` (the dominant
 * sink — see audit/EGRESS_AUDIT_2026-05-02.md). Both the per-player record
 * fetch AND the opponent-strength sweep now ride this cache.
 *
 * Strategy : cache by (playerId, game) → records[]. TTL 5 min ; the cron
 * itself runs every 10 min so each tick almost always rebuilds, but the
 * opponent sweep within a single tick re-uses the freshly cached entries
 * for any opponent that's also a tracked player. Also prevents duplicate
 * fetches when a player appears in two simultaneous matches.
 *
 * No invalidation. New PMR rows arrive at ~1-2 per player per day so the
 * 5 min staleness budget is invisible to the odds output (the engine itself
 * recalculates every 10 min anyway).
 */
import { prisma } from '../index';

const SENTINEL_OPPONENT = '__AI_ENRICHED__';
const TTL_MS = 5 * 60 * 1000;

export interface PmrRow {
  won: boolean;
  tier: string | null;
  matchDate: Date | null;
  opponentId: string | null;
  score: string | null;
}

interface CacheEntry { records: PmrRow[]; cachedAt: number }
const cache = new Map<string, CacheEntry>();

function key(playerId: string, game: string): string { return `${playerId}|${game}`; }

/**
 * Fetch PMR for a single player+game with cache. Returns the cached array
 * verbatim if fresh (<TTL); otherwise hits DB once and caches.
 */
export async function getPlayerRecords(playerId: string, game: string): Promise<PmrRow[]> {
  const k = key(playerId, game);
  const hit = cache.get(k);
  if (hit && Date.now() - hit.cachedAt < TTL_MS) return hit.records;

  const rows = await prisma.playerMatchRecord.findMany({
    where: { playerId, game, NOT: { opponentName: SENTINEL_OPPONENT } },
    select: { won: true, tier: true, matchDate: true, opponentId: true, score: true },
  });
  cache.set(k, { records: rows, cachedAt: Date.now() });
  return rows;
}

/**
 * Bulk variant. For each (playerId, game) pair, returns records via cache.
 * Deduplicates by playerId, then groups DB lookups for cache misses into a
 * single `findMany` (one round-trip instead of N). Used by the opponent-
 * strength sweep in `recalcActiveMatchOdds`.
 */
export async function getPlayerRecordsBulk(
  playerIds: string[],
  game: string,
): Promise<Map<string, PmrRow[]>> {
  const result = new Map<string, PmrRow[]>();
  const misses: string[] = [];
  const now = Date.now();
  for (const id of playerIds) {
    const k = key(id, game);
    const hit = cache.get(k);
    if (hit && now - hit.cachedAt < TTL_MS) {
      result.set(id, hit.records);
    } else {
      misses.push(id);
    }
  }

  if (misses.length > 0) {
    const rows = await prisma.playerMatchRecord.findMany({
      where: { playerId: { in: misses }, game, NOT: { opponentName: SENTINEL_OPPONENT } },
      select: { playerId: true, won: true, tier: true, matchDate: true, opponentId: true, score: true },
    });
    const grouped = new Map<string, PmrRow[]>();
    for (const r of rows) {
      const list = grouped.get(r.playerId) ?? [];
      list.push({ won: r.won, tier: r.tier, matchDate: r.matchDate, opponentId: r.opponentId, score: r.score });
      grouped.set(r.playerId, list);
    }
    // Even if a player has 0 records, cache an empty array so we don't re-query.
    for (const id of misses) {
      const list = grouped.get(id) ?? [];
      cache.set(key(id, game), { records: list, cachedAt: Date.now() });
      result.set(id, list);
    }
  }

  return result;
}

/**
 * Clear the cache. Mainly for tests; production never needs explicit
 * invalidation thanks to the TTL.
 */
export function clearPmrCache(): void { cache.clear(); }

export function pmrCacheSize(): number { return cache.size; }
