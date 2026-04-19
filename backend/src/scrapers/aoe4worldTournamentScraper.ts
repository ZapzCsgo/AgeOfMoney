/**
 * aoe4world Tournament Scraper
 *
 * Uses the aoe4world public API: https://aoe4world.com/api/v0/tournaments
 * to discover upcoming S/A-tier 1v1 tournaments and their matches.
 *
 * Flow:
 * 1. Fetch all tournaments from the API
 * 2. Filter to S/A tier, 1v1 format, not cancelled
 * 3. For each tournament, fetch its detail page to extract scheduled matches
 * 4. Upsert players, tournaments, matches in DB
 * 5. Trigger enrichment (odds) for new matches
 */

import axios from 'axios';
import { prisma } from '../index';
import logger from '../logger';

const AOE4WORLD_API = 'https://aoe4world.com/api/v0';

interface Aoe4WorldTournament {
  id: number;
  slug: string;
  name: string;
  tier: string;
  start_date: string;
  end_date: string;
  cancelled?: boolean;
  url?: string;       // Liquipedia URL
  data?: {
    format?: string;  // "1v1", "2v2", etc.
    prize?: string;
    location?: string;
    organizer?: string;
    player_count?: string;
  };
  participants?: Array<{
    player: {
      profile_id: number;
      name: string;
      country?: string;
      liquipedia?: string;
    };
    seed?: number;
  }>;
  matches?: Array<{
    id?: number;
    round?: string;
    player1?: { profile_id: number; name: string };
    player2?: { profile_id: number; name: string };
    scheduled_at?: string;
    result?: { winner_id?: number; score?: string };
  }>;
}

async function fetchApi<T>(path: string): Promise<T | null> {
  try {
    const res = await axios.get<T>(`${AOE4WORLD_API}${path}`, {
      headers: {
        'User-Agent': 'AgeOfMoney/1.0 (contact@ageofmoney.com)',
        Accept: 'application/json',
      },
      timeout: 15000,
    });
    return res.data;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      if (err.response?.status === 404) return null;
      if (err.response?.status === 429) {
        await new Promise(r => setTimeout(r, 3000));
        return null;
      }
    }
    logger.error(`[aoe4world/tournaments] API error ${path}:`, err);
    return null;
  }
}

function mapTier(tier: string): string {
  const t = tier.toLowerCase();
  if (t.includes('s-tier') || t === 's') return 'S';
  if (t.includes('a-tier') || t === 'a') return 'A';
  if (t.includes('b-tier') || t === 'b') return 'B';
  return 'C';
}

