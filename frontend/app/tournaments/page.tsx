'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Tournament, Match } from '@/types';
import { getTournaments, getTournament } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Calendar, Users, ChevronDown, ChevronUp, Trophy, RefreshCw, AlertTriangle, Zap, Search } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '@/lib/i18n';
import { EmptyState } from '@/components/ui/empty-state';

const GAME_TABS = [
  { id: 'all', label: 'tourn_all_games' },
  { id: 'AoE2', label: 'AoE2' },
  { id: 'AoE4', label: 'AoE4' },
  { id: 'AoE3', label: 'AoE3' },
  { id: 'AoM', label: 'AoM' },
] as const;

const TIER_STYLE: Record<string, { bg: string; text: string; border: string }> = {
  S: { bg: 'rgba(255,197,66,0.12)', text: '#ffc542', border: 'rgba(255,197,66,0.3)' },
  A: { bg: 'rgba(167,139,250,0.10)', text: '#a78bfa', border: 'rgba(167,139,250,0.25)' },
  B: { bg: 'rgba(96,165,250,0.08)', text: '#60a5fa', border: 'rgba(96,165,250,0.2)' },
  C: { bg: 'rgba(107,100,136,0.08)', text: '#6b6488', border: 'rgba(107,100,136,0.2)' },
};

// Per-game badge styles — match home page colors
const GAME_STYLE: Record<string, { bg: string; text: string; border: string }> = {
  AoE4: { bg: 'rgba(255,197,66,0.10)', text: '#ffd97a', border: 'rgba(255,197,66,0.25)' },  // gold
  AoE2: { bg: 'rgba(248,113,113,0.10)', text: '#f87171', border: 'rgba(248,113,113,0.40)' }, // red-400
  AoE3: { bg: 'rgba(96,165,250,0.10)', text: '#60a5fa', border: 'rgba(96,165,250,0.40)' },   // blue-400
  AoM:  { bg: 'rgba(52,211,153,0.10)', text: '#34d399', border: 'rgba(52,211,153,0.40)' },   // emerald-400
  AoE1: { bg: 'rgba(251,146,60,0.10)', text: '#fb923c', border: 'rgba(251,146,60,0.40)' },   // orange-400
};

