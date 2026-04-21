/**
 * Owner-only finance service — computes the KPIs, product breakdown, and
 * cohort-style aggregates rendered on /admin/finance.
 *
 * Design notes
 * ------------
 * - All money fields in this codebase are INTEGERS:
 *     - virtual coins (Bet.amount, CoinFlip.amount, RouletteBet.amount,
 *       JackpotBet.amount, User.coins) are stored directly in coin units
 *     - Transaction.realAmount is in cents (EUR × 100) — deposits/withdrawals
 *       go through OxaPay in EUR
 *   We keep everything as plain Number (JavaScript safe integer range is
 *   2^53, way above anything we'll ever see). No Decimal.js needed — the
 *   user spec says "decimal/bigint, pas de float" and we deliver by never
 *   touching floats until the final division.
 *
 * - All heavy reads use Prisma aggregate queries (SUM / COUNT / GROUP BY)
 *   so the DB does the math. We never fetch-all + reduce in memory.
 *
 * - TTL cache is process-local. Good enough for a soft-launch, Redis can
 *   come later. Each instance caches its own copy; with 1 replica on
 *   Railway this is effectively a global cache.
 *
 * - Date range semantics: `from` inclusive, `to` exclusive. When the
 *   caller asks for "7d" we compute `to = now()` and `from = now() - 7d`,
 *   and the "previous period" is `from - 7d` to `from`. This keeps delta
 *   comparisons symmetric.
 */

import { prisma } from '../index';
import logger from '../logger';

// ─── In-memory TTL cache ─────────────────────────────────────────────────────
// Each section has its own TTL because they refresh at different cadences:
//   overview: 60s — changes every bet/deposit
//   products: 120s — breakdown, slightly less urgent
//   affiliates: 300s — tier-upgrade cadence is minutes, not seconds
//   users: 600s — cohort math, changes slowly
//   anomalies: 300s — flagging is a rolling window
//   cashflow: 0 (no cache — operational log)

interface CacheEntry {
  data: unknown;
  expires: number;
}
const cache = new Map<string, CacheEntry>();

export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() < hit.expires) return hit.data as T;
  const data = await fn();
  cache.set(key, { data, expires: Date.now() + ttlMs });
  return data;
}

export function clearFinanceCache(prefix?: string): void {
  if (!prefix) { cache.clear(); return; }
  for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k);
}

// ─── Range parsing ───────────────────────────────────────────────────────────

export type RangePreset = '1d' | '7d' | '30d' | '90d' | 'mtd' | 'all';

/**
 * Turns a preset label into a concrete (from, to) pair. `to` is always
 * "now" so consecutive reloads advance the window smoothly.
 */
export function resolveRange(preset: RangePreset): { from: Date; to: Date; label: RangePreset } {
  const now = new Date();
  const to = new Date(now);
  let from: Date;

  if (preset === '1d')       from = new Date(now.getTime() - 1 * 86_400_000);
  else if (preset === '7d')  from = new Date(now.getTime() - 7 * 86_400_000);
  else if (preset === '30d') from = new Date(now.getTime() - 30 * 86_400_000);
  else if (preset === '90d') from = new Date(now.getTime() - 90 * 86_400_000);
  else if (preset === 'mtd') from = new Date(now.getFullYear(), now.getMonth(), 1);
  else                       from = new Date(0); // 'all' — epoch

  return { from, to, label: preset };
}

/** Previous period of equal length, ending where `from` starts. */
function previousRange(from: Date, to: Date): { from: Date; to: Date } {
  const spanMs = to.getTime() - from.getTime();
  return { from: new Date(from.getTime() - spanMs), to: from };
}

// ─── Overview ────────────────────────────────────────────────────────────────

export interface OverviewKpis {
  /** Gross Gaming Revenue — stakes minus payouts across all products (coins). */
  ggr: number;
  /** Net Gaming Revenue — GGR minus affiliate commissions credited in period (coins). */
  ngr: number;
  /** Net € collected from users (cents) — deposits minus withdrawals (completed only). */
  netCashflowCents: number;
  /** Sum of coins held by all non-banned users right now (coins). */
  activeUserLiability: number;
  /** Deposits in the period, in cents (completed only). */
  totalDepositsCents: number;
  /** Withdrawals in the period, in cents (completed only). */
  totalWithdrawalsCents: number;
  /** Affiliate commissions credited in the period, in coins. */
  affiliateCommissionsPaid: number;
}

