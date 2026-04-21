/**
 * Event Opportunities service — 8 rule-based detectors that scan the
 * platform's state every 6 h and surface marketing / engagement
 * suggestions to the owner on /admin/events.
 *
 * Dedup is composite on (ruleType, subjectKey). A fresh detection within
 * 7 days of an existing NEW/SEEN entry with the same key is skipped so
 * the panel doesn't spam the operator with duplicates. DISMISSED entries
 * with `dismissedUntil > now` also block re-creation.
 *
 * Subject key format per rule :
 *   - user:${userId}             — rules 2 (deposits_not_activated), 3 (vip_inactive), 8 (big_winner)
 *   - affiliate:${codeId}        — rule 5 (affiliate_surge)
 *   - tournament:${tournamentId} — rule 4 (s_tier_incoming)
 *   - ""  (empty, singleton)     — rules 1 (dau_drop), 6 (low_jackpot), 7 (volume_record)
 *
 * All detectors are pure reads — the orchestrator handles persistence.
 * This keeps each rule small, testable and easy to debug.
 */

import { prisma } from '../index';
import logger from '../logger';
import { countActiveUsers } from './adminFinanceService';

// Matches the CLAUDE.md withdrawal rate : 1.69 ⚜ → $0.99
const COIN_TO_EUR = 0.99 / 1.69; // ≈ 0.5858
const DAY_MS = 86_400_000;

export type RulePriority = 'LOW' | 'MEDIUM' | 'HIGH';
export type RuleType =
  | 'DAU_DROP'
  | 'DEPOSITS_NOT_ACTIVATED'
  | 'VIP_INACTIVE'
  | 'S_TIER_INCOMING'
  | 'AFFILIATE_SURGE'
  | 'LOW_JACKPOT'
  | 'VOLUME_RECORD'
  | 'BIG_WINNER';

export interface DetectedSuggestion {
  ruleType: RuleType;
  subjectKey: string; // "" for singleton rules
  priority: RulePriority;
  title: string;
  contextData: Record<string, unknown>;
  suggestedAction: string;
  estimatedBudget?: string;
  estimatedImpact?: string;
}

// ─── Rule 1 — DAU_DROP ──────────────────────────────────────────────────────
// Current-day DAU < 30-day avg × 0.70 → engagement at risk.
// HIGH if 3 consecutive days below threshold, MEDIUM on day 1-2.
export async function detectDauDrop(): Promise<DetectedSuggestion | null> {
  const now = new Date();
  // Build 31 daily windows (today + previous 30) in parallel. countActiveUsers
  // uses $queryRaw UNION — fast enough for 31 calls in parallel on our size.
  const dailyPromises: Promise<number>[] = [];
  for (let i = 0; i < 31; i++) {
    const end = new Date(now.getTime() - i * DAY_MS);
    const start = new Date(end.getTime() - DAY_MS);
    dailyPromises.push(countActiveUsers(start, end));
  }
  const daily = await Promise.all(dailyPromises); // [today, yesterday, ... 30d ago]
  const today = daily[0];
  const past30 = daily.slice(1); // 30 days before today
  const avg30 = past30.reduce((s, x) => s + x, 0) / Math.max(1, past30.length);

  const threshold = avg30 * 0.70;
  // Count how many of the last 3 days (incl. today) are below threshold
  const lastThree = daily.slice(0, 3);
  const consecutiveBelow = lastThree.every((d) => d < threshold);

  // Noise guard : skip if the avg itself is too small to be meaningful
  // (site just launched, DAU is 1 and "below 0.7 × avg" is meaningless)
  if (avg30 < 5) return null;
  if (today >= threshold) return null;

  const dropPct = avg30 > 0 ? Math.round(((today - avg30) / avg30) * 100) : 0;

  return {
    ruleType: 'DAU_DROP',
    subjectKey: '',
    priority: consecutiveBelow ? 'HIGH' : 'MEDIUM',
    title: consecutiveBelow
      ? 'DAU en berne depuis 3 jours'
      : 'DAU sous le seuil aujourd\'hui',
    contextData: {
      todayDau: today,
      avg30dDau: Math.round(avg30 * 10) / 10,
      thresholdDau: Math.round(threshold * 10) / 10,
      dropPct,
      last3Days: lastThree,
    },
    suggestedAction: consecutiveBelow
      ? 'Bonus de dépôt 50 % × 72 h pour réengager la base.'
      : 'Surveiller demain — si le DAU reste bas, déclencher un bonus d\'engagement.',
    estimatedBudget: '~10-15 % des deposits moyens sur la période',
    estimatedImpact: '+20-40 % DAU sur la fenêtre bonus',
  };
}

