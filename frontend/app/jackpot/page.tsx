'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useSession, signIn } from 'next-auth/react';
import { apiClient, setAuthToken } from '@/lib/api';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Users, Clock, Trophy, Shield, ExternalLink } from 'lucide-react';

interface JackpotUser {
  id: string;
  username: string;
  avatar: string | null;
}

interface JackpotBet {
  id: string;
  roundId: string;
  userId: string;
  amount: number;
  ticketFrom: number;
  ticketTo: number;
  createdAt: string;
  user: JackpotUser;
}

interface JackpotRound {
  id: string;
  status: 'OPEN' | 'CLOSING' | 'SPINNING' | 'COMPLETED' | 'CANCELLED';
  potTotal: number;
  participantCount: number;
  nonce: number;
  seedHash: string;
  clientSeed: string;
  serverSeed?: string | null;
  rngSource?: 'random_org_signed' | 'hmac_fallback' | null;
  randomJson?: string | null;
  randomSignature?: string | null;
  randomSerial?: string | null;
  winningTicket?: number | null;
  winnerId?: string | null;
  winner?: JackpotUser | null;
  rake: number;
  netPayout?: number | null;
  startedAt: string;
  closingAt?: string | null;
  settledAt?: string | null;
  bets: JackpotBet[];
}

const MIN_BET = 1;
const MAX_BET = 5000;
const ROUND_DURATION_S = 90;

interface ParticipantAggregate {
  user: JackpotUser;
  total: number;
  chance: number;         // 0..100
  color: string;
  // Cumulative ticket range covering ALL bets from this user.
  // Used to draw the horizontal stacked bar. Ranges are sorted by first
  // bet time so earlier bettors appear on the left of the bar.
  ticketFrom: number;     // inclusive — min ticketFrom of any of their bets
  ticketTo: number;       // exclusive — max ticketTo of any of their bets
}