export async function scrapeAoe4WorldTournaments(): Promise<void> {
  logger.info('[aoe4wTourn] Starting tournament scrape from aoe4world API');

  const data = await fetchApi<{ tournaments: Aoe4WorldTournament[] }>('/tournaments?limit=100');
  if (!data?.tournaments?.length) {
    logger.warn('[aoe4wTourn] No tournaments returned from API');
    return;
  }

  // Filter: S/A tier, 1v1 format, not cancelled, has an end_date in the future or recent past
  const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000); // 7 days ago
  const relevant = data.tournaments.filter(t => {
    if (t.cancelled) return false;
    const tier = mapTier(t.tier);
    if (tier !== 'S' && tier !== 'A') return false;
    const format = (t.data?.format ?? '1v1').toLowerCase();
    if (!format.includes('1v1')) return false;
    const endDate = t.end_date ? new Date(t.end_date) : null;
    if (endDate && endDate < cutoff) return false;
    return true;
  });

  logger.info(`[aoe4wTourn] Found ${relevant.length} relevant S/A-tier 1v1 tournaments`);

  let newMatches = 0;

  for (const tourn of relevant) {
    try {
      await processTournament(tourn);
      newMatches++;
    } catch (err) {
      logger.error(`[aoe4wTourn] Error processing ${tourn.name}:`, err);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  logger.info(`[aoe4wTourn] Done processing ${relevant.length} tournaments`);
}

async function processTournament(tourn: Aoe4WorldTournament): Promise<void> {
  // Fetch full detail to get participants and matches
  const detail = await fetchApi<Aoe4WorldTournament>(`/tournaments/${tourn.slug}`);
  const t = detail ?? tourn;

  const tier = mapTier(t.tier);
  const liquipediaUrl = t.url ?? `https://liquipedia.net/ageofempires/${t.slug}`;

  // Upsert tournament
  const tournament = await prisma.tournament.upsert({
    where: { liquipediaUrl },
    update: {
      name: t.name,
      tier,
      isActive: true,
    },
    create: {
      name: t.name,
      tier,
      liquipediaUrl,
      startDate: t.start_date ? new Date(t.start_date) : new Date(),
      isActive: true,
    },
  });

  // Upsert participants as players
  const playerMap = new Map<number, string>(); // profile_id → DB player id

  for (const participant of t.participants ?? []) {
    const p = participant.player;
    if (!p?.profile_id || !p?.name) continue;

    const slug = p.liquipedia
      ? decodeURIComponent(p.liquipedia.replace(/.*\/ageofempires\//, ''))
      : p.name.replace(/\s+/g, '_');

    const existing = await prisma.player.findFirst({
      where: {
        OR: [
          { aoe4worldId: String(p.profile_id) },
          { liquipediaSlug: slug },
        ],
      },
      select: { id: true },
    });

    if (existing) {
      // Update aoe4worldId if missing
      await prisma.player.update({
        where: { id: existing.id },
        data: { aoe4worldId: String(p.profile_id) },
      });
      playerMap.set(p.profile_id, existing.id);
    } else {
      const created = await prisma.player.create({
        data: {
          name: p.name,
          liquipediaSlug: slug,
          aoe4worldId: String(p.profile_id),
          country: p.country ?? null,
          elo: 1500,
        },
      });
      playerMap.set(p.profile_id, created.id);

      // New player discovered — seed their history in background from the
      // free aoe4world API (non-blocking). The Claude-AI gap-filler was
      // removed 2026-04-19 — sparse players stay sparse until the next
      // Liquipedia scrape picks them up.
      {
        const newPlayerId = created.id;
        const newPlayerName = p.name;
        const newPlayerAoe4Id = String(p.profile_id);
        setImmediate(async () => {
          try {
            logger.info(`[Tournament] New player ${newPlayerName} — seeding history from aoe4world`);
            const { seedPlayerHistoryFromAoe4World } = await import('./aoe4worldPlayerHistorySeeder');
            const { buildProPlayerSet } = await import('./aoe4worldScraper');
            const proIds = await buildProPlayerSet();
            await seedPlayerHistoryFromAoe4World(newPlayerId, newPlayerName, newPlayerAoe4Id, proIds);
          } catch (err) {
            logger.error(`[Tournament] History seeding failed for ${newPlayerName}:`, err);
          }
        });
      }
    }
  }

  // Process matches
  for (const match of t.matches ?? []) {
    if (!match.player1?.profile_id || !match.player2?.profile_id) continue;

    const p1DbId = playerMap.get(match.player1.profile_id);
    const p2DbId = playerMap.get(match.player2.profile_id);
    if (!p1DbId || !p2DbId) continue;

    const scheduledAt = match.scheduled_at
      ? new Date(match.scheduled_at)
      : new Date(t.start_date ?? Date.now());

    // Skip matches scheduled too far in the past
    if (scheduledAt < new Date(Date.now() - 4 * 3600 * 1000) && !match.result?.winner_id) continue;

    // Check if match already exists
    const windowStart = new Date(scheduledAt.getTime() - 3 * 3600 * 1000);
    const windowEnd = new Date(scheduledAt.getTime() + 3 * 3600 * 1000);
    const existing = await prisma.match.findFirst({
      where: {
        tournamentId: tournament.id,
        OR: [
          { player1Id: p1DbId, player2Id: p2DbId },
          { player1Id: p2DbId, player2Id: p1DbId },
        ],
        scheduledAt: { gte: windowStart, lte: windowEnd },
      },
      select: { id: true, status: true },
    });

    // If match has a result and exists in DB, update it
    if (existing && match.result?.winner_id) {
      const winnerProfileId = match.result.winner_id;
      const winnerId = playerMap.get(winnerProfileId) ?? null;
      if (winnerId && existing.status !== 'COMPLETED') {
        await prisma.match.update({
          where: { id: existing.id },
          data: {
            status: 'COMPLETED',
            winnerId,
            resultScore: match.result.score ?? null,
            betsOpen: false,
          },
        });
        logger.info(`[aoe4wTourn] Completed match ${existing.id} via aoe4world result`);
      }
      continue;
    }

    if (existing) continue; // already tracked, no result

    // Create new match with initial 50/50 odds (enrichment will update)
    await prisma.match.create({
      data: {
        player1Id: p1DbId,
        player2Id: p2DbId,
        tournamentId: tournament.id,
        status: scheduledAt <= new Date() ? 'LIVE' : 'UPCOMING',
        format: 'BO3',
        scheduledAt,
        betsClosedAt: new Date(scheduledAt.getTime() - 5 * 60 * 1000),
        odds1: 1.90,
        odds2: 1.90,
      },
    });

    logger.info(`[aoe4wTourn] New match: ${match.player1.name} vs ${match.player2.name} (${t.name})`);
  }
}