// ─── Rule 2 — DEPOSITS_NOT_ACTIVATED ────────────────────────────────────────
// Users who deposited in last 7 d but placed 0 bet (any product).
// Trigger: ≥ 10 such users across the platform.
// This rule is SINGLETON — one card summarizing the cohort, not one per user,
// because the action is a single campaign (email "first bet free").
export async function detectDepositsNotActivated(): Promise<DetectedSuggestion | null> {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS);

  // Users with ≥ 1 completed deposit in 7d AND 0 activity across all products
  const rows = await prisma.$queryRaw<Array<{ user_id: string; deposits_cents: bigint }>>`
    SELECT
      t."userId" AS user_id,
      SUM(t."realAmount")::bigint AS deposits_cents
    FROM "Transaction" t
    WHERE t.type = 'deposit' AND t.status = 'completed'
      AND t."createdAt" >= ${sevenDaysAgo}
      AND NOT EXISTS (SELECT 1 FROM "Bet"         WHERE "userId"    = t."userId" AND "createdAt" >= ${sevenDaysAgo})
      AND NOT EXISTS (SELECT 1 FROM "CoinFlip"    WHERE ("creatorId" = t."userId" OR "joinerId" = t."userId") AND "createdAt" >= ${sevenDaysAgo})
      AND NOT EXISTS (SELECT 1 FROM "RouletteBet" WHERE "userId"    = t."userId" AND "createdAt" >= ${sevenDaysAgo})
      AND NOT EXISTS (SELECT 1 FROM "JackpotBet"  WHERE "userId"    = t."userId" AND "createdAt" >= ${sevenDaysAgo})
    GROUP BY t."userId";
  `;

  if (rows.length < 10) return null;

  const totalEur = rows.reduce((s, r) => s + Number(r.deposits_cents), 0) / 100;

  return {
    ruleType: 'DEPOSITS_NOT_ACTIVATED',
    subjectKey: '',
    priority: 'MEDIUM',
    title: `${rows.length} users déposés sans activation`,
    contextData: {
      inactiveUsersCount: rows.length,
      totalDepositsEur: Math.round(totalEur),
      windowDays: 7,
    },
    suggestedAction: 'Email "first bet free" + coaching léger. Sponsoriser la 1ʳᵉ mise (1-2 ⚜ offerts) pour débloquer la dopamine initiale.',
    estimatedBudget: '0 € direct · quelques coins sponsorisés',
    estimatedImpact: 'activation jusqu\'à 30 % des deposits dormants',
  };
}

