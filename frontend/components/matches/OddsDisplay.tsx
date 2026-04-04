'use client';

import { useState, useEffect } from 'react';
import { Match, SocketOddsUpdate } from '@/types';
import { onOddsUpdate } from '@/lib/socket';
import { formatRelativeTime } from '@/lib/utils';
import { useT } from '@/lib/i18n';

interface OddsDisplayProps {
  match: Match;
}

interface OddsPoint {
  time: string;
  odds1: number;
  odds2: number;
}

export function OddsDisplay({ match }: OddsDisplayProps) {
  const { t } = useT();
  const [odds1, setOdds1] = useState(match.odds1);
  const [odds2, setOdds2] = useState(match.odds2);
  const [lastUpdate, setLastUpdate] = useState(match.updatedAt);
  const [prevOdds1, setPrevOdds1] = useState(match.odds1);
  const [prevOdds2, setPrevOdds2] = useState(match.odds2);
  const [oddsHistory, setOddsHistory] = useState<OddsPoint[]>([
    { time: '24h', odds1: match.odds1 * 1.03, odds2: match.odds2 * 0.97 },
    { time: '18h', odds1: match.odds1 * 1.01, odds2: match.odds2 * 0.99 },
    { time: '12h', odds1: match.odds1 * 1.005, odds2: match.odds2 * 0.995 },
    { time: '6h', odds1: match.odds1 * 1.002, odds2: match.odds2 * 0.998 },
    { time: 'Now', odds1: odds1, odds2: odds2 },
  ]);

  const vol1 = match.betVolume?.pct1 ?? 50;
  const vol2 = match.betVolume?.pct2 ?? 50;
  const totalVolume = match.betVolume?.total ?? 0;

  useEffect(() => {
    const unsubscribe = onOddsUpdate((data: SocketOddsUpdate) => {
      if (data.matchId !== match.id) return;
      setPrevOdds1(odds1);
      setPrevOdds2(odds2);
      setOdds1(data.odds1);
      setOdds2(data.odds2);
      setLastUpdate(data.timestamp);
      setOddsHistory((prev) => [
        ...prev.slice(-4),
        { time: 'Now', odds1: data.odds1, odds2: data.odds2 },
      ]);
    });

    return unsubscribe;
  }, [match.id, odds1, odds2]);

  const odds1Changed = odds1 !== prevOdds1;
  const odds2Changed = odds2 !== prevOdds2;
  const odds1Up = odds1 > prevOdds1;
  const odds2Up = odds2 > prevOdds2;

  // Mini SVG chart for odds history
  const chartWidth = 200;
  const chartHeight = 40;
  const maxOdds = Math.max(...oddsHistory.map(p => Math.max(p.odds1, p.odds2)));
  const minOdds = Math.min(...oddsHistory.map(p => Math.min(p.odds1, p.odds2)));
  const range = maxOdds - minOdds || 0.5;

  const getY = (odds: number) => chartHeight - ((odds - minOdds) / range) * (chartHeight - 8) - 4;
  const getX = (i: number) => (i / (oddsHistory.length - 1)) * chartWidth;

  const line1 = oddsHistory.map((p, i) => `${i === 0 ? 'M' : 'L'} ${getX(i).toFixed(1)},${getY(p.odds1).toFixed(1)}`).join(' ');
  const line2 = oddsHistory.map((p, i) => `${i === 0 ? 'M' : 'L'} ${getX(i).toFixed(1)},${getY(p.odds2).toFixed(1)}`).join(' ');

  return (
    <div className="aoe-card p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="live-dot" />
          <h3 className="font-cinzel font-bold text-sm text-aoe-gold tracking-wider">COTES EN DIRECT</h3>
        </div>
        <span className="text-aoe-parchment-muted text-xs">
          MAJ {formatRelativeTime(lastUpdate)}
        </span>
      </div>

      {/* Odds values */}
      <div className="flex gap-3">
        <div className="flex-1 text-center p-3 bg-aoe-stone/50 rounded border border-aoe-border">
          <p className="text-aoe-parchment-dim text-xs mb-1 truncate">{match.player1.name}</p>
          <div className="flex items-center justify-center gap-1">
            <span className="font-cinzel font-black text-2xl text-aoe-gold">{odds1.toFixed(2)}</span>
            {odds1Changed && (
              <span className={odds1Up ? 'text-aoe-emerald-bright text-sm' : 'text-aoe-crimson-bright text-sm'}>
                {odds1Up ? '▲' : '▼'}
              </span>
            )}
          </div>
          <p className="text-aoe-parchment-muted text-[10px] mt-1">{vol1}% des mises</p>
        </div>

        <div className="flex items-center text-aoe-parchment-muted font-cinzel text-sm">VS</div>

        <div className="flex-1 text-center p-3 bg-aoe-stone/50 rounded border border-aoe-border">
          <p className="text-aoe-parchment-dim text-xs mb-1 truncate">{match.player2.name}</p>
          <div className="flex items-center justify-center gap-1">
            <span className="font-cinzel font-black text-2xl text-aoe-gold">{odds2.toFixed(2)}</span>
            {odds2Changed && (
              <span className={odds2Up ? 'text-aoe-emerald-bright text-sm' : 'text-aoe-crimson-bright text-sm'}>
                {odds2Up ? '▲' : '▼'}
              </span>
            )}
          </div>
          <p className="text-aoe-parchment-muted text-[10px] mt-1">{vol2}% des mises</p>
        </div>
      </div>

      {/* Mini chart */}
      <div>
        <p className="text-aoe-parchment-muted text-[10px] font-cinzel uppercase tracking-wider mb-2">
          {t('odds_chart_title')}
        </p>
        <svg width={chartWidth} height={chartHeight} className="w-full" viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none">
          <path d={line1} fill="none" stroke="#c9a227" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d={line2} fill="none" stroke="#a61c1c" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          {/* Dots at current */}
          <circle
            cx={getX(oddsHistory.length - 1)}
            cy={getY(oddsHistory[oddsHistory.length - 1].odds1)}
            r="3"
            fill="#c9a227"
          />
          <circle
            cx={getX(oddsHistory.length - 1)}
            cy={getY(oddsHistory[oddsHistory.length - 1].odds2)}
            r="3"
            fill="#a61c1c"
          />
        </svg>
        <div className="flex items-center justify-end gap-4 mt-1">
          <div className="flex items-center gap-1">
            <div className="w-3 h-0.5 bg-aoe-gold" />
            <span className="text-[10px] text-aoe-parchment-muted">{match.player1.name}</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-0.5 bg-aoe-crimson" />
            <span className="text-[10px] text-aoe-parchment-muted">{match.player2.name}</span>
          </div>
        </div>
      </div>

      {/* Bet volume bar */}
      {totalVolume > 0 && (
        <div>
          <div className="flex justify-between text-[10px] text-aoe-parchment-muted mb-1">
            <span>{match.player1.name}: {vol1}%</span>
            <span>{new Intl.NumberFormat('fr-FR').format(totalVolume)} ⚜ total</span>
            <span>{match.player2.name}: {vol2}%</span>
          </div>
          <div className="flex h-2 rounded-full overflow-hidden">
            <div
              className="bg-aoe-gold"
              style={{ width: `${vol1}%` }}
            />
            <div
              className="bg-aoe-crimson flex-1"
            />
          </div>
        </div>
      )}
    </div>
  );
}
