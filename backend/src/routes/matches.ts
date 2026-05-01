import { Router, Request, Response } from 'express';
import { prisma } from '../index';
import { MatchStatus } from '@prisma/client';
import { z } from 'zod';
import { adjustOddsAdvanced, BetRecord } from '../services/oddsEngine';
import logger from '../logger';

const router = Router();

// Simple in-memory cache for match list (invalidated every 10s)
let matchListCache: { key: string; data: unknown; ts: number } | null = null;
const MATCH_CACHE_TTL = 10_000; // 10 seconds

// Per-id caches for /matches/:id and /matches/:id/h2h. The match detail page
// is the second-most polled endpoint after the list — we already serve
// COMPLETED with a 1h Cache-Control but UPCOMING/LIVE were uncached; with
// Supabase egress at the limit we now cache them server-side too. H2H is
// nearly static between matches so 5 min is generous.
const matchByIdCache = new Map<string, { data: unknown; ts: number }>();
const MATCH_BY_ID_TTL = 30_000; // 30 s for UPCOMING/LIVE
const h2hCache = new Map<string, { data: unknown; ts: number }>();
const H2H_TTL = 5 * 60_000; // 5 min

const matchQuerySchema = z.object({
  status: z.enum(['UPCOMING', 'LIVE', 'COMPLETED', 'CANCELLED', 'POSTPONED']).optional(),
  tournamentId: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
  hours: z.coerce.number().min(1).max(720).default(168),
});

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const query = matchQuerySchema.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: 'Invalid query parameters', details: query.error.flatten() });
      return;
    }

    const { status, tournamentId, limit, offset, hours } = query.data;

    // Serve from cache for default queries (home page polls every 30s)
    if (!status && !tournamentId && offset === 0 && matchListCache && matchListCache.key === `${limit}_${hours}` && Date.now() - matchListCache.ts < MATCH_CACHE_TTL) {
      res.set('Cache-Control', 'public, max-age=10, stale-while-revalidate=30');
      res.json(matchListCache.data);
      return;
    }

    const whereClause: Record<string, unknown> = {};

    if (status) {
      whereClause.status = status as MatchStatus;
    } else {
      // Par défaut : LIVE + UPCOMING + COMPLETED within last 48h only
      const futureCutoff = new Date();
      futureCutoff.setHours(futureCutoff.getHours() + hours);
      const completedCutoff = new Date(Date.now() - 48 * 3600 * 1000); // 48 hours ago

      whereClause.OR = [
        { status: 'LIVE' },
        { status: 'UPCOMING', scheduledAt: { lte: futureCutoff } },
        { status: 'COMPLETED', updatedAt: { gte: completedCutoff } },
      ];
    }

    if (tournamentId) {
      whereClause.tournamentId = tournamentId;
    }

    const [matches, total] = await Promise.all([
      prisma.match.findMany({
        where: whereClause,
        include: {
          player1: {
            select: {
              id: true,
              name: true,
              elo: true,
              winrate: true,
              country: true,
              avatarUrl: true,
            },
          },
          player2: {
            select: {
              id: true,
              name: true,
              elo: true,
              winrate: true,
              country: true,
              avatarUrl: true,
            },
          },
          tournament: {
            select: {
              id: true,
              name: true,
              tier: true,
              logoUrl: true,
              twitchChannel: true,
            },
          },
          boResults: {
            orderBy: { boNumber: 'asc' },
            select: { boNumber: true, winnerId: true, p1Civ: true, p2Civ: true, map: true, duration: true },
          },
          _count: {
            select: { bets: true },
          },
        },
        orderBy: { scheduledAt: 'asc' },
        take: Math.max(limit, 50), // fetch more to ensure LIVE/UPCOMING aren't cut off by COMPLETED
        skip: offset,
      }),
      prisma.match.count({ where: whereClause }),
    ]);

    // Batch-fetch all bets for all matches in one query (efficient, no N+1)
    const matchIds = matches.map((m) => m.id);
    const allBets = await prisma.bet.findMany({
      where: { matchId: { in: matchIds }, status: { notIn: ['CANCELLED', 'REFUNDED'] } },
      select: { matchId: true, amount: true, oddsAtBet: true, selectedPlayer: true },
    });

    // Group bets by matchId
    const betsByMatch = new Map<string, BetRecord[]>();
    for (const bet of allBets) {
      const list = betsByMatch.get(bet.matchId) ?? [];
      list.push({ amount: bet.amount, oddsAtBet: bet.oddsAtBet, selectedPlayer: bet.selectedPlayer as 1 | 2 });
      betsByMatch.set(bet.matchId, list);
    }

    // Compute volume stats and adjusted odds per match
    const matchesWithVolume = matches.map((match) => {
      const bets = betsByMatch.get(match.id) ?? [];
      const vol1 = bets.filter((b) => b.selectedPlayer === 1).reduce((s, b) => s + b.amount, 0);
      const vol2 = bets.filter((b) => b.selectedPlayer === 2).reduce((s, b) => s + b.amount, 0);
      const total = vol1 + vol2;
      const liveOdds = adjustOddsAdvanced(match.odds1, match.odds2, bets);

      return {
        ...match,
        odds1: liveOdds.odds1,
        odds2: liveOdds.odds2,
        betVolume: {
          player1: vol1,
          player2: vol2,
          total,
          pct1: total > 0 ? Math.round((vol1 / total) * 100) : 50,
          pct2: total > 0 ? Math.round((vol2 / total) * 100) : 50,
        },
      };
    });

    // Sort: LIVE first, then UPCOMING, then COMPLETED/CANCELLED
    const statusOrder: Record<string, number> = { LIVE: 0, UPCOMING: 1, COMPLETED: 2, CANCELLED: 3, POSTPONED: 4 };
    matchesWithVolume.sort((a, b) => {
      const sa = statusOrder[a.status] ?? 9;
      const sb = statusOrder[b.status] ?? 9;
      if (sa !== sb) return sa - sb;
      // Within same status: upcoming by soonest, completed by most recent
      if (a.status === 'UPCOMING') return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
      return new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime();
    });

    // Trim to requested limit
    const trimmed = matchesWithVolume.slice(0, limit);
    const result = { data: trimmed, total, limit, offset };
    // Cache the default query (most common)
    if (!status && !tournamentId && offset === 0) {
      matchListCache = { key: `${limit}_${hours}`, data: result, ts: Date.now() };
    }
    // Client-side cache: 10s fresh + 30s stale-while-revalidate
    res.set('Cache-Control', 'public, max-age=10, stale-while-revalidate=30');
    res.json(result);
  } catch (error) {
    logger.error('GET /matches error:', error);
    res.status(500).json({ error: 'Failed to fetch matches' });
  }
});

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // Server-side cache for UPCOMING/LIVE — egress savings, see
    // audit/EGRESS_AUDIT_2026-05-02.md. COMPLETED relies on Cache-Control.
    const cached = matchByIdCache.get(id);
    if (cached && Date.now() - cached.ts < MATCH_BY_ID_TTL) {
      res.set('Cache-Control', 'public, max-age=10, stale-while-revalidate=30');
      res.json(cached);
      return;
    }

    const match = await prisma.match.findUnique({
      where: { id },
      include: {
        player1: true,
        player2: true,
        tournament: true,
        boResults: { orderBy: { boNumber: 'asc' } },
      },
    });

    if (!match) {
      res.status(404).json({ error: 'Match not found' });
      return;
    }

    // Fetch individual bets for liability + sharp/square adjustment
    const matchBets = await prisma.bet.findMany({
      where: { matchId: id, status: { notIn: ['CANCELLED', 'REFUNDED'] } },
      select: { amount: true, oddsAtBet: true, selectedPlayer: true },
    });

    const betRecords = matchBets.map((b) => ({
      amount: b.amount,
      oddsAtBet: b.oddsAtBet,
      selectedPlayer: b.selectedPlayer as 1 | 2,
    })) satisfies BetRecord[];

    const vol1 = betRecords.filter((b) => b.selectedPlayer === 1).reduce((s, b) => s + b.amount, 0);
    const vol2 = betRecords.filter((b) => b.selectedPlayer === 2).reduce((s, b) => s + b.amount, 0);
    const count1 = matchBets.filter((b) => b.selectedPlayer === 1).length;
    const count2 = matchBets.filter((b) => b.selectedPlayer === 2).length;
    const totalVol = vol1 + vol2;

    const liveOdds = adjustOddsAdvanced(match.odds1, match.odds2, betRecords);

    // Get recent matches for each player (form)
    const [recentP1, recentP2] = await Promise.all([
      prisma.match.findMany({
        where: {
          status: 'COMPLETED',
          OR: [{ player1Id: match.player1Id }, { player2Id: match.player1Id }],
        },
        orderBy: { scheduledAt: 'desc' },
        take: 5,
        select: {
          id: true,
          player1Id: true,
          player2Id: true,
          winnerId: true,
          resultScore: true,
          scheduledAt: true,
          player1: { select: { name: true } },
          player2: { select: { name: true } },
        },
      }),
      prisma.match.findMany({
        where: {
          status: 'COMPLETED',
          OR: [{ player1Id: match.player2Id }, { player2Id: match.player2Id }],
        },
        orderBy: { scheduledAt: 'desc' },
        take: 5,
        select: {
          id: true,
          player1Id: true,
          player2Id: true,
          winnerId: true,
          resultScore: true,
          scheduledAt: true,
          player1: { select: { name: true } },
          player2: { select: { name: true } },
        },
      }),
    ]);

    // Completed matches are immutable → cache aggressively.
    // Live/Upcoming matches change → short cache with stale-while-revalidate.
    if (match.status === 'COMPLETED' || match.status === 'CANCELLED') {
      res.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=7200');
    } else {
      res.set('Cache-Control', 'public, max-age=10, stale-while-revalidate=30');
    }

    const payload = {
      data: {
        ...match,
        odds1: liveOdds.odds1,
        odds2: liveOdds.odds2,
        betVolume: {
          player1: vol1,
          player2: vol2,
          total: totalVol,
          pct1: totalVol > 0 ? Math.round((vol1 / totalVol) * 100) : 50,
          pct2: totalVol > 0 ? Math.round((vol2 / totalVol) * 100) : 50,
          count1,
          count2,
        },
        recentForm: {
          player1: recentP1,
          player2: recentP2,
        },
      },
    };
    // Cache UPCOMING/LIVE only (COMPLETED already gets a 1h Cache-Control
    // and is immutable so caching forever in memory would just leak).
    if (match.status === 'UPCOMING' || match.status === 'LIVE') {
      matchByIdCache.set(id, { data: payload, ts: Date.now() });
    }
    res.json(payload);
  } catch (error) {
    logger.error('GET /matches/:id error:', error);
    res.status(500).json({ error: 'Failed to fetch match' });
  }
});

