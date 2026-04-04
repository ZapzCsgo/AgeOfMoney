/**
 * Standalone enrichment script — runs without starting the HTTP server.
 */
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { calculateOddsFromPlayers } from '../src/services/oddsEngine';

const prisma = new PrismaClient();
const AOE4WORLD_BASE = 'https://aoe4world.com/api/v0';

async function fetchApi<T>(path: string): Promise<T | null> {
  try {
    const res = await axios.get<T>(`${AOE4WORLD_BASE}${path}`, {
      headers: { 'User-Agent': 'AoE4Bet/1.0', Accept: 'application/json' },
      timeout: 10000,
    });
    return res.data;
  } catch {
    return null;
  }
}

async function searchAoe4WorldId(name: string, slug: string): Promise<string | null> {
  const trySearch = async (q: string) => {
    const r = await fetchApi<{ players: Array<{ profile_id: number; name: string }> }>(
      `/players/search?query=${encodeURIComponent(q)}&limit=10`
    );
    const exact = r?.players.find(p => p.name.toLowerCase() === q.toLowerCase());
    if (exact) return String(exact.profile_id);
    const partial = r?.players.find(p =>
      p.name.toLowerCase().includes(q.toLowerCase()) || q.toLowerCase().includes(p.name.toLowerCase())
    );
    return partial ? String(partial.profile_id) : null;
  };
  return (await trySearch(name)) ?? (await trySearch(decodeURIComponent(slug).replace(/_/g, ' '))) ?? null;
}

async function getPlayerDbStats(playerId: string, excludeMatchId: string) {
  const matches = await prisma.match.findMany({
    where: {
      status: 'COMPLETED', winnerId: { not: null },
      OR: [{ player1Id: playerId }, { player2Id: playerId }],
      NOT: { id: excludeMatchId },
    },
    orderBy: { scheduledAt: 'desc' },
    take: 50,
    select: { winnerId: true, scheduledAt: true },
  });
  const total = matches.length;
  const wins = matches.filter(m => m.winnerId === playerId).length;
  const winrate = total > 0 ? wins / total : 0.5;

  let streak = 0;
  for (const m of matches) {
    const won = m.winnerId === playerId;
    if (streak === 0) { streak = won ? 1 : -1; }
    else if (streak > 0 && won) { streak++; }
    else if (streak < 0 && !won) { streak--; }
    else break;
  }
  const daysSince = matches[0]
    ? (Date.now() - new Date(matches[0].scheduledAt).getTime()) / 86400000
    : 30;
  return { winrate, totalGames: total, streak, daysSince };
}

