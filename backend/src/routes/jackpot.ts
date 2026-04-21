import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  placeBet,
  getCurrentJackpot,
  getJackpotHistory,
  getJackpotFair,
} from '../services/jackpotService';
import logger from '../logger';

const router = Router();

// GET /jackpot — current round (OPEN or CLOSING) with live bets
router.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const round = await getCurrentJackpot();
    res.json({ data: round });
  } catch (err) {
    logger.error('GET /jackpot error:', err);
    res.status(500).json({ error: 'Failed to fetch current jackpot round' });
  }
});

// GET /jackpot/history — recent completed rounds for the Historique tab
router.get('/history', async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = Math.min(parseInt((req.query.limit as string) ?? '30'), 100);
    const rounds = await getJackpotHistory(limit);
    res.json({ data: rounds });
  } catch (err) {
    logger.error('GET /jackpot/history error:', err);
    res.status(500).json({ error: 'Failed to fetch jackpot history' });
  }
});

// GET /jackpot/fair/:id — full provably-fair disclosure (serverSeed, RNG evidence)
// Public endpoint: anyone can verify any settled round.
router.get('/fair/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const roundId = req.params.id;
    if (!roundId) { res.status(400).json({ error: 'Round ID required' }); return; }
    const round = await getJackpotFair(roundId);
    if (!round) { res.status(404).json({ error: 'Round not found' }); return; }
    res.json({ data: round });
  } catch (err) {
    logger.error('GET /jackpot/fair/:id error:', err);
    res.status(500).json({ error: 'Failed to fetch jackpot fair data' });
  }
});

// POST /jackpot/bet — enter the current round
router.post('/bet', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const { amount } = req.body as { amount: number };
    if (!amount || typeof amount !== 'number') {
      res.status(400).json({ error: 'Invalid amount' });
      return;
    }

    const result = await placeBet(userId, Math.floor(amount));
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ ok: true, data: result.data });
  } catch (err) {
    logger.error('POST /jackpot/bet error:', err);
    res.status(500).json({ error: 'Failed to place jackpot bet' });
  }
});

export default router;
