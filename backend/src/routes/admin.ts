import { Router, Request, Response } from 'express';
import { requireAdmin } from '../middleware/auth';
import { prisma } from '../index';
import { distributePayout, refundBets } from '../services/betService';
import { getIo } from '../socket';
import { z } from 'zod';
import logger from '../logger';

const router = Router();

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

// All admin routes require admin role
router.use(requireAdmin);

// GET /matches/flagged - Flagged matches needing review
router.get('/matches/flagged', async (_req: Request, res: Response): Promise<void> => {
  try {
    const flagged = await prisma.match.findMany({
      where: { verificationFlag: true },
      include: {
        player1: { select: { id: true, name: true } },
        player2: { select: { id: true, name: true } },
        tournament: { select: { id: true, name: true } },
        _count: { select: { bets: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    res.json({ data: flagged });
  } catch (error) {
    logger.error('GET /admin/matches/flagged error:', error);
    res.status(500).json({ error: 'Failed to fetch flagged matches' });
  }
});

// POST /matches/:id/result - Override match result
const resultSchema = z.object({
  winnerId: z.string().min(1),
  resultScore: z.string().min(1),
  clearFlag: z.boolean().default(true),
});

router.post('/matches/:id/result', async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = resultSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid result data', details: parsed.error.flatten() });
      return;
    }

    const { winnerId, resultScore, clearFlag } = parsed.data;
    const matchId = req.params.id;

    const match = await prisma.match.findUnique({
      where: { id: matchId },
      select: { player1Id: true, player2Id: true, status: true },
    });

    if (!match) {
      res.status(404).json({ error: 'Match not found' });
      return;
    }

    if (winnerId !== match.player1Id && winnerId !== match.player2Id) {
      res.status(400).json({ error: 'Winner must be one of the match players' });
      return;
    }

    await prisma.match.update({
      where: { id: matchId },
      data: {
        status: 'COMPLETED',
        winnerId,
        resultScore,
        verificationFlag: clearFlag ? false : undefined,
        updatedAt: new Date(),
      },
    });

    // Distribute payouts
    await distributePayout(matchId, winnerId);

    // Store result in player match history for future odds calculation
    const fullMatch = await prisma.match.findUnique({
      where: { id: matchId },
      include: {
        player1: { select: { id: true, name: true } },
        player2: { select: { id: true, name: true } },
        tournament: { select: { name: true } },
      },
    });
    if (fullMatch) {
      storeMatchInPlayerHistory(
        matchId,
        fullMatch.player1.id, fullMatch.player1.name,
        fullMatch.player2.id, fullMatch.player2.name,
        winnerId,
        resultScore,
        fullMatch.tournament?.name ?? 'Tournament',
        fullMatch.scheduledAt,
        fullMatch.format,
        fullMatch.game,
      ).catch(() => {});
    }

    logger.info(`Admin override: match ${matchId} result set to winner ${winnerId}`);

    res.json({ message: 'Match result set and payouts distributed' });
  } catch (error) {
    logger.error('POST /admin/matches/:id/result error:', error);
    res.status(500).json({ error: 'Failed to set match result' });
  }
});

// POST /matches/:id/score — Manually set the BO score for a LIVE match
router.post('/matches/:id/score', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { p1Score, p2Score } = req.body;

    if (typeof p1Score !== 'number' || typeof p2Score !== 'number') {
      res.status(400).json({ error: 'p1Score and p2Score required' }); return;
    }

    const match = await prisma.match.findUnique({
      where: { id },
      include: { player1: true, player2: true },
    });
    if (!match) { res.status(404).json({ error: 'Match not found' }); return; }

    await prisma.match.update({
      where: { id },
      data: { p1Score, p2Score },
    });

    // Broadcast to connected clients
    const { getIo } = await import('../socket');
    const io = getIo();
    if (io) {
      io.to(`matchRoom:${id}`).emit('boEnded', { matchId: id, p1Score, p2Score });
      io.emit('matchUpdate', { matchId: id, p1Score, p2Score });
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /matches/:id/verify — Force an immediate aoe4world re-check for a LIVE match
router.post('/matches/:id/verify', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { verifyMatch } = await import('../services/matchVerifier');
    await verifyMatch(id);
    res.json({ ok: true, message: 'Vérification aoe4world déclenchée' });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /matches/:id/sync-liquipedia — Force immediate Liquipedia score sync
router.post('/matches/:id/sync-liquipedia', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { syncMatchScore } = await import('../services/liquipediaLiveScorer');
    await syncMatchScore(id);
    res.json({ ok: true, message: 'Sync Liquipedia déclenché' });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /matches/:id/lp-debug — Show exactly what the LP scorer sees for a match
router.get('/matches/:id/lp-debug', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { debugLpMatch } = await import('../services/liquipediaLiveScorer');
    const result = await debugLpMatch(id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /matches/:id/cancel - Cancel match and refund bets
router.post('/matches/:id/cancel', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const match = await prisma.match.findUnique({ where: { id } });
    if (!match) {
      res.status(404).json({ error: 'Match not found' });
      return;
    }

    await prisma.match.update({
      where: { id },
      data: { status: 'CANCELLED', verificationFlag: false },
    });

    await refundBets(id);

    logger.info(`Admin cancelled match ${id} and refunded bets`);
    res.json({ message: 'Match cancelled and bets refunded' });
  } catch (error) {
    logger.error('POST /admin/matches/:id/cancel error:', error);
    res.status(500).json({ error: 'Failed to cancel match' });
  }
});

// DELETE /matches/:id - Hard delete a match (refunds bets first)
router.delete('/matches/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const match = await prisma.match.findUnique({ where: { id } });
    if (!match) { res.status(404).json({ error: 'Match not found' }); return; }
    // Refund any bets first
    await refundBets(id);
    await prisma.match.delete({ where: { id } });
    logger.info(`Admin deleted match ${id}`);
    res.json({ message: 'Match deleted' });
  } catch (error) {
    logger.error('DELETE /admin/matches/:id error:', error);
    res.status(500).json({ error: 'Failed to delete match' });
  }
});

// GET /scrapers/logs - Recent scraper logs
router.get('/scrapers/logs', async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string || '50'), 200);
    const source = req.query.source as string | undefined;

    const whereClause: Record<string, unknown> = {};
    if (source) whereClause.source = source;

    const logs = await prisma.scraperLog.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    res.json({ data: logs });
  } catch (error) {
    logger.error('GET /admin/scrapers/logs error:', error);
    res.status(500).json({ error: 'Failed to fetch scraper logs' });
  }
});

