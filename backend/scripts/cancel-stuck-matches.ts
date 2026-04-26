/**
 * Bulk cancel : cancels stuck LIVE matches and refunds every PENDING bet
 * on each one. Two modes :
 *
 *   1. Explicit IDs  — pass match IDs as positional args.
 *      SKIP_SERVER=1 npx ts-node scripts/cancel-stuck-matches.ts \
 *        cmo8s627400ign5cbal2k3l5a cmoXYZ... cmoABC...
 *
 *   2. Stale mode    — pass --stale=<hours> to find every LIVE match whose
 *      scheduledAt is older than that and which has no winnerId. Useful when
 *      the scorer is broken and dozens of matches are frozen. Defaults to
 *      a dry run; pass --apply to actually cancel.
 *      SKIP_SERVER=1 npx ts-node scripts/cancel-stuck-matches.ts --stale=2 --apply
 *
 *   3. Reason override — append --reason="..." to set the user-facing message.
 *
 * Examples :
 *   # Cancel a specific match
 *   SKIP_SERVER=1 npx ts-node scripts/cancel-stuck-matches.ts cmo8s627400ign5cbal2k3l5a
 *
 *   # Preview every LIVE match older than 2 h
 *   SKIP_SERVER=1 npx ts-node scripts/cancel-stuck-matches.ts --stale=2
 *
 *   # Apply
 *   SKIP_SERVER=1 npx ts-node scripts/cancel-stuck-matches.ts --stale=2 --apply
 *
 *   # Custom reason
 *   SKIP_SERVER=1 npx ts-node scripts/cancel-stuck-matches.ts cmoXYZ \
 *     --reason="Liquipedia URL bogus, manual cancel"
 */

import 'dotenv/config';

process.env.SKIP_SERVER = '1';

interface Args {
  ids: string[];
  staleHours: number | null;
  apply: boolean;
  reason: string;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    ids: [],
    staleHours: null,
    apply: false,
    reason: 'Match annulé manuellement (scorer ne résout plus la page Liquipedia)',
  };
  for (const a of argv) {
    if (a === '--apply') out.apply = true;
    else if (a.startsWith('--stale=')) out.staleHours = Number(a.split('=')[1]);
    else if (a.startsWith('--reason=')) out.reason = a.slice('--reason='.length);
    else if (a.startsWith('--')) {
      console.warn(`[cancel-stuck-matches] Unknown flag: ${a}`);
    } else {
      out.ids.push(a);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.ids.length === 0 && args.staleHours == null) {
    console.error([
      'Usage:',
      '  npx ts-node scripts/cancel-stuck-matches.ts <matchId> [<matchId>...]',
      '  npx ts-node scripts/cancel-stuck-matches.ts --stale=<hours> [--apply]',
      '  Optional: --reason="..."',
    ].join('\n'));
    process.exit(2);
  }

  const { prisma } = await import('../src/index');
  const { refundBets } = await import('../src/services/betService');

  // Resolve target IDs : either the explicit list, or all LIVE matches older
  // than --stale hours.
  let targets: string[] = args.ids;
  if (args.staleHours != null) {
    const cutoff = new Date(Date.now() - args.staleHours * 3_600_000);
    const stale = await prisma.match.findMany({
      where: {
        status: 'LIVE',
        winnerId: null,
        scheduledAt: { lt: cutoff },
      },
      select: {
        id: true, scheduledAt: true,
        player1: { select: { name: true } },
        player2: { select: { name: true } },
        tournament: { select: { name: true, liquipediaUrl: true } },
      },
      orderBy: { scheduledAt: 'asc' },
    });
    if (stale.length === 0) {
      console.log(`[cancel-stuck-matches] No LIVE match older than ${args.staleHours}h with no winner.`);
      await prisma.$disconnect();
      return;
    }
    console.log(`\n[cancel-stuck-matches] Found ${stale.length} stale LIVE match(es) (>${args.staleHours}h, no winner) :`);
    for (const m of stale) {
      const ageH = ((Date.now() - m.scheduledAt.getTime()) / 3_600_000).toFixed(1);
      console.log(`  ${m.id}  age=${ageH}h  ${m.player1?.name} vs ${m.player2?.name}  [${m.tournament?.name}]`);
    }
    if (!args.apply) {
      console.log(`\n[cancel-stuck-matches] DRY RUN. Re-run with --apply to actually cancel.`);
      await prisma.$disconnect();
      return;
    }
    targets = stale.map((m) => m.id);
  }

  let cancelled = 0;
  let refundedTotal = 0;
  let skipped = 0;

  for (const matchId of targets) {
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: {
        player1: { select: { name: true } },
        player2: { select: { name: true } },
        tournament: { select: { name: true, liquipediaUrl: true } },
      },
    });
    if (!match) {
      console.warn(`[cancel-stuck-matches] ${matchId} : not found, skipping`);
      skipped++;
      continue;
    }
    if (match.status === 'CANCELLED') {
      console.log(`[cancel-stuck-matches] ${matchId} : already CANCELLED, skipping`);
      skipped++;
      continue;
    }
    if (match.status === 'COMPLETED') {
      console.warn(`[cancel-stuck-matches] ${matchId} : COMPLETED, refusing to cancel`);
      skipped++;
      continue;
    }

    const pendingBefore = await prisma.bet.count({
      where: { matchId, status: 'PENDING' },
    });

    await prisma.match.update({
      where: { id: matchId },
      data: { status: 'CANCELLED', betsOpen: false, verificationFlag: false },
    });
    await refundBets(matchId, args.reason);

    cancelled++;
    refundedTotal += pendingBefore;
    console.log(
      `[cancel-stuck-matches] ${matchId} : ${match.player1?.name} vs ${match.player2?.name} ` +
      `→ CANCELLED, ${pendingBefore} bet(s) refunded`,
    );
  }

  console.log(`\n[cancel-stuck-matches] Summary :`);
  console.log(`  cancelled : ${cancelled}`);
  console.log(`  skipped   : ${skipped}`);
  console.log(`  bets refunded : ${refundedTotal}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('[cancel-stuck-matches] Fatal:', err);
  process.exit(1);
});
