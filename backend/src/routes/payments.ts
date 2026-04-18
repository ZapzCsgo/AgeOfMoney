import { Router, Request, Response } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import { prisma } from '../index';
import { requireAuth } from '../middleware/auth';
import { touchUserIp } from '../services/affiliateService';
import logger from '../logger';
import { getIo } from '../socket';

const router = Router();

// ── Rates ──────────────────────────────────────────────────────────────────────
const DEPOSIT_RATE  = 1.69;   // $1 = 1.69 coins
const WITHDRAW_RATE = 0.585;  // 1 coin = $0.585 (1.69 coins = $0.99)
const MIN_DEPOSIT   = 3;      // $3 minimum
const MIN_WITHDRAW  = 169;    // 169 coins minimum (= $0.99)

// Affiliate tiers and commission logic live in services/affiliateService.ts.
// Revshare runs on net losses (at bet resolution time), not on deposits.
// Flat deposit bonus for any valid affiliate code (decoupled from revshare rate).
const AFFILIATE_DEPOSIT_BONUS_PCT = 5; // +5% coins on deposit when a code is applied

// ── OxaPay API client ─────────────────────────────────────────────────────────
const OXAPAY_API = 'https://api.oxapay.com/v1';
const OXAPAY_KEY = () => process.env.OXAPAY_API_KEY || '';
const OXAPAY_PAYOUT_KEY = () => process.env.OXAPAY_PAYOUT_API_KEY || '';

// FRONTEND_URL can be a comma-separated list (CORS allowlist). For user-facing
// URLs (OxaPay return_url, etc.) we need a single canonical URL — take the
// first entry.
const frontendPublicUrl = (): string =>
  (process.env.FRONTEND_URL || 'https://ageof.money').split(',')[0].trim();
const backendPublicUrl = (): string =>
  (process.env.BACKEND_URL || 'https://api.ageof.money').split(',')[0].trim();

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Retry transient failures only (timeouts, 5xx, network errors).
// 4xx errors (bad request, invalid key) are surfaced immediately.
function isTransient(err: unknown): boolean {
  if (!axios.isAxiosError(err)) return false;
  if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET') return true;
  const status = err.response?.status;
  return !status || status >= 500;
}

async function withRetry<T>(fn: () => Promise<T>, label: string, maxAttempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts || !isTransient(err)) throw err;
      const backoff = Math.pow(2, attempt - 1) * 500; // 500ms, 1s, 2s
      logger.warn(`[${label}] transient error (attempt ${attempt}/${maxAttempts}), retry in ${backoff}ms`);
      await sleep(backoff);
    }
  }
  throw lastErr;
}

// Cloudflare in front of api.oxapay.com blocks requests with axios' default
// User-Agent ("axios/1.x.x") as bot traffic. Send a browser-style UA so the
// WAF lets us through. Also explicitly accept JSON.
const OXAPAY_HEADERS_BASE = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'User-Agent': 'Mozilla/5.0 (compatible; AgeOfMoney/1.0; +https://ageof.money)',
};

async function oxaPost(path: string, body: Record<string, unknown>) {
  return withRetry(async () => {
    // OxaPay v1 expects the API key in a `merchant_api_key` HTTP HEADER, not
    // in the JSON body. Putting it in the body triggers a silent 401/400 from
    // the API — the primary reason this integration was broken.
    // Reference: https://docs.oxapay.com/api-reference/payment/generate-invoice
    const res = await axios.post(`${OXAPAY_API}${path}`, body, {
      headers: {
        ...OXAPAY_HEADERS_BASE,
        'merchant_api_key': OXAPAY_KEY(),
      },
      timeout: 15000,
    });
    return res.data;
  }, `oxaPost ${path}`);
}

/**
 * Credit a deposit transaction that we've confirmed is "Paid" on OxaPay's
 * side. Used both by the webhook (real-time IPN) and by the admin sync
 * endpoint (poll-based recovery for deposits whose webhook was lost).
 *
 * Idempotent: if the transaction is already `completed`, this is a no-op.
 */
