/**
 * Owner-only Event Opportunities routes — /api/v1/admin/events/*
 *
 * Each route is gated by requireOwner. Non-owner attempts get logged as
 * a privilege-escalation probe with full context (same pattern as
 * /admin/finance).
 */

import { Router, Request, Response } from 'express';
import { requireOwner } from '../middleware/auth';
import {
  detectAll,
  listActive,
  markSeen,
  markActed,
  dismiss,
  badgeCount,
  RuleType,
} from '../services/eventOpportunityService';
import logger from '../logger';

const router = Router();

router.use(requireOwner);

const ALLOWED_RULE_TYPES: RuleType[] = [
  'DAU_DROP', 'DEPOSITS_NOT_ACTIVATED', 'VIP_INACTIVE', 'S_TIER_INCOMING',
  'AFFILIATE_SURGE', 'LOW_JACKPOT', 'VOLUME_RECORD', 'BIG_WINNER',
];

function parseRuleType(q: unknown): RuleType | 'all' {
  if (typeof q === 'string' && (ALLOWED_RULE_TYPES as string[]).includes(q)) {
    return q as RuleType;
  }
  return 'all';
}

function parsePriority(q: unknown): 'LOW' | 'MEDIUM' | 'HIGH' | 'all' {
  if (q === 'LOW' || q === 'MEDIUM' || q === 'HIGH') return q;
  return 'all';
}

function parseStatus(q: unknown): 'NEW' | 'SEEN' | 'all' {
  if (q === 'NEW' || q === 'SEEN') return q;
  return 'all';
}

// GET /api/v1/admin/events?status=NEW&priority=HIGH&ruleType=VIP_INACTIVE
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await listActive({
      status:   parseStatus(req.query.status),
      priority: parsePriority(req.query.priority),
      ruleType: parseRuleType(req.query.ruleType),
    });
    res.json({ data });
  } catch (err) {
    logger.error('GET /admin/events error:', err);
    res.status(500).json({ error: 'Failed to list opportunities' });
  }
});

// GET /api/v1/admin/events/badge-count — sidebar dot
router.get('/badge-count', async (_req: Request, res: Response): Promise<void> => {
  try {
    const count = await badgeCount();
    res.json({ data: { count } });
  } catch (err) {
    logger.error('GET /admin/events/badge-count error:', err);
    res.status(500).json({ error: 'Failed to compute badge count' });
  }
});

// POST /api/v1/admin/events/scan-now — force a detection run right now
router.post('/scan-now', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await detectAll();
    logger.info(`[EventScanner] Manual scan by user=${req.user?.id} — ${result.created} created, ${result.skipped} skipped`);
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error('POST /admin/events/scan-now error:', err);
    res.status(500).json({ error: 'Scan failed' });
  }
});

// POST /api/v1/admin/events/mark-seen — bulk transition NEW → SEEN
router.post('/mark-seen', async (req: Request, res: Response): Promise<void> => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: unknown) => typeof x === 'string') : [];
    const updated = await markSeen(ids);
    res.json({ ok: true, updated });
  } catch (err) {
    logger.error('POST /admin/events/mark-seen error:', err);
    res.status(500).json({ error: 'Failed to mark as seen' });
  }
});

// POST /api/v1/admin/events/:id/acted
router.post('/:id/acted', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    if (!id) { res.status(400).json({ error: 'Event id required' }); return; }
    const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 500) : undefined;
    await markActed(id, note);
    logger.info(`[EventScanner] Acted on ${id} by user=${req.user?.id}${note ? ` with note` : ''}`);
    res.json({ ok: true });
  } catch (err) {
    logger.error('POST /admin/events/:id/acted error:', err);
    res.status(500).json({ error: 'Failed to mark as acted' });
  }
});

// POST /api/v1/admin/events/:id/dismiss
router.post('/:id/dismiss', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id;
    if (!id) { res.status(400).json({ error: 'Event id required' }); return; }
    const forDays = Math.max(1, Math.min(parseInt(String(req.body?.forDays ?? '7'), 10) || 7, 60));
    await dismiss(id, forDays);
    logger.info(`[EventScanner] Dismissed ${id} for ${forDays} days by user=${req.user?.id}`);
    res.json({ ok: true });
  } catch (err) {
    logger.error('POST /admin/events/:id/dismiss error:', err);
    res.status(500).json({ error: 'Failed to dismiss' });
  }
});

export default router;
