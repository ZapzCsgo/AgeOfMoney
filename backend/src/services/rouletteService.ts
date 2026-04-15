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
import axios from 'axios';
import { prisma } from '../index';
import { getIo } from '../socket';
import { creditAffiliateOnBetResolved } from './affiliateService';
import logger from '../logger';

/** Fetch a cryptographically verified random integer 1-15 from random.org.
 *  Returns null if RANDOM_ORG_API_KEY is missing or the request fails (fallback to crypto). */
async function getRandomOrgResult(): Promise<{ result: number; serialNumber: string; signature: string } | null> {
  const apiKey = process.env.RANDOM_ORG_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await axios.post('https://api.random.org/json-rpc/4/invoke', {
      jsonrpc: '2.0',
      method: 'generateSignedIntegers',
      params: { apiKey, n: 1, min: 1, max: 15, replacement: true },
      id: Date.now(),
    }, { timeout: 5000 });
    const data = res.data?.result;
    const value = data?.random?.data?.[0];
    if (typeof value !== 'number') return null;
    return {
      result: value,
      serialNumber: String(data.random.serialNumber),
      signature: data.signature as string,
    };
  } catch (err) {
    logger.warn('[Roulette] random.org unavailable, falling back to crypto:', err);
    return null;
  }
}

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

const BETTING_DURATION = 10_000;  // 10s
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

  // With random.org: result is determined at spin time, no pre-commitment possible.
  // roundHash and serverSeed are set in spinRound after calling random.org.
  const round = await prisma.rouletteRound.create({
    data: { status: 'BETTING', endsAt },
  });
  currentRoundId = round.id;

  logger.info(`[Roulette] Round ${round.id} started — betting until ${endsAt.toISOString()}`);
  // roundHash is null: result will be determined by random.org at spin time
  io?.emit('roulette:roundStart', { roundId: round.id, endsAt: endsAt.toISOString(), roundHash: null });

  roundTimer = setTimeout(() => spinRound(round.id), BETTING_DURATION);
}

async function spinRound(roundId: string): Promise<void> {
  const io = getIo();

  // Try random.org first — true atmospheric randomness with signed proof
  const randomOrg = await getRandomOrgResult();
  let result: number;
  let serverSeed: string;
  let roundHash: string;
  let source: 'random.org' | 'crypto';

  if (randomOrg) {
    result     = randomOrg.result;
    roundHash  = randomOrg.serialNumber;  // serial number shown as provably fair ID
    serverSeed = randomOrg.signature;     // cryptographic signature for verification
    source     = 'random.org';
    logger.info(`[Roulette] Round ${roundId} — random.org serial #${roundHash}, result=${result}`);
  } else {
    // Fallback: crypto-based deterministic result with rejection sampling
    // to guarantee uniform distribution over 1..15 (zero modulo bias).
    const seed = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(seed).digest('hex');
    // Use 16 hex chars (64 bits) and rejection-sample. 2^64 / 15 leaves
    // a tiny "tail" we discard by walking forward in the hash if needed.
    const MAX = 15n * (BigInt('0xffffffffffffffff') / 15n);
    let pick = 0n;
    let cursor = 0;
    while (cursor + 16 <= hash.length) {
      pick = BigInt('0x' + hash.slice(cursor, cursor + 16));
      if (pick < MAX) break;
      cursor += 16;
    }
    result     = Number(pick % 15n) + 1;
    serverSeed = seed;
    roundHash  = hash;
    source     = 'crypto';
    logger.info(`[Roulette] Round ${roundId} — crypto fallback, result=${result}`);
  }

  const winZone    = getZoneFromResult(result);
  const multiplier = ZONES[winZone].multiplier;
  const spinAt     = new Date();

  await prisma.rouletteRound.update({
    where: { id: roundId },
    data: { status: 'SPINNING', result, winZone, multiplier, spinAt, serverSeed, roundHash },
  });

  io?.emit('roulette:spin', { roundId, result, winZone, multiplier, roundHash, source });

  // Resolve after animation
  roundTimer = setTimeout(() => resolveRound(roundId, winZone, multiplier), SPIN_DURATION);
}

