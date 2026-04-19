/**
 * Rebuild Glicko-2 ratings from scratch by replaying all COMPLETED matches
 * in chronological order.
 *
 * Reads from two sources (in order of priority) :
 *   1. `Match` table — platform-tracked matches with explicit winner
 *   2. `PlayerMatchRecord` — Liquipedia-scraped historical records
 *
 * For each match, updates both players' ratings using the PRE-match snapshot.
 *
 * Idempotent : wipes `PlayerRating` before rebuilding. Running twice produces
 * the same output (modulo chronological tie-breaks, which are stable by id).
 *
 * Usage :
 *   DATABASE_URL='...' npx tsx scripts/rebuild-ratings.ts [--dry]
 *
 * Options :
 *   --dry : no DB writes, just print what would happen + top 20 at the end
 */

import { PrismaClient } from '@prisma/client';
import { computeUpdatedRating, DEFAULT_RATING, DEFAULT_RD, DEFAULT_VOL } from '../src/services/glicko2';

// Standalone Prisma client — no import from ../src/index, so no cron jobs,
// roulette, socket or HTTP server get booted by this script.
const prisma = new PrismaClient();
const GLICKO2_DEFAULTS = { RATING: DEFAULT_RATING, RD: DEFAULT_RD, VOL: DEFAULT_VOL };
const SENTINEL = '__AI_ENRICHED__';

interface RatingState {
  rating: number;
  rd: number;
  vol: number;
  gamesPlayed: number;
}

/** In-memory map playerId → rating, for fast rebuild. Flushed to DB at end. */
const ratings = new Map<string, RatingState>();

function getRating(playerId: string): RatingState {
  return ratings.get(playerId) ?? {
    rating: GLICKO2_DEFAULTS.RATING,
    rd: GLICKO2_DEFAULTS.RD,
    vol: GLICKO2_DEFAULTS.VOL,
    gamesPlayed: 0,
  };
}

interface MatchEvent {
  date: Date;
  player1Id: string;
  player2Id: string;
  /** outcome from player1's perspective : 1 = p1 wins, 0 = p2 wins, 0.5 = draw */
  score: 0 | 0.5 | 1;
  source: 'platform' | 'pmr'; // PlayerMatchRecord
}

function parseScore(score: string | null): { p1Won: boolean; p2Won: boolean; isDraw: boolean } {
  if (!score) return { p1Won: false, p2Won: false, isDraw: false };
  const m = score.match(/^\s*(\d+)\s*[-:]\s*(\d+)\s*$/);
  if (!m) return { p1Won: false, p2Won: false, isDraw: false };
  const a = parseInt(m[1], 10);
  const b = parseInt(m[2], 10);
  if (a === b && a >= 1) return { p1Won: false, p2Won: false, isDraw: true };
  return { p1Won: a > b, p2Won: b > a, isDraw: false };
}

