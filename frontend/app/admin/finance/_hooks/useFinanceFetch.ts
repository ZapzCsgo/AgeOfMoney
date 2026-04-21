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

export function useFinanceFetch<T>(path: string, query: Record<string, string | boolean>): FetchState<T> {
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

  // (Re)fetch whenever the URL changes, including the initial mount
  useEffect(() => {
    setLoading(true);
    fetchOnce();
  }, [url, fetchOnce]);

  // Poll every 60 s while the document is visible
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') fetchOnce();
    }, REVALIDATE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchOnce]);

  // Refetch on window focus (user returns to the tab after a while)
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === 'visible') fetchOnce(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [fetchOnce]);

  const refresh = useCallback(async () => {
    setLoading(true);
    await fetchOnce();
  }, [fetchOnce]);

  return { data, error, loading, lastUpdatedAt, refresh };
}
