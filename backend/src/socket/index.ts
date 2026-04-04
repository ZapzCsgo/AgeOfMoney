import { Server as HttpServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { prisma } from '../index';
import { JwtPayload } from '../middleware/auth';
import logger from '../logger';

let io: SocketServer | null = null;

interface MatchChatMessage {
  matchId: string;
  message: string;
}

interface GlobalChatMessage {
  message: string;
}

let onlineCount = 0;

interface AuthenticatedSocket extends Socket {
  userId?: string;
  username?: string;
  isAdmin?: boolean;
  isMod?: boolean;
  isPartner?: boolean;
  coins?: number;
  totalWagered?: number;
  userLevel?: number;
  avatar?: string | null;
}

const URL_REGEX = /https?:\/\/[^\s]+/gi;

// Per-user chat rate limiting: max 5 messages per 5 seconds
const chatRateMap = new Map<string, { count: number; resetAt: number }>();
function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const entry = chatRateMap.get(userId);
  if (!entry || now > entry.resetAt) {
    chatRateMap.set(userId, { count: 1, resetAt: now + 5000 });
    return false;
  }
  entry.count++;
  if (entry.count > 5) return true;
  return false;
}
// Clean up old entries every 60s to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [uid, entry] of chatRateMap) {
    if (now > entry.resetAt) chatRateMap.delete(uid);
  }
}, 60_000);

function censorLinks(text: string, isPartner: boolean, isAdmin: boolean): string {
  if (isPartner || isAdmin) return text;
  return text.replace(URL_REGEX, '[lien censuré]');
}

/**
 * XP thresholds — 1 coin wagered = 420 XP
 * 20 levels with exponential progression
 */
const XP_THRESHOLDS = [
  0,              // Lv 1
  420,            // Lv 2  (1 coin)
  4_200,          // Lv 3  (10 coins)
  21_000,         // Lv 4  (50 coins)
  63_000,         // Lv 5  (150 coins)
  168_000,        // Lv 6  (400 coins)
  420_000,        // Lv 7  (1k coins)
  1_050_000,      // Lv 8  (2.5k coins)
  2_100_000,      // Lv 9  (5k coins)
  4_200_000,      // Lv 10 (10k coins)
  8_400_000,      // Lv 11 (20k coins)
  21_000_000,     // Lv 12 (50k coins)
  42_000_000,     // Lv 13 (100k coins)
  84_000_000,     // Lv 14 (200k coins)
  210_000_000,    // Lv 15 (500k coins)
  420_000_000,    // Lv 16 (1M coins)
  840_000_000,    // Lv 17 (2M coins)
  1_680_000_000,  // Lv 18 (4M coins)
  3_360_000_000,  // Lv 19 (8M coins)
  8_400_000_000,  // Lv 20 (20M coins)
];

export function computeLevel(totalWagered: number): number {
  const xp = Math.max(0, totalWagered) * 420;
  let level = 1;
  for (let i = 1; i < XP_THRESHOLDS.length; i++) {
    if (xp >= XP_THRESHOLDS[i]) level = i + 1;
    else break;
  }
  return Math.min(level, 20);
}

/**
 * Color tier by level bracket (every 10 levels a new tier).
 * Used on the frontend to colour the level badge.
 */
export function levelTier(level: number): string {
  if (level >= 51) return 'legend';
  if (level >= 41) return 'diamond';
  if (level >= 31) return 'platinum';
  if (level >= 21) return 'gold';
  if (level >= 11) return 'silver';
  return 'bronze';
}

