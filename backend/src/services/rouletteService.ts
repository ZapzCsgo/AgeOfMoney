/**
 * Roulette service — AoE4 themed roulette game
 *
 * Zones (1-100):
 *   KNIGHTS  1-47   → 2x  (47%)
 *   EMPEROR  48-61  → 14x (14%)
 *   ARCHERS  62-100 → 2x  (39%)
 *
 * Round lifecycle: BETTING (30s) → SPINNING (5s) → COMPLETED
 */

import crypto from 'crypto';
import { prisma } from '../index';
import { getIo } from '../socket';
import logger from '../logger';

// 15-slot system (identical to CSGOEmpire):
//   KNIGHTS  slots 1-7  → 7/15 = 46.67% → ×2   house edge 6.67%
//   EMPEROR  slot  8    → 1/15 =  6.67% → ×14  house edge 6.67%
//   ARCHERS  slots 9-15 → 7/15 = 46.67% → ×2   house edge 6.67%
export const ZONES = {
  KNIGHTS:  { min: 1,  max: 7,  multiplier: 2,  label: 'KNIGHTS' },
  EMPEROR:  { min: 8,  max: 8,  multiplier: 14, label: 'EMPEROR' },
  ARCHERS:  { min: 9,  max: 15, multiplier: 2,  label: 'ARCHERS' },
} as const;

export type Zone = keyof typeof ZONES;

const BETTING_DURATION = 15_000;  // 15s
const SPIN_DURATION    = 6_000;   // 6s animation

export function getZoneFromResult(result: number): Zone {
  if (result <= 7) return 'KNIGHTS';
  if (result === 8) return 'EMPEROR';
  return 'ARCHERS';
}

let currentRoundId: string | null = null;
let roundTimer: ReturnType<typeof setTimeout> | null = null;

export function getCurrentRoundId(): string | null {
  return currentRoundId;
}

