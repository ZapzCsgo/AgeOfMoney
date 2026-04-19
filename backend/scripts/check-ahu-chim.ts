import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function summarize(name: string) {
  const pl = await p.player.findFirst({ where: { name: { contains: name, mode: 'insensitive' } } });
  if (!pl) { console.log(`[${name}] not found`); return; }
  const records = await p.playerMatchRecord.findMany({
    where: { playerId: pl.id, NOT: { opponentName: '__AI_ENRICHED__' } },
    select: { won: true, tier: true, game: true, score: true, matchDate: true, opponentName: true },
    orderBy: { matchDate: 'desc' },
  });
  const byGame: Record<string, { total: number; wins: number }> = {};
  for (const r of records) {
    const g = r.game;
    if (!byGame[g]) byGame[g] = { total: 0, wins: 0 };
    byGame[g].total++;
    if (r.won) byGame[g].wins++;
  }
  console.log(`\n── ${pl.name} (id=${pl.id.slice(0,8)}) — ${records.length} records`);
  for (const [g, s] of Object.entries(byGame)) {
    console.log(`  game=${g}  n=${s.total}  W=${s.wins}  WR=${((s.wins/s.total)*100).toFixed(0)}%`);
  }
  const byTier: Record<string, { total: number; wins: number }> = {};
  for (const r of records) {
    const t = r.tier || 'Misc';
    if (!byTier[t]) byTier[t] = { total: 0, wins: 0 };
    byTier[t].total++;
    if (r.won) byTier[t].wins++;
  }
  for (const [t, s] of Object.entries(byTier).sort(([a], [b]) => ({ S: 5, A: 4, Qualifier: 3, B: 2, C: 1, Misc: 0 } as Record<string,number>)[b] - ({ S: 5, A: 4, Qualifier: 3, B: 2, C: 1, Misc: 0 } as Record<string,number>)[a])) {
    console.log(`  tier=${t.padEnd(10)}  n=${s.total.toString().padStart(3)}  W=${s.wins.toString().padStart(3)}  WR=${((s.wins/s.total)*100).toFixed(0)}%`);
  }
  console.log(`  last 10 matches:`);
  for (const r of records.slice(0, 10)) {
    console.log(`    ${r.matchDate?.toISOString().slice(0,10)}  ${r.tier?.padEnd(10)}  ${r.game}  ${r.won ? 'W' : 'L'}  ${r.score ?? '-'}  vs ${r.opponentName}`);
  }
}

(async () => {
  await summarize('Anh Huy');
  await summarize('Chim Sẻ Đi Nắng');
  // Also check the match itself
  const m = await p.match.findFirst({
    where: { status: 'UPCOMING' },
    include: { player1: true, player2: true, tournament: true },
    orderBy: { scheduledAt: 'asc' },
  });
  // Find the one that's Anh Huy vs Chim
  const all = await p.match.findMany({
    where: { status: 'UPCOMING' },
    include: { player1: true, player2: true, tournament: true },
  });
  for (const mm of all) {
    if (/Anh Huy|Chim/i.test(mm.player1.name + ' ' + mm.player2.name) && /Chim|Anh Huy/i.test(mm.player1.name + ' ' + mm.player2.name)) {
      console.log(`\n── MATCH : ${mm.player1.name} vs ${mm.player2.name}`);
      console.log(`  game=${mm.game}  format=${mm.format}  tier=${mm.tournament?.tier}  tournament=${mm.tournament?.name}`);
      console.log(`  odds1=${mm.odds1}  odds2=${mm.odds2}  oddsDraw=${mm.oddsDraw}`);
    }
  }
  void m;
  await p.$disconnect();
})();
