import { Router, Request, Response } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { prisma } from '../index';
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

    res.json({
      data: {
        code: aff.code,
        commissionRate: aff.commissionRate,
        totalEarnings: aff.totalEarnings,
        available: aff.available,
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

// POST /affiliate/claim — claim available earnings
router.post('/claim', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    // Atomic transaction to prevent double-claim race condition
    const claimed = await prisma.$transaction(async (tx) => {
      const freshAff = await tx.affiliateCode.findUnique({ where: { userId } });
      if (!freshAff || freshAff.available <= 0) return 0;
      await tx.user.update({ where: { id: userId }, data: { coins: { increment: freshAff.available } } });
      await tx.affiliateCode.update({ where: { userId }, data: { available: 0 } });
      return freshAff.available;
    });

    if (claimed === 0) {
      res.status(400).json({ error: 'Aucune commission disponible' });
      return;
    }

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
    const bonusPct = Math.round(aff.commissionRate * 100);
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
      data: { userId, code, commissionRate: 0.005 }, // start at Tier 1 (0.5%)
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
    const codes = await prisma.affiliateCode.findMany({
      orderBy: { totalEarnings: 'desc' },
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
