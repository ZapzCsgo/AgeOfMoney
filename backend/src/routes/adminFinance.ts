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
  computeUserGrowth,
  queryCashflow,
  exportCashflowCsv,
  detectAnomalies,
  dismissAnomaly,
  CashflowType,
  CashflowStatus,
  CashflowFilters,
  clearFinanceCache,
  RangePreset,
} from '../services/adminFinanceService';
import logger from '../logger';

const router = Router();

router.use(requireOwner);

const ALLOWED_RANGES: RangePreset[] = ['1d', '7d', '30d', '90d', 'mtd', 'all'];
const ALLOWED_CASHFLOW_TYPES: CashflowType[] = ['all', 'deposit', 'withdrawal', 'bet_win', 'bet_loss', 'refund', 'bonus'];
const ALLOWED_CASHFLOW_STATUSES: CashflowStatus[] = ['all', 'pending', 'completed', 'failed'];

function parseRange(q: unknown): RangePreset {
  if (typeof q === 'string' && (ALLOWED_RANGES as string[]).includes(q)) {
    return q as RangePreset;
  }
  return '7d';
}

function parseCashflowType(q: unknown): CashflowType {
  if (typeof q === 'string' && (ALLOWED_CASHFLOW_TYPES as string[]).includes(q)) {
    return q as CashflowType;
  }
  return 'all';
}

function parseCashflowStatus(q: unknown): CashflowStatus {
  if (typeof q === 'string' && (ALLOWED_CASHFLOW_STATUSES as string[]).includes(q)) {
    return q as CashflowStatus;
  }
  return 'all';
}

function parseFiltersFromQuery(query: Request['query']): CashflowFilters {
  const range = parseRange(query.range);
  const type = parseCashflowType(query.type);
  const status = parseCashflowStatus(query.status);
  const searchRaw = typeof query.search === 'string' ? query.search : '';
  const search = searchRaw.trim().slice(0, 64); // bound for safety
  const min = typeof query.minAmount === 'string' ? parseInt(query.minAmount, 10) : NaN;
  const max = typeof query.maxAmount === 'string' ? parseInt(query.maxAmount, 10) : NaN;
  return {
    range,
    type,
    status,
    search: search || undefined,
    minAmount: Number.isFinite(min) ? min : undefined,
    maxAmount: Number.isFinite(max) ? max : undefined,
  };
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

// GET /api/v1/admin/finance/users?range=7d
// DAU / WAU / MAU / Stickiness + sparkline + signups daily + retention
// (D1/D7/D14/D30) + lifetime deposits frequency histogram.
router.get('/users', async (req: Request, res: Response): Promise<void> => {
  try {
    const range = parseRange(req.query.range);
    const data = await computeUserGrowth(range);
    res.json({ data });
  } catch (err) {
    logger.error('GET /admin/finance/users error:', err);
    res.status(500).json({ error: 'Failed to compute user growth' });
  }
});

// GET /api/v1/admin/finance/cashflow?range=7d&type=deposit&status=completed&search=&minAmount=&maxAmount=&page=1&limit=50
// Paginated transaction list with filters. No cache — this is the live
// operational ledger, must be fresh on every request.
router.get('/cashflow', async (req: Request, res: Response): Promise<void> => {
  try {
    const filters = parseFiltersFromQuery(req.query);
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const limit = Math.max(10, Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 100));
    const data = await queryCashflow(filters, page, limit);
    res.json({ data });
  } catch (err) {
    logger.error('GET /admin/finance/cashflow error:', err);
    res.status(500).json({ error: 'Failed to load cashflow' });
  }
});

// GET /api/v1/admin/finance/cashflow/export?range=7d&type=&status=&search=&minAmount=&maxAmount=
// CSV dump of matching transactions (cap 10k rows).
router.get('/cashflow/export', async (req: Request, res: Response): Promise<void> => {
  try {
    const filters = parseFiltersFromQuery(req.query);
    const csv = await exportCashflowCsv(filters);
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `ageofmoney_finance_cashflow_${filters.range}_${stamp}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    logger.error('GET /admin/finance/cashflow/export error:', err);
    res.status(500).json({ error: 'Failed to export cashflow' });
  }
});

// GET /api/v1/admin/finance/anomalies
// Returns the currently-active anomalies (dismissed ones filtered out).
// Cached 60 s.
router.get('/anomalies', async (_req: Request, res: Response): Promise<void> => {
  try {
    const data = await detectAnomalies();
    res.json({ data });
  } catch (err) {
    logger.error('GET /admin/finance/anomalies error:', err);
    res.status(500).json({ error: 'Failed to detect anomalies' });
  }
});

// POST /api/v1/admin/finance/anomalies/:key/dismiss
// Dismiss a specific anomaly for 7 days. The key is URL-encoded because it
// contains colons.
router.post('/anomalies/:key/dismiss', async (req: Request, res: Response): Promise<void> => {
  try {
    const key = decodeURIComponent(req.params.key ?? '').trim();
    if (!key) { res.status(400).json({ error: 'Key required' }); return; }
    dismissAnomaly(key);
    // Bust the anomalies cache so the next GET reflects the dismissal immediately
    clearFinanceCache('finance:anomalies');
    logger.info(`[Finance] Anomaly dismissed key=${key} by user=${req.user?.id}`);
    res.json({ ok: true });
  } catch (err) {
    logger.error('POST /admin/finance/anomalies/:key/dismiss error:', err);
    res.status(500).json({ error: 'Failed to dismiss anomaly' });
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