export async function getCurrentRound() {
  if (!currentRoundId) return null;
  const round = await prisma.rouletteRound.findUnique({
    where: { id: currentRoundId },
    include: {
      bets: {
        include: { user: { select: { id: true, username: true, avatar: true } } },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  if (!round) return null;
  // Never expose serverSeed until COMPLETED
  const { serverSeed: _seed, ...safe } = round;
  return {
    ...safe,
    serverSeed: round.status === 'COMPLETED' ? round.serverSeed : null,
  };
}

export async function startRound(): Promise<void> {
  const io = getIo();
  const endsAt = new Date(Date.now() + BETTING_DURATION);

  // Provably fair: generate seed before betting opens, store hash only
  const serverSeed = crypto.randomBytes(32).toString('hex');
  const roundHash  = crypto.createHash('sha256').update(serverSeed).digest('hex');

  const round = await prisma.rouletteRound.create({
    data: { status: 'BETTING', endsAt, serverSeed, roundHash },
  });
  currentRoundId = round.id;

  logger.info(`[Roulette] Round ${round.id} started — betting until ${endsAt.toISOString()}`);
  io?.emit('roulette:roundStart', { roundId: round.id, endsAt: endsAt.toISOString(), roundHash });

  // Schedule spin
  roundTimer = setTimeout(() => spinRound(round.id), BETTING_DURATION);
}

async function spinRound(roundId: string): Promise<void> {
  const io = getIo();

  // Provably fair: derive result from the pre-committed server seed
  const roundData = await prisma.rouletteRound.findUnique({
    where: { id: roundId },
    select: { serverSeed: true, roundHash: true },
  });
  const serverSeed = roundData?.serverSeed ?? crypto.randomBytes(32).toString('hex');
  const roundHash  = roundData?.roundHash  ?? crypto.createHash('sha256').update(serverSeed).digest('hex');

  // Deterministic 1-15 result from first 8 hex chars of SHA256(seed)
  const hash   = crypto.createHash('sha256').update(serverSeed).digest('hex');
  const result = (parseInt(hash.slice(0, 8), 16) % 15) + 1; // 1-15
  const winZone    = getZoneFromResult(result);
  const multiplier = ZONES[winZone].multiplier;
  const spinAt     = new Date();

  await prisma.rouletteRound.update({
    where: { id: roundId },
    data: { status: 'SPINNING', result, winZone, multiplier, spinAt },
  });

  logger.info(`[Roulette] Round ${roundId} spinning → seed=${serverSeed.slice(0,8)}… result=${result} zone=${winZone}`);
  io?.emit('roulette:spin', { roundId, result, winZone, multiplier, roundHash });

  // Resolve after animation
  roundTimer = setTimeout(() => resolveRound(roundId, winZone, multiplier), SPIN_DURATION);
}

async function resolveRound(roundId: string, winZone: string, multiplier: number): Promise<void> {
  const io = getIo();

  const bets = await prisma.rouletteBet.findMany({ where: { roundId } });

  // Distribute payouts
  for (const bet of bets) {
    const won = bet.zone === winZone;
    const payout = won ? Math.floor(bet.amount * multiplier) : 0;

    await prisma.rouletteBet.update({
      where: { id: bet.id },
      data: { won, payout },
    });

    if (won && payout > 0) {
      const updatedUser = await prisma.user.update({
        where: { id: bet.userId },
        data: { coins: { increment: payout } },
        select: { coins: true },
      });
      io?.to(`user:${bet.userId}`).emit('coinsUpdate', { coins: updatedUser.coins });
    }
  }

  await prisma.rouletteRound.update({
    where: { id: roundId },
    data: { status: 'COMPLETED', completedAt: new Date() },
  });

  // Fetch seed to reveal in result event
  const completedRound = await prisma.rouletteRound.findUnique({
    where: { id: roundId },
    select: { serverSeed: true, roundHash: true, result: true },
  });

  logger.info(`[Roulette] Round ${roundId} completed — zone=${winZone} x${multiplier}, ${bets.filter(b => b.zone === winZone).length} winners`);
  io?.emit('roulette:result', {
    roundId, winZone, multiplier,
    serverSeed: completedRound?.serverSeed,  // reveal seed now
    roundHash:  completedRound?.roundHash,
    result:     completedRound?.result,
  });

  // Start next round after 4s
  currentRoundId = null;
  roundTimer = setTimeout(startRound, 4_000);
}

export async function placeBet(userId: string, zone: Zone, amount: number): Promise<{ ok: boolean; error?: string }> {
  if (!currentRoundId) return { ok: false, error: 'No active round' };

  const round = await prisma.rouletteRound.findUnique({ where: { id: currentRoundId } });
  if (!round || round.status !== 'BETTING') return { ok: false, error: 'Betting is closed' };

  if (amount < 1 || amount > 100_000) return { ok: false, error: 'Invalid amount' };

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { coins: true, isBanned: true } });
  if (!user) return { ok: false, error: 'User not found' };
  if (user.isBanned) return { ok: false, error: 'Account banned' };
  if (user.coins < amount) return { ok: false, error: 'Insufficient coins' };

  // Check if already bet on this zone this round
  const existing = await prisma.rouletteBet.findFirst({
    where: { roundId: currentRoundId, userId, zone },
  });
  if (existing) {
    // Add to existing bet
    await prisma.rouletteBet.update({
      where: { id: existing.id },
      data: { amount: { increment: amount } },
    });
  } else {
    await prisma.rouletteBet.create({
      data: { roundId: currentRoundId, userId, zone, amount },
    });
  }

  await prisma.user.update({
    where: { id: userId },
    data: { coins: { decrement: amount }, totalWagered: { increment: amount } },
  });

  // Broadcast updated bets
  const io = getIo();
  const updatedRound = await getCurrentRound();
  io?.emit('roulette:betsUpdate', { roundId: currentRoundId, bets: updatedRound?.bets ?? [] });

  return { ok: true };
}

export async function initRoulette(): Promise<void> {
  // On startup: complete any orphaned rounds and start fresh
  await prisma.rouletteRound.updateMany({
    where: { status: { in: ['BETTING', 'SPINNING'] } },
    data: { status: 'COMPLETED', completedAt: new Date() },
  });
  await startRound();
  logger.info('[Roulette] Service initialized');
}
