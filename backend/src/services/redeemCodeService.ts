/**
 * Redeem-codes service.
 *
 * Two surfaces :
 *   - `redeemCode()` : called by `POST /api/v1/redeem`. Validates every
 *     restriction (expiry, max uses, account age, deposit floor),
 *     reserves a slot via the unique (codeId, userId) constraint to
 *     prevent double-redeem races, credits the user's
 *     `redeemLockedBalance`, and writes a `redeem_locked` ledger row.
 *   - `processWageringForBet()` : called inside the same `$transaction`
 *     as every bet placement (match bet, coinflip, jackpot, roulette).
 *     Increments `User.totalWageringProgress` and, for every pending
 *     redemption whose threshold is reached, flips `unlocked=true`,
 *     moves coins from `redeemLockedBalance` into `coins`, and writes
 *     a `redeem_unlock` ledger row.
 *
 * Decimal precision : all coin-amount columns use Decimal(20, 8). Math
 * goes through Prisma.Decimal (decimal.js under the hood) — never raw
 * JS Number. Comparisons use .gte / .gt / .lte etc., never `>=` / `>`.
 *
 * The Prisma client doesn't carry the `redeemCode` /
 * `redeemCodeRedemption` models in TypeScript locally — Windows DLL
 * lock prevents `prisma generate` while the dev server runs. The
 * type-erasure shim `redeemPrisma()` lets this file compile today ;
 * Railway runs `prisma generate` fresh so the production build picks
 * up the real types automatically.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../index';
import { recordLedger, type LedgerClient } from './ledger';
import logger from '../logger';

type DecimalLike = Prisma.Decimal | string | number;

// ── Type-erasure shim for the redeem-code models ─────────────────────────
// See module docstring. Replace with the real generated types after the
// next `prisma generate` (no behavior change).
interface RedeemCodeRow {
  id: string;
  code: string;
  amount: Prisma.Decimal;
  maxUses: number | null;
  currentUses: number;
  expiresAt: Date | null;
  minAccountAgeHours: number | null;
  maxAccountAgeHours: number | null;
  wageringMultiplier: Prisma.Decimal;
  requiresMinDeposit: Prisma.Decimal | null;
  createdBy: string;
  notes: string | null;
  disabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}
interface RedeemRedemptionRow {
  id: string;
  codeId: string;
  userId: string;
  amount: Prisma.Decimal;
  wageringRequired: Prisma.Decimal;
  wageringStartAt: Prisma.Decimal;
  unlocked: boolean;
  ipHash: string | null;
  userAgent: string | null;
  redeemedAt: Date;
  unlockedAt: Date | null;
}
type AnyClient = PrismaClient | LedgerClient;
function redeemPrisma(client: AnyClient): {
  redeemCode: {
    findUnique(args: { where: { code?: string; id?: string } }): Promise<RedeemCodeRow | null>;
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<RedeemCodeRow>;
    findMany(args?: { where?: Record<string, unknown>; orderBy?: Record<string, 'asc' | 'desc'>; take?: number }): Promise<RedeemCodeRow[]>;
    create(args: { data: Record<string, unknown> }): Promise<RedeemCodeRow>;
    count(args?: { where?: Record<string, unknown> }): Promise<number>;
  };
  redeemCodeRedemption: {
    findMany(args: { where: Record<string, unknown>; orderBy?: Record<string, 'asc' | 'desc'>; take?: number; include?: Record<string, unknown> }): Promise<Array<RedeemRedemptionRow & { code?: { code: string } }>>;
    create(args: { data: Record<string, unknown> }): Promise<RedeemRedemptionRow>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<RedeemRedemptionRow>;
    aggregate(args: { where: Record<string, unknown>; _sum?: Record<string, true>; _count?: true | Record<string, true> }): Promise<{ _sum?: { amount?: Prisma.Decimal | null }; _count?: number | Record<string, number> }>;
  };
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return client as any;
}

// ── Public API ──────────────────────────────────────────────────────────
export type RedeemFailureReason =
  | 'invalid' | 'disabled' | 'expired' | 'max_uses'
  | 'already_redeemed' | 'account_too_young' | 'account_too_old'
  | 'min_deposit_not_met' | 'user_not_found';

export type RedeemResult =
  | { ok: true; amount: Prisma.Decimal; wageringRequired: Prisma.Decimal; newLockedBalance: Prisma.Decimal }
  | { ok: false; reason: RedeemFailureReason; message: string };

/** Redeem a code for the given user. Idempotent : a second call with the
 *  same (code, userId) returns `already_redeemed` cleanly. */
