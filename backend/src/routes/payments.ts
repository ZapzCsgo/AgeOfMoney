import { Router, Request, Response } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import { prisma } from '../index';
import { requireAuth } from '../middleware/auth';
import logger from '../logger';
import { getIo } from '../socket';

const router = Router();

// ── Rates ──────────────────────────────────────────────────────────────────────
const DEPOSIT_RATE  = 1.69;   // $1 = 1.69 coins
const WITHDRAW_RATE = 0.585;  // 1 coin = $0.585 (1.69 coins = $0.99)
const MIN_DEPOSIT   = 1;      // $1 minimum
const MIN_WITHDRAW  = 169;    // 169 coins minimum (= $0.99)

// ── Affiliate tier progression ─────────────────────────────────────────────────
// Each tier requires BOTH referral count AND deposited volume (in coins)
const TIERS = [
  { rate: 0.005, referrals:   0, deposited:       0 }, // Tier 1 — 0.5%
  { rate: 0.010, referrals:  15, deposited:   15000 }, // Tier 2 — 1%
  { rate: 0.015, referrals:  30, deposited:   30000 }, // Tier 3 — 1.5%
  { rate: 0.020, referrals:  50, deposited:   60000 }, // Tier 4 — 2%
  { rate: 0.025, referrals:  75, deposited:  100000 }, // Tier 5 — 2.5%
  { rate: 0.030, referrals: 100, deposited:  150000 }, // Tier 6 — 3%
  { rate: 0.035, referrals: 150, deposited:  250000 }, // Tier 7 — 3.5%
  { rate: 0.040, referrals: 200, deposited:  400000 }, // Tier 8 — 4%
  { rate: 0.045, referrals: 300, deposited:  600000 }, // Tier 9 — 4.5%
  { rate: 0.050, referrals: 500, deposited: 1000000 }, // Tier 10 — 5%
];

function computeTierRate(totalReferrals: number, totalDeposited: number): number {
  let rate = TIERS[0].rate;
  for (const tier of TIERS) {
    if (totalReferrals >= tier.referrals && totalDeposited >= tier.deposited) {
      rate = tier.rate;
    }
  }
  return rate;
}

// ── NOWPayments client ─────────────────────────────────────────────────────────
const NOWPAYMENTS_API = 'https://api.nowpayments.io/v1';
const NP_KEY = () => process.env.NOWPAYMENTS_API_KEY || '';

async function npGet(path: string) {
  const res = await axios.get(`${NOWPAYMENTS_API}${path}`, {
    headers: { 'x-api-key': NP_KEY() },
  });
  return res.data;
}

async function npPost(path: string, body: Record<string, unknown>) {
  const res = await axios.post(`${NOWPAYMENTS_API}${path}`, body, {
    headers: { 'x-api-key': NP_KEY(), 'Content-Type': 'application/json' },
  });
  return res.data;
}

// ── Supported cryptos ──────────────────────────────────────────────────────────
const CRYPTO_MAP: Record<string, { currency: string; network: string }> = {
  btc:  { currency: 'btc',       network: 'Bitcoin'    },
  eth:  { currency: 'eth',       network: 'ERC-20'     },
  usdt: { currency: 'usdttrc20', network: 'TRC-20'     },
  ltc:  { currency: 'ltc',       network: 'Litecoin'   },
  sol:  { currency: 'sol',       network: 'Solana'     },
  xrp:  { currency: 'xrp',       network: 'XRP Ledger' },
};

// Recursively sort object keys for NOWPayments IPN signature verification
function sortObject(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.keys(obj).sort().reduce((acc, key) => {
    const val = obj[key];
    acc[key] = val && typeof val === 'object' && !Array.isArray(val)
      ? sortObject(val as Record<string, unknown>)
      : val;
    return acc;
  }, {} as Record<string, unknown>);
}

