import { prisma } from '../index';
import { BetStatus, MatchStatus } from '@prisma/client';
import { adjustOddsAdvanced, BetRecord } from './oddsEngine';
import { getIo } from '../socket';
import logger from '../logger';

const MAX_BETS_PER_MATCH = 3;

export async function placeBet(
  userId: string,
  matchId: string,
  amount: number,
  selectedPlayer: 0 | 1 | 2 // 0 = draw, 1 = player1, 2 = player2
): Promise<{
  id: string;
  amount: number;
  oddsAtBet: number;
  selectedPlayer: number;
  status: BetStatus;
  createdAt: Date;
}> {
  // Fetch match and user in parallel
  const [match, user] = await Promise.all([
    prisma.match.findUnique({
      where: { id: matchId },
      select: {
        id: true,
        status: true,
        format: true,
        betsClosedAt: true,
        betsOpen: true,
        odds1: true,
        odds2: true,
        oddsDraw: true,
        scheduledAt: true,
      },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, coins: true, isBanned: true },
    }),
  ]);

  if (!match) throw new Error('Match not found');
  if (!user) throw new Error('User not found');
  if (user.isBanned) throw new Error('Account is banned');

  // Hard block — match must be UPCOMING to accept bets
  if (match.status !== MatchStatus.UPCOMING) {
    throw new Error('Betting is closed for this match');
  }

  // Dynamic betsOpen flag — false while a BO game is ongoing
  if (match.betsOpen === false) {
    throw new Error('Bets are temporarily closed — a game is in progress');
  }

  // Hard block at scheduledAt — no bets once the match start time has passed
  const now = new Date();
  if (now >= match.scheduledAt) {
    throw new Error('Betting is closed — match has started');
  }

  // Check bets closed at time (pre-close buffer set by admin/scraper)
  if (match.betsClosedAt && now > match.betsClosedAt) {
    throw new Error('Betting window has closed for this match');
  }

  // Check user balance
  if (user.coins < amount) {
    throw new Error(`Insufficient coins. You have ${user.coins} coins, need ${amount}`);
  }

  // Check bet amount bounds
  if (amount < 10) throw new Error('Minimum bet is 10 coins');
  if (amount > 500) throw new Error('Maximum bet is 500 coins');

  // Check max bets per match
  const existingBets = await prisma.bet.count({
    where: {
      userId,
      matchId,
      status: { notIn: [BetStatus.CANCELLED, BetStatus.REFUNDED] },
    },
  });

  if (existingBets >= MAX_BETS_PER_MATCH) {
    throw new Error(`Maximum ${MAX_BETS_PER_MATCH} bets per match reached`);
  }

  // Validate draw bet: only allowed for even BO formats
  if (selectedPlayer === 0) {
    const bo = parseInt(match.format.replace(/\D/g, ''), 10) || 3;
    if (bo % 2 !== 0) throw new Error('Draw bets are only available for even BO formats (BO2, BO4...)');
    if (!match.oddsDraw) throw new Error('Draw odds not available for this match');
  }

  const oddsAtBet = selectedPlayer === 0
    ? (match.oddsDraw ?? 0)
    : selectedPlayer === 1 ? match.odds1 : match.odds2;

  if (oddsAtBet <= 0) throw new Error('Invalid odds for this selection');

  // Use a transaction to deduct coins and create bet atomically
  const bet = await prisma.$transaction(async (tx) => {
    // Re-check balance inside transaction
    const freshUser = await tx.user.findUnique({
      where: { id: userId },
      select: { coins: true },
    });

    if (!freshUser || freshUser.coins < amount) {
      throw new Error('Insufficient coins');
    }

    // Deduct coins
    await tx.user.update({
      where: { id: userId },
      data: { coins: { decrement: amount }, totalWagered: { increment: amount } },
    });

    // Create bet
    const newBet = await tx.bet.create({
      data: {
        userId,
        matchId,
        amount,
        oddsAtBet,
        selectedPlayer,
        status: BetStatus.PENDING,
      },
    });

    return newBet;
  });

  logger.info(`Bet placed: user=${userId}, match=${matchId}, amount=${amount}, player=${selectedPlayer}, odds=${oddsAtBet}`);

  // Recalculate live odds with volume adjustment and broadcast to connected clients
  try {
    const allMatchBets = await prisma.bet.findMany({
      where: { matchId, status: { notIn: [BetStatus.CANCELLED, BetStatus.REFUNDED] } },
      select: { amount: true, oddsAtBet: true, selectedPlayer: true },
    });
    const betRecords = allMatchBets.map((b) => ({
      amount: b.amount,
      oddsAtBet: b.oddsAtBet,
      selectedPlayer: b.selectedPlayer as 1 | 2,
    })) satisfies BetRecord[];
    // match.odds1/odds2 are model odds (never volume-adjusted in DB) — safe to use as base
    const liveOdds = adjustOddsAdvanced(match.odds1, match.odds2, betRecords);
    const io = getIo();
    if (io) {
      io.to(`matchRoom:${matchId}`).emit('oddsUpdate', { matchId, ...liveOdds, timestamp: new Date().toISOString() });
      io.emit('matchUpdate', { matchId, odds1: liveOdds.odds1, odds2: liveOdds.odds2 });
    }
  } catch (err) {
    logger.warn(`Failed to broadcast live odds after bet: ${err}`);
  }

  return bet;
}

