'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Trophy, Calendar, ExternalLink, Users, Clock, Tv, Crown, ArrowLeft } from 'lucide-react';
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Match, Tournament } from '@/types';

interface TournamentDetail extends Tournament {
  twitchChannel?: string | null;
  matches: { upcoming: Match[]; live: Match[]; completed: Match[]; all: Match[] };
  participantCount: number;
}

function PlayerMini({ name, avatarUrl, size = 28 }: { name: string; avatarUrl?: string | null; size?: number }) {
  const initial = name?.[0]?.toUpperCase() ?? '?';
  return (
    <div className="relative rounded-full overflow-hidden shrink-0" style={{ width: size, height: size, border: '1px solid #1e1a30' }}>
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt={name} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-[11px] font-bold" style={{ background: '#1e1a30', color: '#6b6488' }}>
          {initial}
        </div>
      )}
    </div>
  );
}

function MatchRow({ match }: { match: Match }) {
  const isLive = match.status === 'LIVE';
  const isCompleted = match.status === 'COMPLETED';
  const p1Won = isCompleted && match.winnerId === match.player1.id;
  const p2Won = isCompleted && match.winnerId === match.player2.id;
  const when = match.scheduledAt ? new Date(match.scheduledAt) : null;

  return (
    <Link
      href={`/matches/${match.id}`}
      className="flex items-center gap-3 px-4 py-3 rounded-lg border transition-all hover:border-[#ffc542]/30"
      style={{ background: '#0d0b1a', borderColor: '#1e1a30' }}
    >
      {/* P1 */}
      <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
        <div className="min-w-0 text-right">
          <p className={cn(
            'font-cinzel font-bold truncate text-[12px]',
            p1Won ? 'text-[#ffd97a]' : p2Won ? 'text-[#6b6488]' : 'text-[#e8e2f5]'
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
            LIVE
          </div>
        ) : (
          <span className="text-[#3d3860] font-cinzel text-[11px] tracking-[0.15em] font-bold">VS</span>
        )}
        {!isLive && !isCompleted && when && (
          <div className="flex items-center gap-1 mt-0.5 text-[9px] text-[#6b6488]">
            <Clock size={8} />
            <span>{when.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} {when.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        )}
        {isCompleted && (
          <span className="text-[8px] font-bold text-[#4a4570] tracking-wider mt-0.5">FIN</span>
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
            p2Won ? 'text-[#ffd97a]' : p1Won ? 'text-[#6b6488]' : 'text-[#e8e2f5]'
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

export default function TournamentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params.id === 'string' ? params.id : Array.isArray(params.id) ? params.id[0] : '';

  const [tournament, setTournament] = useState<TournamentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

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
      C: 'text-[#6b6488] bg-[#6b648815] border-[#6b648840]',
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
        <div className="text-center p-8 rounded-xl max-w-md" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
          <Trophy size={40} className="text-[#3d3860] mx-auto mb-3" />
          <h2 className="font-cinzel font-bold text-lg text-[#ffc542] mb-2">Tournoi introuvable</h2>
          <p className="text-[13px] text-[#6b6488] mb-5">Ce tournoi n'existe pas ou a été supprimé.</p>
          <Link href="/tournaments" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold"
            style={{ background: 'linear-gradient(135deg, #b8881a, #ffc542)', color: '#07060f' }}>
            <ArrowLeft size={14} />
            Voir tous les tournois
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
        className="inline-flex items-center gap-2 text-[12px] text-[#6b6488] hover:text-[#e8e2f5] transition-colors"
      >
        <ArrowLeft size={14} />
        Retour
      </button>

      {/* Header */}
      <div className="rounded-xl p-6 space-y-4" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
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
                  Actif
                </span>
              )}
            </div>
            <h1 className="font-cinzel font-black text-2xl text-[#ffc542] leading-tight">
              {tournament.name}
            </h1>
          </div>
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap gap-4 pt-4 border-t text-[12px]" style={{ borderColor: '#1e1a30' }}>
          <div className="flex items-center gap-1.5 text-[#9990b8]">
            <Calendar size={13} className="text-[#6b6488]" />
            <span>
              {startDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
              {endDate && ` → ${endDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}`}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[#9990b8]">
            <Users size={13} className="text-[#6b6488]" />
            <span>{tournament.participantCount} participant{tournament.participantCount > 1 ? 's' : ''}</span>
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
              className="flex items-center gap-1.5 text-[#6b6488] hover:text-[#9990b8] transition-colors ml-auto"
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
            En direct
            <span className="text-[10px] text-[#6b6488] font-normal normal-case tracking-normal">
              {live.length} match{live.length > 1 ? 's' : ''}
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
            À venir
            <span className="text-[10px] text-[#6b6488] font-normal normal-case tracking-normal">
              {upcoming.length} match{upcoming.length > 1 ? 's' : ''}
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
            Terminés
            <span className="text-[10px] text-[#6b6488] font-normal normal-case tracking-normal">
              {completed.length} match{completed.length > 1 ? 's' : ''}
            </span>
          </h2>
          <div className="space-y-2">
            {completed.map(m => <MatchRow key={m.id} match={m} />)}
          </div>
        </section>
      )}

      {/* Empty state */}
      {live.length === 0 && upcoming.length === 0 && completed.length === 0 && (
        <div className="text-center py-12 rounded-xl" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
          <Trophy size={32} className="text-[#3d3860] mx-auto mb-2" />
          <p className="text-[13px] text-[#6b6488]">Aucun match programmé pour ce tournoi pour l'instant.</p>
          <p className="text-[11px] text-[#4a4570] mt-1">Reviens bientôt !</p>
        </div>
      )}
    </div>
  );
}
