'use client';

import Link from 'next/link';
import { Match } from '@/types';
import { formatCountdown, getTierBadgeClass } from '@/lib/utils';
import { useEffect, useRef, useState } from 'react';
import { Swords, Crown } from 'lucide-react';

interface MatchCardProps {
  match: Match;
}

type FlashDir = 'up' | 'down' | null;

function useOddsFlash(value: number): FlashDir {
  const prevRef = useRef(value);
  const [dir, setDir] = useState<FlashDir>(null);

  useEffect(() => {
    if (prevRef.current !== value) {
      setDir(value > prevRef.current ? 'up' : 'down');
      prevRef.current = value;
      const t = setTimeout(() => setDir(null), 650);
      return () => clearTimeout(t);
    }
  }, [value]);

  return dir;
}

export function MatchCard({ match }: MatchCardProps) {
  const [countdown, setCountdown] = useState('');
  const isLive      = match.status === 'LIVE';
  const isCompleted = match.status === 'COMPLETED';

  const p1Won = isCompleted && match.winnerId === match.player1Id;
  const p2Won = isCompleted && match.winnerId === match.player2Id;

  const flash1    = useOddsFlash(match.odds1);
  const flash2    = useOddsFlash(match.odds2);

  useEffect(() => {
    if (isLive || isCompleted) return;
    const update = () => setCountdown(formatCountdown(match.scheduledAt));
    update();
    const interval = setInterval(update, 30000);
    return () => clearInterval(interval);
  }, [match.scheduledAt, isLive, isCompleted]);

  return (
    <Link href={`/matches/${match.id}`} className="block">
      <div className={`aoe-card-hover p-4 group ${isLive ? 'match-card-live' : ''}`}>

        {/* Top row: Tournament + Format + Status */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 min-w-0">
            {match.tournament && (
              <span className={getTierBadgeClass(match.tournament.tier)}>
                {match.tournament.tier}
              </span>
            )}
            <span className={`text-[10px] font-semibold tracking-wider uppercase border rounded px-1.5 py-0.5 ${
              match.game === 'AoE2' ? 'text-red-400 border-red-400/30 bg-red-400/10' :
              match.game === 'AoM' ? 'text-emerald-400 border-emerald-400/30 bg-emerald-400/10' :
              match.game === 'AoE3' ? 'text-blue-400 border-blue-400/30 bg-blue-400/10' :
              match.game === 'AoE1' ? 'text-orange-400 border-orange-400/30 bg-orange-400/10' :
              'text-aoe-gold border-aoe-gold/30 bg-aoe-gold/10'
            }`}>
              {match.game || 'AoE4'}
            </span>
            <span className="text-aoe-parchment-dim text-xs truncate">
              {match.tournament?.name ?? 'Match'}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-aoe-parchment-muted text-[10px] font-semibold tracking-wider uppercase border border-aoe-border rounded px-1.5 py-0.5">
              {match.format}
            </span>
            {isLive ? (
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-red-900/25 border border-red-800/60">
                <div className="live-dot" />
                <span className="text-[10px] text-red-400 font-bold tracking-wider">LIVE</span>
              </div>
            ) : isCompleted ? (
              <span className="text-[10px] text-[#6b6488] font-semibold tracking-wider uppercase border border-[#2a2540] rounded px-1.5 py-0.5">
                Terminé
              </span>
            ) : (
              <span className="text-aoe-parchment-dim text-xs tabular-nums">{countdown}</span>
            )}
          </div>
        </div>

        {/* Players vs layout */}
        <div className="flex items-center justify-between gap-3">

          {/* Player 1 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <div className={`w-10 h-10 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all
                ${p1Won ? 'bg-[#1a1500] border-aoe-gold shadow-gold-sm' : 'bg-aoe-stone border-aoe-border'}
                ${p2Won ? 'opacity-40' : ''}
              `}>
                <Swords size={16} className={p1Won ? 'text-aoe-gold' : 'text-aoe-parchment-muted'} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1">
                  {p1Won && <Crown size={12} className="text-aoe-gold shrink-0" />}
                  <p className={`font-semibold truncate transition-colors
                    ${p1Won ? 'text-aoe-gold' : p2Won ? 'text-[#6b6488]' : 'text-aoe-parchment group-hover:text-aoe-gold'}
                  `}>
                    {match.player1.name}
                  </p>
                </div>
                <p className="text-aoe-parchment-muted text-[11px] tabular-nums">
                  {match.player1.elo} ELO
                </p>
              </div>
            </div>
          </div>

          {/* Center: score (completed) or odds */}
          <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
            {isCompleted ? (
              <div className="flex items-center gap-2 tabular-nums">
                <span className={`font-black text-3xl leading-none ${p1Won ? 'text-aoe-gold' : 'text-[#6b6488]'}`}>
                  {match.p1Score ?? 0}
                </span>
                <span className="text-[#3a3560] font-bold text-lg">—</span>
                <span className={`font-black text-3xl leading-none ${p2Won ? 'text-aoe-gold' : 'text-[#6b6488]'}`}>
                  {match.p2Score ?? 0}
                </span>
              </div>
            ) : (
              <div className="flex gap-1.5">
                <div className={`aoe-odds-btn px-3 py-2 min-w-[62px] ${flash1 === 'up' ? 'animate-odds-flash-up' : flash1 === 'down' ? 'animate-odds-flash-down' : ''}`}>
                  <div className="text-aoe-gold font-extrabold text-xl leading-none tabular-nums">
                    {match.odds1.toFixed(2)}
                  </div>
                  <div className="text-aoe-parchment-muted text-[10px] mt-1 truncate max-w-[54px]">
                    {match.player1.name.substring(0, 8)}
                  </div>
                </div>
                <div className={`aoe-odds-btn px-3 py-2 min-w-[62px] ${flash2 === 'up' ? 'animate-odds-flash-up' : flash2 === 'down' ? 'animate-odds-flash-down' : ''}`}>
                  <div className="text-aoe-gold font-extrabold text-xl leading-none tabular-nums">
                    {match.odds2.toFixed(2)}
                  </div>
                  <div className="text-aoe-parchment-muted text-[10px] mt-1 truncate max-w-[54px]">
                    {match.player2.name.substring(0, 8)}
                  </div>
                </div>
              </div>
            )}

            {isLive && !isCompleted && (
              <div className="flex items-center gap-1.5 mt-1 tabular-nums">
                <span className="font-black text-2xl text-amber-400 leading-none">{match.p1Score ?? 0}</span>
                <span className="text-[#3a3560] font-bold">—</span>
                <span className="font-black text-2xl text-blue-400 leading-none">{match.p2Score ?? 0}</span>
              </div>
            )}
          </div>

          {/* Player 2 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 justify-end">
              <div className="min-w-0 text-right">
                <div className="flex items-center gap-1 justify-end">
                  <p className={`font-semibold truncate transition-colors
                    ${p2Won ? 'text-aoe-gold' : p1Won ? 'text-[#6b6488]' : 'text-aoe-parchment group-hover:text-aoe-gold'}
                  `}>
                    {match.player2.name}
                  </p>
                  {p2Won && <Crown size={12} className="text-aoe-gold shrink-0" />}
                </div>
                <p className="text-aoe-parchment-muted text-[11px] tabular-nums">
                  {match.player2.elo} ELO
                </p>
              </div>
              <div className={`w-10 h-10 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all
                ${p2Won ? 'bg-[#1a1500] border-aoe-gold shadow-gold-sm' : 'bg-aoe-stone border-aoe-border'}
                ${p1Won ? 'opacity-40' : ''}
              `}>
                <Swords size={16} className={p2Won ? 'text-aoe-gold' : 'text-aoe-parchment-muted'} />
              </div>
            </div>
          </div>
        </div>

      </div>
    </Link>
  );
}
