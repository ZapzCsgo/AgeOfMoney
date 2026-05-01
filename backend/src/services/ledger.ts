/**
 * Coin ledger helper — see audit/COINS_AUDIT_2026-04-23.md Bug #4.
 *
 * Wraps `tx.transaction.create` with the canonical "completed game tx" shape
 * so every coin-moving flow (bets, coinflip, jackpot, roulette, tips,
 * affiliate claim, admin adjust) writes a Transaction row inside its
 * existing `$transaction`. This makes `SUM(Transaction.coins)` per user
 * an authoritative balance snapshot — admin finance KPIs and user-facing
 * historique financier both consume this table.
 *
 * Conventions :
 *   - `coins` is signed : negative for debits (stake placed, withdraw),
 *     positive for credits (winnings, refund, deposit, tip in).
 *   - `type` is a free-text string (the `Transaction.type` column has no
 *     enum constraint in the Prisma schema). Stick to the values in
 *     `LedgerType` to keep `SUM(coins) GROUP BY type` analytics clean.
 *   - `status` is always `'completed'` for ledger rows written here. The
 *     legacy `pending → completed` flow is reserved for deposits / withdrawals
 *     where an external state machine governs the row.
 *
 * No row is written when coins == 0 (e.g. a LOST bet : the stake was already
 * debited at place-time, the loss itself is a no-op for the user's balance).
 *
 * IMPORTANT : pass the `tx` instance from inside a `prisma.$transaction(async tx => …)`
 * block. Calling this from outside a transaction is allowed — pass `prisma`
 * itself — but you lose the "ledger row + balance update share atomicity"
 * guarantee. Every existing call site already wraps coin moves in a
 * `$transaction`; ride along.
 */
import type { Prisma, PrismaClient } from '@prisma/client';

export type LedgerClient = PrismaClient | Prisma.TransactionClient;

export type LedgerType =
  // bets
  | 'bet_placed' | 'bet_won' | 'bet_refund'
  // coinflip
  | 'coinflip_stake' | 'coinflip_win' | 'coinflip_refund'
  // jackpot
  | 'jackpot_stake' | 'jackpot_win' | 'jackpot_refund'
  // roulette
  | 'roulette_stake' | 'roulette_win'
  // tip (sender + recipient pair)
  | 'tip_out' | 'tip_in'
  // affiliate
  | 'affiliate_claim'
  // admin
  | 'admin_adjust';

export interface LedgerArgs {
  userId: string;
  type: LedgerType;
  /** Signed delta. Negative = debit (stake/tip out/withdrawal). Positive = credit (win/refund/tip in/claim). */
  coins: number;
}

export async function recordLedger(client: LedgerClient, { userId, type, coins }: LedgerArgs): Promise<void> {
  if (coins === 0) return;
  await client.transaction.create({
    data: {
      userId,
      type,
      amount: 0,           // virtual coin transactions don't carry a fiat side
      realAmount: null,
      coins,
      status: 'completed',
    },
  });
}
