'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  User, Wallet, TrendingUp, Trophy, Calendar, ExternalLink,
  ChevronRight, Hexagon, ArrowRight, ShieldCheck, Sparkles,
} from 'lucide-react';
import { cn, formatCoins } from '@/lib/utils';
import { getMe, getMyTftBets, type TftBet, type MeResponse } from '@/lib/api';
import { computeLevel, levelTier, tierColor } from '@/lib/level';

type BetFilter = 'all' | 'PENDING' | 'WON' | 'LOST' | 'REFUNDED';
const FILTERS: { key: BetFilter; label: string }[] = [
  { key: 'all',      label: 'Tous' },
  { key: 'PENDING',  label: 'En cours' },
  { key: 'WON',      label: 'Gagnés' },
  { key: 'LOST',     label: 'Perdus' },
  { key: 'REFUNDED', label: 'Remboursés' },
];

export default function ProfilePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [bets, setBets] = useState<TftBet[] | null>(null);
  const [filter, setFilter] = useState<BetFilter>('all');

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/');
  }, [status, router]);

  useEffect(() => {
    if (!session?.user?.accessToken) return;
    getMe().then(setMe);
  }, [session?.user?.accessToken]);

  useEffect(() => {
    if (!session?.user?.accessToken) return;
    getMyTftBets(filter === 'all' ? undefined : filter).then(setBets);
  }, [session?.user?.accessToken, filter]);

  if (status === 'loading' || !session) return <ProfileSkeleton />;

  return (
    <div className="relative pb-20">
      <ProfileHeader me={me} session={session} />

      <section className="max-w-6xl mx-auto px-6 mt-10 grid lg:grid-cols-[1fr_320px] gap-8">
        <div className="space-y-8 min-w-0">
          <BetsHistory bets={bets} filter={filter} setFilter={setFilter} />
        </div>

        <aside className="lg:sticky lg:top-20 lg:self-start space-y-5">
          <QuickActions me={me} />
          <ResponsibleGamingCard />
        </aside>
      </section>
    </div>
  );
}

/* ────────────────────────── Header ────────────────────────── */
function ProfileHeader({
  me,
  session,
}: {
  me: MeResponse | null;
  session: NonNullable<ReturnType<typeof useSession>['data']>;
}) {
  const username = me?.username ?? session.user.name ?? 'Tactician';
  const avatar = me?.avatar ?? session.user.image ?? null;
  const coins  = me?.coins ?? session.user.coins ?? 0;
  const wagered = me?.totalWagered ?? 0;
  const { level, pct } = computeLevel(wagered);
  const tier = levelTier(level);
  const lvlColor = tierColor(tier);
  const memberSince = me?.createdAt
    ? new Date(me.createdAt).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    : '—';

  return (
    <section className="relative overflow-hidden bg-hero-arcane border-b border-tft-border">
      <div className="absolute inset-0 bg-hex-grid opacity-15 pointer-events-none" aria-hidden="true" />
      <div className="absolute -top-32 -left-20 w-[420px] h-[420px] rounded-full bg-tft-purple/15 blur-[120px]" aria-hidden="true" />
      <div className="absolute -bottom-32 -right-20 w-[420px] h-[420px] rounded-full bg-tft-cyan/10 blur-[120px]" aria-hidden="true" />

      <div className="relative max-w-6xl mx-auto px-6 pt-12 pb-10">
        <div className="flex items-center gap-5">
          <div className="relative shrink-0">
            <div
              className="w-20 h-20 md:w-24 md:h-24 rounded-md bg-tft-bg-card overflow-hidden shadow-arcane-md flex items-center justify-center"
              style={{ border: `2px solid ${lvlColor}99` }}
            >
              {avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatar} alt={username} className="w-full h-full object-cover" />
              ) : (
                <User size={36} className="text-tft-purple-bright" />
              )}
            </div>
            {/* Level badge over the avatar — same pattern as the chat row */}
            <div
              className="absolute -bottom-1.5 -right-1.5 font-ui font-black text-[11px] tabular-nums rounded-sm flex items-center justify-center px-1.5 py-0.5 shadow-md"
              style={{ background: lvlColor, color: '#07060f', minWidth: 24 }}
            >
              {level}
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-text-muted mb-1">
              Profil
            </p>
            <h1 className="font-display font-bold text-3xl md:text-4xl text-tft-text leading-tight truncate">
              {username}
            </h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-tft-text-dim text-sm">Membre depuis {memberSince}</span>
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[9.5px] font-bold uppercase tracking-wider border"
                style={{ background: `${lvlColor}1a`, color: lvlColor, borderColor: `${lvlColor}55` }}
              >
                {tier}
              </span>
              {me?.isAdmin && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[9.5px] font-bold uppercase tracking-wider bg-tft-rose/15 border border-tft-rose/40 text-tft-rose-bright">
                  Admin
                </span>
              )}
            </div>
            {/* Level progress bar — only when there's actually a next level to grind for */}
            {level < 20 && (
              <div className="mt-3 max-w-md">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-ui text-[9.5px] tracking-[0.18em] uppercase text-tft-text-muted">
                    Niveau {level} → {level + 1}
                  </span>
                  <span className="font-ui text-[10px] tabular-nums text-tft-text-dim">{pct.toFixed(0)}%</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden bg-tft-bg-elevated">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${pct}%`, background: lvlColor }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-8 grid grid-cols-2 md:grid-cols-3 gap-4">
          <StatTile icon={Wallet}      label="Solde"          value={`${formatCoins(coins)} ◈`}   accent="purple" />
          <StatTile icon={TrendingUp} label="Total wagered"   value={`${formatCoins(wagered)} ◈`} accent="cyan"   />
          <StatTile icon={Hexagon}    label={`Niveau ${level}`} value={tier[0].toUpperCase() + tier.slice(1)} accent="gold" />
        </div>
      </div>
    </section>
  );
}

