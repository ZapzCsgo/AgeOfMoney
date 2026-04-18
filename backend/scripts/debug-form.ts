import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

(async () => {
  const p = await prisma.player.findFirst({ where: { name: { contains: 'MarineLorD', mode: 'insensitive' } } });
  if (!p) { console.log('not found'); return; }
  const records = await prisma.playerMatchRecord.findMany({
    where: { playerId: p.id, game: 'AoE4', NOT: { opponentName: '__AI_ENRICHED__' } },
    orderBy: { matchDate: 'desc' },
    take: 12,
    select: { won: true, tier: true, score: true, matchDate: true, opponentName: true },
  });
  console.log('MarineLord — last 12 matches:');
  for (const r of records) {
    console.log(`  ${r.matchDate?.toISOString().slice(0,10)}  ${r.tier?.padEnd(10)}  ${r.won ? 'W' : 'L'}  score="${r.score ?? 'null'}"  vs ${r.opponentName}`);
  }
  await prisma.$disconnect();
})();
