'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useT } from '@/lib/i18n';
import { cn, formatCoins } from '@/lib/utils';
import { ArrowUpFromLine, ArrowDownToLine, Check, AlertTriangle, Wallet, Info } from 'lucide-react';
import Link from 'next/link';
import { apiClient, setAuthToken } from '@/lib/api';

function SteamIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
      <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.003.187.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.029 4.524 4.524s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.718L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z"/>
    </svg>
  );
}

const COINS_PER_USD = 1.69;
const PAYOUT_RATE   = 0.99; // 1.69⚜ = $0.99
const USD_TO_EUR    = 0.92;

const PRESETS = [500, 1000, 2500, 5000, 10000, 25000];

const CRYPTOS = [
  { id: 'btc',  label: 'Bitcoin',  symbol: 'BTC',  color: '#F7931A', minUsd: 20 },
  { id: 'eth',  label: 'Ethereum', symbol: 'ETH',  color: '#627EEA', minUsd: 10 },
  { id: 'usdt', label: 'Tether',   symbol: 'USDT', color: '#26A17B', minUsd: 5  },
  { id: 'ltc',  label: 'Litecoin', symbol: 'LTC',  color: '#345D9D', minUsd: 5  },
  { id: 'sol',  label: 'Solana',   symbol: 'SOL',  color: '#9945FF', minUsd: 5  },
  { id: 'xrp',  label: 'Ripple',   symbol: 'XRP',  color: '#346AA9', minUsd: 5  },
  { id: 'bnb',  label: 'BNB',      symbol: 'BNB',  color: '#F0B90B', minUsd: 5  },
  { id: 'matic',label: 'Polygon',  symbol: 'MATIC',color: '#8247E5', minUsd: 5  },
];

