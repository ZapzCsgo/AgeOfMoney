import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../index';
import logger from '../logger';

export interface JwtPayload {
  userId: string;
  email: string;
  isAdmin: boolean;
  isOwner?: boolean;  // site operator flag — undefined on legacy tokens, treated as false
}

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        isAdmin: boolean;
        isOwner: boolean;
        coins: number;
        isBanned: boolean;
      };
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const token = authHeader.substring(7);
    const secret = process.env.JWT_SECRET;

    if (!secret) {
      logger.error('JWT_SECRET not configured');
      res.status(500).json({ error: 'Server configuration error' });
      return;
    }

    let payload: JwtPayload;
    try {
      // Explicit algorithm whitelist prevents "alg: none" and alg confusion attacks.
      // clockTolerance handles minor server clock drift without accepting stale tokens.
      payload = jwt.verify(token, secret, {
        algorithms: ['HS256'],
        clockTolerance: 5,
      }) as JwtPayload;
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        res.status(401).json({ error: 'Token expired' });
      } else {
        res.status(401).json({ error: 'Invalid token' });
      }
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        email: true,
        isAdmin: true,
        isOwner: true,
        coins: true,
        isBanned: true,
      },
    });

    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    if (user.isBanned) {
      res.status(403).json({ error: 'Account suspended' });
      return;
    }

    req.user = { ...user, email: user.email ?? '' };

    // Update last active
    await prisma.user.update({
      where: { id: user.id },
      data: { lastActiveAt: new Date() },
    }).catch(() => {});

    next();
  } catch (error) {
    logger.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Authentication error' });
  }
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  await requireAuth(req, res, async () => {
    if (!req.user?.isAdmin) {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }
    next();
  });
}

/**
 * Strictly above requireAdmin — reserved for the site operator (Zapz).
 * Gates /admin/finance/* and any future owner-only route.
 *
 * Security posture:
 *   - Any attempt from a non-owner (including regular admins/mods) is logged
 *     at warn level with enough context to catch privilege-escalation
 *     probing. Returns 403 (finance routes, upstream rewrites to 404 on
 *     the frontend page so we don't confirm the page exists).
 *   - Bans + banned cascade from requireAuth.
 */
export async function requireOwner(req: Request, res: Response, next: NextFunction): Promise<void> {
  await requireAuth(req, res, async () => {
    if (!req.user?.isOwner) {
      logger.warn(
        `[Security] Non-owner tried owner-gated route ${req.method} ${req.originalUrl} ` +
        `— userId=${req.user?.id ?? 'unknown'} email=${req.user?.email ?? 'unknown'} ` +
        `isAdmin=${req.user?.isAdmin ?? false} ip=${req.ip}`,
      );
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  });
}

export function generateToken(payload: JwtPayload): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not configured');
  // Pin algorithm so verify-side whitelist can't be silently downgraded.
  return jwt.sign(payload, secret, { expiresIn: '7d', algorithm: 'HS256' });
}