function StatTile({
  icon: Icon, label, value, accent,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  accent: 'purple' | 'cyan' | 'gold';
}) {
  const colorMap = {
    purple: { ring: 'border-tft-purple/40', icon: 'text-tft-purple-bright', valColor: 'text-tft-purple-bright' },
    cyan:   { ring: 'border-tft-cyan/40',   icon: 'text-tft-cyan-bright',   valColor: 'text-tft-cyan-bright' },
    gold:   { ring: 'border-tft-gold/40',   icon: 'text-tft-gold-bright',   valColor: 'text-tft-gold-bright' },
  } as const;
  const c = colorMap[accent];
  return (
    <div className={cn('rounded-xl border bg-tft-bg-card/60 backdrop-blur-sm p-4', c.ring)}>
      <div className="flex items-center gap-2 mb-1.5">
        <Icon size={13} className={c.icon} />
        <span className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-text-muted">{label}</span>
      </div>
      <p className={cn('font-display font-bold text-xl md:text-2xl tabular-nums', c.valColor)}>{value}</p>
    </div>
  );
}

/* ────────────────────────── Bets history ────────────────────────── */
function BetsHistory({
  bets, filter, setFilter,
}: {
  bets: TftBet[] | null;
  filter: BetFilter;
  setFilter: (f: BetFilter) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="font-ui text-[11px] tracking-[0.22em] uppercase text-tft-purple-bright mb-1">
            Historique
          </p>
          <h2 className="font-display font-bold text-2xl md:text-3xl text-tft-text">
            Mes paris TFT
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                'px-3 py-1.5 rounded-md font-ui text-[11px] tracking-wider uppercase transition-all cursor-pointer',
                filter === f.key
                  ? 'bg-tft-purple/20 border border-tft-purple-bright text-tft-purple-bright'
                  : 'bg-tft-bg-card/60 border border-tft-border text-tft-text-dim hover:text-tft-text hover:border-tft-purple/40',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {bets === null && <BetsSkeleton />}

      {bets && bets.length === 0 && (
        <div className="rounded-xl border border-tft-border bg-tft-bg-card/50 p-10 text-center">
          <Trophy size={28} className="text-tft-purple-bright mx-auto mb-3 opacity-50" />
          <h3 className="font-display font-semibold text-lg text-tft-text mb-2">
            Aucun pari {filter !== 'all' ? FILTERS.find((f) => f.key === filter)?.label.toLowerCase() : ''}
          </h3>
          <p className="text-sm text-tft-text-dim max-w-md mx-auto mb-5">
            Tu n&apos;as pas encore placé de pari sur la scène TFT. Direction la page des tournois
            pour voir ce qui est ouvert ce soir.
          </p>
          <Link
            href="/tournaments"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-gradient-rose shadow-rose-md font-ui font-semibold text-[12px] uppercase tracking-wider text-white hover:shadow-arcane-md cursor-pointer transition-all"
          >
            Voir les tournois
            <ChevronRight size={14} />
          </Link>
        </div>
      )}

      {bets && bets.length > 0 && (
        <div className="space-y-2.5">
          {bets.map((bet) => <BetRow key={bet.id} bet={bet} />)}
        </div>
      )}
    </div>
  );
}

