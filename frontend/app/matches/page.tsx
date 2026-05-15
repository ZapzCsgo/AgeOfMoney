'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Match } from '@/types';
import { getMatches } from '@/lib/api';
import { cn, getAvatarSrc } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Clock, RefreshCw, AlertTriangle, Swords, Search } from 'lucide-react';
import { useT, type TKey } from '@/lib/i18n';
import { EmptyState } from '@/components/ui/empty-state';
import { JsonLd } from '@/components/JsonLd';

function formatCountdown(dateStr: string, t: (k: TKey) => string): string {
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff <= 0) return t('matches_imminent');
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
}

const TIER_COLORS: Record<string, string> = {
  S: '#ffc542', A: '#a78bfa', B: '#60a5fa', C: '#6b6488',
};

const GAME_STYLE: Record<string, { bg: string; text: string; border: string }> = {
  AoE4: { bg: 'rgba(255,197,66,0.10)', text: '#ffd97a', border: 'rgba(255,197,66,0.25)' },
  AoE2: { bg: 'rgba(248,113,113,0.10)', text: '#f87171', border: 'rgba(248,113,113,0.40)' },
  AoE3: { bg: 'rgba(96,165,250,0.10)', text: '#60a5fa', border: 'rgba(96,165,250,0.40)' },
  AoM:  { bg: 'rgba(52,211,153,0.10)', text: '#34d399', border: 'rgba(52,211,153,0.40)' },
  AoE1: { bg: 'rgba(251,146,60,0.10)', text: '#fb923c', border: 'rgba(251,146,60,0.40)' },
};

