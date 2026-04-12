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
const MIN_DEPOSIT   = 3;      // $3 minimum
const MIN_WITHDRAW  = 169;    // 169 coins minimum (= $0.99)

// ── Affiliate tier progression ─────────────────────────────────────────────────
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

// ── OxaPay API client ─────────────────────────────────────────────────────────
const OXAPAY_API = 'https://api.oxapay.com/v1';
const OXAPAY_KEY = () => process.env.OXAPAY_API_KEY || '';

async function oxaPost(path: string, body: Record<string, unknown>) {
  const res = await axios.post(`${OXAPAY_API}${path}`, {
    ...body,
    merchant_api_key: OXAPAY_KEY(),
  }, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 15000,
  });
  return res.data;
}

// ── Supported cryptos ──────────────────────────────────────────────────────────
const CRYPTO_MAP: Record<string, { currency: string; network: string }> = {
  btc:   { currency: 'BTC',  network: 'Bitcoin'  },
  eth:   { currency: 'ETH',  network: 'ERC-20'   },
  usdt:  { currency: 'USDT', network: 'TRC-20'   },
  ltc:   { currency: 'LTC',  network: 'Litecoin' },
  sol:   { currency: 'SOL',  network: 'Solana'   },
  xrp:   { currency: 'XRP',  network: 'XRP'      },
  bnb:   { currency: 'BNB',  network: 'BEP-20'   },
  matic: { currency: 'MATIC', network: 'Polygon' },
};

// ── POST /payments/crypto/create — Create OxaPay deposit invoice ─────────────
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

      const existingReferral = await prisma.affiliateReferral.findUnique({
        where: { referredUserId: userId },
      });
      if (existingReferral) {
        res.status(400).json({ error: 'Vous avez déjà utilisé un code affilié' }); return;
      }

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

    // Create OxaPay invoice
    try {
      const invoiceRes = await oxaPost('/payment/invoice', {
        amount:       usdAmount,
        currency:     'USD',
        to_currency:  CRYPTO_MAP[cryptoId].currency,
        order_id:     transaction.id,
        description:  `AgeOfMoney — ${finalCoins} ⚜ coins`,
        callback_url: `${process.env.BACKEND_URL}/api/v1/payments/crypto/webhook`,
        return_url:   `${process.env.FRONTEND_URL}/deposit`,
        lifetime:     60, // 60 minutes
      });

      if (invoiceRes.status !== 200 || !invoiceRes.data) {
        throw new Error(invoiceRes.message || 'OxaPay invoice creation failed');
      }

      // Save track_id to transaction
      await prisma.transaction.update({
        where: { id: transaction.id },
        data:  { stripeSessionId: invoiceRes.data.track_id },
      });

      res.json({
        paymentUrl:   invoiceRes.data.payment_url,
        trackId:      invoiceRes.data.track_id,
        usdAmount,
        coins:        finalCoins,
        paymentId:    transaction.id,
        expiresAt:    new Date(invoiceRes.data.expired_at * 1000).toISOString(),
      });
    } catch (oxaErr: unknown) {
      const errMsg = oxaErr instanceof Error ? oxaErr.message : String(oxaErr);
      const axiosData = (oxaErr as { response?: { data?: unknown } })?.response?.data;
      logger.error(`OxaPay API error: ${errMsg}`, { data: axiosData, apiKey: OXAPAY_KEY() ? 'SET' : 'EMPTY' });
      res.status(500).json({ error: 'Erreur lors de la création du paiement. Réessayez.' });
    }
  } catch (error) {
    logger.error('POST /payments/crypto/create error:', error);
    res.status(500).json({ error: 'Erreur lors de la création du paiement' });
  }
});

