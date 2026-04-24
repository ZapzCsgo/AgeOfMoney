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
 * Probability model (CSGO-style jackpot):
 *   Random.org draws a single integer in [0, 9999] — a 2-decimal percentage
 *   (basis-point x100). At settle time, each bet is assigned a contiguous
 *   range [fromBP, toBP) proportional to amount/potTotal × 10000. The last
 *   bet absorbs any rounding residue so the ranges always cover 0..10000
 *   fully (zero dead tickets). Winner = bet whose range contains the draw.
 *
 *   The DB fields ticketFrom/ticketTo on JackpotBet store COIN units (one
 *   ticket per coin at bet time) — retained for audit / display. The
 *   settle-time range in basis points is computed on the fly.
 *
 *   winningTicket on JackpotRound stores the Random.org draw (0..9999) —
 *   the "Ticket %" seen on the public fairness page.
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
const MAX_BET = 500;
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

  // Atomic: deduct coins (race-safe), create bet with ticket range, update
  // pot + participant count. The `coins: { gte: amount }` guard makes the
  // balance check + decrement a single SQL UPDATE, killing the TOCTOU race.
  const result = await prisma.$transaction(async (tx) => {
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

    const decResult = await tx.user.updateMany({
      where: { id: userId, coins: { gte: amount } },
      data: {
        coins: { decrement: amount },
        totalWagered: { increment: amount },
      },
    });
    if (decResult.count === 0) throw new Error('Insufficient coins');

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

  // RNG call — draws in [0, 9999] = basis points of a percentage with 2
  // decimals (0.00% to 99.99%). Fixed range, doesn't depend on pot size —
  // this is the same model as CSGOEmpire / CSGOLotto. Fallback HMAC uses
  // the same range transparently.
  const rng = await getSignedRandomInteger({
    min: 0,
    max: 9999,
    roundId: round.id,
    nonce: round.nonce,
    serverSeed: round.serverSeed,
    clientSeed: round.clientSeed,
  });
  const winningTicket = rng.value; // 0..9999

  // Assign each bet a contiguous [fromBP, toBP) range proportional to its
  // share of the pot. Residue from Math.floor goes to the last bet so the
  // ranges always cover [0, 10000) fully (zero dead tickets → perfect
  // fairness down to 0.01%).
  let cursor = 0;
  const ranges: Array<{ bet: typeof round.bets[number]; fromBP: number; toBP: number }> = [];
  for (let i = 0; i < round.bets.length; i++) {
    const bet = round.bets[i];
    const isLast = i === round.bets.length - 1;
    const share = Math.floor((bet.amount / round.potTotal) * 10000);
    const fromBP = cursor;
    const toBP = isLast ? 10000 : cursor + share;
    ranges.push({ bet, fromBP, toBP });
    cursor = toBP;
  }

  const winning = ranges.find((r) => winningTicket >= r.fromBP && winningTicket < r.toBP);
  if (!winning) {
    logger.error(
      `[Jackpot] CRITICAL: no winning bet found for bp=${winningTicket}, pot=${round.potTotal}, round=${roundId}`,
    );
    await cancelRound(roundId);
    return;
  }
  const winningBet = winning.bet;

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

/**
 * Startup : preserve in-flight rounds instead of refunding.
 *
 * Previous behaviour refunded every OPEN/CLOSING/SPINNING round on boot,
 * which was brutal — a Railway redeploy in the middle of a 90 s timer
 * would wipe the pot and force users to bet again. The new flow resumes
 * each state :
 *
 *   OPEN     → just re-point currentRoundId at it. No timer running yet
 *              (it only starts on the 2nd participant).
 *   CLOSING  → re-point currentRoundId AND re-arm the closingTimer for
 *              the remaining duration (closingAt - now). If the timer
 *              should have fired during downtime (remaining ≤ 0), settle
 *              immediately.
 *   SPINNING → the RNG step was mid-flight :
 *              - winnerId + netPayout already written → credit the winner
 *                and mark COMPLETED (the 6 s payout setTimeout was lost)
 *              - no winner yet → reset to CLOSING with closingAt=now so
 *                settleRound() retries the RNG on the next tick
 *
 * If no live round exists → createRound() as before.
 * If multiple OPEN/CLOSING exist (race from old bugs), keep the most
 * recent and cancel+refund the extras — only 1 current round allowed.
 */
export async function initJackpot(): Promise<void> {
  logRngStartupState('[Jackpot]');
  const now = new Date();
  const io = getIo();

  const alive = await prisma.jackpotRound.findMany({
    where: { status: { in: ['OPEN', 'CLOSING', 'SPINNING'] } },
    orderBy: { createdAt: 'desc' },
  });

  if (alive.length === 0) {
    await createRound();
    logger.info('[Jackpot] Service initialized (fresh start, no live round)');
    return;
  }

  logger.info(`[Jackpot] Found ${alive.length} live round(s) on boot — resuming instead of refunding`);

  // ─── SPINNING : finish the settle that got interrupted ───
  const spinning = alive.filter((r) => r.status === 'SPINNING');
  for (const r of spinning) {
    if (r.winnerId && r.netPayout != null) {
      logger.warn(`[Jackpot] Resuming SPINNING ${r.id} — crediting winner ${r.winnerId} +${r.netPayout}⚜ (payout timeout lost on crash)`);
      try {
        await prisma.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: r.winnerId! },
            data: { coins: { increment: r.netPayout! } },
          });
          await tx.jackpotRound.update({
            where: { id: r.id },
            data: { status: 'COMPLETED', settledAt: now },
          });
        });
        const winnerFresh = await prisma.user.findUnique({
          where: { id: r.winnerId },
          select: { coins: true },
        });
        io?.to(`user:${r.winnerId}`).emit('coinsUpdate', {
          coins: winnerFresh?.coins ?? 0,
          direction: 'up',
        });
        const completed = await prisma.jackpotRound.findUnique({
          where: { id: r.id },
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
          // Affiliate revshare on every bet — was skipped for resumed rounds
          // because the normal settle path fires this inside its own timeout.
          for (const bet of completed.bets) {
            const won = bet.userId === r.winnerId;
            const netDelta = won ? -(r.netPayout! - bet.amount) : bet.amount;
            creditAffiliateOnBetResolved(bet.userId, bet.amount, netDelta).catch((err) =>
              logger.warn('[Affiliate] jackpot resume credit failed:', err),
            );
          }
        }
      } catch (err) {
        logger.error(`[Jackpot] Failed to resume SPINNING ${r.id}:`, err);
      }
    } else {
      // RNG never completed — roll back to CLOSING so settleRound() retries
      logger.warn(`[Jackpot] SPINNING ${r.id} has no winner persisted — rolling back to CLOSING for retry`);
      await prisma.jackpotRound.update({
        where: { id: r.id },
        data: { status: 'CLOSING', closingAt: now },
      });
    }
  }

  // ─── Refresh list after SPINNING resolutions ───
  const resumable = await prisma.jackpotRound.findMany({
    where: { status: { in: ['OPEN', 'CLOSING'] } },
    orderBy: { createdAt: 'desc' },
  });

  if (resumable.length === 0) {
    await createRound();
    logger.info('[Jackpot] Service initialized (fresh round after SPINNING resume)');
    return;
  }

  // ─── Keep the most recent as current, cancel extras ───
  const chosen = resumable[0];
  currentRoundId = chosen.id;
  logger.info(`[Jackpot] Resumed ${chosen.status} round ${chosen.id} as current (${chosen.participantCount} joueurs, pot=${chosen.potTotal}⚜)`);

  if (chosen.status === 'CLOSING' && chosen.closingAt) {
    const remainingMs = chosen.closingAt.getTime() - now.getTime();
    if (remainingMs <= 0) {
      logger.warn(`[Jackpot] CLOSING ${chosen.id} expired during downtime — settling now`);
      settleRound(chosen.id).catch((err) =>
        logger.error(`[Jackpot] settle error for ${chosen.id}:`, err),
      );
    } else {
      logger.info(`[Jackpot] Re-arming CLOSING timer for ${chosen.id} (${Math.round(remainingMs / 1000)}s remaining)`);
      if (closingTimer) clearTimeout(closingTimer);
      closingTimer = setTimeout(
        () => settleRound(chosen.id).catch((err) =>
          logger.error(`[Jackpot] settle error for ${chosen.id}:`, err),
        ),
        remainingMs,
      );
    }
  }

  // Extra concurrent rounds shouldn't exist, but if they do : only 1 can be
  // "current" in memory, the others are historical junk to clean up.
  for (const extra of resumable.slice(1)) {
    logger.warn(`[Jackpot] Extra orphan ${extra.status} ${extra.id} — cancelling (only 1 current round allowed)`);
    await cancelRound(extra.id).catch((err) =>
      logger.error(`[Jackpot] cancel extra failed for ${extra.id}:`, err),
    );
  }

  logger.info('[Jackpot] Service initialized (resumed active round)');
}
