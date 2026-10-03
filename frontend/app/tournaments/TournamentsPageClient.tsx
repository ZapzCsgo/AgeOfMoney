'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Tournament, Match } from '@/types';
import { getTournaments, getTournament } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Calendar, ChevronDown, Trophy, RefreshCw, AlertTriangle, Zap, Search } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useT, localeFromLang } from '@/lib/i18n';
import { EmptyState } from '@/components/ui/empty-state';

export type TournamentWithCount = Tournament & { _count?: { matches: number } };

const GAME_TABS = [
  { id: 'all', label: 'tourn_all_games' },
  { id: 'AoE2', label: 'AoE2' },
  { id: 'AoE4', label: 'AoE4' },
  { id: 'AoE3', label: 'AoE3' },
  { id: 'AoM', label: 'AoM' },
] as const;

// Crest colors — gold/silver/bronze/stone, no blue/purple.
const TIER_CREST: Record<string, { metal: string; dark: string; text: string }> = {
  S: { metal: '#ffc542', dark: '#8a6410', text: '#2a1d00' },
  A: { metal: '#c9d0da', dark: '#6b7280', text: '#1c2027' },
  B: { metal: '#cd8a4a', dark: '#7c4a1e', text: '#2a1608' },
  C: { metal: '#8981ab', dark: '#4a4570', text: '#e8e2f5' },
};

// One shared badge chrome for every game — differentiated only by a small
// tonal dot (gold/bronze/stone family), never by random bright hues.
const GAME_STYLE: Record<string, { dot: string }> = {
  AoE4: { dot: '#ffc542' },
  AoE2: { dot: '#cd8a4a' },
  AoE3: { dot: '#8981ab' },
  AoM:  { dot: '#d9a441' },
  AoE1: { dot: '#a8763e' },
};

function formatDate(dateStr: string | undefined, locale: string): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Tier crest — shield emblem with the tier letter engraved ──────────────────
function TierCrest({ tier, size = 32 }: { tier: string; size?: number }) {
  const c = TIER_CREST[tier] ?? TIER_CREST.C;
  return (
    <svg width={size} height={size * 1.15} viewBox="0 0 26 30" fill="none" className="shrink-0">
      <path
        d="M13 1 L24 5 V14 C24 21 19.5 26.5 13 29 C6.5 26.5 2 21 2 14 V5 Z"
        fill={c.dark} fillOpacity={0.25}
        stroke={c.metal} strokeWidth={1.4}
      />
      <text x="13" y="18.5" textAnchor="middle" fontFamily="Cinzel, serif" fontWeight={700} fontSize={11} fill={c.metal}>
        {tier}
      </text>
    </svg>
  );
}