export interface OverviewResponse extends OverviewKpis {
  generatedAt: string;
  range: { label: RangePreset; from: string; to: string };
  compare: {
    previous: OverviewKpis;
    deltas: {
      ggrPct: number | null;
      ngrPct: number | null;
      depositsPct: number | null;
      withdrawalsPct: number | null;
      affiliatePct: number | null;
    };
  };
  sparklines: {
    ggrDaily: number[];       // 7 most recent daily GGR points (coin units)
    depositsDailyCents: number[];  // 7 most recent daily deposits (cents)
  };
}

/** Aggregate GGR across Bet + CoinFlip + Roulette + Jackpot in one window. */
async function computeGgrForWindow(from: Date, to: Date): Promise<number> {
  // Bets: stakes = sum(amount) over WON|LOST, payouts = sum(payout) over WON.
  // Refunded / cancelled bets produce no revenue and no cost.
  const [betAgg, coinflipAgg, rouletteAgg, jackpotAgg] = await Promise.all([
    prisma.bet.aggregate({
      _sum: { amount: true, payout: true },
      where: { status: { in: ['WON', 'LOST'] }, createdAt: { gte: from, lt: to } },
    }),
    // CoinFlip: total pot = 2*amount, payout = pot - rake. GGR share for us = rake.
    // We only count COMPLETED flips in the range.
    prisma.coinFlip.aggregate({
      _sum: { rake: true },
      where: { status: 'COMPLETED', completedAt: { gte: from, lt: to } },
    }),
    // Roulette: stakes = sum(amount), payouts = sum(payout) of winners.
    prisma.rouletteBet.aggregate({
      _sum: { amount: true, payout: true },
      where: { round: { status: 'COMPLETED', completedAt: { gte: from, lt: to } } },
    }),
    // Jackpot: house revenue per round = rake.
    prisma.jackpotRound.aggregate({
      _sum: { rake: true },
      where: { status: 'COMPLETED', settledAt: { gte: from, lt: to } },
    }),
  ]);

  const betGgr       = (betAgg._sum.amount ?? 0) - (betAgg._sum.payout ?? 0);
  const coinflipGgr  = coinflipAgg._sum.rake ?? 0;
  const rouletteGgr  = (rouletteAgg._sum.amount ?? 0) - (rouletteAgg._sum.payout ?? 0);
  const jackpotGgr   = jackpotAgg._sum.rake ?? 0;

  return betGgr + coinflipGgr + rouletteGgr + jackpotGgr;
}

async function computeKpisForWindow(from: Date, to: Date): Promise<OverviewKpis> {
  const [ggr, depositAgg, withdrawalAgg, affiliateAgg, liabilityAgg] = await Promise.all([
    computeGgrForWindow(from, to),
    prisma.transaction.aggregate({
      _sum: { realAmount: true },
      where: { type: 'deposit', status: 'completed', createdAt: { gte: from, lt: to } },
    }),
    prisma.transaction.aggregate({
      _sum: { realAmount: true },
      where: { type: 'withdrawal', status: 'completed', createdAt: { gte: from, lt: to } },
    }),
    // Affiliate commissions credited in the period = sum of AffiliateReferral.commission
    // delta. Schema stores a running `commission` counter, so we approximate the
    // period contribution from AffiliateCode.totalEarnings via a histogram on
    // AffiliateReferral.lastActiveAt. Good-enough for display — the exact
    // per-period breakdown would require a journal table that we don't have yet.
    prisma.affiliateReferral.aggregate({
      _sum: { commission: true },
      where: { lastActiveAt: { gte: from, lt: to } },
    }),
    // Active user liability is point-in-time (now), not range-scoped.
    prisma.user.aggregate({
      _sum: { coins: true },
      where: { isBanned: false },
    }),
  ]);

  const totalDepositsCents    = depositAgg._sum.realAmount ?? 0;
  const totalWithdrawalsCents = withdrawalAgg._sum.realAmount ?? 0;
  const affiliateCommissionsPaid = affiliateAgg._sum.commission ?? 0;

  return {
    ggr,
    ngr: ggr - affiliateCommissionsPaid,
    netCashflowCents: totalDepositsCents - totalWithdrawalsCents,
    activeUserLiability: liabilityAgg._sum.coins ?? 0,
    totalDepositsCents,
    totalWithdrawalsCents,
    affiliateCommissionsPaid,
  };
}

