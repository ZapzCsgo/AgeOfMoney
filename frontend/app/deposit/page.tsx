'use client';

import { useState, useMemo, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { ArrowDownToLine, ArrowUpFromLine, Check, Copy, AlertTriangle, RefreshCw, Zap, Shield, Clock, Gift } from 'lucide-react';
import Link from 'next/link';

async function handleSteamLogin(callbackPath = '/deposit') {
  try {
    const { csrfToken } = await fetch('/api/auth/csrf').then(r => r.json()) as { csrfToken: string };
    const form = document.createElement('form');
    form.method = 'POST'; form.action = '/api/auth/signin/steam';
    const i = document.createElement('input'); i.type = 'hidden'; i.name = 'csrfToken'; i.value = csrfToken;
    const c = document.createElement('input'); c.type = 'hidden'; c.name = 'callbackUrl'; c.value = window.location.origin + callbackPath;
    form.appendChild(i); form.appendChild(c); document.body.appendChild(form); form.submit();
  } catch { window.location.href = '/api/auth/signin/steam'; }
}

function SteamIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
      <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.003.187.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.029 4.524 4.524s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.718L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z"/>
    </svg>
  );
}

const COINS_PER_USD = 1.69;
const USD_TO_EUR    = 0.92;
const VALID_CODES: Record<string, number> = { EMPIRE: 5, AOE4BET: 10, VIP: 15 };

// Packages — pensés pour maximiser la valeur perçue

const CRYPTOS = [
  { id: 'btc',   symbol: 'BTC',  name: 'Bitcoin',  color: '#F7931A', network: 'Bitcoin'  },
  { id: 'eth',   symbol: 'ETH',  name: 'Ethereum', color: '#627EEA', network: 'ERC-20'   },
  { id: 'usdt',  symbol: 'USDT', name: 'Tether',   color: '#26A17B', network: 'TRC-20'   },
  { id: 'ltc',   symbol: 'LTC',  name: 'Litecoin', color: '#345D9D', network: 'Litecoin' },
  { id: 'sol',   symbol: 'SOL',  name: 'Solana',   color: '#9945FF', network: 'Solana'   },
  { id: 'xrp',   symbol: 'XRP',  name: 'XRP',      color: '#346AA9', network: 'XRP'      },
  { id: 'bnb',   symbol: 'BNB',  name: 'BNB',      color: '#F0B90B', network: 'BEP-20'   },
  { id: 'matic', symbol: 'MATIC',name: 'Polygon',  color: '#8247E5', network: 'Polygon'  },
];

