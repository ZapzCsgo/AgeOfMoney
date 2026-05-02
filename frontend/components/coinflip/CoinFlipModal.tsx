'use client';

import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CoinFlipAnimation, CoinSide } from './CoinFlipAnimation';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';

interface Player {
  id: string;
  username: string;
  avatar: string | null;
  side: CoinSide;
}

interface CoinFlipModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPlayAgain?: () => void;
  player1: Player;
  player2: Player;
  betAmount: number;
  result?: CoinSide;
  /** Authoritative winner id from the backend. Takes precedence over the
   *  side-based winner derivation when present — guards against the
   *  "game.side undefined on legacy payloads" edge case that used to make
   *  `player1.side === result` always false and flipped the displayed winner. */
  winnerId?: string;
  currentUserId?: string;
}

export function CoinFlipModal({
  isOpen,
  onClose,
  onPlayAgain,
  player1,
  player2,
  betAmount,
  result,
  winnerId,
  currentUserId,
}: CoinFlipModalProps) {
  const { t } = useT();
  const [countdown, setCountdown] = useState(3);
  const [isFlipping, setIsFlipping] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [displayedAmount, setDisplayedAmount] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Pick winner from the backend's `winnerId` when available (authoritative),
  // fall back to the side ↔ result comparison when the legacy payload only
  // ships `result`.
  const winner = winnerId
    ? (winnerId === player1.id ? player1 : winnerId === player2.id ? player2 : null)
    : result
      ? (player1.side === result ? player1 : player2)
      : null;
  const loser = winner ? (winner.id === player1.id ? player2 : player1) : null;
  const currentUserWon = winner && currentUserId ? winner.id === currentUserId : null;

  // Affichage honnête : le payout net = ce qui arrive vraiment en balance.
  // Doit matcher la formule backend (coinflipService.ts) :
  //   rake = pot × RAKE_RATE  (Decimal multiplication, 2-decimal precision)
  //   payout = pot − rake
  const COINFLIP_RAKE_RATE = 0.05;
  const totalPot = betAmount * 2;
  const rake = Math.round(totalPot * COINFLIP_RAKE_RATE * 100) / 100;
  const winAmount = Math.round((totalPot - rake) * 100) / 100;

  // Countdown then flip
  useEffect(() => {
    if (!isOpen) return;
    setCountdown(3);
    setIsFlipping(false);
    setShowResult(false);
    setDisplayedAmount(0);

    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          setIsFlipping(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [isOpen]);

  // Count-up animation for win amount
  useEffect(() => {
    if (!showResult || !currentUserWon) return;
    const duration = 1500;
    const steps = 40;
    let step = 0;
    const interval = setInterval(() => {
      step++;
      const progress = step / steps;
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayedAmount(Math.floor(eased * winAmount));
      if (step >= steps) {
        clearInterval(interval);
        setDisplayedAmount(winAmount);
      }
    }, duration / steps);
    return () => clearInterval(interval);
  }, [showResult, currentUserWon, winAmount]);

  function handleFlipComplete() {
    setTimeout(() => setShowResult(true), 300);
  }

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[100] flex items-center justify-center px-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{ background: 'rgba(0,0,0,0.80)', backdropFilter: 'blur(8px)' }}
        // Backdrop click → close. We check that the click target is the
        // backdrop itself (not a bubbled event from inside the card).
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <motion.div
          className="w-full max-w-2xl rounded-2xl overflow-hidden relative"
          style={{
            background: '#0d0b1a',
            border: '1px solid #1e1a30',
            boxShadow: '0 0 80px rgba(255,197,66,0.1)',
          }}
          initial={{ scale: 0.9, y: 30 }}
          animate={{ scale: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        >
          {/* Header — bouton fermer intégré en haut à droite de la card */}
          <div
            className="flex items-center justify-between px-4 py-4 relative"
            style={{ borderBottom: '1px solid #1e1a30' }}
          >
            <div className="w-8" />
            <h2
              className="text-lg font-bold tracking-widest uppercase"
              style={{ fontFamily: 'Cinzel, serif', color: '#ffd97a' }}
            >
              COINFLIP
            </h2>
            <button
              onClick={onClose}
              aria-label="Fermer"
              className="w-8 h-8 rounded-full flex items-center justify-center text-[#9990b8] hover:text-[#e8e2f5] transition-all hover:bg-[#1e1a30]"
            >
              <X size={18} />
            </button>
          </div>

          {/* Main content */}
          <div className="px-6 py-8">
            {/* Players + Coin row */}
            <div className="flex items-center justify-between gap-4">
              {/* Player 1 */}
              <div className="flex-1 flex flex-col items-center gap-3">
                <div
                  className="relative rounded-full overflow-hidden"
                  style={{
                    width: 72,
                    height: 72,
                    border: `3px solid ${
                      showResult && winner?.id === player1.id
                        ? '#ffd97a'
                        : showResult && loser?.id === player1.id
                        ? '#3d3860'
                        : '#1e1a30'
                    }`,
                    boxShadow:
                      showResult && winner?.id === player1.id
                        ? '0 0 20px rgba(245,200,66,0.4)'
                        : 'none',
                    opacity: showResult && loser?.id === player1.id ? 0.5 : 1,
                    transition: 'all 0.5s ease',
                  }}
                >
                  {player1.avatar ? (
                    <img
                      src={player1.avatar}
                      alt={player1.username}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div
                      className="w-full h-full flex items-center justify-center text-xl font-bold"
                      style={{ background: '#1e1a30', color: '#6b6488' }}
                    >
                      {player1.username[0]?.toUpperCase()}
                    </div>
                  )}
                </div>
                <span
                  className="text-[13px] font-medium truncate max-w-[120px]"
                  style={{
                    color:
                      showResult && winner?.id === player1.id ? '#ffd97a' : '#e8e2f5',
                  }}
                >
                  {player1.username}
                </span>
                <span
                  className="text-[11px] px-2.5 py-1 rounded-full font-bold uppercase"
                  style={{
                    background:
                      player1.side === 'crown'
                        ? 'rgba(255,197,66,0.15)'
                        : 'rgba(138,138,154,0.15)',
                    color: player1.side === 'crown' ? '#ffd97a' : '#c0c0c0',
                    border: `1px solid ${
                      player1.side === 'crown' ? '#ffc54240' : '#8a8a9a40'
                    }`,
                  }}
                >
                  {player1.side === 'crown' ? '🏹 Archers' : '⚔ Swords'}
                </span>
              </div>

              {/* Center — Countdown or Coin */}
              <div className="flex flex-col items-center justify-center min-w-[200px]">
                {countdown > 0 && !isFlipping ? (
                  <motion.div
                    key={countdown}
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 1.5, opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="flex items-center justify-center"
                    style={{
                      width: 80,
                      height: 80,
                      fontSize: 48,
                      fontWeight: 900,
                      fontFamily: 'Cinzel, serif',
                      color: '#ffd97a',
                      textShadow: '0 0 20px rgba(245,200,66,0.5)',
                    }}
                  >
                    {countdown}
                  </motion.div>
                ) : (
                  <CoinFlipAnimation
                    // Lock the coin face to the winner's declared side when
                    // the backend has named the winner — keeps the visual
                    // result in sync with the winner-ring highlight even if
                    // `result` ever drifts from `winnerId`.
                    result={winner?.side ?? result}
                    isFlipping={isFlipping}
                    onComplete={handleFlipComplete}
                    size={160}
                  />
                )}

                {/* Bet amount display */}
                <div
                  className="mt-4 text-center text-[13px] font-bold"
                  style={{ color: '#6b6488' }}
                >
                  {betAmount.toLocaleString('fr-FR')} ⚜ {t('coinflip_each')}
                </div>
              </div>

              {/* Player 2 */}
              <div className="flex-1 flex flex-col items-center gap-3">
                <div
                  className="relative rounded-full overflow-hidden"
                  style={{
                    width: 72,
                    height: 72,
                    border: `3px solid ${
                      showResult && winner?.id === player2.id
                        ? '#ffd97a'
                        : showResult && loser?.id === player2.id
                        ? '#3d3860'
                        : '#1e1a30'
                    }`,
                    boxShadow:
                      showResult && winner?.id === player2.id
                        ? '0 0 20px rgba(245,200,66,0.4)'
                        : 'none',
                    opacity: showResult && loser?.id === player2.id ? 0.5 : 1,
                    transition: 'all 0.5s ease',
                  }}
                >
                  {player2.avatar ? (
                    <img
                      src={player2.avatar}
                      alt={player2.username}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div
                      className="w-full h-full flex items-center justify-center text-xl font-bold"
                      style={{ background: '#1e1a30', color: '#6b6488' }}
                    >
                      {player2.username[0]?.toUpperCase()}
                    </div>
                  )}
                </div>
                <span
                  className="text-[13px] font-medium truncate max-w-[120px]"
                  style={{
                    color:
                      showResult && winner?.id === player2.id ? '#ffd97a' : '#e8e2f5',
                  }}
                >
                  {player2.username}
                </span>
                <span
                  className="text-[11px] px-2.5 py-1 rounded-full font-bold uppercase"
                  style={{
                    background:
                      player2.side === 'crown'
                        ? 'rgba(255,197,66,0.15)'
                        : 'rgba(138,138,154,0.15)',
                    color: player2.side === 'crown' ? '#ffd97a' : '#c0c0c0',
                    border: `1px solid ${
                      player2.side === 'crown' ? '#ffc54240' : '#8a8a9a40'
                    }`,
                  }}
                >
                  {player2.side === 'crown' ? '🏹 Archers' : '⚔ Swords'}
                </span>
              </div>
            </div>

            {/* Result overlay */}
            <AnimatePresence>
              {showResult && (
                <motion.div
                  className="mt-8 text-center"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                >
                  {currentUserWon === true && (
                    <>
                      <p
                        className="text-2xl font-bold tracking-wider"
                        style={{
                          fontFamily: 'Cinzel, serif',
                          color: '#ffd97a',
                          textShadow: '0 0 20px rgba(245,200,66,0.4)',
                        }}
                      >
                        {t('coinflip_you_won')}
                      </p>
                      <p
                        className="text-3xl font-black mt-2"
                        style={{ color: '#ffd97a' }}
                      >
                        +{displayedAmount.toLocaleString('fr-FR')} ⚜
                      </p>
                    </>
                  )}
                  {currentUserWon === false && (
                    <p
                      className="text-xl font-bold tracking-wider"
                      style={{
                        fontFamily: 'Cinzel, serif',
                        color: '#f87171',
                      }}
                    >
                      {t('coinflip_you_lost')}
                    </p>
                  )}
                  {currentUserWon === null && winner && (
                    <p
                      className="text-xl font-bold"
                      style={{ fontFamily: 'Cinzel, serif', color: '#ffd97a' }}
                    >
                      {winner.username} {t('coinflip_wins')}
                    </p>
                  )}

                  {/* Play Again button */}
                  {showResult && (
                    <div className="flex items-center justify-center gap-3 mt-6">
                      <Button
                        onClick={onPlayAgain}
                        className="px-6 py-2.5 font-bold text-[13px] tracking-wider"
                        style={{
                          background: '#ffc542',
                          color: '#07060f',
                          border: 'none',
                        }}
                      >
                        {t('coinflip_play_again')}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={onClose}
                        className="px-6 py-2.5 text-[13px]"
                        style={{
                          background: 'transparent',
                          color: '#6b6488',
                          border: '1px solid #1e1a30',
                        }}
                      >
                        {t('common_close')}
                      </Button>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
