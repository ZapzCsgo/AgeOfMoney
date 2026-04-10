'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Match } from '@/types';
import { getMatches } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Clock, RefreshCw, AlertTriangle, Swords, ChevronRight, Zap, Search } from 'lucide-react';
import { useT } from '@/lib/i18n';

function formatCountdown(dateStr: string, t: (k: string) => string): string {
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff <= 0) return t('matches_imminent');
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
}

const TIER_COLORS: Record<string, string> = {
  S: '#d4a017', A: '#a78bfa', B: '#60a5fa', C: '#6b6488',
};

function PlayerAvatar({ name, avatarUrl, size = 44 }: { name: string; avatarUrl?: string | null; size?: number }) {
  const hue = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  return (
    <div
      className="rounded-full flex items-center justify-center relative overflow-hidden shrink-0"
      style={{
        width: size, height: size,
        background: avatarUrl ? undefined : `radial-gradient(circle at 40% 35%, hsl(${hue},35%,22%) 0%, hsl(${hue},20%,10%) 100%)`,
        border: '2px solid rgba(212,160,23,0.15)',
      }}
    >
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt={name} className="w-full h-full object-cover" />
      ) : (
        <svg viewBox="0 0 24 24" fill="none" style={{ width: size * 0.6, height: size * 0.6 }}>
          <circle cx="12" cy="8" r="4" fill={`hsl(${hue},45%,55%)`} />
          <path d="M4 20c0-4.418 3.582-8 8-8s8 3.582 8 8" fill={`hsl(${hue},35%,40%)`} />
        </svg>
      )}
    </div>
  );
}

function MatchRow({ match }: { match: Match }) {
  const { t } = useT();
  const router = useRouter();
  const isLive = match.status === 'LIVE';
  const isCompleted = match.status === 'COMPLETED';
  const betClosed = !!(match.betsClosedAt && new Date() > new Date(match.betsClosedAt));

  const goToMatchWithPlayer = (player: 1 | 2, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    router.push(`/matches/${match.id}?player=${player}`);
  };

  return (
    <Link href={`/matches/${match.id}`} className="block group">
      <div
        className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-white/[0.02] border-b"
        style={{ borderColor: '#13111f' }}
      >
        {/* Player 1 */}
        <div className={cn('flex items-center gap-3 flex-1 min-w-0', isCompleted && match.winnerId !== match.player1.id && 'opacity-40')}>
          <PlayerAvatar name={match.player1.name} avatarUrl={match.player1.avatarUrl} size={44} />
          <div className="min-w-0">
            <p className="font-cinzel font-bold text-[#e8e2f5] truncate text-[13px] group-hover:text-[#d4a017] transition-colors">
              {match.player1.name}
            </p>
            {!isCompleted && !betClosed && (
              <button onClick={(e) => goToMatchWithPlayer(1, e)} className="text-[#d4a017] font-cinzel font-bold text-base mt-0.5 hover:text-[#f5c842] hover:underline transition-colors cursor-pointer">
                {match.odds1.toFixed(2)}×
              </button>
            )}
          </div>
        </div>

        {/* Center */}
        <div className="flex flex-col items-center gap-1 shrink-0 w-28">
          {isCompleted && match.resultScore ? (
            <span className="font-cinzel font-black text-lg text-[#e8e2f5]">{match.resultScore}</span>
          ) : isLive ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}>
              <Zap size={10} className="text-red-400" />
              <span className="text-red-400 font-cinzel text-[11px] font-bold">LIVE</span>
            </div>
          ) : (
            <span className="text-[#4a4570] font-cinzel text-xs tracking-widest">VS</span>
          )}
          <div className="flex items-center gap-1 text-[10px] text-[#6b6488]">
            {match.game && match.game !== 'AoE4' && (
              <span className="text-[#d4a017]/70 font-cinzel border border-[#d4a017]/20 rounded px-1 py-px mr-1">
                {match.game}
              </span>
            )}
            {isCompleted ? (
              <span className="font-cinzel">{t('matches_finished')}</span>
            ) : betClosed ? (
              <span>{t('matches_bets_closed')}</span>
            ) : (
              <><Clock size={9} /><span>{formatCountdown(match.scheduledAt, t)}</span></>
            )}
          </div>
        </div>

        {/* Player 2 */}
        <div className={cn('flex items-center gap-3 flex-1 min-w-0 justify-end', isCompleted && match.winnerId !== match.player2.id && 'opacity-40')}>
          <div className="min-w-0 text-right">
            <p className="font-cinzel font-bold text-[#e8e2f5] truncate text-[13px] group-hover:text-[#d4a017] transition-colors">
              {match.player2.name}
            </p>
            {!isCompleted && !betClosed && (
              <button onClick={(e) => goToMatchWithPlayer(2, e)} className="text-[#d4a017] font-cinzel font-bold text-base mt-0.5 hover:text-[#f5c842] hover:underline transition-colors cursor-pointer">
                {match.odds2.toFixed(2)}×
              </button>
            )}
          </div>
          <PlayerAvatar name={match.player2.name} avatarUrl={match.player2.avatarUrl} size={44} />
        </div>

        <ChevronRight size={14} className="shrink-0 text-[#3d3860] group-hover:text-[#d4a017] transition-colors" />
      </div>
    </Link>
  );
}

