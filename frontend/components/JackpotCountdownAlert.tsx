'use client';

/**
 * Global jackpot countdown alert.
 *
 * Mounted once in layout.tsx. Listens to the socket `jackpot:round:closing`
 * event and fires a toast 8 seconds before the timer expires, UNLESS the
 * user is already on /jackpot (no point notifying them). The toast has a
 * "Y aller" button that routes to /jackpot.
 *
 * Auto-dismisses after 8 s (same duration as the countdown it announces).
 */

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Trophy, X } from 'lucide-react';

const NOTIFY_LEAD_MS = 8_000;

interface Alert {
  id: string;
  roundId: string;
  potTotal: number;
  participantCount: number;
  expiresAt: number;
}

export function JackpotCountdownAlert() {
  const pathname = usePathname();
  const router = useRouter();
  const [alert, setAlert] = useState<Alert | null>(null);

  useEffect(() => {
    const { connectSocket, getSocket } = require('@/lib/socket') as typeof import('@/lib/socket');
    connectSocket();
    const s = getSocket();
    // Keep the listener outside the lobby room — closing events broadcast
    // to the lobby, so we need to join it even when the user isn't on
    // /jackpot to receive the trigger.
    s.emit('jackpot:joinLobby');

    const timers: Array<ReturnType<typeof setTimeout>> = [];

    const onClosing = (data: { roundId: string; closingAt: string; potTotal: number; participantCount: number }) => {
      const expiresAtMs = new Date(data.closingAt).getTime();
      const fireAtMs = expiresAtMs - NOTIFY_LEAD_MS;
      const delay = fireAtMs - Date.now();
      // If we already passed the 8-s mark (latecomer), skip. Same for invalid
      // or very-short rounds where the alert would arrive too late to matter.
      if (delay < 500) return;

      const t = setTimeout(() => {
        // Still relevant? If the user is already on /jackpot, no need to nag.
        if (pathname === '/jackpot') return;
        setAlert({
          id: `${data.roundId}-${Date.now()}`,
          roundId: data.roundId,
          potTotal: data.potTotal,
          participantCount: data.participantCount,
          expiresAt: expiresAtMs,
        });
        // Auto-dismiss when the timer runs out
        const autoDismiss = setTimeout(() => setAlert(null), NOTIFY_LEAD_MS + 500);
        timers.push(autoDismiss);
      }, delay);
      timers.push(t);
    };

    // Same listener, re-binding if the socket reconnects with a fresh handler
    s.on('jackpot:round:closing', onClosing);

    // If the round got cancelled or already settled we drop the pending alert
    const onDone = () => setAlert(null);
    s.on('jackpot:round:settled', onDone);
    s.on('jackpot:round:cancelled', onDone);

    return () => {
      s.off('jackpot:round:closing', onClosing);
      s.off('jackpot:round:settled', onDone);
      s.off('jackpot:round:cancelled', onDone);
      for (const t of timers) clearTimeout(t);
    };
  }, [pathname]);

  if (!alert) return null;

  return (
    <div
      className="fixed z-[9999] bottom-20 right-4 md:bottom-6 md:right-6 animate-in slide-in-from-right-4"
      style={{ maxWidth: 340 }}
    >
      <div
        className="rounded-lg overflow-hidden shadow-2xl"
        style={{
          background: 'linear-gradient(135deg, #1a0f20 0%, #140c1a 100%)',
          border: '1px solid rgba(255,197,66,0.45)',
          boxShadow: '0 0 32px rgba(255,197,66,0.25), 0 8px 24px rgba(0,0,0,0.5)',
        }}
      >
        <div className="flex items-start gap-3 px-4 py-3">
          <div
            className="shrink-0 rounded-full p-2"
            style={{ background: 'rgba(255,197,66,0.18)', border: '1px solid rgba(255,197,66,0.4)' }}
          >
            <Trophy size={16} style={{ color: '#ffd97a' }} />
          </div>
          <div className="flex-1 min-w-0">
            <div
              className="text-[13px] font-bold"
              style={{ fontFamily: 'Cinzel, serif', color: '#ffd97a' }}
            >
              Jackpot se lance dans 8 s
            </div>
            <div className="text-[11px] mt-0.5" style={{ color: '#9990b8' }}>
              Pot <span className="font-bold" style={{ color: '#e8e2f5' }}>{alert.potTotal.toLocaleString()} ⚜</span>
              {' · '}
              {alert.participantCount} joueurs
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={() => {
                  setAlert(null);
                  router.push('/jackpot');
                }}
                className="px-3 py-1 rounded-full text-[11px] font-bold tracking-wider uppercase hover:opacity-90 transition-opacity"
                style={{
                  background: 'linear-gradient(135deg, #f5c842 0%, #d4a017 100%)',
                  color: '#1a1010',
                }}
              >
                Y aller
              </button>
              <button
                onClick={() => setAlert(null)}
                className="px-3 py-1 rounded-full text-[11px] tracking-wider uppercase hover:opacity-60 transition-opacity"
                style={{ color: '#6b6488', background: 'transparent' }}
              >
                Ignorer
              </button>
            </div>
          </div>
          <button
            onClick={() => setAlert(null)}
            className="shrink-0 hover:opacity-60 transition-opacity"
            aria-label="close"
          >
            <X size={14} style={{ color: '#6b6488' }} />
          </button>
        </div>
      </div>
    </div>
  );
}
