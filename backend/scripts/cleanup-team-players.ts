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
  // 2026-05-02 prelaunch fix : safe full cascade — wipes the historical
  // CANCELLED matches that hold FK references to the orphan team players,
  // then drops the players. Aborts loudly if any of those matches still
  // carry bets / boResults so we don't silently destroy real data.
  const cascadeDelete = process.argv.includes('--cascade-delete-orphans');
  const mode = apply
    ? (cascadeDelete ? 'APPLY + CASCADE-DELETE' : (deletePlayers ? 'APPLY + DELETE' : 'APPLY'))
    : 'DRY-RUN';
  console.log(`\n[cleanup-team-players] mode = ${mode}\n`);

  // 1. Find offending players
  const players = await prisma.player.findMany({
    select: { id: true, name: true, _count: { select: { matchesAsPlayer1: true, matchesAsPlayer2: true } } },
  });
  const offenders = players.filter(p => TEAM_PATTERN.test(p.name));
  console.log(`Players matching team pattern : ${offenders.length}`);
  for (const p of offenders) {
    console.log(`  - ${p.name.padEnd(30)} (id=${p.id}, matches=${p._count.matchesAsPlayer1 + p._count.matchesAsPlayer2})`);
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

  // 4a. Cascade delete : drop the historical CANCELLED matches first so
  // the player FK refs evaporate, then delete the players themselves.
  // Refuses to touch any match that still has bets or boResults — those
  // are real data even if the player rows look like teams.
  if (cascadeDelete) {
    console.log(`\n[apply --cascade-delete-orphans] dropping historical matches + players…`);
    const offenderIds2 = offenders.map(o => o.id);
    const histMatches = await prisma.match.findMany({
      where: { OR: [{ player1Id: { in: offenderIds2 } }, { player2Id: { in: offenderIds2 } }] },
      select: { id: true, status: true, _count: { select: { bets: true, boResults: true } } },
    });
    const dirty = histMatches.filter(m => m._count.bets > 0 || m._count.boResults > 0);
    if (dirty.length > 0) {
      console.error(`\n🔴 Aborting cascade : ${dirty.length} match(es) still carry data :`);
      for (const m of dirty) console.error(`  - ${m.id} status=${m.status} bets=${m._count.bets} boResults=${m._count.boResults}`);
      console.error(`Manual review required. Re-run with --apply (no cascade) to leave the data alone.`);
      await prisma.$disconnect();
      process.exit(2);
    }
    let matchesDeleted = 0;
    let pmrDeleted = 0;
    let playersDeleted = 0;
    for (const m of histMatches) {
      await prisma.match.delete({ where: { id: m.id } });
      matchesDeleted++;
      console.log(`  ✓ deleted match ${m.id} (${m.status})`);
    }
    // Wipe PlayerMatchRecord rows referencing the orphans (both as player AND
    // as opponent). FK chain Player → PMR.playerId / PMR.opponentId requires
    // these to go before the player delete.
    for (const p of offenders) {
      const pmrCount = await prisma.playerMatchRecord.count({
        where: { OR: [{ playerId: p.id }, { opponentId: p.id }] },
      });
      if (pmrCount > 0) {
        const r = await prisma.playerMatchRecord.deleteMany({
          where: { OR: [{ playerId: p.id }, { opponentId: p.id }] },
        });
        pmrDeleted += r.count;
        console.log(`  ✓ deleted ${r.count} PMR row(s) referencing ${p.name}`);
      }
    }
    for (const p of offenders) {
      const remaining = await prisma.match.count({
        where: { OR: [{ player1Id: p.id }, { player2Id: p.id }] },
      });
      if (remaining === 0) {
        await prisma.player.delete({ where: { id: p.id } });
        playersDeleted++;
        console.log(`  ✓ deleted player ${p.name} (id=${p.id})`);
      } else {
        console.log(`  ⊘ kept player ${p.name} (id=${p.id}, ${remaining} matches still ref it — should not happen)`);
      }
    }
    console.log(`\n[apply --cascade-delete-orphans] result : ${matchesDeleted} matches + ${pmrDeleted} PMR rows + ${playersDeleted} players deleted.`);
  }

  // 4b. Optionally delete orphan players (non-cascade : skips when matches still reference them)
  if (deletePlayers && !cascadeDelete) {
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