function formatDate(dateStr?: string): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Match Mini Row ─────────────────────────────────────────────────────────────
function MatchMiniRow({ match }: { match: Match }) {
  const isLive = match.status === 'LIVE';
  const isCompleted = match.status === 'COMPLETED';

  return (
    <Link
      href={`/matches/${match.id}`}
      className="flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.03] transition-colors"
    >
      <span className={cn(
        'flex-1 text-[12px] font-medium truncate text-right',
        isCompleted && match.winnerId === match.player1.id ? 'text-[#ffc542]' : 'text-[#c8c0e0]'
      )}>
        {match.player1.name}
      </span>

      <div className="shrink-0 w-20 text-center">
        {isLive ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold text-red-400 bg-red-400/10 border border-red-400/25">
            <Zap size={8} />LIVE
          </span>
        ) : isCompleted && match.resultScore ? (
          <span className="font-bold text-[13px] text-[#e8e2f5] tabular-nums">{match.resultScore}</span>
        ) : (
          <span className="text-[11px] text-[#6b6488] tabular-nums">
            {match.odds1.toFixed(2)} - {match.odds2.toFixed(2)}
          </span>
        )}
      </div>

      <span className={cn(
        'flex-1 text-[12px] font-medium truncate',
        isCompleted && match.winnerId === match.player2.id ? 'text-[#ffc542]' : 'text-[#c8c0e0]'
      )}>
        {match.player2.name}
      </span>
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
    const willExpand = !expanded;
    setExpanded(willExpand);
    // Load matches only on first expand (cached after that)
    if (willExpand && matches.length === 0 && matchCount > 0) {
      setLoadingMatches(true);
      try {
        const res = await getTournament(tournament.id);
        setMatches(res.data.matches?.all ?? []);
      } catch { /* no matches */ } finally {
        setLoadingMatches(false);
      }
    }
  };

  const hasStarted = new Date(tournament.startDate) <= new Date();
  const endDatePassed = tournament.endDate && new Date(tournament.endDate) < new Date();
  const isActive  = tournament.isActive && !endDatePassed;
  const matchCount = tournament._count?.matches ?? 0;
  const tier = tournament.tier ?? 'C';
  const tierStyle = TIER_STYLE[tier] ?? TIER_STYLE.C;

  // Visual status
  const isOngoing = isActive && hasStarted;
  const isUpcoming = !hasStarted && !endDatePassed;
  const isFinished = endDatePassed || (!isActive && hasStarted);
  const statusColor = isOngoing ? '#10b981' : isUpcoming ? '#60a5fa' : '#3d3860';

  return (
    <div
      className={cn("rounded-lg border overflow-hidden transition-colors relative", expanded && "lg:col-span-2")}
      style={{
        background: isFinished ? '#0a0918' : '#0d0b1a',
        borderColor: isOngoing ? statusColor + '50' : isUpcoming ? '#1e1a30' : '#151325',
        opacity: isFinished ? 0.7 : 1,
      }}
    >
      {/* Left status bar */}
      <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: statusColor }} />

      <button onClick={handleToggle} className="w-full text-left">
        <div className="flex items-center gap-4 px-4 py-3.5 pl-5">
          {/* Tier badge */}
          <div
            className="shrink-0 w-8 h-8 rounded flex items-center justify-center text-[11px] font-black"
            style={{ background: tierStyle.bg, color: tierStyle.text, border: `1px solid ${tierStyle.border}` }}
          >
            {tier}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <h3 className={cn("text-[13px] font-semibold truncate", isFinished ? 'text-[#8880a8]' : 'text-[#e8e2f5]')}>{tournament.name}</h3>
              {tournament.game && (() => {
                const gs = GAME_STYLE[tournament.game] ?? GAME_STYLE.AoE4;
                return (
                  <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded font-bold tracking-wide"
                    style={{ background: gs.bg, color: gs.text, border: `1px solid ${gs.border}` }}>
                    {tournament.game}
                  </span>
                );
              })()}
            </div>
            <div className="flex items-center gap-3 text-[10px] text-[#6b6488]">
              <span className="flex items-center gap-1">
                <Calendar size={9} />
                {formatDate(tournament.startDate)}
                {tournament.endDate && ` → ${formatDate(tournament.endDate)}`}
              </span>
              {matchCount > 0 && (
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded" style={{ background: '#1e1a30' }}>
                  <Zap size={8} />
                  {matchCount} matchs
                </span>
              )}
            </div>
          </div>

          {/* Status + chevron */}
          <div className="flex items-center gap-3 shrink-0">
            {isOngoing ? (
              <span className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold text-emerald-400"
                style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                EN COURS
              </span>
            ) : isUpcoming ? (
              <span className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold text-[#60a5fa]"
                style={{ background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.2)' }}>
                À VENIR
              </span>
            ) : (
              <span className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold text-[#4a4570]"
                style={{ background: 'rgba(74,69,112,0.08)', border: '1px solid rgba(74,69,112,0.15)' }}>
                TERMINÉ
              </span>
            )}

            {expanded ? <ChevronUp size={14} className="text-[#6b6488]" /> : <ChevronDown size={14} className="text-[#6b6488]" />}
          </div>
        </div>
      </button>

      {/* Expanded matches */}
      {expanded && (
        <div className="border-t border-[#1a1730]">
          {loadingMatches ? (
            <div className="px-4 py-4 space-y-2">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-8 w-full rounded" />)}
            </div>
          ) : matches.length > 0 ? (
            <div className="divide-y divide-[#13111f]">
              {matches.map(m => <MatchMiniRow key={m.id} match={m} />)}
            </div>
          ) : (
            <p className="text-center text-[#4a4570] text-[12px] py-6">{t('tournament_no_matches')}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function TournamentsPage() {
  const { t } = useT();
  const [tournaments, setTournaments] = useState<(Tournament & { _count?: { matches: number } })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'upcoming' | 'finished'>('all');
  const [gameFilter, setGameFilter] = useState<string>('all');
  const [search, setSearch]   = useState('');

  const fetchTournaments = useCallback(async () => {
    try {
      setError(null);
      const res = await getTournaments({ limit: 50 });
      setTournaments(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common_error'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTournaments(); }, [fetchTournaments]);

  // Filter to S/A tier, deduplicate, sort by proximity to now
  const processed = (() => {
    const base = tournaments.filter(t => t.tier === 'S' || t.tier === 'A');
    const deduped = base.filter((t, _, arr) => {
      const tDate = new Date(t.startDate).toDateString();
      const tMatches = t._count?.matches ?? 0;
      const tName = t.name.toLowerCase();
      return !arr.some(o =>
        o.id !== t.id &&
        new Date(o.startDate).toDateString() === tDate &&
        (o.name.toLowerCase().includes(tName) || tName.includes(o.name.toLowerCase())) &&
        (o._count?.matches ?? 0) > tMatches
      );
    });
    return deduped.sort((a, b) =>
      Math.abs(Date.now() - new Date(a.startDate).getTime()) -
      Math.abs(Date.now() - new Date(b.startDate).getTime())
    );
  })();

  // Apply filters + sort: ongoing first, then upcoming, then finished
  const now = new Date();
  const isEnded = (t: Tournament) => !!(t.endDate && new Date(t.endDate) < now);
  const isReallyActive = (t: Tournament) => t.isActive && !isEnded(t);

  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const isRecentlyFinished = (t: Tournament) => isEnded(t) && t.endDate && new Date(t.endDate) >= twoHoursAgo;

  const filtered = processed
    .filter(t => {
      if (statusFilter === 'active') return isReallyActive(t) && new Date(t.startDate) <= now;
      if (statusFilter === 'upcoming') return new Date(t.startDate) > now && !isEnded(t);
      if (statusFilter === 'finished') return isEnded(t);
      // "all" — hide finished tournaments older than 2h
      if (isEnded(t) && !isRecentlyFinished(t)) return false;
      return true;
    })
    .filter(t => gameFilter === 'all' || t.game === gameFilter)
    .filter(t => !search.trim() || t.name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => {
      const aStarted = new Date(a.startDate) <= now;
      const bStarted = new Date(b.startDate) <= now;
      const aOngoing = isReallyActive(a) && aStarted;
      const bOngoing = isReallyActive(b) && bStarted;
      const aUpcoming = !aStarted && !isEnded(a);
      const bUpcoming = !bStarted && !isEnded(b);
      // Ongoing first, then upcoming, then finished
      const aOrder = aOngoing ? 0 : aUpcoming ? 1 : 2;
      const bOrder = bOngoing ? 0 : bUpcoming ? 1 : 2;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return new Date(b.startDate).getTime() - new Date(a.startDate).getTime();
    });

  const activeCount  = processed.filter(t => isReallyActive(t) && new Date(t.startDate) <= now).length;
  const upcomingCount = processed.filter(t => new Date(t.startDate) > now && !isEnded(t)).length;

  // Available games (only show tabs for games that have tournaments)
  const availableGames = new Set(processed.map(t => t.game).filter(Boolean));

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="border-b px-6 py-6" style={{ borderColor: '#1e1a30', background: 'linear-gradient(180deg, #0a0918 0%, #07060f 100%)' }}>
        <div className="relative">
          <div className="absolute top-[-24px] left-0 right-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, #ffc542 40%, #ffd97a 50%, #ffc542 60%, transparent)' }} />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Trophy size={20} className="text-[#ffc542]" />
            <div>
              <h1 className="font-cinzel font-bold text-xl tracking-[0.15em] text-[#ffc542] uppercase">{t('tourn_title')}</h1>
              <div className="flex items-center gap-3 mt-0.5 text-[11px]">
                {activeCount > 0 && (
                  <span className="flex items-center gap-1 text-emerald-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    {activeCount} {t('tourn_active').toLowerCase()}
                  </span>
                )}
                <span className="text-[#6b6488]">{upcomingCount} {t('tourn_upcoming').toLowerCase()}</span>
              </div>
            </div>
          </div>
          <button onClick={fetchTournaments} disabled={loading}
            className="p-2 rounded-lg border border-[#1e1a30] text-[#6b6488] hover:text-[#ffc542] transition-colors">
            <RefreshCw size={14} className={loading ? 'animate-spin text-[#ffc542]' : ''} />
          </button>
        </div>
      </div>

      <div className="px-5 py-5 space-y-4">
        {/* Game filter chips */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {GAME_TABS.filter(g => g.id === 'all' || availableGames.has(g.id)).map(g => {
            const active = gameFilter === g.id;
            return (
              <button
                key={g.id}
                onClick={() => setGameFilter(g.id)}
                className={cn(
                  'shrink-0 px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors border',
                  active
                    ? 'bg-[#ffc542] text-black border-[#ffc542]'
                    : 'bg-transparent text-[#9990b8] border-[#1e1a30] hover:border-[#3d3860] hover:text-[#e8e2f5]'
                )}
              >
                {g.id === 'all' ? t('tourn_all_games') : g.label}
              </button>
            );
          })}
        </div>

        {/* Search + status filter row */}
        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4a4570]" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('tourn_search')}
              className="w-full h-9 rounded-md pl-9 pr-3 text-[12px] outline-none bg-[#0d0b1a] border border-[#1e1a30] text-[#e8e2f5] placeholder-[#4a4570] focus:border-[#3d3860] transition-colors"
            />
          </div>

          {/* Status tabs */}
          <div className="flex shrink-0 border border-[#1e1a30] rounded-md overflow-hidden">
            {([
              { id: 'all', label: t('matches_filter_all') },
              { id: 'active', label: t('tourn_active') },
              { id: 'upcoming', label: t('tourn_upcoming') },
              { id: 'finished', label: t('matches_filter_done') },
            ] as const).map(f => (
              <button
                key={f.id}
                onClick={() => setStatusFilter(f.id)}
                className={cn(
                  'px-3 py-1.5 text-[10px] font-bold tracking-wider uppercase transition-colors',
                  statusFilter === f.id
                    ? 'bg-[#1e1a30] text-[#e8e2f5]'
                    : 'text-[#6b6488] hover:text-[#9990b8]'
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-md border border-red-900/30 bg-red-950/10 p-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle size={13} className="text-red-400 shrink-0" />
              <p className="text-red-400 text-[12px]">{error}</p>
            </div>
            <button onClick={fetchTournaments} className="text-[11px] text-[#6b6488] hover:text-[#e8e2f5] underline">{t('common_retry')}</button>
          </div>
        )}

        {/* Tournament list — grouped by status */}
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="rounded-lg border border-[#1e1a30] p-4" style={{ background: '#0d0b1a' }}>
                <div className="flex items-center gap-4">
                  <Skeleton className="w-8 h-8 rounded" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length > 0 ? (
          <div className="space-y-6">
            {/* Ongoing section */}
            {(() => {
              const ongoing = filtered.filter(t => isReallyActive(t) && new Date(t.startDate) <= now);
              if (ongoing.length === 0) return null;
              return (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-400">En cours</h2>
                    <span className="text-[10px] text-[#4a4570]">({ongoing.length})</span>
                    <div className="flex-1 h-px ml-2" style={{ background: 'linear-gradient(90deg, rgba(16,185,129,0.3), transparent)' }} />
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                    {ongoing.map(t => <TournamentCard key={t.id} tournament={t} />)}
                  </div>
                </div>
              );
            })()}
            {/* Upcoming section */}
            {(() => {
              const upcoming = filtered.filter(t => new Date(t.startDate) > now && !isEnded(t));
              if (upcoming.length === 0) return null;
              return (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-2 h-2 rounded-full bg-[#60a5fa]" />
                    <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#60a5fa]">À venir</h2>
                    <span className="text-[10px] text-[#4a4570]">({upcoming.length})</span>
                    <div className="flex-1 h-px ml-2" style={{ background: 'linear-gradient(90deg, rgba(96,165,250,0.3), transparent)' }} />
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                    {upcoming.map(t => <TournamentCard key={t.id} tournament={t} />)}
                  </div>
                </div>
              );
            })()}
            {/* Finished section */}
            {(() => {
              const finished = filtered.filter(t => isEnded(t) || (!isReallyActive(t) && new Date(t.startDate) <= now));
              if (finished.length === 0) return null;
              return (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-2 h-2 rounded-full bg-[#3d3860]" />
                    <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#4a4570]">Terminés</h2>
                    <span className="text-[10px] text-[#3d3860]">({finished.length})</span>
                    <div className="flex-1 h-px ml-2" style={{ background: 'linear-gradient(90deg, rgba(61,56,96,0.3), transparent)' }} />
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                    {finished.map(t => <TournamentCard key={t.id} tournament={t} />)}
                  </div>
                </div>
              );
            })()}
          </div>
        ) : (
          <EmptyState
            icon={Trophy}
            title={statusFilter !== 'all' || gameFilter !== 'all' ? t('matches_empty_filter') : t('tourn_empty')}
            actions={(statusFilter !== 'all' || gameFilter !== 'all')
              ? [{ label: t('matches_see_all'), onClick: () => { setStatusFilter('all'); setGameFilter('all'); } }]
              : undefined
            }
          />
        )}
      </div>
    </div>
  );
}
