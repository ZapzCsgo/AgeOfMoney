import { prisma } from '../index';
import logger from '../logger';

/**
 * Data-driven exact-score probability model.
 *
 * Combines three sources of evidence to estimate how likely each exact score
 * is for a given match:
 *   1. Theoretical binomial distribution derived from the match odds (base rate)
 *   2. Head-to-head history between the two specific players (strongest signal)
 *   3. Each player's individual historical score distribution (secondary signal)
 *
 * Weights scale with sample size, so new players fall back gracefully to the
 * pure theoretical model while well-known players get data-informed odds.
 */

export type Bo = 'BO3' | 'BO5' | 'BO7';
export type ScoreDistribution = Record<string, number>;

interface ScoreStats {
  dist: ScoreDistribution;
  sample: number;
}

// ── Cache ──────────────────────────────────────────────────────────────────
// Per-match blended distribution cache. Recomputing on every request would
// issue 3 Prisma queries and is expensive for a hot endpoint.
const BLEND_CACHE_TTL = 5 * 60 * 1000; // 5 min
interface CachedEntry { data: ScoreDistribution; ts: number }
const blendCache = new Map<string, CachedEntry>();

function cacheKey(matchId: string, format: string, odds1: number, odds2: number): string {
  // Include odds so cache invalidates when odds move
  return `${matchId}:${format}:${odds1.toFixed(2)}:${odds2.toFixed(2)}`;
}

// ── Score parsing ──────────────────────────────────────────────────────────

/**
 * Parse a stored score string into games won by the player vs opponent.
 * The stored score is always from the player's perspective (per schema).
 */
function parseScore(score: string, playerWon: boolean): { my: number; opp: number } | null {
  const parts = score.split('-').map(s => parseInt(s.trim(), 10));
  if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
  const [a, b] = parts;
  // Sanity check: winner should have more games
  if (playerWon && a > b) return { my: a, opp: b };
  if (!playerWon && a < b) return { my: a, opp: b };
  // Fallback: trust the stored order if it doesn't match the won flag
  // (corrupt data — skip it)
  return null;
}

function flipScore(score: string): string {
  const [a, b] = score.split('-');
  return `${b}-${a}`;
}

function neededWins(format: Bo): number {
  return format === 'BO3' ? 2 : format === 'BO5' ? 3 : 4;
}

// ── Historical distribution queries ────────────────────────────────────────

/**
 * Pull a player's observed exact-score frequencies over their last 100 ranked
 * matches in the requested format. Returns scores from the player's own POV
 * (so a "3-1" means the player won 3-1).
 */
async function getPlayerDistribution(playerId: string, format: Bo): Promise<ScoreStats> {
  try {
    const records = await prisma.playerMatchRecord.findMany({
      where: {
        playerId,
        score: { not: null },
        confidence: { gte: 0.5 },
        OR: [{ format }, { format: null }], // include records where format wasn't tagged
      },
      select: { won: true, score: true },
      orderBy: { matchDate: 'desc' },
      take: 100,
    });

    const needed = neededWins(format);
    const counts: Record<string, number> = {};
    let total = 0;

    for (const r of records) {
      if (!r.score) continue;
      const parsed = parseScore(r.score, r.won);
      if (!parsed) continue;
      // Only keep scores where the winner reached exactly `needed` games —
      // this filters out BO-format mismatches (e.g. a BO3 score in a BO5 list).
      if (Math.max(parsed.my, parsed.opp) !== needed) continue;
      const key = `${parsed.my}-${parsed.opp}`;
      counts[key] = (counts[key] ?? 0) + 1;
      total++;
    }

    if (total === 0) return { dist: {}, sample: 0 };
    const dist: ScoreDistribution = {};
    for (const [k, v] of Object.entries(counts)) dist[k] = v / total;
    return { dist, sample: total };
  } catch (err) {
    logger.warn(`[ExactScore] getPlayerDistribution failed for ${playerId}:`, err);
    return { dist: {}, sample: 0 };
  }
}

/**
 * Pull head-to-head records between two specific players. Returns the
 * distribution from player1's perspective.
 */