// POST /scrapers/run - Manually trigger a scraper
router.post('/scrapers/run', async (req: Request, res: Response): Promise<void> => {
  try {
    const { source } = req.body as { source: 'tournaments' | 'aoe4world' | 'enrich' | 'liquipedia' };

    if (!['tournaments', 'aoe4world', 'enrich', 'liquipedia'].includes(source)) {
      res.status(400).json({ error: 'Invalid source. Must be "tournaments", "aoe4world", "enrich", or "liquipedia"' });
      return;
    }

    // For enrich: first do an instant recalc from DB, then full API enrich in background
    if (source === 'enrich') {
      // Instant pass: recalc odds from existing DB data, broadcast via socket NOW
      const io = getIo();
      const { calculateOddsFromPlayers } = await import('../services/oddsEngine');
      const { getPlayerH2HFromHistory } = await import('../scrapers/aiPlayerHistoryScraper');
      const activeMatches = await prisma.match.findMany({
        where: { status: { in: ['UPCOMING', 'LIVE'] } },
        include: {
          player1: { select: { id: true, elo: true, winrate: true, totalGames: true, currentStreak: true, peakElo: true, lastMatchAt: true } },
          player2: { select: { id: true, elo: true, winrate: true, totalGames: true, currentStreak: true, peakElo: true, lastMatchAt: true } },
        },
      });
      for (const match of activeMatches) {
        try {
          const h2h = await getPlayerH2HFromHistory(match.player1.id, match.player2.id, match.game);
          const newOdds = calculateOddsFromPlayers(match.player1, match.player2, h2h);
          await prisma.match.update({ where: { id: match.id }, data: { odds1: newOdds.odds1, odds2: newOdds.odds2 } });
          io?.to(`matchRoom:${match.id}`).emit('oddsUpdate', { matchId: match.id, odds1: newOdds.odds1, odds2: newOdds.odds2 });
          io?.emit('matchUpdate', { matchId: match.id, odds1: newOdds.odds1, odds2: newOdds.odds2 });
        } catch { /* skip */ }
      }
      res.json({ message: `Instant recalc done (${activeMatches.length} matches). Full enrich running in background.` });
      // Full API enrich in background
      const { enrichAllUpcomingMatches } = await import('../scrapers/aoe4worldScraper');
      enrichAllUpcomingMatches().catch((err: Error) => logger.error('Manual enrichment error:', err));
      return;
    }

    // Other scrapers run fully in background — also fix game fields while we're at it
    res.json({ message: `Scraper ${source} triggered successfully` });

    if (source === 'tournaments') {
      const { scrapeAoe4WorldTournaments } = await import('../scrapers/aoe4worldTournamentScraper');
      scrapeAoe4WorldTournaments().catch((err: Error) => logger.error('Manual tournament scrape error:', err));
    } else if (source === 'liquipedia') {
      const { syncAoeEventCalendar } = await import('../scrapers/aoeEventCalendarScraper');
      const { scrapeUpcomingMatches } = await import('../scrapers/liquipediaScraper');
      syncAoeEventCalendar()
        .then(() => scrapeUpcomingMatches())
        .catch((err: Error) => logger.error('Manual Liquipedia scrape error:', err));
    } else {
      const { updateAllPlayerStats } = await import('../scrapers/aoe4worldScraper');
      updateAllPlayerStats().catch((err: Error) => logger.error('Manual aoe4world update error:', err));
    }
  } catch (error) {
    logger.error('POST /admin/scrapers/run error:', error);
    res.status(500).json({ error: 'Failed to trigger scraper' });
  }
});