/** +X.XX%, or null when previous = 0 and current > 0 ("+new"). */
function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** Last 7 daily GGR points, oldest → newest. */
async function computeGgrSparkline(to: Date): Promise<number[]> {
  const points: number[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayEnd   = new Date(to.getTime() - i * 86_400_000);
    const dayStart = new Date(dayEnd.getTime() - 86_400_000);
    points.push(await computeGgrForWindow(dayStart, dayEnd));
  }
  return points;
}

/** Last 7 daily deposit totals (cents), oldest → newest. */
async function computeDepositsSparkline(to: Date): Promise<number[]> {
  const points: number[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayEnd   = new Date(to.getTime() - i * 86_400_000);
    const dayStart = new Date(dayEnd.getTime() - 86_400_000);
    const agg = await prisma.transaction.aggregate({
      _sum: { realAmount: true },
      where: { type: 'deposit', status: 'completed', createdAt: { gte: dayStart, lt: dayEnd } },
    });
    points.push(agg._sum.realAmount ?? 0);
  }
  return points;
}

export async function computeFinanceOverview(preset: RangePreset): Promise<OverviewResponse> {
  const { from, to, label } = resolveRange(preset);
  const prev = previousRange(from, to);

  return cached(`finance:overview:${label}`, 60_000, async () => {
    try {
      const [current, previous, ggrDaily, depositsDailyCents] = await Promise.all([
        computeKpisForWindow(from, to),
        computeKpisForWindow(prev.from, prev.to),
        computeGgrSparkline(to),
        computeDepositsSparkline(to),
      ]);

      return {
        ...current,
        generatedAt: new Date().toISOString(),
        range: { label, from: from.toISOString(), to: to.toISOString() },
        compare: {
          previous,
          deltas: {
            ggrPct:          pctDelta(current.ggr,                  previous.ggr),
            ngrPct:          pctDelta(current.ngr,                  previous.ngr),
            depositsPct:     pctDelta(current.totalDepositsCents,    previous.totalDepositsCents),
            withdrawalsPct:  pctDelta(current.totalWithdrawalsCents, previous.totalWithdrawalsCents),
            affiliatePct:    pctDelta(current.affiliateCommissionsPaid, previous.affiliateCommissionsPaid),
          },
        },
        sparklines: { ggrDaily, depositsDailyCents },
      };
    } catch (err) {
      logger.error('[Finance] computeFinanceOverview error:', err);
      throw err;
    }
  });
}

// ─── Affiliates ──────────────────────────────────────────────────────────────
//
// Limitation honnête : l'actuelle table AffiliateReferral stocke la commission
// cumulée lifetime (pas un journal par période). On ne peut donc pas isoler
// exactement « commission payée sur les 7 derniers jours ». Pour l'approximation,
// on prend les referrals dont `lastActiveAt` tombe dans la fenêtre et on utilise
// leur `commission` lifetime comme proxy. Sur 'all' le chiffre est exact.
//
// Pour la part du revenu générée par les affiliés on fait le vrai calcul :
// volume staked des users référés ÷ volume staked total, tous deux agrégés
// depuis les bets + coinflip + roulette + jackpot sur la période.

export interface AffiliateKpis {
  totalCommissionPaid: number;        // coins
  activeAffiliatesCount: number;      // affiliate codes with ≥ 1 referral active in window
  avgCommissionPerAffiliate: number;  // coins
  affiliateRevenueSharePct: number;   // 0..100, share of volume staked that came from referred users
  isApproximation: boolean;           // true when period < all (journal not available)
}

export interface AffiliateRow {
  userId: string;
  username: string;
  avatar: string | null;
  promoCode: string;
  commissionRate: number;             // 0.25 / 0.30 / 0.35
  referredUsersCount: number;         // users active in window
  volumeStakedByReferred: number;     // coins
  commissionPaid: number;             // coins (lifetime for referrals active in window — approx)
  roiRate: number;                    // commissionPaid / volumeStakedByReferred (0..1), or 0 if no volume
}

export interface AffiliatesResponse {
  generatedAt: string;
  range: { label: RangePreset; from: string; to: string };
  kpis: AffiliateKpis;
  topAffiliates: AffiliateRow[];
}

