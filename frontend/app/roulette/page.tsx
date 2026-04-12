'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { apiClient, setAuthToken } from '@/lib/api';
import { Shield, Crown, Sword, ShieldCheck, X, Copy, Check } from 'lucide-react';
import { playWololo, playTick, playWin, playLose, playEmperorWin } from '@/lib/rouletteSounds';

const ZONES = {
  KNIGHTS: { label: 'CHEVALIERS', multiplier: 2,  color: '#94a3b8', glow: 'rgba(148,163,184,0.4)', border: '#475569',    bg: 'rgba(71,85,105,0.3)',      icon: Shield },
  EMPEROR: { label: 'EMPEROR',    multiplier: 14, color: '#f5c842', glow: 'rgba(245,200,66,0.55)',  border: '#d4a01780',  bg: 'rgba(212,160,23,0.15)',    icon: Crown  },
  ARCHERS: { label: 'ARCHERS',    multiplier: 2,  color: '#fb923c', glow: 'rgba(251,146,60,0.45)',  border: '#c2410c80',  bg: 'rgba(194,65,12,0.15)',     icon: Sword  },
} as const;
type Zone = keyof typeof ZONES;

// 15-slot pattern — exact CSGOEmpire distribution: 7 KNIGHTS, 1 EMPEROR, 7 ARCHERS
// Each slot has a unique number (1-15) displayed on the tile
const BASE_PATTERN: { zone: Zone; num: number }[] = [
  { zone: 'KNIGHTS', num: 1 },  { zone: 'ARCHERS', num: 2 },  { zone: 'KNIGHTS', num: 3 },
  { zone: 'ARCHERS', num: 4 },  { zone: 'KNIGHTS', num: 5 },  { zone: 'ARCHERS', num: 6 },
  { zone: 'KNIGHTS', num: 7 },  { zone: 'EMPEROR', num: 8 },  { zone: 'ARCHERS', num: 9 },
  { zone: 'KNIGHTS', num: 10 }, { zone: 'ARCHERS', num: 11 }, { zone: 'KNIGHTS', num: 12 },
  { zone: 'ARCHERS', num: 13 }, { zone: 'KNIGHTS', num: 14 }, { zone: 'ARCHERS', num: 15 },
];

const ITEM_W = 80;
const ITEM_GAP = 8;
const ITEM_SLOT = ITEM_W + ITEM_GAP;
const VISIBLE = 9;
const WHEEL_W = VISIBLE * ITEM_W + (VISIBLE - 1) * ITEM_GAP; // 784px — item[4] at center
const CENTER_OFFSET = 4 * ITEM_SLOT + ITEM_W / 2; // 392px
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
interface HistoryItem { id: string; winZone: Zone; multiplier: number; roundHash?: string | null; serverSeed?: string | null; result?: number | null; }

const GLOBAL_CSS = `
@keyframes rl-glow-pulse { 0%,100%{box-shadow:0 0 18px var(--gz)} 50%{box-shadow:0 0 48px var(--gz),0 0 80px var(--gz)} }
@keyframes rl-shake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-7px)} 40%{transform:translateX(7px)} 60%{transform:translateX(-4px)} 80%{transform:translateX(4px)} }
@keyframes rl-win-in { 0%{opacity:0;transform:scale(0.5) translateY(8px)} 60%{transform:scale(1.1) translateY(-2px)} 100%{opacity:1;transform:scale(1) translateY(0)} }
@keyframes rl-edge-flash { 0%,100%{opacity:0} 10%,40%{opacity:1} }
@keyframes rl-urgent { 0%,100%{transform:scale(1)} 50%{transform:scale(1.2)} }
@keyframes rl-win-border { 0%,100%{box-shadow:0 0 12px var(--gz),inset 0 0 8px var(--gz)} 50%{box-shadow:0 0 40px var(--gz),inset 0 0 20px var(--gz)} }
@keyframes rl-amount { 0%{opacity:0;transform:translateY(14px) scale(0.8)} 100%{opacity:1;transform:translateY(0) scale(1)} }
@keyframes rl-item-pop { 0%{transform:scale(1)} 50%{transform:scale(1.15)} 100%{transform:scale(1)} }
@keyframes rl-anticipate { 0%,100%{box-shadow:0 0 24px var(--gz),inset 0 0 12px var(--gz)} 50%{box-shadow:0 0 70px var(--gz),0 0 110px var(--gz),inset 0 0 28px var(--gz)} }
@keyframes rl-burst { 0%{opacity:0;transform:translate(-50%,-50%) scale(0.3)} 18%{opacity:1} 100%{opacity:0;transform:translate(-50%,-50%) scale(2.6)} }
@keyframes rl-flash { 0%{opacity:0} 12%{opacity:1} 100%{opacity:0} }
@keyframes rl-shimmer { 0%{transform:translateX(-100%);opacity:0} 30%{opacity:0.45} 100%{transform:translateX(100%);opacity:0} }
@keyframes rl-page-shake { 0%,100%{transform:translate(0,0)} 25%{transform:translate(-3px,2px)} 50%{transform:translate(3px,-2px)} 75%{transform:translate(-2px,-2px)} }
.rl-winning     { animation:rl-win-border 0.65s ease-in-out infinite; }
.rl-shaking     { animation:rl-shake 0.55s ease-in-out; }
.rl-urgent      { animation:rl-urgent 0.35s ease-in-out infinite; }
.rl-glow-p      { animation:rl-glow-pulse 0.8s ease-in-out infinite; }
.rl-anticipate  { animation:rl-anticipate 0.5s ease-in-out infinite; }
.rl-burst       { animation:rl-burst 0.85s cubic-bezier(0.16,0.84,0.44,1) forwards; }
.rl-flash       { animation:rl-flash 0.55s ease-out forwards; }
.rl-shimmer     { animation:rl-shimmer 1.4s ease-in-out infinite; }
.rl-page-shake  { animation:rl-page-shake 0.4s ease-in-out 2; }
`;

