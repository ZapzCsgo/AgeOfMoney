'use client';

import Link from 'next/link';
import { Match } from '@/types';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

interface TournamentBracketProps {
  matches: Match[];
  tournamentName: string;
}

interface BracketMatch {
  id: string;
  player1Name: string;
  player2Name: string;
  score?: string;
  winnerId?: string | null;
  player1Id: string;
  player2Id: string;
  status: string;
  matchId: string;
}

interface Round {
  name: string;
  matches: BracketMatch[];
}

function groupMatchesIntoRounds(matches: Match[]): Round[] {
  const completed = matches.filter((m) => m.status === 'COMPLETED');
  const live = matches.filter((m) => m.status === 'LIVE');
  const upcoming = matches.filter((m) => m.status === 'UPCOMING');

  const toBracketMatch = (m: Match): BracketMatch => ({
    id: m.id,
    matchId: m.id,
    player1Name: m.player1.name,
    player2Name: m.player2.name,
    score: m.resultScore ?? undefined,
    winnerId: m.winnerId,
    player1Id: m.player1Id,
    player2Id: m.player2Id,
    status: m.status,
  });

  const total = matches.length;
  const rounds: Round[] = [];

  if (total >= 8) {
    const qf = completed.slice(0, 4).map(toBracketMatch);
    const sf = completed.slice(4, 6).concat(live.slice(0, 2)).map(toBracketMatch);
    const final = [...live.slice(2), ...upcoming.slice(0, 1)].slice(0, 1).map(toBracketMatch);
    if (qf.length > 0) rounds.push({ name: 'Quarts de finale', matches: qf });
    if (sf.length > 0) rounds.push({ name: 'Demi-finales', matches: sf });
    if (final.length > 0) rounds.push({ name: 'Finale', matches: final });
  } else if (total >= 4) {
    const sf = completed.slice(0, 2).concat(live.slice(0, 1)).map(toBracketMatch);
    const final = [...live.slice(1), ...upcoming.slice(0, 1)].slice(0, 1).map(toBracketMatch);
    if (sf.length > 0) rounds.push({ name: 'Demi-finales', matches: sf });
    if (final.length > 0) rounds.push({ name: 'Finale', matches: final });
  } else {
    const allRound = matches.map(toBracketMatch);
    if (allRound.length > 0) rounds.push({ name: 'Matchs', matches: allRound });
  }

  // If no rounds from logic, just show all matches
  if (rounds.length === 0 && matches.length > 0) {
    rounds.push({ name: 'Matchs', matches: matches.map(toBracketMatch) });
  }

  return rounds;
}

interface BracketMatchCardProps {
  match: BracketMatch;
}

function BracketMatchCard({ match }: BracketMatchCardProps) {
  const isCompleted = match.status === 'COMPLETED';
  const isLive = match.status === 'LIVE';
  const p1Won = match.winnerId === match.player1Id;
  const p2Won = match.winnerId === match.player2Id;

  const content = (
    <div className={cn(
      'border rounded overflow-hidden transition-all',
      isLive ? 'border-red-700/60 bg-red-900/10' : 'border-aoe-border bg-aoe-stone/50',
      match.status === 'UPCOMING' ? 'hover:border-aoe-border-gold cursor-pointer' : ''
    )}>
      {/* Player 1 row */}
      <div className={cn(
        'flex items-center justify-between px-3 py-2 border-b border-aoe-border/50',
        isCompleted && p1Won ? 'bg-aoe-gold/10' : ''
      )}>
        <span className={cn(
          'text-sm truncate max-w-[120px]',
          isCompleted && p1Won ? 'text-aoe-gold font-bold font-cinzel' :
          isCompleted && !p1Won ? 'text-aoe-parchment-muted' :
          'text-aoe-parchment'
        )}>
          {isCompleted && p1Won && '🏆 '}{match.player1Name}
        </span>
        {match.score && (
          <span className={cn(
            'text-xs font-cinzel font-bold ml-2',
            p1Won ? 'text-aoe-gold' : 'text-aoe-parchment-muted'
          )}>
            {match.score.split('-')[0]}
          </span>
        )}
      </div>

      {/* Player 2 row */}
      <div className={cn(
        'flex items-center justify-between px-3 py-2',
        isCompleted && p2Won ? 'bg-aoe-gold/10' : ''
      )}>
        <span className={cn(
          'text-sm truncate max-w-[120px]',
          isCompleted && p2Won ? 'text-aoe-gold font-bold font-cinzel' :
          isCompleted && !p2Won ? 'text-aoe-parchment-muted' :
          'text-aoe-parchment'
        )}>
          {isCompleted && p2Won && '🏆 '}{match.player2Name}
        </span>
        {match.score && (
          <span className={cn(
            'text-xs font-cinzel font-bold ml-2',
            p2Won ? 'text-aoe-gold' : 'text-aoe-parchment-muted'
          )}>
            {match.score.split('-')[1]}
          </span>
        )}
      </div>

      {isLive && (
        <div className="flex items-center gap-1.5 px-3 py-1 bg-red-900/20">
          <div className="live-dot" />
          <span className="text-xs text-red-400 font-cinzel">EN DIRECT</span>
        </div>
      )}
    </div>
  );

  if (match.status === 'UPCOMING') {
    return <Link href={`/matches/${match.matchId}`}>{content}</Link>;
  }

  return content;
}

export function TournamentBracket({ matches, tournamentName }: TournamentBracketProps) {
  const { t } = useT();
  const rounds = groupMatchesIntoRounds(matches);

  if (rounds.length === 0) {
    return (
      <div className="aoe-card p-8 text-center">
        <p className="text-aoe-parchment-muted font-cinzel">{t('tournament_no_matches')}</p>
      </div>
    );
  }

  return (
    <div className="aoe-card p-5">
      <div className="flex items-center gap-2 mb-5">
        <svg width="16" height="16" viewBox="0 0 20 20" fill="#c9a227">
          <polygon points="10,2 12,7 18,7 13.5,11 15.5,17 10,13 4.5,17 6.5,11 2,7 8,7" />
        </svg>
        <h3 className="font-cinzel font-bold text-sm text-aoe-gold tracking-wider">BRACKET — {tournamentName.toUpperCase()}</h3>
      </div>

      <div className="flex gap-8 overflow-x-auto pb-2">
        {rounds.map((round, roundIndex) => (
          <div key={roundIndex} className="flex-shrink-0" style={{ minWidth: 200 }}>
            {/* Round header */}
            <div className="text-center mb-3">
              <span className="text-xs font-cinzel text-aoe-gold uppercase tracking-wider border-b border-aoe-border-gold pb-1">
                {round.name}
              </span>
            </div>

            {/* Matches in this round */}
            <div className="flex flex-col justify-around gap-3" style={{ minHeight: round.matches.length > 1 ? `${round.matches.length * 90}px` : 'auto' }}>
              {round.matches.map((match) => (
                <BracketMatchCard key={match.id} match={match} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