function BetRow({ bet }: { bet: TftBet }) {
  const date = new Date(bet.placedAt).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });

  const statusStyle = {
    PENDING:   { color: 'text-tft-cyan-bright',  bg: 'bg-tft-cyan-dim',        border: 'border-tft-cyan/40',  label: 'En cours' },
    WON:       { color: 'text-tft-mint',         bg: 'bg-tft-mint/15',          border: 'border-tft-mint/40',  label: 'Gagné'    },
    LOST:      { color: 'text-tft-rose-bright',  bg: 'bg-tft-rose/15',          border: 'border-tft-rose/40',  label: 'Perdu'    },
    REFUNDED:  { color: 'text-tft-text-dim',     bg: 'bg-tft-bg-elevated',     border: 'border-tft-border',   label: 'Remboursé'},
    CANCELLED: { color: 'text-tft-text-dim',     bg: 'bg-tft-bg-elevated',     border: 'border-tft-border',   label: 'Annulé'   },
  }[bet.status];

  return (
    <Link
      href={`/tournaments/${bet.tournamentId}`}
      className="block p-4 rounded-lg border border-tft-border bg-tft-bg-card/60 hover:border-tft-purple/40 transition-all cursor-pointer"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border', statusStyle.bg, statusStyle.border, statusStyle.color)}>
              {statusStyle.label}
            </span>
            <span className="font-ui text-[10px] tracking-wider uppercase text-tft-text-muted">
              <Calendar size={9} className="inline mr-1" />
              {date}
            </span>
          </div>
          <p className="font-medium text-tft-text truncate">{bet.tournamentName}</p>
          <p className="text-xs text-tft-text-dim truncate mt-0.5">
            Sur <span className="text-tft-purple-bright">{bet.participantName}</span>
            {bet.participantCountry && <span className="ml-1">{bet.participantCountry}</span>}
          </p>
        </div>
        <ChevronRight size={16} className="text-tft-text-muted shrink-0 mt-1" />
      </div>

      <div className="grid grid-cols-3 gap-3 pt-3 border-t border-tft-border">
        <div>
          <p className="font-ui text-[9px] tracking-[0.22em] uppercase text-tft-text-muted mb-0.5">Mise</p>
          <p className="font-ui font-semibold text-sm text-tft-text tabular-nums">{formatCoins(bet.stake)} ◈</p>
        </div>
        <div>
          <p className="font-ui text-[9px] tracking-[0.22em] uppercase text-tft-text-muted mb-0.5">Côte</p>
          <p className="font-ui font-semibold text-sm text-tft-purple-bright tabular-nums">{parseFloat(bet.oddsAtBet).toFixed(2)}×</p>
        </div>
        <div>
          <p className="font-ui text-[9px] tracking-[0.22em] uppercase text-tft-text-muted mb-0.5">
            {bet.status === 'WON' || bet.status === 'REFUNDED' ? 'Payout' : 'Gain potentiel'}
          </p>
          <p className={cn(
            'font-ui font-semibold text-sm tabular-nums',
            bet.status === 'WON' ? 'text-tft-mint' :
            bet.status === 'LOST' ? 'text-tft-rose-bright' :
            'text-tft-gold-bright',
          )}>
            {formatCoins(bet.payout ?? bet.potentialPayout)} ◈
          </p>
        </div>
      </div>
    </Link>
  );
}

