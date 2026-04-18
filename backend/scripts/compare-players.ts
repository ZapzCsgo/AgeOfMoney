import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function summarize(name: string) {
  const p = await prisma.player.findFirst({ where: { name: { contains: name, mode: 'insensitive' } } });
  if (!p) { console.log(`[${name}] not found`); return; }
  const records = await prisma.playerMatchRecord.findMany({
    where: { playerId: p.id, game: 'AoE4', NOT: { opponentName: '__AI_ENRICHED__' } },
    select: { won: true, tier: true },
  });
  const byTier: Record<string, { total: number; wins: number }> = {};
  for (const r of records) {
    const t = r.tier || 'Misc';
    if (!byTier[t]) byTier[t] = { total: 0, wins: 0 };
    byTier[t].total++;
    if (r.won) byTier[t].wins++;
  }
  const rawWR = records.length > 0 ? records.filter(r => r.won).length / records.length : 0;
  const tiers = Object.entries(byTier)
    .sort(([a], [b]) => ({ S: 5, A: 4, Qualifier: 3, B: 2, C: 1, Misc: 0 } as Record<string,number>)[b] - ({ S: 5, A: 4, Qualifier: 3, B: 2, C: 1, Misc: 0 } as Record<string,number>)[a])
    .map(([t, s]) => `${t}:${s.wins}/${s.total}(${((s.wins/s.total)*100).toFixed(0)}%)`).join('  ');
  console.log(`${p.name.padEnd(15)} n=${records.length.toString().padStart(3)} WR=${(rawWR*100).toFixed(0)}%  [${tiers}]`);
}

(async () => {
  for (const n of ['MarineLorD', 'JIF Music', 'Wam01', 'SAS']) {
    await summarize(n);
  }
  await prisma.$disconnect();
})();
