/**
 * Event Opportunities cleanup — dismisses every EventSuggestion whose
 * ruleType is NOT in the v2 canonical list.
 *
 * Run in dry-run (default) first to audit what would move :
 *   npx ts-node scripts/cleanup-event-suggestions.ts
 *
 * Apply with :
 *   npx ts-node scripts/cleanup-event-suggestions.ts --live
 *
 * DISMISSED rows get dismissedUntil set to now + 365 days — practically
 * "forever" without dropping audit history. If a legacy ruleType ever
 * comes back we can just UPDATE dismissedUntil to now-1 to resurface it.
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Kept in v2. Anything outside this set gets dismissed.
const V2_RULE_TYPES = new Set<string>([
  'CONCURRENT_SPIKE',
  'VOLUME_BURST',
  'CHAT_ON_FIRE',
  'S_TIER_INCOMING',
  'LIVE_EVENT_IN_PROGRESS',
  'TOURNAMENT_FINAL_NEAR',
  'WEEKEND_MOMENTUM',
  'SIGNUP_BURST_WITH_SOURCE',
]);

async function main() {
  const live = process.argv.includes('--live');
  console.log(`[cleanup-event-suggestions] mode = ${live ? 'LIVE' : 'DRY-RUN'}`);

  // Fetch only rows that are still "active" (NEW/SEEN/ACTED or DISMISSED
  // with an expiring dismissedUntil that's in the future but for a legacy
  // ruleType — still noise).
  const active = await prisma.eventSuggestion.findMany({
    where: { status: { in: ['NEW', 'SEEN', 'ACTED'] } },
    select: { id: true, ruleType: true, subjectKey: true, status: true, title: true, createdAt: true },
  });

  const obsolete = active.filter((s) => !V2_RULE_TYPES.has(s.ruleType));

  console.log(`Total active rows : ${active.length}`);
  console.log(`Obsolete ruleType count : ${obsolete.length}`);

  if (obsolete.length === 0) {
    console.log('Nothing to clean up — base is already v2-compliant.');
    await prisma.$disconnect();
    return;
  }

  // Breakdown by ruleType for the audit trail
  const byType = new Map<string, number>();
  for (const s of obsolete) byType.set(s.ruleType, (byType.get(s.ruleType) ?? 0) + 1);
  console.log('\nBreakdown by legacy ruleType :');
  for (const [t, n] of Array.from(byType.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t.padEnd(30)} ${n}`);
  }

  if (!live) {
    console.log('\nDRY-RUN — no writes performed. Re-run with --live to apply.');
    await prisma.$disconnect();
    return;
  }

  // Apply : dismiss for 365 days
  const dismissUntil = new Date(Date.now() + 365 * 86_400_000);
  const res = await prisma.eventSuggestion.updateMany({
    where: {
      status: { in: ['NEW', 'SEEN', 'ACTED'] },
      ruleType: { notIn: Array.from(V2_RULE_TYPES) },
    },
    data: {
      status: 'DISMISSED',
      dismissedUntil: dismissUntil,
      actedNote: 'Legacy v1 ruleType — auto-dismissed by cleanup-event-suggestions.ts',
    },
  });

  console.log(`\n✅ ${res.count} legacy suggestions dismissed (dismissedUntil = ${dismissUntil.toISOString().slice(0, 10)}).`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('[cleanup-event-suggestions] failed:', err);
  process.exit(1);
});
