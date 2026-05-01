/**
 * One-shot recovery : force-recalc all UPCOMING BO2/BO4 matches using
 * calculateOddsV2 with `format`. Use right after deploying the fix to clean
 * up any rows still carrying stale `oddsDraw`.
 *
 * Usage (local/dev with direct DB) :
 *   npx tsx scripts/recalc-bo2-upcoming.ts
 *
 * Usage (against prod Supabase via pooler) :
 *   DATABASE_URL="postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true" \
 *     npx tsx scripts/recalc-bo2-upcoming.ts
 *
 * Options :
 *   --all     recalc every UPCOMING/LIVE match (not just BO2/BO4)
 *   --dry     print the new odds without writing
 */

import { PrismaClient } from '@prisma/client';
import { calculateOddsV2, type H2HRecord } from '../src/services/oddsEngine';
const prisma = new PrismaClient();

const SENTINEL = '__AI_ENRICHED__';

function formatAllowsDraw(format: string): boolean {
  const bo = parseInt(format.replace(/\D/g, ''), 10);
  return !isNaN(bo) && bo > 0 && bo % 2 === 0;
}

/** Simplified H2H lookup — reads directly from PlayerMatchRecord by opponentId. */
async function getH2H(player1Id: string, player2Id: string, game: string): Promise<H2HRecord[]> {
  const rows = await prisma.playerMatchRecord.findMany({
    where: {
      game,
      NOT: { opponentName: SENTINEL },
      OR: [
        { playerId: player1Id, opponentId: player2Id },
        { playerId: player2Id, opponentId: player1Id },
      ],
    },
    orderBy: { matchDate: 'desc' },
    take: 40,
    select: { playerId: true, won: true, tier: true, matchDate: true, confidence: true },
  });
  return rows.map(r => ({
    winner: ((r.playerId === player1Id ? (r.won ? 1 : 2) : (r.won ? 2 : 1)) as 1 | 2),
    tier: r.tier ?? 'B',
    matchDate: r.matchDate,
    confidence: r.confidence ?? 0.8,
  }));
}

