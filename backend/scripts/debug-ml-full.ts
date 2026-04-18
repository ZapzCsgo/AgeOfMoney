import { PrismaClient } from '@prisma/client';
import { calculateOddsV2 } from '../src/services/oddsEngine';
const p = new PrismaClient();

(async () => {
  const ml = await p.player.findFirst({ where: { name: { contains: 'MarineLorD', mode: 'insensitive' } } });
  const jif = await p.player.findFirst({ where: { name: { contains: 'JIF Music', mode: 'insensitive' } } });
  if (!ml || !jif) return;
  const mlRec = await p.playerMatchRecord.findMany({
    where: { playerId: ml.id, game: 'AoE4', NOT: { opponentName: '__AI_ENRICHED__' } },
    select: { won: true, tier: true, matchDate: true, opponentId: true, score: true },
  });
  const jifRec = await p.playerMatchRecord.findMany({
    where: { playerId: jif.id, game: 'AoE4', NOT: { opponentName: '__AI_ENRICHED__' } },
    select: { won: true, tier: true, matchDate: true, opponentId: true, score: true },
  });

  // Build opponent winrate map
  const oppIds = new Set<string>();
  for (const r of [...mlRec, ...jifRec]) if (r.opponentId) oppIds.add(r.opponentId);
  const oppMap = new Map<string, number>();
  const oppRecords = await p.playerMatchRecord.findMany({
    where: { playerId: { in: [...oppIds] }, game: 'AoE4' },
    select: { playerId: true, won: true },
  });
  const grouped = new Map<string, { total: number; wins: number }>();
  for (const r of oppRecords) {
    const g = grouped.get(r.playerId) ?? { total: 0, wins: 0 };
    g.total++; if (r.won) g.wins++; grouped.set(r.playerId, g);
  }
  for (const [id, s] of grouped.entries()) if (s.total >= 3) oppMap.set(id, s.wins / s.total);

  const r = calculateOddsV2({
    p1Records: mlRec.map(x => ({ won: x.won, tier: x.tier || 'B', matchDate: x.matchDate, opponentId: x.opponentId, score: x.score })),
    p2Records: jifRec.map(x => ({ won: x.won, tier: x.tier || 'B', matchDate: x.matchDate, opponentId: x.opponentId, score: x.score })),
    h2h: [], daysSinceLastMatch1: 12, daysSinceLastMatch2: 12, matchTier: 'A', format: 'BO5',
    opponentWinrates: oppMap,
  });
  console.log(JSON.stringify(r, null, 2));
  await p.$disconnect();
})();
