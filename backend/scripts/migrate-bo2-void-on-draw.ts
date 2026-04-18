/**
 * Migration to the 2-way void-on-draw BO2 market.
 *
 * This script is idempotent — safe to re-run.
 *
 * Steps:
 *  1. NULL out `oddsDraw` on all UPCOMING/LIVE BO2/BO4 matches — the 3rd
 *     market is no longer offered. Backend code now writes null on its own,
 *     so this only cleans up existing stale values.
 *  2. Refund all PENDING bets with `selectedPlayer=0` (legacy draw bets) —
 *     the market they bet into no longer exists, so we honor their stake
 *     rather than void them silently.
 *
 * Usage (prod via Supabase pooler):
 *   SKIP_SERVER=1 DATABASE_URL="postgresql://postgres.<ref>:<pw>@aws-1-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=5" \
 *     npx tsx scripts/migrate-bo2-void-on-draw.ts
 *
 * Options:
 *   --dry   show what would change without writing
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const dry = process.argv.includes('--dry');
  console.log(`[Migration] BO2 void-on-draw — ${dry ? 'DRY RUN' : 'WRITING'}`);

  // ── Step 1: null oddsDraw on even-BO matches that still have non-null oddsDraw
  const oddsDrawToNull = await prisma.match.findMany({
    where: {
      status: { in: ['UPCOMING', 'LIVE'] },
      oddsDraw: { not: null },
    },
    select: { id: true, format: true, oddsDraw: true },
  });
  console.log(`\nStep 1: ${oddsDrawToNull.length} matches with stale oddsDraw to clear`);
  for (const m of oddsDrawToNull.slice(0, 10)) {
    console.log(`  ${m.id.slice(0, 8)}  ${m.format}  oddsDraw=${m.oddsDraw}`);
  }
  if (!dry && oddsDrawToNull.length > 0) {
    const { count } = await prisma.match.updateMany({
      where: { status: { in: ['UPCOMING', 'LIVE'] }, oddsDraw: { not: null } },
      data: { oddsDraw: null },
    });
    console.log(`  ✓ nulled ${count} oddsDraw values`);
  }

  // ── Step 2: refund PENDING legacy draw bets (selectedPlayer=0) on any
  // match where the draw market is being decommissioned. These are rare but
  // we must handle them cleanly.
  const drawBets = await prisma.bet.findMany({
    where: { selectedPlayer: 0, status: 'PENDING' },
    select: {
      id: true, userId: true, amount: true,
      match: { select: { id: true, format: true, status: true } },
    },
  });
  console.log(`\nStep 2: ${drawBets.length} PENDING legacy draw bets to refund`);
  for (const b of drawBets.slice(0, 10)) {
    console.log(`  bet=${b.id.slice(0, 8)}  user=${b.userId.slice(0, 8)}  amount=${b.amount}  match=${b.match?.id.slice(0, 8)} (${b.match?.format})`);
  }

  if (!dry && drawBets.length > 0) {
    // Group by matchId so socket notifications can say "Match nul annulé —
    // marché fermé" with the right reason. Since the match may not actually
    // be done yet (still UPCOMING), we can't truly "refund on draw" — we just
    // void the bet preemptively and credit the stake back.
    const refundReason = "Marché Égalité fermé — stake remboursé (passage au modèle void-on-draw)";

    // Refund in one transaction: update bets + increment user coins
    await prisma.$transaction([
      prisma.bet.updateMany({
        where: { selectedPlayer: 0, status: 'PENDING' },
        data: { status: 'REFUNDED' },
      }),
      ...drawBets.map(b =>
        prisma.user.update({
          where: { id: b.userId },
          data: { coins: { increment: b.amount } },
        })
      ),
    ]);
    console.log(`  ✓ refunded ${drawBets.length} bets, reason: "${refundReason}"`);

    // Socket notifications (best effort — don't block on absence of io)
    try {
      const { getIo } = await import('../src/socket');
      const io = getIo();
      if (io) {
        for (const b of drawBets) {
          io.to(`user:${b.userId}`).emit('betResult', {
            matchId: b.match?.id,
            betId: b.id,
            won: false,
            refunded: true,
            reason: refundReason,
            amount: b.amount,
            payout: b.amount,
          });
        }
      }
    } catch { /* no socket, silent */ }
  }

  console.log(`\n── Migration done ──`);
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
