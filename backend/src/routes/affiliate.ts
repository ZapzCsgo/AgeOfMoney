import { Router, Request, Response } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { prisma } from '../index';
import { touchUserIp } from '../services/affiliateService';
import { recordLedger } from '../services/ledger';
import { getIo } from '../socket';
import crypto from 'crypto';
import logger from '../logger';

const router = Router();

function generateCode(username: string): string {
  const base = username.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase();
  const suffix = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${base}${suffix}`;
}

// GET /affiliate/me — get or create affiliate code for current user
router.get('/me', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;

    const aff = await prisma.affiliateCode.findUnique({
      where: { userId },
      include: {
        referrals: {
          orderBy: { joinedAt: 'desc' },
          take: 50,
          include: { affiliateCode: false },
        },
      },
    });

    // No code yet — user must contact support to get one
    if (!aff) {
      res.json({ data: null });
      return;
    }

    // Aggregate stats
    const totalReferrals  = aff.referrals.length;
    const activeReferrals = aff.referrals.filter(r => r.isActive).length;
    const totalDeposited  = aff.referrals.reduce((s, r) => s + r.totalDeposited, 0);

    // Enrich referrals with username
    const referralUserIds = aff.referrals.map(r => r.referredUserId);
    const users = await prisma.user.findMany({
      where: { id: { in: referralUserIds } },
      select: { id: true, username: true, avatar: true, createdAt: true },
    });
    const userMap = Object.fromEntries(users.map(u => [u.id, u]));

    const enriched = aff.referrals.map(r => ({
      ...r,
      user: userMap[r.referredUserId] ?? null,
    }));

    // Compute when the code becomes changeable (14 days after creation)
    const lockMs = 14 * 24 * 60 * 60 * 1000;
    const codeUnlocksAt = new Date(aff.createdAt.getTime() + lockMs).toISOString();

    res.json({
      data: {
        code: aff.code,
        commissionRate: aff.commissionRate,
        totalEarnings: aff.totalEarnings,
        available: aff.available,
        createdAt: aff.createdAt.toISOString(),
        codeUnlocksAt,
        totalReferrals,
        activeReferrals,
        totalDeposited,
        referrals: enriched,
      },
    });
  } catch (err) {
    logger.error('GET /affiliate/me error:', err);
    res.status(500).json({ error: 'Failed to fetch affiliate data' });
  }
});

// POST /affiliate/me/create — self-service code generation (Bronze 20%)
router.post('/me/create', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { customCode } = (req.body ?? {}) as { customCode?: string };

    const existing = await prisma.affiliateCode.findUnique({ where: { userId } });
    if (existing) { res.status(400).json({ error: 'Tu as déjà un code' }); return; }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) { res.status(404).json({ error: 'Utilisateur introuvable' }); return; }

    // Custom code is REQUIRED — no auto-generation
    if (!customCode || typeof customCode !== 'string' || !customCode.trim()) {
      res.status(400).json({ error: 'Tu dois choisir ton code' }); return;
    }
    const code = customCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,16}$/.test(code)) {
      res.status(400).json({ error: 'Le code doit contenir 4 à 16 caractères alphanumériques' }); return;
    }
    const conflict = await prisma.affiliateCode.findUnique({ where: { code } });
    if (conflict) { res.status(409).json({ error: `Le code "${code}" est déjà pris` }); return; }

    const aff = await prisma.affiliateCode.create({
      data: { userId, code, commissionRate: 0.25 },
    });

    // Record the creator's IP for self-referral detection later
    touchUserIp(userId, req.ip).catch(() => {});

    logger.info(`Self-service affiliate code created: ${code} for user ${userId}`);
    res.json({ data: aff });
  } catch (err) {
    logger.error('POST /affiliate/me/create error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PATCH /affiliate/me/code — change an existing affiliate code
// Gated: must be at least 14 days after creation to prevent abuse
const CHANGE_LOCK_DAYS = 14;
router.patch('/me/code', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { customCode } = (req.body ?? {}) as { customCode?: string };

    if (!customCode || typeof customCode !== 'string' || !customCode.trim()) {
      res.status(400).json({ error: 'Nouveau code requis' }); return;
    }
    const newCode = customCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,16}$/.test(newCode)) {
      res.status(400).json({ error: 'Le code doit contenir 4 à 16 caractères alphanumériques' }); return;
    }

    const existing = await prisma.affiliateCode.findUnique({ where: { userId } });
    if (!existing) { res.status(404).json({ error: 'Tu n\'as pas encore de code' }); return; }

    // Lock window: 14 days since creation
    const lockMs = CHANGE_LOCK_DAYS * 24 * 60 * 60 * 1000;
    const unlocksAt = new Date(existing.createdAt.getTime() + lockMs);
    if (Date.now() < unlocksAt.getTime()) {
      const daysLeft = Math.ceil((unlocksAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
      res.status(403).json({
        error: `Ton code est verrouillé pendant ${CHANGE_LOCK_DAYS} jours après création. Tu pourras le modifier dans ${daysLeft} jour${daysLeft > 1 ? 's' : ''}.`,
        unlocksAt: unlocksAt.toISOString(),
      });
      return;
    }

    if (newCode === existing.code) {
      res.json({ data: existing }); return;
    }

    const conflict = await prisma.affiliateCode.findUnique({ where: { code: newCode } });
    if (conflict) { res.status(409).json({ error: `Le code "${newCode}" est déjà pris` }); return; }

    const updated = await prisma.affiliateCode.update({
      where: { userId },
      data: { code: newCode },
    });

    logger.info(`Affiliate code changed: ${existing.code} → ${newCode} (user=${userId})`);
    res.json({ data: updated });
  } catch (err) {
    logger.error('PATCH /affiliate/me/code error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /affiliate/claim — claim available earnings
router.post('/claim', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;

    // Atomic compare-and-swap to defeat the double-claim race.
    //   1. Read the current `available` value.
    //   2. updateMany WHERE available = <that exact value> SET available = 0.
    //   3. If count === 1 we won the race, credit the user.
    //      If count === 0 someone else either already zeroed it or raised it
    //      (a commission was credited between our read and update) — bail
    //      with 409 so the frontend retries.
    const freshAff = await prisma.affiliateCode.findUnique({ where: { userId } });
    if (!freshAff || freshAff.available <= 0) {
      res.status(400).json({ error: 'Aucune commission disponible' });
      return;
    }
    const claimed = freshAff.available;
    const cas = await prisma.affiliateCode.updateMany({
      where: { userId, available: claimed },
      data:  { available: 0 },
    });
    if (cas.count === 0) {
      res.status(409).json({ error: 'Commission modifiée pendant la requête, réessaie' });
      return;
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data:  { coins: { increment: claimed } },
      select: { coins: true },
    });

    // Ledger row outside the CAS — affiliate.available is its own ledger,
    // but the user-facing balance change still needs a Transaction so the
    // historique financier and admin finance KPIs reflect the credit.
    await recordLedger(prisma, { userId, type: 'affiliate_claim', coins: claimed });

    // Notify the user so the wallet badge updates live.
    try {
      getIo()?.to(`user:${userId}`).emit('coinsUpdate', {
        coins: updatedUser.coins,
        direction: 'up',
      });
    } catch { /* non-blocking */ }

    logger.info(`[Affiliate] Claim ${claimed}⚜ by user=${userId}`);
    res.json({ ok: true, claimed });
  } catch (err) {
    logger.error('POST /affiliate/claim error:', err);
    res.status(500).json({ error: 'Failed to claim earnings' });
  }
});

// ── GET /affiliate/validate/:code — check if a code is valid (public) ─────────
router.get('/validate/:code', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const code = req.params.code?.trim().toUpperCase();

    if (!code) {
      res.status(400).json({ error: 'Code manquant' }); return;
    }

    const aff = await prisma.affiliateCode.findUnique({ where: { code } });

    if (!aff) {
      res.status(404).json({ valid: false, error: 'Code invalide' }); return;
    }
    if (aff.userId === userId) {
      res.status(400).json({ valid: false, error: 'Vous ne pouvez pas utiliser votre propre code' }); return;
    }

    const existingReferral = await prisma.affiliateReferral.findUnique({
      where: { referredUserId: userId },
    });
    if (existingReferral) {
      res.status(400).json({ valid: false, error: 'Vous avez déjà utilisé un code affilié' }); return;
    }

    // Bonus percentage = commission rate of referrer
    // Flat deposit bonus for users applying any affiliate code
    const bonusPct = 5;
    res.json({ valid: true, bonusPct, code: aff.code });
  } catch (err) {
    logger.error('GET /affiliate/validate error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── POST /affiliate/admin/create — admin creates an affiliate code for a user ──
router.post('/admin/create', requireAuth, requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, customCode } = req.body;

    if (!userId) {
      res.status(400).json({ error: 'userId requis' }); return;
    }

    // Check user exists
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(404).json({ error: 'Utilisateur introuvable' }); return;
    }

    // Check they don't already have a code
    const existing = await prisma.affiliateCode.findUnique({ where: { userId } });
    if (existing) {
      res.json({ data: existing }); return; // idempotent
    }

    let code: string;
    if (customCode) {
      code = customCode.trim().toUpperCase();
      if (!/^[A-Z0-9]{3,20}$/.test(code)) {
        res.status(400).json({ error: 'Code must be 3-20 alphanumeric characters' }); return;
      }
    } else {
      code = generateCode(user.username);
    }

    // Ensure code uniqueness
    const codeConflict = await prisma.affiliateCode.findUnique({ where: { code } });
    if (codeConflict) {
      res.status(409).json({ error: `Le code "${code}" est déjà pris` }); return;
    }

    const aff = await prisma.affiliateCode.create({
      data: { userId, code, commissionRate: 0.25 }, // Bronze tier (25%)
    });

    logger.info(`Admin created affiliate code ${code} for user ${userId}`);
    res.json({ data: aff });
  } catch (err) {
    logger.error('POST /affiliate/admin/create error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── GET /affiliate/admin/list — list all affiliate codes ──────────────────────
router.get('/admin/list', requireAuth, requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const limit  = Math.min(parseInt(req.query.limit as string) || 100, 200);
    const offset = parseInt(req.query.offset as string) || 0;

    const codes = await prisma.affiliateCode.findMany({
      orderBy: { totalEarnings: 'desc' },
      take: limit,
      skip: offset,
      include: { referrals: { select: { id: true, isActive: true, totalDeposited: true } } },
    });

    const userIds = codes.map(c => c.userId);
    const users   = await prisma.user.findMany({
      where:  { id: { in: userIds } },
      select: { id: true, username: true, avatar: true },
    });
    const userMap = Object.fromEntries(users.map(u => [u.id, u]));

    const data = codes.map(c => ({
      id:             c.id,
      code:           c.code,
      commissionRate: c.commissionRate,
      totalEarnings:  c.totalEarnings,
      available:      c.available,
      user:           userMap[c.userId] ?? null,
      totalReferrals: c.referrals.length,
      activeReferrals: c.referrals.filter(r => r.isActive).length,
      totalDeposited: c.referrals.reduce((s, r) => s + r.totalDeposited, 0),
    }));

    res.json({ data });
  } catch (err) {
    logger.error('GET /affiliate/admin/list error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