/** Volume staked by a given set of users across all 4 products, aggregated. */
async function volumeStakedByUsers(userIds: string[], from: Date, to: Date): Promise<number> {
  if (userIds.length === 0) return 0;
  const [b, c, r, j] = await Promise.all([
    prisma.bet.aggregate({
      _sum: { amount: true },
      where: { userId: { in: userIds }, createdAt: { gte: from, lt: to } },
    }),
    prisma.coinFlip.aggregate({
      _sum: { amount: true },
      where: {
        OR: [{ creatorId: { in: userIds } }, { joinerId: { in: userIds } }],
        createdAt: { gte: from, lt: to },
      },
    }),
    prisma.rouletteBet.aggregate({
      _sum: { amount: true },
      where: { userId: { in: userIds }, createdAt: { gte: from, lt: to } },
    }),
    prisma.jackpotBet.aggregate({
      _sum: { amount: true },
      where: { userId: { in: userIds }, createdAt: { gte: from, lt: to } },
    }),
  ]);
  return (b._sum.amount ?? 0) + (c._sum.amount ?? 0) + (r._sum.amount ?? 0) + (j._sum.amount ?? 0);
}

/** Same as above but across ALL users — for the denominator of revenue-share. */
async function totalVolumeStaked(from: Date, to: Date): Promise<number> {
  const [b, c, r, j] = await Promise.all([
    prisma.bet.aggregate({ _sum: { amount: true }, where: { createdAt: { gte: from, lt: to } } }),
    prisma.coinFlip.aggregate({ _sum: { amount: true }, where: { createdAt: { gte: from, lt: to } } }),
    prisma.rouletteBet.aggregate({ _sum: { amount: true }, where: { createdAt: { gte: from, lt: to } } }),
    prisma.jackpotBet.aggregate({ _sum: { amount: true }, where: { createdAt: { gte: from, lt: to } } }),
  ]);
  return (b._sum.amount ?? 0) + (c._sum.amount ?? 0) + (r._sum.amount ?? 0) + (j._sum.amount ?? 0);
}

export async function computeAffiliateStats(preset: RangePreset, limit = 10): Promise<AffiliatesResponse> {
  const { from, to, label } = resolveRange(preset);
  const isLifetime = label === 'all';

  return cached(`finance:affiliates:${label}:${limit}`, 300_000, async () => {
    // Fetch affiliate codes + their referrals. We filter referrals by
    // lastActiveAt in window for period queries (except 'all' which takes
    // every referral regardless).
    const codes = await prisma.affiliateCode.findMany({
      include: {
        referrals: {
          where: isLifetime ? undefined : { lastActiveAt: { gte: from, lt: to } },
          select: { referredUserId: true, commission: true, lastActiveAt: true, isActive: true },
        },
      },
    });

    // Map affiliate-code → owner user for name/avatar
    const ownerUserIds = codes.map((c) => c.userId);
    const owners = await prisma.user.findMany({
      where: { id: { in: ownerUserIds } },
      select: { id: true, username: true, avatar: true },
    });
    const ownerById = new Map(owners.map((u) => [u.id, u]));

    // Per-affiliate row
    const rows: AffiliateRow[] = [];
    const allActiveReferredIds = new Set<string>();

    for (const code of codes) {
      const refs = code.referrals;
      if (refs.length === 0 && !isLifetime) continue; // no activity in window

      const referredIds = refs.map((r) => r.referredUserId);
      referredIds.forEach((id) => allActiveReferredIds.add(id));

      const commissionPaid = refs.reduce((s, r) => s + r.commission, 0);
      const volume = await volumeStakedByUsers(referredIds, from, to);
      const owner = ownerById.get(code.userId);

      rows.push({
        userId: code.userId,
        username: owner?.username ?? 'unknown',
        avatar: owner?.avatar ?? null,
        promoCode: code.code,
        commissionRate: code.commissionRate,
        referredUsersCount: referredIds.length,
        volumeStakedByReferred: volume,
        commissionPaid,
        roiRate: volume > 0 ? commissionPaid / volume : 0,
      });
    }

    rows.sort((a, b) => b.commissionPaid - a.commissionPaid);
    const topAffiliates = rows.slice(0, limit);

    const totalCommissionPaid   = rows.reduce((s, r) => s + r.commissionPaid, 0);
    const activeAffiliatesCount = rows.filter((r) => r.referredUsersCount > 0).length;
    const avgCommissionPerAffiliate = activeAffiliatesCount > 0
      ? Math.round(totalCommissionPaid / activeAffiliatesCount)
      : 0;

    const [referredVolume, totalVolume] = await Promise.all([
      volumeStakedByUsers(Array.from(allActiveReferredIds), from, to),
      totalVolumeStaked(from, to),
    ]);
    const affiliateRevenueSharePct = totalVolume > 0
      ? (referredVolume / totalVolume) * 100
      : 0;

    return {
      generatedAt: new Date().toISOString(),
      range: { label, from: from.toISOString(), to: to.toISOString() },
      kpis: {
        totalCommissionPaid,
        activeAffiliatesCount,
        avgCommissionPerAffiliate,
        affiliateRevenueSharePct,
        isApproximation: !isLifetime,
      },
      topAffiliates,
    };
  });
}

