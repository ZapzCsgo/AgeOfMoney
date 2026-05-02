/**
 * Coin-amount helpers — every coin column in schema.prisma is Decimal(20, 8).
 *
 *   D(x) → coerce anything (Decimal | number | string | null) into a fresh
 *          Prisma.Decimal. Use INSIDE arithmetic chains where precision
 *          matters (payouts, balance updates, multipliers).
 *
 *   N(x) → coerce a Decimal | number | null back into a JS number. Use AT
 *          boundaries : socket.io emits, JSON-serialised API responses
 *          (when the receiver still expects number), affiliate revshare
 *          inputs (the affiliate service still types in number).
 *
 *   `JSON.stringify` of a Prisma.Decimal already serialises to a number
 *   thanks to the `Decimal.prototype.toJSON` override in index.ts, so
 *   `res.json(prismaQueryResult)` works out of the box without any N()
 *   coercion. N() is for places that DO arithmetic on the value before
 *   serialising — those need a real number.
 */
import { Prisma } from '@prisma/client';

type CoinIn = Prisma.Decimal | number | string | null | undefined;

export const D = (v: CoinIn): Prisma.Decimal =>
  v === null || v === undefined
    ? new Prisma.Decimal(0)
    : v instanceof Prisma.Decimal
      ? v
      : new Prisma.Decimal(v);

export const N = (v: CoinIn): number => {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Number(v);
  // Prisma.Decimal — `.toString()` then Number is the safest path :
  // `Number(decimal)` works in practice but TS sees Decimal's valueOf
  // typing as unknown.
  return Number(v.toString());
};
