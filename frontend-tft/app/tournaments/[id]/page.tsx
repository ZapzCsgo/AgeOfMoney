'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  Calendar, MapPin, Users, ExternalLink, ChevronLeft,
  Hexagon, Info, ShieldCheck, TrendingUp, Award, AlertTriangle,
} from 'lucide-react';
import { cn, formatCoins } from '@/lib/utils';
import {
  getTftTournament, placeTournamentWinnerBet,
  type TftTournament, type TftParticipant, type TftBetMarket,
} from '@/lib/api';

/** Market metadata shared between the tabs row, the participant list and
 *  the bet form. Centralised here so the labels / odds-accessor / settle
 *  rule stay in sync. */
const MARKETS: Array<{
  key: TftBetMarket;
  label: string;
  shortLabel: string;
  pitch: string;
  settleRule: string;
  /** Returns the odd for this market on a participant, or null if not priced yet. */
  oddOf: (p: TftParticipant) => number | null;
}> = [
  {
    key: 'WINNER',
    label: 'Tournament Winner',
    shortLabel: 'Winner',
    pitch: 'Parie sur le tacticien qui soulèvera le trophée.',
    settleRule: 'Settle si finalRank = 1.',
    oddOf: (p) => p.odds,
  },
  {
    key: 'TOP_4',
    label: 'Top 4 finish',
    shortLabel: 'Top 4',
    pitch: 'Le joueur finit dans les 4 premiers (= qualif lobby finals).',
    settleRule: 'Settle si finalRank ≤ 4.',
    oddOf: (p) => p.oddsTop4,
  },
  {
    key: 'TOP_8',
    label: 'Top 8 finish',
    shortLabel: 'Top 8',
    pitch: 'Le joueur finit dans les 8 premiers (= qualif finals Day 3).',
    settleRule: 'Settle si finalRank ≤ 8.',
    oddOf: (p) => p.oddsTop8,
  },
];

