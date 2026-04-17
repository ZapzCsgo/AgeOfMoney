import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  createCoinFlip,
  joinCoinFlip,
  cancelCoinFlip,
  getActiveCoinFlips,
  getCoinFlipHistory,
} from '../services/coinflipService';
import logger from '../logger';

const router = Router();

// GET /coinflip — active games (WAITING + recently completed)
router.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const games = await getActiveCoinFlips();
    res.json({ data: games });
  } catch (err) {
    logger.error('GET /coinflip error:', err);
    res.status(500).json({ error: 'Failed to fetch coinflip games' });
  }
});

// GET /coinflip/history — current user's history
router.get('/history', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const games = await getCoinFlipHistory(userId);
    res.json({ data: games });
  } catch (err) {
    logger.error('GET /coinflip/history error:', err);
    res.status(500).json({ error: 'Failed to fetch coinflip history' });
  }
});

// POST /coinflip/create — create a new game
router.post('/create', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const { amount, side } = req.body as { amount: number; side: 'crown' | 'shield' };

    if (!amount || typeof amount !== 'number') {
      res.status(400).json({ error: 'Invalid amount' });
      return;
    }
    if (!side || !['crown', 'shield'].includes(side)) {
      res.status(400).json({ error: 'Side must be "crown" or "shield"' });
      return;
    }

    const result = await createCoinFlip(userId, Math.floor(amount), side);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({ ok: true, data: result.data });
  } catch (err) {
    logger.error('POST /coinflip/create error:', err);
    res.status(500).json({ error: 'Failed to create coinflip game' });
  }
});

// POST /coinflip/:id/join — join an existing game
router.post('/:id/join', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const gameId = req.params.id;
    if (!gameId) { res.status(400).json({ error: 'Game ID required' }); return; }

    const result = await joinCoinFlip(userId, gameId);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({ ok: true, data: result.data });
  } catch (err) {
    logger.error('POST /coinflip/:id/join error:', err);
    res.status(500).json({ error: 'Failed to join coinflip game' });
  }
});

// POST /coinflip/:id/cancel — cancel own waiting game
router.post('/:id/cancel', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const gameId = req.params.id;
    if (!gameId) { res.status(400).json({ error: 'Game ID required' }); return; }

    const result = await cancelCoinFlip(userId, gameId);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({ ok: true });
  } catch (err) {
    logger.error('POST /coinflip/:id/cancel error:', err);
    res.status(500).json({ error: 'Failed to cancel coinflip game' });
  }
});

export default router;
