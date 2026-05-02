/**
 * Rain service — admin-triggered coin drop.
 *
 * The admin picks amount + maxParticipants + duration. Each claim credits
 * floor(amount / maxParticipants) coins atomically (participant row + pot
 * counter + user balance + Transaction ledger, all wrapped in one
 * $transaction). If fewer than maxParticipants claim before the timer, the
 * residue stays in the house pool.
 *
 * Global constraints enforced here :
 *   - Max 1 Rain ACTIVE at any moment (409 conflict on createRain).
 *   - Max 1 Rain per hour, max 3 Rains per day, site-wide.
 *
 * Anti-abuse at claim time :
 *   - DB unique(rainId, userId) kills double-claim even if the app check races.
 *   - captchaMs < 500 → suspicious flag (claim allowed, flagged for review).
 *   - User must not be banned.
 *   - User account must be > 24 h old (anti-fresh-farm).
 *
 * Rate limiting per-IP (1 claim / IP / 30 s) is done at the route layer via
 * express-rate-limit — not here.
 */

import crypto from 'crypto';
import { prisma } from '../index';
import { getIo } from '../socket';
import logger from '../logger';

const SUSPICIOUS_CAPTCHA_MS = 500;
const FRESH_ACCOUNT_MIN_AGE_MS = 24 * 60 * 60 * 1000;

export interface CreateRainInput {
  amount: number;          // total coin pool, 50..10 000
  maxParticipants: number; // 5..500
  duration: number;        // seconds, 30..600
  triggeredByEvent?: string | null;
}

export type CreateRainResult =
  | { ok: true; rain: RainPublic }
  | { ok: false; reason: 'INVALID_INPUT' | 'ACTIVE_EXISTS' | 'HOURLY_QUOTA' | 'DAILY_QUOTA'; message: string };

export interface RainPublic {
  id: string;
  amount: number;
  maxParticipants: number;
  actualParticipants: number;
  duration: number;
  perUser: number; // floor(amount / maxParticipants) — pre-committed share
  status: 'ACTIVE' | 'COMPLETED' | 'EXPIRED';
  startedAt: string;
  endsAt: string;
  completedAt: string | null;
  actualPerUser: number | null;
  triggeredByEvent: string | null;
}

function toPublic(row: {
  id: string;
  amount: number | { toString(): string };
  maxParticipants: number;
  actualParticipants: number;
  duration: number;
  status: string;
  startedAt: Date;
  endsAt: Date;
  completedAt: Date | null;
  actualPerUser: number | { toString(): string } | null;
  triggeredByEvent: string | null;
}): RainPublic {
  // amount + actualPerUser may arrive as Prisma.Decimal — coerce both
  // to plain JS number for the public payload.
  const amountNum = typeof row.amount === 'number' ? row.amount : Number(row.amount.toString());
  const perUserNum = row.actualPerUser == null
    ? null
    : typeof row.actualPerUser === 'number' ? row.actualPerUser : Number(row.actualPerUser.toString());
  return {
    id: row.id,
    amount: amountNum,
    maxParticipants: row.maxParticipants,
    actualParticipants: row.actualParticipants,
    duration: row.duration,
    perUser: Math.round((amountNum / Math.max(1, row.maxParticipants)) * 100) / 100,
    status: row.status as RainPublic['status'],
    startedAt: row.startedAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    actualPerUser: perUserNum,
    triggeredByEvent: row.triggeredByEvent,
  };
}

// ─── Admin : create a rain ──────────────────────────────────────────────────

