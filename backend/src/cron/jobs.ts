import cron from 'node-cron';
import { prisma } from '../index';
import { enrichAllUpcomingMatches } from '../scrapers/aoe4worldScraper';
import { scrapeAoe4WorldTournaments } from '../scrapers/aoe4worldTournamentScraper';
import { scrapeUpcomingMatches } from '../scrapers/liquipediaScraper';
import { syncAoeEventCalendar } from '../scrapers/aoeEventCalendarScraper';
import { enrichAllSparseH2H } from '../scrapers/aiH2HScraper';
import { distributePayout, refundBets } from '../services/betService';
import { getIo } from '../socket';
import logger from '../logger';

export function initCronJobs(): void {
  logger.info('Initializing cron jobs');

  // ── Every 15 minutes: scrape aoe4world tournaments + detect results
  cron.schedule('*/15 * * * *', async () => {
    try {
      await scrapeAoe4WorldTournaments();
    } catch (err) {
      logger.error('[CRON] aoe4world tourn scrape failed:', err);
    }
  });

  // ── Every 15 minutes: sync AoE event calendar + scrape Liquipedia matches ─
  cron.schedule('*/15 * * * *', async () => {
    try {
      await syncAoeEventCalendar(); // tournament discovery with game tags
      await scrapeUpcomingMatches(); // individual match scraping from Liquipedia
    } catch (err) {
      logger.error('[CRON] Calendar + Liquipedia scrape failed:', err);
    }
  });

  // ── Every 10 minutes: fast odds recalc from existing DB data (no API calls) ─
  cron.schedule('*/10 * * * *', async () => {
    try {
      await recalcActiveMatchOdds();
    } catch (err) {
      logger.error('[CRON] fast recalc failed:', err);
    }
  });

  // ── Every 30 minutes: full enrichment (player stats from aoe4world + H2H) ──
  cron.schedule('*/30 * * * *', async () => {
    try {
      await enrichAllUpcomingMatches();
    } catch (err) {
      logger.error('[CRON] enrichOdds failed:', err);
    }
  });

  // ── Once a day at 3am: fetch missing player avatars from Liquipedia ─────────
  // Kept separate so avatar fetching never risks blocking the main scrape IP.
  cron.schedule('0 3 * * *', async () => {
    try {
      const { fetchPlayersAvatars } = await import('../scrapers/liquipediaScraper');
      await fetchPlayersAvatars();
    } catch (err) {
      logger.error('[CRON] avatar fetch failed:', err);
    }
  });

  // ── Every 6 hours: AI H2H enrichment for sparse pairs ────────────────────
  cron.schedule('0 */6 * * *', async () => {
    try {
      await enrichAllSparseH2H();
    } catch (err) {
      logger.error('[CRON] AI H2H enrichment failed:', err);
    }
  });

  // ── Every minute: transition match statuses + close bets ──────────────────
  cron.schedule('* * * * *', async () => {
    try {
      await tickMatchStatuses();
      await closeBetsPreMatch();
    } catch (err) {
      logger.error('[CRON] tick failed:', err);
    }
  });

  // ── Every 10 minutes: distribute payouts ──────────────────────────────────
  cron.schedule('*/10 * * * *', async () => {
    try {
      await distributePayouts();
    } catch (err) {
      logger.error('[CRON] distributePayouts failed:', err);
    }
  });

  logger.info('All cron jobs initialized');

  // ── Run critical checks immediately on startup ────────────────────────────
  setImmediate(async () => {
    try {
      logger.info('[Startup] Immediate status sync...');
      await tickMatchStatuses();
      await distributePayouts();
      // Non-blocking startup tasks
      syncAoeEventCalendar()
        .then(() => scrapeUpcomingMatches())
        .catch(err => logger.error('[Startup] Calendar + Liquipedia scrape:', err));
      scrapeAoe4WorldTournaments()
        .then(() => enrichAllUpcomingMatches())
        .catch(err => logger.error('[Startup] aoe4world tourn + enrichOdds:', err));
    } catch (err) {
      logger.error('[Startup] Immediate sync failed:', err);
    }
  });
}

/**
 * Per-minute tick:
 * 1. UPCOMING → LIVE when scheduledAt has passed
 * 2. Stale LIVE (8h+ no result, no tracking) → CANCELLED + refund
 * 3. Socket broadcast for all status changes
 */
