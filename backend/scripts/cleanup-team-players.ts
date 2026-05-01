/**
 * cleanup-team-players.ts
 *
 * One-shot remediation for OVERNIGHT_REPORT_2026-05-02 Bug #1.
 *
 * The team-name filter in `liquipediaScraper.ts` lost its `/i` flag in a
 * recent commit (since restored), which let team-org names like
 * "Team Vitality" or "Onimaru Esports" through and create Player rows.
 * Affected matches showed up as 1v1 cards on the home page.
 *
 * This script :
 *   1. Identifies Player rows whose name matches the team pattern
 *      (case-insensitive).
 *   2. Cancels (status=CANCELLED + refundBets) any UPCOMING/LIVE Match
 *      involving such players. Refunds users via the standard refundBets
 *      service so the ledger row is also written.
 *   3. Reports affected players + matches.
 *   4. Does NOT delete the Player rows by default — they may be linked
 *      to historical matches we don't want to break. Pass --delete-players
 *      to also remove orphan players (no matches left).
 *
 * Usage :
 *   cd backend && SKIP_SERVER=1 npx tsx scripts/cleanup-team-players.ts          # dry-run
 *   cd backend && SKIP_SERVER=1 npx tsx scripts/cleanup-team-players.ts --apply  # actually cancel + refund
 *   cd backend && SKIP_SERVER=1 npx tsx scripts/cleanup-team-players.ts --apply --delete-players
 */
process.env.SKIP_SERVER = '1';

import { prisma } from '../src/index';
import { refundBets } from '../src/services/betService';

const TEAM_PATTERN = /^team\s+|esports?\s*[ab]?$|\s+esports?$|esports?\s+[ab]$|\s+[AB]$/i;

async function main() {
  const apply = process.argv.includes('--apply');
  const deletePlayers = process.argv.includes('--delete-players');
  const mode = apply ? (deletePlayers ? 'APPLY + DELETE' : 'APPLY') : 'DRY-RUN';
  console.log(`\n[cleanup-team-players] mode = ${mode}\n`);

  // 1. Find offending players
  const players = await prisma.player.findMany({
    select: { id: true, name: true, _count: { select: { matchesAsP1: true, matchesAsP2: true } } },
  });
  const offenders = players.filter(p => TEAM_PATTERN.test(p.name));
  console.log(`Players matching team pattern : ${offenders.length}`);
  for (const p of offenders) {
    console.log(`  - ${p.name.padEnd(30)} (id=${p.id}, matches=${p._count.matchesAsP1 + p._count.matchesAsP2})`);
  }
  if (offenders.length === 0) {
    console.log('\n✅ Nothing to clean.');
    await prisma.$disconnect();
    return;
  }

  // 2. Find live/upcoming matches involving them
  const offenderIds = offenders.map(p => p.id);
  const matches = await prisma.match.findMany({
    where: {
      OR: [
        { player1Id: { in: offenderIds } },
        { player2Id: { in: offenderIds } },
      ],
      status: { in: ['UPCOMING', 'LIVE'] },
    },
    select: {
      id: true, status: true, scheduledAt: true,
      player1: { select: { name: true } },
      player2: { select: { name: true } },
      tournament: { select: { name: true } },
      _count: { select: { bets: true } },
    },
  });
  console.log(`\nLive/upcoming matches involving these : ${matches.length}`);
  for (const m of matches) {
    console.log(`  - ${m.id} | ${m.player1.name} vs ${m.player2.name} | ${m.tournament?.name ?? '?'} | bets=${m._count.bets} | ${m.status}`);
  }

  if (!apply) {
    console.log('\nDry-run — re-run with --apply to cancel + refund.');
    await prisma.$disconnect();
    return;
  }

  // 3. Cancel each match (refundBets emits coinsUpdate + writes bet_refund ledger row)
  for (const m of matches) {
    console.log(`\n[apply] cancelling ${m.id} (${m.player1.name} vs ${m.player2.name})…`);
    await prisma.match.update({ where: { id: m.id }, data: { status: 'CANCELLED' } });
    await refundBets(m.id, 'Match invalide — équipe et non joueur individuel');
    console.log(`  ✓ cancelled + refunded ${m._count.bets} bet(s)`);
  }

  // 4. Optionally delete orphan players
  if (deletePlayers) {
    console.log(`\n[apply --delete-players] deleting offender players that have no remaining matches…`);
    let deleted = 0;
    for (const p of offenders) {
      const remaining = await prisma.match.count({
        where: { OR: [{ player1Id: p.id }, { player2Id: p.id }] },
      });
      if (remaining === 0) {
        await prisma.player.delete({ where: { id: p.id } });
        deleted++;
        console.log(`  ✓ deleted ${p.name} (id=${p.id})`);
      } else {
        console.log(`  ⊘ kept ${p.name} (id=${p.id}, ${remaining} historical matches)`);
      }
    }
    console.log(`Deleted ${deleted}/${offenders.length} offender players.`);
  } else {
    console.log(`\nPlayers kept (no --delete-players). Re-run with --delete-players to also drop orphan rows.`);
  }

  console.log('\n✅ Done.');
  await prisma.$disconnect();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
