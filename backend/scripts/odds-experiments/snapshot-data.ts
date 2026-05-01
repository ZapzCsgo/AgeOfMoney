/**
 * Loads ALL PMR + Match data once and caches it on disk so the variant
 * harness can replay variants without hitting the DB N times.
 *
 * Usage : npx tsx scripts/odds-experiments/snapshot-data.ts
 *
 * Output : backend/scripts/odds-experiments/.snapshot.json (gitignored)
 *
 * Runs in batches (5000) to play nice with the Supabase pooler.
 */
import { PrismaClient } from '@prisma/client';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();
const SENTINEL = '__AI_ENRICHED__';

interface PmrSnapshot {
  playerId: string;
  opponentId: string | null;
  won: boolean;
  tier: string | null;
  matchDate: string | null;     // ISO string for JSON
  score: string | null;
  confidence: number | null;
  format: string | null;        // BO3/BO5/BO7 — used by v43 format-specific variants
}

interface MatchSnapshot {
  id: string;
  scheduledAt: string;
  player1Id: string;
  player2Id: string;
  player1Name: string;
  player2Name: string;
  player1LastMatchAt: string | null;
  player2LastMatchAt: string | null;
  winnerId: string | null;
  resultScore: string | null;
  format: string;
  tournamentTier: string | null;
}

async function main() {
  const start = Date.now();
  console.log('[snapshot] Loading PMR rows in batches…');
  const allPmr: PmrSnapshot[] = [];
  const BATCH = 5000;
  for (let offset = 0; ; offset += BATCH) {
    const chunk = await prisma.playerMatchRecord.findMany({
      where: { NOT: { opponentName: SENTINEL } },
      select: {
        playerId: true, opponentId: true, won: true, tier: true,
        matchDate: true, score: true, confidence: true, format: true,
      },
      orderBy: { id: 'asc' },
      take: BATCH,
      skip: offset,
    });
    if (chunk.length === 0) break;
    for (const r of chunk) {
      allPmr.push({
        playerId: r.playerId,
        opponentId: r.opponentId,
        won: r.won,
        tier: r.tier,
        matchDate: r.matchDate ? r.matchDate.toISOString() : null,
        score: r.score,
        confidence: r.confidence,
        format: r.format,
      });
    }
    console.log(`  loaded ${allPmr.length} PMR rows…`);
    if (chunk.length < BATCH) break;
  }

  console.log('[snapshot] Loading completed matches…');
  const matches = await prisma.match.findMany({
    where: { status: 'COMPLETED' },
    include: {
      player1: { select: { id: true, name: true, lastMatchAt: true } },
      player2: { select: { id: true, name: true, lastMatchAt: true } },
      tournament: { select: { tier: true } },
    },
    orderBy: { scheduledAt: 'asc' },
  });

  const matchSnaps: MatchSnapshot[] = matches
    .filter(m => m.resultScore || m.winnerId)
    .map(m => ({
      id: m.id,
      scheduledAt: m.scheduledAt.toISOString(),
      player1Id: m.player1Id,
      player2Id: m.player2Id,
      player1Name: m.player1.name,
      player2Name: m.player2.name,
      player1LastMatchAt: m.player1.lastMatchAt?.toISOString() ?? null,
      player2LastMatchAt: m.player2.lastMatchAt?.toISOString() ?? null,
      winnerId: m.winnerId,
      resultScore: m.resultScore,
      format: m.format,
      tournamentTier: m.tournament?.tier ?? null,
    }));

  const out = { snapshotAt: new Date().toISOString(), pmr: allPmr, matches: matchSnaps };

  const dir = __dirname;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const outPath = join(dir, '.snapshot.json');
  writeFileSync(outPath, JSON.stringify(out));
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n[snapshot] Wrote ${outPath}`);
  console.log(`           ${allPmr.length} PMR rows + ${matchSnaps.length} matches in ${elapsed}s`);

  await prisma.$disconnect();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