async function tickMatchStatuses(): Promise<void> {
  const io = getIo();
  const now = new Date();

  // ── UPCOMING → LIVE ───────────────────────────────────────────────────────
  const toStart = await prisma.match.findMany({
    where: { status: 'UPCOMING', scheduledAt: { lte: now } },
    select: { id: true, scheduledAt: true },
  });

  for (const match of toStart) {
    await prisma.match.update({ where: { id: match.id }, data: { status: 'LIVE' } });
    io?.to(`matchRoom:${match.id}`).emit('matchStatusUpdate', { matchId: match.id, status: 'LIVE' });
    io?.emit('matchUpdate', { matchId: match.id, status: 'LIVE' });
    logger.info(`[Tick] ${match.id} → LIVE`);
  }

  // ── Stale LIVE → CANCELLED (8h+ no winner, no aoe4world tracking) ─────────
  const staleThreshold = new Date(Date.now() - 8 * 60 * 60 * 1000);
  const staleMatches = await prisma.match.findMany({
    where: { status: 'LIVE', winnerId: null, scheduledAt: { lte: staleThreshold } },
    include: {
      player1: { select: { aoe4worldId: true } },
      player2: { select: { aoe4worldId: true } },
    },
  });

  for (const match of staleMatches) {
    if (match.player1.aoe4worldId && match.player2.aoe4worldId) {
      const is24hOld = match.scheduledAt.getTime() < Date.now() - 24 * 60 * 60 * 1000;
      if (!is24hOld) {
        // Between 8h-24h: flag but keep trying via matchVerifier
        if (!match.verificationFlag) {
          await prisma.match.update({ where: { id: match.id }, data: { verificationFlag: true } });
          logger.warn(`[Tick] Match ${match.id} flagged — 8h+ LIVE with no result`);
        }
        continue;
      }
      // 24h+ LIVE with no result — matchVerifier couldn't resolve it, auto-cancel+refund
      logger.warn(`[Tick] Auto-cancelling match ${match.id} (24h+ LIVE, unresolvable)`);
      await prisma.match.update({ where: { id: match.id }, data: { status: 'CANCELLED', betsOpen: false } });
      await refundBets(match.id);
      io?.to(`matchRoom:${match.id}`).emit('matchStatusUpdate', { matchId: match.id, status: 'CANCELLED' });
      io?.emit('matchUpdate', { matchId: match.id, status: 'CANCELLED' });
      continue;
    }
    // No aoe4world tracking → refund and cancel after 8h
    logger.warn(`[Tick] Auto-cancelling match ${match.id} (8h+ LIVE, untrackable)`);
    await prisma.match.update({ where: { id: match.id }, data: { status: 'CANCELLED', betsOpen: false } });
    await refundBets(match.id);
    io?.to(`matchRoom:${match.id}`).emit('matchStatusUpdate', { matchId: match.id, status: 'CANCELLED' });
    io?.emit('matchUpdate', { matchId: match.id, status: 'CANCELLED' });
  }
}

async function closeBetsPreMatch(): Promise<void> {
  const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
  const io = getIo();

  const toClose = await prisma.match.findMany({
    where: { status: 'UPCOMING', scheduledAt: { lte: fiveMinutesFromNow }, betsClosedAt: null },
  });

  for (const match of toClose) {
    await prisma.match.update({ where: { id: match.id }, data: { betsClosedAt: new Date() } });
    io?.to(`matchRoom:${match.id}`).emit('bettingClosed', { matchId: match.id, closedAt: new Date().toISOString() });
  }
}

/**
 * Fast odds recalculation using only existing DB data (no aoe4world API calls).
 * Runs every 10 minutes to keep odds fresh. Full enrichment (with API) runs every 30min.
 */
async function recalcActiveMatchOdds(): Promise<void> {
  const io = getIo();
  const { calculateOddsFromPlayers } = await import('../services/oddsEngine');
  const { getPlayerH2HFromHistory } = await import('../scrapers/aiPlayerHistoryScraper');

  const activeMatches = await prisma.match.findMany({
    where: { status: { in: ['UPCOMING', 'LIVE'] } },
    include: {
      player1: { select: { id: true, elo: true, winrate: true, totalGames: true, currentStreak: true, peakElo: true, lastMatchAt: true } },
      player2: { select: { id: true, elo: true, winrate: true, totalGames: true, currentStreak: true, peakElo: true, lastMatchAt: true } },
    },
  });

  const { adjustOddsAdvanced } = await import('../services/oddsEngine');

  for (const match of activeMatches) {
    try {
      const h2h = await getPlayerH2HFromHistory(match.player1.id, match.player2.id, match.game);
      const modelOdds = calculateOddsFromPlayers(match.player1, match.player2, h2h);

      const modelChanged = Math.abs(modelOdds.odds1 - match.odds1) > 0.005 || Math.abs(modelOdds.odds2 - match.odds2) > 0.005;
      if (modelChanged) {
        // Write fresh model odds to DB (volume adjustment is never stored — always computed live)
        await prisma.match.update({ where: { id: match.id }, data: { odds1: modelOdds.odds1, odds2: modelOdds.odds2 } });
      }

      // Apply volume adjustment on top of model odds for broadcast
      const bets = await prisma.bet.findMany({
        where: { matchId: match.id, status: { notIn: ['CANCELLED', 'REFUNDED'] } },
        select: { amount: true, oddsAtBet: true, selectedPlayer: true },
      });
      const betRecords = bets.map((b) => ({ amount: b.amount, oddsAtBet: b.oddsAtBet, selectedPlayer: b.selectedPlayer as 1 | 2 }));
      const liveOdds = adjustOddsAdvanced(modelOdds.odds1, modelOdds.odds2, betRecords);

      const broadcastChanged = modelChanged
        || Math.abs(liveOdds.odds1 - match.odds1) > 0.005
        || Math.abs(liveOdds.odds2 - match.odds2) > 0.005;
      if (!broadcastChanged) continue;

      io?.to(`matchRoom:${match.id}`).emit('oddsUpdate', { matchId: match.id, odds1: liveOdds.odds1, odds2: liveOdds.odds2, timestamp: new Date().toISOString() });
      io?.emit('matchUpdate', { matchId: match.id, odds1: liveOdds.odds1, odds2: liveOdds.odds2 });
    } catch { /* skip match on error */ }
  }
  logger.info(`[FastRecalc] Recalculated odds for ${activeMatches.length} active matches`);
}

async function distributePayouts(): Promise<void> {
  const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000);
  const io = getIo();

  const completed = await prisma.match.findMany({
    where: {
      status: 'COMPLETED',
      winnerId: { not: null },
      updatedAt: { lte: fifteenMinAgo },
      bets: { some: { status: 'PENDING' } },
    },
    take: 20,
  });

  for (const match of completed) {
    if (match.winnerId) {
      await distributePayout(match.id, match.winnerId);
      logger.info(`[Tick] Payouts distributed for ${match.id}`);
      io?.to(`matchRoom:${match.id}`).emit('payoutsDistributed', { matchId: match.id, winnerId: match.winnerId });
    }
  }
}
