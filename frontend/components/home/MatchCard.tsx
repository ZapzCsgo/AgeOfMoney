'use client';

import Link from 'next/link';
import { Match } from '@/types';
import { formatCountdown, getTierBadgeClass } from '@/lib/utils';
import { useEffect, useState } from 'react';

interface MatchCardProps {
  match: Match;
}

export function MatchCard({ match }: MatchCardProps) {
  const [countdown, setCountdown] = useState('');
  const isLive      = match.status === 'LIVE';
  const isCompleted = match.status === 'COMPLETED';

  const p1Won = isCompleted && match.winnerId === match.player1Id;
  const p2Won = isCompleted && match.winnerId === match.player2Id;

  useEffect(() => {
    if (isLive || isCompleted) return;
    const update = () => setCountdown(formatCountdown(match.scheduledAt));
    update();
    const interval = setInterval(update, 30000);
    return () => clearInterval(interval);
  }, [match.scheduledAt, isLive, isCompleted]);

  return (
    <Link href={`/matches/${match.id}`} className="block">
      <div className="aoe-card-hover p-4 group">

        {/* Top row: Tournament + Format + Status */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {match.tournament && (
              <span className={getTierBadgeClass(match.tournament.tier)}>
                {match.tournament.tier}
              </span>
            )}
            {match.game && match.game !== 'AoE4' && (
              <span className="text-[10px] text-aoe-gold/70 font-cinzel border border-aoe-gold/20 rounded px-1 py-0.5">
                {match.game}
              </span>
            )}
            <span className="text-aoe-parchment-dim text-xs truncate max-w-[180px]">
              {match.tournament?.name ?? 'Match'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-aoe-parchment-muted text-xs font-cinzel border border-aoe-border rounded px-1.5 py-0.5">
              {match.format}
            </span>
            {isLive ? (
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-red-900/20 border border-red-800/50">
                <div className="live-dot" />
                <span className="text-xs text-red-400 font-cinzel font-bold">LIVE</span>
              </div>
            ) : isCompleted ? (
              <span className="text-xs text-[#6b6488] font-cinzel border border-[#2a2540] rounded px-1.5 py-0.5">
                Terminé
              </span>
            ) : (
              <span className="text-aoe-parchment-dim text-xs">{countdown}</span>
            )}
          </div>
        </div>

        {/* Players vs layout */}
        <div className="flex items-center justify-between gap-3">

          {/* Player 1 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <div className={`w-9 h-9 rounded-full border flex items-center justify-center flex-shrink-0 text-lg transition-all
                ${p1Won ? 'bg-[#1a1500] border-[#d4a017]' : 'bg-aoe-stone border-aoe-border'}
                ${p2Won ? 'opacity-40' : ''}
              `}>
                🗡️
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1">
                  {p1Won && <span className="text-[#d4a017] text-sm leading-none">👑</span>}
                  <p className={`font-cinzel font-semibold truncate transition-colors
                    ${p1Won ? 'text-[#d4a017]' : p2Won ? 'text-[#6b6488]' : 'text-aoe-parchment group-hover:text-aoe-gold'}
                  `}>
                    {match.player1.name}
                  </p>
                </div>
                <p className="text-aoe-parchment-muted text-xs">
                  {match.player1.elo} ELO
                </p>
              </div>
            </div>
          </div>

          {/* Center: score (completed) or odds */}
          <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
            {isCompleted ? (
              <div className="flex items-center gap-2">
                <span className={`font-cinzel font-black text-2xl leading-none ${p1Won ? 'text-[#d4a017]' : 'text-[#6b6488]'}`}>
                  {match.p1Score ?? 0}
                </span>
                <span className="text-[#3a3560] font-bold text-lg">—</span>
                <span className={`font-cinzel font-black text-2xl leading-none ${p2Won ? 'text-[#d4a017]' : 'text-[#6b6488]'}`}>
                  {match.p2Score ?? 0}
                </span>
              </div>
            ) : (
              <div className="flex gap-2">
                <div className="aoe-odds-btn px-4 py-2 min-w-[60px]">
                  <div className="text-aoe-gold font-bold font-cinzel text-lg leading-none">
                    {match.odds1.toFixed(2)}
                  </div>
                  <div className="text-aoe-parchment-muted text-[10px] mt-0.5 truncate">
                    {match.player1.name.substring(0, 6)}
                  </div>
                </div>
                <div className="flex items-center">
                  <span className="text-aoe-parchment-muted text-xs font-cinzel px-1">VS</span>
                </div>
                <div className="aoe-odds-btn px-4 py-2 min-w-[60px]">
                  <div className="text-aoe-gold font-bold font-cinzel text-lg leading-none">
                    {match.odds2.toFixed(2)}
                  </div>
                  <div className="text-aoe-parchment-muted text-[10px] mt-0.5 truncate">
                    {match.player2.name.substring(0, 6)}
                  </div>
                </div>
              </div>
            )}

            {isLive && (
              <div className="flex items-center gap-1.5">
                <span className="font-cinzel font-black text-2xl text-amber-400 leading-none">{match.p1Score ?? 0}</span>
                <span className="text-[#3a3560] font-bold">—</span>
                <span className="font-cinzel font-black text-2xl text-blue-400 leading-none">{match.p2Score ?? 0}</span>
              </div>
            )}
          </div>

          {/* Player 2 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 justify-end">
              <div className="min-w-0 text-right">
                <div className="flex items-center gap-1 justify-end">
                  <p className={`font-cinzel font-semibold truncate transition-colors
                    ${p2Won ? 'text-[#d4a017]' : p1Won ? 'text-[#6b6488]' : 'text-aoe-parchment group-hover:text-aoe-gold'}
                  `}>
                    {match.player2.name}
                  </p>
                  {p2Won && <span className="text-[#d4a017] text-sm leading-none">👑</span>}
                </div>
                <p className="text-aoe-parchment-muted text-xs">
                  {match.player2.elo} ELO
                </p>
              </div>
              <div className={`w-9 h-9 rounded-full border flex items-center justify-center flex-shrink-0 text-lg transition-all
                ${p2Won ? 'bg-[#1a1500] border-[#d4a017]' : 'bg-aoe-stone border-aoe-border'}
                ${p1Won ? 'opacity-40' : ''}
              `}>
                🗡️
              </div>
            </div>
          </div>
        </div>

      </div>
    </Link>
  );
}
