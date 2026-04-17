/**
 * Coinflip PvP service — two players bet on a coin flip with 5% house rake.
 *
 * Provably fair: serverSeed is generated at creation, seedHash (SHA-256) is
 * shown immediately. The serverSeed is only revealed after the game completes,
 * so players can verify the result was predetermined.
 *
 * Result derivation: first byte of serverSeed % 2 === 0 → "crown", else "shield"
 */

import crypto from 'crypto';
import { prisma } from '../index';
import { getIo } from '../socket';
import { creditAffiliateOnBetResolved } from './affiliateService';
import logger from '../logger';

const RAKE_RATE = 0.05; // 5%
const MIN_BET = 2;
const MAX_BET = 500;
const RESULT_DELAY_MS = 3_500; // delay before revealing result (animation time)

/** Strip serverSeed from a coinflip record for client-safe emission. */
function sanitizeGame(game: Record<string, unknown>) {
  const { serverSeed: _seed, ...safe } = game;
  return safe;
}

/** Derive result from serverSeed (deterministic). */
function deriveResult(serverSeed: string): 'crown' | 'shield' {
  const firstByte = parseInt(serverSeed.slice(0, 2), 16);
  return firstByte % 2 === 0 ? 'crown' : 'shield';
}

export async function createCoinFlip(
  userId: string,
  amount: number,
  side: 'crown' | 'shield',
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  if (!Number.isInteger(amount) || amount < MIN_BET || amount > MAX_BET) {
    return { ok: false, error: `Bet must be between ${MIN_BET} and ${MAX_BET} coins` };
  }
  if (side !== 'crown' && side !== 'shield') {
    return { ok: false, error: 'Side must be "crown" or "shield"' };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { coins: true, isBanned: true },
  });
  if (!user) return { ok: false, error: 'User not found' };
  if (user.isBanned) return { ok: false, error: 'Account banned' };
  if (user.coins < amount) return { ok: false, error: 'Insufficient coins' };

  // Generate provably fair seed
  const serverSeed = crypto.randomBytes(32).toString('hex');
  const seedHash = crypto.createHash('sha256').update(serverSeed).digest('hex');

  // Atomic: deduct coins + create game
  const game = await prisma.$transaction(async (tx) => {
    const freshUser = await tx.user.findUnique({ where: { id: userId }, select: { coins: true } });
    if (!freshUser || freshUser.coins < amount) throw new Error('Insufficient coins');

    await tx.user.update({
      where: { id: userId },
      data: { coins: { decrement: amount }, totalWagered: { increment: amount } },
    });

    return tx.coinFlip.create({
      data: {
        creatorId: userId,
        amount,
        creatorSide: side,
        serverSeed,
        seedHash,
        status: 'WAITING',
      },
      include: {
        creator: { select: { id: true, username: true, avatar: true } },
      },
    });
  });

  const io = getIo();
  // Notify creator of coin deduction
  const updatedUser = await prisma.user.findUnique({ where: { id: userId }, select: { coins: true } });
  io?.to(`user:${userId}`).emit('coinsUpdate', { coins: updatedUser?.coins ?? 0, direction: 'down' });

  // Broadcast to lobby (without serverSeed)
  io?.to('coinflip:lobby').emit('coinflip:created', sanitizeGame(game as unknown as Record<string, unknown>));

  logger.info(`[Coinflip] Game ${game.id} created by ${userId} — ${amount} coins, side=${side}`);
  return { ok: true, data: sanitizeGame(game as unknown as Record<string, unknown>) };
}

