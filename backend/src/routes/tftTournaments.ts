/**
 * TFT betting routes — mounted at /api/v1/tft.
 *
 * Three responsibilities :
 *   1. Public reads of TFT tournaments + their participants/odds
 *   2. Authenticated POST /bets/tournament-winner (place an outright bet)
 *   3. Authenticated GET /bets/mine (user's own TFT betting history)
 *
 * Why a separate router (vs. piggy-backing on /tournaments?game=TFT) :
 *   - TFT's "tournament winner" market doesn't map to the AoE Match shape,
 *     so the response payload differs significantly.
 *   - Keeping it under /tft/* makes the route map readable and lets us
 *     add TFT-specific endpoints (live standings, settlement triggers,
 *     odds debug) without polluting the AoE namespace.
 *
 * Auth model :
 *   - Reads are public (game schedules + odds are not sensitive).
 *   - Writes require requireAuth. Balance enforcement happens inside a
 *     Prisma $transaction so concurrent bets can't overdraw.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../index';
import { requireAuth } from '../middleware/auth';
import { recordLedger } from '../services/ledger';
import logger from '../logger';

const router = Router();

// ── Tunables ─────────────────────────────────────────────────────────────
const MIN_STAKE = new Decimal('0.5');
const MAX_STAKE = new Decimal('10000');
// 5-minute cushion before tournament start — bets close to give the live
// scorer time to lock the bracket before odds drift catches us off-guard.
const BET_CUTOFF_BEFORE_START_MS = 5 * 60 * 1000;

// ── Shared response shape ────────────────────────────────────────────────

interface ParticipantPublic {
  id: string;
  playerId: string;
  name: string;
  country: string | null;
  avatarUrl: string | null;
  currentTier: string | null;
  /** Effective odd shown to bettors — manualOdds if set, else odds. */
  odds: number;
  /** Live rank during the tournament (1..N). Null when not yet live. */
  currentRank: number | null;
  finalRank: number | null;
  isWinner: boolean;
}

interface TournamentPublic {
  id: string;
  name: string;
  tier: string;
  game: 'TFT';
  prizePool: string | null;
  startDate: string;
  endDate: string | null;
  liquipediaUrl: string | null;
  competeTftUrl: string | null;
  twitchChannel: string | null;
  bracketStarted: boolean;
  lastLiveSync: string | null;
  liveSyncSource: string | null;
  participants?: ParticipantPublic[];
}

function shapeParticipant(p: {
  id: string;
  playerId: string;
  odds: Decimal;
  manualOdds: Decimal | null;
  currentRank: number | null;
  finalRank: number | null;
  isWinner: boolean;
  player: { name: string; country: string | null; avatarUrl: string | null; tftCurrentTier: string | null };
}): ParticipantPublic {
  const effectiveOdds = p.manualOdds ?? p.odds;
  return {
    id: p.id,
    playerId: p.playerId,
    name: p.player.name,
    country: p.player.country,
    avatarUrl: p.player.avatarUrl,
    currentTier: p.player.tftCurrentTier,
    odds: Number(effectiveOdds.toString()),
    currentRank: p.currentRank,
    finalRank: p.finalRank,
    isWinner: p.isWinner,
  };
}

function shapeTournament(t: {
  id: string;
  name: string;
  tier: string;
  prizePool: string | null;
  startDate: Date;
  endDate: Date | null;
  liquipediaUrl: string | null;
  competeTftUrl: string | null;
  twitchChannel: string | null;
  bracketStarted: boolean;
  lastLiveSync: Date | null;
  liveSyncSource: string | null;
}): TournamentPublic {
  return {
    id: t.id,
    name: t.name,
    tier: t.tier,
    game: 'TFT',
    prizePool: t.prizePool,
    startDate: t.startDate.toISOString(),
    endDate: t.endDate?.toISOString() ?? null,
    liquipediaUrl: t.liquipediaUrl,
    competeTftUrl: t.competeTftUrl,
    twitchChannel: t.twitchChannel,
    bracketStarted: t.bracketStarted,
    lastLiveSync: t.lastLiveSync?.toISOString() ?? null,
    liveSyncSource: t.liveSyncSource,
  };
}

// ── GET /tournaments ─────────────────────────────────────────────────────