export async function createRain(adminId: string, input: CreateRainInput): Promise<CreateRainResult> {
  // Bounds check (also validated at route level ; defense in depth)
  const amount = Math.floor(input.amount);
  const maxP   = Math.floor(input.maxParticipants);
  const dur    = Math.floor(input.duration);
  if (!(amount >= 10 && amount <= 10_000)) {
    return { ok: false, reason: 'INVALID_INPUT', message: 'amount hors bornes [10, 10000]' };
  }
  if (!(maxP >= 5 && maxP <= 500)) {
    return { ok: false, reason: 'INVALID_INPUT', message: 'maxParticipants hors bornes [5, 500]' };
  }
  if (!(dur >= 30 && dur <= 600)) {
    return { ok: false, reason: 'INVALID_INPUT', message: 'duration hors bornes [30, 600] secondes' };
  }

  // Global throttles
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const oneDayAgo  = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [active, lastHour, lastDay] = await Promise.all([
    prisma.rain.count({ where: { status: 'ACTIVE' } }),
    prisma.rain.count({ where: { startedAt: { gte: oneHourAgo } } }),
    prisma.rain.count({ where: { startedAt: { gte: oneDayAgo } } }),
  ]);
  if (active > 0) {
    return { ok: false, reason: 'ACTIVE_EXISTS', message: 'Un rain est déjà actif. Attends sa fin avant d\'en lancer un autre.' };
  }
  if (lastHour >= 1) {
    return { ok: false, reason: 'HOURLY_QUOTA', message: 'Un rain a déjà été lancé cette heure-ci. Attends 60 min entre deux rains.' };
  }
  if (lastDay >= 3) {
    return { ok: false, reason: 'DAILY_QUOTA', message: 'Quota journalier atteint (3 rains / 24 h).' };
  }

  const rain = await prisma.rain.create({
    data: {
      triggeredBy:      adminId,
      triggeredByEvent: input.triggeredByEvent ?? null,
      amount,
      maxParticipants:  maxP,
      duration:         dur,
      endsAt:           new Date(now.getTime() + dur * 1000),
    },
  });

  // If the rain was motivated by an EventSuggestion, auto-mark it ACTED so
  // the operator doesn't have to close the loop manually.
  if (input.triggeredByEvent) {
    try {
      await prisma.eventSuggestion.update({
        where: { id: input.triggeredByEvent },
        data: {
          status: 'ACTED',
          actedAt: now,
          actedNote: `Rain launched: ${amount} ⚜ / ${maxP} users max / ${dur}s`,
        },
      });
    } catch {
      // Non-blocking : the rain has already been created successfully.
    }
  }

  const io = getIo();
  io?.emit('rain:start', toPublic(rain));

  logger.info(`[Rain] ${rain.id} launched by admin=${adminId} — ${amount}⚜ / ${maxP} max / ${dur}s`);
  return { ok: true, rain: toPublic(rain) };
}

// ─── User : claim a share ───────────────────────────────────────────────────

export type ClaimResult =
  | { ok: true; coinsReceived: number; suspicious: boolean }
  | { ok: false; reason: 'RAIN_NOT_FOUND' | 'RAIN_NOT_ACTIVE' | 'RAIN_EXPIRED' | 'RAIN_FULL' | 'ALREADY_CLAIMED' | 'USER_BANNED' | 'FRESH_ACCOUNT'; message: string };

export async function joinRain(rainId: string, userId: string, captchaMs: number, ipHash: string | null): Promise<ClaimResult> {
  const rain = await prisma.rain.findUnique({ where: { id: rainId } });
  if (!rain) return { ok: false, reason: 'RAIN_NOT_FOUND', message: 'Rain inconnu.' };
  if (rain.status !== 'ACTIVE') return { ok: false, reason: 'RAIN_NOT_ACTIVE', message: 'Rain terminé.' };
  if (rain.endsAt <= new Date()) return { ok: false, reason: 'RAIN_EXPIRED', message: 'Rain expiré.' };
  if (rain.actualParticipants >= rain.maxParticipants) {
    return { ok: false, reason: 'RAIN_FULL', message: 'Rain complet.' };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, isBanned: true, createdAt: true },
  });
  if (!user) return { ok: false, reason: 'USER_BANNED', message: 'User inconnu.' };
  if (user.isBanned) return { ok: false, reason: 'USER_BANNED', message: 'Compte suspendu.' };
  if (Date.now() - user.createdAt.getTime() < FRESH_ACCOUNT_MIN_AGE_MS) {
    return { ok: false, reason: 'FRESH_ACCOUNT', message: 'Le compte doit avoir > 24 h pour claim un rain.' };
  }

  // 2-decimal precision : the rain pool splits exactly across maxParticipants.
  const perUser = Math.round((Number(rain.amount.toString()) / rain.maxParticipants) * 100) / 100;
  const suspicious = captchaMs < SUSPICIOUS_CAPTCHA_MS;

  // Atomic : participant row + pot counter + user balance + ledger. Unique
  // constraint (rainId, userId) gives us double-claim protection even if
  // two requests race through the checks above.
  try {
    await prisma.$transaction([
      prisma.rainParticipant.create({
        data: {
          rainId,
          userId,
          coinsReceived: perUser,
          captchaMs,
          ipHash,
          suspicious,
        },
      }),
      prisma.rain.update({
        where: { id: rainId },
        data: { actualParticipants: { increment: 1 } },
      }),
      prisma.user.update({
        where: { id: userId },
        data: { coins: { increment: perUser } },
      }),
      prisma.transaction.create({
        data: {
          userId,
          type: 'rain_claimed',
          status: 'completed',
          amount: perUser,
          coins: perUser,
        },
      }),
    ]);
  } catch (err: unknown) {
    // P2002 = unique constraint = double-claim
    const code = (err as { code?: string } | null)?.code;
    if (code === 'P2002') {
      return { ok: false, reason: 'ALREADY_CLAIMED', message: 'Déjà claim sur ce rain.' };
    }
    throw err;
  }

  if (suspicious) {
    logger.warn(`[Rain] suspicious claim — rain=${rainId} user=${userId} captchaMs=${captchaMs} ipHash=${ipHash ?? 'n/a'}`);
  }

  // Broadcast + coins refresh notification for the claiming user
  const io = getIo();
  const [updatedRain, updatedUser] = await Promise.all([
    prisma.rain.findUnique({ where: { id: rainId } }),
    prisma.user.findUnique({ where: { id: userId }, select: { coins: true } }),
  ]);
  if (updatedRain) io?.emit('rain:update', toPublic(updatedRain));
  io?.to(`user:${userId}`).emit('coinsUpdate', { coins: updatedUser?.coins ?? 0, direction: 'up' });

  // Auto-complete if we just hit maxParticipants
  if (updatedRain && updatedRain.actualParticipants >= updatedRain.maxParticipants) {
    await completeRain(rainId).catch((e) => logger.error(`[Rain] auto-complete failed for ${rainId}:`, e));
  }

  return { ok: true, coinsReceived: perUser, suspicious };
}

