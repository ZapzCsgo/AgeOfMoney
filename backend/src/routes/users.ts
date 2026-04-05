import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { generateToken } from '../middleware/auth';
import { prisma } from '../index';
import { z } from 'zod';
import { authenticator } from 'otplib';
import logger from '../logger';
import { getIo } from '../socket';

const router = Router();

// GET /me - Current user profile
router.get('/me', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        username: true,
        email: true,
        avatar: true,
        bio: true,
        coins: true,
        isAdmin: true,
        isMod: true,
        isPartner: true,
        totpEnabled: true,
        createdAt: true,
        lastActiveAt: true,
        _count: { select: { bets: true } },
      },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({ data: user });
  } catch (error) {
    logger.error('GET /users/me error:', error);
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

// PUT /me - Update email and bio
router.put('/me', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, bio } = req.body as { email?: string; bio?: string };
    const data: Record<string, unknown> = {};
    if (email !== undefined) data.email = email.trim() || null;
    if (bio !== undefined) data.bio = bio.trim().slice(0, 200) || null;
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: data as never,
      select: { id: true, username: true, email: true },
    });
    res.json({ data: user });
  } catch (error) {
    logger.error('PUT /users/me error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// POST /auth/login - Steam OAuth callback (creates or updates user, returns JWT)
const loginSchema = z.object({
  provider: z.literal('steam'),
  providerId: z.string().min(1),
  steamId: z.string().min(1),
  username: z.string().min(2).max(32),
  avatar: z.string().url().optional(),
});

router.post('/auth/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid login data', details: parsed.error.flatten() });
      return;
    }

    const { provider, providerId, steamId, username, avatar } = parsed.data;

    let user = await prisma.user.findUnique({
      where: { provider_providerId: { provider, providerId } },
    });

    if (!user) {
      // Check if steamId already exists (safety check)
      const existingSteam = await prisma.user.findUnique({ where: { steamId } });
      if (existingSteam) {
        user = await prisma.user.update({
          where: { steamId },
          data: { avatar: avatar ?? existingSteam.avatar, lastActiveAt: new Date() },
        });
      } else {
        // Create new user with unique username (Steam names can have duplicates)
        let finalUsername = username.replace(/\s+/g, '_').substring(0, 32);
        let attempt = 0;
        while (await prisma.user.findUnique({ where: { username: finalUsername } })) {
          attempt++;
          finalUsername = `${username.substring(0, 28)}_${attempt}`;
        }

        user = await prisma.user.create({
          data: {
            provider,
            providerId,
            steamId,
            username: finalUsername,
            avatar,
            coins: 0,
          },
        });
      }
    } else {
      // Update avatar + username if changed (Steam names can change)
      user = await prisma.user.update({
        where: { id: user.id },
        data: { avatar: avatar ?? user.avatar, lastActiveAt: new Date() },
      });
    }

    const token = generateToken({
      userId: user.id,
      email: user.email ?? '',
      isAdmin: user.isAdmin,
    });

    res.json({
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          avatar: user.avatar,
          coins: user.coins,
          isAdmin: user.isAdmin,
        },
      },
    });
  } catch (error) {
    logger.error('POST /users/auth/login error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// GET /2fa/setup — Generate a new TOTP secret and return the otpauth URL + QR data
router.get('/2fa/setup', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true, totpEnabled: true } });
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    if (user.totpEnabled) { res.status(400).json({ error: '2FA is already enabled' }); return; }

    // Generate a fresh secret each time setup is initiated
    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(`${user.username}`, 'AgeOfMoney', secret);

    // Persist the pending secret (not yet enabled — enabled only after verify)
    await prisma.user.update({ where: { id: userId }, data: { totpSecret: secret, totpEnabled: false } });

    res.json({ data: { secret, otpauthUrl } });
  } catch (error) {
    logger.error('GET /users/2fa/setup error:', error);
    res.status(500).json({ error: 'Failed to setup 2FA' });
  }
});