export default function RoulettePage() {
  const { data: session } = useSession();
  const { t } = useT();
  const [round, setRound] = useState<Round | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [selectedZone, setSelectedZone] = useState<Zone | null>(null);
  const [betAmount, setBetAmount] = useState('');
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'betting' | 'spinning' | 'result'>('idle');
  const [winZone, setWinZone] = useState<Zone | null>(null);
  const [userWon, setUserWon] = useState<boolean | null>(null);
  const [payout, setPayout] = useState<number | null>(null);
  const [displayedPayout, setDisplayedPayout] = useState(0);
  const [centerIdx, setCenterIdx] = useState(4);
  const [anticipation, setAnticipation] = useState(false);
  const [burstKey, setBurstKey] = useState(0); // re-trigger burst on each new result
  const [showFairness, setShowFairness] = useState(false);
  const [showFairnessGuide, setShowFairnessGuide] = useState(false);
  const [fairnessRound, setFairnessRound] = useState<{ id: string; roundHash: string | null; serverSeed: string | null; result: number | null; winZone: Zone | null; source?: 'random.org' | 'crypto' } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const wheelRef = useRef<HTMLDivElement>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTickIdx = useRef(-1);
  const wololoPlayedRef = useRef(false);
  const spinEndsAtRef = useRef<number>(0); // timestamp when current spin animation ends
  const hasAnimatedRef = useRef(false); // true once animateSpin has been called this session

  const displayStrip = Array.from({ length: REPEATS }, () => BASE_PATTERN).flat();
  // Helper to get zone from strip item
  const zoneAt = (i: number) => displayStrip[i]?.zone ?? 'KNIGHTS';

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
      else if (rd?.status === 'SPINNING') {
        setPhase('spinning');
      } else if (rd?.status === 'COMPLETED') {
        setPhase('result');
        setWinZone(rd.winZone);
      } else {
        setPhase('idle');
      }
    }
    if (h.status === 'fulfilled') setHistory(h.value.data.data ?? []);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Countdown
  useEffect(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (!round?.endsAt || round.status !== 'BETTING') { setCountdown(0); return; }
    const tick = () => setCountdown(Math.max(0, Math.ceil((new Date(round.endsAt!).getTime() - Date.now()) / 1000)));
    tick();
    countdownRef.current = setInterval(tick, 200);
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, [round?.endsAt, round?.status]);

  // Socket
  useEffect(() => {
    const { connectSocket, getSocket } = require('@/lib/socket');
    connectSocket(); const s = getSocket();

    s.on('roulette:roundStart', (d: { roundId: string; endsAt: string; roundHash: string }) => {
      setWinZone(null); setUserWon(null); setPayout(null); setDisplayedPayout(0);
      setPhase('betting'); wololoPlayedRef.current = false;
      setFairnessRound(prev => prev ? { ...prev, roundHash: d.roundHash, serverSeed: null, result: null, winZone: null } : null);
      // Don't reset wheel here — keep showing last result until next spin
      fetchAll();
      // Schedule Wololo 150ms before spin
      const msUntilSpin = new Date(d.endsAt).getTime() - Date.now() - 150;
      if (msUntilSpin > 0) {
        setTimeout(() => {
          if (!wololoPlayedRef.current) { wololoPlayedRef.current = true; playWololo(0.3); }
        }, msUntilSpin);
      }
    });
    s.on('roulette:betsUpdate', (d: { roundId: string; bets: RoundBet[] }) => {
      setRound(prev => prev?.id === d.roundId ? { ...prev, bets: d.bets } : prev);
    });
    s.on('roulette:spin', (d: { winZone: Zone; multiplier: number; result?: number }) => {
      setPhase('spinning');
      setRound(prev => prev ? { ...prev, status: 'SPINNING' } : prev);
      animateSpin(d.winZone, d.result);
      // Fallback wololo if not already played
      if (!wololoPlayedRef.current) { wololoPlayedRef.current = true; playWololo(0.3); }
    });
    s.on('roulette:result', (d: { winZone: Zone; multiplier: number; serverSeed?: string; roundHash?: string; result?: number; roundId: string; source?: 'random.org' | 'crypto' }) => {
      // Wait for spin animation to finish before showing result
      const remaining = spinEndsAtRef.current - Date.now();
      const delay = Math.max(0, remaining + 300); // +300ms buffer after animation

      setTimeout(() => {
        if (tickIntervalRef.current) clearInterval(tickIntervalRef.current);
        hasAnimatedRef.current = false;
        setPhase('result'); setWinZone(d.winZone);
        setFairnessRound({ id: d.roundId, roundHash: d.roundHash ?? null, serverSeed: d.serverSeed ?? null, result: d.result ?? null, winZone: d.winZone, source: d.source });
        setRound(prev => prev ? { ...prev, status: 'COMPLETED', winZone: d.winZone } : prev);

        // Check if current user won
        setRound(prev => {
          if (!prev) return prev;
          const userId = (session?.user as { id?: string })?.id;
          const myBetOnWin = prev.bets.find(b => b.zone === d.winZone && b.user.id === userId);
          const didBet     = prev.bets.some(b => b.user.id === userId);
          if (myBetOnWin) {
            setUserWon(true);
            const p = Math.floor(myBetOnWin.amount * d.multiplier);
            setPayout(p); animatePayout(p);
            if (d.winZone === 'EMPEROR') playEmperorWin();
            else playWin();
          } else if (didBet) {
            setUserWon(false);
            playLose();
          }
          return prev;
        });
        fetchAll();
      }, delay);
    });

    return () => { s.off('roulette:roundStart'); s.off('roulette:betsUpdate'); s.off('roulette:spin'); s.off('roulette:result'); };
  }, [fetchAll, session]);

  function resetWheel() {
    if (tickIntervalRef.current) clearInterval(tickIntervalRef.current);
    if (!wheelRef.current) return;
    wheelRef.current.style.transition = 'none';
    wheelRef.current.style.transform = 'translateX(0px)';
    setCenterIdx(4);
    lastTickIdx.current = 4;
  }

  function animateSpin(wz: Zone, resultNum?: number) {
    if (!wheelRef.current) return;
    // Reset wheel position before starting new spin
    resetWheel();
    hasAnimatedRef.current = true;
    if (tickIntervalRef.current) clearInterval(tickIntervalRef.current);
    setAnticipation(false);

    const full = displayStrip;
    const target = Math.floor(full.length * 0.68);
    // If we have the exact result number, land on that specific numbered slot
    // Otherwise fall back to any slot of the winning zone
    const occurrences: number[] = [];
    for (let i = 0; i < 80; i++) {
      const idx = target + i;
      const slot = full[idx % full.length];
      if (resultNum != null) {
        // Match exact number
        if (slot.num === resultNum) occurrences.push(idx);
      } else {
        // Fall back to zone match
        if (slot.zone === wz) occurrences.push(idx);
      }
    }
    const landIdx = occurrences.length > 0
      ? occurrences[Math.floor(Math.random() * occurrences.length)]
      : target;
    // No sub-pixel offset — keeps centerIdx tracking in sync with visual position
    const finalX = -(landIdx * ITEM_SLOT - CENTER_OFFSET + ITEM_W / 2);
    const spinDuration = 6500;
    const startTime = Date.now();
    spinEndsAtRef.current = startTime + spinDuration;
    let lastTick = -1;
    let anticipationTriggered = false;

    tickIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(1, elapsed / spinDuration);
      // Stronger deceleration: power 3.4 → really long, slow tail
      const eased = 1 - Math.pow(1 - progress, 3.4);
      const currentX = finalX * eased;
      const ci = Math.round((CENTER_OFFSET - currentX) / ITEM_SLOT);
      const wrapped = ((ci % full.length) + full.length) % full.length;
      setCenterIdx(wrapped);

      // Anticipation phase — last ~28% of the spin
      if (!anticipationTriggered && progress > 0.72) {
        anticipationTriggered = true;
        setAnticipation(true);
      }

      // Play tick sound on each new slot — pitch + gain rise as we slow down
      if (wrapped !== lastTick) {
        lastTick = wrapped;
        const speedFactor = 1 - eased;
        if (speedFactor > 0.04) playTick(progress);
      }

      if (progress >= 1) {
        clearInterval(tickIntervalRef.current!);
        setCenterIdx(landIdx % full.length);
        setAnticipation(false);
        setBurstKey(k => k + 1);
      }
    }, 30);

    wheelRef.current.style.transition = 'none';
    wheelRef.current.style.transform = 'translateX(0px)';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!wheelRef.current) return;
      // More dramatic ease-out — lingers longer at the end
      wheelRef.current.style.transition = `transform ${spinDuration}ms cubic-bezier(0.05,0.65,0.18,1)`;
      wheelRef.current.style.transform = `translateX(${finalX}px)`;
    }));
  }

  function animatePayout(target: number) {
    const steps = 45;
    let step = 0;
    const interval = setInterval(() => {
      step++;
      const t = step / steps;
      setDisplayedPayout(Math.floor((1 - Math.pow(1 - t, 3)) * target));
      if (step >= steps) { clearInterval(interval); setDisplayedPayout(target); }
    }, 1200 / steps);
  }

  async function placeBet() {
    if (!session) { showMsg('error', t('auth_required')); return; }
    if (!selectedZone) { showMsg('error', t('bet_err_select')); return; }
    const amount = parseInt(betAmount);
    if (!amount || amount < 1) { showMsg('error', t('bet_err_min')); return; }
    // Keep amount so user can chain bets without retyping

    // Optimistic update — show bet instantly before server confirms
    const userId = (session.user as { id?: string })?.id ?? '';
    const username = session.user?.name ?? '';
    const avatar = session.user?.image ?? null;
    setRound(prev => {
      if (!prev) return prev;
      const existing = prev.bets.find(b => b.user.id === userId && b.zone === selectedZone);
      if (existing) {
        return { ...prev, bets: prev.bets.map(b => b.user.id === userId && b.zone === selectedZone ? { ...b, amount: b.amount + amount } : b) };
      }
      const optimisticBet: RoundBet = { id: `optimistic-${Date.now()}`, zone: selectedZone, amount, user: { id: userId, username, avatar } };
      return { ...prev, bets: [optimisticBet, ...prev.bets] };
    });

    apiClient.post('/roulette/bet', { zone: selectedZone, amount })
      .catch((e: unknown) => {
        const err = e as { response?: { data?: { error?: string } } };
        showMsg('error', err?.response?.data?.error ?? t('common_error'));
        // Rollback optimistic update
        setRound(prev => {
          if (!prev) return prev;
          const existing = prev.bets.find(b => b.user.id === userId && b.zone === selectedZone && !b.id.startsWith('optimistic'));
          if (existing) {
            return { ...prev, bets: prev.bets.map(b => b.user.id === userId && b.zone === selectedZone ? { ...b, amount: b.amount - amount } : b) };
          }
          return { ...prev, bets: prev.bets.filter(b => b.id !== `optimistic-${Date.now()}`) };
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
    if (zone === 'KNIGHTS') return t('roulette_knights');
    if (zone === 'EMPEROR') return t('roulette_emperor');
    return t('roulette_archers');
  };
  const userId = (session?.user as { id?: string })?.id;
  const myZoneBet = round?.bets.find(b => b.user.id === userId && b.zone === selectedZone);

  const zoneTotals = (['KNIGHTS', 'EMPEROR', 'ARCHERS'] as Zone[]).map(z => ({
    zone: z,
    count: round?.bets.filter(b => b.zone === z).length ?? 0,
    total: round?.bets.filter(b => b.zone === z).reduce((s, b) => s + b.amount, 0) ?? 0,
    bets: round?.bets.filter(b => b.zone === z) ?? [],
  }));

  return (
    <div className="min-h-screen relative" style={{ background: '#07060f', color: '#e8e2f5' }}>

      {/* Edge glow on result — only at screen borders, doesn't cover content */}
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
          <h1 className="text-3xl font-bold mb-0.5" style={{ fontFamily:'Cinzel,serif', color:'#f5c842' }}>{t('roulette_title').toUpperCase()}</h1>
          <p className="text-[11px] tracking-widest uppercase" style={{ color:'#6b6488' }}>Age of Empires IV</p>
        </div>

        {/* History + Zone stats */}
        <div className="flex items-start gap-3 mb-5">
          {/* Scrollable history icons */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 flex-1 min-w-0">
            <span className="text-[10px] uppercase tracking-widest text-[#6b6488] shrink-0">{t('roulette_history')}</span>
            {history.slice(0, 20).map(h => {
              const z = ZONES[h.winZone]; const Icon = z.icon;
              return (
                <div key={h.id} className="w-7 h-7 rounded-lg flex flex-col items-center justify-center shrink-0"
                  title={`#${h.result ?? '?'}`}
                  style={{ background:z.bg, border:`1px solid ${z.border}`, boxShadow:`0 0 6px ${z.glow}` }}>
                  <Icon size={10} style={{ color:z.color }} />
                  <span className="text-[7px] font-bold leading-none" style={{ color:z.color }}>{h.result ?? ''}</span>
                </div>
              );
            })}
          </div>

          {/* Last 50 zone stats */}
          {history.length > 0 && (() => {
            const last50 = history.slice(0, 50);
            const total = last50.length;
            return (
              <div className="shrink-0 flex flex-col gap-1 rounded-xl p-2.5" style={{ background:'#0d0b1a', border:'1px solid #1e1a30', minWidth: 130 }}>
                <span className="text-[9px] uppercase tracking-widest text-[#6b6488] mb-0.5">{t('roulette_history')}</span>
                {(['KNIGHTS','EMPEROR','ARCHERS'] as Zone[]).map(zone => {
                  const z = ZONES[zone];
                  const Icon = z.icon;
                  const count = last50.filter(h => h.winZone === zone).length;
                  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                  return (
                    <div key={zone} className="flex items-center gap-1.5">
                      <Icon size={11} style={{ color: z.color, flexShrink: 0 }} />
                      <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background:'#1e1a30' }}>
                        <div className="h-full rounded-full" style={{ width:`${pct}%`, background: z.color, opacity: 0.7 }} />
                      </div>
                      <span className="text-[10px] font-bold tabular-nums" style={{ color: z.color, minWidth: 16, textAlign:'right' }}>{count}</span>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>

        {/* Wheel card */}
        <div className="rounded-2xl mb-5 overflow-hidden" style={{ background:'#0d0b1a', border:'1px solid #1e1a30' }}>

          {/* Status bar */}
          <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom:'1px solid #1e1a30' }}>
            <div />
            <div className="flex items-center gap-3">
              <button onClick={() => setShowFairness(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium hover:opacity-80 transition-opacity"
                style={{ background:'#13111f', border:'1px solid #2a2640', color:'#9990b8' }}>
                <ShieldCheck size={12} style={{ color:'#34d399' }} />
                {t('roulette_fairness')}
              </button>
            </div>
          </div>

          {/* Wheel */}
          <div className="py-6 flex flex-col items-center">

            {/* Timer — centré au-dessus de la roue */}
            <div className="h-10 flex items-center justify-center mb-3">
              {isBetting && countdown > 0 && (
                <span className={cn('text-3xl font-bold tabular-nums', countdown <= 3 && 'rl-urgent')}
                  style={{ fontFamily:'Cinzel,serif', color: countdown <= 3 ? '#f87171' : '#f5c842' }}>
                  {countdown}s
                </span>
              )}
            </div>

            <div className="relative" style={{ width:WHEEL_W, overflow:'hidden' }}>

              {/* Center frame */}
              <div className="absolute inset-y-0 pointer-events-none z-20"
                style={{ left:'50%', transform:'translateX(-50%)', width:ITEM_W,
                  '--gz': isResult && winZone ? ZONES[winZone].glow : anticipation ? '#f5c842' : 'rgba(245,200,66,0.5)' } as React.CSSProperties}>
                <div className={cn('h-full rounded-xl',
                    isSpinning && !anticipation && 'rl-glow-p',
                    isSpinning && anticipation && 'rl-anticipate',
                    isResult && winZone && 'rl-winning')}
                  style={{
                    border:`2.5px solid ${isResult && winZone ? ZONES[winZone].color : isSpinning ? '#f5c842' : '#ffffff20'}`,
                    boxShadow: isSpinning && !anticipation ? '0 0 24px rgba(245,200,66,0.5)' : 'none',
                    '--gz': isResult && winZone ? ZONES[winZone].glow : anticipation ? 'rgba(245,200,66,0.85)' : 'rgba(245,200,66,0.5)',
                    transition:'border-color 0.3s',
                  } as React.CSSProperties} />
                <div className="absolute -top-3 left-1/2 -translate-x-1/2" style={{ width:0,height:0,borderLeft:'8px solid transparent',borderRight:'8px solid transparent',borderTop:`12px solid ${isSpinning ? '#f5c842':'#ffffff30'}` }} />
                <div className="absolute -bottom-3 left-1/2 -translate-x-1/2" style={{ width:0,height:0,borderLeft:'8px solid transparent',borderRight:'8px solid transparent',borderBottom:`12px solid ${isSpinning ? '#f5c842':'#ffffff30'}` }} />
              </div>

              {/* Burst — radial flash centered on the winning slot */}
              {isResult && winZone && (
                <div key={burstKey} className="rl-burst absolute z-30 pointer-events-none rounded-full"
                  style={{
                    left:'50%', top:'50%', width:ITEM_W * 1.6, height:ITEM_W * 1.6,
                    background:`radial-gradient(circle, ${ZONES[winZone].glow} 0%, ${ZONES[winZone].glow.replace(/[\d.]+\)/, '0.2)')} 30%, transparent 70%)`,
                  }} />
              )}

              {/* Top-edge flash overlay on result */}
              {isResult && winZone && (
                <div key={`f${burstKey}`} className="rl-flash absolute inset-0 z-25 pointer-events-none rounded-xl"
                  style={{ background:`radial-gradient(ellipse at center, ${ZONES[winZone].glow} 0%, transparent 60%)` }} />
              )}

              {/* Speed-line shimmer during spin (subtle) */}
              {isSpinning && (
                <div className="absolute inset-y-0 left-0 right-0 z-15 pointer-events-none overflow-hidden">
                  <div className="rl-shimmer absolute inset-y-0 w-32" style={{ background:'linear-gradient(90deg,transparent,rgba(245,200,66,0.18),transparent)' }} />
                </div>
              )}

              {/* Fades — narrow so items stay visible during spin */}
              <div className="absolute inset-y-0 left-0 w-10 z-10 pointer-events-none" style={{ background:'linear-gradient(to right,rgba(13,11,26,0.85),transparent)' }} />
              <div className="absolute inset-y-0 right-0 w-10 z-10 pointer-events-none" style={{ background:'linear-gradient(to left,rgba(13,11,26,0.85),transparent)' }} />

              {/* Strip — ALWAYS fully colored */}
              <div ref={wheelRef} className="flex" style={{ gap:ITEM_GAP }}>
                {displayStrip.map((slot, i) => {
                  const z = ZONES[slot.zone]; const Icon = z.icon;
                  const isCenter = i === centerIdx;
                  const isWinCenter = isResult && isCenter && slot.zone === winZone;
                  return (
                    <div key={i}
                      className="flex-shrink-0 flex flex-col items-center justify-center rounded-xl relative"
                      style={{
                        width:ITEM_W, height:ITEM_W,
                        background: z.bg,
                        border:`1.5px solid ${isCenter ? z.color : z.border}`,
                        boxShadow: isWinCenter ? `0 0 24px ${z.glow}` : isCenter && isSpinning ? `0 0 14px ${z.glow}` : 'none',
                        transform: isCenter ? 'scale(1.06)' : 'scale(1)',
                        transition:'transform 0.08s,box-shadow 0.08s',
                      }}>
                      <Icon size={24} style={{ color: z.color }} />
                      <span className="text-[11px] font-bold mt-0.5 tabular-nums" style={{ color: z.color, opacity: 0.7 }}>{slot.num}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Win/lose */}
            {isResult && winZone && (
              <div className="mt-5 text-center" style={{ animation:'rl-win-in 0.5s cubic-bezier(0.2,1.4,0.4,1) both' }}>
                {userWon && payout ? (
                  <div>
                    <p className="text-[11px] uppercase tracking-widest mb-1 font-bold" style={{ color:ZONES[winZone].color }}>{t('bet_result').toUpperCase()} !</p>
                    <p className="text-5xl font-black" style={{ color:ZONES[winZone].color, fontFamily:'Cinzel,serif', textShadow:`0 0 30px ${ZONES[winZone].glow}` }}>
                      +{displayedPayout.toLocaleString('fr-FR')} ⚜
                    </p>
                    <p className="text-[12px] mt-1.5" style={{ color:'#6b6488' }}>{zoneLabel(winZone)} ×{ZONES[winZone].multiplier}</p>
                  </div>
                ) : userWon === false ? (
                  <div className="rl-shaking">
                    <p className="text-[11px] uppercase tracking-widest mb-1 text-red-400">{t('profile_history_lost').toUpperCase()}</p>
                    <p className="text-2xl font-bold" style={{ color:ZONES[winZone].color, fontFamily:'Cinzel,serif' }}>
                      {zoneLabel(winZone)} ×{ZONES[winZone].multiplier}
                    </p>
                  </div>
                ) : (
                  <p className="text-xl font-bold" style={{ color:ZONES[winZone].color, fontFamily:'Cinzel,serif' }}>
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

        {/* Bet controls */}
        <div className="rounded-xl p-4 mb-5" style={{ background:'#0d0b1a', border:'1px solid #1e1a30' }}>
          {msg && (
            <div className={cn('p-2.5 rounded-lg mb-3 text-[12px]',
              msg.type==='success'?'bg-emerald-950 border border-emerald-800/40 text-emerald-400':'bg-red-950 border border-red-800/40 text-red-400')}>
              {msg.text}
            </div>
          )}
          <div className="flex gap-2 mb-3">
            <div className="relative flex-1">
              <input type="number" value={betAmount} onChange={e=>setBetAmount(e.target.value)}
                placeholder={t('deposit_amount_coins')}
                className="w-full px-3 py-2.5 rounded-lg text-[13px] outline-none text-[#e8e2f5] placeholder:text-[#3d3860] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                style={{ background:'#13111f', border:'1px solid #1e1a30' }} />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[#f5c842] text-[11px]">⚜</span>
            </div>
            {([1,10,100] as number[]).map(v=>(
              <button key={v} onClick={()=>setBetAmount(a=>String((parseInt(a)||0)+v))}
                className="px-3 py-2 rounded-lg text-[11px] font-bold hover:opacity-80"
                style={{ background:'#1e1a30',color:'#9990b8',border:'1px solid #2a2640' }}>+{v}</button>
            ))}
            <button onClick={()=>setBetAmount(a=>String(Math.max(1,Math.floor((parseInt(a)||0)/2))))}
              className="px-3 py-2 rounded-lg text-[11px] font-bold hover:opacity-80"
              style={{ background:'#1e1a30',color:'#9990b8',border:'1px solid #2a2640' }}>½</button>
            <button onClick={()=>setBetAmount(String(userCoins))}
              className="px-3 py-2 rounded-lg text-[11px] font-bold hover:opacity-80"
              style={{ background:'#1e1a30',color:'#9990b8',border:'1px solid #2a2640' }}>MAX</button>
            <button onClick={()=>setBetAmount('')}
              className="px-3 py-2 rounded-lg text-[11px] text-[#6b6488] hover:text-[#9990b8]"
              style={{ background:'#13111f',border:'1px solid #1e1a30' }}>CLR</button>
          </div>
          <button onClick={placeBet} disabled={!isBetting||!selectedZone||!betAmount}
            className="w-full py-3 rounded-lg text-[13px] font-bold transition-all disabled:opacity-40"
            style={{ background:selectedZone ? ZONES[selectedZone].color : '#f5c842', color:'#07060f' }}>
            {!isBetting ? t('bet_closed') :
              !selectedZone ? t('roulette_select_zone') :
              `${t('roulette_bet')} ${betAmount?parseInt(betAmount).toLocaleString('fr-FR'):'...'} ⚜ ${selectedZone?zoneLabel(selectedZone):''}`}
          </button>
          {myZoneBet && isBetting && (
            <p className="text-center text-[11px] mt-2" style={{ color:'#6b6488' }}>
              {t('bet_stake')} : <span style={{ color:selectedZone?ZONES[selectedZone].color:'#f5c842' }}>{myZoneBet.amount.toLocaleString('fr-FR')} ⚜</span>
            </p>
          )}
        </div>

        {/* 3 zones */}
        <div className="grid grid-cols-3 gap-4">
          {zoneTotals.map(({ zone, count, total, bets }) => {
            const z = ZONES[zone]; const Icon = z.icon;
            const isSelected = selectedZone === zone;
            const isWin = isResult && winZone === zone;
            // Only shake if user actually bet on THIS zone and it lost
            const userBetThisZone = !!round?.bets.find(b => b.user.id === userId && b.zone === zone);
            const isLose = isResult && winZone !== zone && userBetThisZone;
            return (
              <div key={zone}
                onClick={()=>isBetting&&setSelectedZone(zone)}
                className={cn('rounded-xl overflow-hidden transition-all', isBetting&&'cursor-pointer', isLose&&'rl-shaking')}
                style={{
                  background:'#0d0b1a',
                  border:`1px solid ${isSelected||isWin ? z.color : '#1e1a30'}`,
                  boxShadow: isWin ? `0 0 32px ${z.glow}` : isSelected ? `0 0 18px ${z.glow}` : 'none',
                  transform: isSelected&&!isResult ? 'translateY(-3px)' : 'none',
                  '--gz': z.glow,
                } as React.CSSProperties}>
                <div className={cn('p-4 flex items-center justify-between', isWin&&'rl-winning')}
                  style={{ borderBottom:'1px solid #1e1a3050', '--gz':z.glow } as React.CSSProperties}>
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center"
                      style={{ background:z.bg, border:`1px solid ${z.border}`, boxShadow:`0 0 8px ${z.glow}` }}>
                      <Icon size={18} style={{ color:z.color }} />
                    </div>
                    <p className="font-bold text-[13px]" style={{ color:z.color, fontFamily:'Cinzel,serif' }}>{zoneLabel(zone)}</p>
                  </div>
                  <p className="text-[22px] font-bold" style={{ color:z.color, fontFamily:'Cinzel,serif', textShadow:isWin?`0 0 20px ${z.glow}`:'none' }}>×{z.multiplier}</p>
                </div>
                <div className="px-4 py-2 flex justify-between text-[11px]" style={{ borderBottom:'1px solid #1e1a3030' }}>
                  <span style={{ color:'#6b6488' }}>{count} {t('lb_bets').toLowerCase()}</span>
                  <span className="font-bold" style={{ color:z.color }}>{total.toLocaleString('fr-FR')} ⚜</span>
                </div>
                <div className="p-2 max-h-52 overflow-y-auto space-y-0.5">
                  {bets.length===0&&<p className="text-center text-[11px] py-4" style={{ color:'#3d3860' }}>{t('lb_empty')}</p>}
                  {bets.map(bet=>(
                    <div key={bet.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[#13111f] transition-colors">
                      {bet.user.avatar
                        ?<img src={bet.user.avatar} alt="" className="w-5 h-5 rounded-full shrink-0"/>
                        :<div className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[9px] font-bold"
                           style={{ background:z.bg,color:z.color }}>{bet.user.username[0]?.toUpperCase()}</div>}
                      <span className="text-[11px] text-[#c8c0e0] truncate flex-1">{bet.user.username}</span>
                      <span className="text-[11px] font-bold shrink-0" style={{ color:z.color }}>{bet.amount.toLocaleString('fr-FR')} ⚜</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {!round&&(
          <div className="mt-6 text-center p-4 rounded-xl" style={{ background:'#0d0b1a',border:'1px solid #1e1a30' }}>
            <p className="text-[13px]" style={{ color:'#6b6488' }}>{t('common_loading')}</p>
          </div>
        )}
      </div>

      {/* ── Fairness Guide Modal ── */}
      {showFairnessGuide && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center px-4"
          style={{ background:'rgba(7,6,15,0.88)', backdropFilter:'blur(6px)' }}
          onClick={() => setShowFairnessGuide(false)}>
          <div className="w-full max-w-2xl rounded-2xl overflow-hidden max-h-[85vh] flex flex-col"
            style={{ background:'#0d0b1a', border:'1px solid #1e1a30', boxShadow:'0 0 60px rgba(212,160,23,0.12)' }}
            onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 shrink-0" style={{ borderBottom:'1px solid #1e1a30' }}>
              <div className="flex items-center gap-2">
                <ShieldCheck size={16} style={{ color:'#34d399' }} />
                <span className="font-bold text-[14px] tracking-widest" style={{ fontFamily:'Cinzel,serif', color:'#e8e2f5' }}>FAIRNESS</span>
              </div>
              <button onClick={() => setShowFairnessGuide(false)} className="hover:opacity-60 transition-opacity">
                <X size={16} style={{ color:'#6b6488' }} />
              </button>
            </div>

            {/* Scrollable content */}
            <div className="overflow-y-auto px-6 py-5 space-y-5 text-[12px] leading-relaxed" style={{ color:'#9990b8' }}>

              <p style={{ color:'#c8c0e0' }}>{t('fair_system')}</p>
              <p>{t('fair_all_games')}</p>

              {/* How it works */}
              <div>
                <h3 className="font-bold text-[13px] mb-2" style={{ color:'#e8e2f5', fontFamily:'Cinzel,serif' }}>{t('fair_how_works')}</h3>
                <p className="mb-2">{t('fair_seed_p1')}</p>
                <p>{t('fair_seed_p2')}</p>
              </div>

              <div style={{ height:1, background:'#1e1a30' }} />

              {/* Roulette section */}
              <div>
                <h3 className="font-bold text-[13px] mb-2" style={{ color:'#f5c842', fontFamily:'Cinzel,serif' }}>Roulette</h3>
                <p className="mb-2">{t('fair_roulette_p1')}</p>
                <p className="mb-3">
                  {t('fair_slots_intro')}{' '}
                  <code className="px-1.5 py-0.5 rounded text-[11px]" style={{ background:'#13111f', color:'#c8c0e0' }}>
                    1 (K) · 2 (K) · 3 (A) · 4 (K) · 5 (A) · 6 (K) · 7 (A) · 8 (E) · 9 (A) · 10 (K) · 11 (A) · 12 (K) · 13 (A) · 14 (K) · 15 (A)
                  </code>
                  <br />
                  <span className="text-[11px]" style={{ color:'#6b6488' }}>K = {t('roulette_knights')} ×2 · A = {t('roulette_archers')} ×2 · E = {t('roulette_emperor')} ×14</span>
                </p>
                <p>
                  {t('fair_formula')}{' '}
                  <code className="px-1.5 py-0.5 rounded text-[11px]" style={{ background:'#13111f', color:'#f5c842' }}>
                    slot = (parseInt(SHA256(seed).slice(0,8), 16) % 15) + 1
                  </code>
                </p>
              </div>

              <div style={{ height:1, background:'#1e1a30' }} />

              {/* Random.org section */}
              <div>
                <h3 className="font-bold text-[13px] mb-2" style={{ color:'#e8e2f5', fontFamily:'Cinzel,serif' }}>{t('fair_random_title')}</h3>
                <p className="mb-2">
                  {t('fair_random_p1')}{' '}
                  <a href="https://api.random.org/verify" target="_blank" rel="noopener noreferrer"
                    className="underline hover:opacity-80 transition-opacity" style={{ color:'#34d399' }}>
                    api.random.org/verify
                  </a>.
                </p>
                <p>{t('fair_random_p2')}</p>
              </div>

              <div style={{ height:1, background:'#1e1a30' }} />

              <p style={{ color:'#4a4468' }}>{t('fair_contact')}</p>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 shrink-0 flex justify-between items-center" style={{ borderTop:'1px solid #1e1a30' }}>
              <button onClick={() => { setShowFairnessGuide(false); setShowFairness(true); }}
                className="text-[11px] hover:opacity-80 transition-opacity" style={{ color:'#6b6488' }}>
                ← {t('deposit_back')}
              </button>
              <button onClick={() => setShowFairnessGuide(false)}
                className="px-4 py-2 rounded-lg text-[12px] font-bold hover:opacity-80 transition-opacity"
                style={{ background:'#d4a017', color:'#07060f' }}>
                {t('deposit_confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Provably Fair Modal ── */}
      {showFairness && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center px-4"
          style={{ background:'rgba(7,6,15,0.85)', backdropFilter:'blur(6px)' }}
          onClick={() => setShowFairness(false)}>
          <div className="w-full max-w-lg rounded-2xl overflow-hidden"
            style={{ background:'#0d0b1a', border:'1px solid #1e1a30', boxShadow:'0 0 60px rgba(212,160,23,0.15)' }}
            onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom:'1px solid #1e1a30' }}>
              <div className="flex items-center gap-2">
                <ShieldCheck size={16} style={{ color:'#34d399' }} />
                <span className="font-bold text-[14px] tracking-widest" style={{ fontFamily:'Cinzel,serif', color:'#e8e2f5' }}>FAIRNESS</span>
              </div>
              <button onClick={() => setShowFairness(false)} className="hover:opacity-60 transition-opacity">
                <X size={16} style={{ color:'#6b6488' }} />
              </button>
            </div>

            {/* Intro */}
            <div className="px-6 py-4 text-[12px] leading-relaxed space-y-1" style={{ borderBottom:'1px solid #1e1a30' }}>
              <p style={{ color:'#9990b8' }}>{t('fair_system')}</p>
              <p>
                <span style={{ color:'#9990b8' }}>{t('fair_hash_before')} </span>
                <span style={{ color:'#34d399' }}>{t('fair_before_spin')}</span>
                <span style={{ color:'#9990b8' }}> {t('fair_seed_after')} </span>
                <span style={{ color:'#34d399' }}>{t('fair_after_result')}</span>
                <span style={{ color:'#9990b8' }}>{t('fair_verify_via')} </span>
                <a href="https://api.random.org/verify" target="_blank" rel="noopener noreferrer"
                  className="underline hover:opacity-80 transition-opacity"
                  style={{ color:'#34d399' }}>
                  api.random.org/verify
                </a>
                <span style={{ color:'#9990b8' }}>{t('fair_more_details')} </span>
                <button onClick={() => { setShowFairness(false); setShowFairnessGuide(true); }}
                  className="underline hover:opacity-80 transition-opacity"
                  style={{ color:'#34d399', background:'none', border:'none', padding:0, cursor:'pointer', font:'inherit' }}>
                  {t('fair_here')}
                </button>
                <span style={{ color:'#9990b8' }}>.</span>
              </p>
            </div>

            {/* Source badge */}
            <div className="px-6 pt-4 pb-0 flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold"
                style={{ background: fairnessRound?.source === 'random.org' ? 'rgba(52,211,153,0.1)' : 'rgba(99,102,241,0.1)', border: `1px solid ${fairnessRound?.source === 'random.org' ? '#34d39940' : '#6366f140'}`, color: fairnessRound?.source === 'random.org' ? '#34d399' : '#818cf8' }}>
                {fairnessRound?.source === 'random.org' ? '✓ random.org' : fairnessRound?.source === 'crypto' ? '✓ crypto fallback' : 'result pending'}
              </div>
            </div>

            {/* Data rows */}
            <div className="px-6 py-4 space-y-3">
              {(() => {
                const isRandomOrg = fairnessRound?.source === 'random.org';
                const roll = fairnessRound?.result;
                const rows = isRandomOrg ? [
                  { label: 'Game ID',      value: fairnessRound?.id ?? '',         key: 'id'   },
                  { label: 'Serial N°',    value: fairnessRound?.roundHash ?? '',   key: 'hash' },
                  { label: 'Result (1-15)',value: roll != null ? String(roll) : '', key: 'roll' },
                  { label: 'Signature',    value: fairnessRound?.serverSeed ?? '',  key: 'seed' },
                ] : [
                  { label: 'Game ID',      value: fairnessRound?.id ?? '',          key: 'id'   },
                  { label: 'Round Hash',   value: fairnessRound?.roundHash ?? '',   key: 'hash' },
                  { label: 'Round Seed',   value: fairnessRound?.serverSeed ?? '',  key: 'seed' },
                  { label: 'Result (1-15)',value: roll != null ? String(roll) : '', key: 'roll' },
                ];
                return rows.map(({ label, value, key }) => (
                  <div key={key} className="flex items-start justify-between gap-3">
                    <span className="text-[11px] shrink-0 mt-0.5" style={{ color:'#6b6488', minWidth: 90 }}>{label}:</span>
                    <div className="flex items-center gap-2 flex-1 min-w-0 px-3 py-2 rounded-lg"
                      style={{ background:'#13111f', border:'1px solid #1a1730' }}>
                      <span className="flex-1 text-[11px] font-mono break-all" style={{ color: '#c8c0e0' }}>
                        {value || <span style={{ color:'#3d3860' }}>—</span>}
                      </span>
                      {value !== '' && (
                        <button onClick={() => copyToClipboard(value, key)} className="shrink-0 hover:opacity-70 transition-opacity">
                          {copied === key ? <Check size={12} style={{ color:'#34d399' }} /> : <Copy size={12} style={{ color:'#4a4468' }} />}
                        </button>
                      )}
                    </div>
                  </div>
                ));
              })()}
            </div>

            {/* Verify block */}
            <div className="mx-6 mb-5 rounded-lg p-4" style={{ background:'#13111f', border:'1px solid #1a1730' }}>
              {fairnessRound?.source === 'random.org' ? (
                <div className="space-y-2">
                  <p className="text-[10px]" style={{ color:'#6b6488' }}>Vérifiez ce résultat sur random.org :</p>
                  <a href="https://api.random.org/signatures/form" target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 text-[11px] font-bold hover:opacity-80 transition-opacity"
                    style={{ color:'#34d399' }}>
                    <ShieldCheck size={12} /> api.random.org/signatures/form →
                  </a>
                  <p className="text-[10px]" style={{ color:'#4a4468' }}>Collez la Signature et le Serial N° pour vérifier l&apos;authenticité.</p>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-[10px] font-mono" style={{ color:'#6b6488' }}>SHA256(Seed) = Hash · slot = (parseInt(Hash[0..8], 16) % 15) + 1</p>
                </div>
              )}
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