function MatchSkeleton() {
  return (
    <div className="flex items-center gap-4 px-5 py-4 border-b" style={{ borderColor: '#13111f' }}>
      <div className="flex items-center gap-3 flex-1">
        <Skeleton className="rounded-full shrink-0" style={{ width: 44, height: 44 }} />
        <div className="space-y-2">
          <Skeleton className="h-3.5 w-28 rounded" />
          <Skeleton className="h-4 w-10 rounded" />
        </div>
      </div>
      <div className="flex flex-col items-center gap-1.5 w-28">
        <Skeleton className="h-3 w-8 rounded" />
        <Skeleton className="h-3 w-14 rounded" />
      </div>
      <div className="flex items-center gap-3 flex-1 justify-end">
        <div className="space-y-2 text-right">
          <Skeleton className="h-3.5 w-28 rounded ml-auto" />
          <Skeleton className="h-4 w-10 rounded ml-auto" />
        </div>
        <Skeleton className="rounded-full shrink-0" style={{ width: 44, height: 44 }} />
      </div>
    </div>
  );
}

const GAME_TABS = [
  { id: 'all', label: 'All' },
  { id: 'AoE2', label: 'AoE2' },
  { id: 'AoE4', label: 'AoE4' },
  { id: 'AoE3', label: 'AoE3' },
  { id: 'AoM', label: 'AoM' },
] as const;

