'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowDownToLine, AlertTriangle, ShieldCheck, CheckCircle2, Hexagon,
  ChevronRight, Wallet,
} from 'lucide-react';
import { cn, formatCoins } from '@/lib/utils';
import {
  getCryptoMethods, getMe, createCryptoWithdrawal,
  type CryptoMethod, type MeResponse,
} from '@/lib/api';

const WITHDRAW_RATE = 0.99 / 1.69; // 1.69 ◈ = 0.99 USD → coins → USD

export default function WithdrawPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [methods, setMethods]       = useState<CryptoMethod[] | null>(null);
  const [me, setMe]                 = useState<MeResponse | null>(null);
  const [currency, setCurrency]     = useState<string>('');
  const [amountCoins, setAmountCoins] = useState<string>('100');
  const [address, setAddress]       = useState<string>('');
  const [confirmRisk, setConfirmRisk] = useState(false);
  const [posting, setPosting]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [success, setSuccess]       = useState<{ id: string } | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/');
  }, [status, router]);

  useEffect(() => {
    if (!session?.user?.accessToken) return;
    Promise.all([getCryptoMethods(), getMe()]).then(([m, u]) => {
      setMethods(m);
      setMe(u);
      if (m.length > 0) setCurrency(m[0].code);
    });
  }, [session?.user?.accessToken]);

  const amountNum    = parseFloat(amountCoins) || 0;
  const expectedUsd  = amountNum * WITHDRAW_RATE;
  const balance      = me?.coins ?? 0;
  const insufficient = amountNum > balance;
  const tooSmall     = amountNum > 0 && amountNum < 10; // 10 ◈ minimum
  const addressOk    = address.length >= 25;
  const disabled     = !currency || !addressOk || !amountNum || insufficient || tooSmall || !confirmRisk || posting;

  async function handleSubmit() {
    setPosting(true); setError(null);
    const result = await createCryptoWithdrawal({
      currency,
      amountCoins: amountNum,
      destinationAddress: address.trim(),
    });
    if ('error' in result) {
      setError(result.error);
    } else {
      setSuccess({ id: result.id });
      setAmountCoins(''); setAddress(''); setConfirmRisk(false);
    }
    setPosting(false);
  }

  if (status === 'loading' || !session) return null;

  return (
    <div className="relative pb-20">
      <Header />

      <section className="max-w-5xl mx-auto px-6 mt-10 grid lg:grid-cols-[1fr_300px] gap-8">

        <div className="space-y-6">
          {success ? (
            <SuccessCard withdrawalId={success.id} onReset={() => setSuccess(null)} />
          ) : (
            <WithdrawForm
              methods={methods}
              currency={currency}
              setCurrency={setCurrency}
              amountCoins={amountCoins}
              setAmountCoins={setAmountCoins}
              expectedUsd={expectedUsd}
              balance={balance}
              insufficient={insufficient}
              tooSmall={tooSmall}
              address={address}
              setAddress={setAddress}
              addressOk={addressOk}
              confirmRisk={confirmRisk}
              setConfirmRisk={setConfirmRisk}
              error={error}
              disabled={!!disabled}
              posting={posting}
              onSubmit={handleSubmit}
            />
          )}
        </div>

        <aside className="lg:sticky lg:top-20 lg:self-start space-y-4">
          <BalanceCard balance={balance} />

          <InfoCard
            icon={ShieldCheck}
            title="Traité sous 5 min"
            body="Une fois validé manuellement par notre équipe (anti-fraude), le retrait est broadcasté sur le réseau crypto immédiatement."
          />
          <div className="rounded-xl border border-tft-rose/30 bg-tft-rose/5 p-4">
            <p className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-rose-bright mb-2">
              ⚠️ Important
            </p>
            <p className="text-xs text-tft-text-dim leading-relaxed">
              Vérifie 3 fois l&apos;adresse et le réseau choisi. Un envoi sur le mauvais réseau est
              <strong className="text-tft-rose-bright"> irrécupérable</strong>.
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
      <div className="absolute -top-32 -left-20 w-[420px] h-[420px] rounded-full bg-tft-gold/15 blur-[120px]" aria-hidden="true" />

      <div className="relative max-w-5xl mx-auto px-6 py-14 md:py-16 space-y-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-tft-gold/40 bg-tft-gold/10">
          <Hexagon size={11} className="text-tft-gold-bright" />
          <span className="font-ui text-[11px] tracking-[0.22em] uppercase text-tft-gold-bright">
            Retrait crypto
          </span>
        </div>
        <h1 className="font-display font-bold text-3xl md:text-4xl text-tft-text leading-tight">
          Récupère tes gains
        </h1>
        <p className="text-tft-text-dim text-base max-w-2xl">
          Retire vers ton wallet crypto en moins de 5 minutes. Pas de période de wagering — tes coins
          gagnés sont retirables immédiatement après settlement du pari.
        </p>
      </div>
    </section>
  );
}