// ── SVG logos crypto ──────────────────────────────────────────────────────────
function CryptoLogo({ id, size = 32 }: { id: string; size?: number }) {
  const s = size;
  switch (id) {
    case 'btc': return (
      <svg width={s} height={s} viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="16" fill="#F7931A"/><path d="M22.3 14.3c.3-2-1.2-3.1-3.3-3.8l.7-2.7-1.6-.4-.6 2.6-1.3-.3.6-2.6-1.6-.4-.7 2.7-1-.3v-.1l-2.2-.5-.4 1.7s1.2.3 1.2.3c.7.2.8.6.8.9l-2 7.9c-.1.2-.3.5-.8.4l-1.2-.3-.8 1.8 2.1.5h.4l-.7 2.7 1.6.4.7-2.7 1.3.3-.7 2.7 1.6.4.7-2.8c2.9.5 5 .3 5.9-2.3.7-2.1-.1-3.3-1.6-4.1 1.1-.3 2-.9 2.2-2.3zm-4 5.6c-.5 2-3.9.9-5 .6l.9-3.6c1.1.3 4.6.8 4.1 3zm.5-5.7c-.5 1.8-3.3.9-4.2.7l.8-3.2c.9.2 3.9.6 3.4 2.5z" fill="white"/></svg>
    );
    case 'eth': return (
      <svg width={s} height={s} viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="16" fill="#627EEA"/><path d="M16.498 4v8.87l7.497 3.35L16.498 4z" fill="white" fillOpacity=".6"/><path d="M16.498 4L9 16.22l7.498-3.35V4z" fill="white"/><path d="M16.498 21.968v6.027L24 17.616l-7.502 4.352z" fill="white" fillOpacity=".6"/><path d="M16.498 27.995v-6.028L9 17.616l7.498 10.379z" fill="white"/><path d="M16.498 20.573l7.497-4.352-7.497-3.348v7.7z" fill="white" fillOpacity=".2"/><path d="M9 16.22l7.498 4.353v-7.7L9 16.22z" fill="white" fillOpacity=".6"/></svg>
    );
    case 'usdt': return (
      <svg width={s} height={s} viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="16" fill="#26A17B"/><path d="M17.922 17.383v-.002c-.11.008-.677.042-1.942.042-1.01 0-1.721-.03-1.971-.042v.003c-3.888-.171-6.79-.848-6.79-1.666 0-.816 2.902-1.494 6.79-1.668v2.655c.254.018.982.061 1.988.061 1.207 0 1.812-.05 1.925-.06v-2.654c3.88.173 6.775.852 6.775 1.666 0 .814-2.895 1.492-6.775 1.665zm0-3.605V11.27h5.414V7.926H8.595v3.345h5.414v2.507c-4.4.202-7.709 1.074-7.709 2.126 0 1.053 3.309 1.924 7.709 2.126v7.6h3.913v-7.6c4.393-.202 7.694-1.072 7.694-2.124 0-1.051-3.301-1.923-7.694-2.125z" fill="white"/></svg>
    );
    case 'ltc': return (
      <svg width={s} height={s} viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="16" fill="#345D9D"/><path d="M16 4C9.373 4 4 9.373 4 16s5.373 12 12 12 12-5.373 12-12S22.627 4 16 4zm-1.27 17.5H9.5l1.58-5.94-1.83.5.42-1.56 1.84-.5 2.21-8.25h3.72l-1.5 5.6 1.82-.5-.41 1.56-1.82.5-1 3.64H19.9l-.88 4.5h-4.28z" fill="white"/></svg>
    );
    case 'sol': return (
      <svg width={s} height={s} viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="16" fill="#9945FF"/><path d="M9.17 20.49a.58.58 0 00.41.17h14.8a.58.58 0 00.41-.99l-2.49-2.49a.58.58 0 00-.41-.17H6.1a.58.58 0 00-.41.99l3.48 2.49zm0-6.99a.58.58 0 01.41-.17h14.8a.58.58 0 01.41.99l-2.49 2.49a.58.58 0 01-.41.17H6.1a.58.58 0 01-.41-.99l3.48-2.49zm14.8-4.83H9.17a.58.58 0 00-.41.99l2.49 2.49a.58.58 0 00.41.17h14.8a.58.58 0 00.41-.99l-2.49-2.49a.58.58 0 00-.41-.17z" fill="url(#sg)"/><defs><linearGradient id="sg" x1="5.69" y1="21.47" x2="26.31" y2="10.53" gradientUnits="userSpaceOnUse"><stop stopColor="#9945FF"/><stop offset=".42" stopColor="#6377D6"/><stop offset="1" stopColor="#00D18C"/></linearGradient></defs></svg>
    );
    case 'xrp': return (
      <svg width={s} height={s} viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="16" fill="#346AA9"/><path d="M22.5 7h2.7l-5.88 5.88a4.73 4.73 0 01-6.64 0L6.8 7h2.7l4.54 4.54a2.94 2.94 0 004.14 0L22.5 7zm-13.2 18h-2.7l5.9-5.9a4.73 4.73 0 016.6 0L24.7 25H22l-4.54-4.54a2.94 2.94 0 00-4.14 0L9.3 25z" fill="white"/></svg>
    );
    case 'bnb': return (
      <svg width={s} height={s} viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="16" fill="#F0B90B"/><path d="M12.116 14.404L16 10.52l3.886 3.886 2.26-2.26L16 6l-6.144 6.144 2.26 2.26zM6 16l2.26-2.26L10.52 16l-2.26 2.26L6 16zm6.116 1.596L16 21.48l3.886-3.886 2.26 2.259L16 26l-6.144-6.144-.002-.003 2.262-2.257zm9.364-1.596l2.26-2.26L26 16l-2.26 2.26-2.26-2.26zm-3.096.002l-2.384-2.382-1.76 1.76-.201.201-.404.404.405.404L16 17.974l2.384-2.382v.41z" fill="white"/></svg>
    );
    case 'matic': return (
      <svg width={s} height={s} viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="16" fill="#8247E5"/><path d="M20.31 13.09c-.38-.22-.87-.22-1.29 0l-3 1.74-2.04 1.13-3 1.74c-.38.22-.87.22-1.29 0l-2.37-1.37c-.38-.22-.64-.65-.64-1.08v-2.7c0-.43.22-.87.64-1.08l2.37-1.37c.38-.22.87-.22 1.29 0l2.37 1.37c.38.22.64.65.64 1.08v1.74l2.04-1.19v-1.74c0-.43-.22-.87-.64-1.08L12.07 8.2c-.38-.22-.87-.22-1.29 0L7.03 10.3c-.38.22-.64.65-.64 1.08v4.35c0 .43.22.87.64 1.08l3.75 2.16c.38.22.87.22 1.29 0l3-1.74 2.04-1.13 3-1.74c.38-.22.87-.22 1.29 0l2.37 1.37c.38.22.64.65.64 1.08v2.7c0 .43-.22.87-.64 1.08l-2.37 1.37c-.38.22-.87.22-1.29 0l-2.37-1.37c-.38-.22-.64-.65-.64-1.08v-1.74l-2.04 1.19v1.74c0 .43.22.87.64 1.08l3.75 2.16c.38.22.87.22 1.29 0l3.75-2.16c.38-.22.64-.65.64-1.08v-4.35c0-.43-.22-.87-.64-1.08l-3.79-2.22z" fill="white"/></svg>
    );
    default: return <div style={{ width: s, height: s, borderRadius: '50%', background: '#2a2a3a' }} />;
  }
}

