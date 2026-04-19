/**
 * Phase 5 P0 backfill — crée les Player rows manquants à partir des
 * opponent names orphelins dans PlayerMatchRecord, puis rattache les PMR
 * existantes à leur playerId.
 *
 * Ordre des opérations :
 *   1. DELETE PMR dont l'opponentName est dans INVALID_OPPONENT_NAMES
 *      (sentinels, clan tags, "TBD", …) — partie P4 de la cleanup.
 *   2. Liste les opponentName distincts sans opponentId.
 *   3. Pour chaque nom : run `upsertOpponentPlayer` avec le game déduit
 *      du playerId qui a généré la PMR (car l'opponent joue le même jeu
 *      99% du temps — les cross-games sont gérés par le slug préfixé).
 *   4. Backfill `opponentId` sur TOUTES les PMR référençant ce nom
 *      (case-insensitive match exact).
 *
 * Usage :
 *   DATABASE_URL='...' npx tsx scripts/backfill-opponent-ids.ts [--dry]
 *
 * Safety rails :
 *   - Dry-run ne touche rien, log seulement le plan.
 *   - Live : stop immédiat si > 30% des noms ne matchent pas
 *     (= bug de normalisation potentiel, on veut un review humain).
 */

import { PrismaClient } from '@prisma/client';
import { checkOpponentName, deriveSlugFromName, INVALID_OPPONENT_NAMES } from '../src/scrapers/opponentNameUtils';

const prisma = new PrismaClient();

// Stats accumulator for the final report
interface Stats {
  pmrDeleted: number;
  distinctNames: number;
  skippedInvalid: number;
  skippedByReason: Record<string, number>;
  playersCreated: number;
  playersFoundExisting: number;
  pmrBackfilled: number;
  failures: Array<{ name: string; reason: string }>;
}

async function stripeCountsByGameOfReferrer(names: string[]): Promise<Map<string, string>> {
  // For each orphan name, find the majority `game` of the players who
  // reference it via their PMR. That's the game we assume the opponent plays.
  const nameToGame = new Map<string, string>();
  const BATCH = 50;
  for (let i = 0; i < names.length; i += BATCH) {
    const slice = names.slice(i, i + BATCH);
    const rows = await prisma.$queryRaw<Array<{ opponentName: string; game: string; n: number }>>`
      SELECT pmr."opponentName" AS "opponentName", pl.game AS game, COUNT(*)::int AS n
      FROM "PlayerMatchRecord" pmr
      JOIN "Player" pl ON pl.id = pmr."playerId"
      WHERE pmr."opponentName" = ANY(${slice})
        AND pmr."opponentId" IS NULL
      GROUP BY pmr."opponentName", pl.game
    `;
    // Aggregate per name — majority wins, ties broken by alphabetical
    const perName = new Map<string, Record<string, number>>();
    for (const r of rows) {
      if (!perName.has(r.opponentName)) perName.set(r.opponentName, {});
      perName.get(r.opponentName)![r.game] = (perName.get(r.opponentName)![r.game] ?? 0) + Number(r.n);
    }
    for (const [name, counts] of perName) {
      const best = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
      if (best) nameToGame.set(name, best[0]);
    }
  }
  return nameToGame;
}

