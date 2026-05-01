/**
 * Overnight Phase B — Read-only SQL audit (COINS_AUDIT_2026-04-23 §3).
 *
 * Runs the 7 audit queries via Prisma read-only. Dumps results JSON.
 *
 * USAGE :
 *   cd backend && npx tsx scripts/overnight-phase-b.ts
 *
 * Output : audit/OVERNIGHT_COINS_PHASE_B_2026-05-02.md
 */
import { PrismaClient } from '@prisma/client';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();

async function main() {
  const lines: string[] = [];
  const push = (s: string) => { lines.push(s); console.log(s); };
  const datestamp = '2026-05-02';

  push(`# Overnight — COINS_AUDIT Phase B Results (${datestamp})\n`);
  push(`Run from \`backend/scripts/overnight-phase-b.ts\` (read-only, $queryRaw).\n`);

  // Q1 — negative coins
  push(`\n## Q1 — Users with negative coins\n`);
  const q1 = await prisma.$queryRawUnsafe<any[]>(`
    SELECT id, username, coins, "totalWagered", "createdAt"
    FROM "User"
    WHERE coins < 0
    ORDER BY coins ASC
    LIMIT 50
  `);
  push(`Rows: **${q1.length}**\n`);
  if (q1.length > 0) {
    push(`\`\`\`json\n${JSON.stringify(q1, null, 2)}\n\`\`\``);
  } else {
    push(`✅ No user with negative balance — Bug #1 has no live exploit.`);
  }

  // Q2 — drift vs ledger
  push(`\n## Q2 — Balance drift vs ledger\n`);
  const q2 = await prisma.$queryRawUnsafe<any[]>(`
    WITH ledger AS (
      SELECT "userId", SUM(coins) AS net_ledger
      FROM "Transaction"
      WHERE status = 'completed'
      GROUP BY "userId"
    )
    SELECT u.id, u.username, u.coins AS current_coins,
           COALESCE(l.net_ledger, 0)::bigint AS ledger_net,
           (u.coins - COALESCE(l.net_ledger, 0))::bigint AS unexplained_delta
    FROM "User" u
    LEFT JOIN ledger l ON l."userId" = u.id
    WHERE ABS(u.coins - COALESCE(l.net_ledger, 0)) > 0
    ORDER BY ABS(u.coins - COALESCE(l.net_ledger, 0)) DESC
    LIMIT 30
  `);
  push(`Rows: **${q2.length}** (expected non-zero — Bug #4: bets/coinflip/jackpot/roulette/tip not in ledger)\n`);
  if (q2.length > 0) {
    push(`Top 30 by abs(unexplained_delta) :\n\`\`\`json\n${JSON.stringify(q2.map(r => ({
      ...r,
      ledger_net: typeof r.ledger_net === 'bigint' ? Number(r.ledger_net) : r.ledger_net,
      unexplained_delta: typeof r.unexplained_delta === 'bigint' ? Number(r.unexplained_delta) : r.unexplained_delta,
    })), null, 2)}\n\`\`\``);
  }

  // Q3 — bets PENDING on dead matches
  push(`\n## Q3 — PENDING bets on CANCELLED / past matches\n`);
  const q3 = await prisma.$queryRawUnsafe<any[]>(`
    SELECT b.id, b."userId", b."matchId", b.amount, b."createdAt",
           m.status AS match_status, m."scheduledAt"
    FROM "Bet" b
    JOIN "Match" m ON m.id = b."matchId"
    WHERE b.status = 'PENDING'
      AND (
        m.status IN ('CANCELLED','COMPLETED')
        OR m."scheduledAt" < NOW() - INTERVAL '24 hours'
      )
    ORDER BY m."scheduledAt" DESC
    LIMIT 50
  `);
  push(`Rows: **${q3.length}**\n`);
  if (q3.length > 0) {
    push(`⚠️ Orphan bets — should have been settled or refunded.\n\`\`\`json\n${JSON.stringify(q3, null, 2)}\n\`\`\``);
  } else {
    push(`✅ No orphan PENDING bets.`);
  }

  // Q4 — rain double-claims
  push(`\n## Q4 — Rain double-claims\n`);
  const q4 = await prisma.$queryRawUnsafe<any[]>(`
    SELECT "rainId", "userId", COUNT(*) AS claim_count
    FROM "RainParticipant"
    GROUP BY "rainId", "userId"
    HAVING COUNT(*) > 1
    LIMIT 20
  `);
  push(`Rows: **${q4.length}**\n`);
  if (q4.length > 0) {
    push(`🔴 UNIQUE constraint on (rainId,userId) is failing.\n\`\`\`json\n${JSON.stringify(q4.map(r => ({...r, claim_count: typeof r.claim_count === 'bigint' ? Number(r.claim_count) : r.claim_count })), null, 2)}\n\`\`\``);
  } else {
    push(`✅ Unique constraint holds.`);
  }

  // Q5a — affiliateCode.available negative
  push(`\n## Q5a — Affiliate available < 0\n`);
  const q5a = await prisma.$queryRawUnsafe<any[]>(`
    SELECT id, code, "userId", available, "totalEarnings"
    FROM "AffiliateCode"
    WHERE available < 0
    LIMIT 10
  `);
  push(`Rows: **${q5a.length}**\n`);
  if (q5a.length > 0) {
    push(`🔴 Negative affiliate balance — Bug #2 exploit signature.\n\`\`\`json\n${JSON.stringify(q5a, null, 2)}\n\`\`\``);
  } else {
    push(`✅ No negative affiliate available.`);
  }

  // Q5b — drift commission vs totalEarnings
  push(`\n## Q5b — AffiliateCode.totalEarnings drift vs sum(referral.commission)\n`);
  const q5b = await prisma.$queryRawUnsafe<any[]>(`
    SELECT ac.code,
           ac."totalEarnings"::bigint AS code_total,
           COALESCE(SUM(ar.commission), 0)::bigint AS referrals_sum,
           (ac."totalEarnings" - COALESCE(SUM(ar.commission), 0))::bigint AS drift
    FROM "AffiliateCode" ac
    LEFT JOIN "AffiliateReferral" ar ON ar."affiliateCodeId" = ac.id
    GROUP BY ac.id, ac.code, ac."totalEarnings"
    HAVING ac."totalEarnings" - COALESCE(SUM(ar.commission), 0) <> 0
    LIMIT 30
  `);
  push(`Rows: **${q5b.length}**\n`);
  if (q5b.length > 0) {
    push(`⚠️ Drift between AffiliateCode.totalEarnings and sum of referrals — Bug #3 signature.\n\`\`\`json\n${JSON.stringify(q5b.map(r => ({
      ...r,
      code_total: typeof r.code_total === 'bigint' ? Number(r.code_total) : r.code_total,
      referrals_sum: typeof r.referrals_sum === 'bigint' ? Number(r.referrals_sum) : r.referrals_sum,
      drift: typeof r.drift === 'bigint' ? Number(r.drift) : r.drift,
    })), null, 2)}\n\`\`\``);
  } else {
    push(`✅ No drift detected.`);
  }

  // Q6a — stuck SPINNING jackpots
  push(`\n## Q6a — Jackpot rounds stuck in SPINNING > 1 min\n`);
  const q6a = await prisma.$queryRawUnsafe<any[]>(`
    SELECT id, status, "createdAt", "closingAt", "winnerId", "netPayout"
    FROM "JackpotRound"
    WHERE status = 'SPINNING'
      AND "createdAt" < NOW() - INTERVAL '1 minute'
    LIMIT 20
  `);
  push(`Rows: **${q6a.length}**\n`);
  if (q6a.length > 0) {
    push(`⚠️ Stuck SPINNING rounds — boot-resume should have fired.\n\`\`\`json\n${JSON.stringify(q6a, null, 2)}\n\`\`\``);
  } else {
    push(`✅ No stuck SPINNING rounds.`);
  }

  // Q6b — completed rounds with weird payout
  push(`\n## Q6b — Completed rounds where netPayout != potTotal-rake\n`);
  const q6b = await prisma.$queryRawUnsafe<any[]>(`
    SELECT jr.id, jr."winnerId", jr."netPayout"::bigint AS "netPayout",
           jr."potTotal"::bigint AS "potTotal", jr.rake::bigint AS rake,
           (jr."potTotal" - jr.rake)::bigint AS expected_payout
    FROM "JackpotRound" jr
    WHERE jr.status = 'COMPLETED'
      AND jr."netPayout" IS NOT NULL
      AND jr."netPayout" <> (jr."potTotal" - jr.rake)
    LIMIT 30
  `);
  push(`Rows: **${q6b.length}**\n`);
  if (q6b.length > 0) {
    push(`⚠️ Mismatch netPayout vs potTotal-rake.\n\`\`\`json\n${JSON.stringify(q6b.map(r => ({
      ...r,
      netPayout: typeof r.netPayout === 'bigint' ? Number(r.netPayout) : r.netPayout,
      potTotal: typeof r.potTotal === 'bigint' ? Number(r.potTotal) : r.potTotal,
      rake: typeof r.rake === 'bigint' ? Number(r.rake) : r.rake,
      expected_payout: typeof r.expected_payout === 'bigint' ? Number(r.expected_payout) : r.expected_payout,
    })), null, 2)}\n\`\`\``);
  } else {
    push(`✅ All COMPLETED rounds have netPayout = potTotal - rake.`);
  }

  // Q7a — old pending withdrawals
  push(`\n## Q7a — Pending withdrawals > 48h\n`);
  const q7a = await prisma.$queryRawUnsafe<any[]>(`
    SELECT id, "userId", amount, coins, status, "createdAt"
    FROM "Transaction"
    WHERE type = 'withdrawal' AND status = 'pending'
      AND "createdAt" < NOW() - INTERVAL '48 hours'
    LIMIT 30
  `);
  push(`Rows: **${q7a.length}**\n`);
  if (q7a.length > 0) {
    push(`⚠️ Stale pending withdrawals.\n\`\`\`json\n${JSON.stringify(q7a, null, 2)}\n\`\`\``);
  } else {
    push(`✅ No old pending withdrawals.`);
  }

  // Q7b — failed withdrawals with negative coins (= still debited?)
  push(`\n## Q7b — Failed withdrawals (status=failed AND coins < 0)\n`);
  const q7b = await prisma.$queryRawUnsafe<any[]>(`
    SELECT id, "userId", amount, coins, status, "createdAt", "stripeSessionId"
    FROM "Transaction"
    WHERE type = 'withdrawal' AND status = 'failed'
      AND coins < 0
    ORDER BY "createdAt" DESC
    LIMIT 30
  `);
  push(`Rows: **${q7b.length}** (manual triage needed — schema stores withdrawal coins as negative; refund path should flip status while inverse credit happens elsewhere)\n`);
  if (q7b.length > 0) {
    push(`\`\`\`json\n${JSON.stringify(q7b, null, 2)}\n\`\`\``);
  }

  push(`\n---\n\nGenerated at ${new Date().toISOString()}.`);

  const outDir = join(process.cwd(), '..', 'audit');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `OVERNIGHT_COINS_PHASE_B_${datestamp}.md`);
  writeFileSync(outPath, lines.join('\n'));
  console.log(`\nWrote ${outPath}`);

  await prisma.$disconnect();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