// ─── Rule 3 — VIP_INACTIVE ──────────────────────────────────────────────────
// Users with > 500 € deposits lifetime + inactive ≥ 14 days.
// Emits one suggestion per VIP (subjectKey = user:${id}).
export async function detectVipInactive(): Promise<DetectedSuggestion[]> {
  const now = new Date();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * DAY_MS);

  const rows = await prisma.$queryRaw<Array<{ user_id: string; username: string; lifetime_cents: bigint; last_active: Date | null }>>`
    WITH vip AS (
      SELECT
        t."userId" AS user_id,
        SUM(t."realAmount")::bigint AS lifetime_cents
      FROM "Transaction" t
      WHERE t.type = 'deposit' AND t.status = 'completed'
      GROUP BY t."userId"
      HAVING SUM(t."realAmount") > 50000
    ),
    activity AS (
      SELECT "userId" AS uid, MAX("createdAt") AS last_active FROM "Bet" GROUP BY "userId"
      UNION ALL
      SELECT "creatorId", MAX("createdAt") FROM "CoinFlip" GROUP BY "creatorId"
      UNION ALL
      SELECT "joinerId", MAX("createdAt") FROM "CoinFlip" WHERE "joinerId" IS NOT NULL GROUP BY "joinerId"
      UNION ALL
      SELECT "userId", MAX("createdAt") FROM "RouletteBet" GROUP BY "userId"
      UNION ALL
      SELECT "userId", MAX("createdAt") FROM "JackpotBet" GROUP BY "userId"
      UNION ALL
      SELECT "userId", MAX("createdAt") FROM "Transaction" GROUP BY "userId"
    ),
    latest AS (
      SELECT uid, MAX(last_active) AS last_active FROM activity GROUP BY uid
    )
    SELECT
      v.user_id,
      u."username" AS username,
      v.lifetime_cents,
      l.last_active
    FROM vip v
    JOIN "User" u ON u.id = v.user_id
    LEFT JOIN latest l ON l.uid = v.user_id
    WHERE (l.last_active IS NULL OR l.last_active < ${fourteenDaysAgo})
    ORDER BY v.lifetime_cents DESC
    LIMIT 20;
  `;

  return rows.map((r) => {
    const lifetimeEur = Number(r.lifetime_cents) / 100;
    const daysInactive = r.last_active ? Math.round((now.getTime() - new Date(r.last_active).getTime()) / DAY_MS) : 999;
    return {
      ruleType: 'VIP_INACTIVE' as RuleType,
      subjectKey: `user:${r.user_id}`,
      priority: 'HIGH' as RulePriority,
      title: `VIP inactif — ${r.username}`,
      contextData: {
        userId: r.user_id,
        username: r.username,
        lifetimeDepositsEur: Math.round(lifetimeEur),
        daysInactive,
        lastActiveAt: r.last_active?.toISOString() ?? null,
      },
      suggestedAction: `Offre personnalisée de comeback (DM Steam ou email). Bonus ciblé, tier VIP.`,
      estimatedBudget: lifetimeEur >= 1000 ? '50-150 €' : '20-50 €',
      estimatedImpact: 'réactivation d\'un VIP à forte valeur',
    };
  });
}