export default function TournamentPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [tournament, setTournament] = useState<TftTournament | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [loading, setLoading]       = useState(true);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    getTftTournament(id)
      .then((t) => {
        if (cancelled) return;
        setTournament(t);
        setError(t ? null : 'Tournoi introuvable');
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Erreur de chargement');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  // Live-refresh while the bracket is running — every 30s the backend pollers
  // update standings ; we mirror that cadence here so currentRank stays fresh.
  useEffect(() => {
    if (!id || !tournament?.bracketStarted) return;
    const interval = setInterval(() => {
      getTftTournament(id).then((t) => { if (t) setTournament(t); });
    }, 30_000);
    return () => clearInterval(interval);
  }, [id, tournament?.bracketStarted]);

  if (loading) return <TournamentSkeleton />;
  if (error || !tournament) return <TournamentError message={error ?? 'Tournoi introuvable'} />;

  return <TournamentView tournament={tournament} />;
}

/* ───────────────────────── Main view ───────────────────────── */

function TournamentView({ tournament }: { tournament: TftTournament }) {
  const [market, setMarket] = useState<TftBetMarket>('WINNER');
  const marketDef = MARKETS.find((m) => m.key === market) ?? MARKETS[0];

  // Sort by the active market's odds (favourites first). Participants
  // missing a market price fall to the back of the list.
  const participants = useMemo(() => {
    const all = tournament.participants ?? [];
    return [...all].sort((a, b) => {
      const oa = marketDef.oddOf(a);
      const ob = marketDef.oddOf(b);
      if (oa === null && ob === null) return 0;
      if (oa === null) return 1;
      if (ob === null) return -1;
      return oa - ob;
    });
  }, [tournament.participants, marketDef]);

  const [selected, setSelected] = useState<string>(participants[0]?.id ?? '');
  const pick = participants.find((p) => p.id === selected) ?? participants[0];

  const formatDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '—';

  return (
    <div className="relative min-h-screen pb-20">
      {/* ── Header strip ─────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-tft-border bg-hero-arcane">
        <div className="absolute inset-0 bg-hex-grid opacity-15 pointer-events-none" aria-hidden="true" />
        <div className="absolute -top-32 -left-20 w-[420px] h-[420px] rounded-full bg-tft-purple/15 blur-[120px]" aria-hidden="true" />
        <div className="absolute -bottom-32 -right-20 w-[420px] h-[420px] rounded-full bg-tft-cyan/10 blur-[120px]" aria-hidden="true" />

        <div className="relative max-w-6xl mx-auto px-6 pt-10 pb-12">
          <Link
            href="/tournaments"
            className="inline-flex items-center gap-1.5 text-tft-text-muted hover:text-tft-cyan-bright transition-colors text-sm font-ui mb-6"
          >
            <ChevronLeft size={14} />
            Tous les tournois
          </Link>

          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div className="space-y-3 flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {tournament.bracketStarted ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-tft-rose/15 border border-tft-rose/40 font-ui text-[10px] tracking-[0.22em] uppercase text-tft-rose-bright">
                    <span className="w-1.5 h-1.5 rounded-full bg-tft-rose animate-pulse-live" />
                    Live
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-tft-cyan-dim border border-tft-cyan/40 font-ui text-[10px] tracking-[0.22em] uppercase text-tft-cyan-bright">
                    À venir
                  </span>
                )}
                <span className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-text-muted">
                  {tournament.tier}-Tier
                </span>
                {tournament.liveSyncSource && (
                  <span className="font-ui text-[9px] tracking-[0.22em] uppercase text-tft-text-faint">
                    Sync · {tournament.liveSyncSource}
                  </span>
                )}
              </div>

              <h1 className="font-display font-bold text-3xl md:text-5xl text-tft-text leading-tight">
                {tournament.name}
              </h1>

              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-tft-text-dim text-sm">
                <span className="inline-flex items-center gap-1.5">
                  <Calendar size={14} className="text-tft-purple-bright" />
                  {formatDate(tournament.startDate)} → {formatDate(tournament.endDate)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Users size={14} className="text-tft-purple-bright" />
                  {participants.length} tacticians
                </span>
                {tournament.liquipediaUrl && (
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin size={14} className="text-tft-purple-bright" />
                    Liquipedia
                  </span>
                )}
              </div>
            </div>

            {tournament.prizePool && (
              <div className="shrink-0 rounded-xl border border-tft-gold/40 bg-tft-bg-card/70 backdrop-blur-md px-6 py-4 shadow-gold-md">
                <p className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-text-muted mb-1">Prize pool</p>
                <p className="font-display font-bold text-3xl text-tft-gold-bright tabular-nums">
                  {tournament.prizePool}
                </p>
              </div>
            )}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            {tournament.twitchChannel && (
              <a
                href={`https://twitch.tv/${tournament.twitchChannel}`}
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[#9146ff]/20 border border-[#9146ff]/50 hover:bg-[#9146ff]/30 transition-colors font-ui text-[12px] uppercase tracking-wider text-[#c4a8ff] cursor-pointer"
              >
                <ExternalLink size={12} />
                Regarder sur Twitch
              </a>
            )}
            {tournament.competeTftUrl && (
              <a
                href={tournament.competeTftUrl}
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-tft-bg-card border border-tft-border hover:border-tft-purple/50 transition-colors font-ui text-[12px] uppercase tracking-wider text-tft-text-dim cursor-pointer"
              >
                <ExternalLink size={12} />
                CompeteTFT
              </a>
            )}
            {tournament.liquipediaUrl && (
              <a
                href={tournament.liquipediaUrl}
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-tft-bg-card border border-tft-border hover:border-tft-purple/50 transition-colors font-ui text-[12px] uppercase tracking-wider text-tft-text-dim cursor-pointer"
              >
                <ExternalLink size={12} />
                Liquipedia
              </a>
            )}
          </div>
        </div>
      </section>

      {/* ── Main grid : participants + bet form ───────────────────── */}
      <section className="max-w-6xl mx-auto px-6 mt-10 grid lg:grid-cols-[1fr_360px] gap-8">

        <div className="space-y-8 min-w-0">
          <div className="flex items-end justify-between flex-wrap gap-3">
            <div>
              <p className="font-ui text-[11px] tracking-[0.22em] uppercase text-tft-purple-bright mb-1">
                Marché actif
              </p>
              <h2 className="font-display font-bold text-2xl md:text-3xl text-tft-text">
                {marketDef.label}
              </h2>
              <p className="text-tft-text-dim text-sm mt-1">{marketDef.pitch}</p>
            </div>
            <div className="hidden md:flex items-center gap-1.5 text-tft-text-muted text-xs">
              <Info size={13} className="text-tft-cyan-bright" />
              Odds maison
            </div>
          </div>

          {/* Market tabs — Winner / Top 4 / Top 8 */}
          <MarketTabs market={market} setMarket={setMarket} participants={tournament.participants ?? []} />

          <ParticipantList
            participants={participants}
            selectedId={selected}
            onSelect={setSelected}
            bracketStarted={tournament.bracketStarted}
            marketDef={marketDef}
          />

          <LiveStandingsCard
            tournament={tournament}
            participants={participants}
          />

          <div className="rounded-xl border border-tft-border bg-card-arcane p-5 flex flex-col sm:flex-row items-center gap-4">
            <div className="w-12 h-12 rounded-md bg-tft-mint/15 border border-tft-mint/40 flex items-center justify-center shrink-0">
              <ShieldCheck size={20} className="text-tft-mint" />
            </div>
            <div>
              <p className="font-display font-semibold text-tft-text text-base mb-1">
                Résultats sourcés en temps réel
              </p>
              <p className="text-sm text-tft-text-dim leading-relaxed">
                Sources primaires : CompeteTFT (plateforme officielle Riot) + Liquipedia community.
                Settlement automatique dès la cloche de fin — pas de jugement manuel.
              </p>
            </div>
          </div>
        </div>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <BetForm
            tournamentId={tournament.id}
            pick={pick}
            bracketStarted={tournament.bracketStarted}
            participantCount={participants.length}
            market={market}
            marketDef={marketDef}
          />

          <div className="mt-4 rounded-xl border border-tft-border bg-tft-bg-card/50 p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-tft-gold/15 border border-tft-gold/40 flex items-center justify-center shrink-0">
              <Award size={16} className="text-tft-gold-bright" />
            </div>
            <p className="text-xs text-tft-text-dim leading-relaxed">
              Tes paris en cours sont visibles dans{' '}
              <Link href="/profile" className="text-tft-cyan-bright hover:underline">ton profil</Link>.
            </p>
          </div>
        </aside>
      </section>
    </div>
  );
}

/* ───────────────────────── Market tabs ───────────────────────── */
function MarketTabs({
  market, setMarket, participants,
}: {
  market: TftBetMarket;
  setMarket: (m: TftBetMarket) => void;
  participants: TftParticipant[];
}) {
  // Disable a tab when the odds engine hasn't priced it yet for ANY
  // participant (i.e. all oddsTopK are null). Reduces confusion vs
  // showing a tab where every pick says "—".
  function tabAvailable(key: TftBetMarket): boolean {
    const def = MARKETS.find((m) => m.key === key)!;
    return participants.some((p) => def.oddOf(p) !== null);
  }

  return (
    <div className="inline-flex items-center gap-1 p-1 rounded-md bg-tft-bg-card border border-tft-border">
      {MARKETS.map((m) => {
        const active = m.key === market;
        const enabled = tabAvailable(m.key);
        return (
          <button
            key={m.key}
            onClick={() => enabled && setMarket(m.key)}
            disabled={!enabled}
            className={cn(
              'px-4 py-1.5 rounded-sm font-ui text-[11px] tracking-[0.18em] uppercase transition-colors cursor-pointer',
              active
                ? 'bg-tft-purple text-white shadow-arcane-sm'
                : enabled
                  ? 'text-tft-text-dim hover:text-tft-text hover:bg-tft-bg-hover'
                  : 'text-tft-text-faint opacity-50 cursor-not-allowed',
            )}
            title={enabled ? m.pitch : 'Cotes pas encore calculées'}
          >
            {m.shortLabel}
          </button>
        );
      })}
    </div>
  );
}

/* ───────────────────────── Participants list ───────────────────────── */
function ParticipantList({
  participants, selectedId, onSelect, bracketStarted, marketDef,
}: {
  participants: TftParticipant[];
  selectedId: string;
  onSelect: (id: string) => void;
  bracketStarted: boolean;
  marketDef: typeof MARKETS[number];
}) {
  return (
    <div className="rounded-xl border border-tft-border bg-tft-bg-card/60 overflow-hidden">
      <div className="hidden md:grid grid-cols-[1fr_auto_140px_120px_100px] gap-4 px-5 py-3 border-b border-tft-border bg-tft-bg-elevated/50">
        <span className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-text-muted">Tacticien</span>
        <span className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-text-muted">Région</span>
        <span className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-text-muted">Rank</span>
        <span className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-text-muted">Côte</span>
        <span className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-text-muted text-right">Action</span>
      </div>

      {participants.length === 0 && (
        <div className="px-5 py-10 text-center text-sm text-tft-text-muted">
          Liste des participants pas encore publiée par Liquipedia.<br />
          Reviens dans quelques heures.
        </div>
      )}

      {participants.map((p) => {
        const isSelected = selectedId === p.id;
        const odd = marketDef.oddOf(p);
        const rankPill = p.currentRank
          ? `${ordinalFr(p.currentRank)} live`
          : p.finalRank
            ? `${ordinalFr(p.finalRank)} final`
            : '—';
        return (
          <button
            key={p.id}
            onClick={() => onSelect(p.id)}
            disabled={bracketStarted || odd === null}
            className={cn(
              'w-full text-left grid grid-cols-[1fr_auto] md:grid-cols-[1fr_auto_140px_120px_100px] gap-3 md:gap-4',
              'px-4 md:px-5 py-3 border-b border-tft-border last:border-0 transition-all',
              bracketStarted || odd === null ? 'cursor-not-allowed opacity-70' : 'cursor-pointer',
              isSelected
                ? 'bg-tft-purple/10 border-l-2 border-l-tft-purple-bright'
                : 'hover:bg-tft-bg-hover',
            )}
            aria-pressed={isSelected}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="shrink-0 w-9 h-9 rounded-md bg-tft-bg-elevated border border-tft-border flex items-center justify-center font-ui font-bold text-tft-purple-bright">
                {p.name.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="font-medium text-tft-text truncate">{p.name}</p>
                <p className="text-[11px] text-tft-text-muted truncate">
                  {p.currentTier ?? 'Stats Riot pas encore récupérées'}
                </p>
              </div>
            </div>

            <div className="hidden md:flex items-center gap-2">
              {p.country && <span className="font-ui text-[11px] tracking-wider uppercase text-tft-text-dim">{p.country}</span>}
            </div>

            <div className="hidden md:flex items-center gap-1.5">
              {p.currentRank || p.finalRank ? (
                <span className="font-ui text-xs text-tft-text-dim">{rankPill}</span>
              ) : (
                <TrendingUp size={14} className="text-tft-text-muted" />
              )}
            </div>

            <div className="text-right md:text-left">
              <p className="font-ui font-bold text-lg text-tft-purple-bright tabular-nums">
                {odd !== null ? `${odd.toFixed(2)}×` : '—'}
              </p>
              {p.country && (
                <p className="font-ui text-[10px] tracking-wider uppercase text-tft-text-muted md:hidden">
                  {p.country}
                </p>
              )}
            </div>

            <div className="hidden md:flex items-center justify-end">
              <span
                className={cn(
                  'px-3 py-1.5 rounded font-ui text-[11px] tracking-wider uppercase border transition-all',
                  isSelected
                    ? 'bg-tft-purple text-white border-tft-purple-bright shadow-arcane-sm'
                    : 'bg-transparent text-tft-text-dim border-tft-border',
                )}
              >
                {isSelected ? 'Sélectionné' : 'Parier'}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function ordinalFr(n: number): string {
  return n === 1 ? '1er' : `${n}e`;
}

/* ───────────────────────── Live standings card ───────────────────────── */
function LiveStandingsCard({
  tournament, participants,
}: {
  tournament: TftTournament;
  participants: TftParticipant[];
}) {
  const ranked = participants
    .filter((p) => p.currentRank !== null || p.finalRank !== null)
    .sort((a, b) => (a.currentRank ?? a.finalRank ?? 99) - (b.currentRank ?? b.finalRank ?? 99))
    .slice(0, 4);

  return (
    <div className="rounded-xl border border-tft-border bg-tft-bg-card/60 p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="font-ui text-[11px] tracking-[0.22em] uppercase text-tft-cyan-bright mb-1">
            Classement live
          </p>
          <h3 className="font-display font-semibold text-xl text-tft-text">Top 4</h3>
        </div>
        <span className="font-ui text-[10px] tracking-wider uppercase text-tft-text-muted">
          {tournament.liveSyncSource ? `Source · ${tournament.liveSyncSource}` : 'Pas encore sync'}
        </span>
      </div>

      {!tournament.bracketStarted ? (
        <div className="py-10 text-center text-tft-text-muted text-sm">
          Le tournoi commence le{' '}
          <strong className="text-tft-text">
            {new Date(tournament.startDate).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
          </strong>.
          <br />
          Le classement live s&apos;affichera ici dès le coup d&apos;envoi.
        </div>
      ) : ranked.length === 0 ? (
        <div className="py-10 text-center text-tft-text-muted text-sm">
          En attente de la première mise à jour des standings...
        </div>
      ) : (
        <div className="space-y-2">
          {ranked.map((p) => {
            const rank = p.finalRank ?? p.currentRank!;
            return (
              <div key={p.id} className="flex items-center justify-between px-3 py-2 rounded-md bg-tft-bg-elevated/50 border border-tft-border">
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full bg-tft-purple/15 border border-tft-purple/40 flex items-center justify-center font-ui font-bold text-xs text-tft-purple-bright">
                    {rank}
                  </span>
                  <span className="text-tft-text">{p.name}</span>
                  {p.country && <span className="text-base">{p.country}</span>}
                </div>
                <span className="font-ui font-semibold text-tft-purple-bright tabular-nums">
                  {p.odds.toFixed(2)}×
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Bet form ───────────────────────── */
function BetForm({
  tournamentId, pick, bracketStarted, participantCount, market, marketDef,
}: {
  tournamentId: string;
  pick: TftParticipant | undefined;
  bracketStarted: boolean;
  participantCount: number;
  market: TftBetMarket;
  marketDef: typeof MARKETS[number];
}) {
  const [stake, setStake]     = useState<string>('25');
  const [posting, setPosting] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [success, setSuccess] = useState<{ payout: string } | null>(null);

  const stakeNum     = parseFloat(stake) || 0;
  const odds         = pick ? (marketDef.oddOf(pick) ?? 0) : 0;
  const potential    = useMemo(() => stakeNum * odds, [stakeNum, odds]);
  const stakeInvalid = stakeNum <= 0 || stakeNum > 10_000;
  const oddsMissing  = pick && marketDef.oddOf(pick) === null;
  const disabled     = bracketStarted || participantCount === 0 || !pick || stakeInvalid || !!oddsMissing;

  // Clear any post-submit feedback when the user switches market — keeps
  // the form state coherent (the previous success/error referenced a
  // different market's odds and would be confusing if we kept showing it).
  useEffect(() => {
    setSuccess(null); setError(null);
  }, [market]);

  async function handleSubmit() {
    if (!pick) return;
    setPosting(true); setError(null); setSuccess(null);
    try {
      const bet = await placeTournamentWinnerBet({
        tournamentId,
        participantId: pick.id,
        market,
        stake: stakeNum,
        expectedOdds: odds,
      });
      setSuccess({ payout: bet.potentialPayout });
    } catch (err) {
      const msg = err instanceof Error
        ? (err as Error & { response?: { data?: { error?: string } } }).response?.data?.error ?? err.message
        : 'Erreur';
      setError(msg);
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="rounded-xl border border-tft-purple/40 bg-card-arcane shadow-arcane-md ring-arcane overflow-hidden">
      <div className="px-5 py-4 border-b border-tft-border flex items-center gap-2">
        <Hexagon size={16} className="text-tft-cyan-bright" />
        <h3 className="font-display font-semibold text-lg text-tft-text">Placer un pari</h3>
      </div>

      <div className="p-5 space-y-5">
        {bracketStarted && (
          <div className="rounded-md border border-tft-rose/40 bg-tft-rose/10 px-3 py-2 text-xs text-tft-rose-bright flex items-center gap-2">
            <AlertTriangle size={14} />
            Bracket déjà démarré — paris fermés.
          </div>
        )}

        {pick ? (
          <div className="p-4 rounded-lg bg-tft-purple/10 border border-tft-purple/30">
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-text-muted">
                Tu paries sur
              </p>
              <span className="font-ui text-[9.5px] tracking-[0.18em] uppercase px-1.5 py-0.5 rounded-sm bg-tft-purple/20 border border-tft-purple/40 text-tft-purple-bright">
                {marketDef.shortLabel}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {pick.country && <span className="text-2xl">{pick.country}</span>}
                <div className="min-w-0">
                  <p className="font-display font-semibold text-lg text-tft-text truncate">{pick.name}</p>
                  <p className="text-[11px] text-tft-text-muted truncate">
                    {pick.currentTier ?? 'Stats Riot pas encore récupérées'}
                  </p>
                </div>
              </div>
              <p className="font-ui font-bold text-2xl text-tft-purple-bright shrink-0 tabular-nums">
                {odds > 0 ? `${odds.toFixed(2)}×` : '—'}
              </p>
            </div>
            {oddsMissing && (
              <p className="mt-2 text-[10px] text-tft-rose-bright">
                Cotes {marketDef.shortLabel} pas encore calculées — choisis un autre marché ou attends 1 min.
              </p>
            )}
          </div>
        ) : (
          <div className="p-4 rounded-lg border border-tft-border bg-tft-bg-card text-sm text-tft-text-muted">
            Sélectionne un tacticien dans la liste pour placer un pari.
          </div>
        )}

        <div>
          <label htmlFor="stake" className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-text-muted block mb-2">
            Mise (◈)
          </label>
          <div className="relative">
            <input
              id="stake"
              type="number"
              inputMode="decimal"
              min="0.5"
              max="10000"
              step="0.5"
              value={stake}
              onChange={(e) => { setStake(e.target.value); setSuccess(null); setError(null); }}
              disabled={disabled}
              className="w-full px-4 py-3 rounded-md bg-tft-bg border border-tft-border text-tft-text font-ui font-semibold text-xl tabular-nums focus:outline-none focus:border-tft-purple-bright focus:ring-2 focus:ring-tft-purple/30 transition-colors disabled:opacity-50"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 font-ui text-tft-text-muted">◈</span>
          </div>
          <div className="grid grid-cols-4 gap-2 mt-2">
            {[10, 25, 50, 100].map((v) => (
              <button
                key={v}
                onClick={() => setStake(String(v))}
                disabled={disabled}
                className="px-2 py-1.5 rounded-md bg-tft-bg-elevated border border-tft-border hover:border-tft-purple/50 font-ui text-xs text-tft-text-dim hover:text-tft-text transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2 py-3 border-y border-tft-border">
          <div className="flex items-center justify-between text-sm">
            <span className="text-tft-text-muted">Mise</span>
            <span className="font-ui tabular-nums text-tft-text">{formatCoins(stakeNum)} ◈</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-tft-text-muted">Côte {marketDef.shortLabel}</span>
            <span className="font-ui tabular-nums text-tft-purple-bright">
              {odds > 0 ? `${odds.toFixed(2)}×` : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between text-base pt-2">
            <span className="font-ui text-[11px] tracking-[0.18em] uppercase text-tft-text-muted">Gain potentiel</span>
            <span className="font-display font-bold text-2xl text-tft-gold-bright tabular-nums">
              {formatCoins(potential)} ◈
            </span>
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-tft-rose/40 bg-tft-rose/10 px-3 py-2 text-xs text-tft-rose-bright flex items-center gap-2">
            <AlertTriangle size={14} />
            {error}
          </div>
        )}

        {success && (
          <div className="rounded-md border border-tft-mint/40 bg-tft-mint/10 px-3 py-2 text-xs text-tft-mint flex items-center gap-2">
            <ShieldCheck size={14} />
            Pari placé — gain potentiel {formatCoins(success.payout)} ◈.
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={disabled || posting}
          className={cn(
            'w-full py-3.5 rounded-md cursor-pointer transition-all',
            'font-ui font-bold text-[13px] tracking-[0.22em] uppercase text-white',
            disabled || posting
              ? 'bg-tft-bg-elevated border border-tft-border text-tft-text-muted cursor-not-allowed'
              : 'bg-gradient-rose shadow-rose-md hover:shadow-arcane-md',
          )}
        >
          {posting ? 'Envoi…'
            : disabled ? (bracketStarted ? 'Paris fermés' : stakeInvalid ? 'Mise invalide' : 'Sélectionne un tacticien')
            : `Parier ${formatCoins(stakeNum)} ◈`}
        </button>

        <p className="text-[10px] text-tft-text-muted text-center leading-relaxed">
          En cliquant tu acceptes les{' '}
          <Link href="/terms" className="text-tft-cyan-bright hover:underline">Conditions d&apos;utilisation</Link>.
          Pari verrouillé au coup d&apos;envoi.
        </p>
      </div>
    </div>
  );
}

/* ───────────────────────── States ───────────────────────── */

function TournamentSkeleton() {
  return (
    <div className="relative min-h-screen pb-20">
      <section className="relative overflow-hidden border-b border-tft-border bg-hero-arcane">
        <div className="absolute inset-0 bg-hex-grid opacity-15 pointer-events-none" aria-hidden="true" />
        <div className="relative max-w-6xl mx-auto px-6 pt-10 pb-12 animate-pulse">
          <div className="h-3 w-32 mb-6 rounded bg-tft-bg-elevated" />
          <div className="h-4 w-20 mb-3 rounded bg-tft-bg-elevated" />
          <div className="h-12 w-2/3 mb-3 rounded bg-tft-bg-elevated" />
          <div className="h-4 w-1/3 rounded bg-tft-bg-elevated" />
        </div>
      </section>
      <section className="max-w-6xl mx-auto px-6 mt-10 grid lg:grid-cols-[1fr_360px] gap-8 animate-pulse">
        <div className="space-y-4">
          <div className="h-8 w-1/3 rounded bg-tft-bg-elevated" />
          <div className="rounded-xl border border-tft-border bg-tft-bg-card/60 h-96" />
        </div>
        <div className="h-[480px] rounded-xl border border-tft-border bg-tft-bg-card/60" />
      </section>
    </div>
  );
}

function TournamentError({ message }: { message: string }) {
  return (
    <div className="max-w-3xl mx-auto px-6 pt-20 pb-32 text-center">
      <AlertTriangle size={48} className="text-tft-rose mx-auto mb-4" />
      <h1 className="font-display font-bold text-2xl text-tft-text mb-2">{message}</h1>
      <p className="text-tft-text-dim text-sm mb-6">
        Le tournoi a peut-être été annulé ou retiré. Reviens à la liste des tournois actifs.
      </p>
      <Link
        href="/tournaments"
        className="inline-flex items-center gap-2 px-6 py-3 rounded-md bg-tft-bg-card border border-tft-border hover:border-tft-purple/60 font-ui text-sm uppercase tracking-wider text-tft-text cursor-pointer transition-colors"
      >
        <ChevronLeft size={14} />
        Tous les tournois
      </Link>
    </div>
  );
}