function userColor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue}, 72%, 58%)`;
}

/**
 * Aggregate bets by user. Since bets are placed one at a time and each bet
 * claims a contiguous range right after the previous one, all bets from one
 * user don't always form a single contiguous range (another user could have
 * bet in between). For the bar we display each BET as its own segment
 * coloured by its user — this matches CSGO jackpot UIs exactly and keeps
 * the visual ordering (earlier = left).
 */
interface ParticipantsView {
  /** Aggregated by user — for the participant list + my-chance display. */
  aggregates: ParticipantAggregate[];
  /** One segment per bet — for the horizontal bar. Ordered by ticketFrom. */
  segments: Array<{ bet: JackpotBet; color: string }>;
}

function buildParticipantsView(bets: JackpotBet[], potTotal: number): ParticipantsView {
  const byUser = new Map<string, ParticipantAggregate>();
  for (const bet of bets) {
    const color = userColor(bet.userId);
    const existing = byUser.get(bet.userId);
    if (existing) {
      existing.total += bet.amount;
      existing.ticketFrom = Math.min(existing.ticketFrom, bet.ticketFrom);
      existing.ticketTo = Math.max(existing.ticketTo, bet.ticketTo);
    } else {
      byUser.set(bet.userId, {
        user: bet.user,
        total: bet.amount,
        chance: 0,
        color,
        ticketFrom: bet.ticketFrom,
        ticketTo: bet.ticketTo,
      });
    }
  }
  const aggregates = Array.from(byUser.values());
  for (const p of aggregates) p.chance = potTotal > 0 ? (p.total / potTotal) * 100 : 0;
  aggregates.sort((a, b) => b.total - a.total);

  const segments = bets
    .slice()
    .sort((a, b) => a.ticketFrom - b.ticketFrom)
    .map((bet) => ({ bet, color: userColor(bet.userId) }));

  return { aggregates, segments };
}

/** Countdown from closingAt → 0. Returns seconds remaining, or null if no timer. */
function useCountdown(closingAt: string | null | undefined): number | null {
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    if (!closingAt) { setRemaining(null); return; }
    const target = new Date(closingAt).getTime();
    const tick = () => {
      const s = Math.max(0, Math.ceil((target - Date.now()) / 1000));
      setRemaining(s);
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [closingAt]);
  return remaining;
}

/** Circular SVG timer that fills as the countdown drops. */
function CircularTimer({ seconds, total = ROUND_DURATION_S }: { seconds: number | null; total?: number }) {
  if (seconds == null) return null;
  const R = 22;
  const C = 2 * Math.PI * R;
  const pct = Math.max(0, Math.min(1, seconds / total));
  const dashOffset = C * (1 - pct);
  const isUrgent = seconds <= 10;
  const color = isUrgent ? '#f87171' : '#ffd97a';
  return (
    <motion.div
      animate={isUrgent ? { scale: [1, 1.06, 1] } : { scale: 1 }}
      transition={isUrgent ? { duration: 1, repeat: Infinity } : { duration: 0 }}
      className="relative shrink-0"
      style={{ width: 56, height: 56 }}
    >
      <svg width="56" height="56" viewBox="0 0 56 56">
        <circle cx="28" cy="28" r={R} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="3" />
        <circle
          cx="28" cy="28" r={R}
          fill="none" stroke={color} strokeWidth="3" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={dashOffset}
          transform="rotate(-90 28 28)"
          style={{ transition: 'stroke-dashoffset 0.25s linear, stroke 0.3s' }}
        />
      </svg>
      <div
        className="absolute inset-0 flex items-center justify-center text-sm font-bold"
        style={{ color }}
      >
        {seconds}
      </div>
    </motion.div>
  );
}

/**
 * Horizontal ticket bar — CSGO-style.
 * Each bet is a coloured segment whose width = bet.amount / potTotal.
 * When SPINNING or COMPLETED, a pointer is animated to the winning
 * segment's centre. The pointer is framer-motion animated from 50 % →
 * target % with a 3.5 s cubic-bezier ease-out.
 */
function TicketBar({
  segments,
  potTotal,
  winningTicket,
  isSpinning,
}: {
  segments: Array<{ bet: JackpotBet; color: string }>;
  potTotal: number;
  winningTicket: number | null | undefined;
  isSpinning: boolean;
}) {
  // Target pointer position (%): winningTicket is now in basis points
  // [0, 9999] = 0.00% to 99.99% drawn by Random.org. Map 1:1 to the bar.
  // +0.005 centres the pointer inside the 0.01% slot (cosmetic).
  const targetPct = useMemo(() => {
    if (winningTicket == null) return 50;
    return winningTicket / 100 + 0.005;
  }, [winningTicket]);

  const showPointer = winningTicket != null;

  return (
    <div className="relative w-full" style={{ height: 44 }}>
      {/* The bar itself */}
      <div
        className="absolute inset-x-0 top-1/2 -translate-y-1/2 overflow-hidden rounded-lg flex"
        style={{
          height: 32,
          background: '#0a0818',
          border: '1px solid #1e1a30',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)',
        }}
      >
        {potTotal === 0 ? (
          <div
            className="w-full h-full flex items-center justify-center text-[11px] tracking-wider uppercase"
            style={{ color: '#4a4468' }}
          >
            Bar remplie dès la 1ʳᵉ mise
          </div>
        ) : (
          segments.map(({ bet, color }) => {
            const widthPct = (bet.amount / potTotal) * 100;
            return (
              <motion.div
                key={bet.id}
                initial={{ opacity: 0, flexGrow: 0 }}
                animate={{ opacity: 1, flexGrow: widthPct }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                style={{
                  flexBasis: 0,
                  minWidth: 2,
                  background: color,
                  borderRight: '1px solid rgba(0,0,0,0.25)',
                }}
                title={`${bet.user.username} · ${bet.amount} ⚜`}
              />
            );
          })
        )}
      </div>

      {/* Animated pointer (absolute, its left is interpolated) */}
      {showPointer && (
        <motion.div
          className="absolute top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ width: 0, height: 0, left: `50%` }}
          initial={{ left: '50%' }}
          animate={{ left: `${targetPct}%` }}
          transition={{
            duration: isSpinning ? 3.5 : 0.8,
            ease: isSpinning ? [0.12, 0.8, 0.3, 1] : [0.22, 1, 0.36, 1],
          }}
        >
          {/* Vertical line */}
          <div
            className="absolute"
            style={{
              left: -1,
              top: -26,
              width: 2,
              height: 52,
              background: '#fff8dc',
              boxShadow: '0 0 12px rgba(255,248,220,0.8), 0 0 24px rgba(255,197,66,0.5)',
            }}
          />
          {/* Triangle top */}
          <div
            className="absolute"
            style={{
              left: -6,
              top: -34,
              width: 0,
              height: 0,
              borderLeft: '6px solid transparent',
              borderRight: '6px solid transparent',
              borderTop: '8px solid #fff8dc',
              filter: 'drop-shadow(0 0 6px rgba(255,197,66,0.7))',
            }}
          />
        </motion.div>
      )}
    </div>
  );
}

export default function JackpotPage() {
  const { data: session } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id;

  const [round, setRound] = useState<JackpotRound | null>(null);
  const [betAmount, setBetAmount] = useState('10');
  const [placing, setPlacing] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [reveal, setReveal] = useState<{ winner: JackpotUser; netPayout: number; rngSource: string; winningTicket: number; potTotal: number; chance: number } | null>(null);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tab state (Live / Historique) — same pattern as coinflip page
  const [viewTab, setViewTab] = useState<'live' | 'history'>('live');
  const [history, setHistory] = useState<JackpotRound[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const countdown = useCountdown(round?.closingAt ?? null);

  useEffect(() => {
    const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;
    setAuthToken(token ?? null);
  }, [session]);

  const fetchRound = useCallback(async () => {
    try {
      const res = await apiClient.get('/jackpot');
      setRound(res.data.data ?? null);
    } catch {
      // silent — socket will catch up
    }
  }, []);

  useEffect(() => { fetchRound(); }, [fetchRound]);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await apiClient.get('/jackpot/history?limit=50');
      setHistory(res.data.data ?? []);
    } catch {
      // silent
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (viewTab === 'history') fetchHistory();
  }, [viewTab, fetchHistory]);

  // Fires gold confetti when the winner is revealed.
  // Dynamic import so canvas-confetti is only loaded in the browser and
  // doesn't pull SSR issues (it touches window).
  async function fireConfetti() {
    try {
      const confetti = (await import('canvas-confetti')).default;
      const colors = ['#ffd97a', '#f5c842', '#d4a017', '#ffffff'];
      confetti({ particleCount: 80, spread: 70, origin: { x: 0.2, y: 0.6 }, colors });
      confetti({ particleCount: 80, spread: 70, origin: { x: 0.8, y: 0.6 }, colors });
      setTimeout(() => {
        confetti({ particleCount: 120, spread: 120, origin: { x: 0.5, y: 0.4 }, colors });
      }, 300);
    } catch {
      // confetti failure is non-critical
    }
  }

  useEffect(() => {
    const { connectSocket, getSocket } = require('@/lib/socket');
    connectSocket();
    const s = getSocket();
    s.emit('jackpot:joinLobby');

    s.on('jackpot:round:open', (data: JackpotRound) => {
      setRound(data);
      setReveal(null);
    });

    s.on('jackpot:bet:new', (data: { roundId: string; potTotal: number; participantCount: number; bet: JackpotBet }) => {
      setRound((prev) => {
        if (!prev || prev.id !== data.roundId) return prev;
        const hasBet = prev.bets.some((b) => b.id === data.bet.id);
        return {
          ...prev,
          potTotal: data.potTotal,
          participantCount: data.participantCount,
          bets: hasBet ? prev.bets : [...prev.bets, data.bet],
        };
      });
    });

    s.on('jackpot:round:closing', (data: { roundId: string; closingAt: string; potTotal: number; participantCount: number }) => {
      setRound((prev) => prev && prev.id === data.roundId
        ? { ...prev, status: 'CLOSING', closingAt: data.closingAt, potTotal: data.potTotal, participantCount: data.participantCount }
        : prev
      );
    });

    s.on('jackpot:round:spinning', (data: {
      roundId: string;
      winningTicket: number;
      winnerId: string;
      winner: JackpotUser;
      potTotal: number;
      netPayout: number;
      rake: number;
      rngSource: string;
    }) => {
      setRound((prev) => prev && prev.id === data.roundId
        ? {
            ...prev,
            status: 'SPINNING',
            winningTicket: data.winningTicket,
            winnerId: data.winnerId,
            winner: data.winner,
            netPayout: data.netPayout,
            rake: data.rake,
            rngSource: data.rngSource as 'random_org_signed' | 'hmac_fallback',
          }
        : prev
      );
      // Compute the winner's chance % from current bets for the reveal banner.
      // We use a fresh read via the setState callback below; outside of React
      // state the current `round.bets` in this closure is stale.
      if (revealTimer.current) clearTimeout(revealTimer.current);
      // Delay the reveal banner until the pointer animation finishes.
      revealTimer.current = setTimeout(() => {
        setRound((prev) => {
          if (!prev) return prev;
          const winnerBets = prev.bets.filter((b) => b.userId === data.winnerId);
          const winnerTotal = winnerBets.reduce((acc, b) => acc + b.amount, 0);
          const chance = data.potTotal > 0 ? (winnerTotal / data.potTotal) * 100 : 0;
          setReveal({
            winner: data.winner,
            netPayout: data.netPayout,
            rngSource: data.rngSource,
            winningTicket: data.winningTicket,
            potTotal: data.potTotal,
            chance,
          });
          fireConfetti();
          return prev;
        });
      }, 3800); // slightly longer than the 3.5s pointer animation
    });

    s.on('jackpot:round:settled', (data: JackpotRound) => {
      setRound(data);
    });

    s.on('jackpot:round:cancelled', (data: { roundId: string; reason: string }) => {
      setRound((prev) => prev && prev.id === data.roundId
        ? { ...prev, status: 'CANCELLED' }
        : prev
      );
      showMsg('error', 'Round annulé — pas assez de participants, mises remboursées.');
    });

    return () => {
      s.emit('jackpot:leaveLobby');
      s.off('jackpot:round:open');
      s.off('jackpot:bet:new');
      s.off('jackpot:round:closing');
      s.off('jackpot:round:spinning');
      s.off('jackpot:round:settled');
      s.off('jackpot:round:cancelled');
      if (revealTimer.current) clearTimeout(revealTimer.current);
    };
  }, []);

  function showMsg(type: 'success' | 'error', text: string) {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 3000);
  }

  async function handleBet() {
    if (!session) { signIn('steam'); return; }
    const amount = parseInt(betAmount);
    if (!amount || amount < MIN_BET) { showMsg('error', `Minimum ${MIN_BET} ⚜`); return; }
    if (amount > MAX_BET) { showMsg('error', `Maximum ${MAX_BET} ⚜`); return; }
    setPlacing(true);
    try {
      await apiClient.post('/jackpot/bet', { amount });
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      showMsg('error', err?.response?.data?.error ?? err?.message ?? 'Erreur');
    } finally {
      setPlacing(false);
    }
  }

  const view = round ? buildParticipantsView(round.bets, round.potTotal) : { aggregates: [], segments: [] };
  const myAggregate = view.aggregates.find((p) => p.user.id === userId);
  const myChance = myAggregate?.chance ?? 0;

  const isLive = round && ['OPEN', 'CLOSING', 'SPINNING'].includes(round.status);
  const canBet = round && (round.status === 'OPEN' || round.status === 'CLOSING');
  const isSpinning = round?.status === 'SPINNING';

  return (
    <div className="min-h-screen" style={{ background: '#07060f', color: '#e8e2f5' }}>
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="flex items-center justify-center gap-3 mb-1">
            <Trophy size={28} style={{ color: '#ffd97a' }} />
            <h1 className="text-3xl font-bold" style={{ fontFamily: 'Cinzel, serif', color: '#ffd97a' }}>
              JACKPOT
            </h1>
          </div>
          <p className="text-[11px] tracking-widest uppercase" style={{ color: '#6b6488' }}>
            Winner takes the pot · 5% rake · Provably fair
          </p>

          {/* Tab switcher : En direct / Historique */}
          <div className="flex items-center justify-center gap-1 mt-4">
            <button
              onClick={() => setViewTab('live')}
              className="px-4 py-1.5 rounded-lg text-[11px] font-bold tracking-wider uppercase transition-all"
              style={{
                background: viewTab === 'live' ? 'rgba(255,197,66,0.15)' : 'transparent',
                color: viewTab === 'live' ? '#ffd97a' : '#6b6488',
                border: viewTab === 'live' ? '1px solid rgba(255,197,66,0.3)' : '1px solid transparent',
              }}
            >
              <Users size={12} className="inline mr-1.5" />
              En direct
            </button>
            <button
              onClick={() => setViewTab('history')}
              className="px-4 py-1.5 rounded-lg text-[11px] font-bold tracking-wider uppercase transition-all"
              style={{
                background: viewTab === 'history' ? 'rgba(255,197,66,0.15)' : 'transparent',
                color: viewTab === 'history' ? '#ffd97a' : '#6b6488',
                border: viewTab === 'history' ? '1px solid rgba(255,197,66,0.3)' : '1px solid transparent',
              }}
            >
              <Trophy size={12} className="inline mr-1.5" />
              Historique
            </button>
          </div>
        </div>

        {/* Flash message */}
        {msg && (
          <div
            className="mb-4 px-4 py-2 rounded-lg text-sm text-center"
            style={{
              background: msg.type === 'success' ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)',
              border: `1px solid ${msg.type === 'success' ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)'}`,
              color: msg.type === 'success' ? '#4ade80' : '#f87171',
            }}
          >
            {msg.text}
          </div>
        )}

        {viewTab === 'live' && (
        <>
        {/* Main card: pot + timer + horizontal bar */}
        <div
          className="rounded-2xl p-6 mb-6"
          style={{
            background: 'linear-gradient(135deg, #0d0b1a 0%, #110e24 100%)',
            border: '1px solid rgba(255,197,66,0.25)',
            boxShadow: '0 0 40px rgba(255,197,66,0.08)',
          }}
        >
          <div className="flex items-center gap-5 mb-5">
            {/* Timer */}
            <div className="w-14 flex items-center justify-center">
              {countdown != null && round?.status === 'CLOSING' ? (
                <CircularTimer seconds={countdown} />
              ) : (
                <div
                  className="w-14 h-14 rounded-full flex items-center justify-center"
                  style={{ border: '2px solid rgba(255,255,255,0.05)', color: '#4a4468' }}
                >
                  <Clock size={20} />
                </div>
              )}
            </div>

            {/* Pot + status */}
            <div className="flex-1 min-w-0">
              <div className="text-[10px] tracking-[0.3em] uppercase mb-1" style={{ color: '#6b6488' }}>
                Total pot
              </div>
              <div
                className="text-4xl md:text-5xl font-bold leading-none"
                style={{ fontFamily: 'Cinzel, serif', color: '#ffd97a', textShadow: '0 0 24px rgba(255,197,66,0.3)' }}
              >
                {round?.potTotal.toLocaleString() ?? 0} ⚜
              </div>
              <div className="mt-2 flex items-center gap-4 text-[12px]" style={{ color: '#9b94b8' }}>
                <span className="flex items-center gap-1.5">
                  <Users size={13} />
                  {round?.participantCount ?? 0} {round?.participantCount === 1 ? 'joueur' : 'joueurs'}
                </span>
                {round?.status === 'OPEN' && round.participantCount < 2 && (
                  <span style={{ color: '#6b6488' }}>En attente d&apos;un 2ᵉ joueur…</span>
                )}
                {isSpinning && (
                  <span className="font-bold" style={{ color: '#ffd97a' }}>Tirage en cours…</span>
                )}
                {round?.status === 'COMPLETED' && (
                  <span className="font-bold" style={{ color: '#4ade80' }}>Round terminé</span>
                )}
              </div>
            </div>

            {/* My chance */}
            {userId && myAggregate && round && round.potTotal > 0 && (
              <div className="hidden md:block text-right">
                <div className="text-[10px] tracking-[0.2em] uppercase" style={{ color: '#6b6488' }}>
                  Votre chance
                </div>
                <div className="text-xl font-bold" style={{ color: myAggregate.color }}>
                  {myChance.toFixed(1)}%
                </div>
                <div className="text-[11px]" style={{ color: '#9b94b8' }}>
                  {myAggregate.total.toLocaleString()} ⚜ misés
                </div>
              </div>
            )}
          </div>

          {/* Horizontal ticket bar */}
          <TicketBar
            segments={view.segments}
            potTotal={round?.potTotal ?? 0}
            winningTicket={round?.winningTicket ?? null}
            isSpinning={isSpinning}
          />

          {/* Ticket range : Random.org tire un nombre en basis points [0, 9999]
              affiché comme un % avec 2 décimales (0.00% → 99.99%). Modèle
              identique à CSGOEmpire / CSGOLotto. */}
          {round && round.potTotal > 0 && (
            <div className="flex items-center justify-between text-[10px] mt-2 font-mono" style={{ color: '#4a4468' }}>
              <span>0.00%</span>
              {round.winningTicket != null && (
                <span style={{ color: '#ffd97a' }}>
                  tirage · {(round.winningTicket / 100).toFixed(2)}%
                </span>
              )}
              <span>100.00%</span>
            </div>
          )}
        </div>

        {/* Winner reveal banner */}
        <AnimatePresence>
          {reveal && (
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.95 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="rounded-2xl p-6 mb-6 text-center"
              style={{
                background: 'linear-gradient(135deg, rgba(255,197,66,0.18) 0%, rgba(255,217,122,0.08) 100%)',
                border: '1px solid rgba(255,197,66,0.5)',
                boxShadow: '0 0 40px rgba(255,197,66,0.25)',
              }}
            >
              <div className="text-[10px] tracking-[0.3em] uppercase mb-3" style={{ color: '#ffd97a' }}>
                Winner
              </div>
              <div className="flex items-center justify-center gap-3 mb-3">
                {reveal.winner.avatar ? (
                  <img
                    src={reveal.winner.avatar}
                    alt={reveal.winner.username}
                    className="w-14 h-14 rounded-full"
                    style={{ border: '2px solid #ffd97a', boxShadow: '0 0 16px rgba(255,197,66,0.5)' }}
                  />
                ) : null}
                <div className="text-2xl font-bold" style={{ fontFamily: 'Cinzel, serif', color: '#ffd97a' }}>
                  {reveal.winner.username}
                </div>
              </div>
              <div className="text-2xl font-bold mb-1" style={{ color: '#e8e2f5' }}>
                +{reveal.netPayout.toLocaleString()} ⚜
              </div>
              <div className="text-[11px]" style={{ color: '#9b94b8' }}>
                chance {reveal.chance.toFixed(2)}% · tiré à {(reveal.winningTicket / 100).toFixed(2)}%
              </div>
              <div className="text-[10px] mt-1" style={{ color: '#6b6488' }}>
                RNG : {reveal.rngSource === 'random_org_signed' ? 'Random.org Signed API' : 'HMAC fallback'}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bet input */}
        <div
          className="rounded-2xl p-6 mb-6"
          style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}
        >
          <div className="text-[11px] tracking-wider uppercase mb-3" style={{ color: '#9b94b8' }}>
            Place your bet ({MIN_BET} – {MAX_BET} ⚜)
          </div>
          <div className="flex items-center gap-3">
            <Input
              type="number"
              min={MIN_BET}
              max={MAX_BET}
              value={betAmount}
              onChange={(e) => setBetAmount(e.target.value)}
              className="flex-1"
              placeholder={`${MIN_BET} – ${MAX_BET}`}
              disabled={!canBet || placing}
            />
            <Button
              onClick={handleBet}
              disabled={!canBet || placing}
              className="font-bold"
              style={{
                background: canBet
                  ? 'linear-gradient(135deg, #f5c842 0%, #d4a017 100%)'
                  : 'rgba(255,197,66,0.2)',
                color: canBet ? '#1a1010' : '#6b6488',
                border: 'none',
                minWidth: 140,
              }}
            >
              {placing ? '...' : session ? 'MISER' : 'SE CONNECTER'}
            </Button>
          </div>
          {!canBet && isLive && (
            <div className="mt-2 text-[11px]" style={{ color: '#6b6488' }}>
              Les paris sont fermés pour ce round.
            </div>
          )}
        </div>

        {/* Participants list — simplified (no individual bars, bar above is the source of truth) */}
        <div
          className="rounded-2xl p-6"
          style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}
        >
          <div className="text-[11px] tracking-wider uppercase mb-3 flex items-center justify-between" style={{ color: '#9b94b8' }}>
            <span>Participants</span>
            <span>{view.aggregates.length}</span>
          </div>

          {view.aggregates.length === 0 ? (
            <div className="text-center py-8 text-sm" style={{ color: '#6b6488' }}>
              Personne n&apos;a encore misé. Soyez le premier !
            </div>
          ) : (
            <div className="space-y-1">
              {view.aggregates.map((p) => {
                const isWinner = round?.status === 'COMPLETED' && round.winnerId === p.user.id;
                return (
                  <div
                    key={p.user.id}
                    className="rounded-lg p-3 flex items-center gap-3"
                    style={{
                      background: p.user.id === userId ? 'rgba(255,197,66,0.08)' : 'rgba(255,255,255,0.02)',
                      border: isWinner
                        ? '1px solid rgba(255,197,66,0.6)'
                        : p.user.id === userId
                          ? '1px solid rgba(255,197,66,0.3)'
                          : '1px solid rgba(255,255,255,0.04)',
                    }}
                  >
                    {p.user.avatar ? (
                      <img
                        src={p.user.avatar}
                        alt={p.user.username}
                        className="w-9 h-9 rounded-full"
                        style={{ border: `2px solid ${p.color}` }}
                      />
                    ) : (
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold"
                        style={{ background: p.color, color: '#1a1010' }}
                      >
                        {p.user.username.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0 text-sm font-bold truncate" style={{ color: '#e8e2f5' }}>
                      {p.user.username}
                      {isWinner && <span className="ml-2 text-[10px] font-bold" style={{ color: '#ffd97a' }}>WINNER</span>}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold" style={{ color: p.color }}>
                        {p.chance.toFixed(1)}%
                      </div>
                      <div className="text-[11px]" style={{ color: '#9b94b8' }}>
                        {p.total.toLocaleString()} ⚜
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Provably fair footer */}
        {round && (
          <div
            className="rounded-2xl p-4 mt-6 text-[11px] font-mono flex flex-wrap items-center gap-x-4 gap-y-1"
            style={{ background: '#0d0b1a', border: '1px solid #1e1a30', color: '#6b6488' }}
          >
            <span className="flex items-center gap-1">
              <Shield size={12} /> round={round.id.slice(0, 6)}…{round.id.slice(-4)}
            </span>
            <span>hash={round.seedHash.slice(0, 10)}…</span>
            {round.rngSource && (
              <span>
                RNG: {round.rngSource === 'random_org_signed' ? 'random.org' : 'HMAC'}
              </span>
            )}
            {round.randomSerial && (
              <a
                href="https://api.random.org/signatures/form"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 hover:underline"
                style={{ color: '#9b94b8' }}
              >
                serial #{round.randomSerial} <ExternalLink size={10} />
              </a>
            )}
          </div>
        )}
        </>
        )}

        {/* Historique tab — past settled rounds */}
        {viewTab === 'history' && (
          <div className="rounded-2xl p-5" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
            <div className="flex items-center gap-2 mb-4">
              <Trophy size={16} style={{ color: '#6b6488' }} />
              <h2 className="text-[14px] font-bold tracking-wider uppercase" style={{ fontFamily: 'Cinzel, serif', color: '#e8e2f5' }}>
                Historique des jackpots
              </h2>
              <span className="ml-auto text-[11px]" style={{ color: '#6b6488' }}>{history.length} rounds</span>
            </div>
            {historyLoading ? (
              <div className="text-center py-8 text-[12px]" style={{ color: '#6b6488' }}>Chargement…</div>
            ) : history.length === 0 ? (
              <div className="text-center py-8 text-[12px]" style={{ color: '#6b6488' }}>Aucun round terminé pour l&apos;instant.</div>
            ) : (
              <div className="space-y-2">
                {history.map((r) => {
                  const winnerBets = r.bets.filter((b) => b.userId === r.winnerId);
                  const winnerTotal = winnerBets.reduce((acc, b) => acc + b.amount, 0);
                  const chance = r.potTotal > 0 ? (winnerTotal / r.potTotal) * 100 : 0;
                  const dateStr = r.settledAt ? new Date(r.settledAt).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
                  return (
                    <div
                      key={r.id}
                      className="rounded-lg p-3 flex items-center gap-3"
                      style={{
                        background: r.winnerId === userId ? 'rgba(255,197,66,0.08)' : 'rgba(255,255,255,0.02)',
                        border: r.winnerId === userId ? '1px solid rgba(255,197,66,0.3)' : '1px solid rgba(255,255,255,0.04)',
                      }}
                    >
                      {r.winner?.avatar ? (
                        <img
                          src={r.winner.avatar}
                          alt={r.winner.username}
                          className="w-9 h-9 rounded-full shrink-0"
                          style={{ border: '2px solid #ffd97a' }}
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: '#ffd97a', color: '#1a1010' }}>
                          {r.winner?.username?.slice(0, 2).toUpperCase() ?? '??'}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold truncate" style={{ color: '#ffd97a' }}>
                          {r.winner?.username ?? 'Unknown'}
                        </div>
                        <div className="text-[11px] truncate" style={{ color: '#6b6488' }}>
                          {r.participantCount} joueurs · chance {chance.toFixed(1)}% · {dateStr}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-bold" style={{ color: '#ffd97a' }}>
                          +{(r.netPayout ?? 0).toLocaleString()} ⚜
                        </div>
                        <div className="text-[10px] font-mono" style={{ color: '#6b6488' }}>
                          pot {r.potTotal.toLocaleString()}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