// ─── Rule 4 — S_TIER_INCOMING ───────────────────────────────────────────────
// Tournament with ≥ 3 upcoming S/A-tier matches within next 7 d AND ≥ 1
// "top player" involved. Top player = ≥ 2 PlayerMatchRecord (tier S/A/
// Qualifier, matchDate NOT NULL, matchDate >= now - 90 d).
export async function detectBigTournament(): Promise<DetectedSuggestion[]> {
  const now = new Date();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * DAY_MS);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * DAY_MS);

  // Find upcoming matches in S/A tournaments with at least 1 top player
  const matches = await prisma.match.findMany({
    where: {
      status: { in: ['UPCOMING', 'LIVE'] },
      scheduledAt: { gte: now, lte: sevenDaysFromNow },
      tournament: { tier: { in: ['S', 'A'] } },
    },
    select: {
      id: true,
      scheduledAt: true,
      player1Id: true,
      player2Id: true,
      tournament: { select: { id: true, name: true, tier: true, startDate: true } },
      player1: { select: { id: true, name: true } },
      player2: { select: { id: true, name: true } },
    },
    orderBy: { scheduledAt: 'asc' },
  });

  if (matches.length === 0) return [];

  // Collect player IDs to check top-player status in one query
  const playerIds = new Set<string>();
  for (const m of matches) {
    playerIds.add(m.player1Id);
    playerIds.add(m.player2Id);
  }

  const topPlayerRows = await prisma.$queryRaw<Array<{ player_id: string; cnt: bigint }>>`
    SELECT "playerId" AS player_id, COUNT(*)::bigint AS cnt
    FROM "PlayerMatchRecord"
    WHERE "playerId" IN (${prisma.$queryRaw`(${prisma})`}) -- placeholder, replaced below
    LIMIT 0;
  `.catch(() => []);

  // The $queryRaw above doesn't support IN with spread cleanly ; use findMany instead
  // Safer alternative : groupBy with a where IN clause
  const prRows = await prisma.playerMatchRecord.groupBy({
    by: ['playerId'],
    where: {
      playerId: { in: Array.from(playerIds) },
      tier: { in: ['S', 'A', 'Qualifier'] },
      matchDate: { not: null, gte: ninetyDaysAgo },
    },
    _count: { _all: true },
    having: { playerId: { _count: { gte: 2 } } },
  });
  void topPlayerRows; // unused, kept for debug history
  const topPlayerIds = new Set(prRows.map((r) => r.playerId));

  // Group matches by tournament, track which have ≥ 1 top player
  interface TournamentGroup {
    id: string;
    name: string;
    tier: string;
    matches: typeof matches;
    topPlayerCount: number;
    earliestMatch: Date;
  }
  const byTournament = new Map<string, TournamentGroup>();
  for (const m of matches) {
    if (!m.tournament) continue;
    const hasTop = topPlayerIds.has(m.player1Id) || topPlayerIds.has(m.player2Id);
    const g = byTournament.get(m.tournament.id) ?? {
      id: m.tournament.id,
      name: m.tournament.name,
      tier: m.tournament.tier,
      matches: [] as typeof matches,
      topPlayerCount: 0,
      earliestMatch: m.scheduledAt,
    };
    g.matches.push(m);
    if (hasTop) g.topPlayerCount += 1;
    if (m.scheduledAt < g.earliestMatch) g.earliestMatch = m.scheduledAt;
    byTournament.set(m.tournament.id, g);
  }

  const suggestions: DetectedSuggestion[] = [];
  for (const g of byTournament.values()) {
    if (g.matches.length < 3 || g.topPlayerCount < 1) continue;

    const hoursUntilStart = (g.earliestMatch.getTime() - now.getTime()) / 3_600_000;
    const priority: RulePriority = hoursUntilStart <= 72 ? 'HIGH' : 'MEDIUM';

    // Sample top-player names for the card
    const topNames: string[] = [];
    for (const m of g.matches) {
      if (topPlayerIds.has(m.player1Id) && m.player1?.name && !topNames.includes(m.player1.name)) topNames.push(m.player1.name);
      if (topPlayerIds.has(m.player2Id) && m.player2?.name && !topNames.includes(m.player2.name)) topNames.push(m.player2.name);
    }

    suggestions.push({
      ruleType: 'S_TIER_INCOMING',
      subjectKey: `tournament:${g.id}`,
      priority,
      title: `${g.tier}-tier incoming — ${g.name}`,
      contextData: {
        tournamentId: g.id,
        tournamentName: g.name,
        tier: g.tier,
        matchCount: g.matches.length,
        topPlayerCount: g.topPlayerCount,
        topPlayers: topNames.slice(0, 5),
        hoursUntilStart: Math.round(hoursUntilStart),
      },
      suggestedAction: `Bonus spécial « pari le tournoi » + shoutout streamer partenaire. ${topNames.slice(0, 2).join(' + ')} confirmés.`,
      estimatedBudget: '100-300 € bonus pool',
      estimatedImpact: 'pic de volume sur la fenêtre tournoi',
    });
  }
  return suggestions;
}