export async function creditPaidDeposit(transactionId: string): Promise<{ credited: boolean; coins?: number }> {
  const transaction = await prisma.transaction.findUnique({ where: { id: transactionId } });
  if (!transaction || transaction.status === 'completed') return { credited: false };

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

  logger.info(`[Deposit] Credited ${transaction.coins} coins to user ${transaction.userId} (tx ${transaction.id})`);

  // ── Affiliate referral tracking (same logic as webhook) ───────────────────
  if (transaction.affiliateCodeId) {
    try {
      const affCode = await prisma.affiliateCode.findUnique({ where: { id: transaction.affiliateCodeId } });
      if (affCode) {
        const depositedCoins = transaction.coins;
        const [referrer, referredUser] = await Promise.all([
          prisma.user.findUnique({ where: { id: affCode.userId }, select: { lastIpHash: true } }),
          prisma.user.findUnique({ where: { id: transaction.userId }, select: { lastIpHash: true } }),
        ]);
        const sameIp = referrer?.lastIpHash && referredUser?.lastIpHash && referrer.lastIpHash === referredUser.lastIpHash;
        const suspicious = !!sameIp;
        const suspiciousReason = sameIp ? 'Même IP que le parrain au moment du dépôt' : null;

        await prisma.affiliateReferral.upsert({
          where: { referredUserId: transaction.userId },
          update: {
            totalDeposited: { increment: depositedCoins },
            lastActiveAt:   new Date(),
            ...(suspicious ? { suspicious: true, suspiciousReason } : {}),
          },
          create: {
            affiliateCodeId: affCode.id,
            referredUserId:  transaction.userId,
            totalDeposited:  depositedCoins,
            isActive:        false,
            suspicious,
            suspiciousReason,
          },
        });

        const fresh = await prisma.affiliateCode.findUnique({ where: { id: affCode.id }, include: { referrals: true } });
        if (fresh) {
          const { computeTierRate } = await import('../services/affiliateService');
          const totalRefs = fresh.referrals.length;
          const totalDep  = fresh.referrals.reduce((s, r) => s + r.totalDeposited, 0);
          const newRate   = computeTierRate(totalRefs, totalDep);
          if (newRate !== fresh.commissionRate) {
            await prisma.affiliateCode.update({ where: { id: fresh.id }, data: { commissionRate: newRate } });
            logger.info(`[Affiliate] ${fresh.code} tier upgraded to ${(newRate * 100).toFixed(0)}%`);
          }
        }
      }
    } catch (err) { logger.error('[Affiliate] Referral tracking error:', err); }
  }

  return { credited: true, coins: transaction.coins };
}

/**
 * Query OxaPay for the current status of a single deposit (by track_id) and
 * apply DB updates if it has progressed. Returns the normalized status.
 * Used by the admin sync endpoint and the periodic cron.
 */
export async function syncOxaPayDepositStatus(transactionId: string): Promise<'unchanged' | 'paid' | 'expired' | 'failed' | 'no-track' | 'api-error'> {
  const tx = await prisma.transaction.findUnique({ where: { id: transactionId } });
  if (!tx || tx.type !== 'deposit' || tx.status !== 'pending') return 'unchanged';
  if (!tx.stripeSessionId) return 'no-track';

  try {
    const inquiry = await oxaPost('/payment/inquiry', { track_id: tx.stripeSessionId });
    // OxaPay v1 wraps the payload in `{ status: 200, data: { status, ... } }`.
    // The inner `status` is the payment state ("Paid"/"Waiting"/"Expired"/...)
    const paymentStatus = (inquiry?.data?.status ?? inquiry?.status ?? '').toString().toLowerCase();

    if (paymentStatus === 'paid') {
      await creditPaidDeposit(tx.id);
      return 'paid';
    }
    if (paymentStatus === 'expired') {
      await prisma.transaction.update({ where: { id: tx.id }, data: { status: 'failed' } });
      logger.info(`[OxaPaySync] Transaction ${tx.id} marked failed (expired)`);
      return 'expired';
    }
    if (paymentStatus === 'failed' || paymentStatus === 'cancelled') {
      await prisma.transaction.update({ where: { id: tx.id }, data: { status: 'failed' } });
      logger.info(`[OxaPaySync] Transaction ${tx.id} marked failed (${paymentStatus})`);
      return 'failed';
    }
    return 'unchanged';
  } catch (err) {
    logger.warn(`[OxaPaySync] Inquiry failed for tx ${tx.id}: ${(err as Error).message}`);
    return 'api-error';
  }
}