// POST /admin/fix-duplicate-matches — remove UPCOMING duplicates when a COMPLETED match exists
router.post('/fix-duplicate-matches', async (_req: Request, res: Response): Promise<void> => {
  try {
    const completed = await prisma.match.findMany({
      where: { status: 'COMPLETED' },
      select: { id: true, player1Id: true, player2Id: true, tournamentId: true },
    });
    let deleted = 0;
    for (const c of completed) {
      const dupes = await prisma.match.findMany({
        where: {
          id: { not: c.id },
          OR: [
            { player1Id: c.player1Id, player2Id: c.player2Id },
            { player1Id: c.player2Id, player2Id: c.player1Id },
          ],
          tournamentId: c.tournamentId,
          status: { in: ['UPCOMING', 'LIVE'] },
        },
        select: { id: true },
      });
      if (dupes.length > 0) {
        const ids = dupes.map(d => d.id);
        await prisma.bet.deleteMany({ where: { matchId: { in: ids } } });
        await prisma.match.deleteMany({ where: { id: { in: ids } } });
        deleted += dupes.length;
      }
    }
    res.json({ ok: true, deletedDuplicates: deleted });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /admin/fix-tournament-games — one-time fix: derive game from liquipediaUrl
router.post('/fix-tournament-games', async (_req: Request, res: Response): Promise<void> => {
  try {
    const tournaments = await prisma.tournament.findMany({ select: { id: true, liquipediaUrl: true, game: true } });
    const urlToGame = (url: string): string => {
      if (url.includes('/ageofempires2/'))  return 'AoE2';
      if (url.includes('/ageofempires3/'))  return 'AoE3';
      if (url.includes('/ageofmythology/')) return 'AoM';
      return 'AoE4';
    };
    let fixed = 0;
    for (const t of tournaments) {
      const correct = urlToGame(t.liquipediaUrl);
      if (t.game !== correct) {
        await prisma.tournament.update({ where: { id: t.id }, data: { game: correct } });
        fixed++;
      }
    }
    res.json({ ok: true, total: tournaments.length, fixed });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /users - List all users
router.get('/users', async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string || '50'), 200);
    const offset = parseInt(req.query.offset as string || '0');
    const search = req.query.search as string | undefined;
    const sortBy = (req.query.sortBy as string) || 'createdAt';
    const filter = req.query.filter as string | undefined;

    const whereClause: Record<string, unknown> = {};
    if (search) {
      whereClause.OR = [
        { username: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (filter === 'banned') whereClause.isBanned = true;
    if (filter === 'muted') whereClause.mutedUntil = { gt: new Date() };
    if (filter === 'whales') whereClause.totalWagered = { gte: 10000 };

    const orderBy: Record<string, 'asc' | 'desc'> =
      sortBy === 'coins' ? { coins: 'desc' } :
      sortBy === 'wagered' ? { totalWagered: 'desc' } :
      sortBy === 'active' ? { lastActiveAt: 'desc' } :
      { createdAt: 'desc' };

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where: whereClause,
        orderBy,
        take: limit,
        skip: offset,
        select: {
          id: true,
          username: true,
          email: true,
          avatar: true,
          coins: true,
          totalWagered: true,
          isAdmin: true,
          isMod: true,
          isPartner: true,
          isBanned: true,
          mutedUntil: true,
          provider: true,
          steamId: true,
          lastActiveAt: true,
          createdAt: true,
          _count: { select: { bets: true } },
        },
      }),
      prisma.user.count({ where: whereClause }),
    ]);

    res.json({ data: users, total, limit, offset });
  } catch (error) {
    logger.error('GET /admin/users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// GET /users/:id - Full user profile for admin (stats, bets, transactions, risk flags)
router.get('/users/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        _count: { select: { bets: true, transactions: true, rouletteBets: true } },
      },
    });
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    // Recent bets (last 50)
    const recentBets = await prisma.bet.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        match: {
          select: {
            id: true, status: true, winnerId: true, resultScore: true, scheduledAt: true,
            player1: { select: { id: true, name: true } },
            player2: { select: { id: true, name: true } },
          },
        },
      },
    });

    // Recent transactions (deposits/withdrawals)
    const recentTransactions = await prisma.transaction.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    // Aggregate stats
    const allBets = await prisma.bet.findMany({
      where: { userId: id, status: { in: ['WON', 'LOST'] } },
      select: { amount: true, payout: true, status: true, createdAt: true },
    });

    const wonBets = allBets.filter(b => b.status === 'WON');
    const lostBets = allBets.filter(b => b.status === 'LOST');
    const totalWagered = allBets.reduce((s, b) => s + b.amount, 0);
    const totalWon = wonBets.reduce((s, b) => s + (b.payout ?? 0), 0);
    const netProfit = totalWon - totalWagered;
    const winrate = allBets.length > 0 ? wonBets.length / allBets.length : 0;

    // Last 24h / 7d activity
    const now = Date.now();
    const day = 24 * 3600 * 1000;
    const bets24h = allBets.filter(b => now - b.createdAt.getTime() < day).length;
    const bets7d = allBets.filter(b => now - b.createdAt.getTime() < 7 * day).length;

    // Risk flags
    const flags: { type: string; severity: 'low' | 'med' | 'high'; message: string }[] = [];
    if (winrate > 0.80 && allBets.length >= 10) {
      flags.push({ type: 'HIGH_WINRATE', severity: 'high', message: `Winrate ${(winrate * 100).toFixed(0)}% sur ${allBets.length} paris` });
    }
    if (netProfit > 50000) {
      flags.push({ type: 'LARGE_PROFIT', severity: 'med', message: `Profit net: +${netProfit.toLocaleString()} ⚜` });
    }
    if (bets24h > 50) {
      flags.push({ type: 'BET_FLOOD', severity: 'med', message: `${bets24h} paris en 24h` });
    }
    const pendingWithdrawals = recentTransactions.filter(t => t.type === 'withdrawal' && t.status === 'pending').length;
    if (pendingWithdrawals > 0) {
      flags.push({ type: 'PENDING_WITHDRAWAL', severity: 'low', message: `${pendingWithdrawals} retrait(s) en attente` });
    }
    if (user.isBanned) {
      flags.push({ type: 'BANNED', severity: 'high', message: 'Utilisateur banni' });
    }
    if (user.mutedUntil && user.mutedUntil > new Date()) {
      flags.push({ type: 'MUTED', severity: 'low', message: `Mute jusqu'à ${user.mutedUntil.toISOString()}` });
    }

    res.json({
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          avatar: user.avatar,
          bio: user.bio,
          steamId: user.steamId,
          coins: user.coins,
          totalWagered: user.totalWagered,
          isAdmin: user.isAdmin,
          isMod: user.isMod,
          isPartner: user.isPartner,
          isBanned: user.isBanned,
          mutedUntil: user.mutedUntil,
          totpEnabled: user.totpEnabled,
          provider: user.provider,
          createdAt: user.createdAt,
          lastActiveAt: user.lastActiveAt,
          counts: user._count,
        },
        stats: {
          totalBets: allBets.length,
          wonBets: wonBets.length,
          lostBets: lostBets.length,
          winrate,
          totalWagered,
          totalWon,
          netProfit,
          bets24h,
          bets7d,
        },
        flags,
        recentBets,
        recentTransactions,
      },
    });
  } catch (error) {
    logger.error('GET /admin/users/:id error:', error);
    res.status(500).json({ error: 'Failed to fetch user details' });
  }
});

// GET /suspicious - List users with risk flags (whales, high winrate, flood betting)
router.get('/suspicious', async (_req: Request, res: Response): Promise<void> => {
  try {
    // Aggregate bet stats per user
    const stats = await prisma.bet.groupBy({
      by: ['userId', 'status'],
      where: { status: { in: ['WON', 'LOST'] } },
      _count: true,
      _sum: { amount: true, payout: true },
    });

    const byUser = new Map<string, { won: number; lost: number; wagered: number; payout: number }>();
    for (const s of stats) {
      const entry = byUser.get(s.userId) ?? { won: 0, lost: 0, wagered: 0, payout: 0 };
      if (s.status === 'WON') entry.won += s._count;
      else entry.lost += s._count;
      entry.wagered += s._sum.amount ?? 0;
      entry.payout += s._sum.payout ?? 0;
      byUser.set(s.userId, entry);
    }

    // Filter suspicious: >=10 bets AND (winrate >75% OR profit >20k)
    const suspiciousIds: string[] = [];
    for (const [userId, s] of byUser) {
      const total = s.won + s.lost;
      if (total < 10) continue;
      const winrate = s.won / total;
      const netProfit = s.payout - s.wagered;
      if (winrate > 0.75 || netProfit > 20000) suspiciousIds.push(userId);
    }

    const suspiciousUsers = await prisma.user.findMany({
      where: { id: { in: suspiciousIds } },
      select: {
        id: true, username: true, avatar: true, coins: true, totalWagered: true,
        isBanned: true, createdAt: true, lastActiveAt: true,
      },
    });

    const enriched = suspiciousUsers.map(u => {
      const s = byUser.get(u.id)!;
      const total = s.won + s.lost;
      return {
        ...u,
        totalBets: total,
        wonBets: s.won,
        winrate: total > 0 ? s.won / total : 0,
        netProfit: s.payout - s.wagered,
      };
    }).sort((a, b) => b.netProfit - a.netProfit);

    res.json({ data: enriched });
  } catch (error) {
    logger.error('GET /admin/suspicious error:', error);
    res.status(500).json({ error: 'Failed to fetch suspicious users' });
  }
});