// ─── Completion ─────────────────────────────────────────────────────────────

export async function completeRain(rainId: string): Promise<void> {
  const now = new Date();
  // Atomic transition — if some other process already completed it, updateMany
  // returns count=0 and we bail out silently.
  const locked = await prisma.rain.updateMany({
    where: { id: rainId, status: 'ACTIVE' },
    data: { status: 'COMPLETED' },
  });
  if (locked.count === 0) return;

  const rain = await prisma.rain.findUnique({
    where: { id: rainId },
    include: {
      participants: {
        include: { user: { select: { id: true, username: true, avatar: true } } },
        orderBy: { claimedAt: 'asc' },
      },
    },
  });
  if (!rain) return;

  // Final settle : redistribute the pool exactly across the actual claimers.
  const perUser = Math.round((Number(rain.amount.toString()) / Math.max(1, rain.actualParticipants)) * 100) / 100;
  await prisma.rain.update({
    where: { id: rainId },
    data: { completedAt: now, actualPerUser: perUser },
  });

  logger.info(
    `[Rain] ${rainId} completed — ${rain.actualParticipants}/${rain.maxParticipants} claimants, ${perUser}⚜/user`,
  );

  const io = getIo();
  io?.emit('rain:end', {
    ...toPublic({ ...rain, actualPerUser: perUser, completedAt: now, status: 'COMPLETED' }),
    participants: rain.participants.map((p) => ({
      userId: p.userId,
      username: p.user?.username,
      avatar: p.user?.avatar,
      coinsReceived: p.coinsReceived,
      suspicious: p.suspicious,
    })),
  });
}

// Called by the 10 s cron to close rains that hit their endsAt deadline
export async function sweepExpiredRains(): Promise<number> {
  const now = new Date();
  const expired = await prisma.rain.findMany({
    where: { status: 'ACTIVE', endsAt: { lte: now } },
    select: { id: true },
  });
  for (const r of expired) {
    await completeRain(r.id).catch((e) => logger.error(`[Rain] sweep completeRain(${r.id}) failed:`, e));
  }
  return expired.length;
}

// ─── Read helpers ───────────────────────────────────────────────────────────

export async function getActiveRain(): Promise<RainPublic | null> {
  const row = await prisma.rain.findFirst({
    where: { status: 'ACTIVE' },
    orderBy: { startedAt: 'desc' },
  });
  if (!row) return null;
  return toPublic(row);
}

export async function hasUserClaimed(rainId: string, userId: string): Promise<boolean> {
  const n = await prisma.rainParticipant.count({ where: { rainId, userId } });
  return n > 0;
}

export async function listRainHistory(limit = 20) {
  const rows = await prisma.rain.findMany({
    orderBy: { startedAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 100),
    include: {
      admin: { select: { id: true, username: true } },
    },
  });
  return rows.map((r) => ({
    ...toPublic(r),
    triggeredByAdmin: r.admin?.username ?? 'unknown',
  }));
}

// ─── Utilities ──────────────────────────────────────────────────────────────

/** SHA-256 of a raw IP for abuse-review correlation without storing PII. */
export function hashIpForRain(ip: string | undefined): string | null {
  if (!ip) return null;
  const clean = ip.replace(/^::ffff:/, '').trim();
  if (!clean) return null;
  return crypto.createHash('sha256').update(clean).digest('hex');
}
