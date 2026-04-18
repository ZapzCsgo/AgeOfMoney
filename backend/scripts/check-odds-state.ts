import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const rows = await p.match.findMany({
    where: { status: 'UPCOMING' },
    include: { player1: true, player2: true },
  });
  const filtered = rows.filter(r =>
    /marine|anotand|vortix|marinelord/i.test(r.player1.name + ' ' + r.player2.name)
  );
  for (const r of filtered) {
    console.log(`${r.player1.name.padEnd(20)} vs ${r.player2.name.padEnd(20)}  ${r.odds1}/${r.odds2}  updated=${r.updatedAt.toISOString()}`);
  }
  await p.$disconnect();
})();
