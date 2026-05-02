/**
 * Coinflip PvP service — two players bet on a coin flip with 5% house rake.
 *
 * Provably fair (aligned with roulette commit-reveal):
 *   - At creation: generate serverSeed (32 bytes hex), clientSeed (16 bytes hex),
 *     nonce=0. Commit seedHash = SHA256(serverSeed). Only seedHash + clientSeed +
 *     nonce are visible to clients until completion.
 *   - Result derivation is deterministic from the triplet:
 *         h = HMAC_SHA256(serverSeed, clientSeed + ":" + nonce)
 *         take first 8 bytes as uint64, rejection-sample to kill modulo bias,
 *         then result = value % 2 (0 = crown, 1 = shield).
 *   - On completion, the serverSeed is revealed so anyone can recompute the
 *     result off-chain and confirm it matches what was declared.
 *
 * The `result` field (which drives the front-end animation) is the SAME value
 * used to determine `winnerId`, so the coin landing on a side ALWAYS matches
 * the declared winner. No separate RNG path anywhere.
 */

import crypto from 'crypto';
import { prisma } from '../index';
import { getIo } from '../socket';
import { creditAffiliateOnBetResolved } from './affiliateService';
import { recordLedger } from './ledger';
import { processWageringForBet } from './redeemCodeService';
import logger from '../logger';

const RAKE_RATE = 0.05; // 5%
const MIN_BET = 2;
const MAX_BET = 500;
const RESULT_DELAY_MS = 3_500; // delay before revealing result (animation time)

/** Strip serverSeed from a coinflip record for client-safe emission while
 *  exposing `side` (= creatorSide) so the existing frontend contract holds. */
function sanitizeGame(game: Record<string, unknown>) {
  const { serverSeed: _seed, ...safe } = game;
  // Alias creatorSide → side for frontend compatibility (frontend UI + winner
  // determination both read `game.side`). Before this aliasing, `game.side`
  // was `undefined`, which made `result === game.side` always false and
  // caused the "winner n'est pas le bon winner" desync bug.
  if (typeof safe.creatorSide === 'string') {
    (safe as Record<string, unknown>).side = safe.creatorSide;
  }
  return safe;
}

/** Same aliasing for records where the seed has already been revealed. */
function revealGame(game: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...game };
  if (typeof out.creatorSide === 'string') out.side = out.creatorSide;
  return out;
}

/**
 * Provably-fair result derivation — identical algorithmic shape to the
 * roulette fallback (rejection-sampled HMAC), scaled to a 2-outcome space.
 *
 * h = HMAC_SHA256(serverSeed, `${clientSeed}:${nonce}`)
 * pick the first 64-bit chunk, rejection-sample so the distribution over
 * {0,1} has zero modulo bias, and return `crown` (0) or `shield` (1).
 */