/* ─────────────────── Form ─────────────────── */
function WithdrawForm({
  methods, currency, setCurrency,
  amountCoins, setAmountCoins, expectedUsd, balance, insufficient, tooSmall,
  address, setAddress, addressOk, confirmRisk, setConfirmRisk,
  error, disabled, posting, onSubmit,
}: {
  methods: CryptoMethod[] | null;
  currency: string;
  setCurrency: (c: string) => void;
  amountCoins: string;
  setAmountCoins: (a: string) => void;
  expectedUsd: number;
  balance: number;
  insufficient: boolean;
  tooSmall: boolean;
  address: string;
  setAddress: (a: string) => void;
  addressOk: boolean;
  confirmRisk: boolean;
  setConfirmRisk: (b: boolean) => void;
  error: string | null;
  disabled: boolean;
  posting: boolean;
  onSubmit: () => void;
}) {
  if (methods === null) return <FormSkeleton />;

  return (
    <div className="rounded-xl border border-tft-border bg-tft-bg-card/60 p-6 md:p-8 space-y-6">
      <div>
        <label className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-text-muted block mb-3">
          Cryptomonnaie de retrait
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
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="amount" className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-text-muted block mb-3 flex items-center justify-between">
          <span>Montant en coins</span>
          <button
            onClick={() => setAmountCoins(String(Math.floor(balance)))}
            className="font-ui text-[11px] tracking-wider text-tft-cyan-bright hover:underline cursor-pointer"
          >
            Max ({formatCoins(balance)} ◈)
          </button>
        </label>
        <div className="relative">
          <input
            id="amount"
            type="number"
            inputMode="decimal"
            value={amountCoins}
            onChange={(e) => setAmountCoins(e.target.value)}
            min={10}
            max={Math.floor(balance)}
            step={0.01}
            className={cn(
              'w-full px-4 py-3 rounded-md bg-tft-bg border text-tft-text font-ui font-semibold text-xl tabular-nums',
              'focus:outline-none focus:ring-2 focus:ring-tft-purple/30 transition-colors',
              insufficient || tooSmall
                ? 'border-tft-rose/50 focus:border-tft-rose-bright'
                : 'border-tft-border focus:border-tft-purple-bright',
            )}
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 font-ui text-tft-text-muted">◈</span>
        </div>
        {tooSmall && (
          <p className="text-xs text-tft-rose-bright mt-2">Minimum 10 ◈ par retrait.</p>
        )}
        {insufficient && (
          <p className="text-xs text-tft-rose-bright mt-2">Tu n&apos;as que {formatCoins(balance)} ◈ dispo.</p>
        )}
      </div>

      <div>
        <label htmlFor="address" className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-text-muted block mb-3">
          Adresse de destination
        </label>
        <input
          id="address"
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value.trim())}
          placeholder={`Ton adresse ${currency.toUpperCase()} (35-62 caractères)`}
          className="w-full px-4 py-3 rounded-md bg-tft-bg border border-tft-border text-tft-cyan-bright font-mono text-sm focus:outline-none focus:border-tft-purple-bright focus:ring-2 focus:ring-tft-purple/30 transition-colors"
        />
        <p className="text-[11px] text-tft-text-muted mt-2 leading-relaxed">
          Triple-check cette adresse — un envoi vers une mauvaise adresse est <strong className="text-tft-rose-bright">irrécupérable</strong>.
          Si c&apos;est ta première fois sur cette adresse, un délai de vérification de 24 h s&apos;applique.
        </p>
      </div>

      <div className="rounded-md border border-tft-gold/30 bg-tft-gold/5 p-4 flex items-center justify-between">
        <div>
          <p className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-text-muted mb-1">
            Tu recevras (~)
          </p>
          <p className="font-display font-bold text-2xl text-tft-gold-bright tabular-nums">
            ${expectedUsd.toFixed(2)} USD
          </p>
        </div>
        <ArrowDownToLine size={28} className="text-tft-gold-bright opacity-60" />
      </div>

      <label className="flex items-start gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={confirmRisk}
          onChange={(e) => setConfirmRisk(e.target.checked)}
          className="mt-0.5 w-4 h-4 rounded border-tft-border bg-tft-bg accent-tft-purple cursor-pointer"
        />
        <span className="text-xs text-tft-text-dim leading-relaxed">
          Je confirme que l&apos;adresse fournie est correcte et qu&apos;elle correspond au réseau{' '}
          <strong className="text-tft-text">{currency.toUpperCase()}</strong>. Je comprends qu&apos;une
          erreur de saisie ou de réseau est irrécupérable et que tft.money n&apos;est pas responsable.
        </span>
      </label>

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
        {posting ? 'Envoi de la demande…' : `Retirer ${formatCoins(parseFloat(amountCoins) || 0)} ◈`}
      </button>
    </div>
  );
}

