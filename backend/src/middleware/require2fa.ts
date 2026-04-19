/**
 * Middleware 2FA : pour les users avec `totpEnabled=true`, toute requête
 * depuis une IP absente de `UserTrustedIp` doit inclure un `totpCode` valide
 * (header `x-totp-code` ou body.totpCode) AVANT de passer au handler.
 *
 * Après un succès TOTP, l'IP est ajoutée à la trusted-list et les requêtes
 * suivantes sur la même IP passent en fast-path (juste un UPDATE lastSeen).
 *
 * Deux modes d'utilisation :
 *   - `require2FAForTrustedIp` : IP check + TOTP si nouvelle IP. Usage :
 *     gate `/users/me` pour forcer un challenge au premier login depuis
 *     une IP inconnue.
 *   - `require2FAForSensitive` : IP check ignoré, TOUJOURS exige un TOTP
 *     code si l'user a `totpEnabled`. Usage : retraits (même sur IP de
 *     confiance, on veut re-confirmer).
 *
 * Contrat d'erreur frontend : `{ error: 'TOTP_REQUIRED' }` pour "donne-moi
 * un code", `{ error: 'TOTP_INVALID' }` pour "code faux".
 */

import { Request, Response, NextFunction } from 'express';
import { authenticator } from 'otplib';
import { prisma } from '../index';
import logger from '../logger';

/**
 * Normalize the client IP : Express `req.ip` peut être IPv4-mapped IPv6
 * (`::ffff:1.2.3.4`) ou du vrai IPv6. On strip le préfixe pour matcher
 * les 2 variantes d'une même IP. Sensible à `app.set('trust proxy', …)`
 * côté index.ts — vérifier que l'IP réelle client arrive bien ici.
 */
function clientIp(req: Request): string {
  const raw = (req.ip || req.socket.remoteAddress || '').trim();
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
}

function extractTotpCode(req: Request): string | null {
  const h = req.headers['x-totp-code'];
  const headerVal = Array.isArray(h) ? h[0] : h;
  const bodyVal = (req.body && typeof req.body === 'object') ? (req.body as { totpCode?: unknown }).totpCode : undefined;
  const raw = (typeof headerVal === 'string' && headerVal) ? headerVal : (typeof bodyVal === 'string' ? bodyVal : '');
  return raw.trim().length === 6 && /^\d{6}$/.test(raw.trim()) ? raw.trim() : null;
}

async function trustIp(userId: string, ip: string, ua: string | undefined): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "UserTrustedIp" (id, "userId", ip, "firstSeen", "lastSeen", "userAgent")
       VALUES ($1, $2, $3, NOW(), NOW(), $4)
       ON CONFLICT ("userId", ip) DO UPDATE SET "lastSeen" = NOW()`,
      `uti_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId,
      ip,
      ua?.slice(0, 200) ?? null,
    );
  } catch (err) {
    logger.warn(`[2FA] trustIp failed for ${userId}@${ip}:`, err);
  }
}

async function ipIsTrusted(userId: string, ip: string): Promise<boolean> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM "UserTrustedIp" WHERE "userId" = $1 AND ip = $2 LIMIT 1`,
      userId, ip,
    );
    return rows.length > 0;
  } catch {
    // Si la table n'existe pas encore (migration pas appliquée), on ne bloque
    // personne — mieux que lockout général.
    return true;
  }
}

/**
 * Gate "new IP challenge". Si l'user a 2FA activé ET l'IP n'est pas
 * trusted, exige un TOTP code. Si OK, ajoute l'IP à la trusted-list.
 */
export async function require2FAForTrustedIp(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  const userId = req.user?.id;
  if (!userId) { next(); return; } // requireAuth should have run first

  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpEnabled: true, totpSecret: true },
  });
  if (!u?.totpEnabled || !u.totpSecret) { next(); return; }

  const ip = clientIp(req);
  if (await ipIsTrusted(userId, ip)) {
    // Touche lastSeen sans bloquer la requête
    prisma.$executeRawUnsafe(
      `UPDATE "UserTrustedIp" SET "lastSeen" = NOW() WHERE "userId" = $1 AND ip = $2`,
      userId, ip,
    ).catch(() => {});
    next();
    return;
  }

  // IP inconnue → exige TOTP
  const code = extractTotpCode(req);
  if (!code) {
    res.status(403).json({ error: 'TOTP_REQUIRED', reason: 'unknown_ip' });
    return;
  }
  const isValid = authenticator.verify({ token: code, secret: u.totpSecret });
  if (!isValid) {
    res.status(401).json({ error: 'TOTP_INVALID' });
    return;
  }
  await trustIp(userId, ip, req.headers['user-agent'] as string | undefined);
  next();
}

/**
 * Gate "sensitive action". Pour retraits et autres opérations à risque :
 * si 2FA activé, TOUJOURS exige un code, même sur IP trusted. Ne trust
 * PAS l'IP suite à cette vérification (la liste trusted c'est pour
 * `require2FAForTrustedIp` uniquement).
 */
export async function require2FAForSensitive(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  const userId = req.user?.id;
  if (!userId) { next(); return; }

  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpEnabled: true, totpSecret: true },
  });
  if (!u?.totpEnabled || !u.totpSecret) { next(); return; }

  const code = extractTotpCode(req);
  if (!code) {
    res.status(403).json({ error: 'TOTP_REQUIRED', reason: 'sensitive_action' });
    return;
  }
  const isValid = authenticator.verify({ token: code, secret: u.totpSecret });
  if (!isValid) {
    res.status(401).json({ error: 'TOTP_INVALID' });
    return;
  }
  next();
}