async function getH2HDistribution(p1Id: string, p2Id: string, format: Bo): Promise<ScoreStats> {
  try {
    const records = await prisma.playerMatchRecord.findMany({
      where: {
        playerId: p1Id,
        opponentId: p2Id,
        score: { not: null },
        confidence: { gte: 0.5 },
        OR: [{ format }, { format: null }],
      },
      select: { won: true, score: true },
      orderBy: { matchDate: 'desc' },
      take: 50,
    });

    const needed = neededWins(format);
    const counts: Record<string, number> = {};
    let total = 0;

    for (const r of records) {
      if (!r.score) continue;
      const parsed = parseScore(r.score, r.won);
      if (!parsed) continue;
      if (Math.max(parsed.my, parsed.opp) !== needed) continue;
      const key = `${parsed.my}-${parsed.opp}`;
      counts[key] = (counts[key] ?? 0) + 1;
      total++;
    }

    if (total === 0) return { dist: {}, sample: 0 };
    const dist: ScoreDistribution = {};
    for (const [k, v] of Object.entries(counts)) dist[k] = v / total;
    return { dist, sample: total };
  } catch (err) {
    logger.warn(`[ExactScore] getH2HDistribution failed for ${p1Id} vs ${p2Id}:`, err);
    return { dist: {}, sample: 0 };
  }
}

// ── Blending ───────────────────────────────────────────────────────────────

/**
 * Blend the theoretical binomial distribution with observed player/h2h
 * history. Weights scale with sample size so new players fall back to pure
 * theory and seasoned players get data-informed odds.
 *
 * Weight ceilings (total must sum to 1):
 *   - H2H    up to 40% once we have ≥10 matches between these two players
 *   - p1     up to 20% once we have ≥20 solo matches
 *   - p2     up to 20% once we have ≥20 solo matches
 *   - Theory fills the rest (min 20%, max 100%)
 */
export async function buildBlendedDistribution(
  theoretical: ScoreDistribution,
  matchId: string,
  p1Id: string,
  p2Id: string,
  format: Bo,
  odds1: number,
  odds2: number,
): Promise<ScoreDistribution> {
  // Cache hit?
  const key = cacheKey(matchId, format, odds1, odds2);
  const cached = blendCache.get(key);
  if (cached && Date.now() - cached.ts < BLEND_CACHE_TTL) {
    return cached.data;
  }

  const [h2h, p1Stats, p2Stats] = await Promise.all([
    getH2HDistribution(p1Id, p2Id, format),
    getPlayerDistribution(p1Id, format),
    getPlayerDistribution(p2Id, format),
  ]);

  const h2hWeight = Math.min(0.40, (h2h.sample / 10) * 0.40);
  const p1Weight = Math.min(0.20, (p1Stats.sample / 20) * 0.20);
  const p2Weight = Math.min(0.20, (p2Stats.sample / 20) * 0.20);
  const theoreticalWeight = 1 - h2hWeight - p1Weight - p2Weight;

  // p2Stats is from p2's perspective — flip each key so it's all from p1's POV
  const flippedP2: ScoreDistribution = {};
  for (const [k, v] of Object.entries(p2Stats.dist)) flippedP2[flipScore(k)] = v;

  const allKeys = new Set<string>([
    ...Object.keys(theoretical),
    ...Object.keys(h2h.dist),
    ...Object.keys(p1Stats.dist),
    ...Object.keys(flippedP2),
  ]);

  const blended: ScoreDistribution = {};
  for (const k of allKeys) {
    const th = theoretical[k] ?? 0;
    const hh = h2h.dist[k] ?? 0;
    const p1 = p1Stats.dist[k] ?? 0;
    const p2 = flippedP2[k] ?? 0;
    blended[k] = th * theoreticalWeight + hh * h2hWeight + p1 * p1Weight + p2 * p2Weight;
  }

  // Renormalize (small rounding error can drift the sum)
  const total = Object.values(blended).reduce((a, b) => a + b, 0);
  if (total > 0) {
    for (const k of Object.keys(blended)) blended[k] /= total;
  }

  blendCache.set(key, { data: blended, ts: Date.now() });

  // Lightweight log so we can see the blend in action during early days
  if (h2h.sample > 0 || p1Stats.sample > 5 || p2Stats.sample > 5) {
    logger.info(
      `[ExactScore] ${matchId} blend: theory=${(theoreticalWeight*100).toFixed(0)}% ` +
      `h2h=${(h2hWeight*100).toFixed(0)}%(${h2h.sample}) ` +
      `p1=${(p1Weight*100).toFixed(0)}%(${p1Stats.sample}) ` +
      `p2=${(p2Weight*100).toFixed(0)}%(${p2Stats.sample})`
    );
  }

  return blended;
}
