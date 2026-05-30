'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useSession, signIn } from 'next-auth/react';
import { cn, parseCoinAmount, round2 } from '@/lib/utils';
import { apiClient, setAuthToken } from '@/lib/api';
import { connectSocket, getSocket } from '@/lib/socket';
import { Shield, Crown, Target, ShieldCheck, X, Copy, Check, Hexagon } from 'lucide-react';

/**
 * tft.money — Roulette page.
 * Ported from AgeOfMoney's /roulette (same backend, same socket events).
 *
 * Design changes vs AoM :
 *   - Palette swapped to TFT tokens (purple primary, mint/rose/cyan).
 *   - Knights/Archers keep their colour intent (slate/orange) so the
 *     wheel still reads instantly ; only the Emperor (rare x14) keeps a
 *     gold accent — matches the "money" theme and the AoM behaviour.
 *   - Replaced `react-roulette-pro` (not installed on tft.money) with a
 *     bespoke CSS-transform strip so we don't add a new dep. Same look :
 *     horizontal scroll past a central pointer, then ease-out to the
 *     winning slot.
 */

// Zone metadata — KEEP AoE-themed labels per spec.
// Emperor stays gold (rare x14 = money), Knights/Archers re-tinted to
// match the TFT palette (slate/orange feel intact, more saturated).
const ZONES = {
  KNIGHTS: { label: 'CHEVALIERS', multiplier: 2,  color: '#94a3b8', glow: 'rgba(148,163,184,0.4)', border: '#475569',   bg: 'rgba(71,85,105,0.3)',     icon: Shield },
  EMPEROR: { label: 'EMPEROR',    multiplier: 14, color: '#fcd34d', glow: 'rgba(251,191,36,0.55)', border: '#fbbf2480', bg: 'rgba(251,191,36,0.15)',   icon: Crown  },
  ARCHERS: { label: 'ARCHERS',    multiplier: 2,  color: '#fb923c', glow: 'rgba(251,146,60,0.45)', border: '#c2410c80', bg: 'rgba(194,65,12,0.15)',    icon: Target },
} as const;
type Zone = keyof typeof ZONES;

// 15-slot wheel — must match backend mapping :
// 1-7 = KNIGHTS, 8 = EMPEROR, 9-15 = ARCHERS
const BASE_PATTERN: { zone: Zone; num: number }[] = [
  { zone: 'KNIGHTS', num: 1 },  { zone: 'ARCHERS', num: 9 },  { zone: 'KNIGHTS', num: 2 },
  { zone: 'ARCHERS', num: 10 }, { zone: 'KNIGHTS', num: 3 },  { zone: 'ARCHERS', num: 11 },
  { zone: 'KNIGHTS', num: 4 },  { zone: 'EMPEROR', num: 8 },  { zone: 'ARCHERS', num: 12 },
  { zone: 'KNIGHTS', num: 5 },  { zone: 'ARCHERS', num: 13 }, { zone: 'KNIGHTS', num: 6 },
  { zone: 'ARCHERS', num: 14 }, { zone: 'KNIGHTS', num: 7 },  { zone: 'ARCHERS', num: 15 },
];

const ITEM_W = 80;
const ITEM_GAP = 8;
const ITEM_SLOT = ITEM_W + ITEM_GAP;
const VISIBLE = 9;
const WHEEL_W = VISIBLE * ITEM_W + (VISIBLE - 1) * ITEM_GAP; // 784px
const REPEATS = 12;

interface RoundBet {
  id: string; zone: Zone; amount: number;
  user: { id: string; username: string; avatar: string | null };
}
interface Round {
  id: string; status: 'BETTING' | 'SPINNING' | 'COMPLETED';
  endsAt: string | null; winZone: Zone | null; multiplier: number | null; bets: RoundBet[];
  roundHash: string | null; serverSeed: string | null; result: number | null;
}
interface HistoryItem {
  id: string; winZone: Zone; multiplier: number;
  roundHash?: string | null; serverSeed?: string | null; result?: number | null;
}

const GLOBAL_CSS = `
@keyframes rl-glow-pulse { 0%,100%{box-shadow:0 0 18px var(--gz)} 50%{box-shadow:0 0 48px var(--gz),0 0 80px var(--gz)} }
@keyframes rl-shake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-7px)} 40%{transform:translateX(7px)} 60%{transform:translateX(-4px)} 80%{transform:translateX(4px)} }
@keyframes rl-win-in { 0%{opacity:0;transform:scale(0.5) translateY(8px)} 60%{transform:scale(1.1) translateY(-2px)} 100%{opacity:1;transform:scale(1) translateY(0)} }
@keyframes rl-edge-flash { 0%,100%{opacity:0} 10%,40%{opacity:1} }
@keyframes rl-urgent { 0%,100%{opacity:1} 50%{opacity:0.6} }
@keyframes rl-win-border { 0%,100%{box-shadow:0 0 12px var(--gz),inset 0 0 8px var(--gz)} 50%{box-shadow:0 0 40px var(--gz),inset 0 0 20px var(--gz)} }
@keyframes rl-anticipate { 0%,100%{box-shadow:0 0 24px var(--gz),inset 0 0 12px var(--gz)} 50%{box-shadow:0 0 70px var(--gz),0 0 110px var(--gz),inset 0 0 28px var(--gz)} }
@keyframes rl-burst { 0%{opacity:0;transform:translate(-50%,-50%) scale(0.3)} 18%{opacity:1} 100%{opacity:0;transform:translate(-50%,-50%) scale(2.6)} }
@keyframes rl-flash { 0%{opacity:0} 12%{opacity:1} 100%{opacity:0} }
@keyframes rl-shimmer { 0%{transform:translateX(-100%);opacity:0} 30%{opacity:0.45} 100%{transform:translateX(100%);opacity:0} }
.rl-winning     { animation:rl-win-border 0.65s ease-in-out infinite; }
.rl-shaking     { animation:rl-shake 0.55s ease-in-out; }
.rl-urgent      { animation:rl-urgent 1s ease-in-out infinite; }
.rl-glow-p      { animation:rl-glow-pulse 0.8s ease-in-out infinite; }
.rl-anticipate  { animation:rl-anticipate 0.5s ease-in-out infinite; }
.rl-burst       { animation:rl-burst 0.85s cubic-bezier(0.16,0.84,0.44,1) forwards; }
.rl-flash       { animation:rl-flash 0.55s ease-out forwards; }
.rl-shimmer     { animation:rl-shimmer 1.4s ease-in-out infinite; }
`;