const listQuerySchema = z.object({
  status: z.enum(['upcoming', 'live', 'completed', 'all']).default('upcoming'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

router.get('/tournaments', async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() });
      return;
    }
    const { status, limit } = parsed.data;
    const now = new Date();

    // Status → date predicate
    const whereStatus =
      status === 'upcoming' ? { startDate: { gt: now }, bracketStarted: false }
      : status === 'live' ? { bracketStarted: true, OR: [{ endDate: null }, { endDate: { gt: now } }] }
      : status === 'completed' ? { endDate: { lt: now } }
      : {};

    const tournaments = await prisma.tournament.findMany({
      where: { game: 'TFT', isActive: true, ...whereStatus },
      orderBy: { startDate: 'asc' },
      take: limit,
      include: {
        participants: {
          include: {
            player: {
              select: { name: true, country: true, avatarUrl: true, tftCurrentTier: true },
            },
          },
          orderBy: { odds: 'asc' }, // favorites first
          take: 5, // preview only — full list on /tournaments/:id
        },
      },
    });

    const data = tournaments.map((t) => {
      const shaped = shapeTournament(t);
      shaped.participants = t.participants.map(shapeParticipant);
      return shaped;
    });

    res.json({ data });
  } catch (err) {
    logger.error('[TFT] GET /tournaments error:', err);
    res.status(500).json({ error: 'Failed to fetch TFT tournaments' });
  }
});

// ── GET /tournaments/:id ─────────────────────────────────────────────────

router.get('/tournaments/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const tournament = await prisma.tournament.findFirst({
      where: { id: req.params.id, game: 'TFT', isActive: true },
      include: {
        participants: {
          include: {
            player: {
              select: { name: true, country: true, avatarUrl: true, tftCurrentTier: true },
            },
          },
          orderBy: { odds: 'asc' },
        },
      },
    });
    if (!tournament) {
      res.status(404).json({ error: 'Tournament not found' });
      return;
    }
    const data = shapeTournament(tournament);
    data.participants = tournament.participants.map(shapeParticipant);
    res.json({ data });
  } catch (err) {
    logger.error(`[TFT] GET /tournaments/${req.params.id} error:`, err);
    res.status(500).json({ error: 'Failed to fetch tournament' });
  }
});

// ── POST /bets/tournament-winner ─────────────────────────────────────────

const placeBetSchema = z.object({
  tournamentId:  z.string().min(1),
  participantId: z.string().min(1),
  stake:         z.coerce.number().positive(),
  /**
   * Client-side odds snapshot. Server rejects if the live odds have moved
   * by more than 2 % since the client computed the potential payout —
   * protects bettors from late price drops between click and submit.
   */
  expectedOdds:  z.coerce.number().positive().optional(),
});

