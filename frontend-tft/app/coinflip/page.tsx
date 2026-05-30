'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { motion, AnimatePresence, useAnimation } from 'framer-motion';
import { signInWithSteam } from '@/lib/authHelpers';
import { cn, parseCoinAmount, round2 } from '@/lib/utils';
import { apiClient, setAuthToken } from '@/lib/api';
import { connectSocket, getSocket } from '@/lib/socket';
import { Coins, Plus, Users, Trophy, Clock, X, Hexagon } from 'lucide-react';

/**
 * tft.money — Coinflip page.
 * Same backend as AgeOfMoney : POST /coinflip/create, /coinflip/{id}/join,
 * /coinflip/{id}/cancel, socket events coinflip:created / :joined / :result
 * / :cancelled.
 *
 * Design notes :
 *   - Palette swapped to TFT tokens (purple primary, gold for money only).
 *   - Coin sides keep their AoM mapping : `crown` = Archers (gold),
 *     `shield` = Swords (silver). The labels stay because the bet payload
 *     uses them on both sites and the backend is shared.
 *   - The flip animation is inlined here (no separate component) so the
 *     page is self-contained. Framer-motion is already in the TFT deps.
 */

type CoinSide = 'crown' | 'shield';

interface CoinFlipGame {
  id: string;
  status: 'WAITING' | 'FLIPPING' | 'COMPLETED';
  amount: number;
  side: CoinSide;
  result?: CoinSide;
  winnerId?: string;
  creator: { id: string; username: string; avatar: string | null };
  joiner?:  { id: string; username: string; avatar: string | null };
  createdAt: string;
}

const CANCEL_DELAY_MS = 15 * 60 * 1000;
const COINFLIP_RAKE_RATE = 0.05;

/* ─────────────────── Mini coin (lobby cards) ─────────────────── */
function MiniCoin({ side, size = 22 }: { side: CoinSide; size?: number }) {
  const isArchers = side === 'crown';
  return (
    <span
      className="inline-flex rounded-full items-center justify-center shrink-0 align-middle relative overflow-hidden"
      style={{
        width: size,
        height: size,
        background: isArchers
          ? 'radial-gradient(ellipse at 35% 30%, #fcd34d 0%, #fbbf24 40%, #b8860b 80%, #8b6914 100%)'
          : 'radial-gradient(ellipse at 35% 30%, #c0c0c0 0%, #8a8a9a 40%, #6a6a7a 80%, #4a4a5a 100%)',
        boxShadow: isArchers
          ? 'inset 0 -1px 2px rgba(0,0,0,0.4), 0 0 8px rgba(251,191,36,0.35)'
          : 'inset 0 -1px 2px rgba(0,0,0,0.4), 0 0 6px rgba(138,138,154,0.25)',
        border: `1px solid ${isArchers ? '#c4960f' : '#7a7a8a'}`,
      }}
    >
      <span
        className="absolute inset-0 rounded-full pointer-events-none"
        style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.18) 0%, transparent 55%, rgba(0,0,0,0.08) 100%)' }}
      />
      <span
        className="select-none relative"
        style={{
          fontSize: size * 0.58,
          color: isArchers ? '#4a3804' : '#2a2a3a',
          filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.35))',
          lineHeight: 1,
          fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","EmojiOne Color","Twemoji Mozilla",sans-serif',
        }}
      >
        {isArchers ? '\u{1F3F9}️' : '⚔️'}
      </span>
    </span>
  );
}