function BetsSkeleton() {
  return (
    <div className="space-y-2.5">
      {[0, 1, 2].map((i) => (
        <div key={i} className="p-4 rounded-lg border border-tft-border bg-tft-bg-card/60 animate-pulse">
          <div className="flex items-center justify-between mb-3">
            <div className="space-y-2">
              <div className="h-3 w-32 rounded bg-tft-bg-elevated" />
              <div className="h-4 w-48 rounded bg-tft-bg-elevated" />
            </div>
            <div className="h-3 w-12 rounded bg-tft-bg-elevated" />
          </div>
          <div className="grid grid-cols-3 gap-3 pt-3 border-t border-tft-border">
            <div className="space-y-1.5"><div className="h-2 w-10 rounded bg-tft-bg-elevated" /><div className="h-4 w-16 rounded bg-tft-bg-elevated" /></div>
            <div className="space-y-1.5"><div className="h-2 w-10 rounded bg-tft-bg-elevated" /><div className="h-4 w-12 rounded bg-tft-bg-elevated" /></div>
            <div className="space-y-1.5"><div className="h-2 w-10 rounded bg-tft-bg-elevated" /><div className="h-4 w-20 rounded bg-tft-bg-elevated" /></div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ────────────────────────── Sidebar ────────────────────────── */
function QuickActions({ me }: { me: MeResponse | null }) {
  const actions = [
    { href: '/deposit',  icon: ArrowRight, label: 'Déposer en crypto', accent: 'rose' as const   },
    { href: '/withdraw', icon: ArrowRight, label: 'Retirer',           accent: 'gold' as const   },
    { href: '/affiliate', icon: Sparkles,  label: 'Programme affiliés', accent: 'purple' as const },
  ];

  return (
    <div className="rounded-xl border border-tft-border bg-card-arcane p-5 space-y-3">
      <p className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-purple-bright">
        Actions rapides
      </p>
      <div className="space-y-2">
        {actions.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="flex items-center justify-between p-3 rounded-md border border-tft-border bg-tft-bg-card/60 hover:border-tft-purple/40 transition-colors cursor-pointer"
          >
            <span className="font-ui text-sm text-tft-text">{a.label}</span>
            <ChevronRight size={14} className="text-tft-text-muted" />
          </Link>
        ))}
      </div>

      {me && (
        <div className="pt-3 border-t border-tft-border text-xs text-tft-text-muted">
          {me.email
            ? <>Email lié : <span className="text-tft-text-dim">{me.email}</span></>
            : <>Aucun email lié — <Link href="/profile/settings" className="text-tft-cyan-bright hover:underline">en ajouter un</Link></>}
        </div>
      )}
    </div>
  );
}

function ResponsibleGamingCard() {
  return (
    <Link href="/responsible-gaming" className="block rounded-xl border border-tft-mint/30 bg-tft-mint/5 p-5 hover:border-tft-mint/50 transition-colors cursor-pointer">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-md bg-tft-mint/15 border border-tft-mint/40 flex items-center justify-center">
          <ShieldCheck size={18} className="text-tft-mint" />
        </div>
        <p className="font-display font-semibold text-base text-tft-text">Garde le contrôle</p>
      </div>
      <p className="text-xs text-tft-text-dim leading-relaxed">
        Time-out, plafond de mise, auto-exclusion — tous les outils sont là si tu as besoin de mettre un cap. 18+ uniquement.
      </p>
      <div className="mt-3 inline-flex items-center gap-1 text-xs text-tft-mint">
        En savoir plus
        <ExternalLink size={11} />
      </div>
    </Link>
  );
}

function ProfileSkeleton() {
  return (
    <div className="relative pb-20">
      <section className="relative overflow-hidden bg-hero-arcane border-b border-tft-border">
        <div className="relative max-w-6xl mx-auto px-6 pt-12 pb-10 animate-pulse">
          <div className="flex items-center gap-5">
            <div className="w-24 h-24 rounded-md bg-tft-bg-elevated" />
            <div className="space-y-2">
              <div className="h-3 w-16 rounded bg-tft-bg-elevated" />
              <div className="h-8 w-48 rounded bg-tft-bg-elevated" />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
