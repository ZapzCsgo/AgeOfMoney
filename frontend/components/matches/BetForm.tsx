'use client';

import { useState } from 'react';
import { useSession, signIn } from 'next-auth/react';
import { Coins, TrendingUp, AlertCircle, CheckCircle } from 'lucide-react';
import { Match } from '@/types';
import { placeBet } from '@/lib/api';
import { setAuthToken } from '@/lib/api';
import { cn, formatCoins, isMatchBettable } from '@/lib/utils';
import { useT } from '@/lib/i18n';

interface BetFormProps {
  match: Match;
  onBetPlaced?: () => void;
  initialPlayer?: 0 | 1 | 2 | null;
}

export function BetForm({ match, onBetPlaced, initialPlayer = null }: BetFormProps) {
  const { data: session } = useSession();
  const { t } = useT();
  const [selectedPlayer, setSelectedPlayer] = useState<0 | 1 | 2 | null>(initialPlayer);
  const [amount, setAmount] = useState<number>(10);
  const [customAmount, setCustomAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const boNum = parseInt(match.format.replace(/\D/g, ''), 10) || 3;
  const allowsDraw = boNum % 2 === 0 && !!match.oddsDraw;
  const isBettable = isMatchBettable(match.status, match.betsClosedAt, match.scheduledAt, match.betsOpen);
  const selectedOdds = selectedPlayer === 0 ? (match.oddsDraw ?? null) : selectedPlayer === 1 ? match.odds1 : selectedPlayer === 2 ? match.odds2 : null;
  const potentialGain = selectedOdds ? parseFloat((amount * selectedOdds).toFixed(2)) : 0;
  const netGain = parseFloat((potentialGain - amount).toFixed(2));
  const userBalance = session?.user.coins ?? 0;

  const quickAmounts = [5, 10, 25, 50, 100];

  const handleAmountChange = (val: string) => {
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      setAmount(Math.min(500, parsed));
      setCustomAmount(val);
    } else if (val === '') {
      setCustomAmount('');
      setAmount(0);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!session) { signIn(); return; }
    if (!selectedPlayer) { setError(t('bet_err_select')); return; }
    if (amount < 5) { setError(t('bet_err_min')); return; }
    if (amount > 500) { setError(t('bet_err_max')); return; }
    if (amount > userBalance) { setError(t('bet_err_balance')); return; }

    setError(null);
    setLoading(true);

    try {
      if (session.user.accessToken) {
        setAuthToken(session.user.accessToken);
      }

      await placeBet(match.id, amount, selectedPlayer);
      setSuccess(t('bet_success', { amount }));
      onBetPlaced?.();
      setCooldown(true);
      setTimeout(() => setCooldown(false), 3000);
      setTimeout(() => setSuccess(null), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('bet_err_generic'));
    } finally {
      setLoading(false);
    }
  };

  if (!isBettable) {
    return (
      <div className="aoe-card p-5">
        <h3 className="font-cinzel font-bold text-sm text-aoe-gold mb-4 tracking-wider">
          {t('bet_place')}
        </h3>
        <div className="text-center py-6">
          <div className="w-12 h-12 rounded-full bg-aoe-stone border border-aoe-border flex items-center justify-center mx-auto mb-3">
            <AlertCircle size={22} className="text-aoe-parchment-muted" />
          </div>
          <p className="text-aoe-parchment-dim text-sm font-cinzel">
            {match.status === 'COMPLETED' ? t('bet_closed_match') :
             match.status === 'CANCELLED' ? t('bet_cancelled') :
             match.betsOpen === false && match.status === 'UPCOMING' ? t('bet_insufficient_data') :
             match.betsOpen === false ? t('bet_closed_live') :
             t('bet_closed')}
          </p>
          {match.betsOpen === false && match.status === 'LIVE' && (
            <p className="text-aoe-parchment-muted text-xs mt-1 font-cinzel">
              {t('bet_reopen_bo')}
            </p>
          )}
          {match.status === 'COMPLETED' && match.resultScore && (
            <p className="text-aoe-gold font-cinzel font-bold text-lg mt-2">
              {`${t('bet_result')}:`} {match.resultScore}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="aoe-card-gold p-5">
      <h3 className="font-cinzel font-bold text-sm text-aoe-gold mb-4 tracking-wider">
        {t('bet_place')}
      </h3>

      {!session ? (
        <div className="text-center py-4">
          <p className="text-aoe-parchment-dim text-sm mb-4">
            {t('bet_signin_desc')}
          </p>
          <button onClick={() => signIn()} className="aoe-btn-gold w-full">
            {t('auth_signin')}
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Player selection */}
          <div>
            <label className="text-aoe-parchment-dim text-xs uppercase tracking-wider font-cinzel mb-2 block">
              {t('bet_choose_player')}
            </label>
            <div className={`grid gap-2 ${allowsDraw ? 'grid-cols-3' : 'grid-cols-2'}`}>
              {([1, 2] as const).map((p) => {
                const isSelected = selectedPlayer === p;
                const odds = p === 1 ? match.odds1 : match.odds2;
                const name = p === 1 ? match.player1.name : match.player2.name;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setSelectedPlayer(p)}
                    className="relative p-3 rounded-lg transition-all duration-150 text-left"
                    style={{
                      background: isSelected ? 'rgba(212,160,23,0.1)' : 'rgba(255,255,255,0.03)',
                      border: isSelected ? '2px solid #d4a017' : '2px solid rgba(255,255,255,0.08)',
                      boxShadow: isSelected ? '0 0 18px rgba(212,160,23,0.2), inset 0 0 10px rgba(212,160,23,0.05)' : 'none',
                    }}
                  >
                    <div className="font-cinzel font-bold text-xl" style={{ color: isSelected ? '#f5c842' : '#d4a017' }}>{odds.toFixed(2)}</div>
                    <div className="text-sm font-medium mt-0.5 truncate" style={{ color: isSelected ? '#e8e2f5' : '#9990b8' }}>{name}</div>
                  </button>
                );
              })}
              {allowsDraw && (
                <button
                  type="button"
                  onClick={() => setSelectedPlayer(0)}
                  className="relative p-3 rounded-lg transition-all duration-150 text-center"
                  style={{
                    background: selectedPlayer === 0 ? 'rgba(212,160,23,0.1)' : 'rgba(255,255,255,0.03)',
                    border: selectedPlayer === 0 ? '2px solid #d4a017' : '2px solid rgba(255,255,255,0.08)',
                    boxShadow: selectedPlayer === 0 ? '0 0 18px rgba(212,160,23,0.2), inset 0 0 10px rgba(212,160,23,0.05)' : 'none',
                  }}
                >
                  <div className="font-cinzel font-bold text-xl" style={{ color: selectedPlayer === 0 ? '#f5c842' : '#d4a017' }}>{match.oddsDraw!.toFixed(2)}</div>
                  <div className="text-sm font-medium mt-0.5" style={{ color: selectedPlayer === 0 ? '#e8e2f5' : '#9990b8' }}>Draw</div>
                </button>
              )}
            </div>
          </div>

          {/* Amount */}
          <div>
            <label className="text-aoe-parchment-dim text-xs uppercase tracking-wider font-cinzel mb-2 block">
              {t('bet_amount')}
            </label>
            <div
              className="flex items-center gap-2 rounded-lg transition-colors cursor-text focus-within:border-[#d4a017] hover:border-[#d4a017]/60"
              style={{
                background: '#13111f',
                border: '1.5px solid #2a2640',
                padding: '2px 4px',
              }}
              onClick={(e) => {
                const input = (e.currentTarget as HTMLElement).querySelector('input');
                if (input) input.focus();
              }}
            >
              <span className="pl-3 text-[#d4a017] text-base">⚜</span>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={customAmount || amount}
                onChange={(e) => handleAmountChange(e.target.value.replace(/\D/g, ''))}
                className="flex-1 bg-transparent border-none outline-none text-[#e8e2f5] py-3 pr-3 text-base font-bold tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                placeholder="50"
              />
            </div>

            {/* Quick amount buttons */}
            <div className="flex gap-1.5 mt-2">
              {quickAmounts.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => { setAmount(q); setCustomAmount(String(q)); }}
                  className={cn(
                    'flex-1 py-1.5 text-xs font-cinzel rounded border transition-all',
                    amount === q
                      ? 'border-aoe-gold text-aoe-gold bg-aoe-gold/10'
                      : 'border-aoe-border text-aoe-parchment-muted hover:border-aoe-border-gold hover:text-aoe-parchment'
                  )}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          {/* Potential gain display */}
          {selectedPlayer !== null && amount >= 1 && (
            <div className="aoe-card p-3 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-aoe-parchment-dim text-xs">{t('bet_stake')}</span>
                <span className="text-aoe-parchment text-sm font-semibold">{amount.toFixed(2)} ⚜</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-aoe-parchment-dim text-xs">{t('bet_odds')}</span>
                <span className="text-aoe-gold text-sm font-cinzel font-bold">× {selectedOdds?.toFixed(2)}</span>
              </div>
              <div className="border-t border-aoe-border pt-2">
                <div className="flex justify-between items-center">
                  <span className="text-aoe-parchment-dim text-xs font-cinzel uppercase">{t('bet_potential')}</span>
                  <span className="text-aoe-emerald-bright font-cinzel font-bold text-base">
                    +{netGain.toFixed(2)} ⚜
                  </span>
                </div>
                <div className="flex justify-between items-center mt-1">
                  <span className="text-aoe-parchment-muted text-xs">{t('bet_total_return')}</span>
                  <span className="text-aoe-parchment text-sm">{potentialGain.toFixed(2)} ⚜</span>
                </div>
              </div>
            </div>
          )}

          {/* Balance display */}
          <div className="flex justify-between items-center text-xs">
            <span className="text-aoe-parchment-dim font-cinzel">{t('bet_balance')}</span>
            <span className={cn(
              'font-cinzel font-semibold',
              amount > userBalance ? 'text-aoe-crimson-bright' : 'text-aoe-gold'
            )}>
              {new Intl.NumberFormat('fr-FR').format(userBalance)} ⚜
            </span>
          </div>

          {/* Error message */}
          {error && (
            <div className="flex items-center gap-2 p-2.5 rounded bg-red-900/20 border border-red-800/50">
              <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
              <p className="text-red-400 text-xs">{error}</p>
            </div>
          )}

          {/* Success message */}
          {success && (
            <div className="flex items-center gap-2 p-2.5 rounded bg-emerald-900/20 border border-emerald-800/50">
              <CheckCircle size={14} className="text-emerald-400 flex-shrink-0" />
              <p className="text-emerald-400 text-xs">{success}</p>
            </div>
          )}

          {/* Submit button */}
          <button
            type="submit"
            disabled={loading || cooldown || !selectedPlayer || amount < 10 || amount > userBalance}
            className={cn(
              'aoe-btn-gold w-full py-3 text-base relative overflow-hidden',
              loading && 'opacity-70 cursor-not-allowed'
            )}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-aoe-gold-dark border-t-transparent rounded-full animate-spin" />
                {t('bet_placing')}
              </span>
            ) : (
              t('bet_submit')
            )}
          </button>

        </form>
      )}
    </div>
  );
}