export async function redeemCode(opts: {
  userId: string;
  code: string;
  ipHash?: string | null;
  userAgent?: string | null;
}): Promise<RedeemResult> {
  const codeUpper = opts.code.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,20}$/.test(codeUpper)) {
    return { ok: false, reason: 'invalid', message: 'Code must be 1-20 alphanumeric characters' };
  }

  const code = await redeemPrisma(prisma).redeemCode.findUnique({ where: { code: codeUpper } });
  if (!code) return { ok: false, reason: 'invalid', message: 'Invalid code' };
  if (code.disabled) return { ok: false, reason: 'disabled', message: 'This code is no longer active' };
  if (code.expiresAt && code.expiresAt < new Date()) {
    return { ok: false, reason: 'expired', message: 'This code has expired' };
  }
  if (code.maxUses !== null && code.currentUses >= code.maxUses) {
    return { ok: false, reason: 'max_uses', message: 'This code has reached its usage limit' };
  }

  const user = await prisma.user.findUnique({
    where: { id: opts.userId },
    // Cast to any so the new Decimal columns from the schema (not in the
    // generated client yet) are addressable. Same DLL-lock workaround.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: { id: true, createdAt: true, totalWageringProgress: true, redeemLockedBalance: true } as any,
  });
  if (!user) return { ok: false, reason: 'user_not_found', message: 'User not found' };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userExt = user as unknown as { id: string; createdAt: Date; totalWageringProgress: Prisma.Decimal; redeemLockedBalance: Prisma.Decimal };

  const accountAgeHours = (Date.now() - userExt.createdAt.getTime()) / 3_600_000;
  if (code.minAccountAgeHours !== null && accountAgeHours < code.minAccountAgeHours) {
    return {
      ok: false, reason: 'account_too_young',
      message: `Account must be at least ${code.minAccountAgeHours}h old (yours is ${Math.floor(accountAgeHours)}h)`,
    };
  }
  if (code.maxAccountAgeHours !== null && accountAgeHours > code.maxAccountAgeHours) {
    return {
      ok: false, reason: 'account_too_old',
      message: `This code is reserved to accounts at most ${code.maxAccountAgeHours}h old`,
    };
  }

  if (code.requiresMinDeposit !== null) {
    const deposited = await prisma.transaction.aggregate({
      where: { userId: opts.userId, type: 'deposit', status: 'completed' },
      _sum: { coins: true },
    });
    // Transaction.coins is still Int (legacy). The migration plan covers
    // converting it ; until then we coerce via Decimal for one comparison.
    const totalDeposited = new Prisma.Decimal(deposited._sum.coins ?? 0);
    if (totalDeposited.lt(code.requiresMinDeposit)) {
      return {
        ok: false, reason: 'min_deposit_not_met',
        message: `This code requires at least ${code.requiresMinDeposit.toFixed(2)}⚜ deposited (you have ${totalDeposited.toFixed(2)}⚜)`,
      };
    }
  }

  const wageringRequired = new Prisma.Decimal(code.amount).mul(code.wageringMultiplier);
  const codeAmount = new Prisma.Decimal(code.amount);

  try {
    await prisma.$transaction(async (tx) => {
      // Reserve the redemption slot first — unique (codeId, userId)
      // constraint catches double-redeem races cleanly.
      await redeemPrisma(tx).redeemCodeRedemption.create({
        data: {
          codeId: code.id,
          userId: opts.userId,
          amount: codeAmount,
          wageringRequired,
          wageringStartAt: userExt.totalWageringProgress,
          ipHash: opts.ipHash ?? null,
          userAgent: opts.userAgent ?? null,
        },
      });

      // Race-safe usage cap : updateMany with a `currentUses < maxUses`
      // guard is the only way to atomically bump a counter without a
      // separate find→increment that lets two parallel requests both see
      // currentUses=99 and both increment to 100 on a maxUses=100 code.
      const cap = code.maxUses;
      const useResult = await redeemPrisma(tx).redeemCode.updateMany({
        where: cap !== null
          ? { id: code.id, currentUses: { lt: cap } }
          : { id: code.id },
        data: { currentUses: { increment: 1 } },
      });
      if (useResult.count === 0) {
        throw new Error('REDEEM_MAX_USES_RACE');
      }

      // Increment the locked balance via raw SQL — the generated Prisma
      // client doesn't have the redeemLockedBalance column type yet,
      // and `update({ data: { redeemLockedBalance: { increment } } })`
      // wouldn't typecheck. Raw SQL also dodges any potential JS-Number
      // intermediate that would lose Decimal precision.
      await tx.$executeRawUnsafe(
        `UPDATE "User" SET "redeemLockedBalance" = "redeemLockedBalance" + $1 WHERE "id" = $2`,
        codeAmount.toString(),
        opts.userId,
      );
      // Transaction.coins is now Decimal(20, 8) ; pass codeAmount directly,
      // no more Math.floor truncation of fractional bonuses.
      await recordLedger(tx, {
        userId: opts.userId,
        type: 'redeem_locked',
        coins: codeAmount,
      });
    });

    logger.info(
      `[Redeem] ${opts.userId} redeemed ${codeUpper.slice(0, 4)}*** for ${codeAmount.toFixed(2)}⚜ ` +
      `(wageringRequired=${wageringRequired.toFixed(2)})`,
    );

    return {
      ok: true,
      amount: codeAmount,
      wageringRequired,
      newLockedBalance: userExt.redeemLockedBalance.add(codeAmount),
    };
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e?.code === 'P2002') {
      return { ok: false, reason: 'already_redeemed', message: 'You already redeemed this code' };
    }
    if (e?.message === 'REDEEM_MAX_USES_RACE') {
      return { ok: false, reason: 'max_uses', message: 'This code reached its usage limit' };
    }
    logger.error('[Redeem] Unexpected error', err);
    throw err;
  }
}