// ─── Rule 5 — AFFILIATE_SURGE ───────────────────────────────────────────────
// Affiliate code ≥ 14 days old + recent7d signups ≥ 5 AND
// (previous7d === 0 OR recent7d ≥ 3 × previous7d).
export async function detectAffiliateSurge(): Promise<DetectedSuggestion[]> {
  const now = new Date();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * DAY_MS);
  const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS);

  // AffiliateCode has no Prisma `user` relation (only userId), so we fetch
  // the 2 datasets separately and join in memory.
  const codes = await prisma.affiliateCode.findMany({
    where: { createdAt: { lte: fourteenDaysAgo } },
    include: {
      referrals: {
        where: { joinedAt: { gte: fourteenDaysAgo } },
        select: { joinedAt: true },
      },
    },
  });

  const userIds = codes.map((c) => c.userId);
  const users = userIds.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, username: true },
      })
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  const suggestions: DetectedSuggestion[] = [];
  for (const code of codes) {
    const recent7d = code.referrals.filter((r) => r.joinedAt >= sevenDaysAgo).length;
    const previous7d = code.referrals.filter((r) => r.joinedAt >= fourteenDaysAgo && r.joinedAt < sevenDaysAgo).length;

    if (recent7d < 5) continue;

    // Explicit branch for previous7d === 0 to avoid confusing arithmetic
    let triggers = false;
    if (previous7d === 0) {
      triggers = true; // first burst, no baseline
    } else if (recent7d >= 3 * previous7d) {
      triggers = true;
    }
    if (!triggers) continue;

    const owner = userById.get(code.userId);
    suggestions.push({
      ruleType: 'AFFILIATE_SURGE',
      subjectKey: `affiliate:${code.id}`,
      priority: 'HIGH',
      title: `Affiliate en fusion — ${owner?.username ?? code.code}`,
      contextData: {
        affiliateCodeId: code.id,
        username: owner?.username ?? null,
        promoCode: code.code,
        recent7dSignups: recent7d,
        previous7dSignups: previous7d,
        multiplier: previous7d === 0 ? null : Math.round((recent7d / previous7d) * 10) / 10,
      },
      suggestedAction: 'Tournoi dédié à sa communauté + bump temporaire à 40 % rev share pour solidifier le canal.',
      estimatedBudget: '150-300 € (tournoi + bump commission temporaire)',
      estimatedImpact: 'consolidation d\'un canal d\'acquisition qui démarre',
    });
  }
  return suggestions;
}

// ─── Rule 6 — LOW_JACKPOT ───────────────────────────────────────────────────
// < 5 jackpot rounds/day on 3 consecutive days.
export async function detectLowJackpot(): Promise<DetectedSuggestion | null> {
  const now = new Date();
  const counts: number[] = [];
  for (let i = 0; i < 3; i++) {
    const end = new Date(now.getTime() - i * DAY_MS);
    const start = new Date(end.getTime() - DAY_MS);
    const n = await prisma.jackpotRound.count({
      where: { status: 'COMPLETED', settledAt: { gte: start, lt: end } },
    });
    counts.push(n);
  }
  const allBelow = counts.every((c) => c < 5);
  if (!allBelow) return null;

  const avg = counts.reduce((s, x) => s + x, 0) / counts.length;
  return {
    ruleType: 'LOW_JACKPOT',
    subjectKey: '',
    priority: 'MEDIUM',
    title: 'Jackpot en sommeil',
    contextData: {
      last3DaysRounds: counts,
      avgRoundsPerDay: Math.round(avg * 10) / 10,
      threshold: 5,
    },
    suggestedAction: '« Boosted jackpot hour » : +50 % au pot sponsorisé par la maison pendant 2 h au prime time (21h-23h).',
    estimatedBudget: '~20-50 € par slot boosté',
    estimatedImpact: 'relance de l\'activité jackpot, réamorçage social',
  };
}

