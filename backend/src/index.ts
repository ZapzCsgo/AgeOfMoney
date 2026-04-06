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

export const prisma = new PrismaClient();

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

app.use(globalLimiter);

// Routes
app.use('/api/v1/matches', matchesRouter);
app.use('/api/v1/bets', betLimiter, betsRouter);
app.use('/api/v1/players', playersRouter);
app.use('/api/v1/tournaments', tournamentsRouter);
app.use('/api/v1/users', usersRouter);
app.use('/api/v1/admin', adminRouter);
// Stripe webhook needs raw body — mount before express.json for this route
app.use('/api/v1/payments/webhook', express.raw({ type: 'application/json' }));
app.use('/api/v1/payments', paymentLimiter, paymentsRouter);
app.use('/api/v1/roulette', rouletteRouter);
app.use('/api/v1/affiliate', affiliateRouter);
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

// Initialize cron jobs
initCronJobs();

// Initialize roulette service
import('./services/rouletteService').then(({ initRoulette }) => {
  initRoulette().catch(err => logger.error('[Roulette] Init failed:', err));
});

// Start real-time match result verifier (aoe4world.com polling)
startMatchVerifier();

// Start Liquipedia live scorer (polls wikitext every 60s for tournament BO scores)
startLiquipediaLiveScorer();

// Startup scrape is handled by jobs.ts setImmediate — no duplicate needed here


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