/** Increments wagering progress + auto-unlocks any redemption that just
 *  crossed its threshold.
 *
 *  Originally called inside the bet's `$transaction` for atomicity. Moved
 *  to its own implicit transaction (called AFTER the bet commits) because :
 *    1. Wagering is non-essential for bet placement — losing one wagering
 *       update is acceptable, losing a bet is not.
 *    2. If the redeem schema columns aren't yet on the DB (e.g. the
 *       boot-time migration hook hasn't run yet on a fresh deploy), the
 *       raw SQL would throw and roll back the entire bet transaction.
 *    3. Race-safety is preserved by the `UPDATE … += amount` SQL — Postgres
 *       row-level locks are held for the duration of the UPDATE, so even
 *       two concurrent bets can't lose increments.
 *
 *  Schema-not-ready errors (column / relation does not exist) are caught
 *  and logged at warn level instead of throwing. Other errors are
 *  rethrown — they're real bugs we want to see.
 *
 *  `betAmount` accepts Decimal | string | number for forward-compat with
 *  the planned global Decimal migration. Internally always Decimal math.
 */
export async function processWageringForBet(
  tx: LedgerClient,
  opts: { userId: string; betAmount: DecimalLike },
): Promise<void> {
  const wager = new Prisma.Decimal(opts.betAmount);
  if (wager.lte(0)) return;

  try {
    // Increment progress via raw SQL — see comment in redeemCode() above
    // re: Decimal columns not being in the generated client locally.
    await tx.$executeRawUnsafe(
      `UPDATE "User" SET "totalWageringProgress" = "totalWageringProgress" + $1 WHERE "id" = $2`,
      wager.toString(),
      opts.userId,
    );

    // Cheap early-exit when the user has no locked balance — avoids
    // hitting the redemption table for the 99 % of users who never
    // redeemed a code. Read the fresh values via raw SQL too.
    const userRow = await tx.$queryRawUnsafe<Array<{ totalWageringProgress: string; redeemLockedBalance: string }>>(
      `SELECT "totalWageringProgress"::text, "redeemLockedBalance"::text FROM "User" WHERE "id" = $1`,
      opts.userId,
    );
    if (userRow.length === 0) return;
    const lockedBalance = new Prisma.Decimal(userRow[0].redeemLockedBalance);
    if (lockedBalance.lte(0)) return;
    const totalWagering = new Prisma.Decimal(userRow[0].totalWageringProgress);

    const pending = await redeemPrisma(tx).redeemCodeRedemption.findMany({
      where: { userId: opts.userId, unlocked: false },
    });
    if (pending.length === 0) return;

    for (const r of pending) {
      const required = new Prisma.Decimal(r.wageringStartAt).add(r.wageringRequired);
      if (totalWagering.lt(required)) continue;
      const amount = new Prisma.Decimal(r.amount);

      await redeemPrisma(tx).redeemCodeRedemption.update({
        where: { id: r.id },
        data: { unlocked: true, unlockedAt: new Date() },
      });
      // Move coins : decrement redeemLockedBalance + increment User.coins.
      // Both columns are now Decimal(20, 8) so the unlock preserves the
      // exact bonus amount — fractional unlocks no longer lose precision.
      await tx.$executeRawUnsafe(
        `UPDATE "User"
           SET "redeemLockedBalance" = "redeemLockedBalance" - $1,
               "coins"               = "coins" + $1
         WHERE "id" = $2`,
        amount.toString(), opts.userId,
      );
      await recordLedger(tx, { userId: opts.userId, type: 'redeem_unlock', coins: amount });
      logger.info(`[Redeem] Unlocked ${amount.toFixed(2)}⚜ for ${opts.userId} (redemption ${r.id})`);
    }
  } catch (err) {
    const code = (err as { code?: string })?.code;
    const msg  = (err as { message?: string })?.message ?? '';
    // Postgres error codes :
    //   42703 = undefined_column      (e.g. totalWageringProgress missing)
    //   42P01 = undefined_table       (e.g. RedeemCodeRedemption missing)
    // Both happen when the redeem-schema migration hasn't run yet. Swallow
    // and log — the bet itself must still succeed.
    if (code === '42703' || code === '42P01' || /does not exist/i.test(msg)) {
      logger.warn(
        `[Redeem] processWageringForBet skipped (schema not ready) for user ${opts.userId} : ${msg}`,
      );
      return;
    }
    // Real error — log and continue. We do NOT rethrow because we no
    // longer share a transaction with the bet ; rethrowing would crash
    // the caller's success path for no benefit.
    logger.error(`[Redeem] processWageringForBet failed for user ${opts.userId}:`, err);
  }
}