export async function joinCoinFlip(
  userId: string,
  gameId: string,
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const game = await prisma.coinFlip.findUnique({ where: { id: gameId } });
  if (!game) return { ok: false, error: 'Game not found' };
  if (game.status !== 'WAITING') return { ok: false, error: 'Game is no longer available' };
  if (game.creatorId === userId) return { ok: false, error: 'Cannot join your own game' };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { coins: true, isBanned: true },
  });
  if (!user) return { ok: false, error: 'User not found' };
  if (user.isBanned) return { ok: false, error: 'Account banned' };
  if (user.coins < game.amount) return { ok: false, error: 'Insufficient coins' };

  // Determine result
  const result = deriveResult(game.serverSeed);
  const creatorWon = game.creatorSide === result;
  const winnerId = creatorWon ? game.creatorId : userId;

  const totalPot = game.amount * 2;
  const rake = Math.floor(totalPot * RAKE_RATE);
  const payout = totalPot - rake;

  // Atomic: deduct joiner coins, credit winner, update game
  const updatedGame = await prisma.$transaction(async (tx) => {
    const freshUser = await tx.user.findUnique({ where: { id: userId }, select: { coins: true } });
    if (!freshUser || freshUser.coins < game.amount) throw new Error('Insufficient coins');

    // Deduct joiner coins + track wager
    await tx.user.update({
      where: { id: userId },
      data: { coins: { decrement: game.amount }, totalWagered: { increment: game.amount } },
    });

    // Credit winner
    await tx.user.update({
      where: { id: winnerId },
      data: { coins: { increment: payout } },
    });

    // Update game
    return tx.coinFlip.update({
      where: { id: gameId },
      data: {
        joinerId: userId,
        status: 'FLIPPING',
        result,
        winnerId,
        rake,
        completedAt: new Date(),
      },
      include: {
        creator: { select: { id: true, username: true, avatar: true } },
        joiner: { select: { id: true, username: true, avatar: true } },
      },
    });
  });

  const io = getIo();

  // Notify joiner of coin deduction
  const joinerUpdated = await prisma.user.findUnique({ where: { id: userId }, select: { coins: true } });
  io?.to(`user:${userId}`).emit('coinsUpdate', { coins: joinerUpdated?.coins ?? 0, direction: 'down' });

  // Broadcast join (without serverSeed — still flipping)
  io?.to('coinflip:lobby').emit('coinflip:joined', sanitizeGame(updatedGame as unknown as Record<string, unknown>));

  // After animation delay, reveal result with serverSeed for verification
  setTimeout(async () => {
    try {
      await prisma.coinFlip.update({
        where: { id: gameId },
        data: { status: 'COMPLETED' },
      });

      // Fetch fresh winner balance for coin notification
      const winnerUser = await prisma.user.findUnique({ where: { id: winnerId }, select: { coins: true } });
      io?.to(`user:${winnerId}`).emit('coinsUpdate', { coins: winnerUser?.coins ?? 0, direction: 'up' });

      // Reveal full result including serverSeed
      const completedGame = await prisma.coinFlip.findUnique({
        where: { id: gameId },
        include: {
          creator: { select: { id: true, username: true, avatar: true } },
          joiner: { select: { id: true, username: true, avatar: true } },
        },
      });

      io?.to('coinflip:lobby').emit('coinflip:result', completedGame);

      logger.info(`[Coinflip] Game ${gameId} completed — winner=${winnerId}, result=${result}, payout=${payout}, rake=${rake}`);
    } catch (err) {
      logger.error(`[Coinflip] Error resolving game ${gameId}:`, err);
    }
  }, RESULT_DELAY_MS);

  // Credit affiliate revshare (fire and forget)
  // Creator: net delta is negative payout if they won, positive amount if they lost
  const creatorNetDelta = creatorWon ? -(payout - game.amount) : game.amount;
  creditAffiliateOnBetResolved(game.creatorId, game.amount, creatorNetDelta)
    .catch(err => logger.warn('[Affiliate] coinflip credit failed (creator):', err));

  // Joiner: net delta is negative payout if they won, positive amount if they lost
  const joinerNetDelta = !creatorWon ? -(payout - game.amount) : game.amount;
  creditAffiliateOnBetResolved(userId, game.amount, joinerNetDelta)
    .catch(err => logger.warn('[Affiliate] coinflip credit failed (joiner):', err));

  return { ok: true, data: sanitizeGame(updatedGame as unknown as Record<string, unknown>) };
}

