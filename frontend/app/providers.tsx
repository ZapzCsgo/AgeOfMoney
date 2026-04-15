'use client';

import { SessionProvider } from 'next-auth/react';
import { ReactNode } from 'react';
import { LanguageProvider } from '@/lib/i18n';
import { NotificationsProvider } from '@/contexts/NotificationsContext';

export function Providers({ children }: { children: ReactNode }) {
  return (
    // refetchOnWindowFocus: false → NextAuth won't re-hit the session
    // endpoint every time the tab gets refocused, which was causing
    // pages that guard on `status === 'loading'` to flash a spinner
    // when the user came back from another app.
    <SessionProvider refetchOnWindowFocus={false} refetchInterval={0}>
      <LanguageProvider>
        <NotificationsProvider>
          {children}
        </NotificationsProvider>
      </LanguageProvider>
    </SessionProvider>
  );
}
