/**
 * Real-time match verifier — polls aoe4world.com every 15s for LIVE matches.
 *
 * Uses H2H game list (not just /games/last) so it catches ALL games played
 * in the match window, even if multiple were completed between two poll cycles.
 */

import axios from 'axios';
import { prisma } from '../index';
import { distributePayout } from './betService';
import { getIo } from '../socket';
import logger from '../logger';

async function storeMatchInPlayerHistory(
  matchId: string,
  player1Id: string, player1Name: string,
  player2Id: string, player2Name: string,
  winnerId: string,
  resultScore: string,
  tournamentName: string,
  scheduledAt: Date,
  format: string,
  game: string,
): Promise<void> {
  const p1Won = winnerId === player1Id;
  for (const [playerId, playerName, opponentId, opponentName, won] of [
    [player1Id, player1Name, player2Id, player2Name, p1Won],
    [player2Id, player2Name, player1Id, player1Name, !p1Won],
  ] as [string, string, string, string, boolean][]) {
    try {
      await prisma.playerMatchRecord.upsert({
        where: {
          playerId_opponentName_tournamentName_matchDate: {
            playerId,
            opponentName,
            tournamentName,
            matchDate: scheduledAt,
          },
        },
        create: {
          playerId,
          opponentName,
          opponentId,
          game,
          won,
          score: won ? resultScore : resultScore.split('-').reverse().join('-'),
          tournamentName,
          matchDate: scheduledAt,
          format,
          source: 'platform',
          confidence: 1.0,
        },
        update: {
          game,
          won,
          score: won ? resultScore : resultScore.split('-').reverse().join('-'),
        },
      });
    } catch { /* ignore duplicates */ }
  }
}

const AOE4WORLD = 'https://aoe4world.com/api/v0';

interface AoePlayer {
  profile_id: number;
  name: string;
  result: 'win' | 'loss' | null;
  civilization?: string;
}

interface Game {
  game_id: number;
  started_at: string;
  duration: number | null;
  map: string;
  ongoing: boolean;
  teams: Array<Array<{ player: AoePlayer }>>;
}

async function fetchH2HGames(id1: string, id2: string): Promise<Game[]> {
  try {
    const res = await axios.get<{ games: Game[] }>(
      `${AOE4WORLD}/players/${id1}/games?opponent_profile_id=${id2}&limit=20`,
      {
        headers: { 'User-Agent': 'AgeOfMoney/1.0 (contact@ageofmoney.com)' },
        timeout: 10000,
      }
    );
    return res.data?.games ?? [];
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) return [];
    logger.warn(`[Verifier] aoe4world H2H fetch failed for ${id1} vs ${id2}`);
    return [];
  }
}

function bothPlayersInGame(game: Game, id1: string, id2: string): boolean {
  const ids = game.teams.flatMap(t => t.map(e => String(e.player.profile_id)));
  return ids.includes(id1) && ids.includes(id2);
}

function getPlayerFromGame(game: Game, aoe4worldId: string): AoePlayer | null {
  for (const team of game.teams)
    for (const entry of team)
      if (String(entry.player.profile_id) === aoe4worldId) return entry.player;
  return null;
}

function getWinnerProfileId(game: Game): number | null {
  for (const team of game.teams)
    for (const entry of team)
      if (entry.player.result === 'win') return entry.player.profile_id;
  return null;
}

function winsNeeded(format: string): number {
  const n = parseInt(format.replace(/\D/g, ''), 10) || 3;
  return Math.ceil(n / 2);
}

