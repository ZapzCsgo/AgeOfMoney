'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Tournament, Match } from '@/types';
import { getTournaments, getTournament } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Calendar, DollarSign, Users, ChevronDown, ChevronUp, Trophy, RefreshCw, AlertTriangle, ExternalLink, Zap, Search } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '@/lib/i18n';

function getTierClass(tier?: string): string {
  switch (tier) {
    case 'S': return 'badge-tier-s';
    case 'A': return 'badge-tier-a';
    case 'B': return 'badge-tier-b';
    default:  return 'badge-tier-c';
  }
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

function getCountryFlag(code?: string | null): string {
  if (!code) return '';
  return code.toUpperCase().replace(/./g, (c) => String.fromCodePoint(0x1f1e0 - 65 + c.charCodeAt(0)));
}

// ── Match Mini Row ─────────────────────────────────────────────────────────────
function MatchMiniRow({ match }: { match: Match }) {
  const isLive = match.status === 'LIVE';
  const isCompleted = match.status === 'COMPLETED';

  return (
    <Link
      href={`/matches/${match.id}`}
      className="flex items-center gap-3 px-3 py-2 rounded-lg border border-aoe-border/40 hover:border-aoe-gold/30 transition-all group"
      style={{ background: 'rgba(0,0,0,0.2)' }}
    >
      <div className="flex-1 flex items-center gap-2 min-w-0">
        <span className={cn(
          'font-cinzel font-bold text-xs truncate',
          isCompleted && match.winnerId === match.player1.id ? 'text-aoe-gold' : 'text-aoe-parchment'
        )}>
          {match.player1.name}
        </span>
      </div>
      <div className="shrink-0 flex items-center gap-2">
        {isLive ? (
          <span className="badge-live py-0.5 text-[9px]"><Zap size={8} />LIVE</span>
        ) : isCompleted && match.resultScore ? (
          <span className="font-cinzel font-bold text-sm text-aoe-parchment">{match.resultScore}</span>
        ) : (
          <div className="flex items-center gap-1">
            <span className="font-cinzel font-bold text-xs text-aoe-parchment/70">{match.odds1.toFixed(2)}</span>
            <span className="text-aoe-parchment-muted text-xs">vs</span>
            <span className="font-cinzel font-bold text-xs text-aoe-parchment/70">{match.odds2.toFixed(2)}</span>
          </div>
        )}
        <span className="text-[9px] font-cinzel text-aoe-parchment-muted border border-aoe-border/60 px-1 py-0.5 rounded">
          {match.format}
        </span>
      </div>
      <div className="flex-1 flex items-center gap-2 min-w-0 justify-end">
        <span className={cn(
          'font-cinzel font-bold text-xs truncate',
          isCompleted && match.winnerId === match.player2.id ? 'text-aoe-gold' : 'text-aoe-parchment'
        )}>
          {match.player2.name}
        </span>
      </div>
    </Link>
  );
}

// ── Tournament Card ────────────────────────────────────────────────────────────
function TournamentCard({ tournament }: { tournament: Tournament & { _count?: { matches: number } } }) {
  const [expanded, setExpanded] = useState(false);
  const [matches, setMatches]   = useState<Match[]>([]);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const { t } = useT();

  const handleToggle = async () => {
    if (!expanded && matches.length === 0) {
      setLoadingMatches(true);
      try {
        const res = await getTournament(tournament.id);
        setMatches(res.data.matches?.all ?? []);
      } catch {
        // no matches available
      } finally {
        setLoadingMatches(false);
      }
    }
    setExpanded(!expanded);
  };

  const isActive  = tournament.isActive;
  const hasStarted = new Date(tournament.startDate) <= new Date();
  const matchCount = tournament._count?.matches ?? 0;

  return (
    <div
      className={cn(
        'rounded-xl border overflow-hidden transition-all duration-200',
        isActive && hasStarted
          ? 'border-aoe-gold/25'
          : 'border-aoe-border hover:border-aoe-border-mid'
      )}
      style={{ background: 'linear-gradient(145deg, #0d0b1a 0%, #100e20 100%)' }}
    >
      {/* Gold top line for active */}
      {isActive && hasStarted && (
        <div className="h-px" style={{ background: 'linear-gradient(90deg, transparent, #d4a017 30%, #f5c842 50%, #d4a017 70%, transparent)' }} />
      )}

      <div className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          {/* Info */}
          <div className="space-y-2.5 flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={getTierClass(tournament.tier)}>
                TIER {tournament.tier}
              </span>
              {isActive && hasStarted ? (
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded" style={{ background: 'rgba(39,174,96,0.12)', border: '1px solid rgba(39,174,96,0.3)' }}>
                  <div className="w-1.5 h-1.5 rounded-full bg-aoe-emerald-bright animate-pulse-live" />
                  <span className="text-[10px] text-aoe-emerald-bright font-cinzel">{t('tourn_active').toUpperCase()}</span>
                </div>
              ) : !hasStarted ? (
                <div className="flex items-center gap-1 px-2 py-0.5 rounded" style={{ background: 'rgba(41,128,185,0.1)', border: '1px solid rgba(41,128,185,0.25)' }}>
                  <span className="text-[10px] text-aoe-blue-bright font-cinzel">{t('tourn_upcoming').toUpperCase()}</span>
                </div>
              ) : (
                <div className="flex items-center gap-1 px-2 py-0.5 rounded" style={{ background: 'rgba(100,100,100,0.1)', border: '1px solid rgba(100,100,100,0.2)' }}>
                  <span className="text-[10px] text-aoe-parchment-muted font-cinzel">TERMINÉ</span>
                </div>
              )}
            </div>

            <h2 className="font-cinzel font-bold text-lg text-aoe-parchment leading-tight">{tournament.name}</h2>

            <div className="flex flex-wrap gap-4 text-[11px]">
              {tournament.prizePool && (
                <span className="flex items-center gap-1 text-aoe-gold font-cinzel">
                  <DollarSign size={11} />
                  {tournament.prizePool}
                </span>
              )}
              <span className="flex items-center gap-1 text-aoe-parchment-dim">
                <Calendar size={11} />
                {formatDate(tournament.startDate)}
                {tournament.endDate ? ` — ${formatDate(tournament.endDate)}` : ''}
              </span>
              {matchCount > 0 && (
                <span className="flex items-center gap-1 text-aoe-parchment-dim">
                  <Users size={11} />
                  {matchCount} match{matchCount > 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 shrink-0">
            {tournament.liquipediaUrl && (
              <a
                href={tournament.liquipediaUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-aoe-border text-aoe-parchment-dim hover:border-aoe-border-mid hover:text-aoe-parchment transition-all text-[11px] font-cinzel"
                style={{ background: 'rgba(0,0,0,0.3)' }}
              >
                <ExternalLink size={12} />
                Liquipedia
              </a>
            )}
            <button
              onClick={handleToggle}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border transition-all text-[11px] font-cinzel"
              style={expanded
                ? { background: 'rgba(212,160,23,0.1)', borderColor: 'rgba(212,160,23,0.3)', color: '#d4a017' }
                : { background: 'rgba(0,0,0,0.3)', borderColor: '#1e1a30', color: '#9890b8' }
              }
            >
              {loadingMatches ? (
                <RefreshCw size={12} className="animate-spin" />
              ) : expanded ? (
                <ChevronUp size={12} />
              ) : (
                <ChevronDown size={12} />
              )}
              {t('nav_matches')}
            </button>
          </div>
        </div>
      </div>

      {/* Expanded matches */}
      {expanded && (
        <div className="border-t border-aoe-border/60 px-4 py-4 space-y-2" style={{ background: 'rgba(0,0,0,0.2)' }}>
          {loadingMatches ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-aoe-border/40">
                  <Skeleton className="h-3 flex-1" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-3 flex-1" />
                </div>
              ))}
            </div>
          ) : matches.length > 0 ? (
            matches.map((m) => <MatchMiniRow key={m.id} match={m} />)
          ) : (
            <p className="text-center text-aoe-parchment-muted text-xs font-cinzel py-4">
              {t('matches_empty')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────
function TournamentSkeleton() {
  return (
    <div className="rounded-xl border border-aoe-border overflow-hidden" style={{ background: '#0d0b1a' }}>
      <div className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-12 rounded" />
          <Skeleton className="h-4 w-16 rounded" />
        </div>
        <Skeleton className="h-6 w-2/3 rounded" />
        <div className="flex gap-4">
          <Skeleton className="h-3 w-24 rounded" />
          <Skeleton className="h-3 w-32 rounded" />
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function TournamentsPage() {
  const { t } = useT();
  const [tournaments, setTournaments] = useState<(Tournament & { _count?: { matches: number } })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [filter, setFilter]   = useState<'all' | 'active' | 'upcoming'>('all');
  const [search, setSearch]   = useState('');

  const fetchTournaments = useCallback(async () => {
    try {
      setError(null);
      const res = await getTournaments({ limit: 30 });
      setTournaments(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common_error'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTournaments(); }, [fetchTournaments]);

  const tier12 = (() => {
    const base = tournaments.filter((t) => t.tier === 'S' || t.tier === 'A');

    // Deduplicate: if two tournaments share the same start date and one name
    // contains the other, keep only the one with more matches.
    const deduped = base.filter((t, _, arr) => {
      const tDate = new Date(t.startDate).toDateString();
      const tMatches = t._count?.matches ?? 0;
      const tName = t.name.toLowerCase();
      const dominated = arr.some((other) => {
        if (other.id === t.id) return false;
        const oDate = new Date(other.startDate).toDateString();
        const oMatches = other._count?.matches ?? 0;
        const oName = other.name.toLowerCase();
        // Same day, names overlap, other has more matches
        return oDate === tDate
          && (oName.includes(tName) || tName.includes(oName))
          && oMatches > tMatches;
      });
      return !dominated;
    });

    return deduped.sort(
      (a, b) => Math.abs(Date.now() - new Date(a.startDate).getTime())
              - Math.abs(Date.now() - new Date(b.startDate).getTime())
    );
  })();

  const filtered = tier12.filter((t) => {
    const started = new Date(t.startDate) <= new Date();
    if (filter === 'active')   return t.isActive && started;
    if (filter === 'upcoming') return !started;
    return true;
  }).filter((t) => !search.trim() || t.name.toLowerCase().includes(search.trim().toLowerCase()));

  const activeCount   = tier12.filter((t) => t.isActive && new Date(t.startDate) <= new Date()).length;
  const upcomingCount = tier12.filter((t) => new Date(t.startDate) > new Date()).length;

  return (
    <div className="min-h-full">
      {/* Header */}
      <div
        className="relative border-b border-aoe-border px-6 py-8 overflow-hidden"
        style={{ background: 'linear-gradient(180deg, #0a0918 0%, #07060f 100%)' }}
      >
        <div className="absolute top-0 left-0 right-0 h-px" style={{ background: 'linear-gradient(90deg, transparent 0%, #d4a017 30%, #f5c842 50%, #d4a017 70%, transparent 100%)' }} />

        <div className="flex items-end justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center border border-aoe-gold/30"
              style={{ background: 'rgba(212,160,23,0.08)' }}
            >
              <Trophy size={20} className="text-aoe-gold" />
            </div>
            <div>
              <h1 className="font-cinzel font-black text-2xl tracking-[0.15em] text-aoe-gold uppercase">{t('tourn_title')}</h1>
              <div className="flex items-center gap-3 mt-0.5">
                {activeCount > 0 && (
                  <span className="flex items-center gap-1 text-xs text-aoe-emerald-bright font-cinzel">
                    <span className="w-1.5 h-1.5 rounded-full bg-aoe-emerald-bright inline-block animate-pulse-live" />
                    {activeCount} {t('tourn_active').toLowerCase()}
                  </span>
                )}
                <span className="text-xs text-aoe-parchment-dim font-cinzel">{upcomingCount} {t('tourn_upcoming').toLowerCase()}</span>
              </div>
            </div>
          </div>
          <button
            onClick={fetchTournaments}
            disabled={loading}
            className="p-2 rounded-lg border border-aoe-border text-aoe-parchment-muted hover:text-aoe-gold hover:border-aoe-border-mid transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin text-aoe-gold' : ''} />
          </button>
        </div>
      </div>

      <div className="px-5 py-5">
        {/* Search */}
        <div className="relative mb-4">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#6b6488' }} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('tourn_title') + '…'}
            className="w-full h-9 rounded-lg pl-9 pr-4 text-[13px] outline-none transition-all"
            style={{ background: '#0d0b1a', border: '1px solid #1e1a30', color: '#e8e2f5' }}
          />
          {search && (
            <button onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6b6488] hover:text-[#9990b8] transition-colors text-[12px]">
              ✕
            </button>
          )}
        </div>

        {/* Filter tabs */}
        <div
          className="flex items-center gap-0.5 p-1 rounded-lg border border-aoe-border mb-5 w-fit"
          style={{ background: 'rgba(0,0,0,0.4)' }}
        >
          {([
            { id: 'all',      label: t('matches_filter_all') },
            { id: 'active',   label: t('tourn_active') },
            { id: 'upcoming', label: t('tourn_upcoming') },
          ] as const).map((f) => {
            const isActive = filter === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  'px-4 py-1.5 text-[11px] font-cinzel tracking-wider uppercase rounded transition-all duration-150',
                  isActive
                    ? 'text-aoe-bg font-bold shadow-sm'
                    : 'text-aoe-parchment-dim hover:text-aoe-parchment hover:bg-white/5'
                )}
                style={isActive ? { background: 'linear-gradient(135deg, #8b6410, #d4a017)' } : undefined}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-aoe-crimson/30 bg-aoe-crimson-dim/20 p-4 mb-5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle size={14} className="text-aoe-crimson-bright shrink-0" />
              <p className="text-aoe-crimson-bright text-sm">{error}</p>
            </div>
            <button onClick={fetchTournaments} className="text-xs text-aoe-parchment-dim hover:text-aoe-parchment underline shrink-0">
              {t('common_retry')}
            </button>
          </div>
        )}

        {/* List */}
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => <TournamentSkeleton key={i} />)}
          </div>
        ) : filtered.length > 0 ? (
          <div className="space-y-4">
            {filtered.map((t) => <TournamentCard key={t.id} tournament={t} />)}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-24">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center mb-5 border border-aoe-border"
              style={{ background: 'rgba(212,160,23,0.05)' }}
            >
              <Trophy size={28} className="text-aoe-parchment-muted opacity-40" />
            </div>
            <p className="font-cinzel text-sm tracking-widest text-aoe-parchment-dim">
              {filter !== 'all' ? t('matches_empty_filter') : t('tourn_empty')}
            </p>
            {filter !== 'all' && (
              <button
                onClick={() => setFilter('all')}
                className="mt-4 text-xs text-aoe-gold font-cinzel tracking-wider uppercase hover:underline"
              >
                {t('matches_see_all')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