/* ─────────────────── Success ─────────────────── */
function SuccessCard({ withdrawalId, onReset }: { withdrawalId: string; onReset: () => void }) {
  return (
    <div className="rounded-xl border border-tft-mint/40 bg-card-arcane shadow-arcane-md p-6 md:p-8 space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-md bg-tft-mint/15 border border-tft-mint/40 flex items-center justify-center">
          <CheckCircle2 size={24} className="text-tft-mint" />
        </div>
        <div>
          <h2 className="font-display font-bold text-xl text-tft-text">Demande envoyée</h2>
          <p className="text-sm text-tft-text-dim">ID #{withdrawalId}</p>
        </div>
      </div>

      <div className="space-y-3 text-sm text-tft-text-dim leading-relaxed">
        <p>
          Notre équipe traite la demande dans les <strong className="text-tft-text">5 minutes</strong>{' '}
          (en heures ouvrées). Une fois validée, la transaction crypto est broadcastée immédiatement
          et tu reçois une notification.
        </p>
        <p>
          Tu peux suivre l&apos;avancement depuis ton{' '}
          <Link href="/profile" className="text-tft-cyan-bright hover:underline">profil</Link>.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={onReset}
          className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-md bg-tft-bg-card border border-tft-border hover:border-tft-purple/60 font-ui text-[12px] uppercase tracking-wider text-tft-text-dim hover:text-tft-text transition-colors cursor-pointer"
        >
          Nouveau retrait
        </button>
        <Link
          href="/tournaments"
          className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-md bg-gradient-rose shadow-rose-md font-ui font-semibold text-[12px] uppercase tracking-wider text-white hover:shadow-arcane-md transition-all cursor-pointer"
        >
          Voir les tournois
          <ChevronRight size={14} />
        </Link>
      </div>
    </div>
  );
}

/* ─────────────────── Side cards ─────────────────── */
function BalanceCard({ balance }: { balance: number }) {
  return (
    <div className="rounded-xl border border-tft-gold/40 bg-card-arcane p-5">
      <div className="flex items-center gap-2 mb-2">
        <Wallet size={14} className="text-tft-gold-bright" />
        <p className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-text-muted">Solde dispo</p>
      </div>
      <p className="font-display font-bold text-2xl text-tft-gold-bright tabular-nums">
        {formatCoins(balance)} ◈
      </p>
      <p className="text-[11px] text-tft-text-muted mt-1">
        ≈ ${(balance * WITHDRAW_RATE).toFixed(2)} USD
      </p>
    </div>
  );
}

function InfoCard({ icon: Icon, title, body }: {
  icon: typeof ShieldCheck;
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
          {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-12 rounded bg-tft-bg-elevated" />)}
        </div>
      </div>
      <div className="h-12 rounded bg-tft-bg-elevated" />
      <div className="h-12 rounded bg-tft-bg-elevated" />
      <div className="h-12 rounded bg-tft-bg-elevated" />
    </div>
  );
}
