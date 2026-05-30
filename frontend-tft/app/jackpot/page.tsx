'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { motion, AnimatePresence } from 'framer-motion';
import { signInWithSteam } from '@/lib/authHelpers';
import { apiClient, setAuthToken } from '@/lib/api';
import { connectSocket, getSocket } from '@/lib/socket';
import { parseCoinAmount } from '@/lib/utils';
import { Users, Clock, Trophy, ShieldCheck, ExternalLink, Copy, Check, X, Hexagon } from 'lucide-react';

/**
 * tft.money — Jackpot page.
 * Same backend as AgeOfMoney : GET /jackpot, POST /jackpot/bet,
 * /jackpot/history. Socket lobby room "jackpot:joinLobby" / "leaveLobby",
 * events :round:open / :bet:new / :round:closing / :round:spinning /
 * :round:settled / :round:cancelled.
 *
 * Skipped vs AoM : canvas-confetti reveal (not installed on tft.money,
 * not worth adding a dep for a celebratory effect). The reveal banner
 * + scale-in motion already telegraphs the win.
 */

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
const MAX_BET = 500;
const ROUND_DURATION_S = 90;

interface ParticipantAggregate {
  user: JackpotUser;
  total: number;
  chance: number;
  color: string;
  ticketFrom: number;
  ticketTo: number;
  bets: JackpotBet[];
}

function formatTicketRanges(bets: JackpotBet[], potTotal: number): string {
  if (bets.length === 0 || potTotal === 0) return '';
  const sorted = bets.slice().sort((a, b) => a.ticketFrom - b.ticketFrom);
  const merged: Array<{ from: number; to: number }> = [];
  for (const b of sorted) {
    const last = merged[merged.length - 1];
    if (last && last.to === b.ticketFrom) last.to = b.ticketTo;
    else merged.push({ from: b.ticketFrom, to: b.ticketTo });
  }
  return merged
    .map((r) => {
      const from = (r.from / potTotal) * 100;
      const to   = (r.to   / potTotal) * 100;
      return `${from.toFixed(2)}%–${to.toFixed(2)}%`;
    })
    .join(', ');
}

