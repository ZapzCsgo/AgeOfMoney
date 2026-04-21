'use client';

/**
 * Small hook that polls /admin/events/badge-count for the sidebar dot.
 *
 * Renders 0 if the user isn't OWNER (the endpoint would 403 anyway —
 * short-circuit to avoid the noise). Poll every 2 min ; that's tight
 * enough to feel live without hammering the backend from every page.
 */

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { apiClient } from '@/lib/api';

const POLL_MS = 120_000;

export function useEventBadge(): number {
  const { data: session } = useSession();
  const [count, setCount] = useState(0);

  useEffect(() => {
    const isOwner = !!session?.user?.isOwner;
    const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;
    if (!isOwner || !token) {
      setCount(0);
      return;
    }

    let cancelled = false;
    async function fetchOnce() {
      try {
        const res = await apiClient.get('/admin/events/badge-count');
        if (!cancelled) setCount(res.data?.data?.count ?? 0);
      } catch {
        // silent — badge is cosmetic
      }
    }

    fetchOnce();
    const id = setInterval(fetchOnce, POLL_MS);
    const onFocus = () => { if (document.visibilityState === 'visible') fetchOnce(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);

    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [session]);

  return count;
}