export function deriveCoinflipResult(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
): 'crown' | 'shield' {
  const message = `${clientSeed}:${nonce}`;
  const hmac = crypto.createHmac('sha256', serverSeed).update(message).digest('hex');

  // 2^64 / 2 leaves a trivial tail — still rejection-sample for consistency
  // with the roulette implementation. In practice the loop exits on iteration 0.
  const MAX = 2n * (BigInt('0xffffffffffffffff') / 2n);
  let pick = 0n;
  let cursor = 0;
  while (cursor + 16 <= hmac.length) {
    pick = BigInt('0x' + hmac.slice(cursor, cursor + 16));
    if (pick < MAX) break;
    cursor += 16;
  }
  return pick % 2n === 0n ? 'crown' : 'shield';
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

  // Generate provably-fair material (commit-reveal, same shape as roulette):
  //   - serverSeed : 32 random bytes, kept secret until completion
  //   - seedHash   : SHA256(serverSeed), published at creation (the commit)
  //   - clientSeed : 16 random bytes, publicly mixed into the HMAC so the
  //                  result can't be pre-computed just from the seed
  //   - nonce      : always 0 for a single-roll game; column reserved for
  //                  future multi-roll mechanics
  const serverSeed = crypto.randomBytes(32).toString('hex');
  const clientSeed = crypto.randomBytes(16).toString('hex');
  const nonce      = 0;
  const seedHash   = crypto.createHash('sha256').update(serverSeed).digest('hex');

  // Atomic: deduct coins + create game. The `coins: { gte: amount }` guard
  // inside updateMany makes the balance check + decrement a single SQL
  // UPDATE, which kills the race where two concurrent creates both read
  // coins=100 and decrement 100 each (ending at -100).
  const game = await prisma.$transaction(async (tx) => {
    const decResult = await tx.user.updateMany({
      where: { id: userId, coins: { gte: amount } },
      data: { coins: { decrement: amount }, totalWagered: { increment: amount } },
    });
    if (decResult.count === 0) throw new Error('Insufficient coins');

    const created = await tx.coinFlip.create({
      data: {
        creatorId: userId,
        amount,
        creatorSide: side,
        serverSeed,
        seedHash,
        clientSeed,
        nonce,
        status: 'WAITING',
      },
      include: {
        creator: { select: { id: true, username: true, avatar: true } },
      },
    });
    await recordLedger(tx, { userId, type: 'coinflip_stake', coins: -amount });
    return created;
  });

  // Wagering progress (post-commit) — own implicit transaction, can't
  // ever roll back the bet. See processWageringForBet() docstring.
  await processWageringForBet(prisma, { userId, betAmount: amount });

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

  // Provably-fair derivation. If clientSeed is missing (legacy pre-migration
  // row created before the commit-reveal upgrade), generate one on the fly so
  // old games still resolve — they just aren't fully verifiable.
  const clientSeed = game.clientSeed ?? crypto.randomBytes(16).toString('hex');
  const nonce      = game.nonce ?? 0;
  const result     = deriveCoinflipResult(game.serverSeed, clientSeed, nonce);
  const creatorWon = game.creatorSide === result;
  const winnerId   = creatorWon ? game.creatorId : userId;

  const totalPot = game.amount * 2;
  const rake = Math.floor(totalPot * RAKE_RATE);
  const payout = totalPot - rake;

  // Atomic: deduct joiner coins (race-safe), credit winner, update game.
  const updatedGame = await prisma.$transaction(async (tx) => {
    const decResult = await tx.user.updateMany({
      where: { id: userId, coins: { gte: game.amount } },
      data: { coins: { decrement: game.amount }, totalWagered: { increment: game.amount } },
    });
    if (decResult.count === 0) throw new Error('Insufficient coins');

    // Credit winner
    await tx.user.update({
      where: { id: winnerId },
      data: { coins: { increment: payout } },
    });

    // Ledger : joiner stake debit + winner credit. Loser has no separate row
    // (their stake was already booked at place-time).
    await recordLedger(tx, { userId, type: 'coinflip_stake', coins: -game.amount });
    await recordLedger(tx, { userId: winnerId, type: 'coinflip_win', coins: payout });

    // Update game. If we had to backfill clientSeed (legacy row), persist it
    // so the reveal payload remains consistent with what was used to derive.
    return tx.coinFlip.update({
      where: { id: gameId },
      data: {
        joinerId: userId,
        status: 'FLIPPING',
        result,
        winnerId,
        rake,
        clientSeed,
        nonce,
        completedAt: new Date(),
      },
      include: {
        creator: { select: { id: true, username: true, avatar: true } },
        joiner: { select: { id: true, username: true, avatar: true } },
      },
    });
  });

  // Wagering progress (post-commit) — joiner only ; creator already had
  // their wagering counted at game creation time.
  await processWageringForBet(prisma, { userId, betAmount: game.amount });

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

      // Reveal full result including serverSeed + clientSeed + nonce so any
      // client can independently recompute the HMAC and verify the outcome.
      const completedGame = await prisma.coinFlip.findUnique({
        where: { id: gameId },
        include: {
          creator: { select: { id: true, username: true, avatar: true } },
          joiner: { select: { id: true, username: true, avatar: true } },
        },
      });

      const revealed = completedGame
        ? revealGame(completedGame as unknown as Record<string, unknown>)
        : completedGame;
      io?.to('coinflip:lobby').emit('coinflip:result', revealed);

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

    await recordLedger(tx, { userId, type: 'coinflip_refund', coins: game.amount });
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
      prisma.transaction.create({
        data: { userId: game.creatorId, type: 'coinflip_refund', coins: game.amount, amount: 0, status: 'completed' },
      }),
    ]);
    const updatedUser = await prisma.user.findUnique({ where: { id: game.creatorId }, select: { coins: true } });
    io?.to(`user:${game.creatorId}`).emit('coinsUpdate', { coins: updatedUser?.coins ?? 0, direction: 'up' });
    io?.to(`user:${game.creatorId}`).emit('coinflip:expired', { id: game.id, amount: game.amount });
    io?.to('coinflip:lobby').emit('coinflip:cancelled', { id: game.id });
  }

  logger.info(`[Coinflip] Auto-cancelled ${staleGames.length} stale game(s) (>15 min waiting)`);
  return staleGames.length;
}

/**
 * Games visible on the main coinflip page: open games (WAITING/FLIPPING)
 * plus the 10 most recent completed ones within the last 30 minutes.
 * Older completed games are only visible via `getAllCoinFlipHistory()`.
 */
export async function getActiveCoinFlips(): Promise<Record<string, unknown>[]> {
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);

  const [openGames, recentCompleted] = await Promise.all([
    prisma.coinFlip.findMany({
      where: { status: { in: ['WAITING', 'FLIPPING'] } },
      include: {
        creator: { select: { id: true, username: true, avatar: true } },
        joiner: { select: { id: true, username: true, avatar: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    // 10 most recent completed within 30 min — the "recently finished" band
    // on the main page. Anything older goes into the Historique tab only.
    prisma.coinFlip.findMany({
      where: { status: 'COMPLETED', completedAt: { gte: thirtyMinAgo } },
      include: {
        creator: { select: { id: true, username: true, avatar: true } },
        joiner: { select: { id: true, username: true, avatar: true } },
      },
      orderBy: { completedAt: 'desc' },
      take: 10,
    }),
  ]);

  const merged = [...openGames, ...recentCompleted];
  return merged.map((g) => {
    const plain = g as unknown as Record<string, unknown>;
    // Completed rows expose serverSeed (revealed), others keep it hidden.
    // Both paths must alias creatorSide → side for the frontend.
    if (g.status !== 'COMPLETED') return sanitizeGame(plain);
    return revealGame(plain);
  });
}

/**
 * Global coinflip history — all completed games across the site. Used by the
 * "Historique" tab on the coinflip page. Paginated via `limit`/`offset`.
 */
export async function getAllCoinFlipHistory(limit = 50, offset = 0): Promise<Record<string, unknown>[]> {
  const games = await prisma.coinFlip.findMany({
    where: { status: 'COMPLETED' },
    include: {
      creator: { select: { id: true, username: true, avatar: true } },
      joiner: { select: { id: true, username: true, avatar: true } },
    },
    orderBy: { completedAt: 'desc' },
    take: Math.min(limit, 100),
    skip: offset,
  });
  return games.map((g) => revealGame(g as unknown as Record<string, unknown>));
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

  return games.map((g) => {
    const plain = g as unknown as Record<string, unknown>;
    return g.status === 'COMPLETED' ? revealGame(plain) : sanitizeGame(plain);
  });
}