// GET /transactions - Pending/recent withdrawals & deposits queue
router.get('/transactions', async (req: Request, res: Response): Promise<void> => {
  try {
    const type = req.query.type as string | undefined;
    const status = req.query.status as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string || '50'), 200);

    const where: Record<string, unknown> = {};
    if (type) where.type = type;
    if (status) where.status = status;

    const transactions = await prisma.transaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        user: { select: { id: true, username: true, avatar: true, coins: true, isBanned: true } },
      },
    });

    res.json({ data: transactions });
  } catch (error) {
    logger.error('GET /admin/transactions error:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// POST /users/:id/ban - Ban or unban user
router.post('/users/:id/ban', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { banned = true, reason } = req.body as { banned?: boolean; reason?: string };

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (user.isAdmin) {
      res.status(403).json({ error: 'Cannot ban admin users' });
      return;
    }

    await prisma.user.update({
      where: { id },
      data: { isBanned: banned },
    });

    logger.info(`Admin ${banned ? 'banned' : 'unbanned'} user ${id}. Reason: ${reason || 'none'}`);
    res.json({ message: `User ${banned ? 'banned' : 'unbanned'} successfully` });
  } catch (error) {
    logger.error('POST /admin/users/:id/ban error:', error);
    res.status(500).json({ error: 'Failed to update user ban status' });
  }
});

// POST /users/:id/adjust-coins - Admin coin adjustment
router.post('/users/:id/adjust-coins', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { amount, reason } = req.body as { amount: number; reason: string };

    if (typeof amount !== 'number' || !Number.isInteger(amount) || Math.abs(amount) > 100000) {
      res.status(400).json({ error: 'Invalid amount (must be integer, max ±100000)' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const newBalance = Math.max(0, user.coins + amount);

    await prisma.user.update({
      where: { id },
      data: { coins: newBalance },
    });

    logger.info(`Admin adjusted coins for user ${id}: ${amount > 0 ? '+' : ''}${amount}. Reason: ${reason}`);
    res.json({ message: 'Coins adjusted', newBalance });
  } catch (error) {
    logger.error('POST /admin/users/:id/adjust-coins error:', error);
    res.status(500).json({ error: 'Failed to adjust coins' });
  }
});

// POST /users/:id/role - Set isMod / isPartner / isAdmin role
router.post('/users/:id/role', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { role, value } = req.body as { role: 'isMod' | 'isPartner' | 'isAdmin'; value: boolean };
    if (!['isMod', 'isPartner', 'isAdmin'].includes(role)) {
      res.status(400).json({ error: 'Invalid role' }); return;
    }

    await prisma.user.update({ where: { id }, data: { [role]: value } as Record<string, unknown> });

    // Auto-create affiliate code when granting Partner role
    if (role === 'isPartner' && value) {
      const user = await prisma.user.findUnique({ where: { id }, select: { username: true } });
      const existing = await prisma.affiliateCode.findUnique({ where: { userId: id } });
      if (!existing && user) {
        const base = user.username.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase();
        const suffix = require('crypto').randomBytes(2).toString('hex').toUpperCase();
        await prisma.affiliateCode.create({ data: { userId: id, code: `${base}${suffix}` } });
        logger.info(`[Admin] Affiliate code created for partner ${user.username}`);
      }
    }

    logger.info(`[Admin] Set ${role}=${value} for user ${id}`);
    res.json({ ok: true });
  } catch (err) {
    logger.error('POST /admin/users/:id/role error:', err);
    res.status(500).json({ error: 'Failed to set role' });
  }
});

// POST /users/:id/mute - Mute a user from chat
router.post('/users/:id/mute', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { durationMinutes } = req.body as { durationMinutes: number };
    const mutedUntil = durationMinutes > 0 ? new Date(Date.now() + durationMinutes * 60000) : null;
    await prisma.user.update({ where: { id }, data: { mutedUntil } as Record<string, unknown> });

    // Push mute via socket if online
    const { getIo } = require('../socket');
    const io = getIo();
    if (io && mutedUntil) {
      io.to(`user:${id}`).emit('chatMuted', { until: mutedUntil.toISOString(), remainingMinutes: durationMinutes, by: 'Admin' });
    }
    res.json({ ok: true, mutedUntil });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mute user' });
  }
});