router.post('/bets/tournament-winner', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = placeBetSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
      return;
    }
    const { tournamentId, participantId, stake: stakeNum, expectedOdds } = parsed.data;
    const userId = req.user!.id;
    const stake = new Decimal(stakeNum.toFixed(8));

    if (stake.lt(MIN_STAKE)) {
      res.status(400).json({ error: `Mise minimale ${MIN_STAKE.toString()} ◈` });
      return;
    }
    if (stake.gt(MAX_STAKE)) {
      res.status(400).json({ error: `Mise maximale ${MAX_STAKE.toString()} ◈` });
      return;
    }

    // ── All-or-nothing transaction ───────────────────────────────────────
    // Same pattern as bets.ts placeBet : SELECT FOR UPDATE on the user row
    // via prisma's serializable isolation, then decrement + insert in one
    // shot so concurrent clicks can't overdraw.
    const result = await prisma.$transaction(async (tx) => {
      const participant = await tx.tournamentParticipant.findUnique({
        where: { id: participantId },
        include: {
          tournament: {
            select: {
              id: true, name: true, game: true,
              startDate: true, bracketStarted: true,
              isActive: true,
            },
          },
        },
      });
      if (!participant || participant.tournament.id !== tournamentId) {
        return { ok: false as const, status: 404, error: 'Participant not found' };
      }
      if (participant.tournament.game !== 'TFT') {
        return { ok: false as const, status: 400, error: 'Not a TFT tournament' };
      }
      if (!participant.tournament.isActive) {
        return { ok: false as const, status: 400, error: 'Tournament closed' };
      }
      if (participant.tournament.bracketStarted) {
        return { ok: false as const, status: 400, error: 'Le bracket a déjà commencé — paris fermés' };
      }
      const cutoff = participant.tournament.startDate.getTime() - BET_CUTOFF_BEFORE_START_MS;
      if (cutoff < Date.now()) {
        return { ok: false as const, status: 400, error: 'Paris fermés (moins de 5 min avant le coup d\'envoi)' };
      }

      const effectiveOdds = participant.manualOdds ?? participant.odds;
      const oddsNum = Number(effectiveOdds.toString());

      if (expectedOdds !== undefined) {
        const drift = Math.abs(oddsNum - expectedOdds) / Math.max(expectedOdds, 0.01);
        if (drift > 0.02) {
          return {
            ok: false as const,
            status: 409,
            error: 'Les odds ont bougé depuis ton clic. Recharge la page.',
            currentOdds: oddsNum,
          };
        }
      }

      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, coins: true, isBanned: true, redeemLockedBalance: true },
      });
      if (!user) return { ok: false as const, status: 401, error: 'User not found' };
      if (user.isBanned) return { ok: false as const, status: 403, error: 'Compte suspendu' };

      // Balance = unlocked coins + locked redeem coins. We allow both to
      // fund the stake — same posture as betService.placeBet for AoE.
      const totalBalance = new Decimal(user.coins.toString()).add(user.redeemLockedBalance.toString());
      if (totalBalance.lt(stake)) {
        return { ok: false as const, status: 402, error: 'Solde insuffisant' };
      }

      // Drain the redeem-locked pot first, then the free balance. Wagering
      // progress also goes up so locked coins eventually unlock.
      const fromLocked = Decimal.min(stake, new Decimal(user.redeemLockedBalance.toString()));
      const fromFree   = stake.sub(fromLocked);

      await tx.user.update({
        where: { id: userId },
        data: {
          coins: { decrement: fromFree },
          redeemLockedBalance: { decrement: fromLocked },
          totalWagered: { increment: stake },
          totalWageringProgress: { increment: stake },
        },
      });

      const bet = await tx.tournamentWinnerBet.create({
        data: {
          userId,
          tournamentId,
          participantId,
          stake,
          oddsAtBet: effectiveOdds,
          status: 'PENDING',
        },
        select: { id: true, stake: true, oddsAtBet: true, placedAt: true },
      });

      await recordLedger(tx, { userId, type: 'tft_bet_placed', coins: stake.neg() });

      return {
        ok: true as const,
        bet,
        potentialPayout: stake.mul(effectiveOdds.toString()),
      };
    });

    if (!result.ok) {
      res.status(result.status).json({
        error: result.error,
        ...(result.status === 409 && 'currentOdds' in result ? { currentOdds: result.currentOdds } : {}),
      });
      return;
    }

    res.json({
      data: {
        id: result.bet.id,
        stake: result.bet.stake.toString(),
        oddsAtBet: result.bet.oddsAtBet.toString(),
        potentialPayout: result.potentialPayout.toString(),
        placedAt: result.bet.placedAt.toISOString(),
      },
    });
  } catch (err) {
    logger.error('[TFT] POST /bets/tournament-winner error:', err);
    res.status(500).json({ error: 'Bet placement failed' });
  }
});

// ── GET /bets/mine ───────────────────────────────────────────────────────

router.get('/bets/mine', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const status = (req.query.status as string | undefined)?.toUpperCase();
    const bets = await prisma.tournamentWinnerBet.findMany({
      where: {
        userId,
        ...(status && ['PENDING', 'WON', 'LOST', 'REFUNDED'].includes(status) ? { status: status as 'PENDING' } : {}),
      },
      orderBy: { placedAt: 'desc' },
      take: 100,
      include: {
        tournament: { select: { id: true, name: true, startDate: true, endDate: true } },
        participant: {
          include: { player: { select: { name: true, avatarUrl: true, country: true } } },
        },
      },
    });

    res.json({
      data: bets.map((b) => ({
        id: b.id,
        tournamentId: b.tournamentId,
        tournamentName: b.tournament.name,
        participantName: b.participant.player.name,
        participantCountry: b.participant.player.country,
        stake: b.stake.toString(),
        oddsAtBet: b.oddsAtBet.toString(),
        potentialPayout: new Decimal(b.stake.toString()).mul(b.oddsAtBet.toString()).toString(),
        status: b.status,
        payout: b.payout?.toString() ?? null,
        placedAt: b.placedAt.toISOString(),
        settledAt: b.settledAt?.toISOString() ?? null,
      })),
    });
  } catch (err) {
    logger.error('[TFT] GET /bets/mine error:', err);
    res.status(500).json({ error: 'Failed to fetch bets' });
  }
});

export default router;