async function main() {
  const all = process.argv.includes('--all');
  const dry = process.argv.includes('--dry');

  const matches = await prisma.match.findMany({
    where: { status: { in: ['UPCOMING', 'LIVE'] } },
    include: {
      player1: { select: { id: true, name: true, lastMatchAt: true } },
      player2: { select: { id: true, name: true, lastMatchAt: true } },
      tournament: { select: { tier: true } },
    },
  });

  const targets = all ? matches : matches.filter(m => formatAllowsDraw(m.format));
  console.log(`[Recalc] ${targets.length} match(es) to recompute (${dry ? 'DRY RUN' : 'WRITING TO DB'})`);

  let fixed = 0, skipped = 0;
  for (const m of targets) {
    try {
      const [p1Records, p2Records, h2h] = await Promise.all([
        prisma.playerMatchRecord.findMany({
          where: { playerId: m.player1.id, game: m.game, NOT: { opponentName: SENTINEL } },
          select: { won: true, tier: true, matchDate: true, opponentId: true, score: true },
        }),
        prisma.playerMatchRecord.findMany({
          where: { playerId: m.player2.id, game: m.game, NOT: { opponentName: SENTINEL } },
          select: { won: true, tier: true, matchDate: true, opponentId: true, score: true },
        }),
        getH2H(m.player1.id, m.player2.id, m.game),
      ]);

      // Opponent-winrate map — downweight wins against weak opponents
      const opponentIds = new Set<string>();
      for (const r of [...p1Records, ...p2Records]) if (r.opponentId) opponentIds.add(r.opponentId);
      const oppWinrateMap = new Map<string, number>();
      if (opponentIds.size > 0) {
        const oppRecords = await prisma.playerMatchRecord.findMany({
          where: { playerId: { in: [...opponentIds] }, game: m.game },
          select: { playerId: true, won: true },
        });
        const grouped = new Map<string, { total: number; wins: number }>();
        for (const r of oppRecords) {
          const g = grouped.get(r.playerId) ?? { total: 0, wins: 0 };
          g.total++;
          if (r.won) g.wins++;
          grouped.set(r.playerId, g);
        }
        for (const [id, s] of grouped.entries()) {
          if (s.total >= 3) oppWinrateMap.set(id, s.wins / s.total);
        }
      }

      const now = Date.now();
      const days1 = m.player1.lastMatchAt ? (now - m.player1.lastMatchAt.getTime()) / 86400000 : 30;
      const days2 = m.player2.lastMatchAt ? (now - m.player2.lastMatchAt.getTime()) / 86400000 : 30;

      // Phase 2 : fetch Glicko ratings si V2 flag ON
      let glicko1: { rating: number; rd: number } | undefined;
      let glicko2: { rating: number; rd: number } | undefined;
      if (process.env.ODDS_ENGINE_V2_ENABLED === 'true') {
        const glickoRows = await prisma.$queryRawUnsafe<Array<{
          playerid: string; rating: number; rd: number;
        }>>(
          `SELECT "playerId" AS playerid, rating, rd FROM "PlayerRating" WHERE "playerId" IN ($1, $2)`,
          m.player1.id, m.player2.id,
        ).catch(() => [] as Array<{ playerid: string; rating: number; rd: number }>);
        for (const r of glickoRows) {
          const entry = { rating: Number(r.rating), rd: Number(r.rd) };
          if (r.playerid === m.player1.id) glicko1 = entry;
          else if (r.playerid === m.player2.id) glicko2 = entry;
        }
      }

      const newOdds = calculateOddsV2({
        p1Records: p1Records.map(r => ({ won: r.won, tier: r.tier ?? 'B', matchDate: r.matchDate, opponentId: r.opponentId, score: r.score })),
        p2Records: p2Records.map(r => ({ won: r.won, tier: r.tier ?? 'B', matchDate: r.matchDate, opponentId: r.opponentId, score: r.score })),
        h2h,
        daysSinceLastMatch1: days1,
        daysSinceLastMatch2: days2,
        matchTier: m.tournament?.tier ?? undefined,
        format: m.format,
        opponentWinrates: oppWinrateMap,
        glickoRating1: glicko1?.rating,
        glickoRd1: glicko1?.rd,
        glickoRating2: glicko2?.rating,
        glickoRd2: glicko2?.rd,
      });

      const oldOver = 1 / m.odds1 + 1 / m.odds2 + (m.oddsDraw ? 1 / m.oddsDraw : 0);
      const newOver = 1 / newOdds.odds1 + 1 / newOdds.odds2 + (newOdds.oddsDraw ? 1 / newOdds.oddsDraw : 0);
      const arb = m.oddsDraw && oldOver < 1.0;
      const tag = arb ? '  !!ARB!!' : '';

      console.log(
        `[${m.format}]${tag} ${m.player1.name} vs ${m.player2.name}  ` +
        `old=${m.odds1}/${m.oddsDraw ?? '-'}/${m.odds2} (Σ=${oldOver.toFixed(3)}) → ` +
        `new=${newOdds.odds1}/${newOdds.oddsDraw ?? '-'}/${newOdds.odds2} (Σ=${newOver.toFixed(3)})`
      );

      if (!dry) {
        await prisma.match.update({
          where: { id: m.id },
          data: { odds1: newOdds.odds1, odds2: newOdds.odds2, oddsDraw: newOdds.oddsDraw ?? null },
        });
      }
      fixed++;
    } catch (err) {
      console.error(`  skip ${m.id}:`, (err as Error).message);
      skipped++;
    }
  }

  console.log(`\n── Done : ${fixed} updated, ${skipped} skipped ──`);
  await prisma.$disconnect();
}

main().catch(err => {
  console.error('[Recalc] Fatal:', err);
  process.exit(1);
});
