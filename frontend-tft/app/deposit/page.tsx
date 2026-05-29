'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Coins, Copy, AlertTriangle, ShieldCheck, CheckCircle2, Hexagon, ExternalLink,
  ChevronRight, Zap, Clock,
} from 'lucide-react';
import { cn, formatCoins } from '@/lib/utils';
import { getCryptoMethods, createCryptoDeposit, type CryptoMethod, type CryptoDeposit } from '@/lib/api';

const DEFAULT_AMOUNTS = [10, 25, 50, 100, 250, 500];
const DEPOSIT_RATE = 1.69; // 1 USD = 1.69 ◈

export default function DepositPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [methods, setMethods]   = useState<CryptoMethod[] | null>(null);
  const [currency, setCurrency] = useState<string>('');
  const [amountUsd, setAmountUsd] = useState<string>('25');
  const [creating, setCreating] = useState(false);
  const [deposit, setDeposit]   = useState<CryptoDeposit | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [copied, setCopied]     = useState<'address' | 'amount' | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/');
  }, [status, router]);

  useEffect(() => {
    if (!session?.user?.accessToken) return;
    getCryptoMethods().then((m) => {
      setMethods(m);
      if (m.length > 0) setCurrency(m[0].code);
    });
  }, [session?.user?.accessToken]);

  const amountNum = parseFloat(amountUsd) || 0;
  const expectedCoins = amountNum * DEPOSIT_RATE;
  const selectedMethod = methods?.find((m) => m.code === currency);
  const belowMin = selectedMethod && amountNum < selectedMethod.minDepositUsd;
  const disabled = !currency || amountNum <= 0 || amountNum > 50_000 || belowMin || creating;

  async function handleCreate() {
    setCreating(true); setError(null); setDeposit(null);
    const result = await createCryptoDeposit({ currency, amountUsd: amountNum });
    if (!result) {
      setError('Impossible de créer le dépôt. Réessaie ou contacte le support.');
    } else {
      setDeposit(result);
    }
    setCreating(false);
  }

  async function copy(text: string, which: 'address' | 'amount') {
    await navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 2000);
  }

  if (status === 'loading' || !session) return null;

  return (
    <div className="relative pb-20">
      <Header />

      <section className="max-w-5xl mx-auto px-6 mt-10 grid lg:grid-cols-[1fr_300px] gap-8">

        <div className="space-y-6">
          {!deposit ? (
            <DepositForm
              methods={methods}
              currency={currency}
              setCurrency={setCurrency}
              amountUsd={amountUsd}
              setAmountUsd={setAmountUsd}
              expectedCoins={expectedCoins}
              selectedMethod={selectedMethod}
              belowMin={!!belowMin}
              error={error}
              disabled={!!disabled}
              creating={creating}
              onSubmit={handleCreate}
            />
          ) : (
            <DepositInProgress
              deposit={deposit}
              expectedCoins={expectedCoins}
              copy={copy}
              copied={copied}
              onReset={() => { setDeposit(null); setError(null); }}
            />
          )}
        </div>

        <aside className="lg:sticky lg:top-20 lg:self-start space-y-4">
          <InfoCard
            icon={Zap}
            title="Crédité en < 2 min"
            body="Une fois confirmé sur le réseau crypto, les coins sont auto-crédités en moins de 2 minutes."
          />
          <InfoCard
            icon={ShieldCheck}
            title="Sans KYC < 1k$/mois"
            body="Tant que tu déposes moins de 1 000 $ cumulés par mois, aucune vérification d'identité n'est requise."
          />
          <InfoCard
            icon={Clock}
            title="Adresse à usage unique"
            body="Chaque demande génère une adresse fraîche, valable 1 heure. Les envois après expiration sont récupérés manuellement par le support."
          />

          <div className="rounded-xl border border-tft-mint/30 bg-tft-mint/5 p-4">
            <p className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-mint mb-2">Taux</p>
            <p className="text-sm text-tft-text">
              <span className="font-display font-bold text-tft-mint">1 USD = {DEPOSIT_RATE} ◈</span>
            </p>
            <p className="text-[11px] text-tft-text-muted mt-1 leading-relaxed">
              Le taux retrait est de 1.69 ◈ = 0.99 USD — l&apos;écart de ~1 % couvre les frais réseau.
            </p>
          </div>
        </aside>
      </section>
    </div>
  );
}