// ── POST /payments/crypto/create — Create crypto deposit invoice ───────────────
router.post('/crypto/create', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { cryptoId, usdAmount, coins, affiliateCode } = req.body;

    if (!cryptoId || !CRYPTO_MAP[cryptoId]) {
      res.status(400).json({ error: 'Crypto non supportée' }); return;
    }
    if (!usdAmount || usdAmount < MIN_DEPOSIT) {
      res.status(400).json({ error: `Montant minimum: $${MIN_DEPOSIT}` }); return;
    }

    const currency = CRYPTO_MAP[cryptoId].currency;

    // ── Validate affiliate code from DB ────────────────────────────────────────
    let bonusMultiplier = 1;
    let affiliateCodeId: string | null = null;

    if (affiliateCode && typeof affiliateCode === 'string' && affiliateCode.trim().length > 0) {
      const aff = await prisma.affiliateCode.findUnique({
        where: { code: affiliateCode.trim().toUpperCase() },
      });

      if (!aff) {
        res.status(400).json({ error: 'Code affilié invalide' }); return;
      }
      if (aff.userId === userId) {
        res.status(400).json({ error: 'Vous ne pouvez pas utiliser votre propre code' }); return;
      }

      // Check user hasn't already used a referral code before
      const existingReferral = await prisma.affiliateReferral.findUnique({
        where: { referredUserId: userId },
      });
      if (existingReferral) {
        res.status(400).json({ error: 'Vous avez déjà utilisé un code affilié' }); return;
      }

      // Bonus coins = referrer's commission rate (e.g. 5% → +5% coins for depositor)
      bonusMultiplier = 1 + aff.commissionRate;
      affiliateCodeId = aff.id;
    }

    const finalCoins = Math.floor(usdAmount * DEPOSIT_RATE * bonusMultiplier);

    // Create pending transaction in DB
    const transaction = await prisma.transaction.create({
      data: {
        userId,
        type:           'deposit',
        amount:         Math.round(usdAmount * 100),
        realAmount:     Math.round(usdAmount * 100),
        coins:          finalCoins,
        status:         'pending',
        affiliateCodeId,
      },
    });

    // Create NOWPayments invoice
    let invoiceData: {
      payment_id: string;
      pay_address: string;
      pay_amount: number;
      pay_currency: string;
    };

    try {
      invoiceData = await npPost('/payment', {
        price_amount:      usdAmount,
        price_currency:    'usd',
        pay_currency:      currency,
        order_id:          transaction.id,
        order_description: `AgeOfMoney — ${finalCoins} ⚜ coins`,
        ipn_callback_url:  `${process.env.BACKEND_URL}/api/v1/payments/crypto/webhook`,
      });
    } catch (npErr) {
      // If NOWPayments not configured, return mock address for dev
      logger.warn('NOWPayments not configured, returning dev mock address');
      res.json({
        address:      'DEV_MODE_NO_NOWPAYMENTS_KEY_CONFIGURED',
        cryptoAmount: (usdAmount * 0.000015).toFixed(8),
        usdAmount,
        coins:        finalCoins,
        paymentId:    transaction.id,
        expiresAt:    new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        devMode:      true,
      });
      return;
    }

    // Save payment id to transaction
    await prisma.transaction.update({
      where: { id: transaction.id },
      data:  { stripeSessionId: invoiceData.payment_id.toString() },
    });

    res.json({
      address:      invoiceData.pay_address,
      cryptoAmount: invoiceData.pay_amount.toString(),
      usdAmount,
      coins:        finalCoins,
      paymentId:    invoiceData.payment_id,
      expiresAt:    new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
  } catch (error) {
    logger.error('POST /payments/crypto/create error:', error);
    res.status(500).json({ error: 'Erreur lors de la création du paiement' });
  }
});