function RoulettePageImpl() {
  const { data: session } = useSession();
  const [round, setRound] = useState<Round | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [selectedZone, setSelectedZone] = useState<Zone | null>(null);
  const [betAmount, setBetAmount] = useState('');
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [countdownExact, setCountdownExact] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'betting' | 'spinning' | 'result'>('idle');
  const [winZone, setWinZone] = useState<Zone | null>(null);
  const [userWon, setUserWon] = useState<boolean | null>(null);
  const [payout, setPayout] = useState<number | null>(null);
  const [anticipation, setAnticipation] = useState(false);
  const [burstKey, setBurstKey] = useState(0);
  const [showFairness, setShowFairness] = useState(false);
  const [fairnessRound, setFairnessRound] = useState<{
    id: string; roundHash: string | null; serverSeed: string | null;
    result: number | null; winZone: Zone | null; source?: 'random.org' | 'crypto';
  } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownMaxRef = useRef(30);
  const spinEndsAtRef = useRef<number>(0);

  // ── Custom wheel state (no external lib) ─────────────────────────────
  // We render a horizontal strip and animate `translateX` with CSS.
  // `offsetX` is the px to translate the strip ; 0 = first item at the
  // far left. To land slot N under the centre, we shift left by
  // (N * ITEM_SLOT) - (viewport / 2 - ITEM_W / 2).
  const [offsetX, setOffsetX] = useState(0);
  const [transition, setTransition] = useState('none');
  const wheelHostRef = useRef<HTMLDivElement | null>(null);

  // The full prize list — BASE_PATTERN repeated REPEATS times so we can
  // land deep into the strip and have plenty of "runway" to scroll past.
  const prizeList = useMemo(() => {
    const items: { id: string; zone: Zone; num: number }[] = [];
    for (let r = 0; r < REPEATS; r++) {
      for (let i = 0; i < BASE_PATTERN.length; i++) {
        const slot = BASE_PATTERN[i];
        items.push({ id: `r${r}-${i}-${slot.num}`, zone: slot.zone, num: slot.num });
      }
    }
    return items;
  }, []);

  useEffect(() => {
    if (session?.user.accessToken) setAuthToken(session.user.accessToken);
  }, [session]);

  useEffect(() => {
    if (document.getElementById('rl-css')) return;
    const s = document.createElement('style');
    s.id = 'rl-css'; s.textContent = GLOBAL_CSS;
    document.head.appendChild(s);
  }, []);

  const fetchAll = useCallback(async () => {
    const [r, h] = await Promise.allSettled([
      apiClient.get('/roulette/current'),
      apiClient.get('/roulette/history'),
    ]);
    if (r.status === 'fulfilled') {
      const rd: Round | null = r.value.data.data;
      setRound(rd);
      if (rd) setFairnessRound({ id: rd.id, roundHash: rd.roundHash, serverSeed: rd.serverSeed, result: rd.result, winZone: rd.winZone });
      if (rd?.status === 'BETTING') setPhase('betting');
      else if (rd?.status === 'SPINNING') setPhase('spinning');
      else if (rd?.status === 'COMPLETED') { setPhase('result'); setWinZone(rd.winZone); }
      else setPhase('idle');
    }
    if (h.status === 'fulfilled') setHistory(h.value.data.data ?? []);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Recovery polling — if not on a BETTING round, re-fetch every 2 s so
  // we don't get stuck post-spin or between rounds.
  useEffect(() => {
    if (round?.status === 'BETTING') return;
    const id = setInterval(() => { fetchAll(); }, 2000);
    return () => clearInterval(id);
  }, [round?.status, fetchAll]);

  // Countdown
  useEffect(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (!round?.endsAt || round.status !== 'BETTING') {
      setCountdown(0); setCountdownExact(0); return;
    }
    const initial = Math.max(0, (new Date(round.endsAt).getTime() - Date.now()) / 1000);
    if (initial > 0) countdownMaxRef.current = initial;
    const tick = () => {
      const remaining = Math.max(0, (new Date(round.endsAt!).getTime() - Date.now()) / 1000);
      setCountdown(Math.ceil(remaining));
      setCountdownExact(remaining);
    };
    tick();
    countdownRef.current = setInterval(tick, 50);
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, [round?.endsAt, round?.status]);

  // ── Wheel animation ──────────────────────────────────────────────────
  // Pick a slot far into the prize list that matches the result number
  // (or zone if num missing), then translate to centre it under the
  // pointer with a 6.5s cubic-bezier ease-out.
  const animateSpin = useCallback((wz: Zone, resultNum?: number) => {
    const host = wheelHostRef.current;
    if (!host) return;
    const viewport = Math.min(host.clientWidth || WHEEL_W, WHEEL_W);
    const target = Math.floor(prizeList.length * 0.78);
    let landIdx = target;
    for (let i = 0; i < 60; i++) {
      const idx = (target + i) % prizeList.length;
      const slot = prizeList[idx];
      if (resultNum != null) {
        if (slot.num === resultNum) { landIdx = idx; break; }
      } else if (slot.zone === wz) { landIdx = idx; break; }
    }

    // Place the chosen slot's centre under the viewport centre.
    const slotCentre = landIdx * ITEM_SLOT + ITEM_W / 2;
    // Add ± a few px of jitter so the same slot doesn't feel mechanical
    // when it repeats.
    const jitter = (Math.random() - 0.5) * (ITEM_W * 0.5);
    const finalOffset = -(slotCentre - viewport / 2) + jitter;

    // Reset to a neutral position without animation, then animate.
    setTransition('none');
    setOffsetX(0);
    spinEndsAtRef.current = Date.now() + 6500;
    requestAnimationFrame(() => {
      setTransition('transform 6500ms cubic-bezier(0.12, 0.85, 0.25, 1)');
      setOffsetX(finalOffset);
    });

    // Anticipation kicks in late in the spin
    setTimeout(() => setAnticipation(true), 4700);
    setTimeout(() => {
      setAnticipation(false);
      setBurstKey(k => k + 1);
    }, 6500);
  }, [prizeList]);

  // Socket
  useEffect(() => {
    connectSocket(session?.user.accessToken);
    const s = getSocket();

    s.on('roulette:roundStart', (d: { roundId: string; endsAt: string; roundHash: string }) => {
      setWinZone(null); setUserWon(null); setPayout(null);
      setPhase('betting');
      setFairnessRound(prev => prev
        ? { ...prev, roundHash: d.roundHash, serverSeed: null, result: null, winZone: null }
        : null);
      fetchAll();
    });
    s.on('roulette:betsUpdate', (d: { roundId: string; bets: RoundBet[] }) => {
      setRound(prev => prev?.id === d.roundId ? { ...prev, bets: d.bets } : prev);
    });
    s.on('roulette:spin', (d: { winZone: Zone; multiplier: number; result?: number }) => {
      setPhase('spinning');
      setRound(prev => prev ? { ...prev, status: 'SPINNING' } : prev);
      animateSpin(d.winZone, d.result);
    });
    s.on('roulette:result', (d: {
      winZone: Zone; multiplier: number;
      serverSeed?: string; roundHash?: string; result?: number;
      roundId: string; source?: 'random.org' | 'crypto';
    }) => {
      const remaining = spinEndsAtRef.current - Date.now();
      const delay = Math.max(0, remaining + 300);
      setTimeout(() => {
        setPhase('result'); setWinZone(d.winZone);
        setFairnessRound({
          id: d.roundId, roundHash: d.roundHash ?? null,
          serverSeed: d.serverSeed ?? null, result: d.result ?? null,
          winZone: d.winZone, source: d.source,
        });
        setRound(prev => prev ? { ...prev, status: 'COMPLETED', winZone: d.winZone } : prev);

        setRound(prev => {
          if (!prev) return prev;
          const userId = (session?.user as { id?: string })?.id;
          const myBetOnWin = prev.bets.find(b => b.zone === d.winZone && b.user.id === userId);
          const didBet = prev.bets.some(b => b.user.id === userId);
          if (myBetOnWin) {
            setUserWon(true);
            const p = Math.round(myBetOnWin.amount * d.multiplier * 100) / 100;
            setPayout(p);
          } else if (didBet) {
            setUserWon(false);
          }
          return prev;
        });
        fetchAll();
      }, delay);
    });

    return () => {
      s.off('roulette:roundStart');
      s.off('roulette:betsUpdate');
      s.off('roulette:spin');
      s.off('roulette:result');
    };
  }, [fetchAll, session, animateSpin]);

  async function placeBet() {
    if (!session) { signIn('steam'); return; }
    if (!selectedZone) { showMsg('error', 'Sélectionnez une zone'); return; }
    const amount = parseCoinAmount(betAmount);
    if (!amount || amount < 1) { showMsg('error', 'Mise minimum : 1 coin'); return; }
    if (selectedZone === lockedZone) {
      showMsg('error', "Impossible de combiner Chevaliers et Archers sur le même round");
      return;
    }

    const userId = (session.user as { id?: string })?.id ?? '';
    const username = session.user?.name ?? '';
    const avatar = session.user?.image ?? null;
    const optimisticId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let didIncrementExisting = false;
    setRound(prev => {
      if (!prev) return prev;
      const existing = prev.bets.find(b => b.user.id === userId && b.zone === selectedZone);
      if (existing) {
        didIncrementExisting = true;
        return {
          ...prev,
          bets: prev.bets.map(b => b.user.id === userId && b.zone === selectedZone
            ? { ...b, amount: b.amount + amount }
            : b),
        };
      }
      const optimisticBet: RoundBet = { id: optimisticId, zone: selectedZone, amount, user: { id: userId, username, avatar } };
      return { ...prev, bets: [optimisticBet, ...prev.bets] };
    });

    apiClient.post('/roulette/bet', { zone: selectedZone, amount })
      .catch((e: unknown) => {
        const err = e as { response?: { data?: { error?: string } } };
        showMsg('error', err?.response?.data?.error ?? 'Erreur');
        setRound(prev => {
          if (!prev) return prev;
          if (didIncrementExisting) {
            return {
              ...prev,
              bets: prev.bets
                .map(b => b.user.id === userId && b.zone === selectedZone
                  ? { ...b, amount: b.amount - amount }
                  : b)
                .filter(b => b.amount > 0),
            };
          }
          return { ...prev, bets: prev.bets.filter(b => b.id !== optimisticId) };
        });
      });
  }

  function showMsg(type: 'success' | 'error', text: string) {
    setMsg({ type, text }); setTimeout(() => setMsg(null), 3000);
  }

  function copyToClipboard(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  const isBetting = phase === 'betting';
  const isSpinning = phase === 'spinning';
  const isResult = phase === 'result';
  const userCoins = (session?.user as { coins?: number })?.coins ?? 0;

  const zoneLabel = (zone: Zone): string => {
    if (zone === 'KNIGHTS') return 'CHEVALIERS';
    if (zone === 'EMPEROR') return 'EMPEROR';
    return 'ARCHERS';
  };
  const userId = (session?.user as { id?: string })?.id;

  // KNIGHTS+ARCHERS combo arbitrages ~93 % of the wheel at 2x → forbidden.
  const myKnightsBet = round?.bets.some(b => b.user.id === userId && b.zone === 'KNIGHTS') ?? false;
  const myArchersBet = round?.bets.some(b => b.user.id === userId && b.zone === 'ARCHERS') ?? false;
  const lockedZone: Zone | null = myKnightsBet ? 'ARCHERS' : myArchersBet ? 'KNIGHTS' : null;

  useEffect(() => {
    if (selectedZone && selectedZone === lockedZone) setSelectedZone(null);
  }, [selectedZone, lockedZone]);

  const myZoneBet = round?.bets.find(b => b.user.id === userId && b.zone === selectedZone);

  const zoneTotals = (['KNIGHTS', 'EMPEROR', 'ARCHERS'] as Zone[]).map(z => ({
    zone: z,
    count: round?.bets.filter(b => b.zone === z).length ?? 0,
    total: round?.bets.filter(b => b.zone === z).reduce((s, b) => s + b.amount, 0) ?? 0,
    bets: round?.bets.filter(b => b.zone === z) ?? [],
  }));

  return (
    <div className="min-h-screen relative bg-tft-bg text-tft-text">
      {/* Edge glow on result */}
      {isResult && winZone && (
        <div className="fixed inset-0 pointer-events-none z-50"
          style={{
            boxShadow: `inset 0 0 80px 20px ${ZONES[winZone].glow}`,
            animation: 'rl-edge-flash 2s ease-out forwards',
          }} />
      )}

      <div className="max-w-5xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="text-center mb-5">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md border border-tft-purple/40 bg-tft-purple/10 mb-3">
            <Hexagon size={11} className="text-tft-cyan-bright" />
            <span className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-purple-bright">
              TFT.money · Roulette
            </span>
          </div>
          <h1 className="font-display font-bold text-3xl mb-0.5 text-tft-purple-bright">
            ROULETTE
          </h1>
          <p className="text-[11px] tracking-widest uppercase text-tft-text-muted">
            Chevaliers · Emperor · Archers
          </p>
        </div>

        {/* History + Zone stats */}
        <div className="flex items-start gap-3 mb-3 sm:mb-5">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 flex-1 min-w-0">
            <span className="text-[10px] uppercase tracking-widest text-tft-text-muted shrink-0">50 derniers rolls</span>
            {history.slice(0, 20).map(h => {
              const z = ZONES[h.winZone]; const Icon = z.icon;
              return (
                <div key={h.id} className="w-7 h-7 rounded-md flex flex-col items-center justify-center shrink-0"
                  title={`#${h.result ?? '?'}`}
                  style={{ background: z.bg, border: `1px solid ${z.border}`, boxShadow: `0 0 6px ${z.glow}` }}>
                  <Icon size={10} style={{ color: z.color }} />
                  <span className="text-[7px] font-bold leading-none" style={{ color: z.color }}>{h.result ?? ''}</span>
                </div>
              );
            })}
          </div>

          {history.length > 0 && (() => {
            const last50 = history.slice(0, 50);
            const total = last50.length;
            return (
              <div className="hidden sm:flex shrink-0 flex-col gap-1 rounded-md p-2.5 bg-tft-bg-card border border-tft-border" style={{ minWidth: 130 }}>
                <span className="text-[9px] uppercase tracking-widest text-tft-text-muted mb-0.5">Stats</span>
                {(['KNIGHTS','EMPEROR','ARCHERS'] as Zone[]).map(zone => {
                  const z = ZONES[zone];
                  const Icon = z.icon;
                  const count = last50.filter(h => h.winZone === zone).length;
                  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                  return (
                    <div key={zone} className="flex items-center gap-1.5">
                      <Icon size={11} style={{ color: z.color, flexShrink: 0 }} />
                      <div className="flex-1 h-1 rounded-full overflow-hidden bg-tft-border">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: z.color, opacity: 0.7 }} />
                      </div>
                      <span className="text-[10px] font-bold tabular-nums" style={{ color: z.color, minWidth: 16, textAlign: 'right' }}>{count}</span>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>

        {/* Wheel card */}
        <div className="rounded-md mb-3 sm:mb-5 overflow-hidden bg-tft-bg-card border border-tft-border">

          {/* Status bar */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-tft-border">
            <div />
            <button onClick={() => setShowFairness(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium hover:opacity-80 transition-opacity bg-tft-bg-elevated border border-tft-border-mid text-tft-text-dim">
              <ShieldCheck size={12} className="text-tft-mint" />
              Provably Fair
            </button>
          </div>

          {/* Wheel */}
          <div className="py-3 sm:py-6 flex flex-col items-center">

            {/* Timer */}
            <div className={cn(
              'flex items-center justify-center transition-all',
              isBetting && countdown > 0 ? 'h-16 mb-3' : 'h-0',
            )}>
              {isBetting && countdown > 0 && (() => {
                const max = countdownMaxRef.current;
                const progress = max > 0 ? countdownExact / max : 0;
                const SIZE = 52;
                const SW = 3;
                const R = (SIZE - SW) / 2;
                const CIRC = 2 * Math.PI * R;
                const dashOffset = CIRC * (1 - progress);
                const isUrgent  = countdown <= 3;
                const isWarning = countdown <= 10;
                const color = isUrgent ? '#f87171' : isWarning ? '#fb923c' : '#a78bfa';
                const glow  = isUrgent ? 'rgba(248,113,113,0.75)' : isWarning ? 'rgba(251,146,60,0.65)' : 'rgba(167,139,250,0.55)';
                return (
                  <div className={cn('relative flex items-center justify-center', isUrgent && 'rl-urgent')}
                    style={{ width: SIZE, height: SIZE }}>
                    <svg width={SIZE} height={SIZE} className="absolute" style={{ transform: 'rotate(-90deg)' }}>
                      <circle cx={SIZE/2} cy={SIZE/2} r={R} fill="none" stroke="#1f1d4a" strokeWidth={SW} />
                      <circle
                        cx={SIZE/2} cy={SIZE/2} r={R} fill="none"
                        stroke={color} strokeWidth={SW}
                        strokeDasharray={CIRC} strokeDashoffset={dashOffset}
                        strokeLinecap="round"
                        style={{ transition: 'stroke 0.35s', filter: `drop-shadow(0 0 5px ${glow})` }}
                      />
                    </svg>
                    <span className="relative z-10 font-bold tabular-nums font-display" style={{ fontSize: 14, color, lineHeight: 1 }}>
                      {countdown}
                    </span>
                  </div>
                );
              })()}
            </div>

            {/* Wheel viewport (custom CSS transform strip) */}
            <div
              ref={wheelHostRef}
              className="relative"
              style={{
                width: '100%',
                maxWidth: WHEEL_W,
                height: ITEM_W + 6,
                overflow: 'hidden',
              }}
            >
              {/* Centre indicator bar */}
              {(() => {
                const barColor = isResult && winZone
                  ? ZONES[winZone].color
                  : anticipation
                  ? '#fcd34d'
                  : isSpinning
                  ? '#a78bfa'
                  : '#a78bfa';
                const glowColor = isResult && winZone
                  ? ZONES[winZone].glow
                  : 'rgba(167,139,250,0.6)';
                return (
                  <div
                    className={cn(
                      'absolute pointer-events-none z-30',
                      isSpinning && !anticipation && 'rl-glow-p',
                      isSpinning && anticipation && 'rl-anticipate',
                      isResult && winZone && 'rl-winning'
                    )}
                    style={{
                      left: '50%', top: -8, bottom: -8,
                      width: 4, transform: 'translateX(-50%)',
                      background: `linear-gradient(180deg, transparent 0%, ${barColor} 12%, ${barColor} 88%, transparent 100%)`,
                      boxShadow: `0 0 16px ${glowColor}, 0 0 32px ${glowColor}`,
                      borderRadius: 2,
                      transition: 'background 0.3s, box-shadow 0.3s',
                      '--gz': glowColor,
                    } as React.CSSProperties}
                  >
                    <div className="absolute left-1/2" style={{
                      top: -6, transform: 'translateX(-50%)',
                      width: 0, height: 0,
                      borderLeft: '7px solid transparent', borderRight: '7px solid transparent',
                      borderTop: `10px solid ${barColor}`,
                      filter: `drop-shadow(0 0 6px ${glowColor})`,
                    }} />
                    <div className="absolute left-1/2" style={{
                      bottom: -6, transform: 'translateX(-50%)',
                      width: 0, height: 0,
                      borderLeft: '7px solid transparent', borderRight: '7px solid transparent',
                      borderBottom: `10px solid ${barColor}`,
                      filter: `drop-shadow(0 0 6px ${glowColor})`,
                    }} />
                  </div>
                );
              })()}

              {/* Burst & flash on result */}
              {isResult && winZone && (
                <div key={burstKey} className="rl-burst absolute z-30 pointer-events-none rounded-full"
                  style={{
                    left: '50%', top: '50%', width: ITEM_W * 1.6, height: ITEM_W * 1.6,
                    background: `radial-gradient(circle, ${ZONES[winZone].glow} 0%, ${ZONES[winZone].glow.replace(/[\d.]+\)/, '0.2)')} 30%, transparent 70%)`,
                  }} />
              )}
              {isResult && winZone && (
                <div key={`f${burstKey}`} className="rl-flash absolute inset-0 z-25 pointer-events-none rounded-md"
                  style={{ background: `radial-gradient(ellipse at center, ${ZONES[winZone].glow} 0%, transparent 60%)` }} />
              )}

              {/* Spin shimmer */}
              {isSpinning && (
                <div className="absolute inset-y-0 left-0 right-0 z-10 pointer-events-none overflow-hidden">
                  <div className="rl-shimmer absolute inset-y-0 w-32" style={{ background: 'linear-gradient(90deg,transparent,rgba(167,139,250,0.18),transparent)' }} />
                </div>
              )}

              {/* Fades */}
              <div className="absolute inset-y-0 left-0 w-16 sm:w-10 z-10 pointer-events-none"
                style={{ background: 'linear-gradient(to right,rgba(16,16,40,0.98) 0%,rgba(16,16,40,0.85) 40%,transparent 100%)' }} />
              <div className="absolute inset-y-0 right-0 w-16 sm:w-10 z-10 pointer-events-none"
                style={{ background: 'linear-gradient(to left,rgba(16,16,40,0.98) 0%,rgba(16,16,40,0.85) 40%,transparent 100%)' }} />

              {/* The strip */}
              <div
                style={{
                  display: 'flex',
                  position: 'absolute',
                  top: 3,
                  left: 0,
                  transform: `translateX(${offsetX}px)`,
                  transition,
                  willChange: 'transform',
                }}
              >
                {prizeList.map((slot) => {
                  const z = ZONES[slot.zone];
                  const Icon = z.icon;
                  return (
                    <div
                      key={slot.id}
                      style={{
                        width: ITEM_W,
                        height: ITEM_W,
                        flex: '0 0 auto',
                        background: z.bg,
                        border: `1.5px solid ${z.border}`,
                        borderRadius: 8,
                        margin: `0 ${ITEM_GAP / 2}px`,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxSizing: 'border-box',
                      }}
                    >
                      <Icon size={24} style={{ color: z.color }} />
                      <span style={{
                        color: z.color, opacity: 0.7,
                        fontSize: 11, fontWeight: 700, marginTop: 2,
                        fontVariantNumeric: 'tabular-nums',
                      }}>
                        {slot.num}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Win / lose readout */}
            {isResult && winZone && (
              <div className="mt-5 text-center" style={{ animation: 'rl-win-in 0.5s cubic-bezier(0.2,1.4,0.4,1) both' }}>
                {userWon && payout ? (
                  <div className="inline-flex items-center gap-2">
                    <span className="text-[13px] font-bold uppercase tracking-wider font-display" style={{ color: ZONES[winZone].color, opacity: 0.9 }}>
                      {zoneLabel(winZone)}
                    </span>
                    <span
                      className="text-[14px] font-black px-2 py-0.5 rounded"
                      style={{
                        background: `${ZONES[winZone].color}22`,
                        color: ZONES[winZone].color,
                        border: `1px solid ${ZONES[winZone].color}60`,
                      }}
                    >
                      ×{ZONES[winZone].multiplier}
                    </span>
                  </div>
                ) : userWon === false ? (
                  <div className="rl-shaking">
                    <p className="text-[11px] uppercase tracking-widest mb-1 text-tft-danger">PERDU</p>
                    <p className="text-2xl font-bold font-display" style={{ color: ZONES[winZone].color }}>
                      {zoneLabel(winZone)} ×{ZONES[winZone].multiplier}
                    </p>
                  </div>
                ) : (
                  <p className="text-xl font-bold font-display" style={{ color: ZONES[winZone].color }}>
                    {zoneLabel(winZone)} ×{ZONES[winZone].multiplier}
                    {fairnessRound?.result != null && (
                      <span className="text-sm ml-2 opacity-60">#{fairnessRound.result}</span>
                    )}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Bet controls — guarded behind Steam auth */}
        {!session ? (
          <div className="rounded-md p-6 mb-5 bg-tft-bg-card border border-tft-border text-center">
            <p className="text-[13px] text-tft-text-dim mb-3">Connexion Steam requise pour miser.</p>
            <button
              onClick={() => signIn('steam')}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-md font-ui font-semibold text-[12px] tracking-[0.18em] uppercase text-white bg-tft-purple hover:bg-tft-purple-bright transition-colors"
            >
              Se connecter avec Steam
            </button>
          </div>
        ) : (
        <div className="rounded-md p-4 mb-5 bg-tft-bg-card border border-tft-border">
          {msg && (
            <div className={cn('p-2.5 rounded-md mb-3 text-[12px]',
              msg.type === 'success'
                ? 'bg-tft-mint-dim border border-tft-mint/40 text-tft-mint'
                : 'bg-tft-danger-dim border border-tft-danger/40 text-tft-danger')}>
              {msg.text}
            </div>
          )}
          <div className="flex flex-col sm:flex-row gap-2 mb-3">
            <div className="relative sm:flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-tft-gold-bright text-[14px] pointer-events-none">⚜</span>
              <input
                type="number"
                step="0.01"
                inputMode="decimal"
                value={betAmount}
                onChange={e => setBetAmount(e.target.value)}
                placeholder="Montant en coins"
                className="w-full pl-9 pr-3 py-3 sm:py-2.5 rounded-md text-[14px] sm:text-[13px] outline-none text-tft-text placeholder:text-tft-text-muted bg-tft-bg-elevated border border-tft-border-mid focus:border-tft-purple-bright [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
            <div className="flex gap-2 overflow-x-auto -mx-1 px-1 sm:mx-0 sm:px-0 sm:contents">
              {([1,10,100] as number[]).map(v => (
                <button key={v} onClick={() => setBetAmount(a => String(round2(parseCoinAmount(a) + v)))}
                  className="shrink-0 px-3 py-2 rounded-md text-[12px] font-bold hover:opacity-80 min-w-[44px] bg-tft-border text-tft-text-dim border border-tft-border-mid">+{v}</button>
              ))}
              <button onClick={() => setBetAmount(a => String(Math.max(1, round2(parseCoinAmount(a) / 2))))}
                className="shrink-0 px-3 py-2 rounded-md text-[12px] font-bold hover:opacity-80 min-w-[44px] bg-tft-border text-tft-text-dim border border-tft-border-mid">½</button>
              <button onClick={() => setBetAmount(String(userCoins))}
                className="shrink-0 px-3 py-2 rounded-md text-[12px] font-bold hover:opacity-80 min-w-[44px] bg-tft-border text-tft-text-dim border border-tft-border-mid">MAX</button>
              <button onClick={() => setBetAmount('')}
                className="shrink-0 px-3 py-2 rounded-md text-[12px] text-tft-text-muted hover:text-tft-text-dim min-w-[44px] bg-tft-bg-elevated border border-tft-border">CLR</button>
            </div>
          </div>
          <button onClick={placeBet} disabled={!isBetting || !selectedZone || !betAmount}
            className="w-full py-3 rounded-md text-[14px] font-bold font-display tracking-wider transition-all disabled:opacity-40"
            style={{
              background: selectedZone ? ZONES[selectedZone].color : '#a78bfa',
              color: '#08081a',
            }}>
            {!isBetting ? 'Paris fermés' :
              !selectedZone ? 'Sélectionnez une zone' :
              `Miser ${betAmount ? parseCoinAmount(betAmount).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : '...'} ⚜`}
          </button>
          {myZoneBet && isBetting && (
            <p className="text-center text-[11px] mt-2 text-tft-text-muted">
              Mise : <span style={{ color: selectedZone ? ZONES[selectedZone].color : '#a78bfa' }}>
                {myZoneBet.amount.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ⚜
              </span>
            </p>
          )}
        </div>
        )}

        {/* 3 zones */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          {zoneTotals.map(({ zone, count, total, bets }) => {
            const z = ZONES[zone]; const Icon = z.icon;
            const isSelected = selectedZone === zone;
            const isWin = isResult && winZone === zone;
            const userBetThisZone = !!round?.bets.find(b => b.user.id === userId && b.zone === zone);
            const isLose = isResult && winZone !== zone && userBetThisZone;
            const isLocked = lockedZone === zone;
            const lockReason = isLocked
              ? (zone === 'KNIGHTS' ? "Vous avez parié sur Archers — combo 2×/2× interdit" : "Vous avez parié sur Chevaliers — combo 2×/2× interdit")
              : '';
            return (
              <div key={zone}
                onClick={() => { if (isBetting && !isLocked) setSelectedZone(zone); }}
                title={lockReason || undefined}
                className={cn(
                  'rounded-md overflow-hidden transition-all relative bg-tft-bg-card',
                  isBetting && !isLocked && 'cursor-pointer',
                  isLocked && 'cursor-not-allowed',
                  isLose && 'rl-shaking',
                )}
                style={{
                  border: `1px solid ${isSelected || isWin ? z.color : '#1f1d4a'}`,
                  boxShadow: isWin ? `0 0 32px ${z.glow}` : isSelected ? `0 0 18px ${z.glow}` : 'none',
                  transform: isSelected && !isResult ? 'translateY(-3px)' : 'none',
                  opacity: isLocked ? 0.45 : 1,
                  '--gz': z.glow,
                } as React.CSSProperties}>
                {isLocked && (
                  <div className="absolute top-2 right-2 z-10 flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-tft-bg/85 border border-tft-border-mid text-tft-text-dim"
                    aria-label={lockReason}>
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    Verrouillé
                  </div>
                )}
                <div className={cn('p-4 flex items-center justify-between border-b border-tft-border/30', isWin && 'rl-winning')}
                  style={{ '--gz': z.glow } as React.CSSProperties}>
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-md flex items-center justify-center"
                      style={{ background: z.bg, border: `1px solid ${z.border}`, boxShadow: `0 0 8px ${z.glow}` }}>
                      <Icon size={18} style={{ color: z.color }} />
                    </div>
                    <p className="font-bold text-[13px] font-display" style={{ color: z.color }}>{zoneLabel(zone)}</p>
                  </div>
                  <p className="text-[22px] font-bold font-display" style={{ color: z.color, textShadow: isWin ? `0 0 20px ${z.glow}` : 'none' }}>×{z.multiplier}</p>
                </div>
                <div className="px-4 py-2 flex justify-between text-[11px] border-b border-tft-border/20">
                  <span className="text-tft-text-muted">{count} paris</span>
                  <span className="font-bold" style={{ color: z.color }}>
                    {total.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ⚜
                  </span>
                </div>
                <div className="p-2 max-h-52 overflow-y-auto space-y-0.5 scrollbar-arcane">
                  {bets.length === 0 && <p className="text-center text-[11px] py-4 text-tft-text-faint">Personne pour l&apos;instant.</p>}
                  {bets.map(bet => (
                    <div key={bet.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-tft-bg-elevated transition-colors">
                      {bet.user.avatar
                        ? <img src={bet.user.avatar} alt="" className="w-5 h-5 rounded-full shrink-0" />
                        : <div className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[9px] font-bold"
                            style={{ background: z.bg, color: z.color }}>{bet.user.username[0]?.toUpperCase()}</div>}
                      <span className="text-[11px] text-tft-text-dim truncate flex-1">{bet.user.username}</span>
                      <span className="text-[11px] font-bold shrink-0" style={{ color: z.color }}>
                        {bet.amount.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ⚜
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {!round && (
          <div className="mt-6 text-center p-4 rounded-md bg-tft-bg-card border border-tft-border">
            <p className="text-[13px] text-tft-text-muted">Chargement...</p>
          </div>
        )}
      </div>

      {/* Provably Fair Modal */}
      {showFairness && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center px-4"
          style={{ background: 'rgba(8,8,26,0.85)', backdropFilter: 'blur(6px)' }}
          onClick={() => setShowFairness(false)}>
          <div className="w-full max-w-lg rounded-md overflow-hidden bg-tft-bg-card border border-tft-border"
            style={{ boxShadow: '0 0 60px rgba(124,58,237,0.15)' }}
            onClick={e => e.stopPropagation()}>

            <div className="flex items-center justify-between px-6 py-4 border-b border-tft-border">
              <div className="flex items-center gap-2">
                <ShieldCheck size={16} className="text-tft-mint" />
                <span className="font-bold text-[14px] tracking-widest font-display text-tft-text">FAIRNESS</span>
              </div>
              <button onClick={() => setShowFairness(false)} className="hover:opacity-60 transition-opacity">
                <X size={16} className="text-tft-text-muted" />
              </button>
            </div>

            <div className="px-6 py-4 text-[12px] leading-relaxed space-y-1 border-b border-tft-border">
              <p className="text-tft-text-dim">tft.money implémente un système de vérification d&apos;équité Provably Fair.</p>
              <p className="text-tft-text-dim">Le Round Hash est affiché <span className="text-tft-mint">avant le spin</span> — le seed est révélé <span className="text-tft-mint">après le résultat</span>. Vérifiable sur{' '}
                <a href="https://api.random.org/verify" target="_blank" rel="noopener noreferrer"
                  className="underline hover:opacity-80 transition-opacity text-tft-mint">
                  api.random.org/verify
                </a>.
              </p>
            </div>

            <div className="px-6 pt-4 pb-0 flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold"
                style={{
                  background: fairnessRound?.source === 'random.org' ? 'rgba(52,211,153,0.1)' : 'rgba(124,58,237,0.1)',
                  border: `1px solid ${fairnessRound?.source === 'random.org' ? '#34d39940' : '#7c3aed40'}`,
                  color: fairnessRound?.source === 'random.org' ? '#34d399' : '#a78bfa',
                }}>
                {fairnessRound?.source === 'random.org' ? '✓ random.org' : fairnessRound?.source === 'crypto' ? '✓ crypto fallback' : 'en attente'}
              </div>
            </div>

            <div className="px-6 py-4 space-y-3">
              {(() => {
                const isRandomOrg = fairnessRound?.source === 'random.org';
                const roll = fairnessRound?.result;
                const rows = isRandomOrg ? [
                  { label: 'Game ID',       value: fairnessRound?.id ?? '',          key: 'id'   },
                  { label: 'Serial N°',     value: fairnessRound?.roundHash ?? '',   key: 'hash' },
                  { label: 'Résultat (1-15)', value: roll != null ? String(roll) : '', key: 'roll' },
                  { label: 'Signature',     value: fairnessRound?.serverSeed ?? '',  key: 'seed' },
                ] : [
                  { label: 'Game ID',       value: fairnessRound?.id ?? '',          key: 'id'   },
                  { label: 'Round Hash',    value: fairnessRound?.roundHash ?? '',   key: 'hash' },
                  { label: 'Round Seed',    value: fairnessRound?.serverSeed ?? '',  key: 'seed' },
                  { label: 'Résultat (1-15)', value: roll != null ? String(roll) : '', key: 'roll' },
                ];
                return rows.map(({ label, value, key }) => (
                  <div key={key} className="flex items-start justify-between gap-3">
                    <span className="text-[11px] shrink-0 mt-0.5 text-tft-text-muted" style={{ minWidth: 90 }}>{label}:</span>
                    <div className="flex items-center gap-2 flex-1 min-w-0 px-3 py-2 rounded-md bg-tft-bg-elevated border border-tft-border">
                      <span className="flex-1 text-[11px] font-mono break-all text-tft-text-dim">
                        {value || <span className="text-tft-text-faint">—</span>}
                      </span>
                      {value !== '' && (
                        <button onClick={() => copyToClipboard(value, key)} className="shrink-0 hover:opacity-70 transition-opacity">
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

            <div className="mx-6 mb-5 rounded-md p-4 bg-tft-bg-elevated border border-tft-border">
              {fairnessRound?.source === 'random.org' ? (
                <div className="space-y-2">
                  <p className="text-[10px] text-tft-text-muted">Vérifiez ce résultat sur random.org :</p>
                  <a href="https://api.random.org/signatures/form" target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 text-[11px] font-bold hover:opacity-80 transition-opacity text-tft-mint">
                    <ShieldCheck size={12} /> api.random.org/signatures/form →
                  </a>
                  <p className="text-[10px] text-tft-text-faint">Collez la Signature et le Serial N° pour vérifier l&apos;authenticité.</p>
                </div>
              ) : (
                <p className="text-[10px] font-mono text-tft-text-muted">SHA256(Seed) = Hash · slot = (parseInt(Hash[0..8], 16) % 15) + 1</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Hydration-safe wrapper — same rationale as the AoM page : the wheel
 * mounts client-only since react-dom's hydration would diff against the
 * server-rendered offset (always 0) and squash the spin animation.
 */
export default function RoulettePage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) {
    return <div className="min-h-screen bg-tft-bg" />;
  }
  return <RoulettePageImpl />;
}