/** User's redemption history with computed wagering progress. Used by
 *  `GET /api/v1/me/redeem-history`. */
export async function getUserRedeemHistory(userId: string): Promise<Array<{
  id: string;
  code: string;
  amount: string;
  wageringRequired: string;
  wageringDone: string;
  unlocked: boolean;
  redeemedAt: Date;
  unlockedAt: Date | null;
}>> {
  const userRow = await prisma.$queryRawUnsafe<Array<{ totalWageringProgress: string }>>(
    `SELECT "totalWageringProgress"::text FROM "User" WHERE "id" = $1`,
    userId,
  );
  if (userRow.length === 0) return [];
  const totalWagering = new Prisma.Decimal(userRow[0].totalWageringProgress);

  const list = await redeemPrisma(prisma).redeemCodeRedemption.findMany({
    where: { userId },
    orderBy: { redeemedAt: 'desc' },
    take: 100,
    include: { code: { select: { code: true } } },
  });

  return list.map((r) => {
    const required = new Prisma.Decimal(r.wageringRequired);
    const startAt = new Prisma.Decimal(r.wageringStartAt);
    const doneRaw = totalWagering.sub(startAt);
    const doneClamped = Prisma.Decimal.max(0, Prisma.Decimal.min(required, doneRaw));
    return {
      id: r.id,
      code: r.code?.code ?? '',
      amount: new Prisma.Decimal(r.amount).toFixed(2),
      wageringRequired: required.toFixed(2),
      wageringDone: doneClamped.toFixed(2),
      unlocked: r.unlocked,
      redeemedAt: r.redeemedAt,
      unlockedAt: r.unlockedAt,
    };
  });
}

