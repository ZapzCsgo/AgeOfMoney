/**
 * Rain routes — public-facing widget + owner launch + history.
 *
 * Endpoints :
 *   GET  /api/v1/rain/active           — current ACTIVE rain (widget polls this)
 *   POST /api/v1/rain/claim/:rainId    — user claim + captcha verif
 *   POST /api/v1/admin/rain/launch     — owner-only rain creation
 *   GET  /api/v1/admin/rain/history    — owner-only audit trail
 *
 * Anti-abuse :
 *   - Per-IP rate limit on /claim : 1 hit / 30 s
 *   - captchaAnswer server-verified against expected result (computed from
 *     the integers picked by the client — the trick is that we don't need
 *     to store a captcha challenge server-side because the math is
 *     deterministic : the client sends a = 3, b = 8, answer = 11, we check
 *     that answer === a + b).
 *   - captchaMs round-trip timing < 500 ms → suspicious flag.
 */

import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireOwner } from '../middleware/auth';
import {
  createRain,
  joinRain,
  getActiveRain,
  hasUserClaimed,
  listRainHistory,
  hashIpForRain,
} from '../services/rainService';
import logger from '../logger';

const router = Router();

// ─── Public : /active + /claim ──────────────────────────────────────────────

// Widget polls this on mount + after `rain:end` — cheap single-row read.
router.get('/active', async (_req: Request, res: Response): Promise<void> => {
  try {
    const data = await getActiveRain();
    res.json({ data });
  } catch (err) {
    logger.error('GET /rain/active error:', err);
    res.status(500).json({ error: 'Failed to fetch active rain' });
  }
});

// Strict per-IP rate limit : 1 claim per 30 seconds per IP. Bots rotating
// claims across accounts from the same proxy still get capped here.
const claimLimiter = rateLimit({
  windowMs: 30_000,
  max: 1,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de claims depuis cette IP. Réessaie dans 30 s.' },
});

router.post('/claim/:rainId', claimLimiter, requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const rainId = req.params.rainId;
    if (!rainId) { res.status(400).json({ error: 'rainId required' }); return; }

    // Captcha payload : { captchaA, captchaB, captchaAnswer, captchaMs }.
    // Server verifies answer = A + B (deterministic, no session store).
    const { captchaA, captchaB, captchaAnswer, captchaMs } = req.body ?? {};
    if (
      typeof captchaA !== 'number' || typeof captchaB !== 'number' ||
      typeof captchaAnswer !== 'number' || typeof captchaMs !== 'number'
    ) {
      res.status(400).json({ error: 'captcha payload invalide' });
      return;
    }
    if (captchaA + captchaB !== captchaAnswer) {
      res.status(400).json({ error: 'captcha faux' });
      return;
    }
    // Bound captchaMs (UI spec : timer between modal open and submit).
    // Negative or impossibly large values are fraud signals — mark
    // suspicious by clamping to a plausible range.
    const msClamped = Math.max(0, Math.min(captchaMs, 600_000));

    const ipHash = hashIpForRain(req.ip);
    const result = await joinRain(rainId, userId, msClamped, ipHash);
    if (!result.ok) {
      const status = result.reason === 'USER_BANNED' ? 403 : result.reason === 'RAIN_NOT_FOUND' ? 404 : 400;
      res.status(status).json({ error: result.message, reason: result.reason });
      return;
    }
    res.json({ ok: true, coinsReceived: result.coinsReceived });
  } catch (err) {
    logger.error('POST /rain/claim/:rainId error:', err);
    res.status(500).json({ error: 'Failed to claim rain' });
  }
});

// GET /api/v1/rain/:rainId/claimed — does the current user already have a claim?
// Keeps the widget honest after a page reload.
router.get('/:rainId/claimed', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const rainId = req.params.rainId;
    if (!rainId) { res.status(400).json({ error: 'rainId required' }); return; }
    const claimed = await hasUserClaimed(rainId, userId);
    res.json({ data: { claimed } });
  } catch (err) {
    logger.error('GET /rain/:rainId/claimed error:', err);
    res.status(500).json({ error: 'Failed to check claim status' });
  }
});

// ─── Admin : /launch + /history ─────────────────────────────────────────────

const adminRouter = Router();
adminRouter.use(requireOwner);

adminRouter.post('/launch', async (req: Request, res: Response): Promise<void> => {
  try {
    const adminId = req.user?.id;
    if (!adminId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const { amount, maxParticipants, duration, triggeredByEvent } = req.body ?? {};
    const parsed = {
      amount: Number(amount),
      maxParticipants: Number(maxParticipants),
      duration: Number(duration),
      triggeredByEvent: typeof triggeredByEvent === 'string' ? triggeredByEvent : null,
    };
    if (!Number.isFinite(parsed.amount) || !Number.isFinite(parsed.maxParticipants) || !Number.isFinite(parsed.duration)) {
      res.status(400).json({ error: 'amount / maxParticipants / duration required' });
      return;
    }

    const result = await createRain(adminId, parsed);
    if (!result.ok) {
      const status = result.reason === 'ACTIVE_EXISTS' ? 409 : 400;
      res.status(status).json({ error: result.message, reason: result.reason });
      return;
    }
    res.json({ ok: true, data: result.rain });
  } catch (err) {
    logger.error('POST /admin/rain/launch error:', err);
    res.status(500).json({ error: 'Failed to launch rain' });
  }
});

adminRouter.get('/history', async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = Math.max(1, Math.min(parseInt(String(req.query.limit ?? '20'), 10) || 20, 100));
    const data = await listRainHistory(limit);
    res.json({ data });
  } catch (err) {
    logger.error('GET /admin/rain/history error:', err);
    res.status(500).json({ error: 'Failed to load rain history' });
  }
});

export { router, adminRouter };
