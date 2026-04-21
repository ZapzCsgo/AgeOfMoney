/**
 * Owner-only finance dashboard routes — /api/v1/admin/finance/*
 *
 * Every route is gated by `requireOwner` (see middleware/auth.ts). Non-owner
 * attempts are logged with full context so any privilege-escalation probing
 * is visible in Railway logs.
 *
 * This file ships stubs for step 1 — the real aggregations arrive in step 2
 * (adminFinanceService). The stubs respond 200 with a shape the frontend
 * can already consume, so the end-to-end auth check is live without waiting
 * for the heavy SQL work.
 */

import { Router, Request, Response } from 'express';
import { requireOwner } from '../middleware/auth';
import logger from '../logger';

const router = Router();

router.use(requireOwner);

// GET /api/v1/admin/finance/overview — placeholder until step 2 lands.
router.get('/overview', async (req: Request, res: Response): Promise<void> => {
  try {
    res.json({
      data: {
        range: 'placeholder',
        generatedAt: new Date().toISOString(),
        ggr: 0,
        ngr: 0,
        cashPosition: 0,
        activeUserLiability: 0,
        totalDeposits: 0,
        totalWithdrawals: 0,
        deltas: null,
        sparklines: {},
        note: 'Step 1 stub — real aggregations land in step 2 (adminFinanceService).',
      },
    });
  } catch (err) {
    logger.error('GET /admin/finance/overview error:', err);
    res.status(500).json({ error: 'Failed to compute finance overview' });
  }
});

export default router;
