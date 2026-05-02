'use client';

import { useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { signInWithSteam } from '@/lib/authHelpers';
import { X, Copy, Check, ChevronRight, ArrowDownToLine, ArrowUpFromLine, RefreshCw, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

// ── Rates ─────────────────────────────────────────────────────────────────────
const DEPOSIT_RATE  = 1.69;  // $1 = 1.69 ⚜
const WITHDRAW_RATE = 0.585; // 1 ⚜ = $0.585 (1.69 ⚜ = $0.99)

// ── Cryptos ───────────────────────────────────────────────────────────────────
interface Crypto {
  id: string;
  symbol: string;
  name: string;
  color: string;
  icon: React.ReactNode;
  network?: string;
}

function BtcIcon() {
  return (
    <svg viewBox="0 0 32 32" fill="none" className="w-8 h-8">
      <circle cx="16" cy="16" r="16" fill="#F7931A"/>
      <path d="M22.4 13.9c.3-2-1.2-3.1-3.3-3.8l.7-2.7-1.6-.4-.7 2.7-1.3-.3.7-2.7-1.6-.4-.7 2.7-2.6-.7-.4 1.7s1.2.3 1.1.3c.6.2.8.5.7 1l-1.7 6.7c-.1.2-.3.5-.8.4 0 0-1.1-.3-1.1-.3l-.8 1.8 2.5.6 1.4.4-.7 2.7 1.6.4.7-2.7 1.3.3-.7 2.7 1.6.4.7-2.7c2.8.5 4.9.3 5.8-2.2.7-2-.0-3.1-1.5-3.9 1.1-.3 1.9-1 2.1-2.5zm-3.8 5.3c-.5 2-3.9 1-5 .7l.9-3.5c1.1.3 4.7.9 4.1 2.8zm.5-5.4c-.5 1.8-3.4.9-4.3.7l.8-3.2c.9.2 3.8.7 3.5 2.5z" fill="white"/>
    </svg>
  );
}

function EthIcon() {
  return (
    <svg viewBox="0 0 32 32" fill="none" className="w-8 h-8">
      <circle cx="16" cy="16" r="16" fill="#627EEA"/>
      <path d="M16 4v9.3l7.9 3.5L16 4z" fill="white" fillOpacity=".6"/>
      <path d="M16 4L8.1 16.8l7.9-3.5V4z" fill="white"/>
      <path d="M16 22.5v5.5l7.9-10.9L16 22.5z" fill="white" fillOpacity=".6"/>
      <path d="M16 28v-5.5l-7.9-5.4L16 28z" fill="white"/>
      <path d="M16 21.2l7.9-4.4-7.9-3.5v7.9z" fill="white" fillOpacity=".2"/>
      <path d="M8.1 16.8l7.9 4.4v-7.9l-7.9 3.5z" fill="white" fillOpacity=".6"/>
    </svg>
  );
}

function UsdtIcon() {
  return (
    <svg viewBox="0 0 32 32" fill="none" className="w-8 h-8">
      <circle cx="16" cy="16" r="16" fill="#26A17B"/>
      <path d="M17.9 17.2v-.0c-.1 0-.6.0-1.9.0-1 0-1.7 0-1.9 0v.0c-3.8-.2-6.6-.8-6.6-1.6s2.8-1.4 6.6-1.6v2.5c.2 0 .9.1 1.9.1 1.1 0 1.8 0 1.9-.1v-2.5c3.8.2 6.6.8 6.6 1.6s-2.8 1.4-6.6 1.6zm0-3.6V11h5.3V8H8.9v3H14v2.6c-4.3.2-7.5 1-7.5 2s3.2 1.8 7.5 2v7h3.8v-7c4.3-.2 7.5-1 7.5-2s-3.2-1.8-7.4-2z" fill="white"/>
    </svg>
  );
}

function LtcIcon() {
  return (
    <svg viewBox="0 0 32 32" fill="none" className="w-8 h-8">
      <circle cx="16" cy="16" r="16" fill="#345D9D"/>
      <path d="M10.5 20.5L12 15l-1.5.5.5-2 1.6-.5 2.4-8H19l-2 6.5 1.5-.5-.5 2-1.5.5L15 20.5h-4.5zM19 20.5h-2l.5-2h2l-.5 2z" fill="white"/>
    </svg>
  );
}

function SolIcon() {
  return (
    <svg viewBox="0 0 32 32" fill="none" className="w-8 h-8">
      <circle cx="16" cy="16" r="16" fill="#9945FF"/>
      <path d="M9 21.2l1.4-1.4h12.3l-1.4 1.4H9zm0-5l1.4-1.4h12.3l-1.4 1.4H9zm1.4-6.4H22.7l-1.4 1.4H9l1.4-1.4z" fill="white"/>
    </svg>
  );
}

function XrpIcon() {
  return (
    <svg viewBox="0 0 32 32" fill="none" className="w-8 h-8">
      <circle cx="16" cy="16" r="16" fill="#346AA9"/>
      <path d="M22 9h2.5l-5.4 5.3c-1.7 1.7-4.5 1.7-6.2 0L7.5 9H10l4.2 4.1c1.2 1.2 3.1 1.2 4.3 0L22 9zm-11.7 14H7.8l5.4-5.3c1.7-1.7 4.5-1.7 6.2 0l5.4 5.3H22.3l-4.2-4.1c-1.2-1.2-3.1-1.2-4.3 0l-4.5 4.1z" fill="white"/>
    </svg>
  );
}

const CRYPTOS: Crypto[] = [
  { id: 'btc',  symbol: 'BTC',  name: 'Bitcoin',  color: '#F7931A', icon: <BtcIcon />,  network: 'Bitcoin' },
  { id: 'eth',  symbol: 'ETH',  name: 'Ethereum', color: '#627EEA', icon: <EthIcon />,  network: 'ERC-20'  },
  { id: 'usdt', symbol: 'USDT', name: 'Tether',   color: '#26A17B', icon: <UsdtIcon />, network: 'TRC-20'  },
  { id: 'ltc',  symbol: 'LTC',  name: 'Litecoin', color: '#345D9D', icon: <LtcIcon />,  network: 'Litecoin'},
  { id: 'sol',  symbol: 'SOL',  name: 'Solana',   color: '#9945FF', icon: <SolIcon />,  network: 'Solana'  },
  { id: 'xrp',  symbol: 'XRP',  name: 'XRP',      color: '#346AA9', icon: <XrpIcon />,  network: 'XRP Ledger'},
];

// ── Types ─────────────────────────────────────────────────────────────────────
type Tab = 'deposit' | 'withdraw';

interface PaymentInvoice {
  address: string;
  cryptoAmount: string;
  usdAmount: number;
  coins: number; // displayed with decimals, floored on backend
  crypto: string;
  expiresAt: Date;
}

// ── Copy helper ───────────────────────────────────────────────────────────────
function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={copy} className="p-1.5 rounded transition-colors hover:bg-white/10 text-aoe-parchment-dim hover:text-aoe-gold">
      {copied ? <Check size={13} className="text-aoe-emerald-bright" /> : <Copy size={13} />}
    </button>
  );
}