export async function distributePayout(matchId: string, winnerId: string): Promise<void> {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      player1Id: true, player2Id: true, odds1: true, odds2: true,
      p1Score: true, p2Score: true, resultScore: true,
      player1: { select: { name: true } },
      player2: { select: { name: true } },
      tournament: { select: { name: true } },
    },
  });

  if (!match) {
    logger.error(`distributePayout: match ${matchId} not found`);
    return;
  }

  const winnerPosition = match.player1Id === winnerId ? 1 : match.player2Id === winnerId ? 2 : null;

  if (winnerPosition === null) {
    logger.error(`distributePayout: winnerId ${winnerId} is not a player in match ${matchId}`);
    return;
  }

  const pendingBets = await prisma.bet.findMany({
    where: { matchId, status: BetStatus.PENDING },
    select: { id: true, userId: true, amount: true, oddsAtBet: true, selectedPlayer: true, betType: true, boNumber: true },
  });

  // Determine loser's game count from resultScore (e.g. "2-1" → loserGames=1)
  const loserGamesFromScore = (): number | null => {
    if (!match.resultScore) return null;
    const parts = match.resultScore.split('-').map(Number);
    if (parts.length !== 2) return null;
    const [s1, s2] = parts;
    return winnerPosition === 1 ? s2 : s1;
  };
  const actualLoserGames = loserGamesFromScore();

  if (pendingBets.length === 0) {
    logger.info(`distributePayout: no pending bets for match ${matchId}`);
    return;
  }

  let payoutsDistributed = 0;
  let totalPaid = 0;
  const io = getIo();
  const winnerName = winnerPosition === 1 ? match.player1?.name : match.player2?.name;
  const loserName  = winnerPosition === 1 ? match.player2?.name : match.player1?.name;
  const tournamentName = match.tournament?.name ?? 'Tournament';

  for (const bet of pendingBets) {
    let won: boolean;
    if (bet.betType === 'EXACT_SCORE') {
      // Exact score bet: must match both winner and loser game count
      won = bet.selectedPlayer === winnerPosition && actualLoserGames !== null && bet.boNumber === actualLoserGames;
    } else {
      won = bet.selectedPlayer === winnerPosition;
    }
    const payout = won ? Math.floor(bet.amount * bet.oddsAtBet) : 0;

    await prisma.$transaction([
      prisma.bet.update({
        where: { id: bet.id },
        data: {
          status: won ? BetStatus.WON : BetStatus.LOST,
          payout: won ? payout : 0,
        },
      }),
      ...(won
        ? [
            prisma.user.update({
              where: { id: bet.userId },
              data: { coins: { increment: payout } },
            }),
          ]
        : []),
    ]);

    if (won) {
      payoutsDistributed++;
      totalPaid += payout;
      // Fetch updated coins and notify user
      const updatedUser = await prisma.user.findUnique({ where: { id: bet.userId }, select: { coins: true } });
      if (io && updatedUser) io.to(`user:${bet.userId}`).emit('coinsUpdate', { coins: updatedUser.coins, direction: 'up' });
    }

    // Notify user via their private socket room
    if (io) {
      io.to(`user:${bet.userId}`).emit('betResult', {
        matchId,
        betId: bet.id,
        won,
        amount: bet.amount,
        payout: won ? payout : 0,
        playerBetOn: bet.selectedPlayer === 1 ? match.player1?.name : match.player2?.name,
        winnerName,
        loserName,
        tournamentName,
      });
    }
  }

  logger.info(
    `distributePayout: match=${matchId}, winner=player${winnerPosition}, ${payoutsDistributed}/${pendingBets.length} bets won, total paid=${totalPaid} coins`
  );
}

