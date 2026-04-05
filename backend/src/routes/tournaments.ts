import { Router, Request, Response } from 'express';
import { prisma } from '../index';
import logger from '../logger';

const router = Router();

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const isActive = req.query.active !== undefined ? req.query.active === 'true' : undefined;
    const tier = req.query.tier as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string || '20'), 100);
    const offset = parseInt(req.query.offset as string || '0');

    const whereClause: Record<string, unknown> = {};
    if (isActive !== undefined) whereClause.isActive = isActive;
    if (tier) whereClause.tier = tier;
    // Exclude tournaments that ended in the past (keep ones with no endDate or endDate in the future)
    if (isActive) {
      whereClause.OR = [
        { endDate: null },
        { endDate: { gte: new Date() } },
      ];
    }

    const [tournaments, total] = await Promise.all([
      prisma.tournament.findMany({
        where: whereClause,
        // For active tournaments: soonest upcoming first; otherwise most recent first
        orderBy: isActive
          ? [{ startDate: 'asc' }]
          : [{ isActive: 'desc' }, { startDate: 'desc' }],
        take: limit,
        skip: offset,
        include: {
          _count: { select: { matches: true } },
        },
      }),
      prisma.tournament.count({ where: whereClause }),
    ]);

    res.json({ data: tournaments, total, limit, offset });
  } catch (error) {
    logger.error('GET /tournaments error:', error);
    res.status(500).json({ error: 'Failed to fetch tournaments' });
  }
});

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const tournament = await prisma.tournament.findUnique({
      where: { id },
    });

    if (!tournament) {
      res.status(404).json({ error: 'Tournament not found' });
      return;
    }

    const matches = await prisma.match.findMany({
      where: { tournamentId: id },
      include: {
        player1: { select: { id: true, name: true, elo: true, country: true, avatarUrl: true } },
        player2: { select: { id: true, name: true, elo: true, country: true, avatarUrl: true } },
      },
      orderBy: { scheduledAt: 'asc' },
    });

    // Group matches by round/stage if format info is available
    const upcoming = matches.filter((m) => m.status === 'UPCOMING');
    const live = matches.filter((m) => m.status === 'LIVE');
    const completed = matches.filter((m) => m.status === 'COMPLETED');

    // Calculate unique participants
    const participantIds = new Set<string>();
    matches.forEach((m) => {
      participantIds.add(m.player1Id);
      participantIds.add(m.player2Id);
    });

    res.json({
      data: {
        ...tournament,
        matches: { upcoming, live, completed, all: matches },
        participantCount: participantIds.size,
      },
    });
  } catch (error) {
    logger.error('GET /tournaments/:id error:', error);
    res.status(500).json({ error: 'Failed to fetch tournament' });
  }
});

export default router;
