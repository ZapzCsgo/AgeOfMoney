// Throwaway verification script for correctMatchResult() — run against the
// local demo DB only. Creates a fresh match + bets, settles it, corrects
// the winner, and asserts the reversal/payout/ledger rows are all correct.
import { PrismaClient, BetStatus } from '@prisma/client';
import { distributePayout, correctMatchResult } from '../src/services/betService';

const prisma = new PrismaClient();

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`  OK: ${msg}`);
}

async function main() {
  const [p1, p2] = await prisma.player.findMany({ take: 2 });
  if (!p1 || !p2) throw new Error('Need at least 2 seeded players — run seed-demo.ts first');

  const [uA, uB] = await prisma.user.findMany({ where: { provider: 'demo' }, take: 2 });
  if (!uA || !uB) throw new Error('Need at least 2 seeded demo users — run seed-demo.ts first');

  const startA = Number((await prisma.user.findUniqueOrThrow({ where: { id: uA.id } })).coins);
  const startB = Number((await prisma.user.findUniqueOrThrow({ where: { id: uB.id } })).coins);

  const match = await prisma.match.create({
    data: {
      player1Id: p1.id, player2Id: p2.id, game: 'AoE4', format: 'BO3',
      scheduledAt: new Date(Date.now() - 3600_000), status: 'UPCOMING',
      odds1: 1.80, odds2: 1.90,
    },
  });
  console.log(`Created test match ${match.id}: ${p1.name} vs ${p2.name}`);

  const betA = await prisma.bet.create({ // bets on player1
    data: { userId: uA.id, matchId: match.id, amount: 100, oddsAtBet: 1.80, selectedPlayer: 1, status: BetStatus.PENDING },
  });
  const betB = await prisma.bet.create({ // bets on player2
    data: { userId: uB.id, matchId: match.id, amount: 100, oddsAtBet: 1.90, selectedPlayer: 2, status: BetStatus.PENDING },
  });
  console.log(`Placed bet A (${uA.username} -> p1) and bet B (${uB.username} -> p2)`);

  // Initial (wrong) result: player1 wins.
  await prisma.match.update({ where: { id: match.id }, data: { status: 'COMPLETED', winnerId: p1.id, resultScore: '2-0' } });
  await distributePayout(match.id, p1.id);

  const afterFirst = await prisma.bet.findMany({ where: { matchId: match.id }, orderBy: { selectedPlayer: 'asc' } });
  const aAfterFirst = afterFirst.find(b => b.id === betA.id)!;
  const bAfterFirst = afterFirst.find(b => b.id === betB.id)!;
  assert(aAfterFirst.status === 'WON', 'bet A (p1) is WON after initial result');
  assert(bAfterFirst.status === 'LOST', 'bet B (p2) is LOST after initial result');
  const userAAfterFirst = Number((await prisma.user.findUniqueOrThrow({ where: { id: uA.id } })).coins);
  assert(Math.abs(userAAfterFirst - (startA + 180)) < 0.01, `user A credited 180 (100*1.80) — balance ${userAAfterFirst}, expected ${startA + 180}`);

  // Correction: actually player2 won.
  await prisma.match.update({ where: { id: match.id }, data: { winnerId: p2.id, resultScore: '2-1' } });
  const summary = await correctMatchResult(match.id, p2.id, 'test-admin-id');
  console.log('Correction summary:', summary);

  const afterCorrection = await prisma.bet.findMany({ where: { matchId: match.id } });
  const aAfterCorrection = afterCorrection.find(b => b.id === betA.id)!;
  const bAfterCorrection = afterCorrection.find(b => b.id === betB.id)!;
  assert(aAfterCorrection.status === 'LOST', 'bet A (p1) flipped to LOST after correction');
  assert(Number(aAfterCorrection.payout) === 0, 'bet A payout zeroed after correction');
  assert(bAfterCorrection.status === 'WON', 'bet B (p2) flipped to WON after correction');
  assert(Math.abs(Number(bAfterCorrection.payout) - 190) < 0.01, `bet B payout is 190 (100*1.90), got ${bAfterCorrection.payout}`);

  const userAFinal = Number((await prisma.user.findUniqueOrThrow({ where: { id: uA.id } })).coins);
  const userBFinal = Number((await prisma.user.findUniqueOrThrow({ where: { id: uB.id } })).coins);
  assert(Math.abs(userAFinal - startA) < 0.01, `user A clawed back to original balance — ${userAFinal}, expected ${startA}`);
  assert(Math.abs(userBFinal - (startB + 190)) < 0.01, `user B credited 190 — ${userBFinal}, expected ${startB + 190}`);

  const ledgerRows = await prisma.transaction.findMany({
    where: { userId: { in: [uA.id, uB.id] }, type: { in: ['bet_correction_reversal', 'bet_correction_payout'] }, createdAt: { gte: match.createdAt } },
    orderBy: { createdAt: 'asc' },
  });
  assert(ledgerRows.some(r => r.userId === uA.id && r.type === 'bet_correction_reversal' && Number(r.coins) === -180), 'ledger has -180 reversal row for user A');
  assert(ledgerRows.some(r => r.userId === uB.id && r.type === 'bet_correction_payout' && Number(r.coins) === 190), 'ledger has +190 payout row for user B');

  // Idempotency check: re-running the same correction should be a no-op (ops.length === 0 path).
  const secondRun = await correctMatchResult(match.id, p2.id, 'test-admin-id');
  assert(secondRun.reversed === 0 && secondRun.newlyPaid === 0, 're-running the same correction is a no-op (idempotent)');

  console.log('\nAll assertions passed. Cleaning up test data...');
  await prisma.transaction.deleteMany({ where: { id: { in: ledgerRows.map(r => r.id) } } });
  await prisma.bet.deleteMany({ where: { matchId: match.id } });
  await prisma.match.delete({ where: { id: match.id } });
  await prisma.user.update({ where: { id: uA.id }, data: { coins: startA } });
  await prisma.user.update({ where: { id: uB.id }, data: { coins: startB } });
  console.log('Cleaned up. Done.');
}

// main() imports betService -> ../index, which boots the full Express app
// (listen + cron + socket.io) as an import side effect. We only want the
// Prisma logic here, so force-exit instead of waiting for those handles to
// close — this is a throwaway verification script, not a long-lived process.
main()
  .then(() => process.exit(0))
  .catch(e => { console.error(e); process.exit(1); });