/**
 * Distribute payouts for a draw outcome (even BO formats like BO2/BO4).
 * selectedPlayer=0 bets win, selectedPlayer=1/2 bets lose.
 */
export async function distributeDrawPayout(matchId: string): Promise<void> {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      oddsDraw: true, resultScore: true,
      player1: { select: { name: true } },
      player2: { select: { name: true } },
      tournament: { select: { name: true } },
    },
  });
  if (!match) return;

  const pendingBets = await prisma.bet.findMany({
    where: { matchId, status: BetStatus.PENDING },
    select: { id: true, userId: true, amount: true, oddsAtBet: true, selectedPlayer: true },
  });
  if (pendingBets.length === 0) return;

  const io = getIo();
  const tournamentName = match.tournament?.name ?? 'Tournament';
  let payoutsDistributed = 0;
  let totalPaid = 0;

  for (const bet of pendingBets) {
    const won = bet.selectedPlayer === 0; // draw bets win
    const payout = won ? Math.floor(bet.amount * bet.oddsAtBet) : 0;

    await prisma.$transaction([
      prisma.bet.update({
        where: { id: bet.id },
        data: { status: won ? BetStatus.WON : BetStatus.LOST, payout: won ? payout : 0 },
      }),
      ...(won ? [prisma.user.update({ where: { id: bet.userId }, data: { coins: { increment: payout } } })] : []),
    ]);

    if (won) { payoutsDistributed++; totalPaid += payout; }
    if (io) {
      if (won) {
        const updatedUser = await prisma.user.findUnique({ where: { id: bet.userId }, select: { coins: true } });
        if (updatedUser) io.to(`user:${bet.userId}`).emit('coinsUpdate', { coins: updatedUser.coins, direction: 'up' });
      }
      const playerBetOn = bet.selectedPlayer === 0 ? 'Égalité' : bet.selectedPlayer === 1 ? match.player1?.name : match.player2?.name;
      io.to(`user:${bet.userId}`).emit('betResult', {
        matchId, betId: bet.id, won, amount: bet.amount, payout: won ? payout : 0,
        playerBetOn, winnerName: 'Égalité', loserName: undefined, tournamentName,
      });
    }
  }

  logger.info(`distributeDrawPayout: match=${matchId}, ${payoutsDistributed}/${pendingBets.length} draw bets won, total paid=${totalPaid} coins`);
}