// POST /2fa/enable — Verify the first code and activate 2FA
router.post('/2fa/enable', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { code } = req.body as { code?: string };
    if (!code || !/^\d{6}$/.test(code)) {
      res.status(400).json({ error: 'Invalid code format' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { totpSecret: true, totpEnabled: true },
    });
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    if (user.totpEnabled) { res.status(400).json({ error: '2FA is already enabled' }); return; }
    if (!user.totpSecret) { res.status(400).json({ error: 'Run 2FA setup first' }); return; }

    const isValid = authenticator.verify({ token: code, secret: user.totpSecret });
    if (!isValid) { res.status(400).json({ error: 'Invalid code — check your authenticator app' }); return; }

    await prisma.user.update({ where: { id: req.user!.id }, data: { totpEnabled: true } });
    res.json({ data: { enabled: true } });
  } catch (error) {
    logger.error('POST /users/2fa/enable error:', error);
    res.status(500).json({ error: 'Failed to enable 2FA' });
  }
});

// POST /2fa/disable — Verify code and disable 2FA
router.post('/2fa/disable', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { code } = req.body as { code?: string };
    if (!code || !/^\d{6}$/.test(code)) {
      res.status(400).json({ error: 'Invalid code format' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { totpSecret: true, totpEnabled: true },
    });
    if (!user?.totpEnabled || !user.totpSecret) { res.status(400).json({ error: '2FA is not enabled' }); return; }

    const isValid = authenticator.verify({ token: code, secret: user.totpSecret });
    if (!isValid) { res.status(400).json({ error: 'Invalid code' }); return; }

    await prisma.user.update({ where: { id: req.user!.id }, data: { totpEnabled: false, totpSecret: null } });
    res.json({ data: { enabled: false } });
  } catch (error) {
    logger.error('POST /users/2fa/disable error:', error);
    res.status(500).json({ error: 'Failed to disable 2FA' });
  }
});

// POST /2fa/verify — Verify a TOTP code (used during withdrawal)
router.post('/2fa/verify', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { code } = req.body as { code?: string };
    if (!code || !/^\d{6}$/.test(code)) {
      res.status(400).json({ error: 'Invalid code format' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { totpSecret: true, totpEnabled: true },
    });
    if (!user?.totpEnabled || !user.totpSecret) {
      // 2FA not enabled — allow through (should not happen if frontend checks correctly)
      res.json({ data: { valid: true } });
      return;
    }

    const isValid = authenticator.verify({ token: code, secret: user.totpSecret });
    if (!isValid) { res.status(400).json({ error: 'Invalid authentication code' }); return; }

    res.json({ data: { valid: true } });
  } catch (error) {
    logger.error('POST /users/2fa/verify error:', error);
    res.status(500).json({ error: 'Failed to verify 2FA code' });
  }
});

// POST /:id/tip — Send coins to another user
router.post('/:id/tip', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const recipientId = req.params.id;
    const senderId = req.user!.id;
    if (recipientId === senderId) { res.status(400).json({ error: 'Cannot tip yourself' }); return; }

    const { amount } = req.body as { amount?: number };
    const amountInt = Math.floor(Number(amount));
    if (!amountInt || amountInt < 10 || amountInt > 10000) {
      res.status(400).json({ error: 'Tip amount must be between 10 and 10 000 ⚜' }); return;
    }

    const [sender, recipient] = await Promise.all([
      prisma.user.findUnique({ where: { id: senderId }, select: { coins: true, username: true } }),
      prisma.user.findUnique({ where: { id: recipientId }, select: { id: true, username: true, isBanned: true } }),
    ]);
    if (!sender) { res.status(404).json({ error: 'Sender not found' }); return; }
    if (!recipient || recipient.isBanned) { res.status(404).json({ error: 'User not found' }); return; }
    if (sender.coins < amountInt) { res.status(400).json({ error: 'Insufficient coins' }); return; }

    const [updatedSender, updatedRecipient] = await prisma.$transaction([
      prisma.user.update({ where: { id: senderId },    data: { coins: { decrement: amountInt } }, select: { coins: true } }),
      prisma.user.update({ where: { id: recipientId }, data: { coins: { increment: amountInt } }, select: { coins: true } }),
    ]);

    const io = getIo();
    // Notify sender (coin deduction)
    io?.to(`user:${senderId}`).emit('coinsUpdate', { coins: updatedSender.coins, direction: 'down' });
    // Notify recipient (tip received)
    io?.to(`user:${recipientId}`).emit('coinsUpdate', { coins: updatedRecipient.coins, direction: 'up' });
    io?.to(`user:${recipientId}`).emit('notification', {
      type: 'tip',
      from: sender.username,
      amount: amountInt,
    });

    logger.info(`[Tip] ${senderId} → ${recipientId} : ${amountInt} coins`);
    res.json({ ok: true, amount: amountInt });
  } catch (err) {
    logger.error('POST /users/:id/tip error:', err);
    res.status(500).json({ error: 'Tip failed' });
  }
});

