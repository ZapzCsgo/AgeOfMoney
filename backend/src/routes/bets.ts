import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { placeBet, getUserStats } from '../services/betService';
import { prisma } from '../index';
import { z } from 'zod';
import logger from '../logger';

const router = Router();

const placeBetSchema = z.object({
  matchId: z.string().min(1),
  amount: z.number().int().min(10, 'Minimum bet is 10 coins').max(500, 'Maximum bet is 500 coins'),
  selectedPlayer: z.union([z.literal(1), z.literal(2)]),
});

// POST / - Place a bet
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = placeBetSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid bet data', details: parsed.error.flatten() });
      return;
    }

    const { matchId, amount, selectedPlayer } = parsed.data;
    const userId = req.user!.id;

    const bet = await placeBet(userId, matchId, amount, selectedPlayer);

    res.status(201).json({ data: bet, message: 'Bet placed successfully' });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('Insufficient') || error.message.includes('closed') ||
          error.message.includes('already') || error.message.includes('not found') ||
          error.message.includes('maximum')) {
        res.status(400).json({ error: error.message });
        return;
      }
    }
    logger.error('POST /bets error:', error);
    res.status(500).json({ error: 'Failed to place bet' });
  }
});

// GET /my - Get current user's bets
router.get('/my', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const statusFilter = req.query.status as string | undefined;
    const limit = parseInt(req.query.limit as string || '20');
    const offset = parseInt(req.query.offset as string || '0');

    const whereClause: Record<string, unknown> = { userId };
    if (statusFilter) {
      whereClause.status = statusFilter;
    }

    const [bets, total] = await Promise.all([
      prisma.bet.findMany({
        where: whereClause,
        include: {
          match: {
            include: {
              player1: { select: { id: true, name: true, country: true } },
              player2: { select: { id: true, name: true, country: true } },
              tournament: { select: { id: true, name: true, tier: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: Math.min(limit, 100),
        skip: offset,
      }),
      prisma.bet.count({ where: whereClause }),
    ]);

    const stats = await getUserStats(userId);

    res.json({ data: bets, total, stats, limit, offset });
  } catch (error) {
    logger.error('GET /bets/my error:', error);
    res.status(500).json({ error: 'Failed to fetch bets' });
  }
});

// GET /match/:matchId - Get anonymized bet totals for a match
router.get('/match/:matchId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { matchId } = req.params;

    const match = await prisma.match.findUnique({
      where: { id: matchId },
      select: { id: true },
    });

    if (!match) {
      res.status(404).json({ error: 'Match not found' });
      return;
    }

    const betAgg = await prisma.bet.groupBy({
      by: ['selectedPlayer'],
      where: { matchId, status: { notIn: ['CANCELLED', 'REFUNDED'] } },
      _sum: { amount: true },
      _count: true,
    });

    const vol1 = betAgg.find((b) => b.selectedPlayer === 1)?._sum?.amount ?? 0;
    const vol2 = betAgg.find((b) => b.selectedPlayer === 2)?._sum?.amount ?? 0;
    const count1 = betAgg.find((b) => b.selectedPlayer === 1)?._count ?? 0;
    const count2 = betAgg.find((b) => b.selectedPlayer === 2)?._count ?? 0;
    const totalVol = vol1 + vol2;

    res.json({
      data: {
        matchId,
        player1: { volume: vol1, count: count1 },
        player2: { volume: vol2, count: count2 },
        total: totalVol,
        pct1: totalVol > 0 ? Math.round((vol1 / totalVol) * 100) : 50,
        pct2: totalVol > 0 ? Math.round((vol2 / totalVol) * 100) : 50,
      },
    });
  } catch (error) {
    logger.error('GET /bets/match/:matchId error:', error);
    res.status(500).json({ error: 'Failed to fetch bet data' });
  }
});

export default router;
