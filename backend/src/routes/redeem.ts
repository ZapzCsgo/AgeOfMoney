/**
 * User-side redeem-code routes.
 *
 * Mounted at `/api/v1/redeem` and `/api/v1/me/redeem-history`. Auth
 * required — `requireAuth` middleware. Per-user / per-IP rate limits
 * applied at the index.ts mount point so they're discoverable next to
 * the other limiters.
 *
 * The IP captured here is what `req.ip` resolves to via Express's
 * `trust proxy` (set in index.ts) — Cloudflare X-Forwarded-For. We hash
 * it before persistence so the audit table never carries raw IPs.
 */
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth';
import { redeemCode, getUserRedeemHistory } from '../services/redeemCodeService';
import logger from '../logger';

const router = Router();

// Per-user limiter — runs AFTER requireAuth so req.user.id is available as
// the rate-limit key. The IP-side cap lives in index.ts (20/hour/IP). This
// per-user one stops scripted enumeration by a single logged-in user.
const redeemUserLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  // req.user is populated by requireAuth — fall back to ip so the limiter
  // never throws on an edge case where auth somehow let an unauth req in.
  keyGenerator: (req) => (req as Request & { user?: { id: string } }).user?.id ?? req.ip ?? 'anon',
  message: { error: 'Too many redeem attempts. Wait a minute and try again.' },
});

const redeemBodySchema = z.object({
  code: z.string().min(1).max(20),
}).strict();

router.post('/', requireAuth, redeemUserLimiter, async (req: Request, res: Response): Promise<void> => {
  const parsed = redeemBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', detail: parsed.error.flatten() });
    return;
  }
  const userId = req.user!.id;
  const ipHash = req.ip ? crypto.createHash('sha256').update(req.ip).digest('hex') : null;
  const userAgent = (req.headers['user-agent'] ?? '').toString().slice(0, 200) || null;

  try {
    const result = await redeemCode({ userId, code: parsed.data.code, ipHash, userAgent });
    if (!result.ok) {
      // 200 with ok:false — UI displays the message inline. Avoids
      // leaking 4xx/5xx mappings that bots could enumerate.
      res.json({ ok: false, reason: result.reason, message: result.message });
      return;
    }
    res.json({
      ok: true,
      amount: result.amount.toFixed(2),
      wageringRequired: result.wageringRequired.toFixed(2),
      newLockedBalance: result.newLockedBalance.toFixed(2),
    });
  } catch (err) {
    logger.error('POST /redeem error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

router.get('/me/history', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const list = await getUserRedeemHistory(req.user!.id);
    res.json({ data: list });
  } catch (err) {
    logger.error('GET /me/redeem-history error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

export default router;
