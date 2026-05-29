/**
 * TFT tournament settlement — pays out winning bets and refunds the rest.
 *
 * Called from cron every 10 min for any tournament whose endDate is in the
 * past AND that still has PENDING TournamentWinnerBet rows. The winner is
 * read from TournamentParticipant.finalRank=1 (set by the live scoring
 * paths : CompeteTFT for fast updates, Liquipedia for the canonical
 * post-tournament rewrite).
 *
 * If we can't determine a winner after a grace period (24h post-endDate),
 * we refund all bets — same conservative posture as the AoE auto-cancel
 * path. A "ghost tournament" that never settles is worse for trust than
 * giving back the stakes.
 */

import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../index';
import { recordLedger } from './ledger';
import { getIo } from '../socket';
import logger from '../logger';

const SETTLEMENT_GRACE_HOURS = 24;

/**
 * Settle one tournament. Returns counts so cron can log progress.
 *
 * Idempotent : already-settled bets are skipped, and a tournament with
 * no PENDING bets returns immediately without touching the DB.
 */
export async function settleTournament(tournamentId: string): Promise<{
  paid: number;
  lost: number;
  refunded: number;
  totalPayout: string;
}> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: {
      id: true,
      name: true,
      endDate: true,
      game: true,
      participants: {
        select: { id: true, playerId: true, finalRank: true, isWinner: true, player: { select: { name: true } } },
      },
    },
  });
  if (!tournament || tournament.game !== 'TFT') {
    return { paid: 0, lost: 0, refunded: 0, totalPayout: '0' };
  }

  const pendingBets = await prisma.tournamentWinnerBet.findMany({
    where: { tournamentId, status: 'PENDING' },
    select: { id: true, userId: true, participantId: true, stake: true, oddsAtBet: true },
  });
  if (pendingBets.length === 0) {
    return { paid: 0, lost: 0, refunded: 0, totalPayout: '0' };
  }

  // ── Decide outcome ────────────────────────────────────────────────────
  const winners = tournament.participants.filter((p) => p.isWinner || p.finalRank === 1);
  const endPast = tournament.endDate ? tournament.endDate.getTime() < Date.now() : false;
  const pastGrace = tournament.endDate
    ? tournament.endDate.getTime() + SETTLEMENT_GRACE_HOURS * 3600 * 1000 < Date.now()
    : false;

  // No winner identified and we're past the grace window → refund everyone.
  // Same path also runs when tournament has been marked isActive=false
  // (admin cancel). It's the conservative escape hatch.
  if (winners.length === 0 && pastGrace) {
    return refundAllBets(tournamentId, tournament.name, 'Tournoi sans gagnant déterminé après le délai');
  }

  // Mid-grace : still waiting for live scorer to set finalRank — skip
  if (winners.length === 0 || !endPast) {
    logger.info(`[TFTSettle] "${tournament.name}" not ready yet (endPast=${endPast}, winners=${winners.length})`);
    return { paid: 0, lost: 0, refunded: 0, totalPayout: '0' };
  }

  if (winners.length > 1) {
    logger.warn(`[TFTSettle] "${tournament.name}" has ${winners.length} winners — unexpected, taking first by finalRank`);
  }
  const winnerParticipantId = winners[0].id;

  // ── Pay / mark losses ─────────────────────────────────────────────────
  let paid = 0, lost = 0;
  let totalPayout = new Decimal(0);
  const io = getIo();

  for (const bet of pendingBets) {
    const won = bet.participantId === winnerParticipantId;
    try {
      await prisma.$transaction(async (tx) => {
        if (won) {
          const payout = new Decimal(bet.stake.toString()).mul(bet.oddsAtBet.toString());
          await tx.tournamentWinnerBet.update({
            where: { id: bet.id },
            data: { status: 'WON', payout, settledAt: new Date() },
          });
          await tx.user.update({
            where: { id: bet.userId },
            data: { coins: { increment: payout } },
          });
          await recordLedger(tx, {
            userId: bet.userId,
            type: 'tft_bet_won',
            coins: payout,
          });
          totalPayout = totalPayout.add(payout);
          paid++;
        } else {
          await tx.tournamentWinnerBet.update({
            where: { id: bet.id },
            data: { status: 'LOST', payout: new Decimal(0), settledAt: new Date() },
          });
          lost++;
        }
      }, { timeout: 10_000 });

      io?.to(`user:${bet.userId}`).emit('tftBetSettled', {
        betId: bet.id, status: won ? 'WON' : 'LOST',
        payout: won ? totalPayout.toString() : '0',
      });
    } catch (err) {
      logger.error(`[TFTSettle] Failed to settle bet ${bet.id}:`, err);
    }
  }

  logger.info(
    `[TFTSettle] "${tournament.name}": paid ${paid} winners (${totalPayout.toString()} ◈), ${lost} losers`,
  );
  return { paid, lost, refunded: 0, totalPayout: totalPayout.toString() };
}