async function oxaPayout(body: Record<string, unknown>) {
  return withRetry(async () => {
    const res = await axios.post(`${OXAPAY_API}/payout`, body, {
      headers: {
        ...OXAPAY_HEADERS_BASE,
        'payout_api_key': OXAPAY_PAYOUT_KEY(),
      },
      timeout: 15000,
    });
    return res.data;
  }, 'oxaPayout');
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

    // Capture depositor's IP for self-referral detection later
    touchUserIp(userId, req.ip).catch(() => {});

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

      bonusMultiplier = 1 + AFFILIATE_DEPOSIT_BONUS_PCT / 100;
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
        // `to_currency` is an auto-convert field that requires the merchant
        // account to have conversion enabled for the target crypto. Sending
        // it for non-enabled currencies (BTC/ETH/LTC/etc.) returns
        // "invalid_to_currency". We don't need auto-conversion — we just
        // track the USD amount — so let the user pick the payment crypto
        // directly on OxaPay's hosted page.
        order_id:     transaction.id,
        description:  `AgeOfMoney — ${finalCoins} ⚜ coins (${CRYPTO_MAP[cryptoId].currency})`,
        callback_url: `${backendPublicUrl()}/api/v1/payments/crypto/webhook`,
        return_url:   `${frontendPublicUrl()}/deposit`,
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

// ── POST /payments/card/create — OxaPay white-label USDT + MoonPay redirect ─
// 1-click card flow: we create a white-label USDT/TRC20 invoice on OxaPay
// (returns a per-order receive address), then redirect the user to MoonPay's
// public buy widget with that address pre-filled. User pays CB on MoonPay,
// MoonPay settles USDT on the OxaPay address, OxaPay webhook (same as crypto)
// fires with order_id = transaction.id and credits the user.
router.post('/card/create', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { usdAmount, affiliateCode } = req.body;

    if (!usdAmount || usdAmount < MIN_DEPOSIT) {
      res.status(400).json({ error: `Montant minimum: $${MIN_DEPOSIT}` }); return;
    }

    touchUserIp(userId, req.ip).catch(() => {});

    // Affiliate validation — same logic as crypto/create
    let bonusMultiplier = 1;
    let affiliateCodeId: string | null = null;
    if (affiliateCode && typeof affiliateCode === 'string' && affiliateCode.trim().length > 0) {
      const aff = await prisma.affiliateCode.findUnique({ where: { code: affiliateCode.trim().toUpperCase() } });
      if (!aff) { res.status(400).json({ error: 'Code affilié invalide' }); return; }
      if (aff.userId === userId) { res.status(400).json({ error: 'Vous ne pouvez pas utiliser votre propre code' }); return; }
      const existingReferral = await prisma.affiliateReferral.findUnique({ where: { referredUserId: userId } });
      if (existingReferral) { res.status(400).json({ error: 'Vous avez déjà utilisé un code affilié' }); return; }
      bonusMultiplier = 1 + AFFILIATE_DEPOSIT_BONUS_PCT / 100;
      affiliateCodeId = aff.id;
    }

    const finalCoins = Math.floor(usdAmount * DEPOSIT_RATE * bonusMultiplier);

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

    try {
      // White-label invoice = returns a per-order USDT/TRC20 address directly
      // (no hosted page). Docs: /v1/payment/white-label
      const wlRes = await oxaPost('/payment/white-label', {
        amount:       usdAmount,
        currency:     'USD',
        pay_currency: 'USDT',
        network:      'TRC20',
        order_id:     transaction.id,
        description:  `AgeOfMoney — ${finalCoins} ⚜ coins (CB via MoonPay)`,
        callback_url: `${backendPublicUrl()}/api/v1/payments/crypto/webhook`,
        lifetime:     60,
      });

      if (wlRes.status !== 200 || !wlRes.data?.address) {
        throw new Error(wlRes.message || 'OxaPay white-label failed');
      }

      const { address, track_id, expired_at } = wlRes.data;

      await prisma.transaction.update({
        where: { id: transaction.id },
        data:  { stripeSessionId: String(track_id) },
      });

      // MoonPay public buy widget — no API key required for basic redirect.
      // `walletAddress` + `defaultCurrencyCode=usdt_trx` tells MoonPay to
      // settle USDT on Tron directly to our OxaPay address.
      const moonpayParams = new URLSearchParams({
        defaultCurrencyCode: 'usdt_trx',
        baseCurrencyCode:    'usd',
        baseCurrencyAmount:  usdAmount.toFixed(2),
        walletAddress:       address,
        colorCode:           '#ffc542',
        showWalletAddressForm: 'false',
      });
      const paymentUrl = `https://buy.moonpay.com/?${moonpayParams.toString()}`;

      res.json({
        paymentUrl,
        walletAddress: address,           // fallback: user copies address manually if MoonPay ignores the param
        trackId:       track_id,
        usdAmount,
        coins:         finalCoins,
        paymentId:     transaction.id,
        expiresAt:     expired_at ? new Date(expired_at * 1000).toISOString() : null,
      });
    } catch (oxaErr: unknown) {
      const errMsg = oxaErr instanceof Error ? oxaErr.message : String(oxaErr);
      const axiosData = (oxaErr as { response?: { data?: unknown } })?.response?.data;
      logger.error(`OxaPay white-label error: ${errMsg}`, { data: axiosData, apiKey: OXAPAY_KEY() ? 'SET' : 'EMPTY' });
      // Rollback the pending transaction on failure so it doesn't linger
      await prisma.transaction.update({
        where: { id: transaction.id },
        data:  { status: 'failed' },
      }).catch(() => {});
      res.status(500).json({ error: 'Erreur lors de la création du paiement carte. Réessayez.' });
    }
  } catch (error) {
    logger.error('POST /payments/card/create error:', error);
    res.status(500).json({ error: 'Erreur lors de la création du paiement' });
  }
});