function CryptoLogo({ id, size = 32 }: { id: string; size?: number }) {
  const s = size;
  switch (id) {
    case 'btc': return (
      <svg width={s} height={s} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="16" cy="16" r="16" fill="#F7931A"/>
        <path d="M22.3 14.3c.3-2-1.2-3.1-3.3-3.8l.7-2.7-1.6-.4-.6 2.6-1.3-.3.6-2.6-1.6-.4-.7 2.7-1-.3v-.1l-2.2-.5-.4 1.7s1.2.3 1.2.3c.7.2.8.6.8.9l-2 7.9c-.1.2-.3.5-.8.4l-1.2-.3-.8 1.8 2.1.5h.4l-.7 2.7 1.6.4.7-2.7 1.3.3-.7 2.7 1.6.4.7-2.8c2.9.5 5 .3 5.9-2.3.7-2.1-.1-3.3-1.6-4.1 1.1-.3 2-.9 2.2-2.3zm-4 5.6c-.5 2-3.9.9-5 .6l.9-3.6c1.1.3 4.6.8 4.1 3zm.5-5.7c-.5 1.8-3.3.9-4.2.7l.8-3.2c.9.2 3.9.6 3.4 2.5z" fill="white"/>
      </svg>
    );
    case 'eth': return (
      <svg width={s} height={s} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="16" cy="16" r="16" fill="#627EEA"/>
        <path d="M16.498 4v8.87l7.497 3.35L16.498 4z" fill="white" fillOpacity=".6"/>
        <path d="M16.498 4L9 16.22l7.498-3.35V4z" fill="white"/>
        <path d="M16.498 21.968v6.027L24 17.616l-7.502 4.352z" fill="white" fillOpacity=".6"/>
        <path d="M16.498 27.995v-6.028L9 17.616l7.498 10.379z" fill="white"/>
        <path d="M16.498 20.573l7.497-4.352-7.497-3.348v7.7z" fill="white" fillOpacity=".2"/>
        <path d="M9 16.22l7.498 4.353v-7.7L9 16.22z" fill="white" fillOpacity=".6"/>
      </svg>
    );
    case 'usdt': return (
      <svg width={s} height={s} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="16" cy="16" r="16" fill="#26A17B"/>
        <path d="M17.922 17.383v-.002c-.11.008-.677.042-1.942.042-1.01 0-1.721-.03-1.971-.042v.003c-3.888-.171-6.79-.848-6.79-1.666 0-.816 2.902-1.494 6.79-1.668v2.655c.254.018.982.061 1.988.061 1.207 0 1.812-.05 1.925-.06v-2.654c3.88.173 6.775.852 6.775 1.666 0 .814-2.895 1.492-6.775 1.665zm0-3.605V11.27h5.414V7.926H8.595v3.345h5.414v2.507c-4.4.202-7.709 1.074-7.709 2.126 0 1.053 3.309 1.924 7.709 2.126v7.6h3.913v-7.6c4.393-.202 7.694-1.072 7.694-2.124 0-1.051-3.301-1.923-7.694-2.125z" fill="white"/>
      </svg>
    );
    case 'ltc': return (
      <svg width={s} height={s} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="16" cy="16" r="16" fill="#345D9D"/>
        <path d="M16 4C9.373 4 4 9.373 4 16s5.373 12 12 12 12-5.373 12-12S22.627 4 16 4zm-1.27 17.5H9.5l1.58-5.94-1.83.5.42-1.56 1.84-.5 2.21-8.25h3.72l-1.5 5.6 1.82-.5-.41 1.56-1.82.5-1 3.64H19.9l-.88 4.5h-4.28z" fill="white"/>
      </svg>
    );
    case 'sol': return (
      <svg width={s} height={s} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="16" cy="16" r="16" fill="#9945FF"/>
        <path d="M9.17 20.49a.58.58 0 00.41.17h14.8a.58.58 0 00.41-.99l-2.49-2.49a.58.58 0 00-.41-.17H6.1a.58.58 0 00-.41.99l3.48 2.49zm0-6.99a.58.58 0 01.41-.17h14.8a.58.58 0 01.41.99l-2.49 2.49a.58.58 0 01-.41.17H6.1a.58.58 0 01-.41-.99l3.48-2.49zm14.8-4.83H9.17a.58.58 0 00-.41.99l2.49 2.49a.58.58 0 00.41.17h14.8a.58.58 0 00.41-.99l-2.49-2.49a.58.58 0 00-.41-.17z" fill="url(#sol-grad-w)"/>
        <defs>
          <linearGradient id="sol-grad-w" x1="5.69" y1="21.47" x2="26.31" y2="10.53" gradientUnits="userSpaceOnUse">
            <stop stopColor="#9945FF"/><stop offset=".14" stopColor="#8A53F4"/><stop offset=".42" stopColor="#6377D6"/><stop offset=".72" stopColor="#45A0BB"/><stop offset=".87" stopColor="#36B4AD"/><stop offset="1" stopColor="#00D18C"/>
          </linearGradient>
        </defs>
      </svg>
    );
    case 'xrp': return (
      <svg width={s} height={s} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="16" cy="16" r="16" fill="#346AA9"/>
        <path d="M22.5 7h2.7l-5.88 5.88a4.73 4.73 0 01-6.64 0L6.8 7h2.7l4.54 4.54a2.94 2.94 0 004.14 0L22.5 7zm-13.2 18h-2.7l5.9-5.9a4.73 4.73 0 016.6 0L24.7 25H22l-4.54-4.54a2.94 2.94 0 00-4.14 0L9.3 25z" fill="white"/>
      </svg>
    );
    case 'bnb': return (
      <svg width={s} height={s} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="16" cy="16" r="16" fill="#F0B90B"/>
        <path d="M12.116 14.404L16 10.52l3.886 3.886 2.26-2.26L16 6l-6.144 6.144 2.26 2.26zM6 16l2.26-2.26L10.52 16l-2.26 2.26L6 16zm6.116 1.596L16 21.48l3.886-3.886 2.26 2.259L16 26l-6.144-6.144-.002-.003 2.262-2.257zm9.364-1.596l2.26-2.26L26 16l-2.26 2.26-2.26-2.26zm-3.096.002l-2.384-2.382-1.76 1.76-.201.201-.404.404.405.404L16 17.974l2.384-2.382v.41z" fill="white"/>
      </svg>
    );
    case 'matic': return (
      <svg width={s} height={s} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="16" cy="16" r="16" fill="#8247E5"/>
        <path d="M20.31 13.09c-.38-.22-.87-.22-1.29 0l-3 1.74-2.04 1.13-3 1.74c-.38.22-.87.22-1.29 0l-2.37-1.37c-.38-.22-.64-.65-.64-1.08v-2.7c0-.43.22-.87.64-1.08l2.37-1.37c.38-.22.87-.22 1.29 0l2.37 1.37c.38.22.64.65.64 1.08v1.74l2.04-1.19v-1.74c0-.43-.22-.87-.64-1.08L12.07 8.2c-.38-.22-.87-.22-1.29 0L7.03 10.3c-.38.22-.64.65-.64 1.08v4.35c0 .43.22.87.64 1.08l3.75 2.16c.38.22.87.22 1.29 0l3-1.74 2.04-1.13 3-1.74c.38-.22.87-.22 1.29 0l2.37 1.37c.38.22.64.65.64 1.08v2.7c0 .43-.22.87-.64 1.08l-2.37 1.37c-.38.22-.87.22-1.29 0l-2.37-1.37c-.38-.22-.64-.65-.64-1.08v-1.74l-2.04 1.19v1.74c0 .43.22.87.64 1.08l3.75 2.16c.38.22.87.22 1.29 0l3.75-2.16c.38-.22.64-.65.64-1.08v-4.35c0-.43-.22-.87-.64-1.08l-3.79-2.22z" fill="white"/>
      </svg>
    );
    default: return (
      <div className="rounded-full flex items-center justify-center text-white font-bold text-xs"
           style={{ width: s, height: s, background: 'rgba(255,255,255,0.1)' }}>?</div>
    );
  }
}