export async function verifyMatch(matchId: string): Promise<void> {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      player1:    { select: { id: true, name: true, aoe4worldId: true } },
      player2:    { select: { id: true, name: true, aoe4worldId: true } },
      tournament: { select: { name: true } },
      boResults:  { orderBy: { boNumber: 'asc' } },
    },
  });

  if (!match || match.status !== 'LIVE' || match.winnerId) return;

  const { player1, player2 } = match;

  if (!player1.aoe4worldId || !player2.aoe4worldId) {
    logger.debug(`[Verifier] Match ${matchId}: missing aoe4worldId — skipping`);
    return;
  }

  const io = getIo();
  const matchWindowStart = new Date(new Date(match.scheduledAt).getTime() - 2 * 3600 * 1000);

  // ── Fetch ALL recent H2H games between both players ───────────────────────
  const allGames = await fetchH2HGames(player1.aoe4worldId, player2.aoe4worldId);

  // Keep only games within the match window that involve both players
  const matchGames = allGames
    .filter(g => {
      const gs = new Date(g.started_at);
      return gs >= matchWindowStart && bothPlayersInGame(g, player1.aoe4worldId!, player2.aoe4worldId!);
    })
    .sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime()); // oldest first

  logger.debug(`[Verifier] Match ${matchId}: ${matchGames.length} game(s) in match window`);

  if (matchGames.length === 0) {
    logger.debug(`[Verifier] Match ${matchId}: no H2H games found — may not have started on aoe4world yet`);
    return;
  }

  // ── Sets of already-recorded aoe4GameIds ─────────────────────────────────
  const recordedIds = new Set(match.boResults.map(r => r.aoe4GameId).filter(Boolean) as number[]);

  const finishedUnrecorded = matchGames.filter(g => !g.ongoing && !recordedIds.has(g.game_id));
  const ongoingGame        = matchGames.find(g => g.ongoing) ?? null;

  // ── Process each finished, unrecorded game in order ──────────────────────
  let p1Score = match.p1Score;
  let p2Score = match.p2Score;
  const needed = winsNeeded(match.format);
  let resolvedWinnerId: string | null = null;

  for (const game of finishedUnrecorded) {
    const winnerProfileId = getWinnerProfileId(game);
    if (!winnerProfileId) {
      logger.warn(`[Verifier] Match ${matchId}: game ${game.game_id} has no winner yet (result null) — skipping`);
      continue;
    }

    const boWinnerId =
      String(winnerProfileId) === player1.aoe4worldId ? player1.id :
      String(winnerProfileId) === player2.aoe4worldId ? player2.id :
      null;
    if (!boWinnerId) continue;

    const p1Entry = getPlayerFromGame(game, player1.aoe4worldId);
    const p2Entry = getPlayerFromGame(game, player2.aoe4worldId);
    const boNumber = match.boResults.length + finishedUnrecorded.indexOf(game) + 1;

    await prisma.boResult.create({
      data: {
        matchId,
        boNumber,
        winnerId:  boWinnerId,
        p1Civ:     p1Entry?.civilization ?? null,
        p2Civ:     p2Entry?.civilization ?? null,
        aoe4GameId: game.game_id,
        duration:  game.duration ?? null,
        map:       game.map ?? null,
        startedAt: new Date(game.started_at),
      },
    });

    p1Score += boWinnerId === player1.id ? 1 : 0;
    p2Score += boWinnerId === player2.id ? 1 : 0;

    logger.info(`[Verifier] Match ${matchId}: BO${boNumber} recorded (game_id=${game.game_id}), score ${p1Score}-${p2Score}`);

    if (p1Score >= needed || p2Score >= needed) {
      resolvedWinnerId = p1Score >= needed ? player1.id : player2.id;
      break;
    }
  }

  // ── Match resolved ────────────────────────────────────────────────────────
  if (resolvedWinnerId) {
    const resultScore = `${p1Score}-${p2Score}`;
    await prisma.match.update({
      where: { id: matchId },
      data: { status: 'COMPLETED', winnerId: resolvedWinnerId, resultScore, p1Score, p2Score, betsOpen: false, currentGameId: null },
    });

    await distributePayout(matchId, resolvedWinnerId);

    storeMatchInPlayerHistory(
      matchId,
      player1.id, player1.name,
      player2.id, player2.name,
      resolvedWinnerId,
      resultScore,
      match.tournament?.name ?? 'Tournament',
      match.scheduledAt,
      match.format,
      match.game,
    ).catch(() => {});

    if (io) {
      io.to(`matchRoom:${matchId}`).emit('matchResult', { matchId, winnerId: resolvedWinnerId, resultScore, verifiedBy: 'aoe4world' });
      io.emit('matchUpdate', { matchId, status: 'COMPLETED', winnerId: resolvedWinnerId, resultScore });
    }

    logger.info(`[Verifier] Match ${matchId} RESOLVED: ${resolvedWinnerId === player1.id ? player1.name : player2.name} wins ${resultScore}`);
    return;
  }

  // ── Scores updated, match still ongoing ──────────────────────────────────
  const scoresChanged = p1Score !== match.p1Score || p2Score !== match.p2Score;
  const betsOpen = !ongoingGame;

  if (scoresChanged) {
    await prisma.match.update({
      where: { id: matchId },
      data: {
        p1Score,
        p2Score,
        betsOpen,
        currentGameId: ongoingGame?.game_id ?? null,
        currentBoNumber: ongoingGame ? (p1Score + p2Score + 1) : match.currentBoNumber,
      },
    });

    if (io) {
      io.to(`matchRoom:${matchId}`).emit('boEnded', { matchId, p1Score, p2Score });
      io.emit('matchUpdate', { matchId, p1Score, p2Score, betsOpen });
    }

    logger.info(`[Verifier] Match ${matchId}: scores updated to ${p1Score}-${p2Score}, betsOpen=${betsOpen}`);
  }

  // ── Handle currently ONGOING game ────────────────────────────────────────
  if (ongoingGame && match.currentGameId !== ongoingGame.game_id) {
    const p1Entry = getPlayerFromGame(ongoingGame, player1.aoe4worldId);
    const p2Entry = getPlayerFromGame(ongoingGame, player2.aoe4worldId);
    const p1Civ = p1Entry?.civilization ?? null;
    const p2Civ = p2Entry?.civilization ?? null;
    const nextBoNumber = p1Score + p2Score + 1;

    await prisma.match.update({
      where: { id: matchId },
      data: { betsOpen: false, currentGameId: ongoingGame.game_id, currentBoNumber: nextBoNumber, p1Civ, p2Civ, verificationFlag: true },
    });

    if (io) {
      io.to(`matchRoom:${matchId}`).emit('boStarted', { matchId, boNumber: nextBoNumber, p1Civ, p2Civ, gameId: ongoingGame.game_id });
      io.to(`matchRoom:${matchId}`).emit('betsStatus', { matchId, open: false });
      io.emit('matchUpdate', { matchId, status: 'LIVE', betsOpen: false, p1Civ, p2Civ });
    }

    logger.info(`[Verifier] Match ${matchId}: BO${nextBoNumber} ONGOING (game_id=${ongoingGame.game_id}), bets CLOSED`);
  }
}

let verifierInterval: ReturnType<typeof setInterval> | null = null;

export function startMatchVerifier(): void {
  if (verifierInterval) return;
  logger.info('[Verifier] Starting real-time match verifier (15s interval)');

  verifierInterval = setInterval(async () => {
    try {
      const liveMatches = await prisma.match.findMany({
        where: { status: 'LIVE', winnerId: null },
        select: { id: true },
        take: 20,
      });

      for (const m of liveMatches) {
        await verifyMatch(m.id);
        await new Promise(r => setTimeout(r, 1000));
      }
    } catch (err) {
      logger.error('[Verifier] Interval error:', err);
    }
  }, 15_000);
}

export function stopMatchVerifier(): void {
  if (verifierInterval) {
    clearInterval(verifierInterval);
    verifierInterval = null;
  }
}