// ── Decorative banner strip — abstract per-game pattern, no game artwork ──────
function GameBanner({ game, muted }: { game?: string; muted?: boolean }) {
  const dot = (game && GAME_STYLE[game]?.dot) || GAME_STYLE.AoE4.dot;
  const patternId = `banner-pattern-${game ?? 'default'}`;
  return (
    <div
      className="relative h-16 overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #0d0b1a 0%, #07060f 100%)' }}
    >
      <svg width="100%" height="100%" className="absolute inset-0" style={{ opacity: muted ? 0.12 : 0.3 }}>
        <defs>
          <pattern id={patternId} width="28" height="28" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="28" stroke={dot} strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
      <div
        className="absolute inset-0"
        style={{ background: `radial-gradient(ellipse at 15% 50%, ${dot}22 0%, transparent 65%)` }}
      />
      <div className="absolute bottom-0 left-0 right-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${dot}55 50%, transparent)` }} />
    </div>
  );
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
          <span className="text-[11px] text-[#8981ab] tabular-nums">
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

// ── Tournament Card (banner card) ──────────────────────────────────────────────
function TournamentCard({ tournament, featured = false }: { tournament: TournamentWithCount; featured?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [matches, setMatches]   = useState<Match[]>([]);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const { t, lang } = useT();
  const locale = localeFromLang(lang);

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

  // Visual status — gold for upcoming, red for ongoing/live, muted neutral for finished.
  const isOngoing = isActive && hasStarted;
  const isUpcoming = !hasStarted && !endDatePassed;
  const isFinished = endDatePassed || (!isActive && hasStarted);
  const statusColor = isOngoing ? '#ef4444' : isUpcoming ? '#ffc542' : '#6a6390';

  return (
    <div
      className={cn(
        'rounded-lg border overflow-hidden transition-all duration-200 relative group/card cursor-pointer',
        'hover:-translate-y-0.5',
        expanded && 'lg:col-span-2'
      )}
      style={{
        background: isFinished ? '#0a0918' : '#0d0b1a',
        borderColor: isOngoing ? statusColor + '55' : isUpcoming ? 'rgba(255,197,66,0.25)' : '#1e1a30',
        opacity: isFinished ? 0.75 : 1,
      }}
      onMouseEnter={(e) => { if (!isFinished) e.currentTarget.style.borderColor = isOngoing ? statusColor : '#ffc542'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = isOngoing ? statusColor + '55' : isUpcoming ? 'rgba(255,197,66,0.25)' : '#1e1a30'; }}
    >
      <GameBanner game={tournament.game} muted={isFinished} />

      <button onClick={handleToggle} className="w-full text-left">
        <div className={cn('flex items-center gap-2 sm:gap-3 px-4', featured ? 'py-4' : 'py-3')}>
          <TierCrest tier={tier} size={featured ? 40 : 30} />
          <span className="hidden sm:inline text-[9px] font-bold uppercase tracking-wider shrink-0" style={{ color: TIER_CREST[tier]?.metal ?? '#8981ab' }}>
            {t('tourn_tier')} {tier}
          </span>

          {/* Info */}
          <div className="flex-1 min-w-0 ml-1">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className={cn('font-semibold break-words', featured ? 'text-[18px] line-clamp-2' : 'text-[14px] line-clamp-1', isFinished ? 'text-aoe-parchment-muted' : 'text-[#e8e2f5]')}>
                {tournament.name}
              </h3>
              {tournament.game && (
                <span className="badge-tag shrink-0 !bg-transparent" style={{ borderColor: 'rgba(255,197,66,0.25)' }}>
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: (GAME_STYLE[tournament.game] ?? GAME_STYLE.AoE4).dot }} />
                  {tournament.game}
                </span>
              )}
            </div>
            <div className={cn('flex items-center gap-3 flex-wrap', featured ? 'text-[12px]' : 'text-[11px]')}>
              <span className="flex items-center gap-1.5 text-aoe-parchment-dim">
                <Calendar size={featured ? 13 : 11} />
                <span className="tabular-nums">
                  {formatDate(tournament.startDate, locale)}
                  {tournament.endDate && ` → ${formatDate(tournament.endDate, locale)}`}
                </span>
              </span>
              {matchCount > 0 && (
                <span className="badge-tag">
                  <Zap size={9} />
                  {matchCount} {t('nav_matches').toLowerCase()}
                </span>
              )}
            </div>
          </div>

          {/* Status + chevron */}
          <div className="flex items-center gap-3 shrink-0">
            {isOngoing ? (
              <span className="badge-tag" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}>
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                {t('matches_filter_live').toUpperCase()}
              </span>
            ) : isUpcoming ? (
              <span className="badge-tag">
                {t('matches_filter_upcoming').toUpperCase()}
              </span>
            ) : (
              <span className="badge-tag badge-tag-muted">
                {t('matches_finished').toUpperCase()}
              </span>
            )}

            <ChevronDown
              size={14}
              className={cn('text-aoe-parchment-dim group-hover/card:text-aoe-gold transition-all duration-200', expanded && 'rotate-180')}
            />
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
            <p className="text-center text-aoe-parchment-muted text-[12px] py-6">{t('tournament_no_matches')}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export function TournamentsPageClient({ initialTournaments, serverNow }: { initialTournaments: TournamentWithCount[]; serverNow: string }) {
  const { t } = useT();
  const [tournaments, setTournaments] = useState<TournamentWithCount[]>(initialTournaments);
  const [loading, setLoading] = useState(initialTournaments.length === 0);
  const [error, setError]     = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'upcoming' | 'finished'>('all');
  const [gameFilter, setGameFilter] = useState<string>('all');
  const [search, setSearch]   = useState('');
  // Seeded from the server's own render-time instant so the client's
  // pre-hydration render reorders/filters identically to the server —
  // calling `new Date()` fresh here would read a different instant and
  // reshuffle/hide cards, a structural hydration mismatch. Ticks forward
  // to the real client clock right after mount.
  const [now, setNow] = useState(() => new Date(serverNow));
  useEffect(() => { setNow(new Date()); }, []);

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

  // Re-validate the server-rendered snapshot on mount, same pattern as
  // MatchPageClient / MatchesPageClient.
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
      Math.abs(now.getTime() - new Date(a.startDate).getTime()) -
      Math.abs(now.getTime() - new Date(b.startDate).getTime())
    );
  })();

  // Apply filters + sort: ongoing first, then upcoming, then finished
  const isEnded = (t: Tournament) => !!(t.endDate && new Date(t.endDate) < now);
  const isReallyActive = (t: Tournament) => t.isActive && !isEnded(t);

  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const oneWeekAgo  = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const isRecentlyFinished = (t: Tournament) => isEnded(t) && t.endDate && new Date(t.endDate) >= twoHoursAgo;

  // "Finished" predicate aligned with the rendering logic (see line ~462) :
  // a tournament is finished if endDate < now OR if it has started and is
  // no longer active. Many older tournaments in DB have NO endDate set —
  // they were finished via the "!isActive && hasStarted" path — so the
  // previous endDate-only check missed them entirely.
  const isFinishedAnyWay = (t: Tournament) =>
    isEnded(t) || (!isReallyActive(t) && new Date(t.startDate) <= now);

  // A tournament finished more than 7 days ago is hidden from every tab.
  // When endDate is missing we fall back to startDate as the age reference
  // (a tournament that started > 7d ago and is no longer active is stale).
  const isStaleFinished = (t: Tournament) => {
    if (!isFinishedAnyWay(t)) return false;
    const ref = t.endDate ? new Date(t.endDate) : new Date(t.startDate);
    return ref < oneWeekAgo;
  };

  const filtered = processed
    .filter(t => {
      if (isStaleFinished(t)) return false;
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
      {/* Header — same layout as the Matches page */}
      <div className="relative border-b border-[#1e1a30] px-6 py-6 overflow-hidden" style={{ background: 'linear-gradient(180deg, #0a0918 0%, #07060f 100%)' }}>
        <div className="absolute top-0 left-0 right-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, #ffc542 40%, #ffd97a 50%, #ffc542 60%, transparent)' }} />
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(255,197,66,0.08)', border: '1px solid rgba(255,197,66,0.2)' }}>
              <Trophy size={18} className="text-[#ffc542]" />
            </div>
            <div>
              <h1 className="font-cinzel font-black text-2xl tracking-[0.12em] text-[#ffd97a] uppercase">{t('tourn_title')}</h1>
              <div className="flex items-center gap-3 mt-0.5">
                {activeCount > 0 && (
                  <span className="flex items-center gap-1 text-[11px] text-red-400 font-bold tabular-nums">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse inline-block" />
                    {activeCount} {t('tourn_active').toLowerCase()}
                  </span>
                )}
                <span className="text-[11px] text-aoe-parchment-dim tabular-nums">{upcomingCount} {t('tourn_upcoming').toLowerCase()}</span>
              </div>
            </div>
          </div>
          <button onClick={fetchTournaments} disabled={loading}
            className="w-9 h-9 flex items-center justify-center shrink-0 rounded-lg border border-[#1e1a30] text-aoe-parchment-dim hover:text-[#ffc542] hover:border-[#ffc542]/20 transition-colors">
            <RefreshCw size={14} className={loading ? 'animate-spin text-[#ffc542]' : ''} />
          </button>
        </div>
      </div>

      <div className="px-5 py-5 pb-28 space-y-4">
        {/* Game filter chips */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {GAME_TABS.filter(g => g.id === 'all' || availableGames.has(g.id)).map(g => {
            const active = gameFilter === g.id;
            return (
              <button
                key={g.id}
                onClick={() => setGameFilter(g.id)}
                className={cn(
                  'shrink-0 h-9 px-3 rounded-md text-[11px] font-bold uppercase tracking-wide transition-colors border',
                  active
                    ? 'bg-[#ffc542] text-black border-[#ffc542]'
                    : 'bg-transparent text-aoe-parchment-dim border-[#1e1a30] hover:border-[#3d3860] hover:text-aoe-parchment'
                )}
              >
                {g.id === 'all' ? t('tourn_all_games') : g.label}
              </button>
            );
          })}
        </div>

        {/* Search + status filter row */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="relative flex-1 min-w-[160px]">
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
          <div className="flex items-center gap-2 shrink-0">
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
                  'h-9 px-3 rounded-md text-[11px] font-bold uppercase tracking-wide transition-colors border',
                  statusFilter === f.id
                    ? 'bg-[#ffc542] text-black border-[#ffc542]'
                    : 'bg-transparent text-aoe-parchment-dim border-[#1e1a30] hover:border-[#3d3860] hover:text-aoe-parchment'
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
            <button onClick={fetchTournaments} className="text-[11px] text-[#8981ab] hover:text-[#e8e2f5] underline">{t('common_retry')}</button>
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
            {/* Featured — first upcoming tournament from the already-sorted list,
                shown once here and skipped in the regular Upcoming grid below.
                Pure presentation of data already fetched — no new API call. */}
            {(() => {
              const upcomingAll = filtered.filter(t => new Date(t.startDate) > now && !isEnded(t));
              const hero = upcomingAll[0];
              if (!hero) return null;
              return (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-2 h-2 rounded-full bg-[#ffc542]" />
                    <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#ffc542]">{t('matches_filter_upcoming')}</h2>
                    <div className="flex-1 h-px ml-2" style={{ background: 'linear-gradient(90deg, rgba(255,197,66,0.3), transparent)' }} />
                  </div>
                  <TournamentCard tournament={hero} featured />
                </div>
              );
            })()}
            {/* Ongoing section */}
            {(() => {
              const ongoing = filtered.filter(t => isReallyActive(t) && new Date(t.startDate) <= now);
              if (ongoing.length === 0) return null;
              return (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
                    <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-red-400">{t('tourn_active')}</h2>
                    <span className="text-[10px] text-aoe-parchment-muted tabular-nums">({ongoing.length})</span>
                    <div className="flex-1 h-px ml-2" style={{ background: 'linear-gradient(90deg, rgba(239,68,68,0.3), transparent)' }} />
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                    {ongoing.map(t => <TournamentCard key={t.id} tournament={t} />)}
                  </div>
                </div>
              );
            })()}
            {/* Upcoming section (minus the featured one, already shown above) */}
            {(() => {
              const upcoming = filtered.filter(t => new Date(t.startDate) > now && !isEnded(t)).slice(1);
              if (upcoming.length === 0) return null;
              return (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-2 h-2 rounded-full bg-[#ffc542]" />
                    <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#ffc542]">{t('matches_filter_upcoming')}</h2>
                    <span className="text-[10px] text-aoe-parchment-muted tabular-nums">({upcoming.length})</span>
                    <div className="flex-1 h-px ml-2" style={{ background: 'linear-gradient(90deg, rgba(255,197,66,0.3), transparent)' }} />
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
                    <span className="w-2 h-2 rounded-full bg-aoe-parchment-muted" />
                    <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-aoe-parchment-dim">{t('matches_filter_done')}</h2>
                    <span className="text-[10px] text-aoe-parchment-muted tabular-nums">({finished.length})</span>
                    <div className="flex-1 h-px ml-2" style={{ background: 'linear-gradient(90deg, rgba(154,144,184,0.2), transparent)' }} />
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