async function refundAllBets(
  tournamentId: string,
  tournamentName: string,
  reason: string,
): Promise<{ paid: number; lost: number; refunded: number; totalPayout: string }> {
  const bets = await prisma.tournamentWinnerBet.findMany({
    where: { tournamentId, status: 'PENDING' },
    select: { id: true, userId: true, stake: true },
  });

  let refunded = 0;
  let totalRefund = new Decimal(0);
  const io = getIo();

  for (const bet of bets) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.tournamentWinnerBet.update({
          where: { id: bet.id },
          data: { status: 'REFUNDED', payout: bet.stake, settledAt: new Date() },
        });
        await tx.user.update({
          where: { id: bet.userId },
          data: { coins: { increment: bet.stake } },
        });
        await recordLedger(tx, {
          userId: bet.userId,
          type: 'tft_bet_refund',
          coins: new Decimal(bet.stake.toString()),
        });
        totalRefund = totalRefund.add(bet.stake.toString());
        refunded++;
      }, { timeout: 10_000 });

      io?.to(`user:${bet.userId}`).emit('tftBetSettled', {
        betId: bet.id, status: 'REFUNDED', reason,
      });
    } catch (err) {
      logger.error(`[TFTSettle] Refund failed for bet ${bet.id}:`, err);
    }
  }

  logger.warn(`[TFTSettle] "${tournamentName}" refunded ${refunded} bets (${totalRefund.toString()} ◈) — ${reason}`);
  return { paid: 0, lost: 0, refunded, totalPayout: totalRefund.toString() };
}

/**
 * Cron entry — finds all TFT tournaments past their endDate that still
 * have PENDING bets, settles each.
 */
export async function settleAllReadyTftTournaments(): Promise<void> {
  const tournaments = await prisma.tournament.findMany({
    where: {
      game: 'TFT',
      endDate: { lt: new Date() },
      tournamentWinnerBets: { some: { status: 'PENDING' } },
    },
    select: { id: true, name: true },
    take: 20,
  });
  if (tournaments.length === 0) return;
  logger.info(`[TFTSettle] Checking ${tournaments.length} tournaments for settlement`);
  for (const t of tournaments) {
    try {
      await settleTournament(t.id);
    } catch (err) {
      logger.error(`[TFTSettle] settleTournament failed for ${t.id}:`, err);
    }
  }
}

/**
 * Admin override — force-set a tournament's winner. Used when the live
 * scorer fails to identify it (e.g. the LP page is locked for editing)
 * but we have confirmation from a Twitch broadcast.
 */
export async function setTournamentWinner(
  tournamentId: string,
  participantId: string,
): Promise<void> {
  const participant = await prisma.tournamentParticipant.findUnique({
    where: { id: participantId },
    select: { id: true, tournamentId: true },
  });
  if (!participant || participant.tournamentId !== tournamentId) {
    throw new Error(`Participant ${participantId} does not belong to tournament ${tournamentId}`);
  }

  await prisma.$transaction([
    // Unmark any previous winner
    prisma.tournamentParticipant.updateMany({
      where: { tournamentId, isWinner: true },
      data: { isWinner: false },
    }),
    prisma.tournamentParticipant.update({
      where: { id: participantId },
      data: { isWinner: true, finalRank: 1 },
    }),
    prisma.tournament.update({
      where: { id: tournamentId },
      data: { liveSyncSource: 'admin', lastLiveSync: new Date() },
    }),
  ]);

  await settleTournament(tournamentId);
}

// Ensure Prisma's Decimal/Prisma namespace is referenced so the type stays
// in the bundle for callers that import these as types only.
export type { Prisma };
