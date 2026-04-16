import { Router, Request, Response } from 'express';
import axios from 'axios';
import { prisma } from '../index';
import logger from '../logger';

// 1x1 transparent PNG — returned when no avatar exists
const TRANSPARENT_PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAAlwSFlzAAAWJQAAFiUBSVIk8AAAAA0lEQVQI12P4z8BQDwAEgAF/QualzQAAAABJRU5ErkJggg==', 'base64');
// In-memory cache to avoid DB hits on every request
const memCache = new Map<string, { data: Buffer; mime: string }>();

/**
 * Download an avatar image and store it in the DB (avatarBlob + avatarMime).
 * Called at scrape time — the image is then served from DB forever.
 */
export async function downloadAndStoreAvatar(playerId: string, avatarUrl: string): Promise<void> {
  try {
    const imgUrl = avatarUrl.startsWith('http') ? avatarUrl : `https://liquipedia.net${avatarUrl}`;
    const imgRes = await axios.get(imgUrl, {
      responseType: 'arraybuffer',
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://liquipedia.net/',
      },
    });
    const mime = imgRes.headers['content-type'] || 'image/jpeg';
    const blob = Buffer.from(imgRes.data);
    await prisma.player.update({
      where: { id: playerId },
      data: { avatarBlob: blob, avatarMime: mime },
    });
    memCache.set(playerId, { data: blob, mime });
    logger.info(`[Avatar] Downloaded & stored ${(blob.length / 1024).toFixed(0)}KB for ${playerId}`);
  } catch (err: any) {
    logger.warn(`[Avatar] Failed to download image for ${playerId}: ${err.message}`);
  }
}

const router = Router();

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const search = req.query.search as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string || '50'), 100);
    const offset = parseInt(req.query.offset as string || '0');

    const whereClause: Record<string, unknown> = {};
    if (search) {
      whereClause.name = { contains: search, mode: 'insensitive' };
    }

    const [players, total] = await Promise.all([
      prisma.player.findMany({
        where: whereClause,
        orderBy: { elo: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          name: true,
          elo: true,
          winrate: true,
          country: true,
          avatarUrl: true,
          lastMatchAt: true,
          _count: {
            select: {
              matchesAsPlayer1: true,
              matchesAsPlayer2: true,
            },
          },
        },
      }),
      prisma.player.count({ where: whereClause }),
    ]);

    res.json({ data: players, total, limit, offset });
  } catch (error) {
    logger.error('GET /players error:', error);
    res.status(500).json({ error: 'Failed to fetch players' });
  }
});

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const player = await prisma.player.findUnique({
      where: { id },
    });

    if (!player) {
      res.status(404).json({ error: 'Player not found' });
      return;
    }

    // Recent matches
    const recentMatches = await prisma.match.findMany({
      where: {
        status: 'COMPLETED',
        OR: [{ player1Id: id }, { player2Id: id }],
      },
      orderBy: { scheduledAt: 'desc' },
      take: 10,
      include: {
        player1: { select: { id: true, name: true, country: true } },
        player2: { select: { id: true, name: true, country: true } },
        tournament: { select: { id: true, name: true, tier: true } },
      },
    });

    // Tournament wins
    const tournamentWins = await prisma.match.count({
      where: {
        status: 'COMPLETED',
        winnerId: id,
        format: 'GRAND_FINAL',
      },
    });

    // Total match stats
    const totalMatches = await prisma.match.count({
      where: {
        status: 'COMPLETED',
        OR: [{ player1Id: id }, { player2Id: id }],
      },
    });

    const wins = await prisma.match.count({
      where: {
        status: 'COMPLETED',
        winnerId: id,
      },
    });

    res.json({
      data: {
        ...player,
        stats: {
          totalMatches,
          wins,
          losses: totalMatches - wins,
          tournamentWins,
          winrateCalculated: totalMatches > 0 ? wins / totalMatches : 0,
        },
        recentMatches,
      },
    });
  } catch (error) {
    logger.error('GET /players/:id error:', error);
    res.status(500).json({ error: 'Failed to fetch player' });
  }
});

// GET /avatar/:playerId — serve stored avatar from DB (no LP requests at runtime)
router.get('/avatar/:playerId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { playerId } = req.params;

    // 1. Check in-memory cache (avoids DB hit on repeat loads)
    const cached = memCache.get(playerId);
    if (cached) {
      res.set('Content-Type', cached.mime);
      res.set('Cache-Control', 'public, max-age=604800'); // 7 days
      res.send(cached.data);
      return;
    }

    // 2. Read from DB (avatarBlob persists across redeploys)
    const player = await prisma.player.findUnique({
      where: { id: playerId },
      select: { avatarBlob: true, avatarMime: true, avatarUrl: true },
    });

    if (player?.avatarBlob) {
      const data = Buffer.from(player.avatarBlob);
      const mime = player.avatarMime || 'image/jpeg';
      memCache.set(playerId, { data, mime });
      res.set('Content-Type', mime);
      res.set('Cache-Control', 'public, max-age=604800');
      res.send(data);
      return;
    }

    // 3. No blob yet — try live fetch from LP (one-time, then store in DB)
    if (player?.avatarUrl && player.avatarUrl !== '') {
      const imgUrl = player.avatarUrl.startsWith('http')
        ? player.avatarUrl
        : `https://liquipedia.net${player.avatarUrl}`;
      const imgRes = await axios.get(imgUrl, {
        responseType: 'arraybuffer',
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://liquipedia.net/',
        },
      });
      const mime = imgRes.headers['content-type'] || 'image/jpeg';
      const data = Buffer.from(imgRes.data);
      // Store in DB so we never fetch from LP again
      await prisma.player.update({
        where: { id: playerId },
        data: { avatarBlob: data, avatarMime: mime },
      }).catch(() => {});
      memCache.set(playerId, { data, mime });
      res.set('Content-Type', mime);
      res.set('Cache-Control', 'public, max-age=604800');
      res.send(data);
      return;
    }

    // 4. No avatar at all — transparent pixel
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(TRANSPARENT_PIXEL);
  } catch (err) {
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-cache');
    res.send(TRANSPARENT_PIXEL);
  }
});

export default router;