/** Admin : list all codes (non-disabled by default, filterable). */
export async function listCodes(opts: { includeDisabled?: boolean; limit?: number } = {}): Promise<RedeemCodeRow[]> {
  return redeemPrisma(prisma).redeemCode.findMany({
    where: opts.includeDisabled ? {} : { disabled: false },
    orderBy: { createdAt: 'desc' },
    take: opts.limit ?? 100,
  });
}

/** Admin : single-code stats for the dashboard. */
export async function getCodeStats(codeId: string): Promise<{
  code: RedeemCodeRow | null;
  totalRedemptions: number;
  totalAmountDistributed: string;
  unlockedCount: number;
  redemptions: Array<{ userId: string; amount: string; unlocked: boolean; redeemedAt: Date }>;
}> {
  const code = await redeemPrisma(prisma).redeemCode.findUnique({ where: { id: codeId } });
  if (!code) return { code: null, totalRedemptions: 0, totalAmountDistributed: '0.00', unlockedCount: 0, redemptions: [] };

  const all = await redeemPrisma(prisma).redeemCodeRedemption.findMany({
    where: { codeId },
    orderBy: { redeemedAt: 'desc' },
    take: 200,
  });
  const total = all.reduce((acc, r) => acc.add(r.amount), new Prisma.Decimal(0));
  const unlockedCount = all.filter((r) => r.unlocked).length;
  return {
    code,
    totalRedemptions: all.length,
    totalAmountDistributed: total.toFixed(2),
    unlockedCount,
    // userId only — no PII surfacing in admin stats
    redemptions: all.map((r) => ({
      userId: r.userId,
      amount: new Prisma.Decimal(r.amount).toFixed(2),
      unlocked: r.unlocked,
      redeemedAt: r.redeemedAt,
    })),
  };
}

/** Owner : create a new code. */
export async function createCode(opts: {
  code: string;
  amount: DecimalLike;
  maxUses?: number | null;
  expiresAt?: Date | null;
  minAccountAgeHours?: number | null;
  maxAccountAgeHours?: number | null;
  wageringMultiplier?: DecimalLike;
  requiresMinDeposit?: DecimalLike | null;
  notes?: string | null;
  createdBy: string;
}): Promise<RedeemCodeRow> {
  const codeUpper = opts.code.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,20}$/.test(codeUpper)) {
    throw new Error('Code must be 1-20 alphanumeric characters');
  }
  const amount = new Prisma.Decimal(opts.amount);
  if (amount.lte(0)) throw new Error('Amount must be > 0');
  const multiplier = new Prisma.Decimal(opts.wageringMultiplier ?? 2);
  if (multiplier.lt(1) || multiplier.gt(5)) throw new Error('wageringMultiplier must be in [1, 5]');

  return redeemPrisma(prisma).redeemCode.create({
    data: {
      code: codeUpper,
      amount,
      maxUses: opts.maxUses ?? null,
      expiresAt: opts.expiresAt ?? null,
      minAccountAgeHours: opts.minAccountAgeHours ?? null,
      maxAccountAgeHours: opts.maxAccountAgeHours ?? null,
      wageringMultiplier: multiplier,
      requiresMinDeposit: opts.requiresMinDeposit !== undefined && opts.requiresMinDeposit !== null
        ? new Prisma.Decimal(opts.requiresMinDeposit)
        : null,
      notes: opts.notes ?? null,
      createdBy: opts.createdBy,
    },
  });
}

/** Owner : disable a code (soft-delete). */
export async function disableCode(codeId: string): Promise<void> {
  await redeemPrisma(prisma).redeemCode.update({
    where: { id: codeId },
    data: { disabled: true },
  });
}