// ── Amount presets ─────────────────────────────────────────────────────────────
const DEPOSIT_PRESETS  = [5, 10, 20, 50, 100];
const WITHDRAW_PRESETS = [169, 338, 845, 1690];

// ── WalletModal ───────────────────────────────────────────────────────────────
interface Props {
  onClose: () => void;
}

export function WalletModal({ onClose }: Props) {
  const { data: session } = useSession();
  const { t } = useT();
  const [tab, setTab]             = useState<Tab>('deposit');
  const [selectedCrypto, setCrypto] = useState<Crypto | null>(null);
  const [usdAmount, setUsdAmount] = useState('');
  const [coinsAmount, setCoinsAmount] = useState('');
  const [withdrawAddr, setWithdrawAddr] = useState('');
  const [invoice, setInvoice]     = useState<PaymentInvoice | null>(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [affiliateCode, setAffiliateCode] = useState('');

  // ── Computed ─────────────────────────────────────────────────────────────────
  const depositCoins   = usdAmount   ? parseFloat((parseFloat(usdAmount) * DEPOSIT_RATE).toFixed(2))  : 0;
  const withdrawUsd    = coinsAmount ? (parseFloat(coinsAmount) * WITHDRAW_RATE).toFixed(2) : '0.00';
  const coins          = session?.user?.coins ?? 0;

  // ── Deposit submit ────────────────────────────────────────────────────────────
  const handleDeposit = useCallback(async () => {
    if (!session) { signInWithSteam(); return; }
    if (!selectedCrypto || !usdAmount || parseFloat(usdAmount) < 1) {
      setError(t('wallet_err_min_deposit')); return;
    }
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/payments/crypto/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cryptoId: selectedCrypto.id,
          usdAmount: parseFloat(usdAmount),
          coins: depositCoins,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('common_error'));
      setInvoice({
        address:     data.address,
        cryptoAmount: data.cryptoAmount,
        usdAmount:   parseFloat(usdAmount),
        coins:       depositCoins,
        crypto:      selectedCrypto.symbol,
        expiresAt:   new Date(data.expiresAt),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t('wallet_err_payment'));
    } finally {
      setLoading(false);
    }
  }, [session, selectedCrypto, usdAmount, depositCoins]);

  // ── Withdraw submit ───────────────────────────────────────────────────────────
  const handleWithdraw = useCallback(async () => {
    if (!session) { signInWithSteam(); return; }
    if (!selectedCrypto || !coinsAmount || parseFloat(coinsAmount) < 169) {
      setError(t('wallet_err_min_withdraw')); return;
    }
    if (parseFloat(coinsAmount) > coins) {
      setError(t('wallet_err_balance')); return;
    }
    if (!withdrawAddr.trim()) {
      setError(t('wallet_err_address')); return;
    }
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/payments/crypto/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cryptoId:  selectedCrypto.id,
          coins:     parseFloat(coinsAmount),
          address:   withdrawAddr.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('common_error'));
      // Success
      alert(t('wallet_withdraw_initiated', { amount: data.cryptoAmount, crypto: selectedCrypto.symbol }));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('wallet_err_withdraw'));
    } finally {
      setLoading(false);
    }
  }, [session, selectedCrypto, coinsAmount, coins, withdrawAddr, onClose]);

  // ── Reset on tab change ───────────────────────────────────────────────────────
  const switchTab = (t: Tab) => {
    setTab(t); setCrypto(null); setUsdAmount(''); setCoinsAmount('');
    setWithdrawAddr(''); setInvoice(null); setError(null);
  };

  // ── Invoice view (after deposit created) ────────────────────────────────────
  if (invoice) {
    return (
      <ModalShell onClose={onClose}>
        <div className="p-6 space-y-5">
          {/* Header */}
          <div className="text-center">
            <div className="w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center"
                 style={{ background: 'rgba(39,174,96,0.15)', border: '1px solid rgba(39,174,96,0.4)' }}>
              <ArrowDownToLine size={20} className="text-aoe-emerald-bright" />
            </div>
            <h3 className="font-cinzel font-bold text-lg text-aoe-parchment">{t('wallet_pending_title')}</h3>
            <p className="text-aoe-parchment-dim text-sm mt-1">
              {t('deposit_send_exact')} <span className="text-aoe-gold font-bold">{invoice.cryptoAmount} {invoice.crypto}</span>
            </p>
          </div>

          {/* Coins to receive */}
          <div className="rounded-lg p-3 text-center"
               style={{ background: 'rgba(255,197,66,0.08)', border: '1px solid rgba(255,197,66,0.2)' }}>
            <p className="text-aoe-parchment-dim text-xs mb-1">{t('wallet_will_receive')}</p>
            <p className="font-cinzel font-black text-2xl text-aoe-gold">
              {invoice.coins.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ⚜
            </p>
          </div>

          {/* Address */}
          <div>
            <p className="text-xs text-aoe-parchment-dim font-cinzel tracking-wider mb-2 uppercase">
              {t('deposit_address')} {invoice.crypto}
            </p>
            <div className="flex items-center gap-2 p-3 rounded-lg border"
                 style={{ background: '#07060f', borderColor: '#1e1a30' }}>
              <code className="text-aoe-parchment text-xs flex-1 break-all font-mono">
                {invoice.address}
              </code>
              <CopyButton value={invoice.address} />
            </div>
          </div>

          {/* Amount */}
          <div>
            <p className="text-xs text-aoe-parchment-dim font-cinzel tracking-wider mb-2 uppercase">
              {t('wallet_exact_amount')}
            </p>
            <div className="flex items-center gap-2 p-3 rounded-lg border"
                 style={{ background: '#07060f', borderColor: '#1e1a30' }}>
              <code className="text-aoe-gold font-bold font-mono flex-1">
                {invoice.cryptoAmount} {invoice.crypto}
              </code>
              <CopyButton value={invoice.cryptoAmount} />
            </div>
          </div>

          {/* Warning */}
          <div className="flex items-start gap-2 p-3 rounded-lg"
               style={{ background: 'rgba(231,76,60,0.08)', border: '1px solid rgba(231,76,60,0.2)' }}>
            <AlertTriangle size={14} className="text-aoe-crimson-bright shrink-0 mt-0.5" />
            <p className="text-xs text-aoe-parchment-dim leading-relaxed">
              {t('wallet_send_warning')}
            </p>
          </div>

          <button
            onClick={() => setInvoice(null)}
            className="w-full py-2.5 rounded-lg text-sm text-aoe-parchment-dim hover:text-aoe-parchment border border-aoe-border hover:border-aoe-border-mid transition-colors font-cinzel tracking-wide"
          >
            ← {t('common_back')}
          </button>
        </div>
      </ModalShell>
    );
  }

  return (
    <ModalShell onClose={onClose}>
      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b" style={{ borderColor: '#1e1a30' }}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <svg width="16" height="14" viewBox="0 0 32 28" fill="none">
              <path d="M2 22L6 8L12 16L16 4L20 16L26 8L30 22H2Z" fill="#ffc542"/>
            </svg>
            <h2 className="font-cinzel font-bold text-base text-aoe-parchment tracking-wider">Wallet</h2>
          </div>
          <button onClick={onClose} className="text-aoe-parchment-dim hover:text-aoe-parchment transition-colors p-1">
            <X size={16} />
          </button>
        </div>

        {/* Balance */}
        {session && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg mb-4"
               style={{ background: 'rgba(255,197,66,0.07)', border: '1px solid rgba(255,197,66,0.15)' }}>
            <span className="text-aoe-parchment-dim text-xs font-cinzel tracking-wide">Balance</span>
            <span className="text-aoe-gold font-cinzel font-bold text-sm ml-auto">
              ⚜ {coins.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
            </span>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 p-1 rounded-lg" style={{ background: '#07060f' }}>
          {(['deposit', 'withdraw'] as Tab[]).map((tabKey) => (
            <button
              key={tabKey}
              onClick={() => switchTab(tabKey)}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-[12px] font-cinzel tracking-wide uppercase font-bold transition-all',
                tab === tabKey
                  ? 'text-aoe-bg'
                  : 'text-aoe-parchment-dim hover:text-aoe-parchment'
              )}
              style={tab === tabKey ? { background: 'linear-gradient(135deg, #b8881a, #ffc542)' } : undefined}
            >
              {tabKey === 'deposit'
                ? <><ArrowDownToLine size={11} /> {t('deposit_tab')}</>
                : <><ArrowUpFromLine size={11} /> {t('withdraw_tab')}</>}
            </button>
          ))}
        </div>
      </div>

      <div className="px-5 py-4 space-y-5">
        {/* Rate info */}
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-aoe-parchment-dim font-cinzel tracking-wide">
            {tab === 'deposit'
              ? <><span className="text-white">$1</span> = <span className="text-aoe-gold font-bold">1.69 ⚜</span></>
              : <><span className="text-aoe-gold font-bold">1.69 ⚜</span> = <span className="text-aoe-emerald-bright">$0.99</span></>}
          </span>
          <span className="text-aoe-parchment-muted">{t('wallet_crypto_only')}</span>
        </div>

        {/* Choose crypto */}
        <div>
          <p className="text-[10px] font-cinzel tracking-widest text-aoe-parchment-dim uppercase mb-2">
            {t('wallet_choose_crypto')}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {CRYPTOS.map((c) => (
              <button
                key={c.id}
                onClick={() => setCrypto(selectedCrypto?.id === c.id ? null : c)}
                className={cn(
                  'flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-all',
                  selectedCrypto?.id === c.id
                    ? 'border-opacity-80 scale-[1.02]'
                    : 'border-aoe-border hover:border-aoe-border-mid'
                )}
                style={{
                  background: selectedCrypto?.id === c.id
                    ? `${c.color}18`
                    : 'rgba(255,255,255,0.03)',
                  borderColor: selectedCrypto?.id === c.id ? c.color : undefined,
                  boxShadow: selectedCrypto?.id === c.id ? `0 0 16px ${c.color}30` : undefined,
                }}
              >
                {c.icon}
                <span className="font-bold text-[11px] text-aoe-parchment font-cinzel">{c.symbol}</span>
                {c.network && (
                  <span className="text-[9px] text-aoe-parchment-muted leading-none">{c.network}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Amount input */}
        {tab === 'deposit' ? (
          <div>
            <p className="text-[10px] font-cinzel tracking-widest text-aoe-parchment-dim uppercase mb-2">
              {t('wallet_amount_usd')}
            </p>
            {/* Presets */}
            <div className="flex gap-1.5 mb-2 flex-wrap">
              {DEPOSIT_PRESETS.map((v) => (
                <button
                  key={v}
                  onClick={() => setUsdAmount(v.toString())}
                  className={cn(
                    'px-2.5 py-1 rounded text-[11px] font-bold border transition-all font-cinzel',
                    usdAmount === v.toString()
                      ? 'border-aoe-gold text-aoe-gold bg-aoe-gold/10'
                      : 'border-aoe-border text-aoe-parchment-dim hover:border-aoe-border-mid hover:text-aoe-parchment'
                  )}
                >
                  ${v}
                </button>
              ))}
            </div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-aoe-parchment-dim font-bold">$</span>
              <input
                type="number"
                min="1"
                value={usdAmount}
                onChange={(e) => setUsdAmount(e.target.value)}
                placeholder="0.00"
                className="aom-input pl-7 pr-3 h-10"
              />
            </div>
            {depositCoins > 0 && (
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="text-aoe-parchment-dim">{t('wallet_will_receive')}</span>
                <span className="font-cinzel font-bold text-aoe-gold">
                  +{depositCoins.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ⚜
                </span>
              </div>
            )}
          </div>
        ) : (
          <div>
            <p className="text-[10px] font-cinzel tracking-widest text-aoe-parchment-dim uppercase mb-2">
              {t('wallet_coins_withdraw')}
            </p>
            <div className="flex gap-1.5 mb-2 flex-wrap">
              {WITHDRAW_PRESETS.map((v) => (
                <button
                  key={v}
                  onClick={() => setCoinsAmount(v.toString())}
                  disabled={v > coins}
                  className={cn(
                    'px-2.5 py-1 rounded text-[11px] font-bold border transition-all font-cinzel',
                    coinsAmount === v.toString()
                      ? 'border-aoe-gold text-aoe-gold bg-aoe-gold/10'
                      : 'border-aoe-border text-aoe-parchment-dim hover:border-aoe-border-mid hover:text-aoe-parchment',
                    v > coins && 'opacity-30 cursor-not-allowed'
                  )}
                >
                  {v.toLocaleString()} ⚜
                </button>
              ))}
              <button
                onClick={() => setCoinsAmount(coins.toString())}
                className="px-2.5 py-1 rounded text-[11px] font-bold border border-aoe-border text-aoe-parchment-dim hover:border-aoe-border-mid hover:text-aoe-parchment transition-all font-cinzel"
              >
                MAX
              </button>
            </div>
            <div className="relative">
              <input
                type="number"
                min="169"
                max={coins}
                value={coinsAmount}
                onChange={(e) => setCoinsAmount(e.target.value)}
                placeholder="169"
                className="aom-input h-10"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-aoe-gold font-bold text-sm">⚜</span>
            </div>
            {parseFloat(coinsAmount) > 0 && (
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="text-aoe-parchment-dim">{t('wallet_will_receive')}</span>
                <span className="font-cinzel font-bold text-aoe-emerald-bright">
                  ${withdrawUsd}
                </span>
              </div>
            )}

            {/* Withdraw address */}
            <div className="mt-3">
              <p className="text-[10px] font-cinzel tracking-widest text-aoe-parchment-dim uppercase mb-2">
                {t('wallet_dest_addr', { crypto: selectedCrypto?.symbol ?? 'crypto' })}
              </p>
              <input
                type="text"
                value={withdrawAddr}
                onChange={(e) => setWithdrawAddr(e.target.value)}
                placeholder={t('wallet_addr_placeholder', { crypto: selectedCrypto?.symbol ?? 'wallet' })}
                className="aom-input h-10 font-mono text-xs"
              />
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 p-2.5 rounded-lg text-xs"
               style={{ background: 'rgba(231,76,60,0.1)', border: '1px solid rgba(231,76,60,0.3)' }}>
            <AlertTriangle size={12} className="text-aoe-crimson-bright shrink-0" />
            <span className="text-aoe-crimson-bright">{error}</span>
          </div>
        )}

        {/* CTA */}
        <button
          onClick={tab === 'deposit' ? handleDeposit : handleWithdraw}
          disabled={loading || (!session && false)}
          className={cn(
            'w-full py-3 rounded-lg font-cinzel font-bold text-sm tracking-widest uppercase transition-all flex items-center justify-center gap-2',
            loading ? 'opacity-60 cursor-not-allowed' : ''
          )}
          style={{ background: 'linear-gradient(135deg, #b8881a, #ffc542)', color: '#07060f' }}
        >
          {loading ? (
            <><RefreshCw size={14} className="animate-spin" /> {t('common_loading')}</>
          ) : !session ? (
            t('wallet_steam_required')
          ) : tab === 'deposit' ? (
            <><ArrowDownToLine size={14} /> {t('deposit_tab')}</>
          ) : (
            <><ArrowUpFromLine size={14} /> {t('withdraw_tab')}</>
          )}
        </button>

        {/* Affiliate code */}
        <div className="pt-1 border-t" style={{ borderColor: '#1e1a30' }}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-cinzel tracking-widest text-aoe-parchment-dim uppercase">
              {t('wallet_aff_code')}
            </p>
            <span className="text-[10px] text-aoe-gold">+5% bonus</span>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={affiliateCode}
              onChange={(e) => setAffiliateCode(e.target.value.toUpperCase())}
              placeholder={t('wallet_enter_code')}
              className="aom-input h-8 text-xs flex-1 uppercase tracking-widest font-cinzel"
            />
            <button
              className="px-4 h-8 rounded-md text-xs font-cinzel font-bold tracking-wide transition-all shrink-0"
              style={{ background: 'linear-gradient(135deg, #b8881a, #ffc542)', color: '#07060f' }}
            >
              {t('deposit_promo_apply')}
            </button>
          </div>
          {!affiliateCode && (
            <p className="text-[10px] text-aoe-parchment-muted mt-1.5">
              {t('wallet_promo_no_code')}
            </p>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

// ── Modal shell ───────────────────────────────────────────────────────────────
function ModalShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-sm rounded-xl overflow-hidden animate-fadeIn"
        style={{
          background: '#0d0b1a',
          border: '1px solid #2d2850',
          boxShadow: '0 25px 60px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,197,66,0.05)',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top gold accent line */}
        <div className="h-px w-full"
             style={{ background: 'linear-gradient(90deg, transparent 0%, #ffc542 30%, #ffd97a 50%, #ffc542 70%, transparent 100%)' }} />
        {children}
      </div>
    </div>
  );
}