// GET /leaderboard - All-time top users by totalWagered
router.get('/leaderboard', async (_req: Request, res: Response): Promise<void> => {
  try {
    const users = await prisma.user.findMany({
      where: { isBanned: false },
      orderBy: { totalWagered: 'desc' },
      take: 100,
      select: {
        id: true,
        username: true,
        avatar: true,
        coins: true,
        totalWagered: true,
        createdAt: true,
        _count: { select: { bets: true } },
      },
    });

    res.json({ data: users });
  } catch (error) {
    logger.error('GET /users/leaderboard error:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// GET /leaderboard/weekly - Weekly leaderboard (based on bets won this week)
router.get('/leaderboard/weekly', async (_req: Request, res: Response): Promise<void> => {
  try {
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const weeklyBets = await prisma.bet.groupBy({
      by: ['userId'],
      where: {
        status: 'WON',
        updatedAt: { gte: weekStart },
      },
      _sum: { payout: true },
      _count: true,
      orderBy: { _sum: { payout: 'desc' } },
      take: 50,
    });

    const userIds = weeklyBets.map((b) => b.userId);
    const users = await prisma.user.findMany({
      where: { id: { in: userIds }, isBanned: false },
      select: {
        id: true,
        username: true,
        avatar: true,
        coins: true,
      },
    });

    const userMap = new Map(users.map((u) => [u.id, u]));

    const leaderboard = weeklyBets
      .filter((b) => userMap.has(b.userId))
      .map((b, idx) => ({
        rank: idx + 1,
        user: userMap.get(b.userId)!,
        weeklyWinnings: b._sum.payout ?? 0,
        weeklyBets: b._count,
      }));

    res.json({ data: leaderboard, weekStart: weekStart.toISOString() });
  } catch (error) {
    logger.error('GET /users/leaderboard/weekly error:', error);
    res.status(500).json({ error: 'Failed to fetch weekly leaderboard' });
  }
});

// GET /:id - Public user profile (must be last to avoid catching named routes)
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.params.id;
    const [user, bets, rouletteBets] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true, username: true, avatar: true, bio: true, coins: true,
          totalWagered: true, isAdmin: true, isMod: true, isPartner: true,
          isBanned: true, createdAt: true,
          _count: { select: { bets: true, rouletteBets: true } },
        },
      }),
      prisma.bet.findMany({
        where: { userId },
        select: { amount: true, payout: true, status: true, createdAt: true },
      }),
      prisma.rouletteBet.findMany({
        where: { userId },
        select: { amount: true, payout: true, won: true, createdAt: true },
      }),
    ]);

    if (!user || user.isBanned) { res.status(404).json({ error: 'User not found' }); return; }

    const now = Date.now();
    const ago7  = now - 7  * 86400000;
    const ago30 = now - 30 * 86400000;

    function periodStats(bArr: typeof bets, rArr: typeof rouletteBets, since: number) {
      const fb = bArr.filter(b => new Date(b.createdAt).getTime() >= since);
      const fr = rArr.filter(b => new Date(b.createdAt).getTime() >= since);
      const wagered = fb.reduce((s, b) => s + b.amount, 0) + fr.reduce((s, b) => s + b.amount, 0);
      const won     = fb.filter(b => b.status === 'WON').reduce((s, b) => s + (b.payout ?? 0), 0)
                    + fr.filter(b => b.won === true).reduce((s, b) => s + (b.payout ?? 0), 0);
      const count   = fb.length + fr.length;
      return { wagered, won, count };
    }

    const stats = {
      d7:    periodStats(bets, rouletteBets, ago7),
      d30:   periodStats(bets, rouletteBets, ago30),
      total: periodStats(bets, rouletteBets, 0),
    };

    const { isBanned: _banned, ...pub } = user;
    res.json({ data: { ...pub, stats } });
  } catch (error) {
    logger.error('GET /users/:id error:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

export default router;