/* ─────────────────── Flip animation (inlined) ─────────────────── */
function FlipCoin({
  result, isFlipping, onComplete, size = 160,
}: {
  result?: CoinSide;
  isFlipping: boolean;
  onComplete?: () => void;
  size?: number;
}) {
  const controls = useAnimation();
  const hasFlippedRef = useRef(false);

  useEffect(() => {
    if (!isFlipping || !result) return;
    if (hasFlippedRef.current) return;
    hasFlippedRef.current = true;

    (async () => {
      await controls.start({
        y: -25, scale: 1.08,
        transition: { duration: 0.3, ease: 'easeOut' },
      });
      const targetRotation = result === 'crown' ? 1800 : 1980;
      await controls.start({
        rotateX: targetRotation, y: 0, scale: 1,
        transition: { duration: 2.5, ease: [0.15, 0.6, 0.35, 1] },
      });
      await controls.start({
        scale: [1.05, 0.97, 1],
        transition: { duration: 0.4, ease: 'easeInOut' },
      });
      onComplete?.();
    })();
  }, [isFlipping, result, controls, onComplete]);

  useEffect(() => {
    if (!isFlipping) hasFlippedRef.current = false;
  }, [isFlipping]);

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <div
        className="absolute rounded-full"
        style={{
          width: size * 1.3, height: size * 1.3,
          background: 'radial-gradient(circle, rgba(251,191,36,0.15) 0%, transparent 70%)',
          filter: 'blur(20px)',
        }}
      />
      <div style={{ perspective: '1000px', width: size, height: size }}>
        <motion.div animate={controls} style={{ width: size, height: size, transformStyle: 'preserve-3d', position: 'relative' }}>
          {/* Front — Archers (gold) */}
          <div className="absolute inset-0 rounded-full flex items-center justify-center"
            style={{
              backfaceVisibility: 'hidden',
              background: 'radial-gradient(ellipse at 35% 30%, #fcd34d 0%, #fbbf24 40%, #b8860b 80%, #8b6914 100%)',
              boxShadow: 'inset 0 -4px 12px rgba(0,0,0,0.4), inset 0 4px 8px rgba(255,230,120,0.3), 0 0 30px rgba(251,191,36,0.3)',
              border: '2px solid #c4960f',
            }}>
            <span style={{
              fontSize: size * 0.42, color: '#4a3804',
              filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.4))', lineHeight: 1,
              fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","EmojiOne Color","Twemoji Mozilla",sans-serif',
            }}>
              {'\u{1F3F9}️'}
            </span>
          </div>
          {/* Back — Swords (silver) */}
          <div className="absolute inset-0 rounded-full flex items-center justify-center"
            style={{
              backfaceVisibility: 'hidden',
              transform: 'rotateX(180deg)',
              background: 'radial-gradient(ellipse at 35% 30%, #c0c0c0 0%, #8a8a9a 40%, #6a6a7a 80%, #4a4a5a 100%)',
              boxShadow: 'inset 0 -4px 12px rgba(0,0,0,0.4), inset 0 4px 8px rgba(200,200,220,0.3), 0 0 30px rgba(138,138,154,0.2)',
              border: '2px solid #7a7a8a',
            }}>
            <span style={{
              fontSize: size * 0.4, color: '#2a2a3a',
              filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.4))', lineHeight: 1,
              fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","EmojiOne Color","Twemoji Mozilla",sans-serif',
            }}>
              {'⚔️'}
            </span>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

