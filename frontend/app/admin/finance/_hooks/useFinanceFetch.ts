'use client';

/**
 * Minimal stale-while-revalidate fetch hook for the finance dashboard.
 *
 * Why not SWR / React Query ?  Neither is already a project dependency and
 * the matrix of behaviour we need here is small: fetch on mount, refetch on
 * window focus, poll every 60 s, manual refresh, expose lastUpdatedAt for
 * the "Data as of Xm ago" indicator. ~60 lines gets us there without a new
 * dep.
 *
 * Generic over the response shape so each section can type its data.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/api';

const REVALIDATE_INTERVAL_MS = 60_000;

export interface FetchState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Last time the fetch succeeded (ms epoch). Used for the "as of X ago" UI. */
  lastUpdatedAt: number | null;
  /** Force a fresh fetch — bypasses any concurrent-call dedupe. */
  refresh: () => Promise<void>;
}

export interface UseFinanceFetchOptions {
  /** When false, the hook will skip ALL network activity. Flip to true
   *  only once the apiClient has an auth token set — otherwise the
   *  request goes out without the Bearer header and the backend replies
   *  401 "Authentication required", which flashes in the UI. */
  enabled?: boolean;
}

export function useFinanceFetch<T>(
  path: string,
  query: Record<string, string | boolean>,
  options: UseFinanceFetchOptions = {},
): FetchState<T> {
  const { enabled = true } = options;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  // Stable URL string so useEffect doesn't re-fire on object-identity changes
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === false || v === '' || v == null) continue;
    qs.set(k, String(v));
  }
  const url = qs.toString() ? `${path}?${qs.toString()}` : path;

  // Prevent setState on an unmounted component + avoid processing stale
  // responses when the URL changes faster than the network.
  const urlRef = useRef(url);
  urlRef.current = url;

  const fetchOnce = useCallback(async (): Promise<void> => {
    const requestedUrl = urlRef.current;
    try {
      const res = await apiClient.get(requestedUrl);
      if (urlRef.current !== requestedUrl) return; // stale
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

  // (Re)fetch whenever the URL changes, including the initial mount — but
  // only when the caller marks us as enabled (i.e. auth token is ready).
  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    fetchOnce();
  }, [url, fetchOnce, enabled]);

  // Poll every 60 s while the document is visible
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') fetchOnce();
    }, REVALIDATE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchOnce, enabled]);

  // Refetch on window focus (user returns to the tab after a while)
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
