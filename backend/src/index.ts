import 'dotenv/config';
import { EventEmitter } from 'events';

// Ce backend fait beaucoup de HTTPS sortant en parallèle (aoe4world, OxaPay,
// Liquipedia, 2captcha, Steam OpenID). Avec le pool TLS keepalive d'axios,
// une même socket peut accumuler > 10 listeners `error`/`close` pendant un
// burst (ex : updateAllPlayerStats qui fait 50 GET aoe4world en série).
// Node warn à partir de 11 listeners par défaut. 30 est safe : les vrais
// leaks passent rapidement au-delà, alors que nos bursts légitimes plafonnent
// à ~15-20. Raise à 30 shut up le warning sans masquer un vrai leak.
EventEmitter.defaultMaxListeners = 30;

// JSON.stringify throws on BigInt by default — JackpotRound.randomSerial
// (BIGINT in Postgres → JS BigInt from Prisma) was crashing socket.io
// emits on `jackpot:round:settled` AND any res.json() returning a
// COMPLETED round. Patching BigInt.prototype.toJSON once at boot makes
// every JSON.stringify call auto-coerce to string transparently. The
// frontend types already declare `randomSerial?: string | null`, so the
// shape matches.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import { createServer } from 'http';
import { PrismaClient } from '@prisma/client';
import { initSocket } from './socket';
import { initCronJobs } from './cron/jobs';
import { startMatchVerifier } from './services/matchVerifier';
import { startLiquipediaLiveScorer } from './services/liquipediaLiveScorer';
import matchesRouter from './routes/matches';
import betsRouter from './routes/bets';
import playersRouter from './routes/players';
import tournamentsRouter from './routes/tournaments';
import usersRouter from './routes/users';
import adminRouter from './routes/admin';
import adminFinanceRouter from './routes/adminFinance';
import adminEventsRouter from './routes/adminEvents';
import { router as rainRouter, adminRouter as adminRainRouter } from './routes/rain';
import paymentsRouter from './routes/payments';
import rouletteRouter from './routes/roulette';
import coinflipRouter from './routes/coinflip';
import jackpotRouter from './routes/jackpot';
import affiliateRouter from './routes/affiliate';
import supportRouter from './routes/support';
import devRouter from './routes/dev';
import logger from './logger';

