import { Router, Request, Response } from 'express';
import axios from 'axios';
import { prisma } from '../index';
import logger from '../logger';

// In-memory cache for proxied avatars (Buffer + content-type)
const avatarCache = new Map<string, { data: Buffer; contentType: string; fetchedAt: number }>();
const AVATAR_CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

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

// GET /avatar/:playerId — proxy Liquipedia avatar to avoid hotlinking block
router.get('/avatar/:playerId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { playerId } = req.params;

    // Check in-memory cache first
    const cached = avatarCache.get(playerId);
    if (cached && Date.now() - cached.fetchedAt < AVATAR_CACHE_TTL) {
      res.set('Content-Type', cached.contentType);
      res.set('Cache-Control', 'public, max-age=86400'); // browser caches 24h
      res.send(cached.data);
      return;
    }

    const player = await prisma.player.findUnique({
      where: { id: playerId },
      select: { avatarUrl: true },
    });

    if (!player?.avatarUrl || player.avatarUrl === '') {
      res.status(404).send('No avatar');
      return;
    }

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

    const contentType = imgRes.headers['content-type'] || 'image/jpeg';
    const data = Buffer.from(imgRes.data);

    // Cache in memory
    avatarCache.set(playerId, { data, contentType, fetchedAt: Date.now() });

    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(data);
  } catch (err) {
    res.status(404).send('Avatar not found');
  }
});

export default router;
