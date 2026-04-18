import cron from 'node-cron';
import { prisma } from '../index';
import { enrichAllUpcomingMatches } from '../scrapers/aoe4worldScraper';
import { scrapeAoe4WorldTournaments } from '../scrapers/aoe4worldTournamentScraper';
import { scrapeUpcomingMatches } from '../scrapers/liquipediaScraper';
import { syncAoeEventCalendar } from '../scrapers/aoeEventCalendarScraper';
import { distributePayout, refundBets } from '../services/betService';
import { getIo } from '../socket';
import logger from '../logger';

// Guard against concurrent enrichment / recalc runs
let enrichmentRunning = false;

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

  // ── Every 10 minutes (offset by 5): fast odds recalc from DB only ──────────
  // Offset to minutes 5,15,25,35,45,55 so it never collides with the */30
  // full enrichment — both compute odds, running them together doubles DB
  // queries and LP requests for no benefit.
  cron.schedule('5,15,25,35,45,55 * * * *', async () => {
    if (enrichmentRunning) { logger.info('[FastRecalc] Skipped — enrichment in progress'); return; }
    try {
      await recalcActiveMatchOdds();
    } catch (err) {
      logger.error('[CRON] fast recalc failed:', err);
    }
  });

  // ── Every 30 minutes: full enrichment (player stats from aoe4world + H2H) ──
  cron.schedule('*/30 * * * *', async () => {
    if (enrichmentRunning) return;
    enrichmentRunning = true;
    try {
      await enrichAllUpcomingMatches();
    } catch (err) {
      logger.error('[CRON] enrichOdds failed:', err);
    } finally {
      enrichmentRunning = false;
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

  // ── Every minute: transition match statuses + close bets ──────────────────
  cron.schedule('* * * * *', async () => {
    try {
      await tickMatchStatuses();
      await closeBetsPreMatch();
    } catch (err) {
      logger.error('[CRON] tick failed:', err);
    }
  });

  // ── Every minute: auto-cancel stale coinflips (>15 min waiting) ────────────
  cron.schedule('* * * * *', async () => {
    try {
      const { cancelStaleCoinFlips } = await import('../services/coinflipService');
      await cancelStaleCoinFlips();
    } catch (err) {
      logger.error('[CRON] cancelStaleCoinFlips failed:', err);
    }
  });

  // ── Every 10 minutes: deactivate tournaments with all matches completed ────
  cron.schedule('*/10 * * * *', async () => {
    try {
      // Find active tournaments where ALL matches are COMPLETED/CANCELLED (none UPCOMING/LIVE)
      const activeTournaments = await prisma.tournament.findMany({
        where: { isActive: true },
        select: {
          id: true, name: true,
          matches: { select: { status: true }, where: { status: { in: ['UPCOMING', 'LIVE'] } } },
          _count: { select: { matches: true } },
        },
      });
      for (const t of activeTournaments) {
        // Only deactivate if tournament has matches and none are active
        if (t._count.matches > 0 && t.matches.length === 0) {
          await prisma.tournament.update({ where: { id: t.id }, data: { isActive: false } });
          logger.info(`[Tick] Tournament "${t.name}" → isActive=false (all ${t._count.matches} matches completed)`);
        }
      }
    } catch (err) {
      logger.error('[CRON] tournament deactivation failed:', err);
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

  // ── Every 5 minutes: poll OxaPay for pending deposits whose IPN was lost ──
  // Transactions stay "pending" if the webhook didn't reach us (network, WAF,
  // expired cert). We re-query OxaPay's inquiry endpoint and apply the same
  // credit/fail logic as the webhook. Rate-limited internally (250ms gap).
  cron.schedule('*/5 * * * *', async () => {
    try {
      const { syncOxaPayDepositStatus } = await import('../routes/payments');
      // Only sync deposits created > 2 min ago — fresh ones may still resolve
      // via webhook and we don't want to race the IPN.
      const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000);
      const pending = await prisma.transaction.findMany({
        where: { type: 'deposit', status: 'pending', createdAt: { lt: twoMinAgo } },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: { id: true },
      });
      let resolved = 0;
      for (const tx of pending) {
        const r = await syncOxaPayDepositStatus(tx.id);
        if (r === 'paid' || r === 'expired' || r === 'failed') resolved++;
        await new Promise(res => setTimeout(res, 250));
      }
      if (pending.length > 0) {
        logger.info(`[CRON] OxaPay sync: ${pending.length} pending, ${resolved} resolved`);
      }
    } catch (err) {
      logger.error('[CRON] OxaPay sync failed:', err);
    }
  });

  logger.info('All cron jobs initialized');

  // ── Run critical checks immediately on startup ────────────────────────────
  setImmediate(async () => {
    try {
      logger.info('[Startup] Immediate status sync...');
      await tickMatchStatuses();
      await distributePayouts();
      // Non-blocking startup tasks — guard enrichment to prevent overlap with cron
      syncAoeEventCalendar()
        .then(() => scrapeUpcomingMatches())
        .catch(err => logger.error('[Startup] Calendar + Liquipedia scrape:', err));
      enrichmentRunning = true;
      scrapeAoe4WorldTournaments()
        .then(() => enrichAllUpcomingMatches())
        .catch(err => logger.error('[Startup] aoe4world tourn + enrichOdds:', err))
        .finally(() => { enrichmentRunning = false; });
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

  // ── Fix falsely-LIVE matches (scheduledAt still >1h in the future) ────────
  // Race conditions in the scraper can create duplicates with wrong dates that
  // get auto-promoted to LIVE. Revert them to UPCOMING.
  const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
  const falselyLive = await prisma.match.findMany({
    where: { status: 'LIVE', winnerId: null, scheduledAt: { gt: oneHourFromNow } },
    select: { id: true, scheduledAt: true },
  });
  for (const match of falselyLive) {
    await prisma.match.update({ where: { id: match.id }, data: { status: 'UPCOMING' } });
    io?.emit('matchUpdate', { matchId: match.id, status: 'UPCOMING' });
    logger.info(`[Tick] ${match.id} → reverted to UPCOMING (scheduledAt ${match.scheduledAt.toISOString()} is still in the future)`);
  }

  // ── UPCOMING → LIVE ───────────────────────────────────────────────────────
  const toStart = await prisma.match.findMany({
    where: { status: 'UPCOMING', scheduledAt: { lte: now } },
    select: { id: true, scheduledAt: true },
  });

  for (const match of toStart) {
    await prisma.match.update({ where: { id: match.id }, data: { status: 'LIVE', betsOpen: false } });
    io?.to(`matchRoom:${match.id}`).emit('matchStatusUpdate', { matchId: match.id, status: 'LIVE' });
    io?.emit('matchUpdate', { matchId: match.id, status: 'LIVE', betsOpen: false });
    logger.info(`[Tick] ${match.id} → LIVE (bets closed)`);
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
  const { calculateOddsV2 } = await import('../services/oddsEngine');
  const { getPlayerH2HFromHistory } = await import('../scrapers/aiPlayerHistoryScraper');

  const SENTINEL_OPPONENT = '__AI_ENRICHED__';
  const activeMatches = await prisma.match.findMany({
    where: { status: { in: ['UPCOMING', 'LIVE'] } },
    include: {
      player1: { select: { id: true, lastMatchAt: true } },
      player2: { select: { id: true, lastMatchAt: true } },
      tournament: { select: { tier: true } },
    },
  });

  const { adjustOddsAdvanced } = await import('../services/oddsEngine');

  for (const match of activeMatches) {
    try {
      // Load full match records for both players (filtered by game)
      const [p1Records, p2Records] = await Promise.all([
        prisma.playerMatchRecord.findMany({
          where: { playerId: match.player1.id, game: match.game, NOT: { opponentName: SENTINEL_OPPONENT } },
          select: { won: true, tier: true, matchDate: true, opponentId: true },
        }),
        prisma.playerMatchRecord.findMany({
          where: { playerId: match.player2.id, game: match.game, NOT: { opponentName: SENTINEL_OPPONENT } },
          select: { won: true, tier: true, matchDate: true, opponentId: true },
        }),
      ]);

      // If BOTH players have 0 tournament records, suspend bets — odds are
      // meaningless without data. An admin needs to seed the players first.
      if (p1Records.length === 0 && p2Records.length === 0) {
        if (match.betsOpen !== false) {
          await prisma.match.update({ where: { id: match.id }, data: { betsOpen: false } });
          io?.emit('matchUpdate', { matchId: match.id, betsOpen: false, insufficientData: true });
          logger.info(`[FastRecalc] Match ${match.id}: bets suspended — both players have 0 tournament records`);
        }
        continue;
      }

      // If bets were suspended due to missing data but we now have records, reopen
      if (match.betsOpen === false && (p1Records.length > 0 || p2Records.length > 0) && match.status === 'UPCOMING') {
        await prisma.match.update({ where: { id: match.id }, data: { betsOpen: true } });
        io?.emit('matchUpdate', { matchId: match.id, betsOpen: true });
        logger.info(`[FastRecalc] Match ${match.id}: bets reopened — player data now available`);
      }

      const h2h = await getPlayerH2HFromHistory(match.player1.id, match.player2.id, match.game);
      const now = Date.now();
      const days1 = match.player1.lastMatchAt ? (now - match.player1.lastMatchAt.getTime()) / 86400000 : 30;
      const days2 = match.player2.lastMatchAt ? (now - match.player2.lastMatchAt.getTime()) / 86400000 : 30;

      // Build opponent-winrate map — each tournament record's opponentId gets
      // its true winrate so the engine can downweight wins against weak
      // opponents (farming weeklies against randoms) and upweight wins
      // against strong pros.
      const opponentIds = new Set<string>();
      for (const r of [...p1Records, ...p2Records]) if (r.opponentId) opponentIds.add(r.opponentId);
      const oppWinrateMap = new Map<string, number>();
      if (opponentIds.size > 0) {
        const oppRecords = await prisma.playerMatchRecord.findMany({
          where: { playerId: { in: [...opponentIds] }, game: match.game },
          select: { playerId: true, won: true },
        });
        const grouped = new Map<string, { total: number; wins: number }>();
        for (const r of oppRecords) {
          const g = grouped.get(r.playerId) ?? { total: 0, wins: 0 };
          g.total++;
          if (r.won) g.wins++;
          grouped.set(r.playerId, g);
        }
        for (const [id, s] of grouped.entries()) {
          if (s.total >= 3) oppWinrateMap.set(id, s.wins / s.total);
        }
      }

      const modelOdds = calculateOddsV2({
        p1Records: p1Records.map(r => ({ won: r.won, tier: r.tier ?? 'B', matchDate: r.matchDate, opponentId: r.opponentId })),
        p2Records: p2Records.map(r => ({ won: r.won, tier: r.tier ?? 'B', matchDate: r.matchDate, opponentId: r.opponentId })),
        h2h,
        daysSinceLastMatch1: days1,
        daysSinceLastMatch2: days2,
        matchTier: match.tournament?.tier ?? undefined,
        format: match.format,
        opponentWinrates: oppWinrateMap,
      });

      const drawChanged = modelOdds.oddsDraw !== undefined &&
        (match.oddsDraw == null || Math.abs(modelOdds.oddsDraw - match.oddsDraw) > 0.005);
      const modelChanged =
        Math.abs(modelOdds.odds1 - match.odds1) > 0.005
        || Math.abs(modelOdds.odds2 - match.odds2) > 0.005
        || drawChanged;
      if (modelChanged) {
        // Write fresh model odds to DB — MUST include oddsDraw for even BO
        // formats, otherwise odds1/odds2 get refreshed but oddsDraw stays
        // stale, causing the three markets to be internally incoherent
        // (free money via arbitrage).
        await prisma.match.update({
          where: { id: match.id },
          data: {
            odds1: modelOdds.odds1,
            odds2: modelOdds.odds2,
            oddsDraw: modelOdds.oddsDraw ?? null,
          },
        });
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

  // Distribute payouts in parallel — matches are independent.
  // Previously serial: 20 matches × ~50ms each = up to 1s event-loop block.
  await Promise.all(
    completed
      .filter(m => m.winnerId)
      .map(async (match) => {
        try {
          await distributePayout(match.id, match.winnerId!);
          logger.info(`[Tick] Payouts distributed for ${match.id}`);
          io?.to(`matchRoom:${match.id}`).emit('payoutsDistributed', { matchId: match.id, winnerId: match.winnerId });
        } catch (err) {
          logger.error(`[Tick] distributePayout failed for ${match.id}:`, err);
        }
      })
  );
}
