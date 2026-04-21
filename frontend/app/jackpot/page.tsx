'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useSession, signIn } from 'next-auth/react';
import { apiClient, setAuthToken } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Crown, Users, Clock, Trophy, Shield, ExternalLink } from 'lucide-react';

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
  serverSeed?: string | null;  // revealed only on COMPLETED / CANCELLED
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

/**
 * Per-player aggregate: total wagered + cumulative chance. Stable colour per
 * user based on a hash of their id so the bars & avatar rings match across
 * the participant list and (future) wheel.
 */
interface ParticipantAggregate {
  user: JackpotUser;
  total: number;
  chance: number;  // 0..100
  color: string;
  bets: JackpotBet[];
}

function userColor(userId: string): string {
  // Deterministic hue from the user id. 20 buckets → distinguishable colours.
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue}, 70%, 55%)`;
}

function aggregateByUser(bets: JackpotBet[], potTotal: number): ParticipantAggregate[] {
  const byUser = new Map<string, ParticipantAggregate>();
  for (const bet of bets) {
    const existing = byUser.get(bet.userId);
    if (existing) {
      existing.total += bet.amount;
      existing.bets.push(bet);
    } else {
      byUser.set(bet.userId, {
        user: bet.user,
        total: bet.amount,
        chance: 0,
        color: userColor(bet.userId),
        bets: [bet],
      });
    }
  }
  const list = Array.from(byUser.values());
  for (const p of list) p.chance = potTotal > 0 ? (p.total / potTotal) * 100 : 0;
  // Biggest bet first — whales up top
  list.sort((a, b) => b.total - a.total);
  return list;
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

export default function JackpotPage() {
  const { data: session } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id;

  const [round, setRound] = useState<JackpotRound | null>(null);
  const [betAmount, setBetAmount] = useState('10');
  const [placing, setPlacing] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [reveal, setReveal] = useState<{ winner: JackpotUser; netPayout: number; rngSource: string } | null>(null);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const countdown = useCountdown(round?.closingAt ?? null);

  // Sync the apiClient JWT so POST /jackpot/bet carries the Bearer token.
  // Every authenticated page in this app does this — pattern is to set on
  // session change (token rotates on refresh).
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

  // Socket setup: join lobby, subscribe to all round events
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
        // Avoid dupes if the bet already arrived via placeBet response
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
      // Show reveal banner after a short delay (future commit: wheel animation)
      if (revealTimer.current) clearTimeout(revealTimer.current);
      revealTimer.current = setTimeout(() => {
        setReveal({ winner: data.winner, netPayout: data.netPayout, rngSource: data.rngSource });
      }, 1500);
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
    if (!amount || amount < MIN_BET) {
      showMsg('error', `Minimum ${MIN_BET} ⚜`);
      return;
    }
    if (amount > MAX_BET) {
      showMsg('error', `Maximum ${MAX_BET} ⚜`);
      return;
    }
    setPlacing(true);
    try {
      await apiClient.post('/jackpot/bet', { amount });
      // Socket event will refresh the pot/bets
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      showMsg('error', err?.response?.data?.error ?? err?.message ?? 'Erreur');
    } finally {
      setPlacing(false);
    }
  }

  const participants = round ? aggregateByUser(round.bets, round.potTotal) : [];
  const myAggregate = participants.find((p) => p.user.id === userId);
  const myChance = myAggregate?.chance ?? 0;

  const isLive = round && ['OPEN', 'CLOSING', 'SPINNING'].includes(round.status);
  const canBet = round && (round.status === 'OPEN' || round.status === 'CLOSING');

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

        {/* Pot + timer + status */}
        <div
          className="rounded-2xl p-8 mb-6 text-center"
          style={{
            background: 'linear-gradient(135deg, #0d0b1a 0%, #110e24 100%)',
            border: '1px solid rgba(255,197,66,0.25)',
            boxShadow: '0 0 40px rgba(255,197,66,0.08)',
          }}
        >
          <div className="text-[10px] tracking-[0.3em] uppercase mb-2" style={{ color: '#6b6488' }}>
            Total pot
          </div>
          <div
            className="text-6xl font-bold mb-3"
            style={{ fontFamily: 'Cinzel, serif', color: '#ffd97a', textShadow: '0 0 24px rgba(255,197,66,0.3)' }}
          >
            {round?.potTotal.toLocaleString() ?? 0} ⚜
          </div>

          {/* Status line */}
          <div className="flex items-center justify-center gap-4 text-[12px]" style={{ color: '#9b94b8' }}>
            <span className="flex items-center gap-1.5">
              <Users size={14} />
              {round?.participantCount ?? 0} {round?.participantCount === 1 ? 'participant' : 'participants'}
            </span>

            {countdown != null && round?.status === 'CLOSING' && (
              <span
                className="flex items-center gap-1.5 font-bold"
                style={{ color: countdown <= 10 ? '#f87171' : '#ffd97a' }}
              >
                <Clock size={14} />
                {countdown}s
              </span>
            )}

            {round?.status === 'OPEN' && round.participantCount < 2 && (
              <span className="flex items-center gap-1.5" style={{ color: '#6b6488' }}>
                En attente d&apos;un 2ᵉ joueur…
              </span>
            )}

            {round?.status === 'SPINNING' && (
              <span className="flex items-center gap-1.5 font-bold" style={{ color: '#ffd97a' }}>
                Tirage en cours…
              </span>
            )}
          </div>

          {/* My chance (connected user) */}
          {userId && myAggregate && round && round.potTotal > 0 && (
            <div className="mt-4 text-[12px]" style={{ color: '#9b94b8' }}>
              Votre chance :{' '}
              <span className="font-bold" style={{ color: myAggregate.color }}>
                {myChance.toFixed(1)}%
              </span>{' '}
              ({myAggregate.total.toLocaleString()} ⚜ misés)
            </div>
          )}
        </div>

        {/* Winner reveal banner */}
        {reveal && (
          <div
            className="rounded-2xl p-6 mb-6 text-center"
            style={{
              background: 'linear-gradient(135deg, rgba(255,197,66,0.15) 0%, rgba(255,217,122,0.08) 100%)',
              border: '1px solid rgba(255,197,66,0.5)',
              boxShadow: '0 0 32px rgba(255,197,66,0.2)',
            }}
          >
            <div className="text-[10px] tracking-[0.3em] uppercase mb-2" style={{ color: '#ffd97a' }}>
              Winner
            </div>
            <div className="flex items-center justify-center gap-3 mb-2">
              {reveal.winner.avatar && (
                <img
                  src={reveal.winner.avatar}
                  alt={reveal.winner.username}
                  className="w-12 h-12 rounded-full"
                  style={{ border: '2px solid #ffd97a' }}
                />
              )}
              <div
                className="text-2xl font-bold"
                style={{ fontFamily: 'Cinzel, serif', color: '#ffd97a' }}
              >
                {reveal.winner.username}
              </div>
            </div>
            <div className="text-xl font-bold" style={{ color: '#e8e2f5' }}>
              +{reveal.netPayout.toLocaleString()} ⚜
            </div>
            <div className="text-[10px] mt-1" style={{ color: '#6b6488' }}>
              RNG : {reveal.rngSource === 'random_org_signed' ? 'Random.org Signed API' : 'HMAC fallback'}
            </div>
          </div>
        )}

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

        {/* Participants list */}
        <div
          className="rounded-2xl p-6"
          style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}
        >
          <div className="text-[11px] tracking-wider uppercase mb-3 flex items-center justify-between" style={{ color: '#9b94b8' }}>
            <span>Participants</span>
            <span>{participants.length}</span>
          </div>

          {participants.length === 0 ? (
            <div className="text-center py-8 text-sm" style={{ color: '#6b6488' }}>
              Personne n&apos;a encore misé. Soyez le premier !
            </div>
          ) : (
            <div className="space-y-2">
              {participants.map((p) => (
                <div
                  key={p.user.id}
                  className="rounded-lg p-3 flex items-center gap-3"
                  style={{
                    background: p.user.id === userId ? 'rgba(255,197,66,0.08)' : 'rgba(255,255,255,0.02)',
                    border: p.user.id === userId
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
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold truncate" style={{ color: '#e8e2f5' }}>
                      {p.user.username}
                    </div>
                    <div className="h-1.5 rounded-full mt-1 overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${p.chance}%`, background: p.color }}
                      />
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold" style={{ color: '#ffd97a' }}>
                      {p.total.toLocaleString()} ⚜
                    </div>
                    <div className="text-[11px]" style={{ color: '#9b94b8' }}>
                      {p.chance.toFixed(1)}%
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Provably fair footer — minimal first pass, dedicated modal in next commit */}
        {round && (
          <div
            className="rounded-2xl p-4 mt-6 text-[11px] font-mono flex flex-wrap items-center gap-x-4 gap-y-1"
            style={{ background: '#0d0b1a', border: '1px solid #1e1a30', color: '#6b6488' }}
          >
            <span className="flex items-center gap-1"><Shield size={12} /> nonce=#{round.nonce}</span>
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
      </div>
    </div>
  );
}
