'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { apiClient, setAuthToken } from '@/lib/api';
import { Shield, Crown, Target, ShieldCheck, X, Copy, Check } from 'lucide-react';
import { playWololo, playTick, playWin, playLose, playEmperorWin } from '@/lib/rouletteSounds';
import nextDynamic from 'next/dynamic';
// react-roulette-pro is client-only; dynamic import avoids SSR issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const RoulettePro = nextDynamic<any>(() => import('react-roulette-pro'), { ssr: false });
import 'react-roulette-pro/dist/index.css';

const ZONES = {
  KNIGHTS: { label: 'CHEVALIERS', multiplier: 2,  color: '#94a3b8', glow: 'rgba(148,163,184,0.4)', border: '#475569',    bg: 'rgba(71,85,105,0.3)',      icon: Shield },
  EMPEROR: { label: 'EMPEROR',    multiplier: 14, color: '#ffd97a', glow: 'rgba(245,200,66,0.55)',  border: '#ffc54280',  bg: 'rgba(255,197,66,0.15)',    icon: Crown  },
  ARCHERS: { label: 'ARCHERS',    multiplier: 2,  color: '#fb923c', glow: 'rgba(251,146,60,0.45)',  border: '#c2410c80',  bg: 'rgba(194,65,12,0.15)',     icon: Target },
} as const;
type Zone = keyof typeof ZONES;

