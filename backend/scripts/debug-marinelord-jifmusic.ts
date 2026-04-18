/**
 * Debug script — show tier breakdown + weighted winrate for MarineLord and
 * JIF Music so we can calibrate the odds model against the intuitive "ML is
 * a legend vs a random mid-tier" expectation.
 */
import { PrismaClient } from '@prisma/client';
import { calculateOddsV2 } from '../src/services/oddsEngine';
const prisma = new PrismaClient();

const TIER_WEIGHT: Record<string, number> = {
  S: 4.0, A: 2.0, Qualifier: 1.5, B: 1.0, C: 0.5, Misc: 0.3,
};

async function summarize(name: string) {
  const p = await prisma.player.findFirst({ where: { name: { contains: name, mode: 'insensitive' } } });
  if (!p) { console.log(`[${name}] not found`); return null; }
  const records = await prisma.playerMatchRecord.findMany({
    where: { playerId: p.id, game: 'AoE4', NOT: { opponentName: '__AI_ENRICHED__' } },
    select: { won: true, tier: true, matchDate: true, opponentId: true, opponentName: true },
    orderBy: { matchDate: 'desc' },
  });
  console.log(`\n── ${p.name} (id=${p.id.slice(0,8)}) — ${records.length} records`);

  const byTier: Record<string, { total: number; wins: number }> = {};
  for (const r of records) {
    const t = r.tier || 'Misc';
    if (!byTier[t]) byTier[t] = { total: 0, wins: 0 };
    byTier[t].total++;
    if (r.won) byTier[t].wins++;
  }
  let weightedWins = 0, weightedTotal = 0;
  for (const [t, s] of Object.entries(byTier).sort((a,b) => (TIER_WEIGHT[b[0]] ?? 0) - (TIER_WEIGHT[a[0]] ?? 0))) {
    const w = TIER_WEIGHT[t] ?? 1.0;
    weightedWins += s.wins * w;
    weightedTotal += s.total * w;
    console.log(`  tier=${t.padEnd(10)} n=${s.total.toString().padStart(3)}  W=${s.wins.toString().padStart(3)}  WR=${((s.wins/s.total)*100).toFixed(0)}%   weight=${w}`);
  }
  const rawWr = records.filter(r => r.won).length / records.length;
  const weightedWr = weightedTotal > 0 ? weightedWins / weightedTotal : 0;
  console.log(`  RAW winrate      = ${(rawWr * 100).toFixed(1)}% (unweighted, all tiers)`);
  console.log(`  TIER-WEIGHTED WR = ${(weightedWr * 100).toFixed(1)}%`);
  return { id: p.id, name: p.name, records };
}

async function main() {
  const ml = await summarize('MarineLorD');
  const jif = await summarize('JIF Music');
  if (!ml || !jif) { await prisma.$disconnect(); return; }

  // Build opponent-winrate map from DB — this is the real calibration fix
  const opponentIds = new Set<string>();
  for (const r of [...ml.records, ...jif.records]) if (r.opponentId) opponentIds.add(r.opponentId);
  const oppWinrateMap = new Map<string, number>();
  if (opponentIds.size > 0) {
    const oppRecords = await prisma.playerMatchRecord.findMany({
      where: { playerId: { in: [...opponentIds] }, game: 'AoE4' },
      select: { playerId: true, won: true },
    });
    const grouped = new Map<string, { total: number; wins: number }>();
    for (const r of oppRecords) {
      const g = grouped.get(r.playerId) ?? { total: 0, wins: 0 };
      g.total++; if (r.won) g.wins++; grouped.set(r.playerId, g);
    }
    for (const [id, s] of grouped.entries()) if (s.total >= 3) oppWinrateMap.set(id, s.wins / s.total);
  }
  console.log(`\nOpponent winrates: ${oppWinrateMap.size} players mapped`);

  // Run the V2 engine with real records + opponent winrates
  const mapRec = (r: typeof ml.records[number]) => ({
    won: r.won, tier: r.tier ?? 'B', matchDate: r.matchDate, opponentId: r.opponentId,
  });
  const out = calculateOddsV2({
    p1Records: ml.records.map(mapRec),
    p2Records: jif.records.map(mapRec),
    h2h: [],
    daysSinceLastMatch1: 7,
    daysSinceLastMatch2: 7,
    matchTier: 'A',
    format: 'BO5',
    opponentWinrates: oppWinrateMap,
  });
  console.log(`\n── V2 engine output (BO5, tier A, no H2H)`);
  console.log(`  prob1=${out.prob1.toFixed(4)}  prob2=${out.prob2.toFixed(4)}`);
  console.log(`  odds1=${out.odds1}  odds2=${out.odds2}  margin=${out.margin.toFixed(2)}%`);
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
