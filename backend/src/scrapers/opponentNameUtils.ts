/**
 * Shared helpers for normalizing / upserting opponent names into Player rows.
 *
 * Used by the Liquipedia history scraper and the backfill-opponent-ids
 * script, so that the invalid-name rules and the slug derivation stay in
 * one place. (Previously also used by aiPlayerHistoryScraper — removed on
 * 2026-04-19.)
 *
 * Historical context : Phase 5 audit (2026-04-19) revealed that 15 709 PMR
 * rows (67 %) had `opponentId = null` because these scrapers stored the
 * opponent name as text but never created a Player row for it. Hera alone
 * had 186 orphaned mentions. This module centralizes the fix (P0 + P4
 * blocklist).
 */

import { prisma } from '../index';
import logger from '../logger';

/**
 * Blocklist of opponent-name strings that must never become Player rows.
 * Lowercased for case-insensitive matching. Add to this list when new
 * sentinels or clan-tags are discovered during audits.
 */
export const INVALID_OPPONENT_NAMES = new Set<string>([
  // Scraper sentinels
  '__ai_enriched__',
  '__claude_cache__',
  // Liquipedia placeholders
  'tbd', 'tba', 'tbn', 'bye', 'n/a', 'winner', 'loser',
  // Clan-tag shorthands seen in Phase 5 audit (>= 20 PMR each but not players)
  'gl', 'cat', 'ror', 'wwp', 'ds', 'tag', 'vna',
]);

/** Team-name pattern copied from liquipediaScraper.ts:472 for consistency. */
const TEAM_PATTERN = /^team\s+|esports?\s*[ab]?$|\s+esports?$|esports?\s+[ab]$|\s+[AB]$/i;

/**
 * Strip diacritics (Vietnamese/Spanish/French accents) so that names like
 * "Chim Sẻ Đi Nắng" or "MarineLorD" produce stable slugs.
 */
function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Derive a Liquipedia-style slug from a raw opponent name.
 * Rules :
 *   - lowercase + strip accents
 *   - spaces → underscore
 *   - drop characters that aren't alnum / underscore / dot / dash
 *   - collapse duplicate underscores
 *   - trim leading/trailing separators
 */
export function deriveSlugFromName(name: string): string {
  const base = stripAccents(name.trim().toLowerCase())
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_.\-]/g, '')
    .replace(/_+/g, '_')
    .replace(/^[_\-.]+|[_\-.]+$/g, '');
  return base;
}

/** Lowercase + trim, used for equality checks against INVALID_OPPONENT_NAMES. */
export function normalizeOpponentName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Validate that an opponent name is worth creating as a Player.
 * Returns an object with { valid, reason } so callers can log why a name
 * was skipped (useful in the backfill script).
 */
export function checkOpponentName(name: string): { valid: boolean; reason?: string } {
  const raw = name.trim();
  if (!raw) return { valid: false, reason: 'empty' };
  if (raw.length < 3) return { valid: false, reason: 'too-short' };
  if (raw.length > 40) return { valid: false, reason: 'too-long' };
  const lower = raw.toLowerCase();
  if (INVALID_OPPONENT_NAMES.has(lower)) return { valid: false, reason: 'blocklist' };
  if (TEAM_PATTERN.test(raw)) return { valid: false, reason: 'team-name' };
  // Pure digits or pure punctuation → not a player
  if (/^\d+$/.test(raw)) return { valid: false, reason: 'digits-only' };
  if (!/[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF]/.test(raw)) return { valid: false, reason: 'no-letters' };
  return { valid: true };
}

/**
 * Upsert a Player row for an opponent name.
 *
 * Returns the Player id, or null if the name is invalid / skipped.
 *
 * Collision strategy : if a Player already exists with the derived slug but
 * a DIFFERENT game, we don't overwrite — instead we prefix the slug with
 * the game code (e.g. "aoe4/hera") to disambiguate. This avoids merging two
 * distinct pros who happen to share a name across AoE2 and AoE4.
 *
 * Notable : we use findUnique + create (instead of direct upsert) so we can
 * detect the cross-game collision case before blindly creating.
 */
export async function upsertOpponentPlayer(
  rawName: string,
  game: string,
): Promise<string | null> {
  const check = checkOpponentName(rawName);
  if (!check.valid) return null;

  const name = rawName.trim();
  const baseSlug = deriveSlugFromName(name);
  if (!baseSlug) return null;

  // Look up by slug first — cheapest path
  const bySlug = await prisma.player.findUnique({
    where: { liquipediaSlug: baseSlug },
    select: { id: true, game: true, name: true },
  });
  if (bySlug) {
    if (bySlug.game === game) return bySlug.id;
    // Slug collision across games → use game-prefixed slug
    const prefixedSlug = `${game.toLowerCase()}/${baseSlug}`;
    const byPrefixed = await prisma.player.findUnique({
      where: { liquipediaSlug: prefixedSlug },
      select: { id: true },
    });
    if (byPrefixed) return byPrefixed.id;
    try {
      const created = await prisma.player.create({
        data: { name, liquipediaSlug: prefixedSlug, elo: 1500, game },
        select: { id: true },
      });
      logger.info(`[OpponentUpsert] Created cross-game ${game} player "${name}" (slug "${prefixedSlug}") — existing ${bySlug.game} variant kept under "${baseSlug}"`);
      return created.id;
    } catch (err) {
      logger.warn(`[OpponentUpsert] Failed to create cross-game player "${name}": ${(err as Error).message}`);
      return null;
    }
  }

  // Same-name case-insensitive match? Reuse it without creating a duplicate.
  const byName = await prisma.player.findFirst({
    where: { name: { equals: name, mode: 'insensitive' }, game },
    select: { id: true },
  });
  if (byName) return byName.id;

  // Nothing exists — create fresh.
  try {
    const created = await prisma.player.create({
      data: { name, liquipediaSlug: baseSlug, elo: 1500, game },
      select: { id: true },
    });
    return created.id;
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('Unique constraint')) {
      // Race condition — someone else just created it. Re-read.
      const retry = await prisma.player.findUnique({
        where: { liquipediaSlug: baseSlug },
        select: { id: true },
      });
      return retry?.id ?? null;
    }
    logger.warn(`[OpponentUpsert] Failed to create player "${name}" (slug "${baseSlug}"): ${msg}`);
    return null;
  }
}