// ── POST /payments/crypto/webhook — NOWPayments IPN callback ──────────────────
router.post('/crypto/webhook', async (req: Request, res: Response): Promise<void> => {
  try {
    // Verify NOWPayments IPN signature (HMAC-SHA512) — MANDATORY in production
    const ipnSecret = process.env.NOWPAYMENTS_IPN_SECRET;
    if (!ipnSecret) {
      if (process.env.NODE_ENV === 'production') {
        logger.error('[Webhook] NOWPAYMENTS_IPN_SECRET not configured — rejecting in production');
        res.status(500).json({ error: 'Server misconfiguration' });
        return;
      }
      logger.warn('[Webhook] NOWPAYMENTS_IPN_SECRET not set — dev mode, skipping signature');
    } else {
      const sig = req.headers['x-nowpayments-sig'] as string | undefined;
      if (!sig) {
        logger.warn('[Webhook] Missing NOWPayments signature — rejecting');
        res.status(401).json({ error: 'Missing signature' });
        return;
      }
      const sortedBody = JSON.stringify(sortObject(req.body));
      const expected = crypto.createHmac('sha512', ipnSecret).update(sortedBody).digest('hex');
      if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
        logger.warn('[Webhook] Invalid NOWPayments signature — rejecting');
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    }

    const { payment_status, order_id } = req.body;

    if (payment_status !== 'finished' && payment_status !== 'confirmed') {
      res.json({ received: true }); return;
    }

    const transaction = await prisma.transaction.findUnique({
      where: { id: order_id },
    });

    if (!transaction || transaction.status === 'completed') {
      res.json({ received: true }); return;
    }

    // Credit coins to depositor atomically
    await prisma.$transaction([
      prisma.user.update({
        where: { id: transaction.userId },
        data:  {
          coins:        { increment: transaction.coins },
          totalWagered: { increment: 0 }, // keep field touched
        },
      }),
      prisma.transaction.update({
        where: { id: transaction.id },
        data:  { status: 'completed' },
      }),
    ]);

    const updatedUser = await prisma.user.findUnique({ where: { id: transaction.userId }, select: { coins: true } });
    const io = getIo();
    if (io && updatedUser) {
      io.to(`user:${transaction.userId}`).emit('coinsUpdate', { coins: updatedUser.coins, direction: 'up' });
      io.to(`user:${transaction.userId}`).emit('notification', { type: 'deposit', amount: transaction.coins });
    }

    logger.info(`Credited ${transaction.coins} coins to user ${transaction.userId}`);

    // ── Process affiliate commission ───────────────────────────────────────────
    if (transaction.affiliateCodeId) {
      try {
        const affCode = await prisma.affiliateCode.findUnique({
          where: { id: transaction.affiliateCodeId },
          include: { referrals: true },
        });

        if (affCode) {
          const referrerId = affCode.userId;
          const depositedCoins = transaction.coins; // coins credited to depositor

          // Commission earned by referrer
          const commission = Math.floor(depositedCoins * affCode.commissionRate);

          // Upsert AffiliateReferral for this user
          const existingReferral = await prisma.affiliateReferral.findUnique({
            where: { referredUserId: transaction.userId },
          });

          if (existingReferral) {
            // Update existing referral (re-deposit scenario)
            await prisma.affiliateReferral.update({
              where: { referredUserId: transaction.userId },
              data: {
                totalDeposited: { increment: depositedCoins },
                commission:     { increment: commission },
                isActive:       true,
                lastActiveAt:   new Date(),
              },
            });
          } else {
            // First deposit with this code — create referral
            await prisma.affiliateReferral.create({
              data: {
                affiliateCodeId: affCode.id,
                referredUserId:  transaction.userId,
                totalDeposited:  depositedCoins,
                commission,
                isActive:        true,
                lastActiveAt:    new Date(),
              },
            });
          }

          // Credit commission to referrer's affiliate balance
          await prisma.affiliateCode.update({
            where: { id: affCode.id },
            data: {
              available:     { increment: commission },
              totalEarnings: { increment: commission },
            },
          });

          // Auto-update commission tier based on aggregate referral stats
          const updatedAff = await prisma.affiliateCode.findUnique({
            where: { id: affCode.id },
            include: { referrals: true },
          });
          if (updatedAff) {
            const totalReferrals  = updatedAff.referrals.length;
            const totalDeposited  = updatedAff.referrals.reduce((s, r) => s + r.totalDeposited, 0);
            const newRate         = computeTierRate(totalReferrals, totalDeposited);
            if (newRate !== updatedAff.commissionRate) {
              await prisma.affiliateCode.update({
                where: { id: affCode.id },
                data:  { commissionRate: newRate },
              });
              logger.info(`Affiliate ${affCode.code} upgraded to rate ${newRate}`);
            }
          }

          logger.info(`Affiliate commission: ${commission} coins → referrer ${referrerId} (code ${affCode.code})`);
        }
      } catch (affErr) {
        // Don't fail the webhook if affiliate processing errors
        logger.error('Affiliate commission processing error:', affErr);
      }
    }

    res.json({ received: true });
  } catch (error) {
    logger.error('POST /payments/crypto/webhook error:', error);
    res.status(500).json({ error: 'Webhook error' });
  }
});