async function collectAllMatchEvents(): Promise<MatchEvent[]> {
  const events: MatchEvent[] = [];

  // ── Source 1 : Match table (platform-tracked, highest confidence) ─────────
  const platformMatches = await prisma.match.findMany({
    where: {
      status: 'COMPLETED',
      scheduledAt: { not: undefined },
    },
    select: {
      id: true,
      scheduledAt: true,
      player1Id: true,
      player2Id: true,
      winnerId: true,
      resultScore: true,
    },
    orderBy: { scheduledAt: 'asc' },
  });

  for (const m of platformMatches) {
    const drawInfo = parseScore(m.resultScore);
    let score: 0 | 0.5 | 1;
    if (drawInfo.isDraw) score = 0.5;
    else if (m.winnerId === m.player1Id) score = 1;
    else if (m.winnerId === m.player2Id) score = 0;
    else continue; // unclear outcome, skip
    events.push({
      date: m.scheduledAt,
      player1Id: m.player1Id,
      player2Id: m.player2Id,
      score,
      source: 'platform',
    });
  }

  // ── Source 2 : PlayerMatchRecord (Liquipedia historical) ──────────────────
  // PMR stores one row per player per match. We need to dedupe so each match
  // gives exactly ONE event. Key = (tournament + date + pair of playerIds).
  const pmr = await prisma.playerMatchRecord.findMany({
    where: {
      opponentId: { not: null },
      matchDate: { not: null },
      NOT: { opponentName: SENTINEL },
    },
    select: {
      playerId: true,
      opponentId: true,
      won: true,
      score: true,
      matchDate: true,
      tournamentName: true,
    },
    orderBy: { matchDate: 'asc' },
  });

  const seen = new Set<string>();
  for (const r of pmr) {
    if (!r.opponentId || !r.matchDate) continue;
    const pair = [r.playerId, r.opponentId].sort().join('|');
    const key = `${r.tournamentName}|${r.matchDate.toISOString()}|${pair}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Determine p1/p2 based on id ordering — we need stable perspective
    const p1Id = r.playerId;
    const p2Id = r.opponentId;
    const drawInfo = parseScore(r.score);
    let score: 0 | 0.5 | 1;
    if (drawInfo.isDraw) score = 0.5;
    else if (r.won) score = 1;
    else score = 0;

    events.push({
      date: r.matchDate,
      player1Id: p1Id,
      player2Id: p2Id,
      score,
      source: 'pmr',
    });
  }

  // Sort all events by date (platform + pmr)
  events.sort((a, b) => a.date.getTime() - b.date.getTime());
  return events;
}

async function applyEvent(ev: MatchEvent): Promise<void> {
  const r1 = getRating(ev.player1Id);
  const r2 = getRating(ev.player2Id);

  const p1New = computeUpdatedRating(
    { rating: r1.rating, rd: r1.rd, vol: r1.vol },
    [{ opponentRating: r2.rating, opponentRd: r2.rd, score: ev.score }],
  );
  const p2Score = ev.score === 1 ? 0 : ev.score === 0 ? 1 : 0.5;
  const p2New = computeUpdatedRating(
    { rating: r2.rating, rd: r2.rd, vol: r2.vol },
    [{ opponentRating: r1.rating, opponentRd: r1.rd, score: p2Score }],
  );

  ratings.set(ev.player1Id, { ...p1New, gamesPlayed: r1.gamesPlayed + 1 });
  ratings.set(ev.player2Id, { ...p2New, gamesPlayed: r2.gamesPlayed + 1 });
}

async function flushToDB(dry: boolean): Promise<void> {
  if (dry) {
    console.log(`[Dry-run] Would persist ${ratings.size} rating rows`);
    return;
  }

  // Wipe + bulk-insert. We're rebuilding from scratch — it's OK to TRUNCATE.
  await prisma.$executeRawUnsafe(`DELETE FROM "PlayerRating"`);

  const entries = [...ratings.entries()];
  const BATCH_SIZE = 100;
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    // Parameterized VALUES list
    const values: (string | number | Date)[] = [];
    const placeholders: string[] = [];
    batch.forEach(([playerId, r], idx) => {
      const base = idx * 7;
      placeholders.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, NOW())`
      );
      values.push(
        `pr_${playerId}_${Date.now()}_${i + idx}`,
        playerId,
        r.rating,
        r.rd,
        r.vol,
        r.gamesPlayed,
        new Date(),
      );
    });
    const sql = `INSERT INTO "PlayerRating" (id, "playerId", rating, rd, vol, "gamesPlayed", "lastUpdate", "createdAt") VALUES ${placeholders.join(',')}`;
    await prisma.$executeRawUnsafe(sql, ...values);
    process.stdout.write(`  Inserted ${Math.min(i + BATCH_SIZE, entries.length)}/${entries.length}\r`);
  }
  console.log(`\n[Done] Persisted ${entries.length} rating rows`);
}

async function showTop(limit = 20): Promise<void> {
  // Resolve player names
  const playerIds = [...ratings.keys()];
  const players = await prisma.player.findMany({
    where: { id: { in: playerIds } },
    select: { id: true, name: true, game: true },
  });
  const nameMap = new Map(players.map(p => [p.id, `${p.name} (${p.game})`]));

  const sorted = [...ratings.entries()]
    .filter(([, r]) => r.gamesPlayed >= 10) // hide noise from low-data players
    .map(([pid, r]) => ({
      pid,
      name: nameMap.get(pid) ?? pid.slice(0, 8),
      ...r,
    }))
    .sort((a, b) => b.rating - a.rating)
    .slice(0, limit);

  console.log(`\n── Top ${limit} players by Glicko-2 rating (min 10 games) ──`);
  console.log('Rank  Name                               Rating   RD    Games');
  sorted.forEach((p, i) => {
    console.log(
      `${String(i + 1).padStart(3)}.  ${p.name.padEnd(34)}  ${p.rating.toFixed(0).padStart(4)}  ${p.rd.toFixed(0).padStart(4)}  ${p.gamesPlayed}`
    );
  });
}

async function main() {
  const dry = process.argv.includes('--dry');
  console.log(`[RebuildRatings] ${dry ? 'DRY RUN' : 'LIVE REBUILD'}\n`);

  console.log('[RebuildRatings] Collecting all match events chronologically…');
  const events = await collectAllMatchEvents();
  console.log(`[RebuildRatings] ${events.length} events found (platform + PMR, deduped)`);

  if (events.length === 0) {
    console.log('[RebuildRatings] No events — nothing to do.');
    await prisma.$disconnect();
    return;
  }

  console.log(`[RebuildRatings] Earliest : ${events[0].date.toISOString().slice(0, 10)}`);
  console.log(`[RebuildRatings] Latest   : ${events[events.length - 1].date.toISOString().slice(0, 10)}`);

  console.log('\n[RebuildRatings] Replaying events in chronological order…');
  let i = 0;
  for (const ev of events) {
    await applyEvent(ev);
    i++;
    if (i % 500 === 0) process.stdout.write(`  Processed ${i}/${events.length}\r`);
  }
  console.log(`\n[RebuildRatings] Replayed ${i} events`);

  await flushToDB(dry);
  await showTop(25);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('[RebuildRatings] Fatal:', err);
  process.exit(1);
});
