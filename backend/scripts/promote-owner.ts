/**
 * One-shot owner promotion script.
 *
 * Reads OWNER_USER_ID from the env, flips that user's `isOwner` flag
 * to `true`. Idempotent — re-running on an already-promoted user is a
 * no-op. Logs the action so we have an audit trail in the Railway logs.
 *
 * USAGE :
 *   1. Find your user_id (one of) :
 *        - Sign in to https://ageof.money, then call /api/v1/users/me
 *        - Or query Supabase :
 *            SELECT id, username, email FROM "User" WHERE email = 'matteo@…';
 *   2. Set OWNER_USER_ID in Railway env vars (Settings → Variables).
 *      No need to redeploy — Railway propagates env to running pods.
 *   3. Run from the Railway shell (or locally with the pooler URL) :
 *        cd backend && npx tsx scripts/promote-owner.ts
 *   4. Sign out + sign in to refresh your JWT with isOwner=true. The
 *      middleware checks the JWT claim, not a live DB read, so old
 *      tokens won't gain owner power until renewal.
 *
 * SECURITY NOTE :
 *   - Owner is strictly above admin. Owner-only endpoints :
 *       POST   /api/v1/admin/redeem-codes    (mint codes)
 *       PATCH  /api/v1/admin/redeem-codes/:id/disable
 *       …and any future requireOwner-gated route.
 *   - Every non-owner attempt at an owner route is logged at warn level
 *     by the requireOwner middleware. Look for `[Security] Non-owner
 *     tried owner-gated route` in Railway logs to catch probing.
 *
 * SCRIPT IS SAFE TO RUN MULTIPLE TIMES.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const ownerUserId = process.env.OWNER_USER_ID;
  if (!ownerUserId) {
    console.error('❌ OWNER_USER_ID env var not set.');
    console.error('   Set it in Railway → Variables, then re-run this script.');
    process.exit(1);
  }

  const before = await prisma.user.findUnique({
    where: { id: ownerUserId },
    select: { id: true, username: true, email: true, isOwner: true, isAdmin: true },
  });
  if (!before) {
    console.error(`❌ User ${ownerUserId} not found in DB.`);
    console.error('   Verify OWNER_USER_ID matches an actual User.id row.');
    process.exit(1);
  }

  if (before.isOwner) {
    console.log(`✅ User ${before.id} (${before.username ?? 'no username'}) is already owner — no change.`);
    return;
  }

  // Owner implies admin — promote both for safety.
  const after = await prisma.user.update({
    where: { id: ownerUserId },
    data: { isOwner: true, isAdmin: true },
    select: { id: true, username: true, email: true, isOwner: true, isAdmin: true },
  });

  console.log(`✅ User ${after.id} (${after.username ?? 'no username'}, ${after.email ?? 'no email'}) is now owner.`);
  console.log(`   isOwner=${after.isOwner}, isAdmin=${after.isAdmin}`);
  console.log('');
  console.log('⚠️  Sign out + sign back in on the website to mint a fresh JWT with isOwner=true.');
  console.log('   The requireOwner middleware reads the JWT claim, not the live DB row.');
}

main()
  .catch((e) => {
    console.error('❌ Script failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
