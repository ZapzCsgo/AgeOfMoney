'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Trophy, Calendar, ExternalLink, Users, Clock, Tv, Crown, ArrowLeft } from 'lucide-react';
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Match, Tournament } from '@/types';
import { useT } from '@/lib/i18n';

export interface TournamentDetail extends Tournament {
  twitchChannel?: string | null;
  matches: { upcoming: Match[]; live: Match[]; completed: Match[]; all: Match[] };
  participantCount: number;
}

function PlayerMini({ name, avatarUrl, size = 28 }: { name: string; avatarUrl?: string | null; size?: number }) {
  const initial = name?.[0]?.toUpperCase() ?? '?';
  return (
    <div className="relative rounded-full overflow-hidden shrink-0" style={{ width: size, height: size, border: '1px solid rgba(255,197,66,0.2)' }}>
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt={name} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-[11px] font-bold" style={{ background: 'rgba(255,197,66,0.2)', color: '#8981ab' }}>
          {initial}
        </div>
      )}
    </div>
  );
}

function MatchRow({ match }: { match: Match }) {
  const { t } = useT();
  const isLive = match.status === 'LIVE';
  const isCompleted = match.status === 'COMPLETED';
  const p1Won = isCompleted && match.winnerId === match.player1.id;
  const p2Won = isCompleted && match.winnerId === match.player2.id;
  const when = match.scheduledAt ? new Date(match.scheduledAt) : null;

  return (
    <Link
      href={`/matches/${match.id}`}
      className="flex items-center gap-3 px-4 py-3 rounded-lg border transition-all hover:border-[#ffc542]/30"
      style={{ background: '#0d0b1a', borderColor: 'rgba(255,197,66,0.2)' }}
    >
      {/* P1 */}
      <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
        <div className="min-w-0 text-right">
          <p className={cn(
            'font-cinzel font-bold truncate text-[12px]',
            p1Won ? 'text-[#ffd97a]' : p2Won ? 'text-[#8981ab]' : 'text-[#e8e2f5]'
          )}>
            {match.player1.name}
          </p>
        </div>
        <div className="relative">
          <PlayerMini name={match.player1.name} avatarUrl={match.player1.avatarUrl} size={28} />
          {p1Won && (
            <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[14px] leading-none drop-shadow-[0_0_4px_rgba(255,197,66,0.6)]">
              👑
            </span>
          )}
        </div>
      </div>

      {/* Center — score / VS / status */}
      <div className="flex flex-col items-center shrink-0 w-16">
        {isCompleted && match.resultScore ? (
          <p className="font-cinzel font-black text-[14px] text-[#e8e2f5]">
            <span className={p1Won ? 'text-[#ffd97a]' : 'text-[#3d3860]'}>{match.resultScore.split('-')[0]}</span>
            <span className="text-[#3d3860] mx-1">-</span>
            <span className={p2Won ? 'text-[#ffd97a]' : 'text-[#3d3860]'}>{match.resultScore.split('-')[1]}</span>
          </p>
        ) : isLive ? (
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-bold" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}>
            <span className="w-1 h-1 rounded-full bg-red-400 animate-pulse" />
            {t('matches_filter_live').toUpperCase()}
          </div>
        ) : (
          <span className="text-[#3d3860] font-cinzel text-[11px] tracking-[0.15em] font-bold">VS</span>
        )}
        {!isLive && !isCompleted && when && (
          <div className="flex items-center gap-1 mt-0.5 text-[9px] text-[#8981ab]">
            <Clock size={8} />
            <span>{when.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} {when.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        )}
        {isCompleted && (
          <span className="text-[8px] font-bold text-[#4a4570] tracking-wider mt-0.5">{t('common_end_abbr')}</span>
        )}
      </div>

      {/* P2 */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <div className="relative">
          <PlayerMini name={match.player2.name} avatarUrl={match.player2.avatarUrl} size={28} />
          {p2Won && (
            <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[14px] leading-none drop-shadow-[0_0_4px_rgba(255,197,66,0.6)]">
              👑
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className={cn(
            'font-cinzel font-bold truncate text-[12px]',
            p2Won ? 'text-[#ffd97a]' : p1Won ? 'text-[#8981ab]' : 'text-[#e8e2f5]'
          )}>
            {match.player2.name}
          </p>
        </div>
      </div>

      {!isCompleted && (
        <div className="flex items-center gap-1 shrink-0 ml-2 text-[10px] text-[#ffc542] font-cinzel font-bold tabular-nums">
          <span>{match.odds1.toFixed(2)}</span>
          <span className="text-[#3d3860] mx-0.5">|</span>
          <span>{match.odds2.toFixed(2)}</span>
        </div>
      )}
    </Link>
  );
}

export function TournamentPageClient({ tournamentId, initialTournament, initialNotFound }: {
  tournamentId: string;
  initialTournament: TournamentDetail | null;
  initialNotFound: boolean;
}) {
  const { t } = useT();
  const router = useRouter();
  const id = tournamentId;

  const [tournament, setTournament] = useState<TournamentDetail | null>(initialTournament);
  const [loading, setLoading] = useState(!initialTournament && !initialNotFound);
  const [notFound, setNotFound] = useState(initialNotFound);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiClient.get(`/tournaments/${id}`);
        if (!cancelled) {
          setTournament(res.data?.data ?? null);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          const status = (err as { response?: { status?: number } }).response?.status;
          setNotFound(status === 404);
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const tierBadge = useMemo(() => {
    const t = tournament?.tier ?? '?';
    const styles: Record<string, string> = {
      S: 'text-[#ffc542] bg-[#ffc54215] border-[#ffc54240]',
      A: 'text-[#a78bfa] bg-[#a78bfa15] border-[#a78bfa40]',
      B: 'text-[#60a5fa] bg-[#60a5fa15] border-[#60a5fa40]',
      C: 'text-[#8981ab] bg-[#8981ab15] border-[#8981ab40]',
    };
    return styles[t] ?? styles.C;
  }, [tournament?.tier]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#07060f' }}>
        <div className="w-8 h-8 border-2 border-[#ffc542] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (notFound || !tournament) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: '#07060f' }}>
        <div className="text-center p-8 rounded-xl max-w-md" style={{ background: '#0d0b1a', border: '1px solid rgba(255,197,66,0.2)' }}>
          <Trophy size={40} className="text-[#3d3860] mx-auto mb-3" />
          <h2 className="font-cinzel font-bold text-lg text-[#ffc542] mb-2">{t('tournament_not_found_title')}</h2>
          <p className="text-[13px] text-[#8981ab] mb-5">{t('tournament_not_found_desc')}</p>
          <Link href="/tournaments" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold"
            style={{ background: 'linear-gradient(135deg, #b8881a, #ffc542)', color: '#07060f' }}>
            <ArrowLeft size={14} />
            {t('tournament_view_all')}
          </Link>
        </div>
      </div>
    );
  }

  const { upcoming, live, completed } = tournament.matches;
  const startDate = new Date(tournament.startDate);
  const endDate = tournament.endDate ? new Date(tournament.endDate) : null;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Back link */}
      <button
        onClick={() => router.back()}
        className="inline-flex items-center gap-2 text-[12px] text-[#8981ab] hover:text-[#e8e2f5] transition-colors"
      >
        <ArrowLeft size={14} />
        {t('deposit_back')}
      </button>

      {/* Header */}
      <div className="rounded-xl p-6 space-y-4" style={{ background: '#0d0b1a', border: '1px solid rgba(255,197,66,0.2)' }}>
        <div className="flex items-start gap-4">
          {tournament.logoUrl ? (
            <div className="rounded-lg overflow-hidden shrink-0" style={{ width: 64, height: 64, background: '#07060f' }}>
              <Image src={tournament.logoUrl} alt={tournament.name} width={64} height={64} className="object-cover" />
            </div>
          ) : (
            <div className="w-16 h-16 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: 'rgba(255,197,66,0.08)', border: '1px solid rgba(255,197,66,0.25)' }}>
              <Trophy size={24} className="text-[#ffc542]" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider', tierBadge)}>
                {tournament.tier}-tier
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#1e1a30] text-[#9990b8] uppercase tracking-wider">
                {tournament.game}
              </span>
              {tournament.isActive && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider"
                  style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' }}>
                  {t('common_active')}
                </span>
              )}
            </div>
            <h1 className="font-cinzel font-black text-2xl text-[#ffc542] leading-tight">
              {tournament.name}
            </h1>
          </div>
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap gap-4 pt-4 border-t text-[12px]" style={{ borderColor: 'rgba(255,197,66,0.2)' }}>
          <div className="flex items-center gap-1.5 text-[#9990b8]">
            <Calendar size={13} className="text-[#8981ab]" />
            <span>
              {startDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
              {endDate && ` → ${endDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}`}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[#9990b8]">
            <Users size={13} className="text-[#8981ab]" />
            <span>{t('common_participant_count', { n: tournament.participantCount, plural: tournament.participantCount > 1 ? 's' : '' })}</span>
          </div>
          {tournament.prizePool && (
            <div className="flex items-center gap-1.5 text-[#ffc542] font-semibold">
              <Crown size={13} />
              <span>{tournament.prizePool}</span>
            </div>
          )}
          {tournament.twitchChannel && (
            <a
              href={`https://twitch.tv/${tournament.twitchChannel}`}
              target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[#a78bfa] hover:text-[#c4b5fd] transition-colors"
            >
              <Tv size={13} />
              <span>{tournament.twitchChannel}</span>
            </a>
          )}
          {tournament.liquipediaUrl && !/_tba\b|_tbd\b|\/tba\b|_event_tba/i.test(tournament.liquipediaUrl) && (
            // Masque le lien si l'URL ressemble à un placeholder TBA du
            // scraper (ex : `/ageofempires2/membtv_event_tba`) — ces pages
            // renvoient 404 sur Liquipedia car elles n'ont jamais existé.
            // Apparaît dès qu'un match réel atterrit dans le tournoi avec
            // une liquipediaUrl légitime.
            <a
              href={tournament.liquipediaUrl}
              target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[#8981ab] hover:text-[#9990b8] transition-colors ml-auto"
            >
              <ExternalLink size={13} />
              <span>Liquipedia</span>
            </a>
          )}
        </div>
      </div>

      {/* Live */}
      {live.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-cinzel font-bold text-sm text-[#ffc542] tracking-wider uppercase flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
            {t('tournament_live_now')}
            <span className="text-[10px] text-[#8981ab] font-normal normal-case tracking-normal">
              {t('common_match_count', { n: live.length, plural: live.length > 1 ? 's' : '' })}
            </span>
          </h2>
          <div className="space-y-2">
            {live.map(m => <MatchRow key={m.id} match={m} />)}
          </div>
        </section>
      )}

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-cinzel font-bold text-sm text-[#ffc542] tracking-wider uppercase flex items-center gap-2">
            <Calendar size={14} />
            {t('matches_filter_upcoming')}
            <span className="text-[10px] text-[#8981ab] font-normal normal-case tracking-normal">
              {t('common_match_count', { n: upcoming.length, plural: upcoming.length > 1 ? 's' : '' })}
            </span>
          </h2>
          <div className="space-y-2">
            {upcoming.map(m => <MatchRow key={m.id} match={m} />)}
          </div>
        </section>
      )}

      {/* Completed */}
      {completed.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-cinzel font-bold text-sm text-[#ffc542] tracking-wider uppercase flex items-center gap-2">
            <Trophy size={14} />
            {t('matches_filter_done')}
            <span className="text-[10px] text-[#8981ab] font-normal normal-case tracking-normal">
              {t('common_match_count', { n: completed.length, plural: completed.length > 1 ? 's' : '' })}
            </span>
          </h2>
          <div className="space-y-2">
            {completed.map(m => <MatchRow key={m.id} match={m} />)}
          </div>
        </section>
      )}

      {/* Empty state */}
      {live.length === 0 && upcoming.length === 0 && completed.length === 0 && (
        <div className="text-center py-12 rounded-xl" style={{ background: '#0d0b1a', border: '1px solid rgba(255,197,66,0.2)' }}>
          <Trophy size={32} className="text-[#3d3860] mx-auto mb-2" />
          <p className="text-[13px] text-[#8981ab]">{t('tournament_no_matches')}</p>
          <p className="text-[11px] text-[#4a4570] mt-1">{t('tournament_come_back_soon')}</p>
        </div>
      )}
    </div>
  );
}