/* ─────────────────── Flip modal (countdown + reveal) ─────────────────── */
function FlipModal({
  game, currentUserId, onClose,
}: {
  game: CoinFlipGame;
  currentUserId?: string;
  onClose: () => void;
}) {
  const [countdown, setCountdown] = useState(3);
  const [isFlipping, setIsFlipping] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const player1 = { ...game.creator, side: game.side };
  const player2 = game.joiner
    ? { ...game.joiner, side: (game.side === 'crown' ? 'shield' : 'crown') as CoinSide }
    : null;

  const winner = game.winnerId
    ? (game.winnerId === player1.id ? player1 : player2 && game.winnerId === player2.id ? player2 : null)
    : game.result
      ? (player1.side === game.result ? player1 : player2)
      : null;
  const loser = winner && player2 ? (winner.id === player1.id ? player2 : player1) : null;
  const currentUserWon = winner && currentUserId ? winner.id === currentUserId : null;

  const totalPot = game.amount * 2;
  const rake = Math.round(totalPot * COINFLIP_RAKE_RATE * 100) / 100;
  const winAmount = Math.round((totalPot - rake) * 100) / 100;

  useEffect(() => {
    setCountdown(3);
    setIsFlipping(false);
    setShowResult(false);
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
  }, [game.id]);

  function handleFlipComplete() {
    setTimeout(() => setShowResult(true), 300);
  }

  if (!player2) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[100] flex items-center justify-center px-4"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        style={{ background: 'rgba(0,0,0,0.80)', backdropFilter: 'blur(8px)' }}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <motion.div
          className="w-full max-w-2xl rounded-md overflow-hidden relative bg-tft-bg-card border border-tft-border"
          style={{ boxShadow: '0 0 80px rgba(124,58,237,0.15)' }}
          initial={{ scale: 0.9, y: 30 }} animate={{ scale: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        >
          <div className="flex items-center justify-between px-4 py-4 border-b border-tft-border">
            <div className="w-8" />
            <h2 className="text-lg font-bold tracking-widest uppercase font-display text-tft-gold-bright">
              COINFLIP
            </h2>
            <button
              onClick={onClose}
              aria-label="Fermer"
              className="w-8 h-8 rounded-full flex items-center justify-center text-tft-text-dim hover:text-tft-text hover:bg-tft-bg-elevated transition-all"
            >
              <X size={18} />
            </button>
          </div>

          <div className="px-6 py-8">
            <div className="flex items-center justify-between gap-4">
              {/* Player 1 */}
              <div className="flex-1 flex flex-col items-center gap-3">
                <div
                  className="relative rounded-full overflow-hidden"
                  style={{
                    width: 72, height: 72,
                    border: `3px solid ${
                      showResult && winner?.id === player1.id ? '#fcd34d'
                        : showResult && loser?.id === player1.id ? '#3d3860'
                        : '#1f1d4a'
                    }`,
                    boxShadow: showResult && winner?.id === player1.id
                      ? '0 0 20px rgba(251,191,36,0.4)' : 'none',
                    opacity: showResult && loser?.id === player1.id ? 0.5 : 1,
                    transition: 'all 0.5s ease',
                  }}
                >
                  {player1.avatar ? (
                    <img src={player1.avatar} alt={player1.username} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xl font-bold bg-tft-border text-tft-text-muted">
                      {player1.username[0]?.toUpperCase()}
                    </div>
                  )}
                </div>
                <span className="text-[13px] font-medium truncate max-w-[120px]"
                  style={{ color: showResult && winner?.id === player1.id ? '#fcd34d' : '#e2e8f0' }}>
                  {player1.username}
                </span>
                <span className="text-[11px] px-2.5 py-1 rounded-full font-bold uppercase"
                  style={{
                    background: player1.side === 'crown' ? 'rgba(251,191,36,0.15)' : 'rgba(138,138,154,0.15)',
                    color: player1.side === 'crown' ? '#fcd34d' : '#c0c0c0',
                    border: `1px solid ${player1.side === 'crown' ? '#fbbf2440' : '#8a8a9a40'}`,
                  }}>
                  {player1.side === 'crown' ? '🏹 Archers' : '⚔ Swords'}
                </span>
              </div>

              {/* Center */}
              <div className="flex flex-col items-center justify-center min-w-[200px]">
                {countdown > 0 && !isFlipping ? (
                  <motion.div
                    key={countdown}
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 1.5, opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="flex items-center justify-center font-display"
                    style={{
                      width: 80, height: 80,
                      fontSize: 48, fontWeight: 900,
                      color: '#fcd34d',
                      textShadow: '0 0 20px rgba(251,191,36,0.5)',
                    }}
                  >
                    {countdown}
                  </motion.div>
                ) : (
                  <FlipCoin
                    result={winner?.side ?? game.result}
                    isFlipping={isFlipping}
                    onComplete={handleFlipComplete}
                    size={160}
                  />
                )}
                <div className="mt-4 text-center text-[13px] font-bold text-tft-text-muted">
                  {game.amount.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ⚜ chacun
                </div>
              </div>

              {/* Player 2 */}
              <div className="flex-1 flex flex-col items-center gap-3">
                <div className="relative rounded-full overflow-hidden"
                  style={{
                    width: 72, height: 72,
                    border: `3px solid ${
                      showResult && winner?.id === player2.id ? '#fcd34d'
                        : showResult && loser?.id === player2.id ? '#3d3860'
                        : '#1f1d4a'
                    }`,
                    boxShadow: showResult && winner?.id === player2.id
                      ? '0 0 20px rgba(251,191,36,0.4)' : 'none',
                    opacity: showResult && loser?.id === player2.id ? 0.5 : 1,
                    transition: 'all 0.5s ease',
                  }}>
                  {player2.avatar ? (
                    <img src={player2.avatar} alt={player2.username} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xl font-bold bg-tft-border text-tft-text-muted">
                      {player2.username[0]?.toUpperCase()}
                    </div>
                  )}
                </div>
                <span className="text-[13px] font-medium truncate max-w-[120px]"
                  style={{ color: showResult && winner?.id === player2.id ? '#fcd34d' : '#e2e8f0' }}>
                  {player2.username}
                </span>
                <span className="text-[11px] px-2.5 py-1 rounded-full font-bold uppercase"
                  style={{
                    background: player2.side === 'crown' ? 'rgba(251,191,36,0.15)' : 'rgba(138,138,154,0.15)',
                    color: player2.side === 'crown' ? '#fcd34d' : '#c0c0c0',
                    border: `1px solid ${player2.side === 'crown' ? '#fbbf2440' : '#8a8a9a40'}`,
                  }}>
                  {player2.side === 'crown' ? '🏹 Archers' : '⚔ Swords'}
                </span>
              </div>
            </div>

            <AnimatePresence>
              {showResult && (
                <motion.div
                  className="mt-8 text-center"
                  initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                >
                  {currentUserWon === true && (
                    <>
                      <p className="text-2xl font-bold tracking-wider font-display"
                        style={{ color: '#fcd34d', textShadow: '0 0 20px rgba(251,191,36,0.4)' }}>
                        VOUS AVEZ GAGNÉ
                      </p>
                      <p className="text-3xl font-black mt-2 text-tft-gold-bright">
                        +{winAmount.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ⚜
                      </p>
                    </>
                  )}
                  {currentUserWon === false && (
                    <p className="text-xl font-bold tracking-wider font-display text-tft-danger">PERDU</p>
                  )}
                  {currentUserWon === null && winner && (
                    <p className="text-xl font-bold font-display text-tft-gold-bright">
                      {winner.username} remporte le pot
                    </p>
                  )}
                  {showResult && (
                    <div className="flex items-center justify-center gap-3 mt-6">
                      <button
                        onClick={onClose}
                        className="px-6 py-2.5 font-bold text-[13px] tracking-wider rounded-md bg-tft-purple hover:bg-tft-purple-bright text-white transition-colors"
                      >
                        Rejouer
                      </button>
                      <button
                        onClick={onClose}
                        className="px-6 py-2.5 text-[13px] rounded-md bg-transparent border border-tft-border text-tft-text-muted hover:bg-tft-bg-elevated"
                      >
                        Fermer
                      </button>
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

/* ─────────────────── Cancel-or-wait countdown ─────────────────── */
function CancelOrWait({
  gameId, createdAt, onCancel,
}: { gameId: string; createdAt: string; onCancel: (id: string) => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const remaining = (new Date(createdAt).getTime() + CANCEL_DELAY_MS) - now;
  if (remaining <= 0) {
    return (
      <button
        onClick={() => onCancel(gameId)}
        className="w-full py-2 rounded-md text-[12px] font-bold uppercase tracking-wider transition-all hover:opacity-80"
        style={{
          background: 'rgba(239,68,68,0.1)',
          color: '#ef4444',
          border: '1px solid rgba(239,68,68,0.2)',
        }}
      >
        Annuler
      </button>
    );
  }
  const min = Math.floor(remaining / 60000);
  const sec = Math.floor((remaining % 60000) / 1000);
  return (
    <div className="w-full py-2 rounded-md text-[11px] text-center text-tft-text-faint">
      <Clock size={10} className="inline mr-1 -mt-px" />
      Annulable dans {min}:{sec.toString().padStart(2, '0')}
    </div>
  );
}

/* ─────────────────── Main page ─────────────────── */
export default function CoinflipPage() {
  const { data: session } = useSession();

  const [games, setGames] = useState<CoinFlipGame[]>([]);
  const [betAmount, setBetAmount] = useState('5');
  const [selectedSide, setSelectedSide] = useState<CoinSide>('crown');
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [activeGame, setActiveGame] = useState<CoinFlipGame | null>(null);
  const [viewTab, setViewTab] = useState<'live' | 'history'>('live');
  const [historyGames, setHistoryGames] = useState<CoinFlipGame[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const userCoins = (session?.user as { coins?: number })?.coins ?? 0;
  const userId = (session?.user as { id?: string })?.id;

  useEffect(() => {
    if (session?.user?.accessToken) setAuthToken(session.user.accessToken);
  }, [session]);

  const fetchGames = useCallback(async () => {
    try {
      const active = await apiClient.get('/coinflip');
      setGames(active.data.data ?? []);
    } catch { /* silent */ }
  }, []);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await apiClient.get('/coinflip/history/all?limit=50');
      setHistoryGames(res.data.data ?? []);
    } catch { /* silent */ }
    finally { setHistoryLoading(false); }
  }, []);

  useEffect(() => { if (viewTab === 'history') fetchHistory(); }, [viewTab, fetchHistory]);
  useEffect(() => { fetchGames(); }, [fetchGames]);

  useEffect(() => {
    connectSocket(session?.user.accessToken);
    const s = getSocket();

    s.on('coinflip:created', (data: CoinFlipGame) => {
      setGames((prev) => [data, ...prev]);
    });
    s.on('coinflip:joined', (data: CoinFlipGame) => {
      setGames((prev) => prev.map((g) => (g.id === data.id ? data : g)));
      if (data.creator.id === userId || data.joiner?.id === userId) {
        setActiveGame(data);
      }
    });
    s.on('coinflip:result', (data: CoinFlipGame) => {
      setGames((prev) => {
        const filtered = prev.filter((g) => g.id !== data.id);
        const completed = [data, ...filtered.filter(g => g.status === 'COMPLETED')].slice(0, 10);
        const open = filtered.filter(g => g.status !== 'COMPLETED');
        return [...open, ...completed];
      });
      setActiveGame((prev) => (prev?.id === data.id ? data : prev));
    });
    s.on('coinflip:cancelled', (data: { id: string }) => {
      setGames((prev) => prev.filter((g) => g.id !== data.id));
    });

    return () => {
      s.off('coinflip:created');
      s.off('coinflip:joined');
      s.off('coinflip:result');
      s.off('coinflip:cancelled');
    };
  }, [session, userId]);

  async function handleCreate() {
    if (!session) { signInWithSteam(); return; }
    const amount = parseCoinAmount(betAmount);
    if (!amount || amount < 2) { showMsg('error', 'Minimum 2 ⚜'); return; }
    if (amount > 500)         { showMsg('error', 'Maximum 500 ⚜'); return; }
    if (amount > userCoins)   { showMsg('error', 'Solde insuffisant'); return; }

    setCreating(true);
    try {
      const res = await apiClient.post('/coinflip/create', { amount, side: selectedSide });
      const game = res.data.data as CoinFlipGame;
      setGames((prev) => [game, ...prev]);
      setBetAmount('5');
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      showMsg('error', err?.response?.data?.error ?? err?.message ?? 'Erreur');
    } finally {
      setCreating(false);
    }
  }

  async function handleJoin(game: CoinFlipGame) {
    if (!session) { signInWithSteam(); return; }
    if (game.creator.id === userId) {
      showMsg('error', 'Vous ne pouvez pas rejoindre votre propre flip');
      return;
    }
    try {
      const res = await apiClient.post(`/coinflip/${game.id}/join`);
      const updated = res.data.data as CoinFlipGame;
      setActiveGame(updated);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      showMsg('error', err?.response?.data?.error ?? err?.message ?? 'Erreur');
    }
  }

  async function handleCancel(gameId: string) {
    try { await apiClient.post(`/coinflip/${gameId}/cancel`); setGames((prev) => prev.filter((g) => g.id !== gameId)); }
    catch { /* silent */ }
  }

  function showMsg(type: 'success' | 'error', text: string) {
    setMsg({ type, text }); setTimeout(() => setMsg(null), 3000);
  }

  const waitingGames = games.filter((g) => g.status === 'WAITING');
  const recentResults = games.filter((g) => g.status === 'COMPLETED').slice(0, 10);
  const isHighValue = (amount: number) => amount >= 100;

  return (
    <div className="min-h-screen relative bg-tft-bg text-tft-text">
      <div className="max-w-5xl mx-auto px-3 sm:px-4 py-4 sm:py-8">

        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md border border-tft-purple/40 bg-tft-purple/10 mb-3">
            <Hexagon size={11} className="text-tft-cyan-bright" />
            <span className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-purple-bright">
              TFT.money · Coinflip
            </span>
          </div>
          <div className="flex items-center justify-center gap-2 sm:gap-3 mb-1">
            <Coins className="w-6 h-6 sm:w-7 sm:h-7 text-tft-gold-bright" />
            <h1 className="text-2xl sm:text-3xl font-bold font-display text-tft-purple-bright">
              COINFLIP
            </h1>
          </div>
          <p className="text-[11px] tracking-widest uppercase text-tft-text-muted">
            Pile ou Face PvP — Misez et affrontez un adversaire
          </p>

          {/* Tab switcher */}
          <div className="flex items-center justify-center gap-1 mt-4">
            <button onClick={() => setViewTab('live')}
              className={cn('px-4 py-1.5 rounded-md text-[11px] font-bold tracking-wider uppercase transition-all',
                viewTab === 'live'
                  ? 'bg-tft-purple/15 text-tft-purple-bright border border-tft-purple/30'
                  : 'bg-transparent text-tft-text-muted border border-transparent')}>
              <Users size={12} className="inline mr-1.5" />
              En direct · {waitingGames.length + recentResults.length}
            </button>
            <button onClick={() => setViewTab('history')}
              className={cn('px-4 py-1.5 rounded-md text-[11px] font-bold tracking-wider uppercase transition-all',
                viewTab === 'history'
                  ? 'bg-tft-purple/15 text-tft-purple-bright border border-tft-purple/30'
                  : 'bg-transparent text-tft-text-muted border border-transparent')}>
              <Trophy size={12} className="inline mr-1.5" />
              Historique
            </button>
          </div>
        </div>

        {msg && (
          <div className={cn('p-2.5 rounded-md mb-4 text-[12px]',
            msg.type === 'success'
              ? 'bg-tft-mint-dim border border-tft-mint/40 text-tft-mint'
              : 'bg-tft-danger-dim border border-tft-danger/40 text-tft-danger')}>
            {msg.text}
          </div>
        )}

        {/* History tab */}
        {viewTab === 'history' && (
          <div className="rounded-md p-5 bg-tft-bg-card border border-tft-border">
            <div className="flex items-center gap-2 mb-4">
              <Trophy size={16} className="text-tft-text-muted" />
              <h2 className="text-[14px] font-bold tracking-wider uppercase font-display text-tft-text">Historique des coinflips</h2>
              <span className="ml-auto text-[11px] text-tft-text-muted">{historyGames.length} flips</span>
            </div>
            {historyLoading ? (
              <div className="text-center py-8 text-[12px] text-tft-text-muted">Chargement…</div>
            ) : historyGames.length === 0 ? (
              <div className="text-center py-8 text-[12px] text-tft-text-muted">Aucun flip terminé.</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {historyGames.map((game) => {
                  const isCreatorWin = game.result === game.side;
                  const winnerName = isCreatorWin ? game.creator.username : (game.joiner?.username ?? '?');
                  const loserName  = isCreatorWin ? (game.joiner?.username ?? '?') : game.creator.username;
                  const winAmount  = game.amount * 2;
                  const isCrown = game.result === 'crown';
                  return (
                    <div key={game.id}
                      className="flex items-center gap-3 px-3 py-3 rounded-md text-[13px] border border-tft-border"
                      style={{ background: 'linear-gradient(90deg, rgba(251,191,36,0.05) 0%, rgba(10,8,32,1) 45%)' }}>
                      <MiniCoin side={isCrown ? 'crown' : 'shield'} size={44} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 truncate">
                          <span className="text-[14px]">👑</span>
                          <span className="font-bold truncate text-tft-gold-bright" style={{ textShadow: '0 0 6px rgba(251,191,36,0.35)' }}>
                            {winnerName}
                          </span>
                          <span className="font-bold shrink-0 text-tft-mint">
                            +{winAmount.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ⚜
                          </span>
                        </div>
                        <div className="text-[11px] truncate mt-0.5 text-tft-text-muted">
                          vs <span className="text-tft-text-dim">{loserName}</span>
                          <span className="mx-1.5 text-tft-border-mid">·</span>
                          mise {game.amount.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ⚜
                          <span className="mx-1.5 text-tft-border-mid">·</span>
                          {new Date(game.createdAt).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                      <button
                        onClick={() => setActiveGame(game)}
                        className="shrink-0 px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all hover:brightness-110 bg-tft-purple/15 text-tft-purple-bright border border-tft-purple/30">
                        Rejouer
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Live tab */}
        {viewTab === 'live' && (<>
          {/* Create */}
          <div className="rounded-md p-5 mb-6 bg-tft-bg-card border border-tft-border">
            <div className="flex items-center gap-2 mb-4">
              <Plus size={16} className="text-tft-purple-bright" />
              <h2 className="text-[14px] font-bold tracking-wider uppercase font-display text-tft-text">Lancer un flip</h2>
            </div>

            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex gap-2">
                <button onClick={() => setSelectedSide('crown')}
                  className={cn('flex flex-col items-center gap-1.5 px-5 py-3 rounded-md transition-all',
                    selectedSide === 'crown' ? '' : 'hover:bg-tft-bg-elevated')}
                  style={{
                    background: selectedSide === 'crown' ? 'rgba(251,191,36,0.12)' : 'transparent',
                    border: `1.5px solid ${selectedSide === 'crown' ? '#fbbf24' : '#1f1d4a'}`,
                    boxShadow: selectedSide === 'crown' ? '0 0 12px rgba(251,191,36,0.3)' : 'none',
                  }}>
                  <span style={{ fontSize: 28 }}>🏹</span>
                  <span className="text-[11px] font-bold uppercase" style={{ color: selectedSide === 'crown' ? '#fcd34d' : '#64748b' }}>
                    Archers
                  </span>
                </button>
                <button onClick={() => setSelectedSide('shield')}
                  className={cn('flex flex-col items-center gap-1.5 px-5 py-3 rounded-md transition-all',
                    selectedSide === 'shield' ? '' : 'hover:bg-tft-bg-elevated')}
                  style={{
                    background: selectedSide === 'shield' ? 'rgba(138,138,154,0.1)' : 'transparent',
                    border: `1.5px solid ${selectedSide === 'shield' ? '#8a8a9a' : '#1f1d4a'}`,
                    boxShadow: selectedSide === 'shield' ? '0 0 12px rgba(138,138,154,0.2)' : 'none',
                  }}>
                  <span style={{ fontSize: 28 }}>⚔️</span>
                  <span className="text-[11px] font-bold uppercase" style={{ color: selectedSide === 'shield' ? '#c0c0c0' : '#64748b' }}>
                    Swords
                  </span>
                </button>
              </div>

              <div className="flex-1 flex flex-col gap-2">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type="number" step="0.01" inputMode="decimal"
                      value={betAmount}
                      onChange={(e) => setBetAmount(e.target.value)}
                      placeholder="Montant en coins"
                      className="w-full px-3 py-2.5 rounded-md text-[13px] outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none bg-tft-bg-elevated border border-tft-border text-tft-text"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-tft-gold-bright text-[11px]">⚜</span>
                  </div>
                  {[1, 10, 50, 100].map((v) => (
                    <button key={v}
                      onClick={() => setBetAmount((a) => String(round2(parseCoinAmount(a) + v)))}
                      className="px-3 py-2 rounded-md text-[11px] font-bold hover:opacity-80 bg-tft-border text-tft-text-dim border border-tft-border-mid">
                      +{v}
                    </button>
                  ))}
                  <button
                    onClick={() => setBetAmount(String(userCoins))}
                    className="px-3 py-2 rounded-md text-[11px] font-bold hover:opacity-80 bg-tft-border text-tft-text-dim border border-tft-border-mid">
                    MAX
                  </button>
                </div>
                <button
                  onClick={handleCreate}
                  disabled={creating || !betAmount || parseCoinAmount(betAmount) < 1}
                  className="w-full py-3 rounded-md text-[14px] font-bold tracking-wider transition-all disabled:opacity-40 bg-tft-purple hover:bg-tft-purple-bright text-white"
                >
                  {creating
                    ? 'Traitement...'
                    : !session
                      ? 'SE CONNECTER VIA STEAM'
                      : `Lancer pour ${betAmount ? parseCoinAmount(betAmount).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : '...'} ⚜`}
                </button>
              </div>
            </div>
          </div>

          {/* Open Flips lobby */}
          <div className="rounded-md p-5 mb-6 bg-tft-bg-card border border-tft-border">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Users size={16} className="text-tft-purple-bright" />
                <h2 className="text-[14px] font-bold tracking-wider uppercase font-display text-tft-text">Flips ouverts</h2>
              </div>
              <span className="text-[10px] text-tft-text-muted border border-tft-border rounded-md px-2 py-0.5">
                {waitingGames.length} ouverts
              </span>
            </div>

            {waitingGames.length === 0 ? (
              <div className="text-center py-12 rounded-md bg-tft-bg/60 border border-dashed border-tft-border">
                <Coins size={40} className="mx-auto mb-3 text-tft-border-mid" />
                <p className="text-[13px] text-tft-text-muted">Aucun flip ouvert — lancez-en un !</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {waitingGames.map((game, idx) => (
                  <div key={game.id}
                    className="rounded-md p-4 flex flex-col gap-3 transition-all hover:translate-y-[-2px] bg-tft-bg/60"
                    style={{
                      border: `1px solid ${isHighValue(game.amount) ? '#fbbf2440' : '#1f1d4a'}`,
                      animation: `fadeIn 0.35s ease-out ${idx * 0.05}s both`,
                      boxShadow: isHighValue(game.amount) ? '0 0 18px rgba(251,191,36,0.15)' : 'none',
                    }}>
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-full overflow-hidden shrink-0 border-2 border-tft-border">
                        {game.creator.avatar ? (
                          <img src={game.creator.avatar} alt={game.creator.username} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[11px] font-bold bg-tft-border text-tft-text-muted">
                            {game.creator.username[0]?.toUpperCase()}
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium truncate text-tft-text">{game.creator.username}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <MiniCoin side={game.side} size={20} />
                          <span className="text-[10px] uppercase tracking-wider"
                            style={{ color: game.side === 'crown' ? '#fcd34d' : '#c0c0c0' }}>
                            {game.side === 'crown' ? 'Archers' : 'Swords'}
                          </span>
                        </div>
                      </div>
                      <div className="text-right shrink-0 flex items-center gap-1.5">
                        <p className="text-[18px] font-bold tabular-nums font-display"
                          style={{ color: isHighValue(game.amount) ? '#fcd34d' : '#e2e8f0' }}>
                          {game.amount.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                        </p>
                        <span className="text-[18px] leading-none text-tft-gold-bright"
                          style={{ filter: 'drop-shadow(0 0 8px rgba(251,191,36,0.55))' }}>⚜</span>
                      </div>
                    </div>

                    {game.creator.id === userId ? (
                      <CancelOrWait gameId={game.id} createdAt={game.createdAt} onCancel={handleCancel} />
                    ) : (
                      <button onClick={() => handleJoin(game)}
                        className="w-full py-2 rounded-md text-[12px] font-bold uppercase tracking-wider transition-all hover:opacity-80 flex items-center justify-center gap-2"
                        style={{
                          background: game.side === 'crown' ? 'rgba(138,138,154,0.15)' : 'rgba(251,191,36,0.15)',
                          color:      game.side === 'crown' ? '#c0c0c0' : '#fcd34d',
                          border:    `1px solid ${game.side === 'crown' ? '#8a8a9a40' : '#fbbf2440'}`,
                        }}>
                        <MiniCoin side={game.side === 'crown' ? 'shield' : 'crown'} size={20} />
                        <span>Rejoindre · {game.side === 'crown' ? 'Swords' : 'Archers'}</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent results */}
          {recentResults.length > 0 && (
            <div className="rounded-md p-5 bg-tft-bg-card border border-tft-border">
              <div className="flex items-center gap-2 mb-4">
                <Clock size={16} className="text-tft-text-muted" />
                <h2 className="text-[14px] font-bold tracking-wider uppercase font-display text-tft-text">Résultats récents</h2>
              </div>
              <div className="flex gap-2 pb-2 overflow-x-auto scrollbar-arcane">
                {recentResults.slice(0, 10).map((game) => {
                  const isCreatorWin = game.result === game.side;
                  const winnerName = isCreatorWin ? game.creator.username : game.joiner?.username ?? '?';
                  return (
                    <div key={game.id}
                      className="shrink-0 rounded-md p-3 flex flex-col items-center gap-1.5 bg-tft-bg/60 border border-tft-border"
                      style={{ minWidth: 120 }}>
                      <span style={{
                        fontSize: 20,
                        filter: `drop-shadow(0 0 6px ${game.result === 'crown' ? 'rgba(251,191,36,0.4)' : 'rgba(192,192,192,0.3)'})`,
                      }}>
                        {game.result === 'crown' ? '🏹' : '⚔️'}
                      </span>
                      <p className="text-[12px] font-bold"
                        style={{ color: game.result === 'crown' ? '#fcd34d' : '#c0c0c0' }}>
                        {game.amount.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ⚜
                      </p>
                      <p className="text-[10px] truncate max-w-[100px] text-tft-text-muted">{winnerName}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>)}
      </div>

      {activeGame && (
        <FlipModal
          game={activeGame}
          currentUserId={userId}
          onClose={() => setActiveGame(null)}
        />
      )}
    </div>
  );
}
