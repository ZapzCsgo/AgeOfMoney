'use client';

/**
 * Minimal stale-while-revalidate hook for /admin/events routes.
 *
 * Identical contract to finance/useFinanceFetch (copy intentional — keeps
 * the two admin features decoupled). ~70 lines, no SWR/React Query dep.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/api';

const REVALIDATE_INTERVAL_MS = 60_000;

export interface FetchState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  lastUpdatedAt: number | null;
  refresh: () => Promise<void>;
}

export function useEventsFetch<T>(
  path: string,
  query: Record<string, string | boolean> = {},
  options: { enabled?: boolean } = {},
): FetchState<T> {
  const { enabled = true } = options;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === false || v === '' || v == null) continue;
    qs.set(k, String(v));
  }
  const url = qs.toString() ? `${path}?${qs.toString()}` : path;

  const urlRef = useRef(url);
  urlRef.current = url;

  const fetchOnce = useCallback(async () => {
    const requestedUrl = urlRef.current;
    try {
      const res = await apiClient.get(requestedUrl);
      if (urlRef.current !== requestedUrl) return;
      setData(res.data?.data ?? null);
      setError(null);
      setLastUpdatedAt(Date.now());
    } catch (e) {
      if (urlRef.current !== requestedUrl) return;
      const msg = e instanceof Error ? e.message : 'Request failed';
      setError(msg);
    } finally {
      if (urlRef.current === requestedUrl) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    fetchOnce();
  }, [url, fetchOnce, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') fetchOnce();
    }, REVALIDATE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchOnce, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const onFocus = () => { if (document.visibilityState === 'visible') fetchOnce(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [fetchOnce, enabled]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    await fetchOnce();
  }, [fetchOnce, enabled]);

  return { data, error, loading, lastUpdatedAt, refresh };
}