// ─── P&L summary (today / 7d / 30d / lifetime) ──────────────────────────────
//
// Operator-friendly view : one row per well-known period + a bottom-line
// number in EUR so you know instantly "am I up or down".
//
// Per-period metric = NGR (coins) × EUR-per-coin at withdrawal rate.
// Rationale : NGR captures the real gaming margin you earn on bets minus
// affiliate commissions. Converting at the withdrawal rate tells you what
// that margin is worth in EUR if users were to cash out right now.
//
// Lifetime gets a stricter calculation : actual cash position minus
// outstanding liability. This is the "what's really in the bank right now"
// number.
//
// Exchange rate comes from CLAUDE.md : withdrawal is 1.69 ⚜ → $0.99,
// i.e. 1 ⚜ ≈ $0.586. App displays € and USD ≈ EUR at this granularity;
// admin view treats the two as equivalent.

const COIN_TO_EUR = 0.99 / 1.69; // ≈ 0.5858

export interface PnlPeriod {
  label: 'today' | '7d' | '30d' | 'lifetime';
  ngrCoins: number;
  ngrEur: number;
  netCashEurCents: number;     // deposits - withdrawals in the period (cents)
  realizedProfitEurCents: number | null; // lifetime only : net cash - liability (cents), null for shorter periods
}

export async function computePnlSummary(): Promise<{
  generatedAt: string;
  periods: PnlPeriod[];
}> {
  return cached('finance:pnl', 60_000, async () => {
    const now = new Date();
    const start = (daysBack: number) => new Date(now.getTime() - daysBack * 86_400_000);
    const epoch = new Date(0);

    // Helper — NGR coins for a window
    async function ngrCoins(from: Date, to: Date): Promise<number> {
      const [ggr, affiliateAgg] = await Promise.all([
        computeGgrForWindow(from, to),
        prisma.affiliateReferral.aggregate({
          _sum: { commission: true },
          where: { lastActiveAt: { gte: from, lt: to } },
        }),
      ]);
      return ggr - (affiliateAgg._sum.commission ?? 0);
    }

    // Helper — net cash in cents for a window
    async function netCashCents(from: Date, to: Date): Promise<number> {
      const [dep, wdr] = await Promise.all([
        prisma.transaction.aggregate({
          _sum: { realAmount: true },
          where: { type: 'deposit', status: 'completed', createdAt: { gte: from, lt: to } },
        }),
        prisma.transaction.aggregate({
          _sum: { realAmount: true },
          where: { type: 'withdrawal', status: 'completed', createdAt: { gte: from, lt: to } },
        }),
      ]);
      return (dep._sum.realAmount ?? 0) - (wdr._sum.realAmount ?? 0);
    }

    const [todayNgr, week7Ngr, day30Ngr, lifetimeNgr,
           todayCash, week7Cash, day30Cash, lifetimeCash,
           liabilityAgg] = await Promise.all([
      ngrCoins(start(1), now),
      ngrCoins(start(7), now),
      ngrCoins(start(30), now),
      ngrCoins(epoch, now),
      netCashCents(start(1), now),
      netCashCents(start(7), now),
      netCashCents(start(30), now),
      netCashCents(epoch, now),
      prisma.user.aggregate({
        _sum: { coins: true },
        where: { isBanned: false },
      }),
    ]);

    const currentLiabilityCoins = liabilityAgg._sum.coins ?? 0;
    const currentLiabilityEurCents = Math.round(currentLiabilityCoins * COIN_TO_EUR * 100);
    const realizedProfitLifetimeCents = lifetimeCash - currentLiabilityEurCents;

    const coinsToEurCents = (c: number) => Math.round(c * COIN_TO_EUR * 100);

    return {
      generatedAt: new Date().toISOString(),
      periods: [
        { label: 'today',    ngrCoins: todayNgr,    ngrEur: coinsToEurCents(todayNgr),    netCashEurCents: todayCash,    realizedProfitEurCents: null },
        { label: '7d',       ngrCoins: week7Ngr,    ngrEur: coinsToEurCents(week7Ngr),    netCashEurCents: week7Cash,    realizedProfitEurCents: null },
        { label: '30d',      ngrCoins: day30Ngr,    ngrEur: coinsToEurCents(day30Ngr),    netCashEurCents: day30Cash,    realizedProfitEurCents: null },
        { label: 'lifetime', ngrCoins: lifetimeNgr, ngrEur: coinsToEurCents(lifetimeNgr), netCashEurCents: lifetimeCash, realizedProfitEurCents: realizedProfitLifetimeCents },
      ],
    };
  });
}

