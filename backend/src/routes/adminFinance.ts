/**
 * Owner-only finance dashboard routes — /api/v1/admin/finance/*
 *
 * Every route is gated by `requireOwner` (see middleware/auth.ts). Non-owner
 * attempts are logged with full context so any privilege-escalation probing
 * is visible in Railway logs.
 */

import { Router, Request, Response } from 'express';
import { requireOwner } from '../middleware/auth';
import {
  computeFinanceOverview,
  computeProductBreakdown,
  computePnlSummary,
  computeAffiliateStats,
  clearFinanceCache,
  RangePreset,
} from '../services/adminFinanceService';
import logger from '../logger';

const router = Router();

router.use(requireOwner);

const ALLOWED_RANGES: RangePreset[] = ['1d', '7d', '30d', '90d', 'mtd', 'all'];

function parseRange(q: unknown): RangePreset {
  if (typeof q === 'string' && (ALLOWED_RANGES as string[]).includes(q)) {
    return q as RangePreset;
  }
  return '7d';
}

// GET /api/v1/admin/finance/overview?range=7d
// Aggregate KPIs for the period + previous-period deltas + 7-day sparklines.
router.get('/overview', async (req: Request, res: Response): Promise<void> => {
  try {
    const range = parseRange(req.query.range);
    const data = await computeFinanceOverview(range);
    res.json({ data });
  } catch (err) {
    logger.error('GET /admin/finance/overview error:', err);
    res.status(500).json({ error: 'Failed to compute finance overview' });
  }
});

// GET /api/v1/admin/finance/products?range=7d
// Per-product breakdown: bets placed, volume staked, house revenue, margin%.
router.get('/products', async (req: Request, res: Response): Promise<void> => {
  try {
    const range = parseRange(req.query.range);
    const data = await computeProductBreakdown(range);
    res.json({ data });
  } catch (err) {
    logger.error('GET /admin/finance/products error:', err);
    res.status(500).json({ error: 'Failed to compute product breakdown' });
  }
});

// GET /api/v1/admin/finance/affiliates?range=7d&limit=10
// Global affiliate KPIs + top N affiliates ranked by commission paid in window.
router.get('/affiliates', async (req: Request, res: Response): Promise<void> => {
  try {
    const range = parseRange(req.query.range);
    const limit = Math.max(1, Math.min(parseInt(String(req.query.limit ?? '10'), 10) || 10, 50));
    const data = await computeAffiliateStats(range, limit);
    res.json({ data });
  } catch (err) {
    logger.error('GET /admin/finance/affiliates error:', err);
    res.status(500).json({ error: 'Failed to compute affiliate stats' });
  }
});

// GET /api/v1/admin/finance/pnl
// P&L summary — today / 7d / 30d / lifetime, each with NGR in coins + EUR
// equivalent and net cash. Lifetime row also returns the realized profit
// (net deposits - current liability in cents).
router.get('/pnl', async (_req: Request, res: Response): Promise<void> => {
  try {
    const data = await computePnlSummary();
    res.json({ data });
  } catch (err) {
    logger.error('GET /admin/finance/pnl error:', err);
    res.status(500).json({ error: 'Failed to compute P&L summary' });
  }
});

// POST /api/v1/admin/finance/cache/clear — drop the in-memory cache
// (useful to force-refresh without waiting for TTL). Optional ?prefix=overview
router.post('/cache/clear', async (req: Request, res: Response): Promise<void> => {
  const prefix = typeof req.query.prefix === 'string' ? req.query.prefix : undefined;
  clearFinanceCache(prefix ? `finance:${prefix}:` : undefined);
  logger.info(`[Finance] Cache cleared (prefix=${prefix ?? 'all'}) by user=${req.user?.id}`);
  res.json({ ok: true });
});

export default router;