async function main() {
  const dry = process.argv.includes('--dry');
  const stats: Stats = {
    pmrDeleted: 0, distinctNames: 0, skippedInvalid: 0, skippedByReason: {},
    playersCreated: 0, playersFoundExisting: 0, pmrBackfilled: 0, failures: [],
  };
  console.log(`[Backfill] ${dry ? 'DRY RUN' : 'LIVE RUN'}\n`);

  // ── Step 1 : cleanup PMR for blocklisted names ─────────────────────────
  const blocklist = [...INVALID_OPPONENT_NAMES];
  const deletable = await prisma.$queryRaw<Array<{ n: number }>>`
    SELECT COUNT(*)::int AS n FROM "PlayerMatchRecord"
    WHERE LOWER(TRIM("opponentName")) = ANY(${blocklist})
  `;
  const deletableCount = Number(deletable[0]?.n ?? 0);
  console.log(`[Backfill] Step 1 — blocklist cleanup : ${deletableCount} PMR rows match INVALID_OPPONENT_NAMES`);
  if (deletableCount > 0 && !dry) {
    const { count } = await prisma.playerMatchRecord.deleteMany({
      where: {
        OR: blocklist.map(n => ({ opponentName: { equals: n, mode: 'insensitive' as const } })),
      },
    });
    stats.pmrDeleted = count;
    console.log(`[Backfill]   deleted ${count} PMR rows`);
  } else if (dry) {
    console.log(`[Backfill]   [dry] would delete ${deletableCount} rows`);
    stats.pmrDeleted = deletableCount;
  }

  // ── Step 2 : list orphan opponentName (no opponentId) ──────────────────
  const orphanRows = await prisma.$queryRaw<Array<{ opponentName: string; n: number }>>`
    SELECT TRIM("opponentName") AS "opponentName", COUNT(*)::int AS n
    FROM "PlayerMatchRecord"
    WHERE "opponentId" IS NULL
      AND "opponentName" IS NOT NULL
      AND LOWER(TRIM("opponentName")) <> ALL(${blocklist})
    GROUP BY TRIM("opponentName")
    ORDER BY n DESC
  `;
  stats.distinctNames = orphanRows.length;
  console.log(`[Backfill] Step 2 — ${orphanRows.length} distinct orphan opponent names (${orphanRows.reduce((s, r) => s + Number(r.n), 0)} PMR rows total)`);

  // ── Step 3 : resolve game per orphan name ──────────────────────────────
  const names = orphanRows.map(r => r.opponentName);
  console.log(`[Backfill] Step 3 — resolving majority game per orphan name…`);
  const nameToGame = await stripeCountsByGameOfReferrer(names);

  // ── Step 4 : upsert Player + backfill opponentId ───────────────────────
  console.log(`[Backfill] Step 4 — upsert+backfill per orphan name`);
  let processed = 0;
  for (const { opponentName: name, n } of orphanRows) {
    processed++;
    const game = nameToGame.get(name) ?? 'AoE4';
    const check = checkOpponentName(name);
    if (!check.valid) {
      stats.skippedInvalid++;
      stats.skippedByReason[check.reason ?? 'unknown'] = (stats.skippedByReason[check.reason ?? 'unknown'] ?? 0) + 1;
      continue;
    }

    // Try existing player by case-insensitive name+game first
    const existing = await prisma.player.findFirst({
      where: { name: { equals: name, mode: 'insensitive' }, game },
      select: { id: true, name: true },
    });
    let playerId: string | null = null;
    if (existing) {
      playerId = existing.id;
      stats.playersFoundExisting++;
    } else if (!dry) {
      // Not found → create
      const baseSlug = deriveSlugFromName(name);
      if (!baseSlug) {
        stats.failures.push({ name, reason: 'empty-slug' });
        continue;
      }
      // Handle slug collisions by checking existing + prefixing if needed
      const bySlug = await prisma.player.findUnique({
        where: { liquipediaSlug: baseSlug },
        select: { id: true, game: true },
      });
      let slug = baseSlug;
      if (bySlug && bySlug.game !== game) slug = `${game.toLowerCase()}/${baseSlug}`;
      if (bySlug && bySlug.game === game) {
        playerId = bySlug.id;
        stats.playersFoundExisting++;
      } else {
        try {
          const created = await prisma.player.create({
            data: { name, liquipediaSlug: slug, elo: 1500, game },
            select: { id: true },
          });
          playerId = created.id;
          stats.playersCreated++;
        } catch (err) {
          stats.failures.push({ name, reason: (err as Error).message });
          continue;
        }
      }
    } else {
      // Dry-run counting path
      stats.playersCreated++;
    }

    // Backfill PMR.opponentId — case-insensitive match on opponentName
    if (!dry && playerId) {
      const { count } = await prisma.playerMatchRecord.updateMany({
        where: {
          opponentId: null,
          opponentName: { equals: name, mode: 'insensitive' },
        },
        data: { opponentId: playerId },
      });
      stats.pmrBackfilled += count;
    } else if (dry) {
      stats.pmrBackfilled += Number(n);
    }

    if (processed % 100 === 0) {
      console.log(`  ${processed}/${orphanRows.length}  created=${stats.playersCreated} existing=${stats.playersFoundExisting} backfilled=${stats.pmrBackfilled}`);
    }
  }

  // ── Safety rail : abort early if too many failures ────────────────────
  const failureRate = stats.distinctNames > 0 ? (stats.failures.length + stats.skippedInvalid) / stats.distinctNames : 0;
  console.log(`\n[Backfill] === SUMMARY (${dry ? 'DRY' : 'LIVE'}) ===`);
  console.log(`  PMR deleted (blocklist)     : ${stats.pmrDeleted}`);
  console.log(`  Distinct orphan names       : ${stats.distinctNames}`);
  console.log(`  Players created             : ${stats.playersCreated}`);
  console.log(`  Players found (no-create)   : ${stats.playersFoundExisting}`);
  console.log(`  PMR backfilled              : ${stats.pmrBackfilled}`);
  console.log(`  Skipped (invalid name)      : ${stats.skippedInvalid}`);
  if (stats.skippedInvalid > 0) {
    console.log(`    by reason                 : ${JSON.stringify(stats.skippedByReason)}`);
  }
  console.log(`  Failures (create/db errors) : ${stats.failures.length}`);
  if (stats.failures.length > 0) {
    console.log(`  First 10 failures :`);
    stats.failures.slice(0, 10).forEach(f => console.log(`    - "${f.name}" → ${f.reason}`));
  }
  console.log(`  Failure rate                : ${(failureRate * 100).toFixed(1)}%`);

  if (failureRate > 0.30) {
    console.error(`\n[Backfill] ❌ STOP — failure rate ${(failureRate * 100).toFixed(1)}% > 30% threshold.`);
    console.error(`  Review the failures list above before re-running. Examples of unmatched names :`);
    stats.failures.slice(0, 30).forEach(f => console.error(`    - "${f.name}"  (${f.reason})`));
    process.exit(2);
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('[Backfill] Fatal:', err);
  process.exit(1);
});
