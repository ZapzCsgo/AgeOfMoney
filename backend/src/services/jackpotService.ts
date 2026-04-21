/**
 * Jackpot PvP service — CSGO-style pot game.
 *
 * Lifecycle:
 *   OPEN      — round accepts bets, timer not yet started
 *   CLOSING   — ≥ 2 distinct participants reached, 90 s timer running
 *   SPINNING  — timer elapsed, RNG call done, pot locked, winner selected
 *   COMPLETED — winner credited (95 %), rake taken (5 %), seeds revealed
 *   CANCELLED — timer elapsed with < 2 participants, OR fatal error → refund
 *
 * Probability model (standard CSGO jackpot):
 *   Each bet reserves a contiguous ticket range [ticketFrom, ticketTo).
 *   The winning ticket is drawn uniformly in [0, potTotal) via Random.org
 *   Signed API (HMAC fallback if unavailable). The bet whose range contains
 *   the winning ticket wins — P(win) = amount / potTotal by construction.
 *
 * Provably fair:
 *   At OPEN we commit seedHash = SHA256(serverSeed). clientSeed + nonce are
 *   public from the start. On settle, Random.org's signed response is
 *   persisted (randomJson + signature) so any user can verify on
 *   /fair/jackpot/:id. If the fallback was used, the HMAC of the revealed
 *   seeds reproduces the winning ticket — also verifiable.
 */

import crypto from 'crypto';
import { prisma } from '../index';
import { getIo } from '../socket';
import { creditAffiliateOnBetResolved } from './affiliateService';
import { getSignedRandomInteger, logRngStartupState } from './randomOrgClient';
import logger from '../logger';

const MIN_BET = 1;
const MAX_BET = 5_000;
const RAKE_RATE = 0.05;                    // 5 % house rake
const ROUND_DURATION_MS = 90_000;          // 90 s countdown once 2+ participants
const PARTICIPANT_THRESHOLD = 2;           // timer only kicks in at 2 distinct users
const SPIN_ANIMATION_MS = 6_000;           // frontend wheel spin before winner reveal
const RESTART_DELAY_MS = 3_000;            // gap between one round settling and next opening

let currentRoundId: string | null = null;
let closingTimer: ReturnType<typeof setTimeout> | null = null;

/** Never expose serverSeed unless round is COMPLETED or CANCELLED (reveal phase). */
function sanitizeRound(round: Record<string, unknown>) {
  const status = round.status as string;
  if (status === 'COMPLETED' || status === 'CANCELLED') return round;
  const { serverSeed: _s, ...safe } = round;
  return safe;
}

export function getCurrentRoundId(): string | null {
  return currentRoundId;
}

export async function getCurrentJackpot() {
  if (!currentRoundId) return null;
  const round = await prisma.jackpotRound.findUnique({
    where: { id: currentRoundId },
    include: {
      bets: {
        include: { user: { select: { id: true, username: true, avatar: true } } },
        orderBy: { createdAt: 'asc' },
      },
      winner: { select: { id: true, username: true, avatar: true } },
    },
  });
  if (!round) return null;
  return sanitizeRound(round as unknown as Record<string, unknown>);
}

