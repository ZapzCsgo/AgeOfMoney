import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { placeBet, getUserStats } from '../services/betService';
import { buildBlendedDistribution, type Bo, type ScoreDistribution } from '../services/exactScoreModel';
import { prisma } from '../index';
import { z } from 'zod';
import logger from '../logger';

const router = Router();

const placeBetSchema = z.object({
  matchId: z.string().min(1),
  amount: z.number().int().min(10, 'Minimum bet is 10 coins').max(500, 'Maximum bet is 500 coins'),
  selectedPlayer: z.union([z.literal(0), z.literal(1), z.literal(2)]),
});

// POST / - Place a bet
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = placeBetSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid bet data', details: parsed.error.flatten() });
      return;
    }

    const { matchId, amount, selectedPlayer } = parsed.data;
    const userId = req.user!.id;

    const bet = await placeBet(userId, matchId, amount, selectedPlayer);

    res.status(201).json({ data: bet, message: 'Bet placed successfully' });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('Insufficient') || error.message.includes('closed') ||
          error.message.includes('already') || error.message.includes('not found') ||
          error.message.includes('maximum')) {
        res.status(400).json({ error: error.message });
        return;
      }
    }
    logger.error('POST /bets error:', error);
    res.status(500).json({ error: 'Failed to place bet' });
  }
});

