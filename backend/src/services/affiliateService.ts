import crypto from 'crypto';
import { prisma } from '../index';
import logger from '../logger';

/** SHA-256 hex of a raw IP (stored instead of plain IP for privacy/GDPR). */
export function hashIp(ip: string | undefined): string | null {
  if (!ip) return null;
  // Normalize IPv4-in-IPv6 (::ffff:1.2.3.4 → 1.2.3.4)
  const clean = ip.replace(/^::ffff:/, '').trim();
  if (!clean) return null;
  return crypto.createHash('sha256').update(clean).digest('hex');
}

/** Fire-and-forget: update the user's latest known IP hash. */
export async function touchUserIp(userId: string, rawIp: string | undefined): Promise<void> {
  const hash = hashIp(rawIp);
  if (!hash) return;
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { lastIpHash: hash, lastIpAt: new Date() },
    });
  } catch (err) {
    logger.warn('[Affiliate] touchUserIp failed:', err);
  }
}

// Tier progression — revshare on net losses (not deposits).
// Impossible to lose money: we always share a % of an already-positive amount.
export const AFFILIATE_TIERS = [
  { rate: 0.25, referrals:  0, deposited:     0 }, // Bronze — 25%
  { rate: 0.30, referrals: 10, deposited: 10000 }, // Silver — 30%
  { rate: 0.35, referrals: 50, deposited: 50000 }, // Gold   — 35%
];

export function computeTierRate(totalReferrals: number, totalDeposited: number): number {
  let rate = AFFILIATE_TIERS[0].rate;
  for (const tier of AFFILIATE_TIERS) {
    if (totalReferrals >= tier.referrals && totalDeposited >= tier.deposited) {
      rate = tier.rate;
    }
  }
  return rate;
}

/**
 * Credit affiliate commission based on a resolved bet outcome.
 *
 * Uses running netLossBalance with negative carryover:
 *   - user lost the bet      → delta = +stake       (positive = loss)
 *   - user won the bet       → delta = -(payout-stake) (negative = profit)
 *
 * When newBalance > 0: pay rate% on the surplus, reset balance to 0.
 * When newBalance ≤ 0: carry over, no commission (protects house from lucky streaks).
 *
 * Call this AFTER the bet has been settled and coins moved.
 */
export async function creditAffiliateOnBetResolved(
  referredUserId: string,
  stakeAmount: number,
  netDelta: number,
): Promise<void> {
  try {
    const referral = await prisma.affiliateReferral.findUnique({
      where: { referredUserId },
      include: { affiliateCode: true },
    });
    if (!referral) return; // user not referred — nothing to do

    const rate = referral.affiliateCode.commissionRate;

    // Atomic increment so concurrent bet resolutions don't clobber each
    // other's netLossBalance. The `increment: netDelta` becomes a single
    // SQL `UPDATE SET netLossBalance = netLossBalance + ?` which is safe
    // under Read Committed.
    const updated = await prisma.affiliateReferral.update({
      where: { id: referral.id },
      data: {
        netLossBalance: { increment: netDelta },
        totalWagered:   { increment: stakeAmount },
        isActive:       true,
        lastActiveAt:   new Date(),
      },
      select: { netLossBalance: true },
    });

    // If the post-increment balance is still <= 0, no commission yet.
    // Negative balance is carried forward (protects house from lucky streaks).
    if (updated.netLossBalance <= 0) return;

    // Positive surplus → pay commission on it, CAS the balance back to 0 so
    // we don't double-pay. If CAS fails (another bet resolved in the
    // meantime), the next call will pick up the residue and pay on it.
    const newBalance = updated.netLossBalance;
    const commission = Math.floor(newBalance * rate);

    const cas = await prisma.affiliateReferral.updateMany({
      where: { id: referral.id, netLossBalance: newBalance },
      data:  { netLossBalance: 0 },
    });
    if (cas.count === 0) return; // lost the race, next resolution handles it

    await prisma.$transaction([
      prisma.affiliateReferral.update({
        where: { id: referral.id },
        data: {
          commission: { increment: commission },
        },
      }),
      prisma.affiliateCode.update({
        where: { id: referral.affiliateCodeId },
        data: {
          available:     { increment: commission },
          totalEarnings: { increment: commission },
        },
      }),
    ]);

    // Re-check tier (may have been upgraded by this commission)
    const fresh = await prisma.affiliateCode.findUnique({
      where: { id: referral.affiliateCodeId },
      include: { referrals: true },
    });
    if (fresh) {
      const totalRefs = fresh.referrals.length;
      const totalDep  = fresh.referrals.reduce((s, r) => s + r.totalDeposited, 0);
      const newRate   = computeTierRate(totalRefs, totalDep);
      if (newRate !== fresh.commissionRate) {
        await prisma.affiliateCode.update({
          where: { id: fresh.id },
          data:  { commissionRate: newRate },
        });
        logger.info(`[Affiliate] ${fresh.code} tier upgraded to ${(newRate * 100).toFixed(0)}%`);
      }
    }

    if (commission > 0) {
      logger.info(`[Affiliate] Commission ${commission}⚜ → ${referral.affiliateCode.code} (user=${referredUserId}, rate=${rate})`);
    }
  } catch (err) {
    logger.error('[Affiliate] creditAffiliateOnBetResolved error:', err);
  }
}
