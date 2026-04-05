'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import { onBetResult, BetResultPayload, onNotification, AppNotificationPayload } from '@/lib/socket';

export type AppNotification =
  | (BetResultPayload & { id: string; at: number; read: boolean; notifType: 'betResult' })
  | (AppNotificationPayload & { id: string; at: number; read: boolean; notifType: 'system' });

interface NotificationsCtx {
  notifications: AppNotification[];
  unreadCount: number;
  dismiss: (id: string) => void;
  markAllRead: () => void;
}

const Ctx = createContext<NotificationsCtx>({
  notifications: [],
  unreadCount: 0,
  dismiss: () => {},
  markAllRead: () => {},
});

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
    const t = timers.current.get(id);
    if (t) { clearTimeout(t); timers.current.delete(id); }
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  const addNotif = useCallback((notif: AppNotification) => {
    setNotifications(prev => [notif, ...prev].slice(0, 20));
    const timer = setTimeout(() => dismiss(notif.id), 7000);
    timers.current.set(notif.id, timer);
  }, [dismiss]);

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
    <Ctx.Provider value={{ notifications, unreadCount, dismiss, markAllRead }}>
      {children}
    </Ctx.Provider>
  );
}

export function useNotifications() {
  return useContext(Ctx);
}