// Colour palette per-user — keeps the wheel readable even with 8+
// participants. Use TFT-friendly hues (saturated purple/cyan/rose/mint
// rotations) so the segments harmonise with the page.
function userColor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue}, 72%, 58%)`;
}

interface ParticipantsView {
  aggregates: ParticipantAggregate[];
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
      existing.bets.push(bet);
    } else {
      byUser.set(bet.userId, {
        user: bet.user, total: bet.amount, chance: 0, color,
        ticketFrom: bet.ticketFrom, ticketTo: bet.ticketTo,
        bets: [bet],
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

function useCountdown(closingAt: string | null | undefined): number | null {
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    if (!closingAt) { setRemaining(null); return; }
    const target = new Date(closingAt).getTime();
    const tick = () => setRemaining(Math.max(0, Math.ceil((target - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [closingAt]);
  return remaining;
}

function CircularTimer({ seconds, total = ROUND_DURATION_S }: { seconds: number | null; total?: number }) {
  if (seconds == null) return null;
  const R = 22;
  const C = 2 * Math.PI * R;
  const pct = Math.max(0, Math.min(1, seconds / total));
  const dashOffset = C * (1 - pct);
  const isUrgent = seconds <= 10;
  const color = isUrgent ? '#f87171' : '#a78bfa';
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
          cx="28" cy="28" r={R} fill="none"
          stroke={color} strokeWidth="3" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={dashOffset}
          transform="rotate(-90 28 28)"
          style={{ transition: 'stroke-dashoffset 0.25s linear, stroke 0.3s' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-sm font-bold" style={{ color }}>
        {seconds}
      </div>
    </motion.div>
  );
}

const WHEEL_SIZE = 380;
const WHEEL_OUTER_R = 178;
const WHEEL_INNER_R = 118;
const AVATAR_RADIUS = (WHEEL_OUTER_R + WHEEL_INNER_R) / 2;
const AVATAR_SIZE = 44;

function polarToCartesian(r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: r * Math.cos(rad), y: r * Math.sin(rad) };
}

function arcPath(startAngle: number, endAngle: number, rIn: number, rOut: number): string {
  const startO = polarToCartesian(rOut, startAngle);
  const endO   = polarToCartesian(rOut, endAngle);
  const startI = polarToCartesian(rIn,  startAngle);
  const endI   = polarToCartesian(rIn,  endAngle);
  const large  = endAngle - startAngle > 180 ? 1 : 0;
  return [
    `M ${startO.x} ${startO.y}`,
    `A ${rOut} ${rOut} 0 ${large} 1 ${endO.x} ${endO.y}`,
    `L ${endI.x} ${endI.y}`,
    `A ${rIn} ${rIn} 0 ${large} 0 ${startI.x} ${startI.y}`,
    'Z',
  ].join(' ');
}

function fullRingPath(rIn: number, rOut: number): string {
  return [
    `M ${rOut} 0`,
    `A ${rOut} ${rOut} 0 1 1 ${-rOut} 0`,
    `A ${rOut} ${rOut} 0 1 1 ${rOut} 0`,
    'Z',
    `M ${rIn} 0`,
    `A ${rIn} ${rIn} 0 1 0 ${-rIn} 0`,
    `A ${rIn} ${rIn} 0 1 0 ${rIn} 0`,
    'Z',
  ].join(' ');
}

interface WheelSegment {
  key: string; userId: string; username: string; avatar: string | null;
  color: string;
  startAngle: number; endAngle: number;
  avatarX: number; avatarY: number; shareDeg: number;
}

function JackpotWheel({
  segments, potTotal, winningTicket, isSpinning, roundId,
}: {
  segments: WheelSegment[];
  potTotal: number;
  winningTicket: number | null | undefined;
  isSpinning: boolean;
  roundId: string | null;
}) {
  const targetRotation = useMemo(() => {
    if (winningTicket == null) return 0;
    const winningAngle = (winningTicket / 10000) * 360;
    return -winningAngle - 5 * 360;
  }, [winningTicket]);

  const cx = WHEEL_SIZE / 2;
  const cy = WHEEL_SIZE / 2;

  return (
    <div className="relative mx-auto" style={{ width: '100%', maxWidth: WHEEL_SIZE, aspectRatio: '1' }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${WHEEL_SIZE} ${WHEEL_SIZE}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          <filter id="wheel-gold-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g transform={`translate(${cx}, ${cy})`}>
          <motion.g
            key={roundId ?? 'idle'}
            initial={{ rotate: 0 }}
            animate={{ rotate: targetRotation }}
            transition={{
              duration: isSpinning ? 5 : winningTicket != null ? 0.8 : 0,
              ease: isSpinning ? [0.12, 0.8, 0.3, 1] : [0.22, 1, 0.36, 1],
            }}
            style={{ transformOrigin: '0px 0px' }}
          >
            {segments.length === 0 ? (
              <circle r={(WHEEL_INNER_R + WHEEL_OUTER_R) / 2} fill="none"
                stroke="rgba(255,255,255,0.04)" strokeWidth={WHEEL_OUTER_R - WHEEL_INNER_R}
                strokeDasharray="4 6" />
            ) : segments.length === 1 ? (
              <path d={fullRingPath(WHEEL_INNER_R, WHEEL_OUTER_R)}
                fill={segments[0].color} fillRule="evenodd" stroke="#08081a" strokeWidth="1" />
            ) : (
              segments.map((s) => (
                <path key={s.key} d={arcPath(s.startAngle, s.endAngle, WHEEL_INNER_R, WHEEL_OUTER_R)}
                  fill={s.color} stroke="#08081a" strokeWidth="1" />
              ))
            )}

            {segments.map((s) => {
              if (s.shareDeg < 14) return null;
              return (
                <g key={'av-' + s.key} transform={`translate(${s.avatarX}, ${s.avatarY})`}>
                  <defs>
                    <clipPath id={`clip-${s.key}`}>
                      <circle r={AVATAR_SIZE / 2} />
                    </clipPath>
                  </defs>
                  <circle r={AVATAR_SIZE / 2 + 2} fill="#08081a" stroke={s.color} strokeWidth="2" />
                  {s.avatar ? (
                    <image href={s.avatar}
                      x={-AVATAR_SIZE / 2} y={-AVATAR_SIZE / 2}
                      width={AVATAR_SIZE} height={AVATAR_SIZE}
                      clipPath={`url(#clip-${s.key})`} />
                  ) : (
                    <text textAnchor="middle" dominantBaseline="central"
                      fontSize="11" fontWeight="bold" fill="#1a1010">
                      {s.username.slice(0, 2).toUpperCase()}
                    </text>
                  )}
                </g>
              );
            })}
          </motion.g>

          {/* Centre disk */}
          <circle r={WHEEL_INNER_R - 4} fill="#0b0820" stroke="rgba(251,191,36,0.18)" strokeWidth="1" />
          <text textAnchor="middle" dominantBaseline="central" y={-6}
            fontSize={segments.length === 0 ? 20 : 26} fontWeight="bold"
            fill="#fcd34d" style={{ fontFamily: 'var(--font-cormorant), Georgia, serif' }}
            filter="url(#wheel-gold-glow)">
            {potTotal.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ⚜
          </text>
          <text textAnchor="middle" dominantBaseline="central" y={18}
            fontSize="9" fill="#64748b" style={{ letterSpacing: '2px' }}>
            POT TOTAL
          </text>
        </g>
      </svg>

      {/* Fixed top pointer */}
      <div className="absolute pointer-events-none"
        style={{
          top: 0, left: '50%', transform: 'translateX(-50%)',
          width: 0, height: 0,
          borderLeft: '10px solid transparent', borderRight: '10px solid transparent',
          borderTop: '16px solid #fcd34d',
          filter: 'drop-shadow(0 0 8px rgba(251,191,36,0.9))', zIndex: 3,
        }} />
      <div className="absolute pointer-events-none rounded-full"
        style={{
          top: 14, left: '50%', transform: 'translateX(-50%)',
          width: 8, height: 8, background: '#fcd34d',
          boxShadow: '0 0 12px rgba(251,191,36,0.9)',
        }} />
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
  const [reveal, setReveal] = useState<{
    winner: JackpotUser; netPayout: number; rngSource: string;
    winningTicket: number; potTotal: number; chance: number;
  } | null>(null);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [viewTab, setViewTab] = useState<'live' | 'history'>('live');
  const [history, setHistory] = useState<JackpotRound[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [showFairness, setShowFairness] = useState(false);
  const [fairnessRound, setFairnessRound] = useState<JackpotRound | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  function openFairness(r: JackpotRound) {
    setFairnessRound(r);
    setShowFairness(true);
  }

  function copyToClipboard(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  const countdown = useCountdown(round?.closingAt ?? null);

  useEffect(() => {
    const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;
    setAuthToken(token ?? null);
  }, [session]);

  const fetchRound = useCallback(async () => {
    try {
      const res = await apiClient.get('/jackpot');
      setRound(res.data.data ?? null);
    } catch { /* silent — socket will catch up */ }
  }, []);

  useEffect(() => { fetchRound(); }, [fetchRound]);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await apiClient.get('/jackpot/history?limit=50');
      setHistory(res.data.data ?? []);
    } catch { /* silent */ }
    finally { setHistoryLoading(false); }
  }, []);

  useEffect(() => { if (viewTab === 'history') fetchHistory(); }, [viewTab, fetchHistory]);

  useEffect(() => {
    connectSocket(session?.user.accessToken);
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
      roundId: string; winningTicket: number; winnerId: string; winner: JackpotUser;
      potTotal: number; netPayout: number; rake: number; rngSource: string;
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
      if (revealTimer.current) clearTimeout(revealTimer.current);
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
          return prev;
        });
      }, 3800);
    });

    s.on('jackpot:round:settled', (data: JackpotRound) => setRound(data));

    s.on('jackpot:round:cancelled', (data: { roundId: string; reason: string }) => {
      setRound((prev) => prev && prev.id === data.roundId ? { ...prev, status: 'CANCELLED' } : prev);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function showMsg(type: 'success' | 'error', text: string) {
    setMsg({ type, text }); setTimeout(() => setMsg(null), 3000);
  }

  async function handleBet() {
    if (!session) { signInWithSteam(); return; }
    const amount = parseCoinAmount(betAmount);
    if (!amount || amount < MIN_BET) { showMsg('error', `Minimum ${MIN_BET} ⚜`); return; }
    if (amount > MAX_BET)            { showMsg('error', `Maximum ${MAX_BET} ⚜`); return; }
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

  const view = round
    ? buildParticipantsView(round.bets, round.potTotal)
    : { aggregates: [], segments: [] };
  const myAggregate = view.aggregates.find((p) => p.user.id === userId);
  const myChance = myAggregate?.chance ?? 0;

  const isLive = round && ['OPEN', 'CLOSING', 'SPINNING'].includes(round.status);
  const canBet = round && (round.status === 'OPEN' || round.status === 'CLOSING');
  const isSpinning = round?.status === 'SPINNING';

  const wheelSegments: WheelSegment[] = useMemo(() => {
    if (!round || round.potTotal === 0) return [];
    const firstBetAtByUser = new Map<string, number>();
    for (const b of round.bets) {
      const t = new Date(b.createdAt).getTime();
      const prev = firstBetAtByUser.get(b.userId);
      if (prev == null || t < prev) firstBetAtByUser.set(b.userId, t);
    }
    const byUser = new Map<string, { user: JackpotUser; total: number; color: string }>();
    for (const b of round.bets) {
      const existing = byUser.get(b.userId);
      if (existing) existing.total += b.amount;
      else byUser.set(b.userId, { user: b.user, total: b.amount, color: userColor(b.userId) });
    }
    const users = Array.from(byUser.values()).sort((a, b) => {
      const ta = firstBetAtByUser.get(a.user.id) ?? 0;
      const tb = firstBetAtByUser.get(b.user.id) ?? 0;
      return ta - tb;
    });
    let cursor = 0;
    return users.map((u) => {
      const share = u.total / round.potTotal;
      const startAngle = cursor * 360;
      const endAngle = (cursor + share) * 360;
      cursor += share;
      const midAngle = (startAngle + endAngle) / 2;
      const pos = polarToCartesian(AVATAR_RADIUS, midAngle);
      return {
        key: u.user.id,
        userId: u.user.id,
        username: u.user.username,
        avatar: u.user.avatar,
        color: u.color,
        startAngle, endAngle,
        avatarX: pos.x, avatarY: pos.y,
        shareDeg: endAngle - startAngle,
      };
    });
  }, [round]);

  return (
    <div className="min-h-screen bg-tft-bg text-tft-text">
      <div className="max-w-5xl mx-auto px-3 sm:px-4 py-4 sm:py-8">

        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md border border-tft-purple/40 bg-tft-purple/10 mb-3">
            <Hexagon size={11} className="text-tft-cyan-bright" />
            <span className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-purple-bright">
              TFT.money · Jackpot
            </span>
          </div>
          <div className="flex items-center justify-center gap-2 sm:gap-3 mb-1">
            <Trophy className="w-6 h-6 sm:w-7 sm:h-7 text-tft-gold-bright" />
            <h1 className="text-2xl sm:text-3xl font-bold font-display text-tft-purple-bright">JACKPOT</h1>
          </div>
          <p className="text-[11px] tracking-widest uppercase text-tft-text-muted">
            Le winner remporte tout · Provably fair
          </p>

          <div className="flex items-center justify-center gap-1 mt-4">
            <button onClick={() => setViewTab('live')}
              className={`px-4 py-1.5 rounded-md text-[11px] font-bold tracking-wider uppercase transition-all ${
                viewTab === 'live'
                  ? 'bg-tft-purple/15 text-tft-purple-bright border border-tft-purple/30'
                  : 'bg-transparent text-tft-text-muted border border-transparent'
              }`}>
              <Users size={12} className="inline mr-1.5" />
              En direct
            </button>
            <button onClick={() => setViewTab('history')}
              className={`px-4 py-1.5 rounded-md text-[11px] font-bold tracking-wider uppercase transition-all ${
                viewTab === 'history'
                  ? 'bg-tft-purple/15 text-tft-purple-bright border border-tft-purple/30'
                  : 'bg-transparent text-tft-text-muted border border-transparent'
              }`}>
              <Trophy size={12} className="inline mr-1.5" />
              Historique
            </button>
          </div>
        </div>

        {msg && (
          <div className="mb-4 px-4 py-2 rounded-md text-sm text-center"
            style={{
              background: msg.type === 'success' ? 'rgba(52,211,153,0.1)' : 'rgba(239,68,68,0.1)',
              border: `1px solid ${msg.type === 'success' ? 'rgba(52,211,153,0.3)' : 'rgba(239,68,68,0.3)'}`,
              color: msg.type === 'success' ? '#34d399' : '#ef4444',
            }}>
            {msg.text}
          </div>
        )}

        {viewTab === 'live' && (<>
        {/* Wheel card */}
        <div className="rounded-md p-6 mb-6 relative bg-tft-bg-card"
          style={{
            background: 'linear-gradient(135deg, #101028 0%, #161640 100%)',
            border: '1px solid rgba(251,191,36,0.25)',
            boxShadow: '0 0 40px rgba(124,58,237,0.12)',
          }}>
          {round && (
            <button onClick={() => openFairness(round)}
              className="absolute top-3 right-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase hover:opacity-80 transition-opacity z-10 bg-tft-bg-elevated border border-tft-border-mid text-tft-text-dim">
              <ShieldCheck size={11} className="text-tft-mint" />
              Provably Fair
            </button>
          )}

          {/* Status row */}
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              {countdown != null && round?.status === 'CLOSING' ? (
                <CircularTimer seconds={countdown} />
              ) : (
                <div className="w-14 h-14 rounded-full flex items-center justify-center text-tft-text-faint"
                  style={{ border: '2px solid rgba(255,255,255,0.05)' }}>
                  <Clock size={20} />
                </div>
              )}
              <div className="text-[12px] text-tft-text-dim">
                <div className="flex items-center gap-1.5">
                  <Users size={13} />
                  {round?.participantCount ?? 0} {round?.participantCount === 1 ? 'joueur' : 'joueurs'}
                </div>
                <div className="text-[10px] tracking-wider uppercase mt-0.5 text-tft-text-muted">
                  {round?.status === 'OPEN' && (round.participantCount < 2
                    ? 'En attente d’un 2ᵉ joueur…'
                    : 'Ouvert aux paris'
                  )}
                  {round?.status === 'CLOSING' && 'Timer en cours'}
                  {isSpinning && <span className="text-tft-gold-bright">Tirage…</span>}
                  {round?.status === 'COMPLETED' && <span className="text-tft-mint">Round terminé</span>}
                </div>
              </div>
            </div>

            {userId && myAggregate && round && round.potTotal > 0 && (
              <div className="text-right">
                <div className="text-[10px] tracking-[0.2em] uppercase text-tft-text-muted">Votre chance</div>
                <div className="text-xl font-bold" style={{ color: myAggregate.color }}>
                  {myChance.toFixed(1)}%
                </div>
                <div className="text-[11px] text-tft-text-dim">
                  {myAggregate.total.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ⚜ misés
                </div>
              </div>
            )}
          </div>

          <JackpotWheel
            segments={wheelSegments}
            potTotal={round?.potTotal ?? 0}
            winningTicket={round?.winningTicket ?? null}
            isSpinning={isSpinning ?? false}
            roundId={round?.id ?? null}
          />

          {round && round.winningTicket != null && (
            <div className="text-center mt-3 text-[10px] font-mono text-tft-gold-bright">
              tirage · {(round.winningTicket / 100).toFixed(2)}%
            </div>
          )}
        </div>

        {/* Winner reveal */}
        <AnimatePresence>
          {reveal && (
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.95 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="rounded-md p-6 mb-6 text-center"
              style={{
                background: 'linear-gradient(135deg, rgba(251,191,36,0.18) 0%, rgba(252,211,77,0.08) 100%)',
                border: '1px solid rgba(251,191,36,0.5)',
                boxShadow: '0 0 40px rgba(251,191,36,0.25)',
              }}
            >
              <div className="text-[10px] tracking-[0.3em] uppercase mb-3 text-tft-gold-bright">Winner</div>
              <div className="flex items-center justify-center gap-3 mb-3">
                {reveal.winner.avatar ? (
                  <img src={reveal.winner.avatar} alt={reveal.winner.username}
                    className="w-14 h-14 rounded-full"
                    style={{ border: '2px solid #fcd34d', boxShadow: '0 0 16px rgba(251,191,36,0.5)' }} />
                ) : null}
                <div className="text-2xl font-bold font-display text-tft-gold-bright">{reveal.winner.username}</div>
              </div>
              <div className="text-2xl font-bold mb-1 text-tft-text">
                +{reveal.netPayout.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ⚜
              </div>
              <div className="text-[11px] text-tft-text-dim">
                chance {reveal.chance.toFixed(2)}% · tiré à {(reveal.winningTicket / 100).toFixed(2)}%
              </div>
              <div className="text-[10px] mt-1 text-tft-text-muted">
                RNG : {reveal.rngSource === 'random_org_signed' ? 'Random.org Signed API' : 'HMAC fallback'}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bet input — guarded behind Steam auth */}
        {!session ? (
          <div className="rounded-md p-6 mb-6 bg-tft-bg-card border border-tft-border text-center">
            <p className="text-[13px] text-tft-text-dim mb-3">Connexion Steam requise pour miser.</p>
            <button onClick={() => signInWithSteam()}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-md font-ui font-semibold text-[12px] tracking-[0.18em] uppercase text-white bg-tft-purple hover:bg-tft-purple-bright transition-colors">
              Se connecter avec Steam
            </button>
          </div>
        ) : (
        <div className="rounded-md p-6 mb-6 bg-tft-bg-card border border-tft-border">
          <div className="text-[11px] tracking-wider uppercase mb-3 text-tft-text-dim">
            Placez votre mise ({MIN_BET} – {MAX_BET} ⚜)
          </div>
          <div className="flex items-start gap-3 flex-wrap">
            <input
              type="number" step="0.01" inputMode="decimal"
              min={MIN_BET} max={MAX_BET}
              value={betAmount}
              onChange={(e) => setBetAmount(e.target.value)}
              className="flex-1 min-w-[140px] px-3 py-2.5 rounded-md text-[13px] outline-none bg-tft-bg-elevated border border-tft-border text-tft-text [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              placeholder={`${MIN_BET} – ${MAX_BET}`}
              disabled={!canBet || placing}
            />
            <div className="grid grid-cols-2 gap-1.5" style={{ width: 120 }}>
              {[
                { label: '1',   value: 1 },
                { label: '2',   value: 2 },
                { label: '5',   value: 5 },
                { label: '10',  value: 10 },
                { label: '20',  value: 20 },
                { label: 'MAX', value: MAX_BET },
              ].map((preset) => (
                <button key={preset.label}
                  onClick={() => setBetAmount(String(preset.value))}
                  disabled={!canBet || placing}
                  className="px-2 py-1 rounded-md text-[11px] font-bold tracking-wider uppercase transition-opacity hover:opacity-80 disabled:opacity-40 bg-tft-bg-elevated border border-tft-purple/25 text-tft-purple-bright">
                  {preset.label}
                </button>
              ))}
            </div>
            <button onClick={handleBet} disabled={!canBet || placing}
              className="font-bold rounded-md px-4 py-2.5"
              style={{
                background: canBet
                  ? 'linear-gradient(135deg, #fcd34d 0%, #fbbf24 100%)'
                  : 'rgba(251,191,36,0.2)',
                color: canBet ? '#1a1010' : '#64748b',
                border: 'none', minWidth: 140,
              }}>
              {placing ? '...' : 'MISER'}
            </button>
          </div>
          {!canBet && isLive && (
            <div className="mt-2 text-[11px] text-tft-text-muted">Les paris sont fermés pour ce round.</div>
          )}
        </div>
        )}

        {/* Participants list */}
        <div className="rounded-md p-6 bg-tft-bg-card border border-tft-border">
          <div className="text-[11px] tracking-wider uppercase mb-3 flex items-center justify-between text-tft-text-dim">
            <span>Participants</span>
            <span>{view.aggregates.length}</span>
          </div>
          {view.aggregates.length === 0 ? (
            <div className="text-center py-8 text-sm text-tft-text-muted">
              Personne n&apos;a encore misé. Soyez le premier !
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {view.aggregates.map((p) => {
                const isWinner = round?.status === 'COMPLETED' && round.winnerId === p.user.id;
                return (
                  <div key={p.user.id}
                    className="rounded-md p-3 flex items-center gap-3"
                    style={{
                      background: p.user.id === userId ? 'rgba(251,191,36,0.08)' : 'rgba(255,255,255,0.02)',
                      border: isWinner
                        ? '1px solid rgba(251,191,36,0.6)'
                        : p.user.id === userId
                          ? '1px solid rgba(251,191,36,0.3)'
                          : '1px solid rgba(255,255,255,0.04)',
                    }}>
                    {p.user.avatar ? (
                      <img src={p.user.avatar} alt={p.user.username} className="w-9 h-9 rounded-full"
                        style={{ border: `2px solid ${p.color}` }} />
                    ) : (
                      <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold"
                        style={{ background: p.color, color: '#1a1010' }}>
                        {p.user.username.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold truncate text-tft-text">
                        {p.user.username}
                        {isWinner && <span className="ml-2 text-[10px] font-bold text-tft-gold-bright">WINNER</span>}
                      </div>
                      <div className="text-[10px] font-mono mt-0.5 truncate text-tft-text-muted">
                        {formatTicketRanges(p.bets, round?.potTotal ?? 0)}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold" style={{ color: p.color }}>{p.chance.toFixed(1)}%</div>
                      <div className="text-[11px] text-tft-text-dim">
                        {p.total.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ⚜
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        </>)}

        {/* Provably Fair modal */}
        {showFairness && fairnessRound && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center px-4"
            style={{ background: 'rgba(8,8,26,0.85)', backdropFilter: 'blur(6px)' }}
            onClick={() => setShowFairness(false)}>
            <div className="w-full max-w-lg rounded-md overflow-hidden max-h-[90vh] overflow-y-auto bg-tft-bg-card border border-tft-border"
              style={{ boxShadow: '0 0 60px rgba(124,58,237,0.15)' }}
              onClick={(e) => e.stopPropagation()}>

              <div className="flex items-center justify-between px-6 py-4 border-b border-tft-border">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={16} className="text-tft-mint" />
                  <span className="font-bold text-[14px] tracking-widest font-display text-tft-text">PROVABLY FAIR</span>
                </div>
                <button onClick={() => setShowFairness(false)} className="hover:opacity-60 transition-opacity">
                  <X size={16} className="text-tft-text-muted" />
                </button>
              </div>

              <div className="px-6 py-4 text-[12px] leading-relaxed space-y-2 border-b border-tft-border text-tft-text-dim">
                <p>
                  À l&apos;ouverture du round, on publie <span className="text-tft-mint">seedHash = SHA256(serverSeed)</span> —
                  un engagement cryptographique pour que le serverSeed ne puisse pas être modifié ensuite.
                </p>
                <p>
                  À la clôture, <span className="text-tft-mint">Random.org</span> tire un nombre dans [0, 9999] (= %). Le résultat
                  est signé RSA-SHA512 par leurs serveurs et la signature est vérifiable publiquement sur{' '}
                  <a href="https://api.random.org/signatures/form" target="_blank" rel="noopener noreferrer"
                    className="underline hover:opacity-80 transition-opacity text-tft-mint">
                    api.random.org/signatures/form
                  </a>.
                </p>
                <p>
                  Si Random.org est injoignable, on bascule sur un fallback <span className="text-tft-mint">HMAC-SHA256(serverSeed, clientSeed + &quot;:&quot; + nonce)</span>
                  — le serverSeed révélé à la fin permet à n&apos;importe qui de recalculer le tirage.
                </p>
              </div>

              <div className="px-6 pt-4 pb-0 flex items-center gap-2">
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold"
                  style={{
                    background: fairnessRound.rngSource === 'random_org_signed' ? 'rgba(52,211,153,0.1)'
                      : fairnessRound.rngSource === 'hmac_fallback' ? 'rgba(124,58,237,0.1)' : 'rgba(100,116,139,0.1)',
                    border: `1px solid ${fairnessRound.rngSource === 'random_org_signed' ? '#34d39940'
                      : fairnessRound.rngSource === 'hmac_fallback' ? '#7c3aed40' : '#64748b40'}`,
                    color: fairnessRound.rngSource === 'random_org_signed' ? '#34d399'
                      : fairnessRound.rngSource === 'hmac_fallback' ? '#a78bfa' : '#64748b',
                  }}>
                  {fairnessRound.rngSource === 'random_org_signed' ? '✓ random.org Signed API'
                    : fairnessRound.rngSource === 'hmac_fallback' ? '✓ HMAC fallback'
                    : 'tirage en attente'}
                </div>
                <span className="text-[10px] text-tft-text-muted">statut : {fairnessRound.status}</span>
              </div>

              <div className="px-6 py-4 space-y-3">
                {(() => {
                  const rows: Array<{ label: string; value: string; key: string }> = [
                    { label: 'Round ID',          value: fairnessRound.id,                       key: 'id' },
                    { label: 'Nonce',             value: String(fairnessRound.nonce),            key: 'nonce' },
                    { label: 'Seed Hash (commit)',value: fairnessRound.seedHash,                 key: 'hash' },
                    { label: 'Client Seed',       value: fairnessRound.clientSeed,               key: 'clientSeed' },
                  ];
                  if (fairnessRound.serverSeed) rows.push({ label: 'Server Seed (reveal)', value: fairnessRound.serverSeed, key: 'serverSeed' });
                  if (fairnessRound.winningTicket != null) rows.push({
                    label: 'Winning Ticket',
                    value: `${fairnessRound.winningTicket} / 9999 (= ${(fairnessRound.winningTicket / 100).toFixed(2)}%)`,
                    key: 'winning',
                  });
                  if (fairnessRound.randomSerial) rows.push({ label: 'Random.org Serial', value: String(fairnessRound.randomSerial), key: 'serial' });
                  if (fairnessRound.randomSignature) rows.push({ label: 'Signature', value: fairnessRound.randomSignature, key: 'sig' });
                  if (fairnessRound.randomJson) rows.push({ label: 'Random JSON', value: fairnessRound.randomJson, key: 'json' });
                  return rows.map(({ label, value, key }) => (
                    <div key={key} className="flex items-start justify-between gap-3">
                      <span className="text-[11px] shrink-0 mt-0.5 text-tft-text-muted" style={{ minWidth: 110 }}>{label}:</span>
                      <div className="flex items-center gap-2 flex-1 min-w-0 px-3 py-2 rounded-md bg-tft-bg-elevated border border-tft-border">
                        <span className="flex-1 text-[11px] font-mono break-all text-tft-text-dim">
                          {value || <span className="text-tft-text-faint">—</span>}
                        </span>
                        {value && (
                          <button onClick={() => copyToClipboard(value, key)} className="shrink-0 hover:opacity-70 transition-opacity" aria-label="copy">
                            {copied === key
                              ? <Check size={12} className="text-tft-mint" />
                              : <Copy size={12} className="text-tft-text-faint" />}
                          </button>
                        )}
                      </div>
                    </div>
                  ));
                })()}
              </div>

              {fairnessRound.rngSource === 'random_org_signed' && fairnessRound.randomSignature && (
                <div className="mx-6 mb-5 rounded-md p-4 bg-tft-bg-elevated border border-tft-border">
                  <p className="text-[10px] mb-2 text-tft-text-muted">Vérifiez ce résultat sur random.org :</p>
                  <a href="https://api.random.org/signatures/form" target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 text-[11px] font-bold hover:opacity-80 transition-opacity text-tft-mint">
                    <ShieldCheck size={12} /> api.random.org/signatures/form <ExternalLink size={10} />
                  </a>
                  <p className="text-[10px] mt-2 text-tft-text-faint">
                    Collez la <b>Signature</b> et le <b>Random JSON</b> pour vérifier l&apos;authenticité.
                  </p>
                </div>
              )}
              {fairnessRound.rngSource === 'hmac_fallback' && (
                <div className="mx-6 mb-5 rounded-md p-4 bg-tft-bg-elevated border border-tft-border">
                  <p className="text-[10px] font-mono text-tft-text-muted">
                    winningTicket = HMAC_SHA256(serverSeed, clientSeed + &quot;:&quot; + nonce).hex
                    <br />→ rejection-sampled to [0, 9999]
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* History tab */}
        {viewTab === 'history' && (
          <div className="rounded-md p-5 bg-tft-bg-card border border-tft-border">
            <div className="flex items-center gap-2 mb-4">
              <Trophy size={16} className="text-tft-text-muted" />
              <h2 className="text-[14px] font-bold tracking-wider uppercase font-display text-tft-text">Historique des jackpots</h2>
              <span className="ml-auto text-[11px] text-tft-text-muted">{history.length} rounds</span>
            </div>
            {historyLoading ? (
              <div className="text-center py-8 text-[12px] text-tft-text-muted">Chargement…</div>
            ) : history.length === 0 ? (
              <div className="text-center py-8 text-[12px] text-tft-text-muted">Aucun round terminé pour l&apos;instant.</div>
            ) : (
              <div className="space-y-2">
                {history.map((r) => {
                  const winnerBets = r.bets.filter((b) => b.userId === r.winnerId);
                  const winnerTotal = winnerBets.reduce((acc, b) => acc + b.amount, 0);
                  const chance = r.potTotal > 0 ? (winnerTotal / r.potTotal) * 100 : 0;
                  const dateStr = r.settledAt ? new Date(r.settledAt).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
                  return (
                    <div key={r.id} className="rounded-md p-3 flex items-center gap-3"
                      style={{
                        background: r.winnerId === userId ? 'rgba(251,191,36,0.08)' : 'rgba(255,255,255,0.02)',
                        border: r.winnerId === userId ? '1px solid rgba(251,191,36,0.3)' : '1px solid rgba(255,255,255,0.04)',
                      }}>
                      {r.winner?.avatar ? (
                        <img src={r.winner.avatar} alt={r.winner.username}
                          className="w-9 h-9 rounded-full shrink-0"
                          style={{ border: '2px solid #fcd34d' }} />
                      ) : (
                        <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                          style={{ background: '#fcd34d', color: '#1a1010' }}>
                          {r.winner?.username?.slice(0, 2).toUpperCase() ?? '??'}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold truncate text-tft-gold-bright">{r.winner?.username ?? 'Unknown'}</div>
                        <div className="text-[11px] truncate text-tft-text-muted">
                          {r.participantCount} joueurs · chance {chance.toFixed(1)}% · {dateStr}
                        </div>
                      </div>
                      <div className="text-right shrink-0 flex flex-col items-end gap-1">
                        <div className="text-sm font-bold text-tft-gold-bright">
                          +{(r.netPayout ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ⚜
                        </div>
                        <div className="text-[10px] font-mono text-tft-text-muted">
                          pot {r.potTotal.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                        </div>
                        <button onClick={() => openFairness(r)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold tracking-wider uppercase hover:opacity-80 transition-opacity bg-tft-bg-elevated border border-tft-border-mid text-tft-text-dim">
                          <ShieldCheck size={9} className="text-tft-mint" />
                          Fair
                        </button>
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