export default function MatchesPage() {
  const { t } = useT();
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [filter, setFilter]   = useState('all');
  const [gameFilter, setGameFilter] = useState('all');
  const [search, setSearch]   = useState('');

  const FILTERS = [
    { id: 'all',       label: t('matches_filter_all') },
    { id: 'LIVE',      label: t('matches_filter_live') },
    { id: 'UPCOMING',  label: t('matches_filter_upcoming') },
    { id: 'COMPLETED', label: t('matches_filter_done') },
  ];

  const fetchMatches = useCallback(async () => {
    try {
      setError(null);
      const res = await getMatches({ hours: 168 });
      setMatches(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common_error'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMatches();
    const interval = setInterval(fetchMatches, 30_000);
    return () => clearInterval(interval);
  }, [fetchMatches]);

  const searchLower = search.trim().toLowerCase();
  const filtered  = matches
    .filter(m => filter === 'all' || m.status === filter)
    .filter(m => gameFilter === 'all' || m.game === gameFilter)
    .filter(m => {
      if (!searchLower) return true;
      return m.player1.name.toLowerCase().includes(searchLower)
        || m.player2.name.toLowerCase().includes(searchLower)
        || (m.tournament?.name ?? '').toLowerCase().includes(searchLower);
    })
    .slice()
    .sort((a, b) => {
      if (a.status === 'COMPLETED' && b.status !== 'COMPLETED') return 1;
      if (b.status === 'COMPLETED' && a.status !== 'COMPLETED') return -1;
      return 0;
    });
  const liveCount = matches.filter(m => m.status === 'LIVE').length;
  const upcoming  = matches.filter(m => m.status === 'UPCOMING').length;
  const availableGames = new Set(matches.map(m => m.game).filter(Boolean));

  // Group by tournament
  const groups: { id: string; name: string; tier: string; format: string; matches: Match[] }[] = [];
  for (const match of filtered) {
    const tid = match.tournament?.id ?? 'none';
    const g = groups.find(x => x.id === tid);
    if (g) { g.matches.push(match); }
    else groups.push({ id: tid, name: match.tournament?.name ?? t('matches_no_tournament'), tier: match.tournament?.tier ?? 'C', format: match.format, matches: [match] });
  }

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="relative border-b border-[#1e1a30] px-6 py-6 overflow-hidden" style={{ background: 'linear-gradient(180deg, #0a0918 0%, #07060f 100%)' }}>
        <div className="absolute top-0 left-0 right-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, #d4a017 40%, #f5c842 50%, #d4a017 60%, transparent)' }} />
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(212,160,23,0.08)', border: '1px solid rgba(212,160,23,0.2)' }}>
              <Swords size={18} className="text-[#d4a017]" />
            </div>
            <div>
              <h1 className="font-cinzel font-black text-2xl tracking-[0.12em] text-[#f5c842] uppercase">{t('matches_title')}</h1>
              <div className="flex items-center gap-3 mt-0.5">
                {liveCount > 0 && <span className="flex items-center gap-1 text-[11px] text-red-400 font-cinzel"><span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse inline-block" />{liveCount} {t('matches_filter_live')}</span>}
                <span className="text-[11px] text-[#6b6488] font-cinzel">{upcoming} {t('matches_upcoming_label')} · {matches.length} {t('matches_total')}</span>
              </div>
            </div>
          </div>
          <button onClick={fetchMatches} disabled={loading} className="p-2 rounded-lg border border-[#1e1a30] text-[#6b6488] hover:text-[#d4a017] hover:border-[#d4a017]/20 transition-colors">
            <RefreshCw size={14} className={loading ? 'animate-spin text-[#d4a017]' : ''} />
          </button>
        </div>
      </div>

      <div className="px-5 py-5 space-y-4">
        {/* Game filter chips */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {GAME_TABS.filter(g => g.id === 'all' || availableGames.has(g.id)).map(g => (
            <button
              key={g.id}
              onClick={() => setGameFilter(g.id)}
              className={cn(
                'shrink-0 px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors border',
                gameFilter === g.id
                  ? 'bg-[#d4a017] text-black border-[#d4a017]'
                  : 'bg-transparent text-[#9990b8] border-[#1e1a30] hover:border-[#3d3860] hover:text-[#e8e2f5]'
              )}
            >
              {g.id === 'all' ? t('tourn_all_games') : g.label}
            </button>
          ))}
        </div>

        {/* Search + status filters */}
        <div className="flex items-center gap-3">
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

          <div className="flex shrink-0 border border-[#1e1a30] rounded-md overflow-hidden">
            {FILTERS.map(f => {
              const isActive = filter === f.id;
              const count = f.id === 'LIVE' ? liveCount : f.id === 'UPCOMING' ? upcoming : undefined;
              return (
                <button key={f.id} onClick={() => setFilter(f.id)}
                  className={cn('flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold tracking-wider uppercase transition-colors',
                    isActive ? 'bg-[#1e1a30] text-[#e8e2f5]' : 'text-[#6b6488] hover:text-[#9990b8]')}
                >
                  {f.id === 'LIVE' && liveCount > 0 && <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />}
                  {f.label}
                  {count !== undefined && count > 0 && !isActive && <span className="text-[9px] bg-[#1e1a30] px-1.5 py-0.5 rounded-full font-sans">{count}</span>}
                </button>
              );
            })}
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-900/30 bg-red-950/10 p-4 mb-5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2"><AlertTriangle size={13} className="text-red-400 shrink-0" /><p className="text-red-400 text-sm">{error}</p></div>
            <button onClick={fetchMatches} className="text-xs text-[#6b6488] hover:text-[#e8e2f5] underline shrink-0">{t('common_retry')}</button>
          </div>
        )}

        {loading ? (
          <div className="rounded-xl overflow-hidden" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
            {[1, 2, 3].map(i => <MatchSkeleton key={i} />)}
          </div>
        ) : groups.length > 0 ? (
          <div className="space-y-4">
            {groups.map(g => (
              <div key={g.id} className="rounded-xl overflow-hidden" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
                {/* Tournament header — minimal */}
                <div className="flex items-center gap-3 px-5 py-3 border-b" style={{ borderColor: '#1e1a30', background: 'rgba(0,0,0,0.2)' }}>
                  <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: TIER_COLORS[g.tier] ?? '#6b6488' }} />
                  <span className="text-[11px] font-cinzel font-semibold truncate" style={{ color: TIER_COLORS[g.tier] ?? '#6b6488' }}>{g.name}</span>
                  <span className="text-[10px] text-[#3d3860] ml-auto shrink-0 font-cinzel">{g.format} · {g.matches.length} {t('nav_matches').toLowerCase()}</span>
                </div>
                {g.matches.map(m => <MatchRow key={m.id} match={m} />)}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-24">
            <Swords size={28} className="text-[#3d3860] mb-4" />
            <p className="font-cinzel text-sm tracking-widest text-[#6b6488]">
              {filter !== 'all' ? t('matches_empty_filter') : t('matches_empty')}
            </p>
            {filter !== 'all' && (
              <button onClick={() => setFilter('all')} className="mt-4 text-xs text-[#d4a017] font-cinzel hover:underline">{t('matches_see_all')}</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