// Fail-fast: crash at startup if required secrets are missing in production
if (process.env.NODE_ENV === 'production') {
  const required = ['JWT_SECRET', 'FRONTEND_URL', 'DATABASE_URL'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error(`[FATAL] Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
  if ((process.env.JWT_SECRET?.length ?? 0) < 32) {
    console.error('[FATAL] JWT_SECRET must be at least 32 characters long');
    process.exit(1);
  }
}

// Limit connection pool to avoid Supabase "MaxClientsInSessionMode" errors.
// Supabase free/pro tier limits pool_size to ~15 in session mode.
// Prisma default is 10 connections per instance which is fine, but we add
// explicit config to prevent future issues.
export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

const app = express();
const httpServer = createServer(app);

// Trust Railway/Cloudflare proxy — needed for correct rate-limit IP detection
app.set('trust proxy', 1);

// Compress all responses (gzip) — reduces bandwidth 60-80%
app.use(compression());

// Middleware
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow frontend (ageof.money) to load images from api.ageof.money
  contentSecurityPolicy: false, // API-only — no HTML served
  hsts: {
    maxAge: 63072000,
    includeSubDomains: true,
    preload: true,
  },
}));
// Prevent search engines indexing the API
app.use((_req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
});

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, mobile apps)
    if (!origin) return callback(null, true);
    // In dev, allow any localhost port
    if (process.env.NODE_ENV !== 'production' && /^http:\/\/localhost:\d+$/.test(origin)) {
      return callback(null, true);
    }
    const allowed = (process.env.FRONTEND_URL || 'http://localhost:3000').split(',').map(s => s.trim());
    if (allowed.includes(origin)) return callback(null, true);
    callback(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Capture the raw request body alongside parsed JSON so webhook handlers
// can verify HMAC signatures against the EXACT bytes the sender signed.
// JSON.stringify(req.body) is NOT byte-identical to the original payload
// (whitespace, key order, unicode escaping differ) — it must not be used
// for signature verification.
app.use(express.json({
  limit: '100kb',
  verify: (req, _res, buf) => {
    (req as unknown as { rawBody?: string }).rawBody = buf.toString('utf8');
  },
}));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// Rate limiting
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

const betLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many bet requests. Please slow down.' },
});

// Strict limiter for financial endpoints
const paymentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many payment requests. Please try again later.' },
});

// Coinflip: prevent create/join spam
const coinflipLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30, // 30 req/min
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many coinflip requests.' },
});

// Roulette: prevent spam placement / polling abuse
const rouletteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60, // 60 req/min — legit UI polls + bets fit, bots cap out
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many roulette requests.' },
});

// Jackpot: bet + poll are the main entry points; same budget as roulette.
const jackpotLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many jackpot requests.' },
});

// Affiliate: prevent code enumeration via /validate + claim flood
const affiliateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30, // 30 req/min
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many affiliate requests.' },
});

// User profile lookups: prevent id scraping
const userLookupLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many profile requests.' },
});

app.use(globalLimiter);

// Routes
app.use('/api/v1/matches', matchesRouter);
app.use('/api/v1/bets', betLimiter, betsRouter);
app.use('/api/v1/players', playersRouter);
app.use('/api/v1/tournaments', tournamentsRouter);
app.use('/api/v1/users', userLookupLimiter, usersRouter);
app.use('/api/v1/admin', adminRouter);
app.use('/api/v1/admin/finance', adminFinanceRouter);
app.use('/api/v1/admin/events', adminEventsRouter);
app.use('/api/v1/admin/rain', adminRainRouter);
app.use('/api/v1/rain', rainRouter);
app.use('/api/v1/payments', paymentLimiter, paymentsRouter);
app.use('/api/v1/roulette', rouletteLimiter, rouletteRouter);
app.use('/api/v1/coinflip', coinflipLimiter, coinflipRouter);
app.use('/api/v1/jackpot', jackpotLimiter, jackpotRouter);
app.use('/api/v1/affiliate', affiliateLimiter, affiliateRouter);
app.use('/api/v1/support', supportRouter);

// Dev-only routes
if (process.env.NODE_ENV !== 'production') {
  app.use('/api/v1/dev', devRouter);
  logger.info('Dev routes enabled (NODE_ENV != production)');
}

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Global error handler
app.use((err: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  const status = err.status || 500;
  res.status(status).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

// Initialize Socket.io
initSocket(httpServer);

// ── Background services (cron, roulette, scorer, startup tasks) ──────────
// All gated behind SKIP_SERVER so that standalone scripts importing prisma
// from '../index' don't trigger a full backend boot. Without this gate,
// cron queries and roulette writes compete with the script for the
// Supabase pooler's connection budget → P2024 timeouts.
if (!process.env.SKIP_SERVER) {

// Stagger service startups to avoid exhausting Supabase connection pool.
// Each service gets 2s to initialize before the next one starts.
initCronJobs();

setTimeout(() => {
  import('./services/rouletteService').then(({ initRoulette }) => {
    initRoulette().catch(err => logger.error('[Roulette] Init failed:', err));
  });
}, 2000);

setTimeout(() => {
  import('./services/jackpotService').then(({ initJackpot }) => {
    initJackpot().catch(err => logger.error('[Jackpot] Init failed:', err));
  });
}, 3000);

setTimeout(() => startMatchVerifier(), 4000);
setTimeout(() => startLiquipediaLiveScorer(), 6000);

// Startup: migrate existing avatar URLs into blobs (one-time, 15s after boot).
// Downloads images from LP one by one and stores in DB so the proxy never hits LP.
setTimeout(async () => {
  try {
    const { downloadAndStoreAvatar } = await import('./routes/players');
    const players = await prisma.player.findMany({
      where: { avatarUrl: { not: '' }, avatarBlob: null, NOT: { avatarUrl: null } },
      select: { id: true, name: true, avatarUrl: true },
    });
    if (players.length === 0) { logger.info('[Startup] All avatar blobs up to date'); return; }
    logger.info(`[Startup] Downloading ${players.length} avatar blobs into DB...`);
    let ok = 0;
    for (const p of players) {
      await downloadAndStoreAvatar(p.id, p.avatarUrl!);
      ok++;
      // 3s between downloads to stay under LP rate limit
      await new Promise(r => setTimeout(r, 3000));
    }
    logger.info(`[Startup] Avatar blob migration done: ${ok}/${players.length}`);
  } catch (err) { logger.warn('[Startup] Avatar blob migration failed:', err); }
}, 15_000);

// Startup: fetch NEW player avatars — run 90s after boot (after blob migration + scrapers).
setTimeout(async () => {
  try {
    const { fetchPlayersAvatars } = await import('./scrapers/liquipediaScraper');
    await fetchPlayersAvatars();
  } catch (err) { logger.warn('[Startup] Avatar fetch failed:', err); }
}, 90_000);

// Startup: clean up duplicate matches — delayed 10s to avoid saturating
// the Supabase connection pool at boot (scorer, cron, roulette all start first)
setTimeout(async () => {
  try {
    const matches = await prisma.match.findMany({
      where: { status: { in: ['UPCOMING', 'LIVE'] } },
      select: { id: true, player1Id: true, player2Id: true, tournamentId: true, scheduledAt: true, status: true },
      orderBy: { scheduledAt: 'desc' },
    });
    const groups = new Map<string, typeof matches>();
    for (const m of matches) {
      const key = [m.player1Id, m.player2Id].sort().join(':') + ':' + (m.tournamentId ?? '');
      groups.set(key, [...(groups.get(key) ?? []), m]);
    }
    const { getIo } = await import('./socket');
    const io = getIo();
    let removed = 0;
    for (const [, group] of groups) {
      if (group.length <= 1) continue;
      for (const dup of group.slice(1)) {
        const bets = await prisma.bet.findMany({ where: { matchId: dup.id, status: 'PENDING' } });
        // Atomic per-bet refund + status flip so a crash mid-loop can't
        // leave coins credited with the bet still PENDING.
        for (const bet of bets) {
          await prisma.$transaction([
            prisma.user.update({ where: { id: bet.userId }, data: { coins: { increment: bet.amount } } }),
            prisma.bet.update({ where: { id: bet.id }, data: { status: 'REFUNDED' } }),
          ]);
          try {
            const u = await prisma.user.findUnique({ where: { id: bet.userId }, select: { coins: true } });
            if (u) io?.to(`user:${bet.userId}`).emit('coinsUpdate', { coins: u.coins, direction: 'up' });
          } catch { /* non-blocking */ }
        }
        await prisma.match.delete({ where: { id: dup.id } });
        removed++;
      }
    }
    if (removed > 0) logger.info(`[Startup] Cleaned up ${removed} duplicate matches`);
  } catch (err) { logger.warn('[Startup] Dedup cleanup failed:', err); }
}, 10_000);

} // end if (!SKIP_SERVER) for background services

const PORT = parseInt(process.env.PORT || '4000', 10);

// Scripts set SKIP_SERVER=1 to avoid booting the HTTP listener + all the
// background services above. The `prisma` export remains usable.
if (!process.env.SKIP_SERVER) {
  httpServer.listen(PORT, () => {
    logger.info(`AgeOfMoney backend running on port ${PORT}`);
  });
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await prisma.$disconnect();
  process.exit(0);
});

export default app;