// ── POST /payments/crypto/withdraw — Initiate withdrawal ──────────────────────
router.post('/crypto/withdraw', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { cryptoId, coins, address } = req.body;

    if (!cryptoId || !CRYPTO_MAP[cryptoId]) {
      res.status(400).json({ error: 'Crypto non supportée' }); return;
    }
    const coinsInt = Math.floor(Number(coins));
    if (!Number.isFinite(coinsInt) || coinsInt < MIN_WITHDRAW) {
      res.status(400).json({ error: `Minimum de retrait: ${MIN_WITHDRAW} ⚜ ($0.99)` }); return;
    }
    const MAX_WITHDRAW = 100_000; // 100k coins max per withdrawal
    if (coinsInt > MAX_WITHDRAW) {
      res.status(400).json({ error: `Maximum de retrait: ${MAX_WITHDRAW} ⚜ par transaction` }); return;
    }
    if (!address || typeof address !== 'string' || address.length < 10 || address.length > 150 || !/^[a-zA-Z0-9:_-]+$/.test(address)) {
      res.status(400).json({ error: 'Adresse de retrait invalide' }); return;
    }

    const usdAmount = parseFloat((coinsInt * WITHDRAW_RATE).toFixed(2));
    const currency  = CRYPTO_MAP[cryptoId].currency;

    // Atomic transaction: re-check balance inside to prevent race conditions
    await prisma.$transaction(async (tx) => {
      const freshUser = await tx.user.findUnique({ where: { id: userId }, select: { coins: true } });
      if (!freshUser || freshUser.coins < coinsInt) {
        throw new Error('Solde insuffisant');
      }
      await tx.user.update({
        where: { id: userId },
        data:  { coins: { decrement: coinsInt } },
      });
      await tx.transaction.create({
        data: {
          userId,
          type:       'withdrawal',
          amount:     Math.round(usdAmount * 100),
          realAmount: Math.round(usdAmount * 100),
          coins:      -coinsInt,
          status:     'pending',
        },
      });
    });

    // Initiate payout via NOWPayments
    try {
      await npPost('/payout', {
        withdrawals: [{
          address,
          currency,
          amount:   usdAmount,
          extra_id: `aom_${userId}_${Date.now()}`,
        }],
      });
    } catch (npErr) {
      logger.warn('NOWPayments payout failed (dev mode?)', npErr);
    }

    const approxCrypto = (usdAmount * 0.000015).toFixed(8);
    res.json({
      success:      true,
      usdAmount,
      cryptoAmount: approxCrypto,
      currency:     currency.toUpperCase(),
      message:      `Retrait de ${coinsInt} ⚜ initié. Vous recevrez $${usdAmount} en ${currency.toUpperCase()} sous 24h.`,
    });
  } catch (error) {
    logger.error('POST /payments/crypto/withdraw error:', error);
    res.status(500).json({ error: 'Erreur lors du retrait' });
  }
});

// ── GET /payments/history ─────────────────────────────────────────────────────
router.get('/history', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const transactions = await prisma.transaction.findMany({
      where:   { userId },
      orderBy: { createdAt: 'desc' },
      take:    50,
    });
    res.json({ data: transactions });
  } catch (error) {
    logger.error('GET /payments/history error:', error);
    res.status(500).json({ error: 'Erreur historique' });
  }
});

export default router;