type Step = 'form' | 'confirm' | '2fa' | 'success';

export default function WithdrawPage() {
  const { data: session } = useSession();
  const { t } = useT();
  const [selectedCrypto, setSelectedCrypto] = useState('usdt');
  const [coinsAmount, setCoinsAmount] = useState('');
  const [walletAddress, setWalletAddress] = useState('');
  const [step, setStep] = useState<Step>('form');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [txId, setTxId] = useState('');
  const [twoFaCode, setTwoFaCode] = useState('');
  const [twoFaError, setTwoFaError] = useState('');
  const [totpEnabled, setTotpEnabled] = useState(false);

  useEffect(() => {
    if (!session?.user?.accessToken) return;
    setAuthToken(session.user.accessToken);
    apiClient.get('/users/me').then(res => {
      if (res.data?.data?.totpEnabled) setTotpEnabled(true);
    }).catch(() => {});
  }, [session]);

  const coins = parseInt(coinsAmount) || 0;
  const usdValue = (coins / COINS_PER_USD) * PAYOUT_RATE;
  const eurValue = usdValue * USD_TO_EUR;

  const crypto = CRYPTOS.find(c => c.id === selectedCrypto)!;
  const minCoins = Math.ceil(crypto.minUsd * COINS_PER_USD / PAYOUT_RATE);
  const userCoins = session?.user?.coins ?? 0;

  const isValid = coins >= minCoins && coins <= userCoins && walletAddress.trim().length > 10;

  const handleSubmit = async (alreadyLoading = false) => {
    if (!isValid || !session) return;
    if (!alreadyLoading) setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/payments/crypto/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currency: selectedCrypto.toUpperCase(),
          address: walletAddress.trim(),
          amount: coins,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || data.message || t('common_error'));
        setLoading(false);
        return;
      }
      setTxId(data.data?.id || data.id || '');
      setStep('success');
    } catch {
      setError(t('common_error'));
    } finally {
      setLoading(false);
    }
  };

  if (!session) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center">
        <div className="rounded-2xl border overflow-hidden p-10" style={{ background: '#0d0b1a', borderColor: '#2d2850' }}>
          <div className="h-px mb-8" style={{ background: 'linear-gradient(90deg,transparent,#d4a017 30%,#f5c842 50%,#d4a017 70%,transparent)' }} />
          <div className="w-14 h-14 rounded-full mx-auto mb-5 flex items-center justify-center" style={{ background: 'rgba(212,160,23,0.1)', border: '1px solid rgba(212,160,23,0.3)' }}>
            <ArrowUpFromLine size={24} className="text-aoe-gold" />
          </div>
          <h2 className="font-cinzel font-bold text-xl text-aoe-gold mb-2 tracking-wider">{t('auth_required').toUpperCase()}</h2>
          <p className="text-aoe-parchment-muted text-sm mb-8 leading-relaxed">
            {t('auth_signin_steam')}
          </p>
          <button
            onClick={async () => {
              try {
                const { csrfToken } = await fetch('/api/auth/csrf').then(r => r.json()) as { csrfToken: string };
                const form = document.createElement('form');
                form.method = 'POST'; form.action = '/api/auth/signin/steam';
                const i = document.createElement('input'); i.type = 'hidden'; i.name = 'csrfToken'; i.value = csrfToken;
                const c = document.createElement('input'); c.type = 'hidden'; c.name = 'callbackUrl'; c.value = window.location.origin + '/withdraw';
                form.appendChild(i); form.appendChild(c); document.body.appendChild(form); form.submit();
              } catch { window.location.href = '/api/auth/signin/steam'; }
            }}
            className="w-full flex items-center justify-center gap-3 py-4 rounded-xl font-bold text-base transition-all hover:brightness-110 active:scale-[0.99]"
            style={{ background: 'linear-gradient(135deg, #2a475e, #1b2838)', border: '1px solid #4c6b8a', color: 'white' }}
          >
            <SteamIcon />
            {t('auth_signin_steam')}
          </button>
        </div>
      </div>
    );
  }

  if (step === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="aoe-card p-10 text-center max-w-md w-full">
          <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center mx-auto mb-4">
            <Check size={32} className="text-emerald-400" />
          </div>
          <h2 className="font-cinzel text-xl font-bold text-emerald-400 mb-2">{t('withdraw_success')}</h2>
          <p className="text-aoe-parchment-muted text-sm mb-4">
            {t('withdraw_processing')}
          </p>
          {txId && (
            <div className="bg-aoe-stone/50 border border-aoe-border rounded p-3 mb-6 text-xs text-aoe-parchment-muted font-mono break-all">
              ID: {txId}
            </div>
          )}
          <div className="bg-aoe-stone/30 border border-aoe-border rounded p-4 mb-6 text-left space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-aoe-parchment-muted">{t('withdraw_amount')}</span>
              <span className="text-aoe-gold font-bold">{formatCoins(coins)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-aoe-parchment-muted">{t('withdraw_crypto')}</span>
              <span className="text-aoe-parchment font-bold">{crypto.symbol}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-aoe-parchment-muted">{t('withdraw_usd')}</span>
              <span className="text-aoe-parchment">${usdValue.toFixed(2)}</span>
            </div>
          </div>
          <p className="text-aoe-parchment-muted text-xs mb-6">
            {t('common_processing')}
          </p>
          <Link href="/" className="aoe-btn-gold w-full py-3 font-cinzel font-bold tracking-wider flex items-center justify-center">
            {t('withdraw_back_home')}
          </Link>
        </div>
      </div>
    );
  }

  if (step === '2fa') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="aoe-card p-8 max-w-md w-full">
          {/* Header */}
          <div className="flex flex-col items-center mb-6">
            <div className="w-14 h-14 rounded-full flex items-center justify-center mb-4"
              style={{ background: 'rgba(212,160,23,0.08)', border: '1px solid rgba(212,160,23,0.25)' }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#d4a017" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>
              </svg>
            </div>
            <h2 className="font-cinzel text-xl font-bold text-aoe-gold tracking-wider">{t('withdraw_2fa_title')}</h2>
            <p className="text-aoe-parchment-muted text-sm text-center mt-1">
              {t('withdraw_2fa_desc')}
            </p>
          </div>

          {/* Code input */}
          <div className="mb-4">
            <label className="block text-[12px] font-semibold text-[#c8c0e0] mb-2 font-cinzel uppercase tracking-wider">
              {t('withdraw_2fa_code')}
            </label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={twoFaCode}
              onChange={(e) => { setTwoFaCode(e.target.value.replace(/\D/g, '')); setTwoFaError(''); }}
              placeholder="000000"
              className="w-full rounded-lg px-4 py-3.5 text-center text-2xl tracking-[0.5em] font-mono text-[#e8e2f5] placeholder-[#3d3860] outline-none"
              style={{ background: '#07060f', border: `1px solid ${twoFaError ? '#ef4444' : '#1e1a30'}` }}
              autoFocus
            />
            {twoFaError && (
              <p className="text-red-400 text-[11px] mt-1.5">{twoFaError}</p>
            )}
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded p-3 mb-4 text-red-400 text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => { setStep('confirm'); setTwoFaCode(''); setTwoFaError(''); }}
              className="flex-1 py-3 border border-aoe-border rounded text-aoe-parchment-muted hover:border-aoe-border-gold hover:text-aoe-parchment transition-all font-cinzel text-sm"
              disabled={loading}
            >
              {t('deposit_back')}
            </button>
            <button
              onClick={async () => {
                if (twoFaCode.length !== 6) { setTwoFaError(t('sec_invalid_code')); return; }
                setLoading(true);
                try {
                  if (session?.user?.accessToken) setAuthToken(session.user.accessToken);
                  await apiClient.post('/users/2fa/verify', { code: twoFaCode });
                  await handleSubmit(true);
                } catch (err: unknown) {
                  const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
                  setTwoFaError(msg || t('sec_invalid_code'));
                  setLoading(false);
                }
              }}
              disabled={loading}
              className="flex-1 py-3 bg-aoe-gold/90 hover:bg-aoe-gold text-aoe-dark font-cinzel font-bold rounded transition-all disabled:opacity-60 text-sm"
            >
              {loading ? t('common_verifying') : t('withdraw_verify')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'confirm') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="aoe-card p-8 max-w-md w-full">
          <h2 className="font-cinzel text-xl font-bold text-aoe-gold mb-6 text-center">{t('withdraw_confirm_title')}</h2>

          <div className="space-y-3 mb-6">
            <div className="flex justify-between items-center py-3 border-b border-aoe-border">
              <span className="text-aoe-parchment-muted text-sm">{t('withdraw_amount')}</span>
              <span className="text-aoe-gold font-bold text-lg">{formatCoins(coins)}</span>
            </div>
            <div className="flex justify-between items-center py-3 border-b border-aoe-border">
              <span className="text-aoe-parchment-muted text-sm">{t('withdraw_usd')}</span>
              <span className="text-aoe-parchment font-semibold">${usdValue.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center py-3 border-b border-aoe-border">
              <span className="text-aoe-parchment-muted text-sm">{t('withdraw_crypto')}</span>
              <div className="flex items-center gap-2">
                <CryptoLogo id={selectedCrypto} size={20} />
                <span className="text-aoe-parchment font-semibold">{crypto.symbol}</span>
              </div>
            </div>
            <div className="py-3">
              <span className="text-aoe-parchment-muted text-sm block mb-1">{t('withdraw_address')}</span>
              <span className="text-aoe-parchment text-xs font-mono break-all">{walletAddress}</span>
            </div>
          </div>

          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded p-3 mb-6 flex gap-2">
            <AlertTriangle size={16} className="text-yellow-500 flex-shrink-0 mt-0.5" />
            <p className="text-yellow-500/80 text-xs">
              {t('withdraw_warning')}
            </p>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded p-3 mb-4 text-red-400 text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => { setStep('form'); setError(''); }}
              className="flex-1 py-3 border border-aoe-border rounded text-aoe-parchment-muted hover:border-aoe-border-gold hover:text-aoe-parchment transition-all font-cinzel text-sm"
              disabled={loading}
            >
              {t('deposit_back')}
            </button>
            <button
              onClick={() => { if (totpEnabled) { setStep('2fa'); } else { handleSubmit(); } }}
              disabled={loading}
              className="flex-1 py-3 bg-aoe-gold/90 hover:bg-aoe-gold text-aoe-dark font-cinzel font-bold rounded transition-all disabled:opacity-60 text-sm"
            >
              {loading ? t('common_processing') : t('deposit_confirm')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">

      {/* Tabs — same underlined style as the deposit page */}
      <div className="flex mb-8 border-b" style={{ borderColor: '#1e1a30' }}>
        <Link
          href="/deposit"
          className="flex-1 flex items-center justify-center gap-2 py-3 font-cinzel font-bold text-[12px] tracking-[0.18em] uppercase text-[#6b6488] hover:text-[#e8e2f5] transition-colors"
        >
          <ArrowDownToLine size={13} />
          {t('deposit_tab')}
        </Link>
        <div className="flex-1 flex items-center justify-center gap-2 py-3 font-cinzel font-bold text-[12px] tracking-[0.18em] uppercase cursor-default text-[#d4a017] relative">
          <ArrowUpFromLine size={13} />
          {t('withdraw_tab')}
          <span className="absolute left-0 right-0 -bottom-px h-[2px] bg-[#d4a017]" />
        </div>
      </div>

      {/* Page title */}
      <div className="text-center mb-8">
        <h1 className="font-cinzel font-black text-3xl text-aoe-gold tracking-wider mb-2">{t('withdraw_title')}</h1>
        <p className="text-aoe-parchment-muted text-sm">
          <span className="text-aoe-gold font-bold">1,69 ⚜ = $0,99</span> <span className="text-aoe-parchment-muted">({t('common_processing')})</span>
        </p>
      </div>

      {/* Balance info */}
      <div className="rounded-xl p-4 mb-6 flex items-center justify-between" style={{ background: 'linear-gradient(135deg, rgba(212,160,23,0.08), rgba(212,160,23,0.04))', border: '1px solid rgba(212,160,23,0.25)' }}>
        <div className="flex items-center gap-2">
          <Wallet size={16} className="text-aoe-gold" />
          <span className="text-aoe-parchment-muted text-sm font-cinzel">{t('deposit_balance')}</span>
        </div>
        <div className="text-right">
          <div className="text-aoe-gold font-bold text-lg font-cinzel">{formatCoins(userCoins)}</div>
          <div className="text-aoe-parchment-muted text-xs">≈ ${((userCoins / COINS_PER_USD) * PAYOUT_RATE).toFixed(2)}</div>
        </div>
      </div>


      {/* Step 1 — Amount */}
      <div className="aoe-card p-5 mb-4">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-6 h-6 rounded-full bg-aoe-gold/20 border border-aoe-border-gold flex items-center justify-center text-aoe-gold text-xs font-bold font-cinzel">1</div>
          <span className="font-cinzel text-sm font-bold text-aoe-gold tracking-wider">{t('withdraw_amount').toUpperCase()}</span>
        </div>

        {/* Custom amount */}
        <div className="relative">
          <input
            type="number"
            value={coinsAmount}
            onChange={e => setCoinsAmount(e.target.value)}
            placeholder="777"
            min={minCoins}
            max={userCoins}
            className="w-full border rounded-xl px-4 py-4 text-aoe-parchment text-xl font-cinzel font-bold placeholder-aoe-parchment-muted/40 outline-none transition-colors pr-16 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            style={{ background: 'rgba(255,255,255,0.04)', borderColor: coins > 0 ? '#d4a017' : '#1e1a30' }}
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-aoe-gold text-xl font-bold">⚜</span>
        </div>
        {coins > 0 && (
          <p className="text-aoe-parchment-muted text-xs mt-2 text-right">
            = <span className="text-aoe-parchment font-semibold">${usdValue.toFixed(2)}</span>
            <span className="mx-1 opacity-40">·</span>
            <span className="opacity-70">≈ €{eurValue.toFixed(2)}</span>
          </p>
        )}

        {/* Value display */}
        {coins > 0 && (
          <div className="mt-3 p-3 bg-aoe-stone/30 border border-aoe-border/50 rounded grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-aoe-gold font-bold text-sm">{formatCoins(coins)}</div>
              <div className="text-aoe-parchment-muted text-[10px]">Coins</div>
            </div>
            <div>
              <div className="text-aoe-parchment font-bold text-sm">${usdValue.toFixed(2)}</div>
              <div className="text-aoe-parchment-muted text-[10px]">USD</div>
            </div>
            <div>
              <div className="text-aoe-parchment font-bold text-sm">€{eurValue.toFixed(2)}</div>
              <div className="text-aoe-parchment-muted text-[10px]">EUR</div>
            </div>
          </div>
        )}

        {/* Validation messages */}
        {coins > 0 && coins < minCoins && (
          <p className="text-red-400 text-xs mt-2 flex items-center gap-1">
            <AlertTriangle size={12} />
            {t('deposit_min')} : {minCoins.toLocaleString('fr-FR')} ⚜ (${crypto.minUsd} min pour {crypto.symbol})
          </p>
        )}
        {coins > userCoins && (
          <p className="text-red-400 text-xs mt-2 flex items-center gap-1">
            <AlertTriangle size={12} />
            {t('bet_err_balance')}
          </p>
        )}
      </div>

      {/* Step 2 — Crypto selection */}
      <div className="aoe-card p-5 mb-4">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-6 h-6 rounded-full bg-aoe-gold/20 border border-aoe-border-gold flex items-center justify-center text-aoe-gold text-xs font-bold font-cinzel">2</div>
          <span className="font-cinzel text-sm font-bold text-aoe-gold tracking-wider">{t('withdraw_crypto').toUpperCase()}</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {CRYPTOS.map(crypto => (
            <button
              key={crypto.id}
              onClick={() => setSelectedCrypto(crypto.id)}
              className={cn(
                'relative py-3 px-2 rounded border transition-all flex flex-col items-center gap-1.5',
                selectedCrypto === crypto.id
                  ? 'border-aoe-border-gold bg-aoe-gold/10'
                  : 'border-aoe-border bg-aoe-stone/50 hover:border-aoe-border-gold/50'
              )}
            >
              {selectedCrypto === crypto.id && (
                <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-aoe-gold flex items-center justify-center">
                  <Check size={10} className="text-aoe-dark" />
                </div>
              )}
              <CryptoLogo id={crypto.id} size={28} />
              <span className="text-[11px] font-bold text-aoe-parchment">{crypto.symbol}</span>
              <span className="text-[9px] text-aoe-parchment-muted">min ${crypto.minUsd}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Step 3 — Wallet address */}
      <div className="aoe-card p-5 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-6 h-6 rounded-full bg-aoe-gold/20 border border-aoe-border-gold flex items-center justify-center text-aoe-gold text-xs font-bold font-cinzel">3</div>
          <span className="font-cinzel text-sm font-bold text-aoe-gold tracking-wider">{t('withdraw_address').toUpperCase()} {crypto.symbol}</span>
        </div>

        <input
          type="text"
          value={walletAddress}
          onChange={e => setWalletAddress(e.target.value)}
          placeholder={`${t('withdraw_address')} ${crypto.symbol}...`}
          className="w-full bg-aoe-stone/50 border border-aoe-border rounded px-4 py-3 text-aoe-parchment placeholder-aoe-parchment-muted outline-none focus:border-aoe-border-gold transition-colors font-mono text-sm"
        />
        <p className="text-aoe-parchment-muted text-xs mt-2 flex items-center gap-1">
          <AlertTriangle size={11} className="text-yellow-500" />
          {t('withdraw_warning')}
        </p>
      </div>

      {/* Submit */}
      <button
        onClick={() => setStep('confirm')}
        disabled={!isValid}
        className={cn(
          'w-full py-4 rounded font-cinzel font-bold tracking-widest text-sm transition-all',
          isValid
            ? 'bg-aoe-gold/90 hover:bg-aoe-gold text-aoe-dark cursor-pointer'
            : 'bg-aoe-stone border border-aoe-border text-aoe-parchment-muted cursor-not-allowed opacity-50'
        )}
      >
        CONTINUER →
      </button>
    </div>
  );
}
