'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import { onBetResult, BetResultPayload, onNotification, AppNotificationPayload } from '@/lib/socket';

export type AppNotification =
  | (BetResultPayload & { id: string; at: number; read: boolean; notifType: 'betResult' })
  | (AppNotificationPayload & { id: string; at: number; read: boolean; notifType: 'system' });

export type ToastKind = 'success' | 'error' | 'info';
export interface Toast {
  id: string;
  at: number;
  kind: ToastKind;
  message: string;
}

interface NotificationsCtx {
  notifications: AppNotification[];
  unreadCount: number;
  dismiss: (id: string) => void;
  markAllRead: () => void;
  /** Transient success/error/info toasts fired from anywhere client-side —
   *  no server round-trip, unlike bet-result/system notifications which
   *  arrive over the socket. Kept in a separate list from `notifications`
   *  so they never pollute the navbar bell's history/unread count; they
   *  render in the same GlobalNotifications stack so every toast on the
   *  site shares one visual language. */
  toasts: Toast[];
  showToast: (kind: ToastKind, message: string) => void;
  dismissToast: (id: string) => void;
  /** Games with a cosmetic outcome-reveal animation (e.g. roulette's wheel
   *  spin) call this with the timestamp their animation actually finishes.
   *  The Navbar's wallet-balance listener checks it before applying an
   *  incoming coinsUpdate, so a payout settled server-side mid-animation
   *  can't flash/ramp the balance and spoil the result before the player
   *  sees it land. */
  holdBalanceFlashUntil: (timestampMs: number) => void;
  getBalanceHoldUntil: () => number;
}

const Ctx = createContext<NotificationsCtx>({
  notifications: [],
  unreadCount: 0,
  dismiss: () => {},
  markAllRead: () => {},
  toasts: [],
  showToast: () => {},
  dismissToast: () => {},
  holdBalanceFlashUntil: () => {},
  getBalanceHoldUntil: () => 0,
});

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const toastTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const balanceHoldUntilRef = useRef(0);
  const holdBalanceFlashUntil = useCallback((timestampMs: number) => {
    balanceHoldUntilRef.current = timestampMs;
  }, []);
  const getBalanceHoldUntil = useCallback(() => balanceHoldUntilRef.current, []);

  const dismiss = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
    const t = timers.current.get(id);
    if (t) { clearTimeout(t); timers.current.delete(id); }
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
    const t = toastTimers.current.get(id);
    if (t) { clearTimeout(t); toastTimers.current.delete(id); }
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  const addNotif = useCallback((notif: AppNotification) => {
    setNotifications(prev => [notif, ...prev].slice(0, 20));
    const timer = setTimeout(() => dismiss(notif.id), 7000);
    timers.current.set(notif.id, timer);
  }, [dismiss]);

  const showToast = useCallback((kind: ToastKind, message: string) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const toast: Toast = { id, at: Date.now(), kind, message };
    setToasts(prev => [...prev, toast].slice(-4));
    // Errors linger a touch longer than success/info — plain sentences take
    // longer to read than the compact win/loss cards bet toasts use.
    const ttl = kind === 'error' ? 6000 : 4500;
    const timer = setTimeout(() => dismissToast(id), ttl);
    toastTimers.current.set(id, timer);
  }, [dismissToast]);

  useEffect(() => {
    if (!session?.user) return;

    const offBet = onBetResult((data) => {
      const id = `bet_${data.betId}_${Date.now()}`;
      addNotif({ ...data, id, at: Date.now(), read: false, notifType: 'betResult' });
    });

    const offNotif = onNotification((data) => {
      const id = `notif_${data.type}_${Date.now()}`;
      addNotif({ ...data, id, at: Date.now(), read: false, notifType: 'system' });
    });

    return () => { offBet(); offNotif(); };
  }, [session?.user, addNotif]);

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <Ctx.Provider value={{ notifications, unreadCount, dismiss, markAllRead, toasts, showToast, dismissToast, holdBalanceFlashUntil, getBalanceHoldUntil }}>
      {children}
    </Ctx.Provider>
  );
}

export function useNotifications() {
  return useContext(Ctx);
}
