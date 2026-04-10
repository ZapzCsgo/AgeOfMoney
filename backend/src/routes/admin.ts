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

    const whereClause: Record<string, unknown> = {};
    if (search) {
      whereClause.OR = [
        { username: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          username: true,
          email: true,
          avatar: true,
          coins: true,
          isAdmin: true,
          isMod: true,
          isBanned: true,
          provider: true,
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

// GET /players — list all players with their match record counts
router.get('/players', async (_req: Request, res: Response): Promise<void> => {
  try {
    const players = await prisma.player.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true, name: true, aoe4worldId: true, winrate: true,
        totalGames: true, country: true, lastUpdatedAt: true,
        game: true, aiEnrichedGames: true,
        _count: { select: { matchHistory: true } },
      },
    });
    res.json({ data: players });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /players/:id/seed-history — seed a specific player's history
// Body: { force?: boolean, game?: 'AoE1'|'AoE2'|'AoE3'|'AoE4'|'AoM' }
// When `game` is provided, it overrides the auto-detection from recent matches
// — used by the admin to fix mis-classifications (e.g. an AoE1 player tagged AoE4).
router.post('/players/:id/seed-history', async (req: Request, res: Response): Promise<void> => {
  try {
    const player = await prisma.player.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, aoe4worldId: true } });
    if (!player) { res.status(404).json({ error: 'Player not found' }); return; }
    const force = req.body?.force === true;
    const overrideGame = typeof req.body?.game === 'string' ? req.body.game as string : null;
    res.json({ ok: true, message: `Seeding started for ${player.name}${overrideGame ? ` (game: ${overrideGame})` : ''}` });
    (async () => {
      // aoe4world only makes sense for AoE4 players
      const isAoE4Path = (overrideGame ?? 'AoE4') === 'AoE4';
      if (isAoE4Path && player.aoe4worldId) {
        const { seedPlayerHistoryFromAoe4World } = await import('../scrapers/aoe4worldPlayerHistorySeeder');
        const { buildProPlayerSet } = await import('../scrapers/aoe4worldScraper');
        const proIds = await buildProPlayerSet();
        await seedPlayerHistoryFromAoe4World(player.id, player.name, player.aoe4worldId, proIds, force);
      }
      if (process.env.ANTHROPIC_API_KEY) {
        const { enrichPlayerWithAI } = await import('../scrapers/aiPlayerHistoryScraper');
        let game = overrideGame;
        if (!game) {
          // Auto-detect from the player's most recent match
          const recentMatch = await prisma.match.findFirst({
            where: { OR: [{ player1Id: player.id }, { player2Id: player.id }] },
            orderBy: { scheduledAt: 'desc' },
            select: { game: true },
          });
          game = recentMatch?.game ?? 'AoE4';
        }
        // When admin provides an explicit game override, also tag the player
        // with that game so all future H2H queries pick the right records.
        if (overrideGame) {
          await prisma.player.update({
            where: { id: player.id },
            data: { game: overrideGame },
          }).catch(() => {});
        }
        await enrichPlayerWithAI(player.id, player.name, force, game);
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

// POST /players/seed-all — seed all players missing history
// Players with <5 records are force-reseeded (Claude is re-queried even if some data exists)
router.post('/players/seed-all', async (_req: Request, res: Response): Promise<void> => {
  const players = await prisma.player.findMany({ select: { id: true, name: true } });
  res.json({ ok: true, message: `Seeding all ${players.length} players in background` });
  (async () => {
    const { seedAllPlayerHistories } = await import('../scrapers/aoe4worldPlayerHistorySeeder');
    await seedAllPlayerHistories(false);
    if (process.env.ANTHROPIC_API_KEY) {
      const { enrichPlayerWithAI } = await import('../scrapers/aiPlayerHistoryScraper');
      const { enrichAllProPlayers } = await import('../scrapers/aiPlayerHistoryScraper');
      // Force-reseed players with very few records — Claude may have more data
      for (const p of players) {
        const count = await prisma.playerMatchRecord.count({ where: { playerId: p.id } });
        const force = count < 5; // re-query even if some records exist
        // Detect game from the player's most recent match
        const recentMatch = await prisma.match.findFirst({
          where: { OR: [{ player1Id: p.id }, { player2Id: p.id }] },
          orderBy: { scheduledAt: 'desc' },
          select: { game: true },
        });
        const game = recentMatch?.game ?? 'AoE4';
        await enrichPlayerWithAI(p.id, p.name, force, game).catch(() => {});
        await new Promise(r => setTimeout(r, 4000)); // rate limit
      }
    }
  })().catch(err => logger.error('[Admin] seed-all error:', err));
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

export default router;