// ─── Rule 7 — VOLUME_RECORD ─────────────────────────────────────────────────
// Today's stakes > 150 % of the 30-day daily average.
export async function detectVolumeRecord(): Promise<DetectedSuggestion | null> {
  const now = new Date();
  const dayEnd = now;
  const dayStart = new Date(dayEnd.getTime() - DAY_MS);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);

  async function volumeIn(from: Date, to: Date): Promise<number> {
    const [b, c, r, j] = await Promise.all([
      prisma.bet.aggregate({ _sum: { amount: true }, where: { createdAt: { gte: from, lt: to } } }),
      prisma.coinFlip.aggregate({ _sum: { amount: true }, where: { createdAt: { gte: from, lt: to } } }),
      prisma.rouletteBet.aggregate({ _sum: { amount: true }, where: { createdAt: { gte: from, lt: to } } }),
      prisma.jackpotBet.aggregate({ _sum: { amount: true }, where: { createdAt: { gte: from, lt: to } } }),
    ]);
    return (b._sum.amount ?? 0) + (c._sum.amount ?? 0) + (r._sum.amount ?? 0) + (j._sum.amount ?? 0);
  }

  const [today, past30] = await Promise.all([
    volumeIn(dayStart, dayEnd),
    volumeIn(thirtyDaysAgo, dayStart),
  ]);
  const avg30 = past30 / 30;
  if (avg30 < 100) return null; // need a baseline worth comparing
  if (today <= avg30 * 1.5) return null;

  const multiplier = avg30 > 0 ? today / avg30 : 0;
  return {
    ruleType: 'VOLUME_RECORD',
    subjectKey: '',
    priority: 'LOW',
    title: 'Record de volume aujourd\'hui',
    contextData: {
      todayStakes: today,
      avg30dStakes: Math.round(avg30),
      multiplier: Math.round(multiplier * 10) / 10,
    },
    suggestedAction: 'Post Discord + tweet célébrant le milestone. Effet boule de neige via social proof — les users aiment l\'énergie.',
    estimatedBudget: '0 (marketing soft)',
    estimatedImpact: 'signal de traction, amplifie le bouche-à-oreille',
  };
}

// ─── Rule 8 — BIG_WINNER ────────────────────────────────────────────────────
// User net gain > 1 000 € on bets in last 24 h (Bet only — consistent with
// the whale anomaly in adminFinanceService).
export async function detectBigWinner(): Promise<DetectedSuggestion[]> {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - DAY_MS);
  const THRESHOLD_COINS = Math.round(1000 / COIN_TO_EUR); // ≈ 1 707 coins = 1 000 €

  const rows = await prisma.$queryRaw<Array<{ user_id: string; username: string; net_gain: number }>>`
    SELECT
      b."userId"   AS user_id,
      u."username" AS username,
      (SUM(CASE WHEN b.status = 'WON' THEN b.payout - b.amount ELSE 0 END)
       - SUM(CASE WHEN b.status = 'LOST' THEN b.amount ELSE 0 END))::float AS net_gain
    FROM "Bet" b
    JOIN "User" u ON u.id = b."userId"
    WHERE b."createdAt" >= ${dayAgo} AND b.status IN ('WON', 'LOST')
    GROUP BY b."userId", u."username"
    HAVING (SUM(CASE WHEN b.status = 'WON' THEN b.payout - b.amount ELSE 0 END)
          - SUM(CASE WHEN b.status = 'LOST' THEN b.amount ELSE 0 END)) > ${THRESHOLD_COINS}
    ORDER BY net_gain DESC
    LIMIT 10;
  `;

  return rows.map((r) => {
    const gainCoins = Math.round(Number(r.net_gain));
    const gainEur = Math.round(gainCoins * COIN_TO_EUR);
    return {
      ruleType: 'BIG_WINNER' as RuleType,
      subjectKey: `user:${r.user_id}`,
      priority: 'MEDIUM' as RulePriority,
      title: `Big winner — ${r.username}`,
      contextData: {
        userId: r.user_id,
        username: r.username,
        netGainCoins: gainCoins,
        netGainEur: gainEur,
        windowHours: 24,
      },
      suggestedAction: 'Interview / shoutout (avec son accord) — story marketing « big winner of the week ». Contenu organique gratuit.',
      estimatedBudget: '0 €',
      estimatedImpact: 'contenu marketing organique à forte conversion',
    };
  });
}

// ─── Orchestration + persistence ─────────────────────────────────────────────

const DEDUP_WINDOW_DAYS = 7;