async function main() {
  const matches = await prisma.match.findMany({
    where: { status: { in: ['UPCOMING', 'LIVE'] } },
    include: {
      player1: { select: { id: true, name: true, liquipediaSlug: true, aoe4worldId: true, elo: true, winrate: true, totalGames: true, currentStreak: true, peakElo: true, lastMatchAt: true } },
      player2: { select: { id: true, name: true, liquipediaSlug: true, aoe4worldId: true, elo: true, winrate: true, totalGames: true, currentStreak: true, peakElo: true, lastMatchAt: true } },
    },
  });

  console.log(`Enriching ${matches.length} matches...`);

  for (const match of matches) {
    // Resolve aoe4world IDs if missing
    for (const player of [match.player1, match.player2]) {
      if (!player.aoe4worldId) {
        const id = await searchAoe4WorldId(player.name, player.liquipediaSlug);
        if (id) {
          // Fetch stats
          const stats = await fetchApi<any>(`/players/${id}`);
          const rm = stats?.modes?.rm_1v1;
          await prisma.player.update({
            where: { id: player.id },
            data: {
              aoe4worldId: id,
              lastUpdatedAt: new Date(),
              ...(rm?.win_rate ? { winrate: rm.win_rate / 100 } : {}),
              ...(rm?.games_count ? { totalGames: rm.games_count } : {}),
              ...(rm?.streak !== undefined ? { currentStreak: rm.streak } : {}),
              ...(rm?.rating ? { elo: rm.rating } : {}),
              ...(rm?.max_rating ? { peakElo: rm.max_rating } : {}),
              ...(rm?.last_game_at ? { lastMatchAt: new Date(rm.last_game_at) } : {}),
              ...(stats?.country ? { country: stats.country } : {}),
              ...(stats?.avatars?.medium ? { avatarUrl: stats.avatars.medium } : {}),
            },
          });
          // Update local copy for odds calc
          Object.assign(player, { aoe4worldId: id, winrate: rm?.win_rate ? rm.win_rate / 100 : player.winrate, totalGames: rm?.games_count ?? player.totalGames, currentStreak: rm?.streak ?? player.currentStreak });
          console.log(`  Linked ${player.name} → aoe4world #${id} (wr=${rm?.win_rate}% games=${rm?.games_count})`);
          await new Promise(r => setTimeout(r, 600));
        }
      }
    }

    // Get DB stats
    const [db1, db2] = await Promise.all([
      getPlayerDbStats(match.player1Id, match.id),
      getPlayerDbStats(match.player2Id, match.id),
    ]);

    // Build merged profiles
    const buildProfile = (p: typeof match.player1, db: typeof db1) => {
      const hasAoe4 = (p.totalGames ?? 0) >= 20;
      if (hasAoe4) {
        const dbW = db.totalGames >= 5 ? 0.6 : 0.3;
        return {
          winrate: db.winrate * dbW + (p.winrate ?? 0.5) * (1 - dbW),
          totalGames: Math.max(db.totalGames, p.totalGames ?? 0),
          streak: db.totalGames >= 3 ? db.streak : (p.currentStreak ?? 0),
          daysSince: db.totalGames >= 1 ? db.daysSince : (p.lastMatchAt ? (Date.now() - p.lastMatchAt.getTime()) / 86400000 : 30),
        };
      }
      return { winrate: db.winrate, totalGames: db.totalGames, streak: db.streak, daysSince: db.daysSince };
    };

    const prof1 = buildProfile(match.player1, db1);
    const prof2 = buildProfile(match.player2, db2);

    // H2H from DB
    const dbH2H = await prisma.match.findMany({
      where: {
        status: 'COMPLETED', winnerId: { not: null },
        OR: [
          { player1Id: match.player1Id, player2Id: match.player2Id },
          { player1Id: match.player2Id, player2Id: match.player1Id },
        ],
        NOT: { id: match.id },
      },
      orderBy: { scheduledAt: 'desc' },
      take: 20,
      select: { player1Id: true, winnerId: true },
    });
    const h2h = dbH2H.map(m => ({ winner: m.winnerId === match.player1Id ? 1 as const : 2 as const }));

    const newOdds = calculateOddsFromPlayers(
      { elo: match.player1.elo, winrate: prof1.winrate, totalGames: prof1.totalGames, currentStreak: prof1.streak, peakElo: match.player1.peakElo, lastMatchAt: prof1.daysSince < 999 ? new Date(Date.now() - prof1.daysSince * 86400000) : null },
      { elo: match.player2.elo, winrate: prof2.winrate, totalGames: prof2.totalGames, currentStreak: prof2.streak, peakElo: match.player2.peakElo, lastMatchAt: prof2.daysSince < 999 ? new Date(Date.now() - prof2.daysSince * 86400000) : null },
      h2h,
    );

    await prisma.match.update({ where: { id: match.id }, data: { odds1: newOdds.odds1, odds2: newOdds.odds2 } });

    const changed = newOdds.odds1 !== 1.9 || newOdds.odds2 !== 1.9;
    console.log(
      `${changed ? '✓' : '·'} ${match.player1.name}(wr=${(prof1.winrate*100).toFixed(0)}%/${prof1.totalGames}g) vs ${match.player2.name}(wr=${(prof2.winrate*100).toFixed(0)}%/${prof2.totalGames}g) H2H=${h2h.length} → ${newOdds.odds1} / ${newOdds.odds2}`
    );
  }

  console.log('\nDone!');
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
