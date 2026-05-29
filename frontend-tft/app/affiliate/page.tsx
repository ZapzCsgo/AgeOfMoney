'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  Sparkles, Users, Copy, Share2, TrendingUp, Hexagon, ChevronRight, ShieldCheck,
} from 'lucide-react';
import { cn, formatCoins } from '@/lib/utils';
import { getAffiliateInfo, createAffiliateCode, type AffiliateInfo } from '@/lib/api';

const BENEFITS = [
  {
    icon: Users,
    title: 'Tu fais déposer un pote',
    body: '5 ◈ de bonus immédiat sur son premier dépôt, qu\'il peut wager directement. Pas de période d\'attente.',
  },
  {
    icon: TrendingUp,
    title: 'Tu touches 5% de sa house edge',
    body: 'Chaque fois qu\'il pose un pari TFT ou un coup à la roulette, on prend notre marge — tu prends 5% de cette marge.',
  },
  {
    icon: ShieldCheck,
    title: 'Aucun plafond, retrait à 50 ◈',
    body: 'Pas de cap sur la commission accumulée. Tu peux la retirer à partir de 50 ◈ cumulés, vers ton solde principal.',
  },
];

export default function AffiliatePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [info, setInfo]       = useState<AffiliateInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [codeInput, setCodeInput] = useState('');
  const [creating, setCreating]   = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [copied, setCopied]       = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/');
  }, [status, router]);

  useEffect(() => {
    if (!session?.user?.accessToken) return;
    setLoading(true);
    getAffiliateInfo()
      .then((data) => setInfo(data ?? { code: null, totalReferrals: 0, pendingCommission: 0, paidCommission: 0 }))
      .finally(() => setLoading(false));
  }, [session?.user?.accessToken]);

  async function handleCreate() {
    if (!codeInput) return;
    setCreating(true); setError(null);
    const result = await createAffiliateCode(codeInput.trim().toLowerCase());
    if ('error' in result) {
      setError(result.error);
    } else {
      setInfo((prev) => prev ? { ...prev, code: result.code } : prev);
      setCodeInput('');
    }
    setCreating(false);
  }

  async function copyLink() {
    if (!info?.code) return;
    const url = `https://tft.money/?ref=${info.code}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (status === 'loading' || loading) return <AffiliateSkeleton />;
  if (!session) return null; // redirecting

  const link = info?.code ? `https://tft.money/?ref=${info.code}` : null;

  return (
    <div className="relative pb-20">
      <Header />

      <section className="max-w-4xl mx-auto px-6 mt-10 space-y-8">

        {/* Code / link card */}
        <div className="rounded-xl border border-tft-purple/40 bg-card-arcane shadow-arcane-md ring-arcane p-6">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles size={16} className="text-tft-cyan-bright" />
            <h2 className="font-display font-semibold text-xl text-tft-text">Ton lien d&apos;invitation</h2>
          </div>

          {info?.code ? (
            <div className="space-y-3">
              <div className="flex items-stretch gap-2">
                <div className="flex-1 px-4 py-3 rounded-md bg-tft-bg border border-tft-border font-ui font-mono text-sm text-tft-cyan-bright truncate">
                  {link}
                </div>
                <button
                  onClick={copyLink}
                  className="px-4 py-3 rounded-md bg-tft-purple/20 border border-tft-purple/50 hover:border-tft-purple-bright font-ui text-xs uppercase tracking-wider text-tft-purple-bright transition-colors cursor-pointer flex items-center gap-2"
                >
                  <Copy size={13} />
                  {copied ? 'Copié' : 'Copier'}
                </button>
                <button
                  onClick={() => {
                    if (link && typeof navigator.share === 'function') {
                      navigator.share({ title: 'Rejoins-moi sur tft.money', url: link }).catch(() => {});
                    }
                  }}
                  className="px-4 py-3 rounded-md bg-tft-bg-card border border-tft-border hover:border-tft-purple/40 font-ui text-xs uppercase tracking-wider text-tft-text-dim hover:text-tft-text transition-colors cursor-pointer flex items-center gap-2"
                  title="Partager"
                >
                  <Share2 size={13} />
                </button>
              </div>
              <p className="text-xs text-tft-text-muted">
                Code : <span className="text-tft-purple-bright font-semibold">{info.code}</span>. Tout
                user qui crée un compte avec ce code ou via ce lien est lié à toi à vie.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-tft-text-dim">
                Choisis un code à 4-16 caractères (lettres minuscules et chiffres). Une fois créé, il
                est définitif — choisis quelque chose de mémorable.
              </p>
              <div className="flex items-stretch gap-2">
                <input
                  type="text"
                  value={codeInput}
                  onChange={(e) => { setCodeInput(e.target.value.replace(/[^a-z0-9]/gi, '').slice(0, 16)); setError(null); }}
                  placeholder="moncode"
                  className="flex-1 px-4 py-3 rounded-md bg-tft-bg border border-tft-border font-ui font-mono text-sm text-tft-text focus:outline-none focus:border-tft-purple-bright focus:ring-2 focus:ring-tft-purple/30 transition-colors"
                />
                <button
                  onClick={handleCreate}
                  disabled={!codeInput || creating}
                  className={cn(
                    'px-5 py-3 rounded-md font-ui text-xs uppercase tracking-wider transition-all cursor-pointer flex items-center gap-2',
                    !codeInput || creating
                      ? 'bg-tft-bg-elevated border border-tft-border text-tft-text-muted cursor-not-allowed'
                      : 'bg-gradient-rose shadow-rose-md text-white hover:shadow-arcane-md',
                  )}
                >
                  {creating ? 'Création…' : 'Créer'}
                </button>
              </div>
              {error && <p className="text-xs text-tft-rose-bright">{error}</p>}
            </div>
          )}
        </div>

        {/* Stats grid */}
        {info && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard label="Filleuls"            value={String(info.totalReferrals)}                accent="purple" />
            <StatCard label="Commission en cours" value={`${formatCoins(info.pendingCommission)} ◈`} accent="cyan"   />
            <StatCard label="Total touché"        value={`${formatCoins(info.paidCommission)} ◈`}    accent="gold"   />
          </div>
        )}

        {/* Benefits */}
        <div>
          <p className="font-ui text-[11px] tracking-[0.22em] uppercase text-tft-purple-bright mb-4">
            Comment ça marche
          </p>
          <div className="grid md:grid-cols-3 gap-4">
            {BENEFITS.map((b) => (
              <div key={b.title} className="p-5 rounded-xl border border-tft-border bg-tft-bg-card/60">
                <div className="w-10 h-10 rounded-md bg-tft-purple/15 border border-tft-purple/40 flex items-center justify-center mb-3">
                  <b.icon size={18} className="text-tft-purple-bright" />
                </div>
                <h3 className="font-display font-semibold text-base text-tft-text mb-2">{b.title}</h3>
                <p className="text-xs text-tft-text-dim leading-relaxed">{b.body}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Referrals list */}
        {info?.referrals && info.referrals.length > 0 && (
          <div>
            <p className="font-ui text-[11px] tracking-[0.22em] uppercase text-tft-cyan-bright mb-4">
              Tes filleuls
            </p>
            <div className="rounded-xl border border-tft-border bg-tft-bg-card/60 overflow-hidden">
              <div className="hidden md:grid grid-cols-[1fr_120px_120px_100px] gap-4 px-5 py-3 border-b border-tft-border bg-tft-bg-elevated/50">
                <span className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-text-muted">Pseudo</span>
                <span className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-text-muted">Inscrit le</span>
                <span className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-text-muted">Statut</span>
                <span className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-text-muted text-right">Commission</span>
              </div>
              {info.referrals.slice(0, 50).map((r) => (
                <div key={r.username} className="grid grid-cols-[1fr_auto] md:grid-cols-[1fr_120px_120px_100px] gap-3 md:gap-4 px-4 md:px-5 py-3 border-b border-tft-border last:border-0">
                  <span className="text-tft-text font-medium truncate">{r.username}</span>
                  <span className="hidden md:block text-tft-text-dim text-sm">{new Date(r.joinedAt).toLocaleDateString('fr-FR')}</span>
                  <span className="hidden md:block">
                    <span className="px-2 py-0.5 rounded text-[10px] uppercase tracking-wider bg-tft-bg-elevated border border-tft-border text-tft-text-dim">
                      {r.status}
                    </span>
                  </span>
                  <span className="text-right font-ui font-semibold text-sm text-tft-gold-bright tabular-nums">
                    {formatCoins(r.commission)} ◈
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Header() {
  return (
    <section className="relative overflow-hidden bg-hero-arcane border-b border-tft-border">
      <div className="absolute inset-0 bg-hex-grid opacity-15 pointer-events-none" aria-hidden="true" />
      <div className="absolute -top-32 -left-20 w-[420px] h-[420px] rounded-full bg-tft-purple/15 blur-[120px]" aria-hidden="true" />

      <div className="relative max-w-4xl mx-auto px-6 py-16 md:py-20 text-center space-y-5">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-tft-purple/40 bg-tft-purple/10">
          <Hexagon size={11} className="text-tft-cyan-bright" />
          <span className="font-ui text-[11px] tracking-[0.22em] uppercase text-tft-purple-bright">
            Programme affiliés
          </span>
        </div>
        <h1 className="font-display font-bold text-4xl md:text-5xl text-tft-text leading-tight">
          Invite tes potes, gagne <span className="text-arcane">5%</span>
        </h1>
        <p className="text-tft-text-dim text-base max-w-2xl mx-auto">
          5% de la house edge sur tous leurs paris à vie. Tu touches même quand ils gagnent.
        </p>
      </div>
    </section>
  );
}

function StatCard({ label, value, accent }: {
  label: string;
  value: string;
  accent: 'purple' | 'cyan' | 'gold';
}) {
  const colorMap = {
    purple: { ring: 'border-tft-purple/40', val: 'text-tft-purple-bright' },
    cyan:   { ring: 'border-tft-cyan/40',   val: 'text-tft-cyan-bright' },
    gold:   { ring: 'border-tft-gold/40',   val: 'text-tft-gold-bright' },
  } as const;
  const c = colorMap[accent];
  return (
    <div className={cn('rounded-xl border bg-tft-bg-card/60 p-5', c.ring)}>
      <p className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-text-muted mb-1.5">{label}</p>
      <p className={cn('font-display font-bold text-2xl md:text-3xl tabular-nums', c.val)}>{value}</p>
    </div>
  );
}

function AffiliateSkeleton() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-20 animate-pulse space-y-6">
      <div className="h-10 w-1/2 mx-auto rounded bg-tft-bg-elevated" />
      <div className="h-20 rounded bg-tft-bg-card" />
      <div className="grid md:grid-cols-3 gap-4">
        <div className="h-24 rounded bg-tft-bg-card" />
        <div className="h-24 rounded bg-tft-bg-card" />
        <div className="h-24 rounded bg-tft-bg-card" />
      </div>
    </div>
  );
}
