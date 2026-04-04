'use client';

import { SessionProvider } from 'next-auth/react';
import { ReactNode } from 'react';
import { LanguageProvider } from '@/lib/i18n';
import { NotificationsProvider } from '@/contexts/NotificationsContext';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <LanguageProvider>
        <NotificationsProvider>
          {children}
        </NotificationsProvider>
      </LanguageProvider>
    </SessionProvider>
  );
}
