'use client';

/**
 * Global RainWidget — sticks to the top of every page (below the navbar)
 * whenever a rain is ACTIVE. Dismissible only AFTER the user has claimed
 * so we don't let bots skip the widget and miss the free coins.
 *
 * Data sources :
 *   - Initial state : GET /api/v1/rain/active on mount
 *   - Live updates via socket events rain:start, rain:update, rain:end
 *   - Claim status (has the current user already claimed?) via
 *     GET /api/v1/rain/:id/claimed — cached in state, cleared on rain:end
 */

import { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { signInWithSteam } from '@/lib/authHelpers';
import { AnimatePresence, motion } from 'framer-motion';
import { Droplets, X, Check } from 'lucide-react';
import { apiClient, setAuthToken } from '@/lib/api';
import { RainCaptchaModal } from './RainCaptchaModal';

interface RainPublic {
  id: string;
  amount: number;
  maxParticipants: number;
  actualParticipants: number;
  duration: number;
  perUser: number;
  status: 'ACTIVE' | 'COMPLETED' | 'EXPIRED';
  startedAt: string;
  endsAt: string;
  completedAt: string | null;
  actualPerUser: number | null;
  triggeredByEvent: string | null;
}

export function RainWidget() {
  const { data: session, status: sessionStatus } = useSession();
  const [rain, setRain] = useState<RainPublic | null>(null);
  const [claimed, setClaimed] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [coinsReceived, setCoinsReceived] = useState<number | null>(null);
  const [captchaOpen, setCaptchaOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [endedAt, setEndedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  // Keep axios auth token in sync so the claim endpoint carries the JWT
  useEffect(() => {
    const token = (session?.user as { accessToken?: string } | undefined)?.accessToken ?? null;
    setAuthToken(token);
  }, [session]);

  // Live tick for the countdown
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Fetch active rain on mount + when session status changes
  const refresh = useCallback(async () => {
    try {
      const res = await apiClient.get('/rain/active');
      const data: RainPublic | null = res.data?.data ?? null;
      setRain(data);
      if (data && sessionStatus === 'authenticated') {
        try {
          const c = await apiClient.get(`/rain/${data.id}/claimed`);
          setClaimed(!!c.data?.data?.claimed);
        } catch { setClaimed(false); }
      } else {
        setClaimed(false);
      }
    } catch {
      // silent — non-critical (widget just stays hidden)
    }
  }, [sessionStatus]);

  useEffect(() => { refresh(); }, [refresh]);

  // Socket subscriptions
  useEffect(() => {
    const { connectSocket, getSocket } = require('@/lib/socket') as typeof import('@/lib/socket');
    connectSocket();
    const s = getSocket();

    const onStart = (data: RainPublic) => {
      setRain(data);
      setClaimed(false);
      setCoinsReceived(null);
      setDismissed(false);
      setEndedAt(null);
      setError(null);
    };
    const onUpdate = (data: RainPublic) => {
      setRain((prev) => (prev && prev.id === data.id ? { ...prev, ...data } : prev));
    };
    const onEnd = (data: RainPublic & { participants?: unknown[] }) => {
      setRain((prev) => (prev && prev.id === data.id ? { ...prev, ...data, status: 'COMPLETED' } : prev));
      setEndedAt(Date.now());
    };

    s.on('rain:start', onStart);
    s.on('rain:update', onUpdate);
    s.on('rain:end', onEnd);

    return () => {
      s.off('rain:start', onStart);
      s.off('rain:update', onUpdate);
      s.off('rain:end', onEnd);
    };
  }, []);

  async function handleOpenCaptcha() {
    if (!session) {
      // Anonymous clicker → redirect to Steam auth. Same UX pattern as coinflip/jackpot.
      signInWithSteam();
      return;
    }
    setError(null);
    setCaptchaOpen(true);
  }

  async function handleSubmitClaim(payload: { captchaA: number; captchaB: number; captchaAnswer: number; captchaMs: number }) {
    if (!rain) return;
    setClaiming(true);
    try {
      const res = await apiClient.post(`/rain/claim/${rain.id}`, payload);
      setCoinsReceived(res.data?.coinsReceived ?? rain.perUser);
      setClaimed(true);
      setCaptchaOpen(false);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string; reason?: string } }; message?: string };
      const reason = err.response?.data?.reason;
      // Common reasons surface as FR messages in the widget
      const msg = err.response?.data?.error ?? err.message ?? 'Claim échoué';
      setError(msg);
      if (reason === 'ALREADY_CLAIMED') { setClaimed(true); setCaptchaOpen(false); }
      else if (reason === 'RAIN_EXPIRED' || reason === 'RAIN_FULL') { setCaptchaOpen(false); }
    } finally {
      setClaiming(false);
    }
  }

  // Auto-dismiss the "ended" widget after 15 s so it doesn't linger forever
  useEffect(() => {
    if (rain?.status === 'COMPLETED' && endedAt) {
      const id = setTimeout(() => setDismissed(true), 15_000);
      return () => clearTimeout(id);
    }
  }, [rain?.status, endedAt]);

  // Hidden states
  if (!rain) return null;
  if (dismissed) return null;

  const secondsLeft = rain.status === 'ACTIVE'
    ? Math.max(0, Math.ceil((new Date(rain.endsAt).getTime() - now) / 1000))
    : 0;
  const mm = Math.floor(secondsLeft / 60).toString().padStart(2, '0');
  const ss = (secondsLeft % 60).toString().padStart(2, '0');

  const ended = rain.status !== 'ACTIVE';
  const perUserToShow = rain.actualPerUser ?? rain.perUser;
  const canDismiss = claimed || ended || !session;

  return (
    <>
      <AnimatePresence>
        <motion.div
          key={rain.id}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="w-full"
        >
          <div
            className="w-full px-3 py-2 flex flex-col gap-2"
            style={{
              background: 'linear-gradient(135deg, rgba(255,197,66,0.14) 0%, rgba(255,217,122,0.08) 50%, rgba(255,197,66,0.14) 100%)',
              borderBottom: '1px solid rgba(255,197,66,0.35)',
              boxShadow: '0 2px 12px rgba(255,197,66,0.14)',
            }}
          >
            {/* Top row : icon + title + close (if dismissible) */}
            <div className="flex items-center gap-2">
              <div className="shrink-0 rounded-full p-1.5" style={{ background: 'rgba(255,197,66,0.2)', border: '1px solid rgba(255,197,66,0.4)' }}>
                <Droplets size={13} style={{ color: '#ffd97a' }} />
              </div>
              <div className="flex-1 min-w-0 text-[11px]" style={{ color: '#e5e5e5' }}>
                <div className="font-bold tracking-wider uppercase" style={{ fontFamily: 'Cinzel, serif', color: '#ffd97a' }}>
                  {ended ? 'Rain ended' : 'Rain in progress'}
                </div>
                <div style={{ color: '#9990b8' }}>
                  <strong style={{ color: '#e5e5e5' }}>{rain.amount.toLocaleString('fr-FR')} ⚜</strong> up for grabs
                </div>
              </div>
              {canDismiss && (
                <button
                  onClick={() => setDismissed(true)}
                  aria-label="fermer la bannière"
                  className="shrink-0 p-1 rounded hover:opacity-80 transition-opacity"
                  style={{ color: '#6b6488' }}
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Stats line */}
            <div className="text-[10px] font-mono" style={{ color: '#9990b8' }}>
              <strong style={{ color: '#c8c0e0' }}>{rain.actualParticipants}</strong>/{rain.maxParticipants}
              {!ended && (
                <> · <strong style={{ color: secondsLeft <= 10 ? '#f87171' : '#ffd97a' }}>{mm}:{ss}</strong></>
              )}
              {' · '}<strong style={{ color: '#c8c0e0' }}>{perUserToShow} ⚜</strong> each
            </div>

            {error && (
              <div className="text-[10px]" style={{ color: '#f87171' }}>{error}</div>
            )}

            {/* Action */}
            {!ended && !claimed && (
              <button
                onClick={handleOpenCaptcha}
                disabled={claiming || rain.actualParticipants >= rain.maxParticipants}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold tracking-wider uppercase hover:opacity-90 transition-opacity disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg, #f5c842 0%, #d4a017 100%)', color: '#1a1010', border: 'none' }}
              >
                <Droplets size={11} />
                Claim your share
              </button>
            )}
            {claimed && coinsReceived != null && (
              <span
                className="w-full inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold tracking-wider uppercase"
                style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981', border: '1px solid rgba(16,185,129,0.35)' }}
              >
                <Check size={11} />
                +{coinsReceived} ⚜
              </span>
            )}
            {claimed && coinsReceived == null && (
              <span
                className="w-full inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold tracking-wider uppercase"
                style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981', border: '1px solid rgba(16,185,129,0.35)' }}
              >
                <Check size={11} />
                Claimé
              </span>
            )}
          </div>
        </motion.div>
      </AnimatePresence>

      <RainCaptchaModal
        open={captchaOpen}
        busy={claiming}
        rainAmount={rain.amount}
        perUser={rain.perUser}
        onClose={() => setCaptchaOpen(false)}
        onSubmit={handleSubmitClaim}
      />
    </>
  );
}
