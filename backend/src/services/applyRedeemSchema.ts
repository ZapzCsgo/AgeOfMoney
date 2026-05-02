/**
 * One-shot, idempotent boot-time migration for the redeem-codes feature.
 *
 * Why a runtime migration : the project's documented schema-apply path is
 * `npx prisma db push --accept-data-loss`, but my local machine can't
 * reach Supabase on port 5432 (IPv6-only after the recent direct-connect
 * deprecation), and the pooler URL lives in Railway env vars only — not
 * pullable from my dev shell. Rather than ship credentials around, we
 * have the running backend (which already has a working DATABASE_URL)
 * apply the schema diff itself the first time it boots after a redeem
 * code change deploy.
 *
 * Idempotency :
 *   - Every CREATE uses `IF NOT EXISTS`.
 *   - The `ALTER TABLE` uses `ADD COLUMN IF NOT EXISTS`.
 *   - Index `CREATE` uses `IF NOT EXISTS`.
 *   - Foreign-key `ADD CONSTRAINT` is wrapped in a DO/EXCEPTION block
 *     because Postgres has no `IF NOT EXISTS` for FKs.
 *
 * Idempotent + safe to call on every boot. After a future `prisma
 * generate` ships and the schema is universally in sync, this hook
 * becomes a pure no-op (information_schema check returns true → exit).
 *
 * The whole thing runs in a transaction so a failure mid-way leaves the
 * DB in the pre-migration state.
 */
import { prisma } from '../index';
import logger from '../logger';

const SQL = `
DO $migration$
BEGIN
  -- 1. User extensions ─────────────────────────────────────────────────
  ALTER TABLE "User"
    ADD COLUMN IF NOT EXISTS "redeemLockedBalance"   DECIMAL(20, 8) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "totalWageringProgress" DECIMAL(20, 8) NOT NULL DEFAULT 0;

  -- 2. RedeemCode ─────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS "RedeemCode" (
      "id"                    TEXT           NOT NULL,
      "code"                  VARCHAR(20)    NOT NULL,
      "amount"                DECIMAL(20, 8) NOT NULL,
      "maxUses"               INTEGER,
      "currentUses"           INTEGER        NOT NULL DEFAULT 0,
      "expiresAt"             TIMESTAMP(3),
      "minAccountAgeHours"    INTEGER,
      "maxAccountAgeHours"    INTEGER,
      "wageringMultiplier"    DECIMAL(3, 1)  NOT NULL DEFAULT 2.0,
      "requiresMinDeposit"    DECIMAL(20, 8),
      "createdBy"             TEXT           NOT NULL,
      "notes"                 TEXT,
      "disabled"              BOOLEAN        NOT NULL DEFAULT false,
      "createdAt"             TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"             TIMESTAMP(3)   NOT NULL,
      CONSTRAINT "RedeemCode_pkey" PRIMARY KEY ("id")
  );

  CREATE UNIQUE INDEX IF NOT EXISTS "RedeemCode_code_key"             ON "RedeemCode"("code");
  CREATE INDEX        IF NOT EXISTS "RedeemCode_code_idx"             ON "RedeemCode"("code");
  CREATE INDEX        IF NOT EXISTS "RedeemCode_disabled_expiresAt_idx" ON "RedeemCode"("disabled", "expiresAt");

  BEGIN
    ALTER TABLE "RedeemCode"
      ADD CONSTRAINT "RedeemCode_createdBy_fkey"
      FOREIGN KEY ("createdBy") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- 3. RedeemCodeRedemption ───────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS "RedeemCodeRedemption" (
      "id"               TEXT           NOT NULL,
      "codeId"           TEXT           NOT NULL,
      "userId"           TEXT           NOT NULL,
      "amount"           DECIMAL(20, 8) NOT NULL,
      "wageringRequired" DECIMAL(20, 8) NOT NULL,
      "wageringStartAt"  DECIMAL(20, 8) NOT NULL,
      "unlocked"         BOOLEAN        NOT NULL DEFAULT false,
      "ipHash"           TEXT,
      "userAgent"        TEXT,
      "redeemedAt"       TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "unlockedAt"       TIMESTAMP(3),
      CONSTRAINT "RedeemCodeRedemption_pkey" PRIMARY KEY ("id")
  );

  CREATE UNIQUE INDEX IF NOT EXISTS "RedeemCodeRedemption_codeId_userId_key"   ON "RedeemCodeRedemption"("codeId", "userId");
  CREATE INDEX        IF NOT EXISTS "RedeemCodeRedemption_userId_unlocked_idx" ON "RedeemCodeRedemption"("userId", "unlocked");
  CREATE INDEX        IF NOT EXISTS "RedeemCodeRedemption_codeId_idx"          ON "RedeemCodeRedemption"("codeId");
  CREATE INDEX        IF NOT EXISTS "RedeemCodeRedemption_ipHash_redeemedAt_idx" ON "RedeemCodeRedemption"("ipHash", "redeemedAt");

  BEGIN
    ALTER TABLE "RedeemCodeRedemption"
      ADD CONSTRAINT "RedeemCodeRedemption_codeId_fkey"
      FOREIGN KEY ("codeId") REFERENCES "RedeemCode"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    ALTER TABLE "RedeemCodeRedemption"
      ADD CONSTRAINT "RedeemCodeRedemption_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END
$migration$;
`;

let applied = false;

export async function applyRedeemSchemaIfNeeded(): Promise<void> {
  if (applied) return;
  try {
    // Cheap check first — most boots after the initial one are no-ops.
    const rows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'RedeemCode'
       ) AS exists`,
    );
    if (rows[0]?.exists) {
      applied = true;
      return; // already migrated, nothing to do
    }

    logger.info('[Migration:redeem] Applying schema (RedeemCode + RedeemCodeRedemption + User cols)…');
    await prisma.$executeRawUnsafe(SQL);
    applied = true;
    logger.info('[Migration:redeem] ✅ Schema applied successfully');
  } catch (err) {
    logger.error('[Migration:redeem] ❌ Failed to apply schema:', err);
    // Don't crash the boot — the redeem feature will just 500 on use
    // and an alert can be raised. Other features keep working.
  }
}
