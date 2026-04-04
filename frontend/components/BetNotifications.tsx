'use client';

import { useNotifications } from '@/contexts/NotificationsContext';

export function BetNotifications() {
  const { notifications, dismiss } = useNotifications();

  // Only show recent unread toasts (last 5, within 7s)
  const toasts = notifications
    .filter(n => !n.read && Date.now() - n.at < 7000)
    .slice(0, 5);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-20 right-4 z-[9999] flex flex-col gap-2 md:bottom-4">
      {toasts.map(n => (
        <div
          key={n.id}
          className={`relative flex items-start gap-3 rounded-lg border px-4 py-3 shadow-2xl backdrop-blur-sm
            w-[300px] sm:w-[340px] text-sm animate-in slide-in-from-right-4
            ${n.won
              ? 'bg-[#0a1a0a] border-[#2a5c2a] text-[#e8e2f5]'
              : 'bg-[#12080f] border-[#4a1a2a] text-[#e8e2f5]'
            }`}
        >
          <div className={`mt-0.5 shrink-0 text-lg leading-none ${n.won ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
            {n.won ? '🏆' : '💀'}
          </div>
          <div className="flex-1 min-w-0">
            <p className={`font-bold text-sm ${n.won ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
              {n.won ? 'Pari gagné !' : 'Pari perdu'}
            </p>
            {n.tournamentName && (
              <p className="text-[#9988bb] text-xs truncate">{n.tournamentName}</p>
            )}
            <p className="text-xs mt-1">
              Mise sur <span className="text-[#f5c842] font-semibold">{n.playerBetOn ?? '—'}</span>
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="text-[#9988bb] text-xs">Mise : {n.amount.toFixed(2)} ⚜</span>
              {n.won && (
                <>
                  <span className="text-[#9988bb]">→</span>
                  <span className="text-[#f5c842] font-bold text-xs">+{n.payout.toFixed(2)} ⚜</span>
                </>
              )}
            </div>
          </div>
          <button
            onClick={() => dismiss(n.id)}
            className="shrink-0 text-[#9988bb] hover:text-[#e8e2f5] text-base leading-none ml-1 mt-0.5"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
