import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { getCurrentRound, placeBet, Zone } from '../services/rouletteService';
import { prisma } from '../index';
import logger from '../logger';

const router = Router();

// GET /roulette/current — current round state
router.get('/current', async (_req: Request, res: Response): Promise<void> => {
  try {
    const round = await getCurrentRound();
    if (!round) {
      res.json({ data: null });
      return;
    }
    res.json({ data: round });
  } catch (err) {
    logger.error('GET /roulette/current error:', err);
    res.status(500).json({ error: 'Failed to fetch round' });
  }
});

// GET /roulette/history — last 20 completed rounds
router.get('/history', async (_req: Request, res: Response): Promise<void> => {
  try {
    const rounds = await prisma.rouletteRound.findMany({
      where: { status: 'COMPLETED', winZone: { not: null } },
      orderBy: { completedAt: 'desc' },
      take: 50,
      select: { id: true, result: true, winZone: true, multiplier: true, completedAt: true, roundHash: true, serverSeed: true },
    });
    res.json({ data: rounds });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// GET /roulette/my — current user's roulette bet history
router.get('/my', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as Request & { user?: { id: string } }).user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const bets = await prisma.rouletteBet.findMany({
      where: { userId },
      include: {
        round: { select: { id: true, winZone: true, multiplier: true, status: true, completedAt: true, result: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ data: bets });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch roulette bets' });
  }
});

// POST /roulette/bet — place a bet
router.post('/bet', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as Request & { user?: { id: string } }).user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const { zone, amount } = req.body as { zone: Zone; amount: number };
    if (!['KNIGHTS', 'EMPEROR', 'ARCHERS'].includes(zone)) {
      res.status(400).json({ error: 'Invalid zone' });
      return;
    }
    if (!amount || typeof amount !== 'number') {
      res.status(400).json({ error: 'Invalid amount' });
      return;
    }

    // Decimal-aware : the service accepts fractional amounts (round to 2 dp
    // to match the frontend display + Decimal(20, 8) backend storage).
    const result = await placeBet(userId, zone, Math.round(amount * 100) / 100);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({ ok: true });
  } catch (err) {
    logger.error('POST /roulette/bet error:', err);
    res.status(500).json({ error: 'Failed to place bet' });
  }
});

export default router;