export function initSocket(httpServer: HttpServer): void {
  const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
    .split(',')
    .map(s => s.trim());

  io = new SocketServer(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        // Allow any localhost port in dev
        if (process.env.NODE_ENV !== 'production' && /^http:\/\/localhost:\d+$/.test(origin)) {
          return callback(null, true);
        }
        if (allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error(`Socket CORS blocked: ${origin}`));
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // Auth middleware — accepts backend JWT, falls through gracefully if absent
  io.use(async (socket: AuthenticatedSocket, next) => {
    const token = socket.handshake.auth.token as string | undefined;

    if (!token || token === '') {
      return next(); // anonymous connection — read-only
    }

    try {
      const secret = process.env.JWT_SECRET;
      if (!secret) return next(new Error('Server misconfiguration'));
      const payload = jwt.verify(token, secret) as JwtPayload;

      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { id: true, username: true, isAdmin: true, isMod: true, isPartner: true, coins: true, isBanned: true, totalWagered: true, avatar: true, mutedUntil: true },
      });

      if (!user || user.isBanned) {
        return next(new Error('Unauthorized'));
      }

      socket.userId = user.id;
      socket.username = user.username;
      socket.isAdmin = user.isAdmin;
      socket.isMod = (user as Record<string, unknown>).isMod as boolean ?? false;
      socket.isPartner = (user as Record<string, unknown>).isPartner as boolean ?? false;
      socket.coins = user.coins;
      socket.totalWagered = user.totalWagered;
      socket.userLevel = computeLevel(user.totalWagered);
      socket.avatar = user.avatar ?? null;

      next();
    } catch {
      // Token invalid — allow as anonymous rather than blocking
      next();
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    onlineCount++;
    logger.debug(`Socket connected: ${socket.id} (user: ${socket.username || 'anonymous'}) — online: ${onlineCount}`);

    socket.join('global');
    // Each user gets a private room for targeted events (mute notifications, etc.)
    if (socket.userId) socket.join(`user:${socket.userId}`);
    io!.emit('onlineCount', onlineCount);

    socket.on('joinMatchRoom', (matchId: string) => {
      if (!matchId || typeof matchId !== 'string') return;
      socket.join(`matchRoom:${matchId}`);
    });

    socket.on('leaveMatchRoom', (matchId: string) => {
      if (!matchId || typeof matchId !== 'string') return;
      socket.leave(`matchRoom:${matchId}`);
    });

    // Global chat
    socket.on('globalChat', async (data: GlobalChatMessage) => {
      if (!socket.userId || !socket.username) {
        socket.emit('error', { message: 'Must be logged in to chat' });
        return;
      }

      // Check mute status from DB (re-fetch to catch real-time mutes)
      const freshUser = await prisma.user.findUnique({
        where: { id: socket.userId },
        select: { mutedUntil: true, isMod: true, isPartner: true },
      });
      const mutedUntil = (freshUser as Record<string, unknown>)?.mutedUntil as Date | null;
      if (mutedUntil && mutedUntil > new Date()) {
        const remaining = Math.ceil((mutedUntil.getTime() - Date.now()) / 60000);
        socket.emit('chatMuted', { until: mutedUntil.toISOString(), remainingMinutes: remaining });
        return;
      }

      if (isRateLimited(socket.userId)) {
        socket.emit('error', { message: 'Vous envoyez des messages trop rapidement.' });
        return;
      }

      const trimmed = (data.message || '').trim().substring(0, 200);
      if (!trimmed) return;

      const isPartner = socket.isPartner ?? (freshUser as Record<string, unknown>)?.isPartner as boolean ?? false;
      const censored = censorLinks(trimmed, isPartner, socket.isAdmin ?? false);

      const level = socket.userLevel ?? 1;
      const payload = {
        id: `${socket.id}_${Date.now()}`,
        userId: socket.userId,
        username: socket.username,
        avatar: socket.avatar ?? null,
        coins: socket.coins ?? 0,
        level,
        tier: levelTier(level),
        isAdmin: socket.isAdmin ?? false,
        isMod: socket.isMod ?? false,
        isPartner: isPartner,
        message: censored,
        timestamp: new Date().toISOString(),
      };

      io!.to('global').emit('globalChat', payload);
    });

    // Mute a user (mod/admin only)
    socket.on('muteUser', async (data: { userId: string; durationMinutes: number }) => {
      if (!socket.isAdmin && !socket.isMod) {
        socket.emit('error', { message: 'Unauthorized' });
        return;
      }
      const { userId, durationMinutes } = data;
      if (!userId || typeof durationMinutes !== 'number') return;

      const mutedUntil = durationMinutes === 0
        ? null  // unmute
        : new Date(Date.now() + durationMinutes * 60 * 1000);

      await prisma.user.update({
        where: { id: userId },
        data: { mutedUntil } as Record<string, unknown>,
      });

      if (mutedUntil) {
        // Notify the muted user directly
        io!.to(`user:${userId}`).emit('chatMuted', {
          until: mutedUntil.toISOString(),
          remainingMinutes: durationMinutes,
          by: socket.username,
        });
        // Broadcast system message to all
        io!.to('global').emit('chatSystem', {
          message: `${socket.username} a muté un utilisateur pour ${durationMinutes} min.`,
        });
      } else {
        io!.to(`user:${userId}`).emit('chatUnmuted', {});
      }
      logger.info(`[Chat] ${socket.username} muted user ${userId} for ${durationMinutes} min`);
    });

    // Match chat
    socket.on('chatMessage', (data: MatchChatMessage) => {
      if (!socket.userId || !socket.username) {
        socket.emit('error', { message: 'Must be logged in to chat' });
        return;
      }
      const { matchId, message } = data;
      if (!matchId || !message || typeof message !== 'string') return;
      if (isRateLimited(socket.userId)) {
        socket.emit('error', { message: 'Vous envoyez des messages trop rapidement.' });
        return;
      }
      const trimmed = message.trim().substring(0, 200);
      if (!trimmed) return;

      // Auto-join room if somehow not yet joined
      socket.join(`matchRoom:${matchId}`);

      const level = socket.userLevel ?? 1;
      const payload = {
        id: `${socket.id}_${Date.now()}`,
        userId: socket.userId,
        username: socket.username,
        avatar: socket.avatar ?? null,
        message: trimmed,
        coins: socket.coins ?? 0,
        level,
        tier: levelTier(level),
        isAdmin: socket.isAdmin ?? false,
        isMod: socket.isMod ?? false,
        isPartner: socket.isPartner ?? false,
        timestamp: new Date().toISOString(),
      };

      io!.to(`matchRoom:${matchId}`).emit('chatMessage', payload);
    });

    socket.on('disconnect', () => {
      onlineCount = Math.max(0, onlineCount - 1);
      io!.emit('onlineCount', onlineCount);
      logger.debug(`Socket disconnected: ${socket.id} — online: ${onlineCount}`);
    });
  });

  logger.info('Socket.io server initialized');
}

export function getIo(): SocketServer | null {
  return io;
}

export function broadcastBetPlaced(matchId: string, betData: {
  playerIndex: number;
  amount: number;
  totalVolume: { player1: number; player2: number; pct1: number; pct2: number };
}): void {
  if (!io) return;
  io.to(`matchRoom:${matchId}`).emit('betPlaced', betData);
}

export function broadcastOddsUpdate(matchId: string, odds: {
  odds1: number;
  odds2: number;
}): void {
  if (!io) return;
  io.to(`matchRoom:${matchId}`).emit('oddsUpdate', { matchId, ...odds, timestamp: new Date().toISOString() });
}

export function broadcastMatchStatus(matchId: string, status: string, extra?: Record<string, unknown>): void {
  if (!io) return;
  io.to(`matchRoom:${matchId}`).emit('matchStatusUpdate', { matchId, status, ...extra });
}
