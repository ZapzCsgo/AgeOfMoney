/**
 * One-shot : cancel a LIVE match that the Liquipedia scorer can't resolve,
 * and refund every PENDING bet on it. Use when a match is stuck at status
 * LIVE because its liquipediaUrl points to a 404 (bad mint from the AoE
 * events calendar, typo, orphaned row, etc.).
 *
 * Usage :
 *   SKIP_SERVER=1 npx ts-node scripts/cancel-stuck-match.ts <matchId> [reason]
 *
 * Example :
 *   SKIP_SERVER=1 npx ts-node scripts/cancel-stuck-match.ts cmo8s627400ign5cbal2k3l5a \
 *     "Scorer couldn't resolve LP URL, manual cancel to refund bettors"
 *
 * The SKIP_SERVER=1 env var prevents index.ts from booting the HTTP listener,
 * the scorer, the roulette/jackpot loops, etc. — we just need the prisma
 * client + refundBets().
 */

import 'dotenv/config';

process.env.SKIP_SERVER = '1';

async function main() {
  const matchId = process.argv[2];
  const reason = process.argv[3] ?? 'Manual cancel (stuck match, scorer URL unresolvable)';

  if (!matchId) {
    console.error('Usage: npx ts-node scripts/cancel-stuck-match.ts <matchId> [reason]');
    process.exit(2);
  }

  // Lazy imports so SKIP_SERVER takes effect before index.ts side-effects run.
  const { prisma } = await import('../src/index');
  const { refundBets } = await import('../src/services/betService');

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      player1: { select: { name: true } },
      player2: { select: { name: true } },
      tournament: { select: { name: true, liquipediaUrl: true } },
    },
  });
  if (!match) {
    console.error(`[cancel-stuck-match] Match ${matchId} not found`);
    process.exit(1);
  }

  console.log(`\n[cancel-stuck-match] Target match:`);
  console.log(`  id               : ${match.id}`);
  console.log(`  status           : ${match.status}`);
  console.log(`  scheduledAt      : ${match.scheduledAt.toISOString()}`);
  console.log(`  players          : ${match.player1?.name} vs ${match.player2?.name}`);
  console.log(`  tournament       : ${match.tournament?.name}`);
  console.log(`  tournament LP url: ${match.tournament?.liquipediaUrl ?? '(none)'}`);
  console.log(`  match LP url     : ${match.liquipediaUrl ?? '(none)'}`);
  console.log(`  reason           : ${reason}\n`);

  if (match.status === 'CANCELLED') {
    console.log('[cancel-stuck-match] Match already CANCELLED — nothing to do.');
    process.exit(0);
  }
  if (match.status === 'COMPLETED') {
    console.error('[cancel-stuck-match] Match is COMPLETED — refusing to cancel a settled match.');
    process.exit(3);
  }

  // Count pending bets BEFORE we refund so the summary is accurate.
  const pendingBefore = await prisma.bet.count({
    where: { matchId, status: 'PENDING' },
  });

  await prisma.match.update({
    where: { id: matchId },
    data: { status: 'CANCELLED', betsOpen: false, verificationFlag: false },
  });

  // refundBets handles: batched $transaction to flip all PENDING → REFUNDED +
  // credit the users' coins, emits coinsUpdate + betResult sockets per user.
  await refundBets(matchId, reason);

  const [pendingAfter, refundedAfter] = await Promise.all([
    prisma.bet.count({ where: { matchId, status: 'PENDING' } }),
    prisma.bet.count({ where: { matchId, status: 'REFUNDED' } }),
  ]);

  console.log(`[cancel-stuck-match] Done.`);
  console.log(`  bets refunded this run : ${pendingBefore} (now PENDING=${pendingAfter}, REFUNDED=${refundedAfter})`);
  console.log(`  match status           : CANCELLED`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('[cancel-stuck-match] Fatal:', err);
  process.exit(1);
});