// ── POST /payments/crypto/webhook — OxaPay callback (invoices + payouts) ────
router.post('/crypto/webhook', async (req: Request, res: Response): Promise<void> => {
  try {
    const hmacHeader = req.headers['hmac'] as string | undefined;
    if (!hmacHeader) {
      logger.warn('[Webhook] Missing HMAC header — rejecting');
      res.status(401).send('ok'); return;
    }

    const webhookType = req.body?.type as string | undefined;
    // Pick correct secret based on webhook type:
    // - invoice (deposit) → merchant API key
    // - payout (withdrawal) → payout API key
    const secret = webhookType === 'payout' ? OXAPAY_PAYOUT_KEY() : OXAPAY_KEY();
    if (!secret) {
      logger.error(`[Webhook] Missing secret for type=${webhookType}`);
      res.status(500).send('ok'); return;
    }

    // MUST use the raw request bytes — JSON.stringify(req.body) re-serializes
    // the parsed object with different whitespace / key ordering and will
    // never match OxaPay's signed payload. rawBody is captured by the
    // express.json({ verify }) middleware in index.ts.
    const rawBody = (req as Request & { rawBody?: string }).rawBody;
    if (!rawBody) {
      logger.error('[Webhook] rawBody missing — express.json verify middleware not configured');
      res.status(500).send('ok'); return;
    }
    const expected = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');

    // Constant-time comparison to defeat timing attacks.
    // timingSafeEqual throws on length mismatch, so bail out early
    // with a generic 401 (same response as valid-length-wrong-sig).
    const hmacBuf = Buffer.from(hmacHeader, 'hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    if (hmacBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(hmacBuf, expectedBuf)) {
      logger.warn(`[Webhook] Invalid HMAC signature (type=${webhookType}) — rejecting`);
      res.status(401).send('ok'); return;
    }

    // ── PAYOUT webhook (withdrawals) ───────────────────────────────────────
    if (webhookType === 'payout') {
      const { track_id, status: payoutStatus, description } = req.body;
      // description was set to the transaction.id when we called /payout
      const txId = typeof description === 'string' ? description : null;
      if (!txId) { res.status(200).send('ok'); return; }

      const transaction = await prisma.transaction.findUnique({ where: { id: txId } });
      if (!transaction) { res.status(200).send('ok'); return; }

      // OxaPay IPN sends capitalized values ("Confirmed"/"Failed") while its
      // REST API returns lowercase — normalize to lowercase for comparison.
      const normalizedStatus = typeof payoutStatus === 'string' ? payoutStatus.toLowerCase() : '';

      if (normalizedStatus === 'confirmed') {
        if (transaction.status !== 'completed') {
          await prisma.transaction.update({
            where: { id: transaction.id },
            data: { status: 'completed', stripeSessionId: String(track_id) },
          });
          logger.info(`[Payout] Confirmed withdrawal ${txId} (track=${track_id})`);
        }
      } else if (normalizedStatus === 'failed') {
        // Refund user's coins — payout failed on OxaPay side
        if (transaction.status === 'pending') {
          const refundCoins = Math.abs(transaction.coins);
          await prisma.$transaction([
            prisma.user.update({ where: { id: transaction.userId }, data: { coins: { increment: refundCoins } } }),
            prisma.transaction.update({ where: { id: transaction.id }, data: { status: 'failed' } }),
          ]);
          const io = getIo();
          const updatedUser = await prisma.user.findUnique({ where: { id: transaction.userId }, select: { coins: true } });
          if (io && updatedUser) {
            io.to(`user:${transaction.userId}`).emit('coinsUpdate', { coins: updatedUser.coins, direction: 'up' });
            io.to(`user:${transaction.userId}`).emit('notification', { type: 'withdrawal_failed', amount: refundCoins });
          }
          logger.warn(`[Payout] FAILED withdrawal ${txId} — refunded ${refundCoins} coins to user ${transaction.userId}`);
        }
      }
      // Confirming status → just log, no action needed yet
      res.status(200).send('ok'); return;
    }

    // ── INVOICE webhook (deposits) ─────────────────────────────────────────
    const { status, order_id } = req.body;

    // Normalize capitalization — OxaPay IPNs use "Paid" but we stay defensive.
    if (typeof status !== 'string' || status.toLowerCase() !== 'paid') {
      res.status(200).send('ok'); return;
    }

    if (typeof order_id !== 'string') { res.status(200).send('ok'); return; }
    await creditPaidDeposit(order_id);

    // OxaPay requires "ok" response
    res.status(200).send('ok');
  } catch (error) {
    logger.error('POST /payments/crypto/webhook error:', error);
    res.status(200).send('ok');
  }
});

