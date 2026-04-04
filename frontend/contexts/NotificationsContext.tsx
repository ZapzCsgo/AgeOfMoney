'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import { onBetResult, BetResultPayload } from '@/lib/socket';

export interface AppNotification extends BetResultPayload {
  id: string;
  at: number;
  read: boolean;
}

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

  useEffect(() => {
    if (!session?.user) return;

    const off = onBetResult((data) => {
      const id = `${data.betId}_${Date.now()}`;
      const notif: AppNotification = { ...data, id, at: Date.now(), read: false };
      setNotifications(prev => [notif, ...prev].slice(0, 20)); // keep last 20

      // Auto-dismiss toast after 7s
      const timer = setTimeout(() => dismiss(id), 7000);
      timers.current.set(id, timer);
    });

    return off;
  }, [session?.user, dismiss]);

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
