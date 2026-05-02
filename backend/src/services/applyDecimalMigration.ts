/**
 * One-shot, idempotent boot-time migration converting all coin-amount
 * columns from Int → Decimal(20, 8). Same operational pattern as
 * applyRedeemSchema.ts (local CLI can't reach Supabase port 5432).
 *
 * Why this matters : every `Math.floor(amount * odds)` in the codebase
 * silently truncated fractional coins. Bet 4 ⚜ at 1.85 odds → payout
 * was 7 instead of 7.40. With 0 real users at deploy time, doing the
 * hard cutover NOW is the cleanest path : every existing Int row casts
 * losslessly to Decimal(20, 8) (`column::numeric`), so values stay
 * identical but future writes can carry sub-coin precision.
 *
 * Idempotency : every ALTER COLUMN is gated by an information_schema
 * check that compares the current data type. If it's already `numeric`,
 * the statement is skipped. So second-and-subsequent boots are a no-op.
 *
 * The whole batch is wrapped in a single DO block so a partial failure
 * doesn't leave the schema half-converted. If any column conversion
 * fails, the whole transaction rolls back.
 *
 * NOT changed : `Transaction.amount` (USD cents — ground truth from
 * payment processor, kept Int), `JackpotBet.ticketFrom/ticketTo` (audit
 * range in coin units, derived from Decimal `amount`), `Match` scoring
 * counters (BO numbers, not money), Player ELO (rating, not money),
 * Rain `duration` and `maxParticipants` (counts, not money).
 */
import { prisma } from '../index';
import logger from '../logger';

interface ColumnTarget {
  table: string;
  column: string;
}

const TARGETS: ColumnTarget[] = [
  // User
  { table: 'User', column: 'coins' },
  { table: 'User', column: 'totalWagered' },
  // Bet
  { table: 'Bet', column: 'amount' },
  { table: 'Bet', column: 'payout' },
  // Transaction (the coins delta — `amount` stays Int = USD cents)
  { table: 'Transaction', column: 'coins' },
  // RouletteBet
  { table: 'RouletteBet', column: 'amount' },
  { table: 'RouletteBet', column: 'payout' },
  // CoinFlip
  { table: 'CoinFlip', column: 'amount' },
  { table: 'CoinFlip', column: 'rake' },
  // JackpotRound
  { table: 'JackpotRound', column: 'potTotal' },
  { table: 'JackpotRound', column: 'rake' },
  { table: 'JackpotRound', column: 'netPayout' },
  // JackpotBet (ticketFrom/ticketTo intentionally stay Int)
  { table: 'JackpotBet', column: 'amount' },
  // AffiliateCode
  { table: 'AffiliateCode', column: 'totalEarnings' },
  { table: 'AffiliateCode', column: 'available' },
  // AffiliateReferral
  { table: 'AffiliateReferral', column: 'totalDeposited' },
  { table: 'AffiliateReferral', column: 'totalWagered' },
  { table: 'AffiliateReferral', column: 'commission' },
  { table: 'AffiliateReferral', column: 'netLossBalance' },
  // Rain
  { table: 'Rain', column: 'amount' },
  { table: 'Rain', column: 'actualPerUser' },
  // RainParticipant
  { table: 'RainParticipant', column: 'coinsReceived' },
];

let applied = false;

export async function applyDecimalMigrationIfNeeded(): Promise<void> {
  if (applied) return;

  // Quick batch check : how many of our targets are still Int / bigint ?
  const rows = await prisma.$queryRawUnsafe<Array<{ table_name: string; column_name: string; data_type: string }>>(
    `SELECT table_name, column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (table_name, column_name) IN (${TARGETS.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ')})`,
    ...TARGETS.flatMap((t) => [t.table, t.column]),
  );
  const stillInt = rows.filter((r) => r.data_type === 'integer' || r.data_type === 'bigint');
  if (stillInt.length === 0) {
    applied = true;
    return; // every targeted column is already numeric — boot hook no-op
  }

  logger.info(`[Migration:decimal] Converting ${stillInt.length} coin column(s) Int → Decimal(20, 8)…`);
  for (const { table_name, column_name } of stillInt) {
    logger.info(`  · ${table_name}.${column_name}`);
  }

  // Build the ALTER statements only for the columns that actually need it.
  // Each statement is independently safe — `USING column::numeric` casts
  // every existing Int value to its exact Decimal equivalent (10 → 10.0).
  // Wrapped in a DO/exception so any individual failure rolls back the
  // whole batch without leaving the schema in a half-mixed state.
  const stmts = stillInt
    .map(({ table_name, column_name }) =>
      `ALTER TABLE "${table_name}" ALTER COLUMN "${column_name}" TYPE DECIMAL(20, 8) USING ("${column_name}"::numeric);`
    )
    .join('\n  ');

  const sql = `
DO $migration$
BEGIN
  ${stmts}
END
$migration$;
  `;

  try {
    await prisma.$executeRawUnsafe(sql);
    applied = true;
    logger.info('[Migration:decimal] ✅ All coin columns now Decimal(20, 8)');
  } catch (err) {
    logger.error('[Migration:decimal] ❌ Failed to convert columns:', err);
    // Don't crash the boot — the existing Int code paths still work,
    // payouts will still be floor-truncated until the next boot's
    // attempt succeeds.
  }
}