export async function cancelCoinFlip(
  userId: string,
  gameId: string,
): Promise<{ ok: boolean; error?: string }> {
  const game = await prisma.coinFlip.findUnique({ where: { id: gameId } });
  if (!game) return { ok: false, error: 'Game not found' };
  if (game.status !== 'WAITING') return { ok: false, error: 'Game cannot be cancelled' };
  if (game.creatorId !== userId) return { ok: false, error: 'Only the creator can cancel' };

  // Must wait 15 minutes before manual cancel
  const elapsed = Date.now() - game.createdAt.getTime();
  if (elapsed < 15 * 60 * 1000) {
    const remaining = Math.ceil((15 * 60 * 1000 - elapsed) / 60000);
    return { ok: false, error: `You can cancel in ${remaining} minute(s)` };
  }

  // Atomic: refund coins + cancel game
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { coins: { increment: game.amount }, totalWagered: { decrement: game.amount } },
    });

    await tx.coinFlip.update({
      where: { id: gameId },
      data: { status: 'CANCELLED' },
    });
  });

  const io = getIo();
  // Notify creator of refund
  const updatedUser = await prisma.user.findUnique({ where: { id: userId }, select: { coins: true } });
  io?.to(`user:${userId}`).emit('coinsUpdate', { coins: updatedUser?.coins ?? 0, direction: 'up' });

  io?.to('coinflip:lobby').emit('coinflip:cancelled', { id: gameId });

  logger.info(`[Coinflip] Game ${gameId} cancelled by ${userId} — ${game.amount} coins refunded`);
  return { ok: true };
}

/**
 * Auto-cancel coinflips that have been WAITING for more than 15 minutes.
 * Refunds the creator's coins. Called from the cron job every minute.
 */
export async function cancelStaleCoinFlips(): Promise<number> {
  const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000);

  const staleGames = await prisma.coinFlip.findMany({
    where: { status: 'WAITING', createdAt: { lt: fifteenMinAgo } },
    select: { id: true, creatorId: true, amount: true },
  });

  if (staleGames.length === 0) return 0;

  const io = getIo();
  for (const game of staleGames) {
    await prisma.$transaction([
      prisma.coinFlip.update({ where: { id: game.id }, data: { status: 'CANCELLED' } }),
      prisma.user.update({ where: { id: game.creatorId }, data: { coins: { increment: game.amount } } }),
    ]);
    const updatedUser = await prisma.user.findUnique({ where: { id: game.creatorId }, select: { coins: true } });
    io?.to(`user:${game.creatorId}`).emit('coinsUpdate', { coins: updatedUser?.coins ?? 0, direction: 'up' });
    io?.to(`user:${game.creatorId}`).emit('coinflip:expired', { id: game.id, amount: game.amount });
    io?.to('coinflip:lobby').emit('coinflip:cancelled', { id: game.id });
  }

  logger.info(`[Coinflip] Auto-cancelled ${staleGames.length} stale game(s) (>15 min waiting)`);
  return staleGames.length;
}

export async function getActiveCoinFlips(): Promise<Record<string, unknown>[]> {
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

  const games = await prisma.coinFlip.findMany({
    where: {
      OR: [
        { status: 'WAITING' },
        { status: 'FLIPPING' },
        { status: 'COMPLETED', completedAt: { gte: fiveMinAgo } },
      ],
    },
    include: {
      creator: { select: { id: true, username: true, avatar: true } },
      joiner: { select: { id: true, username: true, avatar: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  // Strip serverSeed from games that are not yet completed
  return games.map((g) => {
    const plain = g as unknown as Record<string, unknown>;
    if (g.status !== 'COMPLETED') {
      return sanitizeGame(plain);
    }
    return plain;
  });
}

export async function getCoinFlipHistory(userId: string): Promise<Record<string, unknown>[]> {
  const games = await prisma.coinFlip.findMany({
    where: {
      OR: [
        { creatorId: userId },
        { joinerId: userId },
      ],
    },
    include: {
      creator: { select: { id: true, username: true, avatar: true } },
      joiner: { select: { id: true, username: true, avatar: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return games as unknown as Record<string, unknown>[];
}