// GET /my - Get current user's bets
const ALLOWED_BET_STATUS = ['PENDING', 'WON', 'LOST', 'REFUNDED', 'CANCELLED'] as const;
router.get('/my', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const statusFilterRaw = req.query.status as string | undefined;
    const statusFilter = statusFilterRaw && (ALLOWED_BET_STATUS as readonly string[]).includes(statusFilterRaw)
      ? statusFilterRaw
      : undefined;
    const limit = Math.min(Math.max(parseInt(req.query.limit as string || '20'), 1), 100);
    const offset = Math.max(parseInt(req.query.offset as string || '0'), 0);

    const whereClause: Record<string, unknown> = { userId };
    if (statusFilter) {
      whereClause.status = statusFilter;
    }

    const [bets, total] = await Promise.all([
      prisma.bet.findMany({
        where: whereClause,
        include: {
          match: {
            include: {
              player1: { select: { id: true, name: true, country: true } },
              player2: { select: { id: true, name: true, country: true } },
              tournament: { select: { id: true, name: true, tier: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: Math.min(limit, 100),
        skip: offset,
      }),
      prisma.bet.count({ where: whereClause }),
    ]);

    const stats = await getUserStats(userId);

    res.json({ data: bets, total, stats, limit, offset });
  } catch (error) {
    logger.error('GET /bets/my error:', error);
    res.status(500).json({ error: 'Failed to fetch bets' });
  }
});

// ── Exact score odds helper ───────────────────────────────────────────────────
// Given per-game win probability p for P1 and format, return all score probs
function solvePerGameProb(pMatch: number, format: string): number {
  // Binary search for per-game probability p such that P(P1 wins series) = pMatch
  const seriesWin = (p: number): number => {
    if (format === 'BO1') return p;
    if (format === 'BO3') return p*p*(3 - 2*p);
    if (format === 'BO5') return p*p*p*(1 + 3*(1-p) + 6*(1-p)*(1-p));
    if (format === 'BO7') return p*p*p*p*(1 + 4*(1-p) + 10*(1-p)*(1-p) + 20*(1-p)*(1-p)*(1-p));
    return p;
  };
  if (pMatch <= 0 || pMatch >= 1) return pMatch;
  let lo = 0.001, hi = 0.999;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (seriesWin(mid) < pMatch) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

const EXACT_SCORE_MARGIN = 0.15; // 15% house edge — esport industry standard
// Hard max odds on exact-score bets. At launch we prefer to never pay more
// than 15x the stake on a rare score, even if the model thinks it's that
// unlikely. This is a final safety net on top of the distribution corridor
// already enforced in exactScoreModel.ts.
const EXACT_SCORE_MAX_ODDS = 15;

type ScoreEntry = { score: string; player: 1|2; loserGames: number; odds: number };

/**
 * Build the theoretical (binomial) probability distribution from the match
 * odds alone. This is the BASE RATE — no player history, just the maths.
 */
function theoreticalDistribution(odds1: number, odds2: number, format: string): ScoreDistribution {
  const raw1 = 1/odds1, raw2 = 1/odds2;
  const norm = raw1 + raw2;
  const pMatch1 = raw1 / norm;
  const p = solvePerGameProb(pMatch1, format);
  const q = 1 - p;

  const dist: ScoreDistribution = {};
  if (format === 'BO1') {
    dist['1-0'] = p;
    dist['0-1'] = q;
  } else if (format === 'BO3') {
    dist['2-0'] = p*p;
    dist['2-1'] = 2*p*p*q;
    dist['0-2'] = q*q;
    dist['1-2'] = 2*q*q*p;
  } else if (format === 'BO5') {
    dist['3-0'] = p*p*p;
    dist['3-1'] = 3*p*p*p*q;
    dist['3-2'] = 6*p*p*p*q*q;
    dist['0-3'] = q*q*q;
    dist['1-3'] = 3*q*q*q*p;
    dist['2-3'] = 6*q*q*q*p*p;
  } else if (format === 'BO7') {
    dist['4-0'] = p*p*p*p;
    dist['4-1'] = 4*p*p*p*p*q;
    dist['4-2'] = 10*p*p*p*p*q*q;
    dist['4-3'] = 20*p*p*p*p*q*q*q;
    dist['0-4'] = q*q*q*q;
    dist['1-4'] = 4*q*q*q*q*p;
    dist['2-4'] = 10*q*q*q*q*p*p;
    dist['3-4'] = 20*q*q*q*q*p*p*p;
  }
  return dist;
}

/** Convert a probability distribution to the entries expected by the API. */
function distributionToEntries(dist: ScoreDistribution): ScoreEntry[] {
  const entries: ScoreEntry[] = [];
  for (const [score, prob] of Object.entries(dist)) {
    const [a, b] = score.split('-').map(Number);
    const player: 1|2 = a > b ? 1 : 2;
    const loserGames = Math.min(a, b);
    // Cap the maximum payout so a single rare-score bet can't blow up the book
    const raw = prob > 0 ? (1/prob) * (1 - EXACT_SCORE_MARGIN) : EXACT_SCORE_MAX_ODDS;
    const capped = Math.min(raw, EXACT_SCORE_MAX_ODDS);
    entries.push({
      score,
      player,
      loserGames,
      odds: parseFloat(capped.toFixed(2)),
    });
  }
  return entries;
}

/**
 * Synchronous fallback (theoretical only) — used when we don't have player
 * IDs or when the DB blend fails. Keeps older call sites working.
 */
function exactScoreOdds(odds1: number, odds2: number, format: string): ScoreEntry[] {
  return distributionToEntries(theoreticalDistribution(odds1, odds2, format));
}

/**
 * Data-driven exact score odds. Blends the theoretical binomial with
 * observed player history and head-to-head records, then applies the
 * house margin. Falls back to pure theoretical on any error.
 */
async function exactScoreOddsBlended(
  matchId: string,
  p1Id: string,
  p2Id: string,
  odds1: number,
  odds2: number,
  format: string,
): Promise<ScoreEntry[]> {
  if (format === 'BO1') return exactScoreOdds(odds1, odds2, format);
  try {
    const theoretical = theoreticalDistribution(odds1, odds2, format);
    const blended = await buildBlendedDistribution(
      theoretical, matchId, p1Id, p2Id, format as Bo, odds1, odds2,
    );
    return distributionToEntries(blended);
  } catch (err) {
    logger.warn('[ExactScore] Blend failed, falling back to theoretical:', err);
    return exactScoreOdds(odds1, odds2, format);
  }
}

// GET /exact-scores/:matchId — Compute exact score odds for a match
router.get('/exact-scores/:matchId', async (req: Request, res: Response): Promise<void> => {
  try {
    const match = await prisma.match.findUnique({
      where: { id: req.params.matchId },
      select: {
        id: true, format: true, odds1: true, odds2: true,
        status: true, betsOpen: true, scheduledAt: true,
        player1Id: true, player2Id: true,
      },
    });
    if (!match) { res.status(404).json({ error: 'Match not found' }); return; }
    if (match.format === 'BO1') { res.json({ data: [] }); return; } // no exact score for BO1
    const scores = await exactScoreOddsBlended(
      match.id, match.player1Id, match.player2Id, match.odds1, match.odds2, match.format,
    );
    res.json({ data: scores });
  } catch (error) {
    logger.error('GET /bets/exact-scores/:matchId error:', error);
    res.status(500).json({ error: 'Failed to compute exact score odds' });
  }
});

// POST /exact — Place an exact score bet
// NOTE: odds are intentionally NOT accepted from the client. The server
// recomputes them from the match state to prevent any forging attempt.
const exactBetSchema = z.object({
  matchId: z.string().min(1),
  amount: z.number().int().min(10).max(500),
  score: z.string().min(3),         // e.g. "2-1"
  player: z.union([z.literal(1), z.literal(2)]),
  loserGames: z.number().int().min(0),
}).strict();

router.post('/exact', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = exactBetSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'Invalid bet data' }); return; }
    const { matchId, amount, score, player, loserGames } = parsed.data;
    const userId = req.user!.id;

    const [match, user] = await Promise.all([
      prisma.match.findUnique({
        where: { id: matchId },
        select: {
          status: true, betsOpen: true, scheduledAt: true,
          odds1: true, odds2: true, format: true,
          player1Id: true, player2Id: true,
        },
      }),
      prisma.user.findUnique({ where: { id: userId }, select: { coins: true, isBanned: true } }),
    ]);
    if (!match) { res.status(404).json({ error: 'Match not found' }); return; }
    if (!user || user.isBanned) { res.status(400).json({ error: 'Account banned' }); return; }
    if (match.status !== 'UPCOMING') { res.status(400).json({ error: 'Betting is closed' }); return; }
    if (!match.betsOpen) { res.status(400).json({ error: 'Bets temporarily closed' }); return; }
    if (new Date() >= match.scheduledAt) { res.status(400).json({ error: 'Match has started' }); return; }
    if (user.coins < amount) { res.status(400).json({ error: 'Insufficient coins' }); return; }

    // Verify odds are still valid (recompute server-side with blended model)
    const freshScores = await exactScoreOddsBlended(
      matchId, match.player1Id, match.player2Id, match.odds1, match.odds2, match.format,
    );
    const freshEntry = freshScores.find(s => s.score === score);
    if (!freshEntry) { res.status(400).json({ error: 'Invalid score for this match format' }); return; }
    const oddsAtBet = freshEntry.odds; // always use server-computed odds

    const bet = await prisma.$transaction(async (tx) => {
      const freshUser = await tx.user.findUnique({ where: { id: userId }, select: { coins: true } });
      if (!freshUser || freshUser.coins < amount) throw new Error('Insufficient coins');
      await tx.user.update({ where: { id: userId }, data: { coins: { decrement: amount }, totalWagered: { increment: amount } } });
      return tx.bet.create({
        data: { userId, matchId, betType: 'EXACT_SCORE', amount, oddsAtBet, selectedPlayer: player, boNumber: loserGames, status: 'PENDING' },
      });
    });

    logger.info(`Exact score bet: user=${userId}, match=${matchId}, score=${score}, amount=${amount}, odds=${oddsAtBet}`);
    res.status(201).json({ data: bet });
  } catch (err) {
    if (err instanceof Error) res.status(400).json({ error: err.message });
    else res.status(500).json({ error: 'Failed to place exact score bet' });
  }
});

