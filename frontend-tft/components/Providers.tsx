'use client';

import { SessionProvider } from 'next-auth/react';
import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { setAuthToken } from '@/lib/api';

/**
 * Top-level client-side providers. Wraps next-auth's SessionProvider so
 * `useSession()` works anywhere in the tree, AND mirrors the backend JWT
 * into the axios client whenever the session changes.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider refetchInterval={5 * 60}>
      <AuthTokenSync />
      {children}
    </SessionProvider>
  );
}

function AuthTokenSync() {
  const { data: session } = useSession();
  useEffect(() => {
    setAuthToken(session?.user?.accessToken ?? null);
  }, [session?.user?.accessToken]);
  return null;
}