function PlayerAvatar({ name, playerId, avatarUrl, size = 44 }: { name: string; playerId?: string; avatarUrl?: string | null; size?: number }) {
  const hue = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  const imgSrc = playerId ? getAvatarSrc(playerId, avatarUrl) : avatarUrl;
  return (
    <div
      className="rounded-full flex items-center justify-center relative overflow-hidden shrink-0"
      style={{
        width: size, height: size,
        background: imgSrc ? undefined : `radial-gradient(circle at 40% 35%, hsl(${hue},35%,22%) 0%, hsl(${hue},20%,10%) 100%)`,
        border: '2px solid rgba(255,197,66,0.15)',
      }}
    >
      {imgSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imgSrc} alt={name} className="w-full h-full object-cover object-top" />
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
  const p1Won = isCompleted && match.winnerId === match.player1.id;
  const p2Won = isCompleted && match.winnerId === match.player2.id;

  const goToMatchWithPlayer = (player: 1 | 2, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    router.push(`/matches/${match.id}?player=${player}`);
  };

  return (
    <Link href={`/matches/${match.id}`} className="block group">
      <div
        className="flex items-center gap-2 px-3 py-2.5 transition-all hover:bg-white/[0.02] rounded-lg"
        style={{ minHeight: 56 }}
      >
        {/* Player 1 */}
        <button
          onClick={(e) => { if (!isCompleted && !betClosed) goToMatchWithPlayer(1, e); }}
          className={cn(
            'flex items-center gap-2 min-w-0 flex-1 rounded-md px-1.5 py-1 transition-all text-left',
            !isCompleted && !betClosed && 'hover:bg-[#ffc542]/[0.06]',
            p2Won && 'opacity-30'
          )}
        >
          <div className="relative shrink-0">
            <PlayerAvatar name={match.player1.name} playerId={match.player1.id} avatarUrl={match.player1.avatarUrl} size={32} />
            {p1Won && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[18px] leading-none drop-shadow-[0_0_6px_rgba(255,197,66,0.7)] select-none pointer-events-none">
                👑
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className={cn(
              'font-cinzel font-bold truncate text-[12px] leading-tight transition-colors',
              p1Won ? 'text-[#ffd97a]' : 'text-[#e8e2f5]'
            )}>
              {match.player1.name}
            </p>
            {!isCompleted && !betClosed ? (
              <p className="text-[#ffc542] font-cinzel font-black text-[14px] leading-none mt-0.5">
                {match.odds1.toFixed(2)}<span className="text-[10px] opacity-60">×</span>
              </p>
            ) : isCompleted && match.resultScore ? (
              <p className={cn('font-cinzel font-black text-[14px] leading-none mt-0.5', p1Won ? 'text-[#ffd97a]' : 'text-[#3d3860]')}>
                {match.resultScore.split('-')[0]}
              </p>
            ) : (
              <p className="text-[10px] text-[#6b6488] mt-0.5">—</p>
            )}
          </div>
        </button>

        {/* Center — score or status */}
        <div className="flex flex-col items-center gap-0.5 shrink-0 w-12">
          {isLive ? (
            <>
              {/* Score in-match : toujours caché si 0-0 (pas d'info utile, et
                  évite de contredire un stream qui serait déjà à 1-0).
                  Dès qu'un joueur a marqué, on affiche — que le match ait un
                  stream ou pas, le score brut vaut l'info. */}
              {match.p1Score != null && match.p2Score != null
                && (match.p1Score > 0 || match.p2Score > 0) ? (
                <p className="font-cinzel font-black text-[14px] text-[#e8e2f5]">
                  {match.p1Score}<span className="text-[#3d3860] mx-0.5">-</span>{match.p2Score}
                </p>
              ) : null}
              <div className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-bold" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}>
                <span className="w-1 h-1 rounded-full bg-red-400 animate-pulse" />
                LIVE
              </div>
            </>
          ) : isCompleted ? (
            <>
              {match.resultScore && (
                <p className="font-cinzel font-black text-[14px]">
                  <span className={p1Won ? 'text-[#ffd97a]' : 'text-[#3d3860]'}>{match.resultScore.split('-')[0]}</span>
                  <span className="text-[#3d3860] mx-0.5">-</span>
                  <span className={p2Won ? 'text-[#ffd97a]' : 'text-[#3d3860]'}>{match.resultScore.split('-')[1]}</span>
                </p>
              )}
              <span className="text-[8px] font-bold text-[#4a4570] tracking-wider">FIN</span>
              {/* Finished-at date : short locale-aware ("24 avr.") so users
                  can tell how old the result is at a glance. */}
              <span className="text-[8px] text-[#3d3860] tabular-nums whitespace-nowrap" title={new Date(match.updatedAt).toLocaleString()}>
                {new Date(match.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
              </span>
            </>
          ) : (
            <>
              <span className="text-[#3d3860] font-cinzel text-[10px] tracking-[0.15em] font-bold">VS</span>
              <div className="flex items-center gap-0.5 text-[8px] text-[#6b6488] font-medium whitespace-nowrap">
                {betClosed ? (
                  <span>{t('matches_bets_closed')}</span>
                ) : (
                  <><Clock size={7} /><span>{formatCountdown(match.scheduledAt, t)}</span></>
                )}
              </div>
            </>
          )}
        </div>

        {/* Player 2 */}
        <button
          onClick={(e) => { if (!isCompleted && !betClosed) goToMatchWithPlayer(2, e); }}
          className={cn(
            'flex items-center gap-2 min-w-0 flex-1 rounded-md px-1.5 py-1 justify-end transition-all text-right',
            !isCompleted && !betClosed && 'hover:bg-[#ffc542]/[0.06]',
            p1Won && 'opacity-30'
          )}
        >
          <div className="min-w-0 flex-1 text-right">
            <p className={cn(
              'font-cinzel font-bold truncate text-[12px] leading-tight transition-colors',
              p2Won ? 'text-[#ffd97a]' : 'text-[#e8e2f5]'
            )}>
              {match.player2.name}
            </p>
            {!isCompleted && !betClosed ? (
              <p className="text-[#ffc542] font-cinzel font-black text-[14px] leading-none mt-0.5">
                {match.odds2.toFixed(2)}<span className="text-[10px] opacity-60">×</span>
              </p>
            ) : isCompleted && match.resultScore ? (
              <p className={cn('font-cinzel font-black text-[14px] leading-none mt-0.5', p2Won ? 'text-[#ffd97a]' : 'text-[#3d3860]')}>
                {match.resultScore.split('-')[1]}
              </p>
            ) : (
              <p className="text-[10px] text-[#6b6488] mt-0.5">—</p>
            )}
          </div>
          <div className="relative shrink-0">
            <PlayerAvatar name={match.player2.name} playerId={match.player2.id} avatarUrl={match.player2.avatarUrl} size={32} />
            {p2Won && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[18px] leading-none drop-shadow-[0_0_6px_rgba(255,197,66,0.7)] select-none pointer-events-none">
                👑
              </span>
            )}
          </div>
        </button>
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
  const groups: { id: string; name: string; tier: string; format: string; game: string; matches: Match[] }[] = [];
  for (const match of filtered) {
    const tid = match.tournament?.id ?? 'none';
    const g = groups.find(x => x.id === tid);
    if (g) { g.matches.push(match); }
    else groups.push({ id: tid, name: match.tournament?.name ?? t('matches_no_tournament'), tier: match.tournament?.tier ?? 'C', format: match.format, game: match.game ?? 'AoE4', matches: [match] });
  }

  const matchListSchema = matches.length > 0 ? {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Matchs Age of Empires — AgeOfMoney',
    description: 'Liste des matchs professionnels Age of Empires disponibles pour les paris : AoE4, AoE2, AoE3, AoM.',
    url: 'https://ageof.money/matches',
    numberOfItems: matches.filter(m => m.status !== 'COMPLETED').length,
    itemListElement: matches
      .filter(m => m.status !== 'COMPLETED')
      .slice(0, 20)
      .map((m, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: `${m.player1.name} vs ${m.player2.name}${m.tournament ? ` — ${m.tournament.name}` : ''}`,
        url: `https://ageof.money/matches/${m.id}`,
        item: {
          '@type': 'SportsEvent',
          name: `${m.player1.name} vs ${m.player2.name}`,
          startDate: m.scheduledAt,
          eventStatus: m.status === 'LIVE' ? 'https://schema.org/EventScheduled' : 'https://schema.org/EventScheduled',
          competitor: [
            { '@type': 'Person', name: m.player1.name },
            { '@type': 'Person', name: m.player2.name },
          ],
        },
      })),
  } : null;

  return (
    <div className="min-h-full">
      {matchListSchema && <JsonLd data={matchListSchema} />}
      {/* Header */}
      <div className="relative border-b border-[#1e1a30] px-6 py-6 overflow-hidden" style={{ background: 'linear-gradient(180deg, #0a0918 0%, #07060f 100%)' }}>
        <div className="absolute top-0 left-0 right-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, #ffc542 40%, #ffd97a 50%, #ffc542 60%, transparent)' }} />
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(255,197,66,0.08)', border: '1px solid rgba(255,197,66,0.2)' }}>
              <Swords size={18} className="text-[#ffc542]" />
            </div>
            <div>
              <h1 className="font-cinzel font-black text-2xl tracking-[0.12em] text-[#ffd97a] uppercase">{t('matches_title')}</h1>
              <div className="flex items-center gap-3 mt-0.5">
                {liveCount > 0 && <span className="flex items-center gap-1 text-[11px] text-red-400 font-cinzel"><span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse inline-block" />{liveCount} {t('matches_filter_live')}</span>}
                <span className="text-[11px] text-[#6b6488] font-cinzel">{upcoming} {t('matches_upcoming_label')} · {matches.length} {t('matches_total')}</span>
              </div>
            </div>
          </div>
          <button onClick={fetchMatches} disabled={loading} className="p-2 rounded-lg border border-[#1e1a30] text-[#6b6488] hover:text-[#ffc542] hover:border-[#ffc542]/20 transition-colors">
            <RefreshCw size={14} className={loading ? 'animate-spin text-[#ffc542]' : ''} />
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
                  ? 'bg-[#ffc542] text-black border-[#ffc542]'
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
                  {(() => {
                    const gs = GAME_STYLE[g.game] ?? GAME_STYLE.AoE4;
                    return (
                      <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded font-bold tracking-wide"
                        style={{ background: gs.bg, color: gs.text, border: `1px solid ${gs.border}` }}>
                        {g.game}
                      </span>
                    );
                  })()}
                  <span className="text-[10px] text-[#3d3860] ml-auto shrink-0 font-cinzel">{g.format} · {g.matches.length} {t('nav_matches').toLowerCase()}</span>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2">
                  {g.matches.map((m, i) => (
                    <div key={m.id} className="border-b lg:even:border-l" style={{ borderColor: '#13111f' }}>
                      <MatchRow match={m} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Swords}
            title={filter !== 'all' ? t('matches_empty_filter') : t('matches_empty')}
            description={filter !== 'all' ? undefined : t('matches_empty_description')}
            actions={filter !== 'all'
              ? [{ label: t('matches_see_all'), onClick: () => setFilter('all') }]
              : [
                  { label: t('nav_tournaments'), href: '/tournaments' },
                  { label: t('nav_roulette'), href: '/roulette', variant: 'ghost' },
                ]
            }
          />
        )}
      </div>
    </div>
  );
}