// ── POST /payments/crypto/webhook — OxaPay callback ──────────────────────────
router.post('/crypto/webhook', async (req: Request, res: Response): Promise<void> => {
  try {
    // Verify OxaPay HMAC-SHA512 signature
    const apiKey = OXAPAY_KEY();
    if (!apiKey) {
      logger.error('[Webhook] OXAPAY_API_KEY not configured');
      res.status(500).send('ok'); return;
    }

    const hmacHeader = req.headers['hmac'] as string | undefined;
    if (!hmacHeader) {
      logger.warn('[Webhook] Missing HMAC header — rejecting');
      res.status(401).send('ok'); return;
    }

    // Verify signature using raw body
    const rawBody = JSON.stringify(req.body);
    const expected = crypto.createHmac('sha512', apiKey).update(rawBody).digest('hex');
    if (hmacHeader !== expected) {
      logger.warn('[Webhook] Invalid OxaPay HMAC signature — rejecting');
      res.status(401).send('ok'); return;
    }

    const { status, order_id, amount } = req.body;

    // Only process confirmed payments
    if (status !== 'Paid') {
      res.status(200).send('ok'); return;
    }

    const transaction = await prisma.transaction.findUnique({
      where: { id: order_id },
    });

    if (!transaction || transaction.status === 'completed') {
      res.status(200).send('ok'); return;
    }

    // Credit coins to depositor atomically
    await prisma.$transaction([
      prisma.user.update({
        where: { id: transaction.userId },
        data:  { coins: { increment: transaction.coins } },
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

    logger.info(`[Deposit] Credited ${transaction.coins} coins to user ${transaction.userId} (OxaPay order ${order_id})`);

    // ── Process affiliate commission ───────────────────────────────────────────
    if (transaction.affiliateCodeId) {
      try {
        const affCode = await prisma.affiliateCode.findUnique({
          where: { id: transaction.affiliateCodeId },
          include: { referrals: true },
        });

        if (affCode) {
          const referrerId = affCode.userId;
          const depositedCoins = transaction.coins;
          const commission = Math.floor(depositedCoins * affCode.commissionRate);

          const existingReferral = await prisma.affiliateReferral.findUnique({
            where: { referredUserId: transaction.userId },
          });

          if (existingReferral) {
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

          await prisma.affiliateCode.update({
            where: { id: affCode.id },
            data: {
              available:     { increment: commission },
              totalEarnings: { increment: commission },
            },
          });

          // Auto-update commission tier
          const updatedAff = await prisma.affiliateCode.findUnique({
            where: { id: affCode.id },
            include: { referrals: true },
          });
          if (updatedAff) {
            const totalReferrals = updatedAff.referrals.length;
            const totalDeposited = updatedAff.referrals.reduce((s, r) => s + r.totalDeposited, 0);
            const newRate = computeTierRate(totalReferrals, totalDeposited);
            if (newRate !== updatedAff.commissionRate) {
              await prisma.affiliateCode.update({
                where: { id: affCode.id },
                data:  { commissionRate: newRate },
              });
              logger.info(`Affiliate ${affCode.code} upgraded to rate ${newRate}`);
            }
          }

          logger.info(`[Affiliate] Commission: ${commission} coins → referrer ${referrerId} (code ${affCode.code})`);
        }
      } catch (affErr) {
        logger.error('[Affiliate] Commission processing error:', affErr);
      }
    }

    // OxaPay requires "ok" response
    res.status(200).send('ok');
  } catch (error) {
    logger.error('POST /payments/crypto/webhook error:', error);
    res.status(200).send('ok');
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
    const MAX_WITHDRAW = 100_000;
    if (coinsInt > MAX_WITHDRAW) {
      res.status(400).json({ error: `Maximum de retrait: ${MAX_WITHDRAW} ⚜ par transaction` }); return;
    }
    if (!address || typeof address !== 'string' || address.length < 10 || address.length > 150 || !/^[a-zA-Z0-9:_-]+$/.test(address)) {
      res.status(400).json({ error: 'Adresse de retrait invalide' }); return;
    }

    const usdAmount = parseFloat((coinsInt * WITHDRAW_RATE).toFixed(2));
    const currency = CRYPTO_MAP[cryptoId].currency;

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

    // TODO: Initiate payout via OxaPay payout API when payout key is configured
    logger.info(`[Withdraw] ${coinsInt} coins ($${usdAmount}) withdrawal initiated for user ${userId} → ${address} (${currency})`);

    res.json({
      success:  true,
      usdAmount,
      currency: currency.toUpperCase(),
      message:  `Retrait de ${coinsInt} ⚜ initié. Vous recevrez $${usdAmount} en ${currency.toUpperCase()} sous 24h.`,
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
