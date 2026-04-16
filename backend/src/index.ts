import 'dotenv/config';
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
import paymentsRouter from './routes/payments';
import rouletteRouter from './routes/roulette';
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

app.use(express.json({ limit: '100kb' }));
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

// Roulette: prevent spam placement / polling abuse
const rouletteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60, // 60 req/min — legit UI polls + bets fit, bots cap out
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many roulette requests.' },
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
// Stripe webhook needs raw body — mount before express.json for this route
app.use('/api/v1/payments/webhook', express.raw({ type: 'application/json' }));
app.use('/api/v1/payments', paymentLimiter, paymentsRouter);
app.use('/api/v1/roulette', rouletteLimiter, rouletteRouter);
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

// Stagger service startups to avoid exhausting Supabase connection pool.
// Each service gets 2s to initialize before the next one starts.
initCronJobs();

setTimeout(() => {
  import('./services/rouletteService').then(({ initRoulette }) => {
    initRoulette().catch(err => logger.error('[Roulette] Init failed:', err));
  });
}, 2000);

setTimeout(() => startMatchVerifier(), 4000);
setTimeout(() => startLiquipediaLiveScorer(), 6000);

// Startup: fetch missing player avatars — run 90s after boot so the main
// scrapers (Liquipedia matches, AoE calendar) finish first and don't compete.
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
    let removed = 0;
    for (const [, group] of groups) {
      if (group.length <= 1) continue;
      for (const dup of group.slice(1)) {
        const bets = await prisma.bet.findMany({ where: { matchId: dup.id, status: 'PENDING' } });
        for (const bet of bets) {
          await prisma.user.update({ where: { id: bet.userId }, data: { coins: { increment: bet.amount } } });
          await prisma.bet.update({ where: { id: bet.id }, data: { status: 'REFUNDED' } });
        }
        await prisma.match.delete({ where: { id: dup.id } });
        removed++;
      }
    }
    if (removed > 0) logger.info(`[Startup] Cleaned up ${removed} duplicate matches`);
  } catch (err) { logger.warn('[Startup] Dedup cleanup failed:', err); }
}, 10_000);


const PORT = parseInt(process.env.PORT || '4000', 10);

httpServer.listen(PORT, () => {
  logger.info(`AgeOfMoney backend running on port ${PORT}`);
});

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