router.get('/:id/h2h', async (req: Request, res: Response): Promise<void> => {
  try {
    const cacheKey = req.params.id;
    const cached = h2hCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < H2H_TTL) {
      res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
      res.json(cached);
      return;
    }

    const match = await prisma.match.findUnique({
      where: { id: req.params.id },
      select: { player1Id: true, player2Id: true },
    });

    if (!match) {
      res.status(404).json({ error: 'Match not found' });
      return;
    }

    const h2hMatches = await prisma.match.findMany({
      where: {
        status: 'COMPLETED',
        OR: [
          { player1Id: match.player1Id, player2Id: match.player2Id },
          { player1Id: match.player2Id, player2Id: match.player1Id },
        ],
      },
      orderBy: { scheduledAt: 'desc' },
      take: 20,
      include: {
        player1: { select: { id: true, name: true } },
        player2: { select: { id: true, name: true } },
        tournament: { select: { name: true, tier: true } },
      },
    });

    const p1Wins = h2hMatches.filter((m) => m.winnerId === match.player1Id).length;
    const p2Wins = h2hMatches.filter((m) => m.winnerId === match.player2Id).length;

    const payload = {
      data: {
        matches: h2hMatches,
        summary: {
          total: h2hMatches.length,
          player1Wins: p1Wins,
          player2Wins: p2Wins,
        },
      },
    };
    h2hCache.set(cacheKey, { data: payload, ts: Date.now() });
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
    res.json(payload);
  } catch (error) {
    logger.error('GET /matches/:id/h2h error:', error);
    res.status(500).json({ error: 'Failed to fetch H2H data' });
  }
});

export default router;
