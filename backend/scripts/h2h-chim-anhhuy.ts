import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

(async () => {
  const chim = await p.player.findFirst({ where: { name: { contains: 'Chim', mode: 'insensitive' } } });
  const anh = await p.player.findFirst({ where: { name: { contains: 'Anh Huy', mode: 'insensitive' } } });
  if (!chim || !anh) { console.log('not found'); return; }
  console.log(`Chim id=${chim.id.slice(0,8)}  Anh Huy id=${anh.id.slice(0,8)}`);

  // All records from Chim that mention Anh Huy (either by id or by name)
  const byId = await p.playerMatchRecord.findMany({
    where: {
      OR: [
        { playerId: chim.id, opponentId: anh.id },
        { playerId: anh.id, opponentId: chim.id },
      ],
    },
    orderBy: { matchDate: 'desc' },
  });
  console.log(`\nH2H by opponentId resolve: ${byId.length} records`);
  for (const r of byId) {
    const perspective = r.playerId === chim.id ? 'Chim' : 'Anh Huy';
    console.log(`  ${r.matchDate?.toISOString().slice(0,10)}  ${r.tier}  [${perspective} perspective]  ${r.won ? 'W' : 'L'}  score=${r.score}  vs ${r.opponentName}`);
  }

  // Also by opponentName (in case opponentId not resolved)
  const byName = await p.playerMatchRecord.findMany({
    where: {
      OR: [
        { playerId: chim.id, opponentName: { contains: 'Anh Huy', mode: 'insensitive' } },
        { playerId: anh.id, opponentName: { contains: 'Chim', mode: 'insensitive' } },
      ],
    },
    orderBy: { matchDate: 'desc' },
  });
  console.log(`\nH2H by opponentName: ${byName.length} records`);
  for (const r of byName) {
    const perspective = r.playerId === chim.id ? 'Chim' : 'Anh Huy';
    console.log(`  ${r.matchDate?.toISOString().slice(0,10)}  ${r.tier}  [${perspective} perspective]  ${r.won ? 'W' : 'L'}  score=${r.score}  vs ${r.opponentName}`);
  }

  await p.$disconnect();
})();
