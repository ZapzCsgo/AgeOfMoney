import { Router, Request, Response } from 'express';
import { prisma } from '../index';
import logger from '../logger';

const router = Router();

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const search = req.query.search as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string || '50'), 100);
    const offset = parseInt(req.query.offset as string || '0');

    const whereClause: Record<string, unknown> = {};
    if (search) {
      whereClause.name = { contains: search, mode: 'insensitive' };
    }

    const [players, total] = await Promise.all([
      prisma.player.findMany({
        where: whereClause,
        orderBy: { elo: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          name: true,
          elo: true,
          winrate: true,
          country: true,
          avatarUrl: true,
          lastMatchAt: true,
          _count: {
            select: {
              matchesAsPlayer1: true,
              matchesAsPlayer2: true,
            },
          },
        },
      }),
      prisma.player.count({ where: whereClause }),
    ]);

    res.json({ data: players, total, limit, offset });
  } catch (error) {
    logger.error('GET /players error:', error);
    res.status(500).json({ error: 'Failed to fetch players' });
  }
});

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const player = await prisma.player.findUnique({
      where: { id },
    });

    if (!player) {
      res.status(404).json({ error: 'Player not found' });
      return;
    }

    // Recent matches
    const recentMatches = await prisma.match.findMany({
      where: {
        status: 'COMPLETED',
        OR: [{ player1Id: id }, { player2Id: id }],
      },
      orderBy: { scheduledAt: 'desc' },
      take: 10,
      include: {
        player1: { select: { id: true, name: true, country: true } },
        player2: { select: { id: true, name: true, country: true } },
        tournament: { select: { id: true, name: true, tier: true } },
      },
    });

    // Tournament wins
    const tournamentWins = await prisma.match.count({
      where: {
        status: 'COMPLETED',
        winnerId: id,
        format: 'GRAND_FINAL',
      },
    });

    // Total match stats
    const totalMatches = await prisma.match.count({
      where: {
        status: 'COMPLETED',
        OR: [{ player1Id: id }, { player2Id: id }],
      },
    });

    const wins = await prisma.match.count({
      where: {
        status: 'COMPLETED',
        winnerId: id,
      },
    });

    res.json({
      data: {
        ...player,
        stats: {
          totalMatches,
          wins,
          losses: totalMatches - wins,
          tournamentWins,
          winrateCalculated: totalMatches > 0 ? wins / totalMatches : 0,
        },
        recentMatches,
      },
    });
  } catch (error) {
    logger.error('GET /players/:id error:', error);
    res.status(500).json({ error: 'Failed to fetch player' });
  }
});

export default router;