// ── POST /payments/crypto/withdraw — Initiate withdrawal via OxaPay ──────────
router.post('/crypto/withdraw', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { cryptoId, coins, address } = req.body;

    // Only USDT TRC-20 is supported for now (stablecoin, 1:1 USD conversion)
    if (cryptoId !== 'usdt') {
      res.status(400).json({ error: 'Seul USDT (TRC-20) est supporté pour les retraits actuellement' }); return;
    }
    const coinsInt = Math.floor(Number(coins));
    if (!Number.isFinite(coinsInt) || coinsInt < MIN_WITHDRAW) {
      res.status(400).json({ error: `Minimum de retrait: ${MIN_WITHDRAW} ⚜ ($0.99)` }); return;
    }
    const MAX_WITHDRAW = 100_000;
    if (coinsInt > MAX_WITHDRAW) {
      res.status(400).json({ error: `Maximum de retrait: ${MAX_WITHDRAW} ⚜ par transaction` }); return;
    }
    // TRC-20 addresses start with T and are 34 characters
    if (!address || typeof address !== 'string' || !/^T[a-zA-Z0-9]{33}$/.test(address)) {
      res.status(400).json({ error: 'Adresse USDT TRC-20 invalide (doit commencer par T)' }); return;
    }

    const usdAmount = parseFloat((coinsInt * WITHDRAW_RATE).toFixed(2));

    // Atomic transaction: re-check balance + debit coins + create pending transaction
    const transaction = await prisma.$transaction(async (tx) => {
      const freshUser = await tx.user.findUnique({ where: { id: userId }, select: { coins: true } });
      if (!freshUser || freshUser.coins < coinsInt) {
        throw new Error('Solde insuffisant');
      }
      await tx.user.update({
        where: { id: userId },
        data:  { coins: { decrement: coinsInt } },
      });
      return tx.transaction.create({
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

    // Initiate payout via OxaPay
    try {
      const payoutRes = await oxaPayout({
        address,
        currency:     'USDT',
        // OxaPay accepts any value from the currency's `keys` array. For USDT
        // on Tron those are: "Tron", "TRC20", "TRX". "TRC-20" / "TRON" / "tron"
        // are NOT in the keys list — using them 400s.
        network:      'Tron',
        amount:       usdAmount, // USDT is stablecoin: 1 USDT ≈ 1 USD
        callback_url: `${backendPublicUrl()}/api/v1/payments/crypto/webhook`,
        description:  transaction.id, // we use this to find the tx in the webhook
      });

      if (payoutRes.status !== 200 || !payoutRes.data?.track_id) {
        throw new Error(payoutRes.message || 'OxaPay payout creation failed');
      }

      // Save track_id for later webhook matching
      await prisma.transaction.update({
        where: { id: transaction.id },
        data:  { stripeSessionId: String(payoutRes.data.track_id) },
      });

      logger.info(`[Withdraw] ${coinsInt} coins ($${usdAmount}) → ${address} | OxaPay track=${payoutRes.data.track_id}`);

      res.json({
        success:  true,
        usdAmount,
        currency: 'USDT',
        trackId:  payoutRes.data.track_id,
        message:  `Retrait de ${coinsInt} ⚜ initié. Vous recevrez ${usdAmount} USDT sous quelques minutes.`,
      });
    } catch (oxaErr: unknown) {
      // Refund user — payout request failed
      await prisma.$transaction([
        prisma.user.update({ where: { id: userId }, data: { coins: { increment: coinsInt } } }),
        prisma.transaction.update({ where: { id: transaction.id }, data: { status: 'failed' } }),
      ]);

      const errMsg = oxaErr instanceof Error ? oxaErr.message : String(oxaErr);
      const axiosData = (oxaErr as { response?: { data?: unknown } })?.response?.data;
      logger.error(`[Withdraw] OxaPay payout failed: ${errMsg}`, { data: axiosData });
      res.status(500).json({ error: 'Erreur lors de l\'initiation du retrait. Vos coins ont été remboursés.' });
    }
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
