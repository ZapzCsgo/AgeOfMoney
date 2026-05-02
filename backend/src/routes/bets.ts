import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { placeBet, getUserStats } from '../services/betService';
import { recordLedger } from '../services/ledger';
import { buildBlendedDistribution, type Bo, type ScoreDistribution } from '../services/exactScoreModel';
import { solvePerGameProb } from '../services/oddsEngine';
import { prisma } from '../index';
import { z } from 'zod';
import logger from '../logger';

const router = Router();

const placeBetSchema = z.object({
  matchId: z.string().min(1),
  amount: z.number().int().min(2, 'Minimum bet is 2 coins').max(500, 'Maximum bet is 500 coins'),
  selectedPlayer: z.union([z.literal(1), z.literal(2)]),
  // Optional: the odds the user saw when placing the bet. Server rejects if
  // divergent > 5% from server-recomputed odds, preventing silent "odds moved"
  // payouts.
  expectedOdds: z.number().positive().optional(),
}).strict();

// POST / - Place a bet
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = placeBetSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid bet data', details: parsed.error.flatten() });
      return;
    }

    const { matchId, amount, selectedPlayer, expectedOdds } = parsed.data;
    const userId = req.user!.id;

    const bet = await placeBet(userId, matchId, amount, selectedPlayer, expectedOdds);

    res.status(201).json({ data: bet, message: 'Bet placed successfully' });
  } catch (error) {
    if (error instanceof Error) {
      const err = error as Error & { code?: string; expectedOdds?: number; currentOdds?: number };
      if (err.code === 'ODDS_CHANGED') {
        res.status(409).json({
          error: err.message,
          expectedOdds: err.expectedOdds,
          currentOdds: err.currentOdds,
          code: 'ODDS_CHANGED',
        });
        return;
      }
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
// solvePerGameProb is now exported from oddsEngine.ts (single source of truth).

const EXACT_SCORE_MARGIN = 0.15; // 15% house edge — esport industry standard
// Hard max odds on exact-score bets. Set to 10 so rare scores whose fair
// odds would exceed 10 all clamp to the same ceiling — keeps the overall
// overround tight (target 14–20%) instead of ballooning past 25% on BO5/BO7
// distributions where a few scores have <2% theoretical probability.
const EXACT_SCORE_MAX_ODDS = 10;

type ScoreEntry = { score: string; player: 0|1|2; loserGames: number; odds: number };

/**
 * Build the theoretical (binomial) probability distribution from the match
 * odds alone. This is the BASE RATE — no player history, just the maths.
 */
function theoreticalDistribution(odds1: number, odds2: number, format: string, oddsDraw?: number): ScoreDistribution {
  // ── BO2 special case ─────────────────────────────────────────────────────
  // BO2 has 3 distinct outcomes (2-0, 1-1, 0-2), so the exact score distribution
  // must be derived from the 3-way market odds directly — NOT from odds1/odds2
  // alone. Normalizing only on odds1+odds2 would over-weight "both players win"
  // outcomes and produce cotes incoherent with the main bet market.
  //
  // Implied probabilities sum to (1 + main-bet margin). We just renormalize so
  // they sum to 1, then distributionToEntries will re-apply EXACT_SCORE_MARGIN
  // on top. The result: score-exact cotes ≈ main-bet cotes × (0.85/0.90),
  // i.e. internally coherent, same ordering, slightly tighter for the house.
  if (format === 'BO2' && oddsDraw && oddsDraw > 1) {
    const r1 = 1 / odds1;
    const rD = 1 / oddsDraw;
    const r2 = 1 / odds2;
    const norm = r1 + rD + r2;
    return {
      '2-0': r1 / norm,
      '1-1': rD / norm,
      '0-2': r2 / norm,
    };
  }

  const raw1 = 1/odds1, raw2 = 1/odds2;
  const norm = raw1 + raw2;
  const pMatch1 = raw1 / norm;
  const p = solvePerGameProb(pMatch1, format);
  const q = 1 - p;

  const dist: ScoreDistribution = {};
  if (format === 'BO1') {
    dist['1-0'] = p;
    dist['0-1'] = q;
  } else if (format === 'BO2') {
    // Legacy BO2 fallback when oddsDraw is missing — kept for safety only
    dist['2-0'] = p*p;
    dist['1-1'] = 2*p*q;
    dist['0-2'] = q*q;
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
    const player: 0|1|2 = a === b ? 0 : a > b ? 1 : 2;
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
 * Phase 6 V2 — fix overround explosif.
 *
 * V1 (`distributionToEntries`) cape les odds à MAX=10 après margin, sans
 * rééquilibrer. Problème mesuré (Test 1 stress) : sur un BO7 1.05/15, 4
 * scores sur 8 se retrouvent avec fair odds > 10, sont cappés à 10 → chaque
 * score cappé contribue implied=0.10, alors que leur fair implied était
 * ~0.04. Excess d'implied = book-wide overround 50 % au lieu de 17.6 %.
 * Margin effective sur le camp underdog : 44 %, très hors du cadre 9–15 %
 * du skill odds-engine-aoe4.
 *
 * V2 redistribue l'excès : on identifie les scores qui seraient cappés,
 * on force leur implied à 1/10=0.10, et on SCALE proportionnellement les
 * implied des scores non-cappés pour que la somme totale reste = 1/(1-margin).
 *
 * Résultat : overround stable à ~17.6 % quel que soit le matchup. Les
 * scores extrêmes gardent odds = 10 (UX), les scores normaux gagnent des
 * odds meilleures (car on leur retire l'excès de margin qu'ils payaient
 * silencieusement pour compenser le cap).
 *
 * Gated derrière ODDS_ENGINE_EXACT_V2_ENABLED (default OFF). Quand le flag
 * est à false, distributionToEntries (V1) est utilisée et rien ne bouge.
 */
function distributionToEntriesV2(dist: ScoreDistribution): ScoreEntry[] {
  const keys = Object.keys(dist);
  if (keys.length === 0) return [];

  // 1) Renormaliser les probas à somme = 1 (blend peut dévier légèrement).
  const rawTotal = Object.values(dist).reduce((a, b) => a + b, 0);
  if (rawTotal <= 0) return [];
  const p: Record<string, number> = {};
  for (const k of keys) p[k] = (dist[k] ?? 0) / rawTotal;

  // 2) Appliquer la margin : implied_i = p_i / (1-margin). Target overround
  //    = 1/(1-margin) ≈ 1.1765 pour margin 15 %.
  const targetOverround = 1 / (1 - EXACT_SCORE_MARGIN);
  const implied: Record<string, number> = {};
  for (const k of keys) implied[k] = p[k] / (1 - EXACT_SCORE_MARGIN);

  // 3) Identifier les scores dont fair odds > CAP → leur implied < 1/CAP.
  //    Exemple MAX=10 → seuil implied = 0.10. Ces scores seront cappés à
  //    l'implied CAP (= 0.10), les autres sont "normal".
  const IMPLIED_CAP = 1 / EXACT_SCORE_MAX_ODDS;
  const cappedKeys: string[] = [];
  const normalKeys: string[] = [];
  for (const k of keys) {
    if (implied[k] < IMPLIED_CAP) cappedKeys.push(k);
    else normalKeys.push(k);
  }

  // 4) Calculer le scale à appliquer aux scores normaux pour garder
  //    total_implied = targetOverround après avoir forcé les cappés à 0.10.
  const newImplied: Record<string, number> = {};
  for (const k of cappedKeys) newImplied[k] = IMPLIED_CAP;
  const cappedTotalNew = cappedKeys.length * IMPLIED_CAP;
  const normalTotalOld = normalKeys.reduce((s, k) => s + implied[k], 0);
  const normalTargetTotal = targetOverround - cappedTotalNew;

  if (normalKeys.length === 0 || normalTargetTotal <= 0 || normalTotalOld <= 0) {
    // Cas dégénéré : tous les scores seraient cappés OU le target est négatif
    // (theoretical impossible : cap N*(1/CAP) > 1/(1-margin) dès que N > CAP*(1-margin)
    // = 8.5 pour 15 % margin). Fallback : on utilise l'implied brut sans scale,
    // l'overround peut dépasser la cible mais le moteur ne crash pas.
    for (const k of keys) newImplied[k] = Math.max(IMPLIED_CAP, implied[k]);
  } else {
    const scale = normalTargetTotal / normalTotalOld;
    for (const k of normalKeys) newImplied[k] = implied[k] * scale;
  }

  // 5) Convertir en odds, cap UX à MAX_ODDS en post-traitement.
  //    Le scale step 4 garantit que les normaux restent ≤ MAX_ODDS dans
  //    les cas usuels ; si un edge-case les fait dépasser (scale très
  //    agressif), le min() rattrape et l'overround peut légèrement dévier.
  const entries: ScoreEntry[] = [];
  for (const k of keys) {
    const [a, b] = k.split('-').map(Number);
    const player: 0|1|2 = a === b ? 0 : a > b ? 1 : 2;
    const loserGames = Math.min(a, b);
    const rawOdds = 1 / newImplied[k];
    const finalOdds = Math.min(rawOdds, EXACT_SCORE_MAX_ODDS);
    entries.push({
      score: k,
      player,
      loserGames,
      odds: parseFloat(finalOdds.toFixed(2)),
    });
  }
  return entries;
}

/** Dispatch V1/V2 en fonction du flag. Tous les autres call sites passent ici. */
function emitEntries(dist: ScoreDistribution): ScoreEntry[] {
  if (process.env.ODDS_ENGINE_EXACT_V2_ENABLED === 'true') {
    return distributionToEntriesV2(dist);
  }
  return distributionToEntries(dist);
}

/**
 * Synchronous fallback (theoretical only) — used when we don't have player
 * IDs or when the DB blend fails. Keeps older call sites working.
 */
function exactScoreOdds(odds1: number, odds2: number, format: string, oddsDraw?: number): ScoreEntry[] {
  return emitEntries(theoreticalDistribution(odds1, odds2, format, oddsDraw));
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
  matchTier?: string,
  oddsDraw?: number,
): Promise<ScoreEntry[]> {
  // Phase 6 — retiré du marché : un BO1 exact-score est strictement équivalent
  // au marché winner (avec 7.3 % de margin en plus). On le masque côté API pour
  // supprimer le piège UX. Cf audit/PHASE6_EXACT_SCORE_STRESS_TEST_2026-04-19.md.
  if (format === 'BO1') return [];
  if (format === 'BO2') return exactScoreOdds(odds1, odds2, format, oddsDraw);
  try {
    const theoretical = theoreticalDistribution(odds1, odds2, format, oddsDraw);
    const blended = await buildBlendedDistribution(
      theoretical, matchId, p1Id, p2Id, format as Bo, odds1, odds2, matchTier, oddsDraw,
    );
    return emitEntries(blended);
  } catch (err) {
    logger.warn('[ExactScore] Blend failed, falling back to theoretical:', err);
    return exactScoreOdds(odds1, odds2, format, oddsDraw);
  }
}

// GET /exact-scores/:matchId — Compute exact score odds for a match
router.get('/exact-scores/:matchId', async (req: Request, res: Response): Promise<void> => {
  try {
    const match = await prisma.match.findUnique({
      where: { id: req.params.matchId },
      select: {
        id: true, format: true, odds1: true, odds2: true, oddsDraw: true,
        status: true, betsOpen: true, scheduledAt: true,
        player1Id: true, player2Id: true,
        tournament: { select: { tier: true } },
      },
    });
    if (!match) { res.status(404).json({ error: 'Match not found' }); return; }
    if (match.format === 'BO1') { res.json({ data: [] }); return; }
    const scores = await exactScoreOddsBlended(
      match.id, match.player1Id, match.player2Id, match.odds1, match.odds2, match.format,
      match.tournament?.tier ?? undefined, match.oddsDraw ?? undefined,
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
// The Bet.boNumber column is reused to store `loserGames` for EXACT_SCORE
// bets (see distributePayout in betService.ts which compares it to the
// actual loser games count). Do not repurpose that column without migrating.
const exactBetSchema = z.object({
  matchId: z.string().min(1),
  amount: z.number().int().min(2).max(500),
  score: z.string().min(3),         // e.g. "2-1"
  player: z.union([z.literal(1), z.literal(2)]),
  loserGames: z.number().int().min(0),
  // Optional: the odds the user saw when placing the bet. Rejected if diverges
  // by more than 5% from server-recomputed odds (anti-"silent odds move").
  expectedOdds: z.number().positive().optional(),
}).strict();

router.post('/exact', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = exactBetSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'Invalid bet data' }); return; }
    const { matchId, amount, score, player, loserGames, expectedOdds } = parsed.data;
    const userId = req.user!.id;

    const [match, user] = await Promise.all([
      prisma.match.findUnique({
        where: { id: matchId },
        select: {
          status: true, betsOpen: true, scheduledAt: true,
          odds1: true, odds2: true, oddsDraw: true, format: true,
          player1Id: true, player2Id: true,
          tournament: { select: { tier: true } },
        },
      }),
      prisma.user.findUnique({ where: { id: userId }, select: { coins: true, isBanned: true } }),
    ]);
    if (!match) { res.status(404).json({ error: 'Match not found' }); return; }
    if (!user || user.isBanned) { res.status(400).json({ error: 'Account banned' }); return; }
    if (match.format === 'BO1') { res.status(400).json({ error: 'Exact-score market is not offered on BO1 matches' }); return; }
    if (match.status !== 'UPCOMING') { res.status(400).json({ error: 'Betting is closed' }); return; }
    if (!match.betsOpen) { res.status(400).json({ error: 'Bets temporarily closed' }); return; }
    if (new Date() >= match.scheduledAt) { res.status(400).json({ error: 'Match has started' }); return; }
    if (Number(user.coins.toString()) < amount) { res.status(400).json({ error: 'Insufficient coins' }); return; }

    // Verify odds are still valid (recompute server-side with blended model)
    const freshScores = await exactScoreOddsBlended(
      matchId, match.player1Id, match.player2Id, match.odds1, match.odds2, match.format,
      match.tournament?.tier ?? undefined, match.oddsDraw ?? undefined,
    );
    const freshEntry = freshScores.find(s => s.score === score);
    if (!freshEntry) { res.status(400).json({ error: 'Invalid score for this match format' }); return; }
    const oddsAtBet = freshEntry.odds; // always use server-computed odds

    // Odds-move guard: if the user passed expectedOdds and server recomputed
    // a value > 5% different, reject so they can re-confirm with fresh odds.
    if (expectedOdds !== undefined) {
      const divergence = Math.abs(oddsAtBet - expectedOdds) / expectedOdds;
      if (divergence > 0.05) {
        res.status(409).json({
          error: 'Odds have changed',
          expectedOdds,
          currentOdds: oddsAtBet,
          message: 'Please confirm the new odds before placing the bet',
        });
        return;
      }
    }

    // Atomic decrement: updateMany with a coins>=amount guard makes the
    // balance check + decrement a single SQL statement, killing the race
    // condition where two concurrent bets both read 100 and decrement 60.
    const bet = await prisma.$transaction(async (tx) => {
      const updateResult = await tx.user.updateMany({
        where: { id: userId, coins: { gte: amount } },
        data: { coins: { decrement: amount }, totalWagered: { increment: amount } },
      });
      if (updateResult.count === 0) throw new Error('Insufficient coins');
      const created = await tx.bet.create({
        data: { userId, matchId, betType: 'EXACT_SCORE', amount, oddsAtBet, selectedPlayer: player, boNumber: loserGames, status: 'PENDING' },
      });
      await recordLedger(tx, { userId, type: 'bet_placed', coins: -amount });
      return created;
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

    // _sum.amount is now Decimal | null — coerce to number for the public
    // volume payload. Frontend doesn't need sub-coin precision on display
    // totals.
    const vol1 = Number(betAgg.find((b) => b.selectedPlayer === 1)?._sum?.amount?.toString() ?? '0');
    const vol2 = Number(betAgg.find((b) => b.selectedPlayer === 2)?._sum?.amount?.toString() ?? '0');
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