export async function getJackpotHistory(limit = 30) {
  const rounds = await prisma.jackpotRound.findMany({
    where: { status: 'COMPLETED' },
    include: {
      winner: { select: { id: true, username: true, avatar: true } },
      bets: {
        include: { user: { select: { id: true, username: true, avatar: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: { settledAt: 'desc' },
    take: Math.min(limit, 100),
  });
  return rounds;
}

export async function getJackpotFair(roundId: string) {
  const round = await prisma.jackpotRound.findUnique({
    where: { id: roundId },
    include: {
      winner: { select: { id: true, username: true, avatar: true } },
      bets: {
        include: { user: { select: { id: true, username: true, avatar: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!round) return null;
  // For COMPLETED / CANCELLED rounds, reveal everything (including serverSeed)
  return sanitizeRound(round as unknown as Record<string, unknown>);
}

async function createRound(): Promise<string> {
  const serverSeed = crypto.randomBytes(32).toString('hex');
  const seedHash   = crypto.createHash('sha256').update(serverSeed).digest('hex');
  const clientSeed = crypto.randomBytes(16).toString('hex');

  // Monotonic nonce — serves as a salt in Random.org userData + HMAC fallback.
  // Using max+1 guarantees uniqueness even if two createRound() races (unique
  // constraint on JackpotRound.nonce catches duplicates anyway).
  const last = await prisma.jackpotRound.findFirst({
    orderBy: { nonce: 'desc' },
    select: { nonce: true },
  });
  const nonce = (last?.nonce ?? 0) + 1;

  const round = await prisma.jackpotRound.create({
    data: {
      status: 'OPEN',
      serverSeed,
      seedHash,
      clientSeed,
      nonce,
      potTotal: 0,
      participantCount: 0,
    },
  });
  currentRoundId = round.id;
  logger.info(`[Jackpot] Round ${round.id} OPEN (nonce=${nonce})`);

  const io = getIo();
  io?.to('jackpot:lobby').emit(
    'jackpot:round:open',
    sanitizeRound(round as unknown as Record<string, unknown>),
  );
  return round.id;
}

export async function placeBet(
  userId: string,
  amount: number,
): Promise<{ ok: boolean; error?: string; data?: Record<string, unknown> }> {
  if (!Number.isInteger(amount) || amount < MIN_BET || amount > MAX_BET) {
    return { ok: false, error: `Bet must be integer in [${MIN_BET}, ${MAX_BET}]` };
  }
  if (!currentRoundId) return { ok: false, error: 'No active round' };

  const round = await prisma.jackpotRound.findUnique({ where: { id: currentRoundId } });
  if (!round) return { ok: false, error: 'Round not found' };
  if (round.status !== 'OPEN' && round.status !== 'CLOSING') {
    return { ok: false, error: 'Betting is closed for this round' };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { coins: true, isBanned: true },
  });
  if (!user) return { ok: false, error: 'User not found' };
  if (user.isBanned) return { ok: false, error: 'Account banned' };
  if (user.coins < amount) return { ok: false, error: 'Insufficient coins' };

  // Atomic: deduct coins, create bet with ticket range, update pot + participant count
  const result = await prisma.$transaction(async (tx) => {
    const freshUser = await tx.user.findUnique({
      where: { id: userId },
      select: { coins: true },
    });
    if (!freshUser || freshUser.coins < amount) throw new Error('Insufficient coins');

    const freshRound = await tx.jackpotRound.findUnique({
      where: { id: round.id },
    });
    if (!freshRound) throw new Error('Round disappeared');
    if (freshRound.status !== 'OPEN' && freshRound.status !== 'CLOSING') {
      throw new Error('Betting is closed');
    }

    const priorBet = await tx.jackpotBet.findFirst({
      where: { roundId: freshRound.id, userId },
    });
    const isNewParticipant = !priorBet;

    await tx.user.update({
      where: { id: userId },
      data: {
        coins: { decrement: amount },
        totalWagered: { increment: amount },
      },
    });

    const bet = await tx.jackpotBet.create({
      data: {
        roundId: freshRound.id,
        userId,
        amount,
        ticketFrom: freshRound.potTotal,
        ticketTo: freshRound.potTotal + amount,
      },
    });

    const updatedRound = await tx.jackpotRound.update({
      where: { id: freshRound.id },
      data: {
        potTotal: { increment: amount },
        participantCount: isNewParticipant ? { increment: 1 } : undefined,
      },
    });

    return { bet, updatedRound, isNewParticipant };
  });

  const io = getIo();
  const updatedUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { coins: true },
  });
  io?.to(`user:${userId}`).emit('coinsUpdate', {
    coins: updatedUser?.coins ?? 0,
    direction: 'down',
  });

  const betWithUser = await prisma.jackpotBet.findUnique({
    where: { id: result.bet.id },
    include: { user: { select: { id: true, username: true, avatar: true } } },
  });

  io?.to('jackpot:lobby').emit('jackpot:bet:new', {
    roundId: result.updatedRound.id,
    potTotal: result.updatedRound.potTotal,
    participantCount: result.updatedRound.participantCount,
    bet: betWithUser,
  });

  // Transition OPEN → CLOSING when crossing the participant threshold
  if (
    result.updatedRound.status === 'OPEN' &&
    result.updatedRound.participantCount >= PARTICIPANT_THRESHOLD
  ) {
    await startClosingTimer(result.updatedRound.id);
  }

  return { ok: true, data: result.bet as unknown as Record<string, unknown> };
}

async function startClosingTimer(roundId: string): Promise<void> {
  const closingAt = new Date(Date.now() + ROUND_DURATION_MS);

  // Atomic transition OPEN → CLOSING (guard against concurrent triggers)
  const locked = await prisma.jackpotRound.updateMany({
    where: { id: roundId, status: 'OPEN' },
    data: { status: 'CLOSING', closingAt },
  });
  if (locked.count === 0) return; // already closing

  const updated = await prisma.jackpotRound.findUnique({ where: { id: roundId } });
  if (!updated) return;

  logger.info(
    `[Jackpot] Round ${roundId} CLOSING — timer until ${closingAt.toISOString()} (pot=${updated.potTotal})`,
  );

  const io = getIo();
  io?.to('jackpot:lobby').emit('jackpot:round:closing', {
    roundId,
    closingAt: closingAt.toISOString(),
    potTotal: updated.potTotal,
    participantCount: updated.participantCount,
  });

  if (closingTimer) clearTimeout(closingTimer);
  closingTimer = setTimeout(
    () =>
      settleRound(roundId).catch((err) =>
        logger.error(`[Jackpot] settle error for ${roundId}:`, err),
      ),
    ROUND_DURATION_MS,
  );
}

async function settleRound(roundId: string): Promise<void> {
  const io = getIo();

  // Atomic transition CLOSING → SPINNING (lock)
  const locked = await prisma.jackpotRound.updateMany({
    where: { id: roundId, status: 'CLOSING' },
    data: { status: 'SPINNING' },
  });
  if (locked.count === 0) {
    logger.warn(`[Jackpot] Round ${roundId} cannot settle (status not CLOSING)`);
    return;
  }

  const round = await prisma.jackpotRound.findUnique({
    where: { id: roundId },
    include: {
      bets: {
        include: { user: { select: { id: true, username: true, avatar: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!round) return;

  // Edge case: shouldn't reach SPINNING with <2 participants, but guard anyway.
  if (round.potTotal === 0 || round.participantCount < PARTICIPANT_THRESHOLD) {
    logger.warn(
      `[Jackpot] Round ${roundId} cancelled at settle (pot=${round.potTotal}, participants=${round.participantCount})`,
    );
    await cancelRound(roundId);
    return;
  }

  // RNG call — fallback to HMAC is transparent here.
  const rng = await getSignedRandomInteger({
    min: 0,
    max: round.potTotal - 1,
    roundId: round.id,
    nonce: round.nonce,
    serverSeed: round.serverSeed,
    clientSeed: round.clientSeed,
  });
  const winningTicket = rng.value;

  const winningBet = round.bets.find(
    (b) => winningTicket >= b.ticketFrom && winningTicket < b.ticketTo,
  );
  if (!winningBet) {
    logger.error(
      `[Jackpot] CRITICAL: no winning bet found for ticket=${winningTicket}, pot=${round.potTotal}, round=${roundId}`,
    );
    await cancelRound(roundId);
    return;
  }

  const rake = Math.floor(round.potTotal * RAKE_RATE);
  const netPayout = round.potTotal - rake;

  // Persist RNG evidence + winner info (still SPINNING status — anim in progress)
  await prisma.jackpotRound.update({
    where: { id: roundId },
    data: {
      rngSource: rng.source,
      randomJson: rng.randomJson,
      randomSignature: rng.signature,
      randomSerial: rng.serial,
      winningTicket,
      winnerId: winningBet.userId,
      rake,
      netPayout,
    },
  });

  logger.info(
    `[Jackpot] Round ${roundId} SPINNING — winner=${winningBet.userId}, ticket=${winningTicket}/${round.potTotal}, pot=${round.potTotal}, rake=${rake}, net=${netPayout}, rngSource=${rng.source}`,
  );

  // Broadcast spin — winner known, credit happens AFTER the animation delay
  io?.to('jackpot:lobby').emit('jackpot:round:spinning', {
    roundId,
    winningTicket,
    winnerId: winningBet.userId,
    winner: winningBet.user,
    potTotal: round.potTotal,
    netPayout,
    rake,
    rngSource: rng.source,
  });

  // After animation: credit winner, mark COMPLETED, reveal seeds
  setTimeout(async () => {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: winningBet.userId },
          data: { coins: { increment: netPayout } },
        });
        await tx.jackpotRound.update({
          where: { id: roundId },
          data: { status: 'COMPLETED', settledAt: new Date() },
        });
      });

      const winnerFresh = await prisma.user.findUnique({
        where: { id: winningBet.userId },
        select: { coins: true },
      });
      io?.to(`user:${winningBet.userId}`).emit('coinsUpdate', {
        coins: winnerFresh?.coins ?? 0,
        direction: 'up',
      });

      const completed = await prisma.jackpotRound.findUnique({
        where: { id: roundId },
        include: {
          winner: { select: { id: true, username: true, avatar: true } },
          bets: {
            include: { user: { select: { id: true, username: true, avatar: true } } },
            orderBy: { createdAt: 'asc' },
          },
        },
      });
      if (completed) {
        io?.to('jackpot:lobby').emit('jackpot:round:settled', completed);
      }

      logger.info(
        `[Jackpot] Round ${roundId} COMPLETED — paid ${netPayout} to ${winningBet.userId}, rake=${rake}`,
      );

      // Revshare on every bet (winners = negative netDelta, losers = positive)
      for (const bet of round.bets) {
        const won = bet.userId === winningBet.userId;
        const netDelta = won ? -(netPayout - bet.amount) : bet.amount;
        creditAffiliateOnBetResolved(bet.userId, bet.amount, netDelta).catch((err) =>
          logger.warn('[Affiliate] jackpot credit failed:', err),
        );
      }
    } catch (err) {
      logger.error(`[Jackpot] Post-settle error for ${roundId}:`, err);
    } finally {
      // Start the next round regardless
      currentRoundId = null;
      setTimeout(() => {
        createRound().catch((err) => logger.error('[Jackpot] createRound error:', err));
      }, RESTART_DELAY_MS);
    }
  }, SPIN_ANIMATION_MS);
}

async function cancelRound(roundId: string): Promise<void> {
  const io = getIo();
  const round = await prisma.jackpotRound.findUnique({
    where: { id: roundId },
    include: { bets: true },
  });
  if (!round) return;

  await prisma.$transaction(async (tx) => {
    for (const bet of round.bets) {
      await tx.user.update({
        where: { id: bet.userId },
        data: {
          coins: { increment: bet.amount },
          totalWagered: { decrement: bet.amount },
        },
      });
    }
    await tx.jackpotRound.update({
      where: { id: roundId },
      data: { status: 'CANCELLED', settledAt: new Date() },
    });
  });

  // Notify refunded users
  const uniqUsers = new Set(round.bets.map((b) => b.userId));
  for (const userId of uniqUsers) {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { coins: true },
    });
    io?.to(`user:${userId}`).emit('coinsUpdate', {
      coins: u?.coins ?? 0,
      direction: 'up',
    });
  }
  io?.to('jackpot:lobby').emit('jackpot:round:cancelled', {
    roundId,
    reason: 'insufficient_participants',
  });

  logger.info(`[Jackpot] Round ${roundId} CANCELLED — refunded ${round.bets.length} bet(s)`);

  currentRoundId = null;
  setTimeout(() => {
    createRound().catch((err) => logger.error('[Jackpot] createRound error:', err));
  }, RESTART_DELAY_MS);
}

/** Startup: cancel orphaned rounds (refund), log RNG mode, open first round. */
export async function initJackpot(): Promise<void> {
  const orphans = await prisma.jackpotRound.findMany({
    where: { status: { in: ['OPEN', 'CLOSING', 'SPINNING'] } },
    select: { id: true, status: true },
  });
  for (const r of orphans) {
    logger.warn(`[Jackpot] Orphaned round ${r.id} (${r.status}) on boot — refunding`);
    await cancelRound(r.id).catch((err) =>
      logger.error(`[Jackpot] orphan cancel failed for ${r.id}:`, err),
    );
  }

  logRngStartupState('[Jackpot]');

  await createRound();
  logger.info('[Jackpot] Service initialized');
}
