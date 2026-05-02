/**
 * Admin-side redeem-code routes.
 *
 * Mounted at `/api/v1/admin/redeem-codes`.
 *
 * Auth split (deliberate) :
 *   - LIST + STATS : `requireAdmin` — any admin can read who redeemed what.
 *   - CREATE / DISABLE : `requireOwner` — only the site operator can mint
 *     or kill codes. Even isAdmin doesn't grant this. The middleware
 *     already logs every non-owner attempt at warn level.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAdmin, requireOwner } from '../middleware/auth';
import { listCodes, getCodeStats, createCode, disableCode } from '../services/redeemCodeService';
import logger from '../logger';

const router = Router();

// All admin redeem routes require AT LEAST admin. Owner-only writes get an
// extra requireOwner on top.
router.use(requireAdmin);

// GET /api/v1/admin/redeem-codes
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const includeDisabled = req.query.includeDisabled === 'true';
    const list = await listCodes({ includeDisabled });
    res.json({
      data: list.map((c) => ({
        ...c,
        amount: c.amount.toString(),
        wageringMultiplier: c.wageringMultiplier.toString(),
        requiresMinDeposit: c.requiresMinDeposit?.toString() ?? null,
      })),
    });
  } catch (err) {
    logger.error('GET /admin/redeem-codes error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// GET /api/v1/admin/redeem-codes/:id/stats
router.get('/:id/stats', async (req: Request, res: Response): Promise<void> => {
  try {
    const stats = await getCodeStats(req.params.id);
    if (!stats.code) { res.status(404).json({ error: 'Code not found' }); return; }
    res.json({
      data: {
        code: {
          ...stats.code,
          amount: stats.code.amount.toString(),
          wageringMultiplier: stats.code.wageringMultiplier.toString(),
          requiresMinDeposit: stats.code.requiresMinDeposit?.toString() ?? null,
        },
        totalRedemptions: stats.totalRedemptions,
        totalAmountDistributed: stats.totalAmountDistributed,
        unlockedCount: stats.unlockedCount,
        redemptions: stats.redemptions,
      },
    });
  } catch (err) {
    logger.error('GET /admin/redeem-codes/:id/stats error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ── OWNER-ONLY writes ──────────────────────────────────────────────────
const createBodySchema = z.object({
  code: z.string().min(1).max(20),
  amount: z.union([z.string(), z.number()]),
  maxUses: z.number().int().positive().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  minAccountAgeHours: z.number().int().min(0).nullable().optional(),
  maxAccountAgeHours: z.number().int().min(0).nullable().optional(),
  wageringMultiplier: z.union([z.string(), z.number()]).optional(),
  requiresMinDeposit: z.union([z.string(), z.number()]).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
}).strict();

router.post('/', requireOwner, async (req: Request, res: Response): Promise<void> => {
  const parsed = createBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', detail: parsed.error.flatten() });
    return;
  }
  try {
    const created = await createCode({
      ...parsed.data,
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
      createdBy: req.user!.id,
    });
    logger.info(`[Redeem][Admin] ${req.user!.id} created code ${created.code} (id=${created.id}, amount=${created.amount})`);
    res.status(201).json({
      data: {
        ...created,
        amount: created.amount.toString(),
        wageringMultiplier: created.wageringMultiplier.toString(),
        requiresMinDeposit: created.requiresMinDeposit?.toString() ?? null,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create code';
    res.status(400).json({ error: msg });
  }
});

router.patch('/:id/disable', requireOwner, async (req: Request, res: Response): Promise<void> => {
  try {
    await disableCode(req.params.id);
    logger.info(`[Redeem][Admin] ${req.user!.id} disabled code ${req.params.id}`);
    res.json({ ok: true });
  } catch (err) {
    logger.error('PATCH /admin/redeem-codes/:id/disable error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

export default router;
