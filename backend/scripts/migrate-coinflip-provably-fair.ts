/**
 * migrate-coinflip-provably-fair.ts
 *
 * Idempotent migration: adds `clientSeed` (nullable TEXT) and `nonce` (INT
 * default 0) to the `CoinFlip` table if they are missing. Safe to re-run.
 *
 * Run:   cd backend && SKIP_SERVER=1 DATABASE_URL='<pooler>' npx tsx scripts/migrate-coinflip-provably-fair.ts
 */

process.env.SKIP_SERVER = '1';

import { prisma } from '../src/index';

async function main() {
  console.log('[migrate] adding CoinFlip.clientSeed / CoinFlip.nonce if missing…');

  // ADD COLUMN IF NOT EXISTS works on Postgres 9.6+ — Supabase is 15.
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "CoinFlip" ADD COLUMN IF NOT EXISTS "clientSeed" TEXT`
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "CoinFlip" ADD COLUMN IF NOT EXISTS "nonce" INTEGER NOT NULL DEFAULT 0`
  );

  const cols = await prisma.$queryRawUnsafe<Array<{ column_name: string; data_type: string; is_nullable: string }>>(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns
     WHERE table_name = 'CoinFlip' AND column_name IN ('clientSeed', 'nonce')`
  );
  console.log('[migrate] verified columns:', cols);
  console.log('[migrate] done');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('[migrate] FAILED:', err);
  await prisma.$disconnect();
  process.exit(1);
});