// GET /match/:matchId - Get anonymized bet totals for a match
router.get('/match/:matchId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { matchId } = req.params;

    const match = await prisma.match.findUnique({
      where: { id: matchId },
      select: { id: true },
    });

    if (!match) {
      res.status(404).json({ error: 'Match not found' });
      return;
    }

    const betAgg = await prisma.bet.groupBy({
      by: ['selectedPlayer'],
      where: { matchId, status: { notIn: ['CANCELLED', 'REFUNDED'] } },
      _sum: { amount: true },
      _count: true,
    });

    const vol1 = betAgg.find((b) => b.selectedPlayer === 1)?._sum?.amount ?? 0;
    const vol2 = betAgg.find((b) => b.selectedPlayer === 2)?._sum?.amount ?? 0;
    const count1 = betAgg.find((b) => b.selectedPlayer === 1)?._count ?? 0;
    const count2 = betAgg.find((b) => b.selectedPlayer === 2)?._count ?? 0;
    const totalVol = vol1 + vol2;

    res.json({
      data: {
        matchId,
        player1: { volume: vol1, count: count1 },
        player2: { volume: vol2, count: count2 },
        total: totalVol,
        pct1: totalVol > 0 ? Math.round((vol1 / totalVol) * 100) : 50,
        pct2: totalVol > 0 ? Math.round((vol2 / totalVol) * 100) : 50,
      },
    });
  } catch (error) {
    logger.error('GET /bets/match/:matchId error:', error);
    res.status(500).json({ error: 'Failed to fetch bet data' });
  }
});

export default router;
