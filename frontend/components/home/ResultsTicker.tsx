'use client';

import { useT } from '@/lib/i18n';

interface Result {
  player1: string;
  player2: string;
  score: string;
  winner: string;
  tournament: string;
}

interface ResultsTickerProps {
  results: Result[];
}

export function ResultsTicker({ results }: ResultsTickerProps) {
  const { t } = useT();
  if (results.length === 0) return null;

  // Duplicate the results array for seamless looping
  const allResults = [...results, ...results];

  return (
    <div className="bg-aoe-stone border-y border-aoe-border overflow-hidden relative">
      {/* Label */}
      <div className="absolute left-0 top-0 bottom-0 z-10 flex items-center px-4 bg-gradient-to-r from-aoe-stone via-aoe-stone to-transparent">
        <span className="font-cinzel text-xs font-bold tracking-widest text-aoe-gold uppercase whitespace-nowrap">
          {t('results_recent')}
        </span>
        <div className="live-dot ml-2" />
      </div>

      {/* Scrolling content */}
      <div className="py-2 flex overflow-hidden" aria-label={t('results_recent')}>
        <div
          className="flex items-center gap-8 whitespace-nowrap pl-[200px]"
          style={{
            animation: 'ticker 35s linear infinite',
          }}
        >
          {allResults.map((result, i) => (
            <div key={i} className="flex items-center gap-2 flex-shrink-0">
              {/* Tournament badge */}
              <span className="text-[10px] text-aoe-parchment-muted font-cinzel border border-aoe-border px-1.5 py-0.5 rounded">
                {result.tournament}
              </span>

              {/* Winner */}
              <span className="text-aoe-emerald-bright font-semibold text-xs">
                {result.winner}
              </span>

              {/* "def." */}
              <span className="text-aoe-parchment-muted text-xs">def.</span>

              {/* Loser */}
              <span className="text-aoe-parchment-dim text-xs">
                {result.winner === result.player1 ? result.player2 : result.player1}
              </span>

              {/* Score */}
              <span className="text-aoe-parchment text-xs font-cinzel font-bold">
                {result.score}
              </span>

              {/* Separator */}
              <span className="text-aoe-border-gold text-base leading-none">·</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
