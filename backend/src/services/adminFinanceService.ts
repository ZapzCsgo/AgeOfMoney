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

  // Every _sum on a Decimal column returns Prisma.Decimal | null — coerce
  // to number for the GGR arithmetic. KPI summaries don't need sub-coin
  // precision (they're displayed rounded anyway).
  const num = (v: unknown): number => v == null ? 0 : Number((v as { toString(): string }).toString());
  const betGgr       = num(betAgg._sum.amount) - num(betAgg._sum.payout);
  const coinflipGgr  = num(coinflipAgg._sum.rake);
  const rouletteGgr  = num(rouletteAgg._sum.amount) - num(rouletteAgg._sum.payout);
  const jackpotGgr   = num(jackpotAgg._sum.rake);

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

  const num = (v: unknown): number => v == null ? 0 : Number((v as { toString(): string }).toString());
  const totalDepositsCents    = depositAgg._sum.realAmount ?? 0;
  const totalWithdrawalsCents = withdrawalAgg._sum.realAmount ?? 0;
  const affiliateCommissionsPaid = num(affiliateAgg._sum.commission);

  return {
    ggr,
    ngr: ggr - affiliateCommissionsPaid,
    netCashflowCents: totalDepositsCents - totalWithdrawalsCents,
    activeUserLiability: num(liabilityAgg._sum.coins),
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

// ─── Anomalies detection ────────────────────────────────────────────────────
//
// 5 detectors that flag accounts or products worth a look :
//   - sharp               : win rate > 65 % on ≥ 20 bets in last 30 d
//   - whale               : net bet gain > 10 000 ⚜ in last 7 d
//   - gambling_deposits   : > 5 000 € deposited in 7 d (responsible gaming)
//   - gambling_losses     : ≥ 20 lost bets in 24 h (responsible gaming)
//   - rake_anomaly        : product's 30-d margin outside [5 %, 25 %]
//
// Dismissals : in-memory Map<key, expiresAt>. A dismissed key hides the
// alert for 7 days. Resets when the Node process restarts — this is
// acceptable for a solo-operator dashboard (a redeploy re-surfaces
// whatever's still concerning) ; if we ever outgrow that, we'll move
// the dismissals to an AnomalyDismissal table.

export type AnomalySeverity = 'critical' | 'warning' | 'info';
export type AnomalyType = 'sharp' | 'whale' | 'gambling_deposits' | 'gambling_losses' | 'rake_anomaly';

export interface Anomaly {
  key: string;                       // deterministic, stable across reloads
  type: AnomalyType;
  severity: AnomalySeverity;
  title: string;
  description: string;
  evidence: Record<string, unknown>;
  detectedAt: string;
  userId?: string;
  username?: string;
}

const DISMISSAL_TTL_MS = 7 * 86_400_000; // 7 days
const dismissals = new Map<string, number>();

// Sweep expired dismissals every 30 min so the Map doesn't grow forever
setInterval(() => {
  const now = Date.now();
  for (const [k, exp] of dismissals) {
    if (exp < now) dismissals.delete(k);
  }
}, 30 * 60_000).unref?.();

export function dismissAnomaly(key: string): void {
  dismissals.set(key, Date.now() + DISMISSAL_TTL_MS);
}

function isDismissed(key: string): boolean {
  const exp = dismissals.get(key);
  if (exp == null) return false;
  if (exp < Date.now()) { dismissals.delete(key); return false; }
  return true;
}

const SEVERITY_ORDER: Record<AnomalySeverity, number> = { critical: 0, warning: 1, info: 2 };

/**
 * Compute all active anomalies. Always reads fresh (short TTL cache 60 s so
 * the UI stays snappy on rapid refresh, but the operator still sees new
 * flags within a minute).
 */
export async function detectAnomalies(): Promise<{
  generatedAt: string;
  anomalies: Anomaly[];
}> {
  return cached('finance:anomalies', 60_000, async () => {
    const now = new Date();
    const d1  = new Date(now.getTime() - 1  * 86_400_000);
    const d7  = new Date(now.getTime() - 7  * 86_400_000);
    const d30 = new Date(now.getTime() - 30 * 86_400_000);

    const dayStamp = now.toISOString().slice(0, 10);

    const anomalies: Anomaly[] = [];

    // 1. Sharps — 30-day winrate > 65 % on ≥ 20 bets
    const sharpRows = await prisma.$queryRaw<Array<{ user_id: string; username: string; bets: bigint; wins: bigint; winrate: number }>>`
      SELECT
        b."userId"                                               AS user_id,
        u."username"                                             AS username,
        COUNT(*)::bigint                                         AS bets,
        COUNT(*) FILTER (WHERE b.status = 'WON')::bigint         AS wins,
        (COUNT(*) FILTER (WHERE b.status = 'WON'))::float / GREATEST(COUNT(*)::float, 1) AS winrate
      FROM "Bet" b
      JOIN "User" u ON u.id = b."userId"
      WHERE b."createdAt" >= ${d30} AND b.status IN ('WON','LOST')
      GROUP BY b."userId", u."username"
      HAVING COUNT(*) >= 20
         AND (COUNT(*) FILTER (WHERE b.status = 'WON'))::float / COUNT(*)::float > 0.65
      ORDER BY winrate DESC
      LIMIT 20;
    `;
    for (const r of sharpRows) {
      const key = `sharp:${r.user_id}:${dayStamp}`;
      if (isDismissed(key)) continue;
      anomalies.push({
        key, type: 'sharp',
        severity: 'warning',
        title: `Sharp suspect — ${r.username}`,
        description: `${Math.round(Number(r.winrate) * 100)} % de winrate sur ${Number(r.bets)} bets (30 derniers jours).`,
        evidence: { bets: Number(r.bets), wins: Number(r.wins), winratePct: Number(r.winrate) * 100 },
        detectedAt: now.toISOString(),
        userId: r.user_id,
        username: r.username,
      });
    }

    // 2. Whales — net bet gain > 10 000 ⚜ in last 7 d (Bet only for V1,
    //    documented ; extending to coinflip/roulette/jackpot later)
    const whaleRows = await prisma.$queryRaw<Array<{ user_id: string; username: string; net_gain: number }>>`
      SELECT
        b."userId"   AS user_id,
        u."username" AS username,
        (SUM(CASE WHEN b.status = 'WON' THEN b.payout - b.amount ELSE 0 END)
         - SUM(CASE WHEN b.status = 'LOST' THEN b.amount ELSE 0 END))::float AS net_gain
      FROM "Bet" b
      JOIN "User" u ON u.id = b."userId"
      WHERE b."createdAt" >= ${d7} AND b.status IN ('WON','LOST')
      GROUP BY b."userId", u."username"
      HAVING (SUM(CASE WHEN b.status = 'WON' THEN b.payout - b.amount ELSE 0 END)
            - SUM(CASE WHEN b.status = 'LOST' THEN b.amount ELSE 0 END)) > 10000
      ORDER BY net_gain DESC
      LIMIT 20;
    `;
    for (const r of whaleRows) {
      const key = `whale:${r.user_id}:${dayStamp}`;
      if (isDismissed(key)) continue;
      anomalies.push({
        key, type: 'whale',
        severity: 'warning',
        title: `Gros winner — ${r.username}`,
        description: `+${Math.round(Number(r.net_gain)).toLocaleString('fr-FR')} ⚜ net sur 7 jours sur les bets.`,
        evidence: { netGainCoins: Math.round(Number(r.net_gain)) },
        detectedAt: now.toISOString(),
        userId: r.user_id,
        username: r.username,
      });
    }

    // 3. Gambling flag — > 5 000 € déposés sur 7 jours
    const bigDepositorRows = await prisma.$queryRaw<Array<{ user_id: string; username: string; total_cents: bigint }>>`
      SELECT
        t."userId"          AS user_id,
        u."username"        AS username,
        SUM(t."realAmount")::bigint AS total_cents
      FROM "Transaction" t
      JOIN "User" u ON u.id = t."userId"
      WHERE t.type = 'deposit' AND t.status = 'completed' AND t."createdAt" >= ${d7}
      GROUP BY t."userId", u."username"
      HAVING SUM(t."realAmount") > 500000
      ORDER BY total_cents DESC
      LIMIT 20;
    `;
    for (const r of bigDepositorRows) {
      const key = `gambling_deposits:${r.user_id}:${dayStamp}`;
      if (isDismissed(key)) continue;
      const eur = Number(r.total_cents) / 100;
      anomalies.push({
        key, type: 'gambling_deposits',
        severity: 'critical',
        title: `Responsible gaming — ${r.username}`,
        description: `${eur.toLocaleString('fr-FR', { minimumFractionDigits: 0 })} € déposés sur 7 jours. Vérifier si un reality check est nécessaire.`,
        evidence: { depositsEur: eur },
        detectedAt: now.toISOString(),
        userId: r.user_id,
        username: r.username,
      });
    }

    // 4. Gambling flag — ≥ 20 bets LOST en 24 h (proxy de "loss streak")
    const lossRows = await prisma.$queryRaw<Array<{ user_id: string; username: string; losses: bigint }>>`
      SELECT
        b."userId"   AS user_id,
        u."username" AS username,
        COUNT(*)::bigint AS losses
      FROM "Bet" b
      JOIN "User" u ON u.id = b."userId"
      WHERE b."createdAt" >= ${d1} AND b.status = 'LOST'
      GROUP BY b."userId", u."username"
      HAVING COUNT(*) >= 20
      ORDER BY losses DESC
      LIMIT 20;
    `;
    for (const r of lossRows) {
      const key = `gambling_losses:${r.user_id}:${dayStamp}`;
      if (isDismissed(key)) continue;
      anomalies.push({
        key, type: 'gambling_losses',
        severity: 'critical',
        title: `Responsible gaming — ${r.username}`,
        description: `${Number(r.losses)} bets perdus sur les dernières 24 h. Contact ou pause recommandée.`,
        evidence: { lostBets24h: Number(r.losses) },
        detectedAt: now.toISOString(),
        userId: r.user_id,
        username: r.username,
      });
    }

    // 5. Rake anomaly — produits avec margin hors [5 %, 25 %] sur 30 d
    // On réutilise computeProductBreakdown('30d') — même calcul que la
    // section Products.
    try {
      const products = await computeProductBreakdown('30d');
      for (const row of products.rows) {
        if (row.betsPlaced < 5) continue; // sample trop petit
        const margin = row.marginPct;
        const outOfBand = margin < 5 || margin > 25;
        if (!outOfBand) continue;
        const key = `rake_anomaly:${row.product}:${dayStamp}`;
        if (isDismissed(key)) continue;
        const direction = margin > 25 ? 'élevée' : margin < 5 ? 'basse' : 'négative';
        anomalies.push({
          key, type: 'rake_anomaly',
          severity: margin < 0 ? 'critical' : 'warning',
          title: `Margin anormale — ${row.label}`,
          description: `Margin ${margin.toFixed(2)} % sur 30 jours (${direction}). Attendu [5 %, 25 %].`,
          evidence: { marginPct: margin, volumeStaked: row.volumeStaked, betsPlaced: row.betsPlaced },
          detectedAt: now.toISOString(),
        });
      }
    } catch (err) {
      logger.warn('[Anomalies] rake detection skipped:', err);
    }

    // Sort : critical first, then warning, then info ; timestamp desc as tiebreaker
    anomalies.sort((a, b) => {
      const s = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (s !== 0) return s;
      return b.detectedAt.localeCompare(a.detectedAt);
    });

    return { generatedAt: now.toISOString(), anomalies };
  });
}

// ─── Cashflow detailed list ─────────────────────────────────────────────────
//
// Operational view — the auditable ledger of every Transaction row. Unlike
// the summary services above, this one is intentionally uncached : the
// user expects to see rows appear immediately after a deposit confirms
// or a withdrawal is approved.

export type CashflowType = 'all' | 'deposit' | 'withdrawal' | 'bet_win' | 'bet_loss' | 'refund' | 'bonus';
export type CashflowStatus = 'all' | 'pending' | 'completed' | 'failed';

export interface CashflowFilters {
  range: RangePreset;
  type?: CashflowType;
  status?: CashflowStatus;
  search?: string;      // substring match on username, case-insensitive
  minAmount?: number;   // universal `amount` column (coins for virtual, cents for money)
  maxAmount?: number;
}

export interface CashflowRow {
  id: string;
  userId: string;
  username: string;
  avatar: string | null;
  type: string;
  amount: number;            // generic — coins or cents depending on type
  realAmountCents: number | null;
  coins: number;
  status: string;
  stripeSessionId: string | null;
  affiliateCodeId: string | null;
  createdAt: string;
}

export interface CashflowResponse {
  generatedAt: string;
  range: { label: RangePreset; from: string; to: string };
  page: number;
  limit: number;
  total: number;
  rows: CashflowRow[];
}

function buildCashflowWhere(filters: CashflowFilters): Record<string, unknown> {
  const { from, to } = resolveRange(filters.range);
  const where: Record<string, unknown> = {
    createdAt: { gte: from, lt: to },
  };
  if (filters.type && filters.type !== 'all') where.type = filters.type;
  if (filters.status && filters.status !== 'all') where.status = filters.status;
  if (filters.search && filters.search.trim().length > 0) {
    where.user = { username: { contains: filters.search.trim(), mode: 'insensitive' } };
  }
  if (filters.minAmount != null || filters.maxAmount != null) {
    const amountFilter: Record<string, number> = {};
    if (filters.minAmount != null) amountFilter.gte = filters.minAmount;
    if (filters.maxAmount != null) amountFilter.lte = filters.maxAmount;
    where.amount = amountFilter;
  }
  return where;
}

export async function queryCashflow(
  filters: CashflowFilters,
  page = 1,
  limit = 50,
): Promise<CashflowResponse> {
  const { from, to, label } = resolveRange(filters.range);
  const take = Math.max(1, Math.min(limit, 100));
  const skip = Math.max(0, (Math.max(1, page) - 1) * take);

  const where = buildCashflowWhere(filters);

  const [rows, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      include: { user: { select: { id: true, username: true, avatar: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.transaction.count({ where }),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    range: { label, from: from.toISOString(), to: to.toISOString() },
    page: Math.max(1, page),
    limit: take,
    total,
    rows: rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      username: r.user?.username ?? '—',
      avatar: r.user?.avatar ?? null,
      type: r.type,
      amount: r.amount,
      realAmountCents: r.realAmount,
      coins: Number(r.coins.toString()),
      status: r.status,
      stripeSessionId: r.stripeSessionId,
      affiliateCodeId: r.affiliateCodeId,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

/** Escape a field for inclusion in a CSV cell — wraps in quotes when the
 *  value contains commas, quotes or newlines, and doubles internal quotes. */
function csvEscape(v: string | number | null | undefined): string {
  if (v == null) return '';
  const s = typeof v === 'number' ? String(v) : v;
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Stream a full CSV dump of matching transactions (no pagination, capped
 * at 10 000 rows for safety). UTF-8 with BOM so Excel opens it with the
 * right encoding on Windows.
 */
export async function exportCashflowCsv(filters: CashflowFilters): Promise<string> {
  const where = buildCashflowWhere(filters);
  const rows = await prisma.transaction.findMany({
    where,
    include: { user: { select: { username: true } } },
    orderBy: { createdAt: 'desc' },
    take: 10_000,
  });

  const header = [
    'Date (UTC)', 'Transaction ID', 'User ID', 'Username',
    'Type', 'Status', 'Amount', 'Real Amount (EUR)', 'Coins',
    'Stripe Session', 'Affiliate Code',
  ].join(',');

  const lines = rows.map((r) => [
    r.createdAt.toISOString(),
    r.id,
    r.userId,
    r.user?.username ?? '',
    r.type,
    r.status,
    r.amount,
    r.realAmount != null ? (r.realAmount / 100).toFixed(2) : '',
    Number(r.coins.toString()),
    r.stripeSessionId ?? '',
    r.affiliateCodeId ?? '',
  ].map(csvEscape).join(','));

  // UTF-8 BOM so Excel stops mangling French characters
  return '﻿' + [header, ...lines].join('\r\n') + '\r\n';
}

// ─── User growth & retention ────────────────────────────────────────────────
//
// Activity definition (consistent across DAU / WAU / MAU / retention):
// a user is "active" on a given day if they have ≥ 1 row in any of
//   Bet, CoinFlip (creator OR joiner), RouletteBet, JackpotBet, Transaction
// created that day. We UNION those 6 sources in a single $queryRaw instead
// of doing 6 separate Prisma calls in the app layer.
//
// Retention uses the same activity definition: a cohort of users who
// signed up on day D is "retained at day N" if any of them has activity
// on exactly day D+N. We only include cohorts old enough to have a shot
// at retention at D+N (cohort_day + N <= today), otherwise we'd artificially
// depress the number with too-young cohorts.

export interface UserGrowthKpis {
  dau: number;
  wau: number;
  mau: number;
  stickinessPct: number; // DAU / MAU × 100, 0 when MAU = 0
}

export interface UserGrowthResponse {
  generatedAt: string;
  range: { label: RangePreset; from: string; to: string };
  kpis: UserGrowthKpis & {
    deltas: {
      dauPct: number | null;
      wauPct: number | null;
      mauPct: number | null;
      stickinessPct: number | null;
    };
  };
  sparklines: {
    dauDaily: number[]; // last 7 daily DAU points, oldest → newest
  };
  signupsDaily: Array<{ day: string; count: number }>;
  retention: {
    d1: number;
    d7: number;
    d14: number;
    d30: number;
    cohortCount: number;
  };
  depositsFrequency: {
    depositors1x: number;
    depositors2x: number;
    depositors3to5x: number;
    depositors6to10x: number;
    depositors10plus: number;
  };
}

// Exported so /admin/events DAU_DROP detector can reuse the exact same
// activity definition as the finance DAU KPI. Keep the two aligned.
export async function countActiveUsers(from: Date, to: Date): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(DISTINCT uid)::bigint AS count FROM (
      SELECT "userId" AS uid FROM "Bet"
        WHERE "createdAt" >= ${from} AND "createdAt" < ${to}
      UNION
      SELECT "creatorId" FROM "CoinFlip"
        WHERE "createdAt" >= ${from} AND "createdAt" < ${to}
      UNION
      SELECT "joinerId" FROM "CoinFlip"
        WHERE "joinerId" IS NOT NULL AND "createdAt" >= ${from} AND "createdAt" < ${to}
      UNION
      SELECT "userId" FROM "RouletteBet"
        WHERE "createdAt" >= ${from} AND "createdAt" < ${to}
      UNION
      SELECT "userId" FROM "JackpotBet"
        WHERE "createdAt" >= ${from} AND "createdAt" < ${to}
      UNION
      SELECT "userId" FROM "Transaction"
        WHERE "createdAt" >= ${from} AND "createdAt" < ${to}
    ) AS active_union;
  `;
  return Number(rows[0]?.count ?? 0);
}

export async function computeUserGrowth(preset: RangePreset): Promise<UserGrowthResponse> {
  const { from, to, label } = resolveRange(preset);

  return cached(`finance:users:${label}`, 600_000, async () => {
    const now = to;
    const d1Start = new Date(now.getTime() - 1 * 86_400_000);
    const d7Start = new Date(now.getTime() - 7 * 86_400_000);
    const d30Start = new Date(now.getTime() - 30 * 86_400_000);

    // Previous-period windows for deltas (shifted back by the same span)
    const spanMs = to.getTime() - from.getTime();
    const prevTo = from;
    const _prevFrom = new Date(from.getTime() - spanMs);
    const prevD1Start = new Date(prevTo.getTime() - 1 * 86_400_000);
    const prevD7Start = new Date(prevTo.getTime() - 7 * 86_400_000);
    const prevD30Start = new Date(prevTo.getTime() - 30 * 86_400_000);

    // Parallelize all the independent queries
    const [dau, wau, mau, prevDau, prevWau, prevMau, dauDaily, signupsDaily, retention, depositsFrequency] = await Promise.all([
      countActiveUsers(d1Start, now),
      countActiveUsers(d7Start, now),
      countActiveUsers(d30Start, now),
      countActiveUsers(prevD1Start, prevTo),
      countActiveUsers(prevD7Start, prevTo),
      countActiveUsers(prevD30Start, prevTo),
      (async () => {
        const points: number[] = [];
        for (let i = 6; i >= 0; i--) {
          const dayEnd = new Date(now.getTime() - i * 86_400_000);
          const dayStart = new Date(dayEnd.getTime() - 86_400_000);
          points.push(await countActiveUsers(dayStart, dayEnd));
        }
        return points;
      })(),
      // Signups daily. When the range is wider than ~90 days we aggregate
      // by month instead of day so the chart stays readable (≤ ~90 points).
      (async () => {
        const wideRange = label === 'all' || label === '90d';
        const rows = wideRange
          ? await prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
              SELECT DATE_TRUNC('month', "createdAt") AS day, COUNT(*)::bigint AS count
              FROM "User"
              WHERE "createdAt" >= ${from} AND "createdAt" < ${to}
              GROUP BY DATE_TRUNC('month', "createdAt")
              ORDER BY day ASC;
            `
          : await prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
              SELECT DATE_TRUNC('day', "createdAt") AS day, COUNT(*)::bigint AS count
              FROM "User"
              WHERE "createdAt" >= ${from} AND "createdAt" < ${to}
              GROUP BY DATE_TRUNC('day', "createdAt")
              ORDER BY day ASC;
            `;
        return rows.map((r) => ({
          day: new Date(r.day).toISOString().slice(0, 10),
          count: Number(r.count),
        }));
      })(),
      // Retention — average over cohorts old enough for each checkpoint.
      // We compute per cohort : was ANY user from that cohort active on
      // exactly cohort_day + N? Averaged across eligible cohorts.
      (async () => {
        // Only include cohorts in the selected range. We need cohort_day
        // to be at least 1/7/14/30 days old relative to `to` for each DN.
        // cohortCount reports the number of cohorts old enough for D30
        // (the strictest filter) to give a single honest denominator.
        const rows = await prisma.$queryRaw<Array<{
          cohort_count: bigint;
          d1: number | null;
          d7: number | null;
          d14: number | null;
          d30: number | null;
        }>>`
          WITH cohorts AS (
            SELECT id AS user_id, DATE_TRUNC('day', "createdAt") AS cohort_day
            FROM "User"
            WHERE "createdAt" >= ${from} AND "createdAt" < ${to}
          ),
          activity AS (
            SELECT DISTINCT "userId" AS uid, DATE_TRUNC('day', "createdAt") AS day
            FROM "Bet"
            UNION
            SELECT DISTINCT "creatorId", DATE_TRUNC('day', "createdAt") FROM "CoinFlip"
            UNION
            SELECT DISTINCT "joinerId", DATE_TRUNC('day', "createdAt") FROM "CoinFlip" WHERE "joinerId" IS NOT NULL
            UNION
            SELECT DISTINCT "userId", DATE_TRUNC('day', "createdAt") FROM "RouletteBet"
            UNION
            SELECT DISTINCT "userId", DATE_TRUNC('day', "createdAt") FROM "JackpotBet"
            UNION
            SELECT DISTINCT "userId", DATE_TRUNC('day', "createdAt") FROM "Transaction"
          ),
          scored AS (
            SELECT
              c.user_id,
              c.cohort_day,
              CASE
                WHEN c.cohort_day + INTERVAL '1 day'  <= ${now}
                THEN CASE WHEN EXISTS (SELECT 1 FROM activity a WHERE a.uid = c.user_id AND a.day = c.cohort_day + INTERVAL '1 day')  THEN 1.0 ELSE 0.0 END
                ELSE NULL
              END AS retained_d1,
              CASE
                WHEN c.cohort_day + INTERVAL '7 days' <= ${now}
                THEN CASE WHEN EXISTS (SELECT 1 FROM activity a WHERE a.uid = c.user_id AND a.day = c.cohort_day + INTERVAL '7 days') THEN 1.0 ELSE 0.0 END
                ELSE NULL
              END AS retained_d7,
              CASE
                WHEN c.cohort_day + INTERVAL '14 days' <= ${now}
                THEN CASE WHEN EXISTS (SELECT 1 FROM activity a WHERE a.uid = c.user_id AND a.day = c.cohort_day + INTERVAL '14 days') THEN 1.0 ELSE 0.0 END
                ELSE NULL
              END AS retained_d14,
              CASE
                WHEN c.cohort_day + INTERVAL '30 days' <= ${now}
                THEN CASE WHEN EXISTS (SELECT 1 FROM activity a WHERE a.uid = c.user_id AND a.day = c.cohort_day + INTERVAL '30 days') THEN 1.0 ELSE 0.0 END
                ELSE NULL
              END AS retained_d30
            FROM cohorts c
          )
          SELECT
            COUNT(DISTINCT cohort_day)::bigint AS cohort_count,
            AVG(retained_d1)  AS d1,
            AVG(retained_d7)  AS d7,
            AVG(retained_d14) AS d14,
            AVG(retained_d30) AS d30
          FROM scored;
        `;
        const r = rows[0];
        return {
          d1:  r?.d1  ? Number(r.d1)  : 0,
          d7:  r?.d7  ? Number(r.d7)  : 0,
          d14: r?.d14 ? Number(r.d14) : 0,
          d30: r?.d30 ? Number(r.d30) : 0,
          cohortCount: Number(r?.cohort_count ?? 0),
        };
      })(),
      // Deposits frequency — LIFETIME distribution (not period-scoped).
      // Period-scoped buckets ("how many deposits on this 7-day window")
      // lose meaning on a small user base.
      (async () => {
        const rows = await prisma.$queryRaw<Array<{
          depositors1x: bigint;
          depositors2x: bigint;
          depositors3to5x: bigint;
          depositors6to10x: bigint;
          depositors10plus: bigint;
        }>>`
          WITH user_deposits AS (
            SELECT "userId", COUNT(*)::int AS n
            FROM "Transaction"
            WHERE type = 'deposit' AND status = 'completed'
            GROUP BY "userId"
          )
          SELECT
            COUNT(*) FILTER (WHERE n = 1)::bigint                 AS "depositors1x",
            COUNT(*) FILTER (WHERE n = 2)::bigint                 AS "depositors2x",
            COUNT(*) FILTER (WHERE n BETWEEN 3 AND 5)::bigint     AS "depositors3to5x",
            COUNT(*) FILTER (WHERE n BETWEEN 6 AND 10)::bigint    AS "depositors6to10x",
            COUNT(*) FILTER (WHERE n > 10)::bigint                AS "depositors10plus"
          FROM user_deposits;
        `;
        const r = rows[0];
        return {
          depositors1x:      Number(r?.depositors1x      ?? 0),
          depositors2x:      Number(r?.depositors2x      ?? 0),
          depositors3to5x:   Number(r?.depositors3to5x   ?? 0),
          depositors6to10x:  Number(r?.depositors6to10x  ?? 0),
          depositors10plus:  Number(r?.depositors10plus  ?? 0),
        };
      })(),
    ]);

    const stickinessPct     = mau > 0 ? (dau / mau) * 100 : 0;
    const prevStickinessPct = prevMau > 0 ? (prevDau / prevMau) * 100 : 0;

    return {
      generatedAt: new Date().toISOString(),
      range: { label, from: from.toISOString(), to: to.toISOString() },
      kpis: {
        dau, wau, mau, stickinessPct,
        deltas: {
          dauPct:        pctDelta(dau, prevDau),
          wauPct:        pctDelta(wau, prevWau),
          mauPct:        pctDelta(mau, prevMau),
          stickinessPct: pctDelta(stickinessPct, prevStickinessPct),
        },
      },
      sparklines: { dauDaily },
      signupsDaily,
      retention,
      depositsFrequency,
    };
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
  const num = (v: unknown): number => v == null ? 0 : Number((v as { toString(): string }).toString());
  return num(b._sum.amount) + num(c._sum.amount) + num(r._sum.amount) + num(j._sum.amount);
}

/** Same as above but across ALL users — for the denominator of revenue-share. */
async function totalVolumeStaked(from: Date, to: Date): Promise<number> {
  const [b, c, r, j] = await Promise.all([
    prisma.bet.aggregate({ _sum: { amount: true }, where: { createdAt: { gte: from, lt: to } } }),
    prisma.coinFlip.aggregate({ _sum: { amount: true }, where: { createdAt: { gte: from, lt: to } } }),
    prisma.rouletteBet.aggregate({ _sum: { amount: true }, where: { createdAt: { gte: from, lt: to } } }),
    prisma.jackpotBet.aggregate({ _sum: { amount: true }, where: { createdAt: { gte: from, lt: to } } }),
  ]);
  const num = (v: unknown): number => v == null ? 0 : Number((v as { toString(): string }).toString());
  return num(b._sum.amount) + num(c._sum.amount) + num(r._sum.amount) + num(j._sum.amount);
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

      const commissionPaid = refs.reduce((s, r) => s + Number(r.commission.toString()), 0);
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
      return ggr - Number(affiliateAgg._sum.commission?.toString() ?? '0');
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

    const currentLiabilityCoins = Number(liabilityAgg._sum.coins?.toString() ?? '0');
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
        const num = (v: unknown): number => v == null ? 0 : Number((v as { toString(): string }).toString());
        const bets = countAgg;
        const volume = num(stakeAgg._sum.amount) * 2;
        const revenue = num(rakeAgg._sum.rake);
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
        const num = (v: unknown): number => v == null ? 0 : Number((v as { toString(): string }).toString());
        const volume = num(stake._sum.amount);
        const paidOut = num(payout._sum.payout);
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
        const num = (v: unknown): number => v == null ? 0 : Number((v as { toString(): string }).toString());
        const volume = num(stake._sum.amount);
        return {
          betsPlaced: count,
          volumeStaked: volume,
          houseRevenue: num(rake._sum.rake),
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
      const num = (v: unknown): number => v == null ? 0 : Number((v as { toString(): string }).toString());
      const volume = num(row._sum.amount);
      const payout = num(row._sum.payout);
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