async function resolveRound(roundId: string, winZone: string, multiplier: number): Promise<void> {
  const io = getIo();

  const bets = await prisma.rouletteBet.findMany({ where: { roundId } });

  // Compute outcomes + aggregate winner increments per user
  const resolved = bets.map(bet => {
    const won = bet.zone === winZone;
    const payout = won ? Math.floor(bet.amount * multiplier) : 0;
    return { bet, won, payout };
  });
  const winnerCoinIncrements = new Map<string, number>();
  for (const { bet, won, payout } of resolved) {
    if (won && payout > 0) {
      winnerCoinIncrements.set(bet.userId, (winnerCoinIncrements.get(bet.userId) ?? 0) + payout);
    }
  }

  // Batch ALL writes in one transaction (was N × 2 serial queries)
  if (resolved.length > 0) {
    await prisma.$transaction([
      ...resolved.map(({ bet, won, payout }) =>
        prisma.rouletteBet.update({ where: { id: bet.id }, data: { won, payout } })
      ),
      ...[...winnerCoinIncrements.entries()].map(([userId, totalIncrement]) =>
        prisma.user.update({ where: { id: userId }, data: { coins: { increment: totalIncrement } } })
      ),
    ]);
  }

  // Fetch winner balances in ONE query for socket notifications
  const winnerUserIds = [...winnerCoinIncrements.keys()];
  const winnerUsers = winnerUserIds.length > 0
    ? await prisma.user.findMany({ where: { id: { in: winnerUserIds } }, select: { id: true, coins: true } })
    : [];
  const winnerUserMap = new Map(winnerUsers.map(u => [u.id, u]));
  for (const userId of winnerUserIds) {
    const u = winnerUserMap.get(userId);
    if (u) io?.to(`user:${userId}`).emit('coinsUpdate', { coins: u.coins, direction: 'up' });
  }

  // Credit affiliate revshare on each bet (fire and forget)
  for (const { bet, won, payout } of resolved) {
    const netDelta = won ? -(payout - bet.amount) : bet.amount;
    creditAffiliateOnBetResolved(bet.userId, bet.amount, netDelta)
      .catch(err => logger.warn('[Affiliate] credit failed:', err));
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
  const isRandomOrg = completedRound?.roundHash != null && /^\d+$/.test(completedRound.roundHash);
  io?.emit('roulette:result', {
    roundId, winZone, multiplier,
    serverSeed: completedRound?.serverSeed,
    roundHash:  completedRound?.roundHash,
    result:     completedRound?.result,
    source: isRandomOrg ? 'random.org' : 'crypto',
  });

  // Start next round after 4s
  currentRoundId = null;
  roundTimer = setTimeout(startRound, 4_000);
}

export async function placeBet(userId: string, zone: Zone, amount: number): Promise<{ ok: boolean; error?: string }> {
  if (!currentRoundId) return { ok: false, error: 'No active round' };

  if (amount < 1 || amount > 100_000) return { ok: false, error: 'Invalid amount' };

  // Run all 3 validation queries in parallel
  const [round, user, existing] = await Promise.all([
    prisma.rouletteRound.findUnique({ where: { id: currentRoundId } }),
    prisma.user.findUnique({ where: { id: userId }, select: { coins: true, isBanned: true } }),
    prisma.rouletteBet.findFirst({ where: { roundId: currentRoundId, userId, zone } }),
  ]);

  if (!round || round.status !== 'BETTING') return { ok: false, error: 'Betting is closed' };
  // Strict timing check — prevent bets after betting phase deadline (even if DB status not yet updated)
  if (round.endsAt && new Date() > round.endsAt) return { ok: false, error: 'Betting phase has ended' };
  if (!user) return { ok: false, error: 'User not found' };
  if (user.isBanned) return { ok: false, error: 'Account banned' };
  if (user.coins < amount) return { ok: false, error: 'Insufficient coins' };

  // Atomic transaction to prevent race conditions (double-spend)
  const updatedUser = await prisma.$transaction(async (tx) => {
    const freshUser = await tx.user.findUnique({ where: { id: userId }, select: { coins: true } });
    if (!freshUser || freshUser.coins < amount) throw new Error('Insufficient coins');

    if (existing) {
      await tx.rouletteBet.update({ where: { id: existing.id }, data: { amount: { increment: amount } } });
    } else {
      await tx.rouletteBet.create({ data: { roundId: currentRoundId!, userId, zone, amount } });
    }
    return tx.user.update({
      where: { id: userId },
      data: { coins: { decrement: amount }, totalWagered: { increment: amount } },
      select: { coins: true },
    });
  });

  // Broadcast updated bets
  const io = getIo();
  // Notify user of coin deduction (red flash on frontend)
  io?.to(`user:${userId}`).emit('coinsUpdate', { coins: updatedUser.coins, direction: 'down' });
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
