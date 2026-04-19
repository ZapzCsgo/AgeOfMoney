/**
 * Dev-only routes — only active when NODE_ENV !== 'production'
 * POST /api/v1/dev/seed  → seed database with real AoE4 pro players & upcoming matches
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../index';
import { scrapeAoe4WorldTournaments } from '../scrapers/aoe4worldTournamentScraper';
import logger from '../logger';

const router = Router();

const now = new Date();
const h = (hours: number) => new Date(now.getTime() + hours * 3_600_000);

function oddsFromElo(elo1: number, elo2: number): [number, number] {
  const prob1 = 1 / (1 + Math.pow(10, (elo2 - elo1) / 400));
  const margin = 0.05;
  return [
    parseFloat(Math.max(1.05, (1 / prob1) * (1 - margin)).toFixed(2)),
    parseFloat(Math.max(1.05, (1 / (1 - prob1)) * (1 - margin)).toFixed(2)),
  ];
}

router.post('/seed', async (_req: Request, res: Response): Promise<void> => {
  try {
    // ── Tournaments ────────────────────────────────────────────────────────────
    const [wc, qsl, redBull, rsl] = await Promise.all([
      prisma.tournament.upsert({
        where: { liquipediaUrl: 'https://liquipedia.net/ageofempires4/World_Championship/2025' },
        update: {},
        create: {
          name: 'AoE4 World Championship 2025',
          tier: 'S',
          prizePool: '500000',
          liquipediaUrl: 'https://liquipedia.net/ageofempires4/World_Championship/2025',
          startDate: h(24),
          endDate: h(24 * 7),
          isActive: true,
        },
      }),
      prisma.tournament.upsert({
        where: { liquipediaUrl: 'https://liquipedia.net/ageofempires4/Quarterly_Series/2025/Spring' },
        update: {},
        create: {
          name: 'Quarterly Series Spring 2025',
          tier: 'A',
          prizePool: '75000',
          liquipediaUrl: 'https://liquipedia.net/ageofempires4/Quarterly_Series/2025/Spring',
          startDate: h(2),
          endDate: h(24 * 4),
          isActive: true,
        },
      }),
      prisma.tournament.upsert({
        where: { liquipediaUrl: 'https://liquipedia.net/ageofempires4/Red_Bull_Wololo/7' },
        update: {},
        create: {
          name: 'Red Bull Wololo 7',
          tier: 'S',
          prizePool: '150000',
          liquipediaUrl: 'https://liquipedia.net/ageofempires4/Red_Bull_Wololo/7',
          startDate: h(24 * 2),
          endDate: h(24 * 5),
          isActive: true,
        },
      }),
      prisma.tournament.upsert({
        where: { liquipediaUrl: 'https://liquipedia.net/ageofempires4/RSL/Season_3' },
        update: {},
        create: {
          name: 'Road to S-Tier League S3',
          tier: 'B',
          prizePool: '10000',
          liquipediaUrl: 'https://liquipedia.net/ageofempires4/RSL/Season_3',
          startDate: h(-24),
          endDate: h(24 * 14),
          isActive: true,
        },
      }),
    ]);

    // ── Players (real AoE4 pros with their aoe4world profile IDs) ───────────────
    // aoe4worldId = numeric Steam profile_id from aoe4world.com
    const playerDefs = [
      { name: 'Marinelord',  slug: 'marinelord',   country: 'FR', elo: 2850, aoe4worldId: '3508823'  },
      { name: 'MbL',          slug: 'mbl',           country: 'NO', elo: 2820, aoe4worldId: '1554591'  },
      { name: 'Hera',         slug: 'hera',          country: 'CA', elo: 2790, aoe4worldId: '196240'   },
      { name: 'TheViper',     slug: 'theviper',      country: 'NO', elo: 2780, aoe4worldId: '1696977'  },
      { name: 'TheMax',       slug: 'themax',        country: 'DE', elo: 2760, aoe4worldId: '2328632'  },
      { name: 'DauT',         slug: 'daut',          country: 'RS', elo: 2750, aoe4worldId: '2352898'  },
      { name: 'Nicov',        slug: 'nicov',         country: 'FR', elo: 2730, aoe4worldId: '2260580'  },
      { name: 'JorDan_AoE',  slug: 'jordan-aoe',    country: 'ES', elo: 2710, aoe4worldId: null        },
      { name: 'Liereyy',      slug: 'liereyy',       country: 'AT', elo: 2700, aoe4worldId: '6520863'  },
      { name: 'Survivalist',  slug: 'survivalist',   country: 'US', elo: 2680, aoe4worldId: '2179168'  },
      { name: 'ACCM',         slug: 'accm',          country: 'CN', elo: 2670, aoe4worldId: '4366531'  },
      { name: 'Cloud',        slug: 'cloud',         country: 'CN', elo: 2660, aoe4worldId: null        },
    ];

    const ids: Record<string, string> = {};
    const elos: Record<string, number> = {};

    for (const p of playerDefs) {
      const player = await prisma.player.upsert({
        where: { liquipediaSlug: p.slug },
        update: { elo: p.elo, ...(p.aoe4worldId ? { aoe4worldId: p.aoe4worldId } : {}) },
        create: {
          name: p.name,
          liquipediaSlug: p.slug,
          aoe4worldId: p.aoe4worldId ?? undefined,
          country: p.country,
          elo: p.elo,
        },
      });
      ids[p.name] = player.id;
      elos[p.name] = p.elo;
    }

    // ── Matches ────────────────────────────────────────────────────────────────
    const matchDefs: Array<{
      p1: string; p2: string;
      t: typeof wc;
      status: string;
      scheduledAt: Date;
      format: string;
      betsClosedAt: Date;
      winner?: string;
      score?: string;
    }> = [
      // LIVE
      { p1: 'Marinelord', p2: 'MbL',        t: qsl,     status: 'LIVE',      scheduledAt: h(-0.5),  format: 'BO5', betsClosedAt: h(-1) },
      // UPCOMING next 48h
      { p1: 'Hera',       p2: 'TheViper',    t: wc,      status: 'UPCOMING',  scheduledAt: h(1.5),   format: 'BO3', betsClosedAt: h(1.3) },
      { p1: 'TheMax',     p2: 'DauT',        t: redBull, status: 'UPCOMING',  scheduledAt: h(3),     format: 'BO3', betsClosedAt: h(2.8) },
      { p1: 'Nicov',      p2: 'JorDan_AoE', t: qsl,     status: 'UPCOMING',  scheduledAt: h(5),     format: 'BO3', betsClosedAt: h(4.8) },
      { p1: 'Liereyy',    p2: 'Survivalist', t: rsl,     status: 'UPCOMING',  scheduledAt: h(8),     format: 'BO3', betsClosedAt: h(7.8) },
      { p1: 'ACCM',       p2: 'Cloud',       t: redBull, status: 'UPCOMING',  scheduledAt: h(10),    format: 'BO5', betsClosedAt: h(9.8) },
      { p1: 'Marinelord', p2: 'Hera',        t: wc,      status: 'UPCOMING',  scheduledAt: h(24),    format: 'BO5', betsClosedAt: h(23.8) },
      { p1: 'MbL',        p2: 'TheViper',    t: wc,      status: 'UPCOMING',  scheduledAt: h(26),    format: 'BO5', betsClosedAt: h(25.8) },
      { p1: 'TheMax',     p2: 'Nicov',       t: redBull, status: 'UPCOMING',  scheduledAt: h(30),    format: 'BO3', betsClosedAt: h(29.8) },
      { p1: 'DauT',       p2: 'Liereyy',     t: rsl,     status: 'UPCOMING',  scheduledAt: h(36),    format: 'BO3', betsClosedAt: h(35.8) },
      // COMPLETED — recent
      { p1: 'Survivalist', p2: 'ACCM',       t: qsl,    status: 'COMPLETED', scheduledAt: h(-6),    format: 'BO3', betsClosedAt: h(-7),  winner: 'Survivalist', score: '2-1' },
      { p1: 'Cloud',       p2: 'JorDan_AoE', t: rsl,    status: 'COMPLETED', scheduledAt: h(-12),   format: 'BO3', betsClosedAt: h(-13), winner: 'Cloud',       score: '2-0' },
    ];

    let created = 0;
    for (const m of matchDefs) {
      const p1Id = ids[m.p1];
      const p2Id = ids[m.p2];
      if (!p1Id || !p2Id) continue;

      const existing = await prisma.match.findFirst({
        where: { player1Id: p1Id, player2Id: p2Id, tournamentId: m.t.id },
      });
      if (existing) continue;

      const [odds1, odds2] = oddsFromElo(elos[m.p1], elos[m.p2]);
      const winnerId = m.winner ? ids[m.winner] : undefined;

      await prisma.match.create({
        data: {
          player1Id: p1Id,
          player2Id: p2Id,
          tournamentId: m.t.id,
          status: m.status as 'LIVE' | 'UPCOMING' | 'COMPLETED',
          format: m.format,
          scheduledAt: m.scheduledAt,
          betsClosedAt: m.betsClosedAt,
          odds1,
          odds2,
          ...(winnerId ? { winnerId, resultScore: m.score } : {}),
        },
      });
      created++;
    }

    res.json({
      ok: true,
      message: `Seed complete. Created ${created} matches, ${playerDefs.length} players, 4 tournaments.`,
    });
  } catch (err) {
    logger.error('Seed error:', err);
    res.status(500).json({ error: String(err) });
  }
});

// DELETE /api/v1/dev/clear-all — wipe all matches, players, tournaments (fresh start)
router.delete('/clear-all', async (_req: Request, res: Response): Promise<void> => {
  try {
    const b = await prisma.bet.deleteMany();
    const m = await prisma.match.deleteMany();
    const t = await prisma.tournament.deleteMany();
    const p = await prisma.player.deleteMany();
    res.json({ ok: true, deleted: { bets: b.count, matches: m.count, tournaments: t.count, players: p.count } });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/v1/dev/scrape — trigger aoe4world tournament scraper immediately
router.post('/scrape', async (_req: Request, res: Response): Promise<void> => {
  res.json({ ok: true, message: 'aoe4world tournament scrape started in background' });
  try {
    await scrapeAoe4WorldTournaments();
  } catch (err) {
    logger.error('Scrape error:', err);
  }
});

// POST /api/v1/dev/scrape-liquipedia — trigger Liquipedia upcoming matches scraper
router.post('/scrape-liquipedia', async (_req: Request, res: Response): Promise<void> => {
  res.json({ ok: true, message: 'Liquipedia scrape started in background' });
  try {
    const { syncAoeEventCalendar } = await import('../scrapers/aoeEventCalendarScraper');
    const { scrapeUpcomingMatches } = await import('../scrapers/liquipediaScraper');
    await syncAoeEventCalendar();
    await scrapeUpcomingMatches();
  } catch (err) {
    logger.error('Liquipedia scrape error:', err);
  }
});

// POST /api/v1/dev/sync-score/:matchId — Force LP score sync for a specific match
router.post('/sync-score/:matchId', async (req: Request, res: Response): Promise<void> => {
  const { matchId } = req.params;
  res.json({ ok: true, message: `Syncing score for match ${matchId}` });
  try {
    const { syncMatchScore } = await import('../services/liquipediaLiveScorer');
    await (syncMatchScore as (id: string) => Promise<void>)(matchId);
  } catch (err) {
    logger.error('Sync score error:', err);
  }
});

// POST /api/v1/dev/enrich — trigger full enrichment (pro player set + odds recalc)
router.post('/enrich', async (_req: Request, res: Response): Promise<void> => {
  res.json({ ok: true, message: 'Enrichment started in background — check backend logs' });
  try {
    const { enrichAllUpcomingMatches } = await import('../scrapers/aoe4worldScraper');
    await enrichAllUpcomingMatches();
  } catch (err) {
    logger.error('Enrich error:', err);
  }
});

// AI-based seed endpoints were removed on 2026-04-19 — we no longer pay for
// the Anthropic API. Use /seed-history below (aoe4world only) or the admin
// panel's Liquipedia scraper instead.

// POST /api/v1/dev/seed-history — seed ALL players from aoe4world real data.
// Previously chained to Claude Opus for gap-filling; that step was removed
// with the rest of the AI scrapers.
router.post('/seed-history', async (req: Request, res: Response): Promise<void> => {
  const force = req.body?.force === true;
  const players = await prisma.player.findMany({ where: { aoe4worldId: { not: null } }, select: { id: true, name: true } });
  res.json({
    ok: true,
    message: `History seeding started: aoe4world data for ${players.length} players (force=${force})`,
    playerCount: players.length,
  });
  try {
    const { seedAllPlayerHistories } = await import('../scrapers/aoe4worldPlayerHistorySeeder');
    await seedAllPlayerHistories(force);
  } catch (err) {
    logger.error('[Seed History] Error:', err);
  }
});

// DELETE /api/v1/dev/clear-fake — remove seeded fake data, keep real scraped data
router.delete('/clear-fake', async (_req: Request, res: Response): Promise<void> => {
  try {
    // Delete matches from fake tournaments (identified by known fake liquipedia URLs)
    const fakeTournamentUrls = [
      'https://liquipedia.net/ageofempires4/World_Championship/2025',
      'https://liquipedia.net/ageofempires4/Quarterly_Series/2025/Spring',
      'https://liquipedia.net/ageofempires4/Red_Bull_Wololo/7',
      'https://liquipedia.net/ageofempires4/RSL/Season_3',
    ];

    const fakeTournaments = await prisma.tournament.findMany({
      where: { liquipediaUrl: { in: fakeTournamentUrls } },
      select: { id: true },
    });
    const fakeIds = fakeTournaments.map(t => t.id);

    const deletedBets = await prisma.bet.deleteMany({
      where: { match: { tournamentId: { in: fakeIds } } },
    });
    const deletedMatches = await prisma.match.deleteMany({
      where: { tournamentId: { in: fakeIds } },
    });
    const deletedTournaments = await prisma.tournament.deleteMany({
      where: { id: { in: fakeIds } },
    });

    res.json({
      ok: true,
      deleted: {
        bets: deletedBets.count,
        matches: deletedMatches.count,
        tournaments: deletedTournaments.count,
      },
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/v1/dev/set-admin — set admin by Steam ID64 (dev only)
router.post('/set-admin', async (req: Request, res: Response): Promise<void> => {
  try {
    const { steamId } = req.body as { steamId: string };
    if (!steamId) { res.status(400).json({ error: 'steamId required' }); return; }
    const result = await prisma.user.updateMany({
      where: { OR: [{ steamId }, { providerId: steamId }] },
      data: { isAdmin: true },
    });
    res.json({ ok: true, updated: result.count, steamId });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/v1/dev/roulette-start — manually bootstrap roulette (dev only)
router.post('/roulette-start', async (_req: Request, res: Response): Promise<void> => {
  try {
    const { initRoulette } = await import('../services/rouletteService');
    await initRoulette();
    res.json({ ok: true, message: 'Roulette initialized' });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