export async function detectAll(): Promise<{ created: number; skipped: number; scannedRules: number }> {
  const results = await Promise.allSettled([
    detectDauDrop(),
    detectDepositsNotActivated(),
    detectVipInactive(),
    detectBigTournament(),
    detectAffiliateSurge(),
    detectLowJackpot(),
    detectVolumeRecord(),
    detectBigWinner(),
  ]);

  const all: DetectedSuggestion[] = [];
  for (const r of results) {
    if (r.status === 'rejected') {
      logger.warn('[EventScanner] a rule failed:', r.reason);
      continue;
    }
    if (r.value == null) continue;
    if (Array.isArray(r.value)) all.push(...r.value);
    else all.push(r.value);
  }

  const now = new Date();
  const dedupCutoff = new Date(now.getTime() - DEDUP_WINDOW_DAYS * DAY_MS);

  let created = 0;
  let skipped = 0;
  for (const sug of all) {
    // Dedup : same (ruleType, subjectKey) within 7d AND not dismissed further
    // than now. DISMISSED entries whose window has expired do NOT block a fresh
    // insert — the rule re-surfaces, which is the point of the TTL.
    const existing = await prisma.eventSuggestion.findFirst({
      where: {
        ruleType: sug.ruleType,
        subjectKey: sug.subjectKey,
        OR: [
          { status: { in: ['NEW', 'SEEN', 'ACTED'] }, createdAt: { gte: dedupCutoff } },
          { status: 'DISMISSED', dismissedUntil: { gt: now } },
        ],
      },
      select: { id: true },
    });
    if (existing) { skipped += 1; continue; }

    await prisma.eventSuggestion.create({
      data: {
        ruleType: sug.ruleType,
        subjectKey: sug.subjectKey,
        priority: sug.priority,
        title: sug.title,
        contextData: sug.contextData as never,
        suggestedAction: sug.suggestedAction,
        estimatedBudget: sug.estimatedBudget ?? null,
        estimatedImpact: sug.estimatedImpact ?? null,
      },
    });
    created += 1;
  }

  return { created, skipped, scannedRules: 8 };
}

// ─── Panel-side reads + actions ─────────────────────────────────────────────

export interface ListActiveFilter {
  status?: 'NEW' | 'SEEN' | 'all';
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'all';
  ruleType?: RuleType | 'all';
}

export async function listActive(filter: ListActiveFilter = {}) {
  const now = new Date();
  const where: Record<string, unknown> = {
    status: { in: ['NEW', 'SEEN'] },
    OR: [
      { dismissedUntil: null },
      { dismissedUntil: { lt: now } },
    ],
  };
  if (filter.status && filter.status !== 'all') where.status = filter.status;
  if (filter.priority && filter.priority !== 'all') where.priority = filter.priority;
  if (filter.ruleType && filter.ruleType !== 'all') where.ruleType = filter.ruleType;

  const rows = await prisma.eventSuggestion.findMany({
    where,
    orderBy: [
      // Priority order : HIGH > MEDIUM > LOW — we rely on Postgres ordering
      // of text, which doesn't naturally put them in that order, so we do it
      // in memory after fetch (small list).
      { createdAt: 'desc' },
    ],
    take: 100,
  });

  const priorityOrder: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  rows.sort((a, b) => {
    const p = (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9);
    if (p !== 0) return p;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  return rows;
}

export async function markSeen(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const res = await prisma.eventSuggestion.updateMany({
    where: { id: { in: ids }, status: 'NEW' },
    data: { status: 'SEEN' },
  });
  return res.count;
}

export async function markActed(id: string, note?: string | null): Promise<void> {
  await prisma.eventSuggestion.update({
    where: { id },
    data: { status: 'ACTED', actedAt: new Date(), actedNote: note ?? null },
  });
}

export async function dismiss(id: string, forDays = 7): Promise<void> {
  const until = new Date(Date.now() + forDays * DAY_MS);
  await prisma.eventSuggestion.update({
    where: { id },
    data: { status: 'DISMISSED', dismissedUntil: until },
  });
}

export async function badgeCount(): Promise<number> {
  const now = new Date();
  return prisma.eventSuggestion.count({
    where: {
      status: 'NEW',
      OR: [{ dismissedUntil: null }, { dismissedUntil: { lt: now } }],
    },
  });
}