function CopyBtn({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="p-2 rounded-lg transition-all hover:bg-white/10 shrink-0">
      {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} className="text-aoe-parchment-dim" />}
    </button>
  );
}

interface Invoice {
  address: string;
  cryptoAmount: string;
  coins: number;
  crypto: string;
  usdAmount: number;
  expiresAt: string;
  devMode?: boolean;
}

export default function DepositPage() {
  const { data: session } = useSession();
  const { t } = useT();

  const [customCoins, setCustomCoins]          = useState('9');
  const [selectedCrypto, setCrypto]            = useState<typeof CRYPTOS[0]>(CRYPTOS[0]);
  const [promoCode, setPromoCode]              = useState('');
  const [promoApplied, setPromoApplied]        = useState(false);
  const [promoError, setPromoError]            = useState('');

  // Load saved affiliate code from localStorage (valid 15 days)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('affiliateCode');
      const expiry = localStorage.getItem('affiliateCodeExpiry');
      if (saved && expiry && Date.now() < parseInt(expiry)) {
        setPromoCode(saved);
        setPromoApplied(true);
      } else {
        localStorage.removeItem('affiliateCode');
        localStorage.removeItem('affiliateCodeExpiry');
      }
    } catch {}
  }, []);
  const [invoice, setInvoice]                  = useState<Invoice | null>(null);
  const [loading, setLoading]                  = useState(false);
  const [error, setError]                      = useState<string | null>(null);

  const baseCoins  = parseInt(customCoins) || 0;
  const bonusPct   = promoApplied ? (VALID_CODES[promoCode.toUpperCase()] ?? 0) : 0;
  const bonusCoins = Math.floor(baseCoins * bonusPct / 100);
  const totalCoins = baseCoins + bonusCoins;
  const usdCost    = useMemo(() => baseCoins > 0 ? (baseCoins / COINS_PER_USD) : 0, [baseCoins]);
  const eurCost    = useMemo(() => usdCost * USD_TO_EUR, [usdCost]);

  const applyPromo = () => {
    const code = promoCode.trim().toUpperCase();
    if (!code) { setPromoError(t('common_error')); return; }
    if (VALID_CODES[code]) {
      setPromoApplied(true);
      setPromoError('');
      // Save affiliate code for 15 days
      try {
        localStorage.setItem('affiliateCode', code);
        localStorage.setItem('affiliateCodeExpiry', String(Date.now() + 15 * 24 * 60 * 60 * 1000));
      } catch {}
    } else {
      setPromoError(t('common_error'));
      setPromoApplied(false);
    }
  };

  const handleDeposit = async () => {
    if (!session) { handleSteamLogin(); return; }
    if (!baseCoins || baseCoins < 1) { setError(t('deposit_select_crypto')); return; }
    if (usdCost < 3) { setError(t('deposit_min') + ' $3.00 (≈ 5 ⚜)'); return; }
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/payments/crypto/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cryptoId: selectedCrypto.id,
          usdAmount: parseFloat(usdCost.toFixed(2)),
          coins: totalCoins,
          affiliateCode: promoApplied ? promoCode.toUpperCase() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('common_error'));
      // OxaPay returns a payment URL — redirect user to hosted payment page
      if (data.paymentUrl) {
        window.open(data.paymentUrl, '_blank');
        setInvoice({ address: data.paymentUrl, cryptoAmount: '', coins: data.coins, crypto: selectedCrypto.symbol, usdAmount: data.usdAmount, expiresAt: data.expiresAt });
      } else {
        setInvoice({ ...data, crypto: selectedCrypto.symbol });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common_error'));
    } finally {
      setLoading(false);
    }
  };

  // ── Invoice ─────────────────────────────────────────────────────────────────
  if (invoice) {
    const crypto = CRYPTOS.find(c => c.symbol === invoice.crypto);
    return (
      <div className="max-w-lg mx-auto px-4 py-12">
        <div className="rounded-2xl border overflow-hidden" style={{ background: '#0d0b1a', borderColor: '#2d2850' }}>
          <div className="h-px" style={{ background: 'linear-gradient(90deg,transparent,#d4a017 30%,#f5c842 50%,#d4a017 70%,transparent)' }} />
          <div className="p-7 space-y-5">
            <div className="flex items-center gap-4">
              {crypto && <CryptoLogo id={crypto.id} size={48} />}
              <div>
                <h2 className="font-cinzel font-bold text-lg text-aoe-parchment">{t('common_pending')}</h2>
                <p className="text-aoe-parchment-dim text-sm">Envoyez exactement{' '}
                  <span className="font-bold" style={{ color: crypto?.color }}>{invoice.cryptoAmount} {invoice.crypto}</span>
                </p>
              </div>
            </div>
            <div className="rounded-xl p-5 text-center" style={{ background: 'rgba(212,160,23,0.07)', border: '1px solid rgba(212,160,23,0.2)' }}>
              <p className="text-aoe-parchment-dim text-[10px] mb-1 font-cinzel tracking-wider uppercase">{t('deposit_amount_coins')}</p>
              <p className="font-cinzel font-black text-4xl text-aoe-gold">{invoice.coins.toLocaleString('fr-FR')} ⚜</p>
              {bonusPct > 0 && <p className="text-emerald-400 text-xs mt-1">dont +{bonusPct}% bonus</p>}
            </div>
            <div>
              <p className="text-[10px] font-cinzel tracking-widest text-aoe-parchment-dim uppercase mb-2">{t('deposit_address')} {invoice.crypto}</p>
              <div className="flex items-center gap-2 p-3 rounded-xl" style={{ background: '#07060f', border: '1px solid #1e1a30' }}>
                <code className="text-aoe-parchment text-xs flex-1 break-all font-mono leading-relaxed">{invoice.address}</code>
                <CopyBtn value={invoice.address} />
              </div>
            </div>
            <div>
              <p className="text-[10px] font-cinzel tracking-widest text-aoe-parchment-dim uppercase mb-2">{t('deposit_amount_coins')}</p>
              <div className="flex items-center gap-2 p-3 rounded-xl" style={{ background: '#07060f', border: '1px solid #1e1a30' }}>
                <code className="font-bold font-mono flex-1 text-sm" style={{ color: crypto?.color }}>{invoice.cryptoAmount} {invoice.crypto}</code>
                <CopyBtn value={invoice.cryptoAmount} />
              </div>
              {invoice.devMode && <p className="text-[10px] text-yellow-500 mt-1">⚠ Mode dev — configurez NOWPAYMENTS_API_KEY</p>}
            </div>
            <div className="flex items-start gap-2 p-3 rounded-xl text-xs" style={{ background: 'rgba(231,76,60,0.07)', border: '1px solid rgba(231,76,60,0.2)' }}>
              <AlertTriangle size={13} className="text-red-400 shrink-0 mt-0.5" />
              <p className="text-aoe-parchment-dim leading-relaxed">{t('deposit_send_note')}</p>
            </div>
            <button onClick={() => setInvoice(null)} className="w-full py-2.5 rounded-xl text-sm font-cinzel text-aoe-parchment-dim hover:text-aoe-parchment border border-aoe-border hover:border-aoe-border-mid transition-colors">
              ← {t('deposit_back')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Not logged in ─────────────────────────────────────────────────────────────
  if (!session) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center">
        <div className="rounded-2xl border overflow-hidden p-10" style={{ background: '#0d0b1a', borderColor: '#2d2850' }}>
          <div className="h-px mb-8" style={{ background: 'linear-gradient(90deg,transparent,#d4a017 30%,#f5c842 50%,#d4a017 70%,transparent)' }} />
          <div className="w-14 h-14 rounded-full mx-auto mb-5 flex items-center justify-center" style={{ background: 'rgba(212,160,23,0.1)', border: '1px solid rgba(212,160,23,0.3)' }}>
            <ArrowDownToLine size={24} className="text-aoe-gold" />
          </div>
          <h2 className="font-cinzel font-bold text-xl text-aoe-gold mb-2 tracking-wider">{t('auth_required').toUpperCase()}</h2>
          <p className="text-aoe-parchment-muted text-sm mb-8 leading-relaxed">
            {t('auth_signin_steam')}
          </p>
          <button
            onClick={() => handleSteamLogin('/deposit')}
            className="w-full flex items-center justify-center gap-3 py-4 rounded-xl font-bold text-base transition-all hover:brightness-110 active:scale-[0.99]"
            style={{ background: 'linear-gradient(135deg, #2a475e, #1b2838)', border: '1px solid #4c6b8a', color: 'white' }}
          >
            <SteamIcon />
            {t('auth_signin_steam')}
          </button>
          <p className="text-aoe-parchment-muted text-xs mt-4">
            {t('deposit_tagline')}
          </p>
        </div>
      </div>
    );
  }

  // ── Main ─────────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto px-4 py-4">

      {/* Tabs */}
      <div className="flex mb-4 border-b" style={{ borderColor: '#1e1a30' }}>
        <div
          className="flex-1 flex items-center justify-center gap-2 py-3 font-cinzel font-bold text-[12px] tracking-[0.18em] uppercase cursor-default text-[#d4a017] relative"
        >
          <ArrowDownToLine size={13} />
          {t('deposit_tab')}
          <span className="absolute left-0 right-0 -bottom-px h-[2px] bg-[#d4a017]" />
        </div>
        <Link
          href="/withdraw"
          className="flex-1 flex items-center justify-center gap-2 py-3 font-cinzel font-bold text-[12px] tracking-[0.18em] uppercase text-[#6b6488] hover:text-[#e8e2f5] transition-colors"
        >
          <ArrowUpFromLine size={13} />
          {t('withdraw_tab')}
        </Link>
      </div>

      {/* Hero + exchange widget combined */}
      <div className="text-center mb-3">
        <h1 className="font-cinzel font-black text-2xl text-aoe-gold tracking-wider mb-1">{t('deposit_title')}</h1>
        <p className="text-aoe-parchment-muted text-xs">
          <span className="text-aoe-gold font-bold">$1 = 1.69 ⚜</span> <span className="text-aoe-parchment-muted">({t('deposit_credited_fast')})</span>
        </p>
      </div>

      <div className="rounded-xl p-3 mb-4 flex items-center justify-between gap-3" style={{ background: 'linear-gradient(135deg, rgba(212,160,23,0.08), rgba(212,160,23,0.04))', border: '1px solid rgba(212,160,23,0.25)' }}>
        <div className="text-center flex-1">
          <p className="text-aoe-parchment-muted text-[10px] font-cinzel tracking-wider uppercase mb-1">{t('deposit_amount_coins')}</p>
          <p className="font-cinzel font-black text-2xl text-aoe-gold">
            {totalCoins > 0 ? `${totalCoins.toLocaleString('fr-FR')} ⚜` : '— ⚜'}
          </p>
          {bonusCoins > 0 && (
            <p className="text-emerald-400 text-[10px] mt-0.5">dont +{bonusCoins.toLocaleString('fr-FR')} ⚜ offerts</p>
          )}
        </div>
        <div className="text-aoe-parchment-muted text-xl font-light">=</div>
        <div className="text-center flex-1">
          <p className="text-aoe-parchment-muted text-[10px] font-cinzel tracking-wider uppercase mb-1">{t('withdraw_usd')}</p>
          <p className="font-cinzel font-black text-2xl text-aoe-parchment">
            {usdCost > 0 ? `$${usdCost.toFixed(2)}` : '$0.00'}
          </p>
          <p className="text-aoe-parchment-muted text-[10px] mt-0.5">
            {eurCost > 0 ? `≈ €${eurCost.toFixed(2)}` : ''}
          </p>
        </div>
        {promoApplied && (
          <>
            <div className="text-aoe-parchment-muted text-xl font-light">+</div>
            <div className="text-center flex-1 rounded-lg p-2" style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)' }}>
              <p className="text-emerald-400 text-[10px] font-cinzel tracking-wider uppercase mb-1">{t('roulette_bet')}</p>
              <p className="font-cinzel font-black text-xl text-emerald-400">+{bonusPct}%</p>
              <p className="text-emerald-400/60 text-[9px] mt-0.5">{promoCode.toUpperCase()}</p>
            </div>
          </>
        )}
      </div>

      <div className="rounded-2xl border overflow-hidden" style={{ background: '#0d0b1a', borderColor: '#2d2850' }}>
        <div className="h-px" style={{ background: 'linear-gradient(90deg,transparent,#d4a017 30%,#f5c842 50%,#d4a017 70%,transparent)' }} />

        <div className="p-4 space-y-4">

          {/* COIN AMOUNT INPUT */}
          <div>
            <p className="text-[10px] font-cinzel tracking-widest text-aoe-parchment-dim uppercase mb-2">{t('deposit_amount_coins')}</p>
            <div className="relative">
              <input
                type="text" inputMode="numeric"
                value={customCoins}
                onChange={e => setCustomCoins(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder=""
                className="w-full border rounded-xl px-4 py-3 text-aoe-parchment text-lg font-cinzel font-bold placeholder-aoe-parchment-muted/40 outline-none transition-colors pr-16"
                style={{ background: 'rgba(255,255,255,0.04)', borderColor: customCoins ? '#d4a017' : '#1e1a30' }}
                autoFocus
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-aoe-gold text-xl font-bold">⚜</span>
            </div>
            <p className="text-[10px] mt-1.5 text-right" style={{ color: baseCoins > 0 && usdCost < 5 ? '#f87171' : '#3d3860' }}>
              {baseCoins > 0 && usdCost < 5
                ? `${t('deposit_min')} $5.00 — ${(5 - usdCost).toFixed(2)}$`
                : `${t('deposit_min')} $5.00`}
            </p>
            {baseCoins > 0 && usdCost >= 5 && (
              <p className="text-aoe-parchment-muted text-xs mt-1 text-right">
                = <span className="text-aoe-parchment font-semibold">${usdCost.toFixed(2)}</span>
                <span className="mx-1 opacity-40">·</span>
                <span className="opacity-70">≈ €{eurCost.toFixed(2)}</span>
              </p>
            )}
          </div>

          {/* PAYMENT METHOD */}
          <div>
            <p className="text-[10px] font-cinzel tracking-widest text-aoe-parchment-dim uppercase mb-2">{t('deposit_select_crypto')}</p>
            <div className="grid grid-cols-4 gap-1.5">
              {CRYPTOS.map(c => {
                const active = selectedCrypto.id === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => setCrypto(c)}
                    className={cn(
                      'relative flex flex-col items-center gap-1 py-2 px-1 rounded-lg border transition-all',
                      active ? 'scale-[1.03]' : 'hover:border-aoe-border-mid'
                    )}
                    style={{
                      background: active ? `${c.color}14` : 'rgba(255,255,255,0.025)',
                      borderColor: active ? c.color : '#1e1a30',
                      boxShadow: active ? `0 0 16px ${c.color}20` : 'none',
                    }}
                  >
                    {active && (
                      <div className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center" style={{ background: c.color }}>
                        <Check size={8} color="#000" strokeWidth={3} />
                      </div>
                    )}
                    <CryptoLogo id={c.id} size={28} />
                    <span className="font-cinzel font-bold text-[11px]" style={{ color: active ? c.color : '#e8e2f5' }}>{c.symbol}</span>
                    <span className="text-[9px] text-aoe-parchment-muted">{c.network}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* PROMO CODE */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Gift size={12} className="text-aoe-parchment-dim" />
              <p className="text-[10px] font-cinzel tracking-widest text-aoe-parchment-dim uppercase">
                {t('deposit_affiliate_code')} <span className="text-aoe-parchment-muted normal-case font-sans tracking-normal">{t('deposit_affiliate_optional')}</span>
              </p>
            </div>
            {!promoApplied ? (
              <div className="flex gap-2">
                <input
                  type="text" value={promoCode}
                  onChange={e => { setPromoCode(e.target.value); setPromoApplied(false); setPromoError(''); }}
                  placeholder={t('chat_promo_placeholder')}
                  className="flex-1 bg-aoe-stone/50 border border-aoe-border rounded-sm px-4 py-2.5 text-aoe-parchment placeholder-aoe-parchment-muted outline-none focus:border-aoe-border-gold transition-colors uppercase tracking-widest font-cinzel text-sm h-10"
                  maxLength={20}
                  onKeyDown={e => { if (e.key === 'Enter') applyPromo(); }}
                />
                <button
                  onClick={applyPromo}
                  className="px-5 h-10 rounded-sm text-[11px] font-cinzel font-black tracking-[0.15em] uppercase shrink-0 transition-colors border-2 border-[#d4a017] bg-transparent text-[#d4a017] hover:bg-[#d4a017]/15"
                >
                  {t('deposit_promo_apply')}
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between p-3 rounded-xl" style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.25)' }}>
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    <Check size={11} className="text-emerald-400" />
                  </div>
                  <span className="text-emerald-400 text-sm font-cinzel font-bold">{promoCode.toUpperCase()}</span>
                  <span className="text-emerald-400/70 text-xs">{t('deposit_bonus_applied', { pct: VALID_CODES[promoCode.toUpperCase()] })}</span>
                </div>
                <button onClick={() => {
                  setPromoApplied(false);
                  setPromoCode('');
                  try { localStorage.removeItem('affiliateCode'); localStorage.removeItem('affiliateCodeExpiry'); } catch {}
                }} className="text-aoe-parchment-muted text-xs hover:text-red-400 transition-colors">✕</button>
              </div>
            )}
            {promoError && <p className="text-red-400 text-xs mt-1.5">{promoError}</p>}
          </div>

          {/* ERROR */}
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-xl text-xs" style={{ background: 'rgba(231,76,60,0.08)', border: '1px solid rgba(231,76,60,0.25)' }}>
              <AlertTriangle size={12} className="text-red-400 shrink-0" />
              <span className="text-red-400">{error}</span>
            </div>
          )}

          {/* CTA — minimal solid button, no decoration */}
          <div className="pt-2 border-t" style={{ borderColor: '#1e1a30' }}>
            <button
              onClick={handleDeposit}
              disabled={loading}
              className="w-full py-3.5 rounded-md font-medium text-sm flex items-center justify-center gap-2 transition-colors bg-[#d4a017] text-black hover:bg-[#e0ad1f] disabled:opacity-50 disabled:hover:bg-[#d4a017]"
            >
              {loading
                ? <><RefreshCw size={15} className="animate-spin" /> {t('common_processing')}</>
                : !session
                  ? `${t('auth_signin_steam')} →`
                  : baseCoins < 1
                    ? t('deposit_select_crypto')
                    : <>
                        <ArrowDownToLine size={14} />
                        {t('deposit_get_coins', { coins: totalCoins.toLocaleString('fr-FR'), amount: usdCost.toFixed(2) })}
                      </>
              }
            </button>

            {/* Trust row */}
            <div className="flex items-center justify-center gap-6 mt-4">
              <div className="flex items-center gap-1.5 text-aoe-parchment-muted">
                <Zap size={11} className="text-aoe-gold" />
                <span className="text-[10px] font-cinzel tracking-wide">{t('deposit_instant')}</span>
              </div>
              <div className="flex items-center gap-1.5 text-aoe-parchment-muted">
                <Shield size={11} className="text-aoe-gold" />
                <span className="text-[10px] font-cinzel tracking-wide">{t('deposit_secure')}</span>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