// 15-slot wheel — alternating KNIGHTS/ARCHERS visually with EMPEROR in the middle
// Numbers MUST match backend mapping: 1-7=KNIGHTS, 8=EMPEROR, 9-15=ARCHERS
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
@keyframes rl-urgent { 0%,100%{opacity:1} 50%{opacity:0.6} }
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
.rl-urgent      { animation:rl-urgent 1s ease-in-out infinite; }
.rl-glow-p      { animation:rl-glow-pulse 0.8s ease-in-out infinite; }
.rl-anticipate  { animation:rl-anticipate 0.5s ease-in-out infinite; }
.rl-burst       { animation:rl-burst 0.85s cubic-bezier(0.16,0.84,0.44,1) forwards; }
.rl-flash       { animation:rl-flash 0.55s ease-out forwards; }
.rl-shimmer     { animation:rl-shimmer 1.4s ease-in-out infinite; }
.rl-page-shake  { animation:rl-page-shake 0.4s ease-in-out 2; }
`;

function RoulettePageImpl() {
  const { data: session } = useSession();
  const { t } = useT();
  const [round, setRound] = useState<Round | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [selectedZone, setSelectedZone] = useState<Zone | null>(null);
  const [betAmount, setBetAmount] = useState('');
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [countdownExact, setCountdownExact] = useState(0); // float for smooth arc
  const [phase, setPhase] = useState<'idle' | 'betting' | 'spinning' | 'result'>('idle');
  const [winZone, setWinZone] = useState<Zone | null>(null);
  const [userWon, setUserWon] = useState<boolean | null>(null);
  const [payout, setPayout] = useState<number | null>(null);
  const [displayedPayout, setDisplayedPayout] = useState(0);
  const [anticipation, setAnticipation] = useState(false);
  const [burstKey, setBurstKey] = useState(0); // re-trigger burst on each new result
  const [showFairness, setShowFairness] = useState(false);
  const [showFairnessGuide, setShowFairnessGuide] = useState(false);
  const [fairnessRound, setFairnessRound] = useState<{ id: string; roundHash: string | null; serverSeed: string | null; result: number | null; winZone: Zone | null; source?: 'random.org' | 'crypto' } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownMaxRef = useRef(30); // total betting window duration for the ring arc
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wololoPlayedRef = useRef(false);
  const spinEndsAtRef = useRef<number>(0); // timestamp when current spin animation ends
  const hasAnimatedRef = useRef(false); // true once animateSpin has been called this session

  // ── react-roulette-pro state ─────────────────────────────────────────────
  // Lib feeds horizontal animation; we provide a custom designPlugin so it
  // computes its offsets with OUR slot dimensions (88px wide) instead of the
  // default 205px which would offset everything wrong.
  const [wheelStart, setWheelStart] = useState(false);
  const [wheelPrizeIndex, setWheelPrizeIndex] = useState(0);
  // When true, the lib skips the spin animation and jumps straight to the
  // prize — used when the tab was backgrounded during the spin so we don't
  // spoil the result by animating after the burst/flash.
  const [wheelSkipAnim, setWheelSkipAnim] = useState(false);
  // Stored pending events when the tab is hidden — flushed on visibility change
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pendingResultRef = useRef<any | null>(null);
  const pendingSpinRef = useRef<{ wz: Zone; resultNum?: number; at: number } | null>(null);

  // Prize list: BASE_PATTERN repeated REPEATS times. id must be unique.
  // image is a 1x1 transparent gif so the lib never tries to load anything.
  const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const prizeList = useMemo(() => {
    const items: { id: string; image: string; zone: Zone; num: number }[] = [];
    for (let r = 0; r < REPEATS; r++) {
      for (let i = 0; i < BASE_PATTERN.length; i++) {
        const slot = BASE_PATTERN[i];
        items.push({ id: `r${r}-${i}-${slot.num}`, image: PIXEL, zone: slot.zone, num: slot.num });
      }
    }
    return items;
  }, []);

  // Custom design plugin — tells the lib our items are 88x86 (matching ITEM_W
  // + ITEM_GAP). Without this, the lib uses its default 205x174 and nothing
  // visually aligns. The render function returns OUR styled slot.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wheelDesignPlugin = useCallback(() => ({
    prizeItemWidth: ITEM_W + ITEM_GAP,   // 88px
    prizeItemHeight: ITEM_W + 6,         // 86px
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prizeItemRenderFunction: (prize: any) => {
      const slot = prize as { zone: Zone; num: number };
      const z = ZONES[slot.zone];
      const Icon = z.icon;
      return (
        <div
          className="rl-pro-slot"
          style={{
            width: ITEM_W,
            height: ITEM_W,
            background: z.bg,
            border: `1.5px solid ${z.border}`,
            borderRadius: 12,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            margin: `3px ${ITEM_GAP / 2}px`,
            boxSizing: 'border-box',
          }}
        >
          <Icon size={24} style={{ color: z.color }} />
          <span
            style={{
              color: z.color,
              opacity: 0.7,
              fontSize: 11,
              fontWeight: 700,
              marginTop: 2,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {slot.num}
          </span>
        </div>
      );
    },
  }), []);

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

  // Flush a pending result (set when the tab was hidden) — snaps the wheel
  // to the final prize without animation, plays the post-result effects.
  const applyPendingResult = useCallback(() => {
    const d = pendingResultRef.current;
    if (!d) return;
    pendingResultRef.current = null;
    if (tickIntervalRef.current) clearInterval(tickIntervalRef.current);
    hasAnimatedRef.current = false;

    // Recompute the landing index for the current prizeList so the snap lands
    // on the correct slot (the animateSpin version may not have run).
    const target = Math.floor(prizeList.length * 0.78);
    let landIdx = target;
    for (let i = 0; i < 60; i++) {
      const idx = (target + i) % prizeList.length;
      const slot = prizeList[idx];
      if (d.result != null) {
        if (slot.num === d.result) { landIdx = idx; break; }
      } else if (slot.zone === d.winZone) { landIdx = idx; break; }
    }

    // Snap the wheel to the final slot without animation
    setWheelSkipAnim(true);
    setWheelStart(false);
    setWheelPrizeIndex(landIdx);
    setTimeout(() => setWheelStart(true), 10);
    // Clear skip after a short while so the next real spin animates normally
    setTimeout(() => setWheelSkipAnim(false), 300);

    setAnticipation(false);
    setPhase('result');
    setWinZone(d.winZone);
    setBurstKey(k => k + 1);
    setFairnessRound({ id: d.roundId, roundHash: d.roundHash ?? null, serverSeed: d.serverSeed ?? null, result: d.result ?? null, winZone: d.winZone, source: d.source });
    setRound(prev => prev ? { ...prev, status: 'COMPLETED', winZone: d.winZone } : prev);

    // Win / lose sound + payout using the current round's bets
    setRound(prev => {
      if (!prev) return prev;
      const userId = (session?.user as { id?: string })?.id;
      const myBetOnWin = prev.bets.find(b => b.zone === d.winZone && b.user.id === userId);
      const didBet = prev.bets.some(b => b.user.id === userId);
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
  }, [prizeList, session, fetchAll]); // eslint-disable-line react-hooks/exhaustive-deps

  // When user comes back to the tab, decide how to flush buffered events
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) return;

      // Priority #1: a result has already arrived while hidden
      //   → snap wheel to final slot, play burst/sound immediately
      if (pendingResultRef.current) {
        if (tickIntervalRef.current) clearInterval(tickIntervalRef.current);
        pendingSpinRef.current = null; // result supersedes spin
        applyPendingResult();
        return;
      }

      // Priority #2: spin was buffered, result hasn't arrived yet
      //   → start a fresh animation now, the result handler will fire later
      if (pendingSpinRef.current) {
        const { wz, resultNum } = pendingSpinRef.current;
        pendingSpinRef.current = null;
        if (!wololoPlayedRef.current) { wololoPlayedRef.current = true; playWololo(0.3); }
        animateSpin(wz, resultNum);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [applyPendingResult]); // eslint-disable-line react-hooks/exhaustive-deps

  // Countdown
  useEffect(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (!round?.endsAt || round.status !== 'BETTING') { setCountdown(0); setCountdownExact(0); return; }
    // Capture the total window duration once per round for the arc fill ratio
    const initial = Math.max(0, (new Date(round.endsAt!).getTime() - Date.now()) / 1000);
    if (initial > 0) countdownMaxRef.current = initial;
    const tick = () => {
      const remaining = Math.max(0, (new Date(round.endsAt!).getTime() - Date.now()) / 1000);
      setCountdown(Math.ceil(remaining));    // integer for the number display
      setCountdownExact(remaining);          // float for smooth arc
    };
    tick();
    countdownRef.current = setInterval(tick, 50); // 50ms → smooth arc
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
    });
    s.on('roulette:betsUpdate', (d: { roundId: string; bets: RoundBet[] }) => {
      setRound(prev => prev?.id === d.roundId ? { ...prev, bets: d.bets } : prev);
    });
    s.on('roulette:spin', (d: { winZone: Zone; multiplier: number; result?: number }) => {
      setPhase('spinning');
      setRound(prev => prev ? { ...prev, status: 'SPINNING' } : prev);
      // If the tab is hidden, buffer the spin. It will either:
      //  - be flushed into a real animation when the user comes back early, OR
      //  - be overridden by pendingResultRef and snap to the result at the end.
      if (document.hidden) {
        pendingSpinRef.current = { wz: d.winZone, resultNum: d.result, at: Date.now() };
        return;
      }
      // Play Wololo the instant the spin actually starts
      if (!wololoPlayedRef.current) { wololoPlayedRef.current = true; playWololo(0.3); }
      animateSpin(d.winZone, d.result);
    });
    s.on('roulette:result', (d: { winZone: Zone; multiplier: number; serverSeed?: string; roundHash?: string; result?: number; roundId: string; source?: 'random.org' | 'crypto' }) => {
      // If the tab is hidden, store the result and flush it on visibility change
      // so the user doesn't get spoiled by a delayed animation.
      if (document.hidden) {
        pendingResultRef.current = d;
        return;
      }
      // Wait for spin animation to finish before showing result
      const remaining = spinEndsAtRef.current - Date.now();
      const delay = Math.max(0, remaining + 300); // +300ms buffer after animation

      setTimeout(() => {
        // If tab went hidden between the scheduling and the fire, defer again
        if (document.hidden) {
          pendingResultRef.current = d;
          return;
        }
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

  function animateSpin(wz: Zone, resultNum?: number) {
    hasAnimatedRef.current = true;
    if (tickIntervalRef.current) clearInterval(tickIntervalRef.current);
    setAnticipation(false);

    // Pick a target index in prizeList that matches the result number (or zone)
    // Land deep into the array (~80%) so the lib has plenty of runway.
    const target = Math.floor(prizeList.length * 0.78);
    let landIdx = target;
    for (let i = 0; i < 60; i++) {
      const idx = (target + i) % prizeList.length;
      const slot = prizeList[idx];
      if (resultNum != null) {
        if (slot.num === resultNum) { landIdx = idx; break; }
      } else if (slot.zone === wz) {
        landIdx = idx; break;
      }
    }

    const spinDuration = 6500; // ms
    const startTime = Date.now();
    spinEndsAtRef.current = startTime + spinDuration;

    // Reset start to false then re-true so the lib re-triggers the spin animation
    setWheelStart(false);
    setWheelPrizeIndex(landIdx);
    setTimeout(() => setWheelStart(true), 30);

    // Parallel timer for tick sounds + anticipation phase (not synced to actual
    // slot crossings, but progression feels right relative to elapsed time).
    let lastTick = -1;
    let anticipationTriggered = false;
    tickIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(1, elapsed / spinDuration);
      const eased = 1 - Math.pow(1 - progress, 3.4);
      const slotsTraveled = Math.floor(eased * 60);

      if (!anticipationTriggered && progress > 0.72) {
        anticipationTriggered = true;
        setAnticipation(true);
      }
      if (slotsTraveled !== lastTick) {
        lastTick = slotsTraveled;
        const speedFactor = 1 - eased;
        if (speedFactor > 0.04) playTick(progress);
      }
      if (progress >= 1) {
        clearInterval(tickIntervalRef.current!);
        setAnticipation(false);
        setBurstKey(k => k + 1);
      }
    }, 30);
  }

  function animatePayout(target: number) {
    // Slower ramp (2.2s) so the user can actually read the number ticking up
    const duration = 2200;
    const steps = 60;
    let step = 0;
    const interval = setInterval(() => {
      step++;
      const t = step / steps;
      // Ease-out cubic for satisfying deceleration
      setDisplayedPayout(Math.floor((1 - Math.pow(1 - t, 3)) * target));
      if (step >= steps) { clearInterval(interval); setDisplayedPayout(target); }
    }, duration / steps);
  }

  async function placeBet() {
    if (!session) { showMsg('error', t('auth_required')); return; }
    if (!selectedZone) { showMsg('error', t('bet_err_select')); return; }
    const amount = parseInt(betAmount);
    if (!amount || amount < 1) { showMsg('error', t('roulette_err_min')); return; }
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
          <h1 className="text-3xl font-bold mb-0.5" style={{ fontFamily:'Cinzel,serif', color:'#ffd97a' }}>{t('roulette_title').toUpperCase()}</h1>
          <p className="text-[11px] tracking-widest uppercase" style={{ color:'#6b6488' }}>#1 Age of Empire</p>
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

            {/* Timer — circular progress ring */}
            <div className="h-16 flex items-center justify-center mb-3">
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
                const color = isUrgent ? '#f87171' : isWarning ? '#fb923c' : '#ffd97a';
                const glow  = isUrgent ? 'rgba(248,113,113,0.75)' : isWarning ? 'rgba(251,146,60,0.65)' : 'rgba(245,200,66,0.55)';
                return (
                  <div className={cn('relative flex items-center justify-center', isUrgent && 'rl-urgent')}
                    style={{ width: SIZE, height: SIZE }}>
                    <svg width={SIZE} height={SIZE} className="absolute" style={{ transform: 'rotate(-90deg)' }}>
                      {/* Track */}
                      <circle cx={SIZE/2} cy={SIZE/2} r={R} fill="none" stroke="#1e1a30" strokeWidth={SW} />
                      {/* Arc */}
                      <circle
                        cx={SIZE/2} cy={SIZE/2} r={R}
                        fill="none"
                        stroke={color}
                        strokeWidth={SW}
                        strokeDasharray={CIRC}
                        strokeDashoffset={dashOffset}
                        strokeLinecap="round"
                        style={{
                          transition: 'stroke 0.35s',
                          filter: `drop-shadow(0 0 5px ${glow})`,
                        }}
                      />
                    </svg>
                    <span className="relative z-10 font-bold tabular-nums"
                      style={{ fontSize: 14, color, fontFamily: 'Cinzel,serif', lineHeight: 1 }}>
                      {countdown}
                    </span>
                  </div>
                );
              })()}
            </div>

            <div className="relative" style={{ width:WHEEL_W, overflow:'hidden' }}>

              {/* Custom vertical center bar (replaces the old rectangular frame) */}
              {(() => {
                const barColor = isResult && winZone
                  ? ZONES[winZone].color
                  : anticipation
                  ? '#ffd97a'
                  : isSpinning
                  ? '#ffd97a'
                  : '#ffc542';
                const glowColor = isResult && winZone
                  ? ZONES[winZone].glow
                  : 'rgba(245,200,66,0.6)';
                return (
                  <div
                    className={cn(
                      'absolute pointer-events-none z-30',
                      isSpinning && !anticipation && 'rl-glow-p',
                      isSpinning && anticipation && 'rl-anticipate',
                      isResult && winZone && 'rl-winning'
                    )}
                    style={{
                      left: '50%',
                      top: -8,
                      bottom: -8,
                      width: 4,
                      transform: 'translateX(-50%)',
                      background: `linear-gradient(180deg, transparent 0%, ${barColor} 12%, ${barColor} 88%, transparent 100%)`,
                      boxShadow: `0 0 16px ${glowColor}, 0 0 32px ${glowColor}`,
                      borderRadius: 2,
                      transition: 'background 0.3s, box-shadow 0.3s',
                      '--gz': glowColor,
                    } as React.CSSProperties}
                  >
                    {/* Top arrow indicator */}
                    <div
                      className="absolute left-1/2"
                      style={{
                        top: -6,
                        transform: 'translateX(-50%)',
                        width: 0,
                        height: 0,
                        borderLeft: '7px solid transparent',
                        borderRight: '7px solid transparent',
                        borderTop: `10px solid ${barColor}`,
                        filter: `drop-shadow(0 0 6px ${glowColor})`,
                      }}
                    />
                    {/* Bottom arrow indicator */}
                    <div
                      className="absolute left-1/2"
                      style={{
                        bottom: -6,
                        transform: 'translateX(-50%)',
                        width: 0,
                        height: 0,
                        borderLeft: '7px solid transparent',
                        borderRight: '7px solid transparent',
                        borderBottom: `10px solid ${barColor}`,
                        filter: `drop-shadow(0 0 6px ${glowColor})`,
                      }}
                    />
                  </div>
                );
              })()}

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

              {/* Wheel powered by react-roulette-pro with custom designPlugin */}
              {/* The CSS overrides below kill the lib's default 205x174 boxes,    */}
              {/* default borders/backgrounds, and image-wrapper height.          */}
              <style>{`
                .rl-wheel-host .roulette-pro-prize-item-wrapper,
                .rl-wheel-host .roulette-pro-regular-prize-item-wrapper,
                .rl-wheel-host ul li.roulette-pro-regular-prize-item-wrapper {
                  width: ${ITEM_W + ITEM_GAP}px !important;
                  height: ${ITEM_W + 6}px !important;
                  background: transparent !important;
                  border: 0 !important;
                  padding: 0 !important;
                  margin: 0 !important;
                }
                .rl-wheel-host .roulette-pro-regular-image-wrapper,
                .rl-wheel-host .roulette-pro-regular-prize-item-image,
                .rl-wheel-host .roulette-pro-regular-prize-item-text {
                  display: none !important;
                }
                /* Hide the lib's default red center bar — we draw our own */
                .rl-wheel-host .roulette-pro-regular-design-top,
                .rl-wheel-host .roulette-pro-regular-design-top.horizontal,
                .rl-wheel-host div[class*="roulette-pro-regular-design-top"] {
                  display: none !important;
                  visibility: hidden !important;
                  opacity: 0 !important;
                  width: 0 !important;
                  height: 0 !important;
                }
                .rl-wheel-host .roulette-pro-prize-list,
                .rl-wheel-host .roulette-pro-prize-list.horizontal {
                  padding: 0 !important;
                  margin: 0 !important;
                }
                .rl-wheel-host .roulette-pro-wrapper {
                  height: ${ITEM_W + 6}px !important;
                  overflow: visible !important;
                }
              `}</style>
              <div className="rl-wheel-host" style={{ height: ITEM_W + 6, width: '100%' }}>
                <RoulettePro
                  type="horizontal"
                  start={wheelStart}
                  prizes={prizeList}
                  prizeIndex={wheelPrizeIndex}
                  spinningTime={6.5}
                  designPlugin={wheelDesignPlugin}
                  options={{ withoutAnimation: wheelSkipAnim }}
                  onPrizeDefined={() => {
                    setBurstKey((k) => k + 1);
                    setAnticipation(false);
                  }}
                />
              </div>
            </div>

            {/* Win/lose — payout number removed per design.
                The wallet in the navbar now shows the count-up instead. */}
            {isResult && winZone && (
              <div className="mt-5 text-center" style={{ animation:'rl-win-in 0.5s cubic-bezier(0.2,1.4,0.4,1) both' }}>
                {userWon && payout ? (
                  <div className="inline-flex items-center gap-2">
                    <span className="text-[13px] font-bold uppercase tracking-wider" style={{ color: ZONES[winZone].color, opacity: 0.9, fontFamily: 'Cinzel,serif' }}>
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
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[#ffd97a] text-[11px]">⚜</span>
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
            className="w-full py-3 rounded-lg text-[14px] font-bold font-cinzel tracking-wider transition-all disabled:opacity-40"
            style={{ background:selectedZone ? ZONES[selectedZone].color : '#ffd97a', color:'#07060f' }}>
            {!isBetting ? t('bet_closed') :
              !selectedZone ? t('roulette_select_zone') :
              `${t('roulette_bet')} ${betAmount ? parseInt(betAmount).toLocaleString('fr-FR') : '...'} ⚜`}
          </button>
          {myZoneBet && isBetting && (
            <p className="text-center text-[11px] mt-2" style={{ color:'#6b6488' }}>
              {t('bet_stake')} : <span style={{ color:selectedZone?ZONES[selectedZone].color:'#ffd97a' }}>{myZoneBet.amount.toLocaleString('fr-FR')} ⚜</span>
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
            style={{ background:'#0d0b1a', border:'1px solid #1e1a30', boxShadow:'0 0 60px rgba(255,197,66,0.12)' }}
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
                <h3 className="font-bold text-[13px] mb-2" style={{ color:'#ffd97a', fontFamily:'Cinzel,serif' }}>Roulette</h3>
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
                  <code className="px-1.5 py-0.5 rounded text-[11px]" style={{ background:'#13111f', color:'#ffd97a' }}>
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
                style={{ background:'#ffc542', color:'#07060f' }}>
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
            style={{ background:'#0d0b1a', border:'1px solid #1e1a30', boxShadow:'0 0 60px rgba(255,197,66,0.15)' }}
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

/**
 * Hydration-safe wrapper. The roulette page mixes Web Audio, react-roulette-pro
 * (which renders divs with computed transform offsets), and several useState
 * initializers fed by Date.now() / sessionStorage indirectly via useEffect —
 * any of those can produce a server/client diff and trip React #425
 * ("Switched to client rendering because the server rendering errored").
 *
 * Rendering the body only after the first client effect skips SSR for this
 * subtree entirely, which is fine since the roulette is interactive-only and
 * doesn't carry SEO content.
 */
export default function RoulettePage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) {
    return <div className="min-h-screen" style={{ background: '#07060f' }} />;
  }
  return <RoulettePageImpl />;
}