// POST /users/set-admin-by-steam - Set admin by Steam ID (one-time setup)
router.post('/users/set-admin-by-steam', async (req: Request, res: Response): Promise<void> => {
  try {
    const { steamId } = req.body as { steamId: string };
    if (!steamId) { res.status(400).json({ error: 'steamId required' }); return; }
    const user = await prisma.user.updateMany({
      where: { OR: [{ steamId }, { providerId: steamId }] },
      data: { isAdmin: true },
    });
    res.json({ message: `Admin set for ${user.count} user(s) with steamId ${steamId}` });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /players — list all players with competitive winrate from LP records
router.get('/players', async (_req: Request, res: Response): Promise<void> => {
  try {
    const SENTINEL = '__AI_ENRICHED__';
    const players = await prisma.player.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true, name: true, aoe4worldId: true,
        totalGames: true, country: true, lastUpdatedAt: true,
        game: true, aiEnrichedGames: true,
        _count: { select: { matchHistory: true } },
      },
    });

    // Compute competitive winrate in 2 bulk queries (not per-player)
    const [totalCounts, winCounts] = await Promise.all([
      prisma.playerMatchRecord.groupBy({
        by: ['playerId'],
        where: { NOT: { opponentName: SENTINEL } },
        _count: { _all: true },
      }),
      prisma.playerMatchRecord.groupBy({
        by: ['playerId'],
        where: { won: true, NOT: { opponentName: SENTINEL } },
        _count: { _all: true },
      }),
    ]);

    const totalMap = new Map(totalCounts.map(r => [r.playerId, r._count._all]));
    const winMap = new Map(winCounts.map(r => [r.playerId, r._count._all]));

    const enriched = players.map(p => {
      const total = totalMap.get(p.id) ?? 0;
      const wins = winMap.get(p.id) ?? 0;
      const compWinrate = total > 0 ? (wins + 1.5) / (total + 3) : 0.5;
      return { ...p, winrate: compWinrate, totalGames: total };
    });

    res.json({ data: enriched });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /players/:id/seed-history — seed a specific player's history
// Body: { force?: boolean, game?: string, source?: 'all'|'ai'|'aoe4world'|'liquipedia' }
router.post('/players/:id/seed-history', async (req: Request, res: Response): Promise<void> => {
  try {
    const player = await prisma.player.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, aoe4worldId: true } });
    if (!player) { res.status(404).json({ error: 'Player not found' }); return; }
    const force = req.body?.force === true;
    const overrideGame = typeof req.body?.game === 'string' ? req.body.game as string : null;
    const source = (req.body?.source as string) ?? 'all';

    // Auto-detect game from the player's most recent match
    let game = overrideGame;
    if (!game) {
      const recentMatch = await prisma.match.findFirst({
        where: { OR: [{ player1Id: player.id }, { player2Id: player.id }] },
        orderBy: { scheduledAt: 'desc' },
        select: { game: true },
      });
      game = recentMatch?.game ?? 'AoE4';
    }

    // Tag player with game override if admin specified one
    if (overrideGame) {
      await prisma.player.update({ where: { id: player.id }, data: { game: overrideGame } }).catch(() => {});
    }

    const sourceLabel = source === 'ai' ? 'Claude AI' : source === 'aoe4world' ? 'aoe4world' : 'all sources';
    res.json({ ok: true, message: `Seeding ${player.name} via ${sourceLabel} (${game})` });

    (async () => {
      // aoe4world seeder (AoE4 only — others don't have aoe4world IDs)
      if ((source === 'all' || source === 'aoe4world') && (game === 'AoE4' || !overrideGame) && player.aoe4worldId) {
        const { seedPlayerHistoryFromAoe4World } = await import('../scrapers/aoe4worldPlayerHistorySeeder');
        const { buildProPlayerSet } = await import('../scrapers/aoe4worldScraper');
        const proIds = await buildProPlayerSet();
        await seedPlayerHistoryFromAoe4World(player.id, player.name, player.aoe4worldId, proIds, force);
        logger.info(`[Admin] Seeded ${player.name} via aoe4world`);
      }

      // Liquipedia direct scraper (all games — scrapes /Matches subpage)
      if (source === 'all' || source === 'liquipedia') {
        const { scrapePlayerHistoryFromLiquipedia } = await import('../scrapers/liquipediaPlayerHistoryScraper');
        await scrapePlayerHistoryFromLiquipedia(player.id, game!, force);
        logger.info(`[Admin] Seeded ${player.name} via Liquipedia scraper (${game})`);
      }

      // Claude AI seeder (all games — uses Liquipedia knowledge)
      if ((source === 'all' || source === 'ai') && process.env.ANTHROPIC_API_KEY) {
        const { enrichPlayerWithAI } = await import('../scrapers/aiPlayerHistoryScraper');
        await enrichPlayerWithAI(player.id, player.name, force, game!);
        logger.info(`[Admin] Seeded ${player.name} via Claude AI (${game})`);
      }
    })().catch(err => logger.error(`[Admin] Seed history failed for ${player.name}:`, err));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /tournaments/set-game — manually fix a tournament's game classification
// Body: { tournamentId?: string, name?: string, game: 'AoE1'|'AoE2'|'AoE3'|'AoE4'|'AoM' }
// Updates Tournament.game AND cascades to every Match attached to it.
// Use this when the auto-detector mis-classified a tournament.
router.post('/tournaments/set-game', async (req: Request, res: Response): Promise<void> => {
  try {
    const { tournamentId, name, game } = req.body as { tournamentId?: string; name?: string; game?: string };
    if (!game || !['AoE1', 'AoE2', 'AoE3', 'AoE4', 'AoM'].includes(game)) {
      res.status(400).json({ error: 'game must be one of AoE1, AoE2, AoE3, AoE4, AoM' });
      return;
    }
    if (!tournamentId && !name) {
      res.status(400).json({ error: 'Provide tournamentId or name' });
      return;
    }

    // Find target tournament(s)
    const tournaments = tournamentId
      ? await prisma.tournament.findMany({ where: { id: tournamentId } })
      : await prisma.tournament.findMany({ where: { name: { contains: name!, mode: 'insensitive' } } });

    if (tournaments.length === 0) {
      res.status(404).json({ error: 'No tournament found' });
      return;
    }

    let totalMatchesUpdated = 0;
    for (const t of tournaments) {
      await prisma.tournament.update({ where: { id: t.id }, data: { game } });
      const updated = await prisma.match.updateMany({
        where: { tournamentId: t.id },
        data: { game },
      });
      totalMatchesUpdated += updated.count;
      logger.info(`[Admin] Set tournament "${t.name}" → ${game} (${updated.count} matches updated)`);
    }

    res.json({
      ok: true,
      tournamentsUpdated: tournaments.length,
      matchesUpdated: totalMatchesUpdated,
      tournaments: tournaments.map(t => ({ id: t.id, name: t.name })),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /tournaments/recompute-tiers — re-fetch the real tier from Liquipedia
// for every tournament that has a Liquipedia URL. Updates Tournament.tier in
// place. Use this when the heuristic guesser mis-classified existing rows
// (e.g. WTL Invitational was wrongly tagged 'A' but is actually 'B' on LP).
// Body (optional): { onlyName?: string } — limit to tournaments whose name
// contains this substring (case-insensitive). Otherwise scans all of them.
router.post('/tournaments/recompute-tiers', async (req: Request, res: Response): Promise<void> => {
  try {
    const { onlyName } = req.body as { onlyName?: string };
    const tournaments = await prisma.tournament.findMany({
      where: onlyName ? { name: { contains: onlyName, mode: 'insensitive' } } : {},
      select: { id: true, name: true, tier: true, liquipediaUrl: true },
    });

    res.json({ ok: true, message: `Recomputing tier for ${tournaments.length} tournaments in background` });

    (async () => {
      const { fetchTournamentInfo } = await import('../scrapers/liquipediaScraper');
      let changed = 0;
      let unchanged = 0;
      let failed = 0;
      for (const t of tournaments) {
        try {
          const info = await fetchTournamentInfo(t.liquipediaUrl!);
          if (!info.tier) { failed++; continue; }
          if (info.tier !== t.tier) {
            await prisma.tournament.update({ where: { id: t.id }, data: { tier: info.tier } });
            logger.info(`[Admin] Tier recompute: "${t.name}" ${t.tier} → ${info.tier}`);
            changed++;
          } else {
            unchanged++;
          }
        } catch (err) {
          logger.warn(`[Admin] Tier recompute failed for "${t.name}":`, err);
          failed++;
        }
      }
      logger.info(`[Admin] Tier recompute done — changed=${changed} unchanged=${unchanged} failed=${failed}`);
    })().catch(err => logger.error('[Admin] recompute-tiers error:', err));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /players/seed-all — seed all players via Liquipedia direct scraper
// Sequential with 5s delay between each to avoid LP rate limiting.
let seedAllRunning = false;
router.post('/players/seed-all', async (_req: Request, res: Response): Promise<void> => {
  if (seedAllRunning) {
    res.json({ ok: false, message: 'Seed-all already running, please wait' });
    return;
  }
  const players = await prisma.player.findMany({ select: { id: true, name: true } });
  seedAllRunning = true;
  res.json({ ok: true, message: `Seeding all ${players.length} players via Liquipedia in background (sequential, ~5s/player)` });
  (async () => {
    const { scrapePlayerHistoryFromLiquipedia } = await import('../scrapers/liquipediaPlayerHistoryScraper');
    const { isLpBlocked } = await import('../services/liquipediaLiveScorer');
    let seeded = 0;
    let skipped = 0;
    for (const p of players) {
      // Wait if circuit breaker is active (log only once per wait)
      if (isLpBlocked()) {
        logger.info(`[Admin] seed-all: circuit breaker active, waiting...`);
        while (isLpBlocked()) await new Promise(r => setTimeout(r, 30_000));
        logger.info(`[Admin] seed-all: circuit breaker cleared, resuming`);
      }
      const count = await prisma.playerMatchRecord.count({ where: { playerId: p.id } });
      if (count >= 10) { skipped++; continue; }
      const recentMatch = await prisma.match.findFirst({
        where: { OR: [{ player1Id: p.id }, { player2Id: p.id }] },
        orderBy: { scheduledAt: 'desc' },
        select: { game: true },
      });
      const game = recentMatch?.game ?? 'AoE4';
      await scrapePlayerHistoryFromLiquipedia(p.id, game, count < 5).catch(() => {});
      seeded++;
      await new Promise(r => setTimeout(r, 5000)); // 5s between each player
    }
    logger.info(`[Admin] seed-all done: ${seeded} seeded, ${skipped} skipped (already ≥10 records)`);
  })().catch(err => logger.error('[Admin] seed-all error:', err)).finally(() => { seedAllRunning = false; });
});

// GET /matches — list all upcoming/live matches for admin management
router.get('/matches', async (req: Request, res: Response): Promise<void> => {
  try {
    const statusFilter = req.query.status as string | undefined;
    const matches = await prisma.match.findMany({
      where: statusFilter ? { status: statusFilter as 'UPCOMING' | 'LIVE' | 'COMPLETED' | 'CANCELLED' } : { status: { in: ['UPCOMING', 'LIVE'] } },
      include: {
        player1: { select: { id: true, name: true } },
        player2: { select: { id: true, name: true } },
        tournament: { select: { id: true, name: true, tier: true } },
        _count: { select: { bets: true } },
      },
      orderBy: { scheduledAt: 'asc' },
      take: 100,
    });
    res.json({ data: matches });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /admin/matches/:id/inspect — full match info + all bets with user details
router.get('/matches/:id/inspect', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const match = await prisma.match.findUnique({
      where: { id },
      include: {
        player1:    { select: { id: true, name: true, avatarUrl: true, elo: true } },
        player2:    { select: { id: true, name: true, avatarUrl: true, elo: true } },
        tournament: { select: { id: true, name: true, tier: true } },
        bets: {
          include: {
            user: { select: { id: true, username: true, avatar: true, coins: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        boResults: { orderBy: { boNumber: 'asc' } },
      },
    });

    if (!match) { res.status(404).json({ error: 'Match introuvable' }); return; }

    // Split bets per player
    const betsPlayer1 = match.bets.filter(b => b.selectedPlayer === 1);
    const betsPlayer2 = match.bets.filter(b => b.selectedPlayer === 2);

    const volume1 = betsPlayer1.reduce((s, b) => s + b.amount, 0);
    const volume2 = betsPlayer2.reduce((s, b) => s + b.amount, 0);
    const total   = volume1 + volume2;

    res.json({
      data: {
        match,
        betsPlayer1,
        betsPlayer2,
        stats: {
          total,
          volume1,
          volume2,
          count1: betsPlayer1.length,
          count2: betsPlayer2.length,
          pct1: total > 0 ? Math.round((volume1 / total) * 100) : 50,
          pct2: total > 0 ? Math.round((volume2 / total) * 100) : 50,
        },
      },
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /dedup-matches — find and remove duplicate UPCOMING/LIVE matches
// Keeps the match with the latest scheduledAt, cancels+refunds the others.
router.post('/dedup-matches', async (_req: Request, res: Response): Promise<void> => {
  try {
    // Find all UPCOMING/LIVE matches grouped by player pair + tournament
    const matches = await prisma.match.findMany({
      where: { status: { in: ['UPCOMING', 'LIVE'] } },
      select: { id: true, player1Id: true, player2Id: true, tournamentId: true, scheduledAt: true, status: true },
      orderBy: { scheduledAt: 'desc' },
    });

    // Group by normalized key (sorted player IDs + tournament)
    const groups = new Map<string, typeof matches>();
    for (const m of matches) {
      const pairKey = [m.player1Id, m.player2Id].sort().join(':') + ':' + (m.tournamentId ?? '');
      const existing = groups.get(pairKey) ?? [];
      existing.push(m);
      groups.set(pairKey, existing);
    }

    let removed = 0;
    let refunded = 0;
    const removedIds: string[] = [];

    for (const [, group] of groups) {
      if (group.length <= 1) continue;
      // Keep the first (latest scheduledAt), remove the rest
      const toRemove = group.slice(1);
      for (const dup of toRemove) {
        // Refund any bets on this match
        const bets = await prisma.bet.findMany({ where: { matchId: dup.id, status: 'PENDING' } });
        for (const bet of bets) {
          await prisma.user.update({ where: { id: bet.userId }, data: { coins: { increment: bet.amount } } });
          await prisma.bet.update({ where: { id: bet.id }, data: { status: 'REFUNDED' } });
          refunded++;
        }
        await prisma.match.delete({ where: { id: dup.id } });
        removedIds.push(dup.id);
        removed++;
        logger.info(`[Admin] Dedup: removed duplicate match ${dup.id} (${dup.status}, scheduledAt=${dup.scheduledAt.toISOString()})`);
      }
    }

    res.json({ ok: true, duplicateGroupsFound: [...groups.values()].filter(g => g.length > 1).length, matchesRemoved: removed, betsRefunded: refunded, removedIds });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// DELETE /players/match-records — purge all PlayerMatchRecord entries
// Body: { source?: 'all'|'ai'|'aoe4world'|'liquipedia'|'platform' }
// Default 'all' deletes everything. Use source to only delete one type.
router.delete('/players/match-records', async (req: Request, res: Response): Promise<void> => {
  try {
    const source = (req.body?.source as string) ?? 'all';
    const where = source === 'all' ? {} : { source };
    const result = await prisma.playerMatchRecord.deleteMany({ where });
    logger.info(`[Admin] Purged ${result.count} PlayerMatchRecord entries (source=${source})`);
    res.json({ ok: true, deleted: result.count, source });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /lp-unblock — attempt to automatically unblock our IP from Liquipedia
router.post('/lp-unblock', async (_req: Request, res: Response): Promise<void> => {
  try {
    const { attemptAutoUnblock, isLpBlocked } = await import('../services/liquipediaLiveScorer');
    const blocked = isLpBlocked();
    if (!blocked) {
      res.json({ ok: true, message: 'IP is not currently blocked by circuit breaker', blocked: false });
      return;
    }
    const result = await attemptAutoUnblock();
    res.json({ ok: result.success, ...result, blocked: !result.success });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /lp-status — check if Liquipedia is currently blocked + fetch token/generate raw content
router.get('/lp-status', async (_req: Request, res: Response): Promise<void> => {
  try {
    const { isLpBlocked } = await import('../services/liquipediaLiveScorer');
    const axios = (await import('axios')).default;

    // Fetch token/generate from THIS server's IP to see what LP shows
    let tokenPageContent = '';
    let tokenPageStatus = 0;
    try {
      const r = await axios.get('https://liquipedia.net/token/generate', {
        headers: { 'User-Agent': 'AgeOfMoney/1.0 (contact@ageofmoney.com)' },
        timeout: 10000,
        maxRedirects: 5,
      });
      tokenPageContent = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
      tokenPageStatus = r.status;
    } catch (err: any) {
      tokenPageStatus = err?.response?.status ?? 0;
      tokenPageContent = err?.response?.data ? String(err.response.data).slice(0, 2000) : err.message;
    }

    res.json({
      circuitBreakerActive: isLpBlocked(),
      tokenPage: {
        status: tokenPageStatus,
        content: tokenPageContent.slice(0, 3000),
      },
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Player exact-score debug ────────────────────────────────────────────────
// GET /admin/players/:id/records-debug — full diagnostic of a player's history
// used by the exact score model. Shows raw records, effective sample after
// recency decay, and the observed score distribution.
router.get('/players/:id/records-debug', async (req: Request, res: Response): Promise<void> => {
  try {
    // Accept either a Player.id OR a case-insensitive name — whichever is
    // easier for the admin looking at the panel.
    const param = decodeURIComponent(req.params.id);
    let player = await prisma.player.findUnique({
      where: { id: param },
      select: { id: true, name: true, game: true },
    });
    if (!player) {
      player = await prisma.player.findFirst({
        where: { name: { equals: param, mode: 'insensitive' } },
        select: { id: true, name: true, game: true },
      });
    }
    if (!player) { res.status(404).json({ error: 'Player not found (tried id and name)' }); return; }

    const records = await prisma.playerMatchRecord.findMany({
      where: { playerId: player.id },
      orderBy: { matchDate: 'desc' },
      select: {
        id: true,
        opponentName: true,
        opponentId: true,
        tournamentName: true,
        matchDate: true,
        won: true,
        score: true,
        format: true,
        confidence: true,
        source: true,
      },
    });

    // Recency weight same as exactScoreModel.ts
    const MAX_AGE_DAYS = 720;
    const FRESH_WINDOW_DAYS = 90;
    const MIN_WEIGHT = 0.25;
    const recencyWeight = (matchDate: Date | null): number => {
      if (!matchDate) return 0.5;
      const ageDays = (Date.now() - matchDate.getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays < 0) return 1.0;
      if (ageDays <= FRESH_WINDOW_DAYS) return 1.0;
      if (ageDays >= MAX_AGE_DAYS) return 0;
      const t = (ageDays - FRESH_WINDOW_DAYS) / (MAX_AGE_DAYS - FRESH_WINDOW_DAYS);
      return 1.0 - (1.0 - MIN_WEIGHT) * t;
    };

    // Classify and aggregate
    const byFormat: Record<string, { raw: number; withScore: number; withOpponentId: number }> = {};
    let totalWithScore = 0;
    let totalWithOpponentId = 0;
    let totalConfidenceOk = 0;

    for (const r of records) {
      const fmt = r.format || 'unknown';
      if (!byFormat[fmt]) byFormat[fmt] = { raw: 0, withScore: 0, withOpponentId: 0 };
      byFormat[fmt].raw++;
      if (r.score) { byFormat[fmt].withScore++; totalWithScore++; }
      if (r.opponentId) { byFormat[fmt].withOpponentId++; totalWithOpponentId++; }
      if (r.confidence >= 0.5) totalConfidenceOk++;
    }

    // BO5 distribution with recency decay
    type Dist = Record<string, { rawCount: number; weightedCount: number }>;
    const bo5Dist: Dist = {};
    let bo5EffectiveSample = 0;
    let bo5Raw = 0;
    for (const r of records) {
      if (!r.score) continue;
      if (r.confidence < 0.5) continue;
      if (r.format && r.format !== 'BO5') continue;
      const parts = r.score.split('-').map(s => parseInt(s.trim(), 10));
      if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) continue;
      const [a, b] = parts;
      if (Math.max(a, b) !== 3) continue; // not a BO5 final score
      // Normalize to player's POV
      let my: number, opp: number;
      if (r.won && a > b) { my = a; opp = b; }
      else if (!r.won && a < b) { my = a; opp = b; }
      else continue; // corrupt
      const key = `${my}-${opp}`;
      const w = recencyWeight(r.matchDate);
      if (!bo5Dist[key]) bo5Dist[key] = { rawCount: 0, weightedCount: 0 };
      bo5Dist[key].rawCount++;
      bo5Dist[key].weightedCount += w;
      bo5Raw++;
      if (w > 0) bo5EffectiveSample += w;
    }

    // Compute percentages
    const distPercent: Record<string, { raw: string; weighted: string }> = {};
    for (const [k, v] of Object.entries(bo5Dist)) {
      distPercent[k] = {
        raw: bo5Raw > 0 ? `${((v.rawCount / bo5Raw) * 100).toFixed(1)}% (${v.rawCount})` : '0%',
        weighted: bo5EffectiveSample > 0 ? `${((v.weightedCount / bo5EffectiveSample) * 100).toFixed(1)}% (${v.weightedCount.toFixed(1)})` : '0%',
      };
    }

    res.json({
      data: {
        player: { id: player.id, name: player.name, game: player.game },
        totals: {
          totalRecords: records.length,
          withScore: totalWithScore,
          withOpponentId: totalWithOpponentId,
          confidenceOk: totalConfidenceOk,
        },
        byFormat,
        bo5Analysis: {
          rawCount: bo5Raw,
          effectiveSampleAfterRecencyDecay: parseFloat(bo5EffectiveSample.toFixed(2)),
          wouldGetFullBlendWeight: bo5EffectiveSample >= 15,
          distribution: distPercent,
        },
        recentRecords: records.slice(0, 30).map(r => ({
          date: r.matchDate,
          opponent: r.opponentName,
          opponentIdPresent: !!r.opponentId,
          score: r.score,
          won: r.won,
          format: r.format,
          confidence: r.confidence,
          recencyWeight: parseFloat(recencyWeight(r.matchDate).toFixed(3)),
          source: r.source,
        })),
      },
    });
  } catch (err) {
    logger.error('GET /admin/players/:id/records-debug error:', err);
    res.status(500).json({ error: 'Failed to build debug report' });
  }
});

// ── Affiliate fraud review ──────────────────────────────────────────────────
// GET /admin/affiliate/referrals — list suspicious (or all) referrals
router.get('/affiliate/referrals', async (req: Request, res: Response): Promise<void> => {
  try {
    const filter = (req.query.filter as string) || 'suspicious';
    const where: Record<string, unknown> = {};
    if (filter === 'suspicious') where.suspicious = true;
    else if (filter === 'pending') { where.suspicious = true; where.reviewed = false; }

    const referrals = await prisma.affiliateReferral.findMany({
      where,
      orderBy: { joinedAt: 'desc' },
      take: 200,
      include: { affiliateCode: true },
    });

    const userIds = new Set<string>();
    for (const r of referrals) {
      userIds.add(r.referredUserId);
      userIds.add(r.affiliateCode.userId);
    }
    const users = await prisma.user.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, username: true, avatar: true, coins: true, isBanned: true, lastIpAt: true },
    });
    const userMap = Object.fromEntries(users.map(u => [u.id, u]));

    const data = referrals.map(r => ({
      id: r.id,
      referredUser: userMap[r.referredUserId] ?? null,
      referrer:     userMap[r.affiliateCode.userId] ?? null,
      code:         r.affiliateCode.code,
      totalDeposited: r.totalDeposited,
      totalWagered:   r.totalWagered,
      commission:     r.commission,
      isActive:       r.isActive,
      suspicious:     r.suspicious,
      suspiciousReason: r.suspiciousReason,
      reviewed:       r.reviewed,
      joinedAt:       r.joinedAt,
    }));

    res.json({ data });
  } catch (err) {
    logger.error('GET /admin/affiliate/referrals error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /admin/affiliate/referrals/:id/review — mark a flagged referral as reviewed OK
router.post('/affiliate/referrals/:id/review', async (req: Request, res: Response): Promise<void> => {
  try {
    const ref = await prisma.affiliateReferral.update({
      where: { id: req.params.id },
      data:  { reviewed: true },
    });
    res.json({ data: ref });
  } catch (err) {
    logger.error('POST review error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /admin/affiliate/referrals/:id/revoke — confiscate commission earned from this referral
// Deducts the commission from the affiliate's balances and marks the referral as reviewed.
router.post('/affiliate/referrals/:id/revoke', async (req: Request, res: Response): Promise<void> => {
  try {
    const ref = await prisma.affiliateReferral.findUnique({
      where: { id: req.params.id },
      include: { affiliateCode: true },
    });
    if (!ref) { res.status(404).json({ error: 'Referral introuvable' }); return; }

    const toRevoke = ref.commission;
    await prisma.$transaction([
      prisma.affiliateCode.update({
        where: { id: ref.affiliateCodeId },
        data: {
          available:     { decrement: Math.min(toRevoke, ref.affiliateCode.available) },
          totalEarnings: { decrement: toRevoke },
        },
      }),
      prisma.affiliateReferral.update({
        where: { id: ref.id },
        data: { commission: 0, netLossBalance: 0, reviewed: true },
      }),
    ]);

    logger.warn(`[Admin] Revoked ${toRevoke}⚜ commission from referral ${ref.id} (code=${ref.affiliateCode.code})`);
    res.json({ ok: true, revoked: toRevoke });
  } catch (err) {
    logger.error('POST revoke error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