export async function refundBets(matchId: string, reason?: string): Promise<void> {
  const pendingBets = await prisma.bet.findMany({
    where: { matchId, status: BetStatus.PENDING },
    select: { id: true, userId: true, amount: true, selectedPlayer: true },
  });

  if (pendingBets.length === 0) {
    logger.info(`refundBets: no pending bets for match ${matchId}`);
    return;
  }

  // Fetch match info for notifications
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      player1: { select: { name: true } },
      player2: { select: { name: true } },
      tournament: { select: { name: true } },
    },
  });

  // Batch all refunds in a single transaction instead of N individual ones
  await prisma.$transaction([
    prisma.bet.updateMany({
      where: { matchId, status: BetStatus.PENDING },
      data: { status: BetStatus.REFUNDED },
    }),
    ...pendingBets.map(bet =>
      prisma.user.update({
        where: { id: bet.userId },
        data: { coins: { increment: bet.amount } },
      })
    ),
  ]);

  // Notify each user of the refund via socket
  const io = getIo();
  if (io && match) {
    const tournamentName = match.tournament?.name ?? 'Tournament';
    const refundReason = reason ?? 'Match annulé (forfait/walkover)';
    for (const bet of pendingBets) {
      const playerBetOn = bet.selectedPlayer === 1 ? match.player1?.name : match.player2?.name;
      // Send updated coin balance
      const updatedUser = await prisma.user.findUnique({ where: { id: bet.userId }, select: { coins: true } });
      if (updatedUser) io.to(`user:${bet.userId}`).emit('coinsUpdate', { coins: updatedUser.coins, direction: 'up' });
      // Send refund notification
      io.to(`user:${bet.userId}`).emit('betResult', {
        matchId,
        betId: bet.id,
        won: false,
        refunded: true,
        reason: refundReason,
        amount: bet.amount,
        payout: bet.amount, // refund = full amount back
        playerBetOn,
        tournamentName,
      });
    }
  }

  logger.info(`refundBets: match=${matchId}, refunded ${pendingBets.length} bets (reason: ${reason ?? 'cancelled'})`);
}

export interface UserStats {
  totalBets: number;
  wonBets: number;
  lostBets: number;
  pendingBets: number;
  totalWagered: number;
  totalPayout: number;
  netProfit: number;
  roi: number;
  winrate: number;
  bestBet: {
    amount: number;
    odds: number;
    payout: number;
    profit: number;
  } | null;
}

export async function getUserStats(userId: string): Promise<UserStats> {
  const [bets, rouletteBets] = await Promise.all([
    prisma.bet.findMany({
      where: { userId },
      select: { amount: true, oddsAtBet: true, status: true, payout: true },
    }),
    prisma.rouletteBet.findMany({
      where: { userId },
      select: { amount: true, payout: true, won: true },
    }),
  ]);

  const totalBets = bets.length + rouletteBets.length;
  const wonBets = bets.filter((b) => b.status === 'WON').length + rouletteBets.filter(b => b.won === true).length;
  const lostBets = bets.filter((b) => b.status === 'LOST').length + rouletteBets.filter(b => b.won === false).length;
  const pendingBets = bets.filter((b) => b.status === 'PENDING').length + rouletteBets.filter(b => b.won === null).length;

  const totalWagered = bets
    .filter((b) => b.status !== 'REFUNDED' && b.status !== 'CANCELLED')
    .reduce((sum, b) => sum + b.amount, 0)
    + rouletteBets.reduce((sum, b) => sum + b.amount, 0);

  const totalPayout = bets
    .filter((b) => b.status === 'WON')
    .reduce((sum, b) => sum + (b.payout ?? 0), 0)
    + rouletteBets.filter(b => b.won === true).reduce((sum, b) => sum + (b.payout ?? 0), 0);

  const netProfit = totalPayout - totalWagered;
  const roi = totalWagered > 0 ? (netProfit / totalWagered) * 100 : 0;
  const winrate = totalBets > 0 ? (wonBets / (wonBets + lostBets || 1)) * 100 : 0;

  const bestBetData = bets
    .filter((b) => b.status === 'WON' && b.payout)
    .sort((a, b) => (b.payout ?? 0) - (a.payout ?? 0))[0];

  const bestBet = bestBetData
    ? {
        amount: bestBetData.amount,
        odds: bestBetData.oddsAtBet,
        payout: bestBetData.payout ?? 0,
        profit: (bestBetData.payout ?? 0) - bestBetData.amount,
      }
    : null;

  return {
    totalBets,
    wonBets,
    lostBets,
    pendingBets,
    totalWagered,
    totalPayout,
    netProfit,
    roi: Math.round(roi * 100) / 100,
    winrate: Math.round(winrate * 100) / 100,
    bestBet,
  };
}