function Header() {
  return (
    <section className="relative overflow-hidden bg-hero-arcane border-b border-tft-border">
      <div className="absolute inset-0 bg-hex-grid opacity-15 pointer-events-none" aria-hidden="true" />
      <div className="absolute -top-32 -left-20 w-[420px] h-[420px] rounded-full bg-tft-mint/15 blur-[120px]" aria-hidden="true" />

      <div className="relative max-w-5xl mx-auto px-6 py-14 md:py-16 space-y-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-tft-mint/40 bg-tft-mint/10">
          <Hexagon size={11} className="text-tft-mint" />
          <span className="font-ui text-[11px] tracking-[0.22em] uppercase text-tft-mint">
            Dépôt crypto
          </span>
        </div>
        <h1 className="font-display font-bold text-3xl md:text-4xl text-tft-text leading-tight">
          Approvisionne ton compte
        </h1>
        <p className="text-tft-text-dim text-base max-w-2xl">
          BTC, ETH, USDT, LTC, SOL ou autre — choisis ta crypto, envoie le montant, profite.
          Pas de carte, pas de virement, pas d&apos;attente.
        </p>
      </div>
    </section>
  );
}

/* ─────────────────── Form ─────────────────── */
function DepositForm({
  methods, currency, setCurrency, amountUsd, setAmountUsd, expectedCoins,
  selectedMethod, belowMin, error, disabled, creating, onSubmit,
}: {
  methods: CryptoMethod[] | null;
  currency: string;
  setCurrency: (c: string) => void;
  amountUsd: string;
  setAmountUsd: (a: string) => void;
  expectedCoins: number;
  selectedMethod: CryptoMethod | undefined;
  belowMin: boolean;
  error: string | null;
  disabled: boolean;
  creating: boolean;
  onSubmit: () => void;
}) {
  if (methods === null) return <FormSkeleton />;
  if (methods.length === 0) {
    return (
      <div className="rounded-xl border border-tft-border bg-tft-bg-card/60 p-8 text-center">
        <AlertTriangle size={28} className="text-tft-rose mx-auto mb-3" />
        <p className="font-display font-semibold text-tft-text mb-2">
          Aucune méthode de dépôt disponible
        </p>
        <p className="text-sm text-tft-text-dim">
          Le service crypto est temporairement indisponible. Contacte le support si ça persiste.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-tft-border bg-tft-bg-card/60 p-6 md:p-8 space-y-6">
      <div>
        <label className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-text-muted block mb-3">
          Cryptomonnaie
        </label>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {methods.map((m) => (
            <button
              key={m.code}
              onClick={() => setCurrency(m.code)}
              className={cn(
                'p-3 rounded-md border transition-all cursor-pointer text-left',
                currency === m.code
                  ? 'bg-tft-purple/20 border-tft-purple-bright text-tft-purple-bright shadow-arcane-sm'
                  : 'bg-tft-bg border-tft-border text-tft-text-dim hover:text-tft-text hover:border-tft-purple/40',
              )}
            >
              <p className="font-ui font-bold text-sm">{m.label}</p>
              <p className="text-[10px] text-tft-text-muted mt-0.5">min ${m.minDepositUsd}</p>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="amount" className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-text-muted block mb-3">
          Montant en USD
        </label>
        <div className="relative">
          <input
            id="amount"
            type="number"
            inputMode="decimal"
            value={amountUsd}
            onChange={(e) => setAmountUsd(e.target.value)}
            min={selectedMethod?.minDepositUsd ?? 1}
            max={50_000}
            step={1}
            className={cn(
              'w-full px-4 py-3 rounded-md bg-tft-bg border text-tft-text font-ui font-semibold text-xl tabular-nums',
              'focus:outline-none focus:ring-2 focus:ring-tft-purple/30 transition-colors',
              belowMin ? 'border-tft-rose/50 focus:border-tft-rose-bright' : 'border-tft-border focus:border-tft-purple-bright',
            )}
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 font-ui text-tft-text-muted">USD</span>
        </div>
        <div className="grid grid-cols-6 gap-2 mt-2">
          {DEFAULT_AMOUNTS.map((v) => (
            <button
              key={v}
              onClick={() => setAmountUsd(String(v))}
              className="px-2 py-1.5 rounded-md bg-tft-bg-elevated border border-tft-border hover:border-tft-purple/50 font-ui text-xs text-tft-text-dim hover:text-tft-text transition-colors cursor-pointer"
            >
              ${v}
            </button>
          ))}
        </div>
        {belowMin && selectedMethod && (
          <p className="text-xs text-tft-rose-bright mt-2">
            Montant minimum pour {selectedMethod.label} : ${selectedMethod.minDepositUsd}
          </p>
        )}
      </div>

      <div className="rounded-md border border-tft-mint/30 bg-tft-mint/5 p-4 flex items-center justify-between">
        <div>
          <p className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-text-muted mb-1">
            Tu recevras
          </p>
          <p className="font-display font-bold text-2xl text-tft-mint tabular-nums">
            {formatCoins(expectedCoins)} ◈
          </p>
        </div>
        <Coins size={28} className="text-tft-mint opacity-60" />
      </div>

      {error && (
        <div className="rounded-md border border-tft-rose/40 bg-tft-rose/10 px-3 py-2 text-xs text-tft-rose-bright flex items-center gap-2">
          <AlertTriangle size={14} />
          {error}
        </div>
      )}

      <button
        onClick={onSubmit}
        disabled={disabled}
        className={cn(
          'w-full py-3.5 rounded-md font-ui font-bold text-[13px] tracking-[0.22em] uppercase text-white transition-all cursor-pointer',
          disabled
            ? 'bg-tft-bg-elevated border border-tft-border text-tft-text-muted cursor-not-allowed'
            : 'bg-gradient-rose shadow-rose-md hover:shadow-arcane-md',
        )}
      >
        {creating ? 'Génération de l\'adresse…' : 'Générer l\'adresse de dépôt'}
      </button>
    </div>
  );
}

/* ─────────────────── In progress ─────────────────── */
function DepositInProgress({
  deposit, expectedCoins, copy, copied, onReset,
}: {
  deposit: CryptoDeposit;
  expectedCoins: number;
  copy: (text: string, which: 'address' | 'amount') => void;
  copied: 'address' | 'amount' | null;
  onReset: () => void;
}) {
  const minutesLeft = Math.max(0, Math.floor((new Date(deposit.expiresAt).getTime() - Date.now()) / 60_000));

  return (
    <div className="rounded-xl border border-tft-mint/40 bg-card-arcane shadow-arcane-md p-6 md:p-8 space-y-6">
      <div className="flex items-center gap-2">
        <CheckCircle2 size={18} className="text-tft-mint" />
        <h2 className="font-display font-semibold text-xl text-tft-text">
          Envoie {deposit.amount} {deposit.currency.toUpperCase()}
        </h2>
      </div>

      <div className="flex flex-col md:flex-row gap-6 items-center">
        {deposit.qrCodeUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={deposit.qrCodeUrl}
            alt="QR code"
            className="w-44 h-44 rounded-md border border-tft-border bg-white p-2 shrink-0"
          />
        )}

        <div className="flex-1 min-w-0 space-y-4 w-full">
          <div>
            <p className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-text-muted mb-2">
              Adresse {deposit.currency.toUpperCase()}
            </p>
            <button
              onClick={() => copy(deposit.address, 'address')}
              className="w-full px-4 py-3 rounded-md bg-tft-bg border border-tft-border text-left flex items-center justify-between gap-2 hover:border-tft-purple/40 transition-colors cursor-pointer"
            >
              <span className="font-mono text-xs md:text-sm text-tft-cyan-bright truncate">{deposit.address}</span>
              <Copy size={14} className="text-tft-text-muted shrink-0" />
            </button>
            {copied === 'address' && <p className="text-[11px] text-tft-mint mt-1">Copié !</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-text-muted mb-1">
                Montant exact
              </p>
              <button
                onClick={() => copy(deposit.amount, 'amount')}
                className="w-full px-3 py-2 rounded-md bg-tft-bg border border-tft-border text-left flex items-center justify-between gap-2 hover:border-tft-purple/40 transition-colors cursor-pointer"
              >
                <span className="font-ui font-semibold text-tft-text-sm">{deposit.amount}</span>
                <Copy size={11} className="text-tft-text-muted" />
              </button>
              {copied === 'amount' && <p className="text-[11px] text-tft-mint mt-1">Copié !</p>}
            </div>

            <div>
              <p className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-text-muted mb-1">
                Tu recevras
              </p>
              <div className="px-3 py-2 rounded-md bg-tft-mint/10 border border-tft-mint/40">
                <span className="font-ui font-semibold text-tft-mint">
                  {formatCoins(expectedCoins)} ◈
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-md border border-tft-cyan/30 bg-tft-cyan-dim p-4 space-y-2 text-xs text-tft-text-dim">
        <p className="font-ui font-semibold text-tft-cyan-bright text-sm">
          ⏳ Adresse valide encore {minutesLeft} min
        </p>
        <p className="leading-relaxed">
          Envoie <strong className="text-tft-text">exactement {deposit.amount} {deposit.currency.toUpperCase()}</strong> à cette adresse.
          Un montant inférieur sera considéré comme un dépôt partiel et ajouté à ton solde au prorata.
        </p>
        <p className="leading-relaxed">
          Une fois envoyé, les coins apparaissent automatiquement après la confirmation réseau (~1-15 min selon la crypto).
          Pas besoin de revenir sur cette page.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={onReset}
          className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-md bg-tft-bg-card border border-tft-border hover:border-tft-purple/60 font-ui text-[12px] uppercase tracking-wider text-tft-text-dim hover:text-tft-text transition-colors cursor-pointer"
        >
          Nouveau dépôt
        </button>
        <Link
          href="/profile"
          className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-md bg-gradient-rose shadow-rose-md font-ui font-semibold text-[12px] uppercase tracking-wider text-white hover:shadow-arcane-md transition-all cursor-pointer"
        >
          Voir mon solde
          <ChevronRight size={14} />
        </Link>
      </div>
    </div>
  );
}

/* ─────────────────── Helpers ─────────────────── */
function InfoCard({ icon: Icon, title, body }: {
  icon: typeof Zap;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-tft-border bg-tft-bg-card/60 p-4 flex items-start gap-3">
      <div className="shrink-0 w-9 h-9 rounded-md bg-tft-purple/15 border border-tft-purple/40 flex items-center justify-center">
        <Icon size={15} className="text-tft-purple-bright" />
      </div>
      <div>
        <p className="font-display font-semibold text-tft-text text-sm mb-1">{title}</p>
        <p className="text-xs text-tft-text-dim leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

function FormSkeleton() {
  return (
    <div className="rounded-xl border border-tft-border bg-tft-bg-card/60 p-6 md:p-8 space-y-6 animate-pulse">
      <div className="space-y-3">
        <div className="h-3 w-20 rounded bg-tft-bg-elevated" />
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-14 rounded bg-tft-bg-elevated" />)}
        </div>
      </div>
      <div className="space-y-2">
        <div className="h-3 w-20 rounded bg-tft-bg-elevated" />
        <div className="h-12 rounded bg-tft-bg-elevated" />
      </div>
      <div className="h-12 rounded bg-tft-bg-elevated" />
    </div>
  );
}
