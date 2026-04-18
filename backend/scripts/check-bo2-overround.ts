import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string; format: string; odds1: number; od: number | null; odds2: number;
    p1: string; p2: string; overround: number;
  }>>(`
    SELECT m.id, m.format, m.odds1, m."oddsDraw" as od, m.odds2,
      p1.name as p1, p2.name as p2,
      (1.0/m.odds1 + COALESCE(1.0/m."oddsDraw",0) + 1.0/m.odds2) as overround
    FROM "Match" m
    JOIN "Player" p1 ON p1.id = m."player1Id"
    JOIN "Player" p2 ON p2.id = m."player2Id"
    WHERE m.format = 'BO2' AND m.status = 'UPCOMING'
    ORDER BY m."scheduledAt" ASC
  `);
  for (const r of rows) {
    const ov = Number(r.overround);
    const flag = ov < 1.0 ? 'ARB!!' : ov > 1.20 ? 'HIGH' : ov < 1.05 ? 'LOW' : 'OK';
    console.log(`[${flag.padEnd(5)}] ${r.p1} vs ${r.p2}  odds=${r.odds1}/${r.od ?? '-'}/${r.odds2}  Σ=${ov.toFixed(4)}  id=${r.id.slice(0,8)}`);
  }
  console.log(`\n── ${rows.length} UPCOMING BO2 matches total`);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