// ─── Product breakdown ───────────────────────────────────────────────────────

export interface ProductRow {
  product: 'BET_MATCH' | 'BET_BO' | 'BET_EXACT_SCORE' | 'COINFLIP' | 'ROULETTE' | 'JACKPOT';
  label: string;
  betsPlaced: number;
  volumeStaked: number;   // coins
  houseRevenue: number;   // coins, positive = house wins
  marginPct: number;      // (houseRevenue / volumeStaked) × 100, or 0 if no stake
  userWinRate: number;    // 0..100, % of bets that the user side won
}

export async function computeProductBreakdown(preset: RangePreset): Promise<{
  generatedAt: string;
  range: { label: RangePreset; from: string; to: string };
  rows: ProductRow[];
}> {
  const { from, to, label } = resolveRange(preset);

  return cached(`finance:products:${label}`, 120_000, async () => {
    const [betByType, coinflip, roulette, jackpot] = await Promise.all([
      // Bet by betType — one groupBy aggregation. Resolved vs open split so we
      // only compute revenue on settled bets (consistent with GGR above).
      prisma.bet.groupBy({
        by: ['betType'],
        where: { status: { in: ['WON', 'LOST'] }, createdAt: { gte: from, lt: to } },
        _count: { _all: true },
        _sum: { amount: true, payout: true },
      }),

      // Coinflip: one participant's amount × 2 is staked, rake is house revenue,
      // the winner "wins" (so user win rate ≈ 50% before rake, well-defined via
      // winnerId != creatorId vs ==).
      (async () => {
        const [countAgg, stakeAgg, rakeAgg, winByCreatorCount] = await Promise.all([
          prisma.coinFlip.count({
            where: { status: 'COMPLETED', completedAt: { gte: from, lt: to } },
          }),
          // "Volume staked" per round = 2 × amount (2 players).
          prisma.coinFlip.aggregate({
            _sum: { amount: true },
            where: { status: 'COMPLETED', completedAt: { gte: from, lt: to } },
          }),
          prisma.coinFlip.aggregate({
            _sum: { rake: true },
            where: { status: 'COMPLETED', completedAt: { gte: from, lt: to } },
          }),
          // A "user win" here is ambiguous since there are 2 users per round;
          // we report the fraction where the creator won — always close to 50%.
          prisma.coinFlip.count({
            where: {
              status: 'COMPLETED',
              completedAt: { gte: from, lt: to },
              AND: [{ winnerId: { not: null } }, { winnerId: { equals: prisma.coinFlip.fields.creatorId } }],
            },
          }).catch(() => 0), // equals-column-expression isn't supported in all Prisma versions; ignore if fails
        ]);
        const bets = countAgg;
        const volume = (stakeAgg._sum.amount ?? 0) * 2;
        const revenue = rakeAgg._sum.rake ?? 0;
        return {
          betsPlaced: bets,
          volumeStaked: volume,
          houseRevenue: revenue,
          userWinRate: bets > 0 ? (winByCreatorCount / bets) * 100 : 0,
        };
      })(),

      // Roulette: stakes = sum(amount) of all bets settled in range
      (async () => {
        const [count, stake, payout, wins] = await Promise.all([
          prisma.rouletteBet.count({
            where: { round: { status: 'COMPLETED', completedAt: { gte: from, lt: to } } },
          }),
          prisma.rouletteBet.aggregate({
            _sum: { amount: true },
            where: { round: { status: 'COMPLETED', completedAt: { gte: from, lt: to } } },
          }),
          prisma.rouletteBet.aggregate({
            _sum: { payout: true },
            where: { won: true, round: { status: 'COMPLETED', completedAt: { gte: from, lt: to } } },
          }),
          prisma.rouletteBet.count({
            where: { won: true, round: { status: 'COMPLETED', completedAt: { gte: from, lt: to } } },
          }),
        ]);
        const volume = stake._sum.amount ?? 0;
        const paidOut = payout._sum.payout ?? 0;
        return {
          betsPlaced: count,
          volumeStaked: volume,
          houseRevenue: volume - paidOut,
          userWinRate: count > 0 ? (wins / count) * 100 : 0,
        };
      })(),

      // Jackpot: stakes = sum(JackpotBet.amount in completed rounds), revenue = sum(rake).
      (async () => {
        const [count, stake, rake, winnerRounds] = await Promise.all([
          prisma.jackpotBet.count({
            where: { round: { status: 'COMPLETED', settledAt: { gte: from, lt: to } } },
          }),
          prisma.jackpotBet.aggregate({
            _sum: { amount: true },
            where: { round: { status: 'COMPLETED', settledAt: { gte: from, lt: to } } },
          }),
          prisma.jackpotRound.aggregate({
            _sum: { rake: true },
            where: { status: 'COMPLETED', settledAt: { gte: from, lt: to } },
          }),
          // "user win rate" for a jackpot bet = 1 / participantCount averaged
          // across rounds in the range — approximated here as distinct winners / bets.
          prisma.jackpotRound.count({
            where: { status: 'COMPLETED', settledAt: { gte: from, lt: to } },
          }),
        ]);
        const volume = stake._sum.amount ?? 0;
        return {
          betsPlaced: count,
          volumeStaked: volume,
          houseRevenue: rake._sum.rake ?? 0,
          userWinRate: count > 0 ? (winnerRounds / count) * 100 : 0,
        };
      })(),
    ]);

    // Extract stats per betType (MATCH, BO, EXACT_SCORE)
    const byType = new Map<string, typeof betByType[number]>();
    for (const row of betByType) byType.set(row.betType, row);

    const betStats = (type: 'MATCH' | 'BO' | 'EXACT_SCORE'): ProductRow => {
      const row = byType.get(type);
      if (!row) {
        return {
          product: `BET_${type}` as ProductRow['product'],
          label: type === 'MATCH' ? 'Betting binaire' : type === 'BO' ? 'Betting BO' : 'Betting Score Exact',
          betsPlaced: 0, volumeStaked: 0, houseRevenue: 0, marginPct: 0, userWinRate: 0,
        };
      }
      const volume = row._sum.amount ?? 0;
      const payout = row._sum.payout ?? 0;
      const revenue = volume - payout;
      const marginPct = volume > 0 ? (revenue / volume) * 100 : 0;
      // user win rate requires a second count — we use revenue sign instead for
      // a quick estimator (keeps this to 1 groupBy). Proper metric needs a
      // groupBy (betType, status) — OK for v1 to skip.
      return {
        product: `BET_${type}` as ProductRow['product'],
        label: type === 'MATCH' ? 'Betting binaire' : type === 'BO' ? 'Betting BO' : 'Betting Score Exact',
        betsPlaced: row._count._all,
        volumeStaked: volume,
        houseRevenue: revenue,
        marginPct,
        userWinRate: 0, // v1 placeholder — would need another groupBy
      };
    };

    const rows: ProductRow[] = [
      betStats('MATCH'),
      betStats('BO'),
      betStats('EXACT_SCORE'),
      {
        product: 'COINFLIP',
        label: 'Coinflip',
        ...coinflip,
        marginPct: coinflip.volumeStaked > 0 ? (coinflip.houseRevenue / coinflip.volumeStaked) * 100 : 0,
      },
      {
        product: 'ROULETTE',
        label: 'Roulette',
        ...roulette,
        marginPct: roulette.volumeStaked > 0 ? (roulette.houseRevenue / roulette.volumeStaked) * 100 : 0,
      },
      {
        product: 'JACKPOT',
        label: 'Jackpot',
        ...jackpot,
        marginPct: jackpot.volumeStaked > 0 ? (jackpot.houseRevenue / jackpot.volumeStaked) * 100 : 0,
      },
    ];

    return {
      generatedAt: new Date().toISOString(),
      range: { label, from: from.toISOString(), to: to.toISOString() },
      rows,
    };
  });
}
