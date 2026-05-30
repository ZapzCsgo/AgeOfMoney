'use client';

/**
 * Client-side shell for /admin/events on tft.money.
 *
 * Defense-in-depth :
 *   - Server page already notFound()'d non-owners
 *   - Here we re-check client-side (isOwner flag from session)
 *   - Fetches are gated by `ready = isOwner && tokenReady`
 *
 * UX :
 *   - On first mount with NEW suggestions, we batch-mark them SEEN after
 *     2 s so the sidebar dot disappears but we never hide anything they
 *     haven't read first.
 *   - Acted + Dismiss are optimistic : the card disappears instantly and
 *     rolls back if the API refuses.
 *
 * Differences vs. the AgeOfMoney version :
 *   - The Rain feature is NOT shipped on tft.money, so the manual-rain
 *     button, the rain-launch modal and the rain history section are all
 *     omitted. RAIN_OPPORTUNITY suggestions fall back to the standard
 *     "Marquer traité" action.
 *   - Palette swapped to the tft-* tokens (purple primary, void indigo bg).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { motion, AnimatePresence } from 'framer-motion';
import { Radar, Check } from 'lucide-react';
import { apiClient, setAuthToken } from '@/lib/api';
import { useEventsFetch } from '../_hooks/useEventsFetch';
import { FilterBar } from './FilterBar';
import { EventCard } from './EventCard';
import { ActedModal } from './ActedModal';
import { RedeemCodesSection } from './RedeemCodesSection';
import { EventSuggestion, RuleType } from './types';

export function EventsDashboard() {
  const { data: session } = useSession();
  const isOwner = !!session?.user?.isOwner;

  const accessToken = (session?.user as { accessToken?: string } | undefined)?.accessToken ?? null;
  const [tokenReady, setTokenReady] = useState(false);
  useEffect(() => {
    setAuthToken(accessToken);
    setTokenReady(!!accessToken);
  }, [accessToken]);
  const ready = isOwner && tokenReady;

  // Filters
  const [status,   setStatus]   = useState<'all' | 'NEW' | 'SEEN'>('all');
  const [priority, setPriority] = useState<'all' | 'LOW' | 'MEDIUM' | 'HIGH'>('all');
  const [ruleType, setRuleType] = useState<'all' | RuleType>('all');

  const query = {
    status:   status   === 'all' ? '' : status,
    priority: priority === 'all' ? '' : priority,
    ruleType: ruleType === 'all' ? '' : ruleType,
  };

  const events = useEventsFetch<EventSuggestion[]>('/admin/events', query, { enabled: ready });

  // Batch mark-seen on first load (only if we're showing NEW ones)
  const markSeenRef = useRef(false);
  useEffect(() => {
    if (markSeenRef.current) return;
    if (!events.data || events.data.length === 0) return;
    const newIds = events.data.filter((e) => e.status === 'NEW').map((e) => e.id);
    if (newIds.length === 0) { markSeenRef.current = true; return; }
    markSeenRef.current = true;
    const t = setTimeout(() => {
      apiClient.post('/admin/events/mark-seen', { ids: newIds }).catch(() => {
        markSeenRef.current = false;
      });
    }, 2000);
    return () => clearTimeout(t);
  }, [events.data]);

  // Scan-now
  const [scanning, setScanning] = useState(false);
  const handleScanNow = useCallback(async () => {
    setScanning(true);
    try {
      await apiClient.post('/admin/events/scan-now');
      await events.refresh();
    } catch (err) {
      console.error('[Events] scan-now failed:', err);
    } finally {
      setScanning(false);
    }
  }, [events]);

  // Optimistic locally-removed set so a card disappears instantly on acted/dismiss
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);

  const handleDismiss = useCallback(async (id: string) => {
    setBusyId(id);
    setRemoved((s) => new Set(s).add(id));
    try {
      await apiClient.post(`/admin/events/${id}/dismiss`, { forDays: 7 });
      await events.refresh();
    } catch (err) {
      console.error('[Events] dismiss failed:', err);
      setRemoved((s) => { const n = new Set(s); n.delete(id); return n; });
    } finally {
      setBusyId(null);
    }
  }, [events]);

  // Acted modal
  const [actedTarget, setActedTarget] = useState<EventSuggestion | null>(null);

  const handleActedConfirm = useCallback(async (note: string) => {
    if (!actedTarget) return;
    setBusyId(actedTarget.id);
    setRemoved((s) => new Set(s).add(actedTarget.id));
    try {
      await apiClient.post(`/admin/events/${actedTarget.id}/acted`, { note: note || undefined });
      setActedTarget(null);
      await events.refresh();
    } catch (err) {
      console.error('[Events] acted failed:', err);
      setRemoved((s) => { const n = new Set(s); if (actedTarget) n.delete(actedTarget.id); return n; });
    } finally {
      setBusyId(null);
    }
  }, [actedTarget, events]);

  if (!isOwner) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <p className="text-[13px] text-tft-text-muted">Unauthorized.</p>
      </div>
    );
  }

  const allEvents = events.data ?? [];
  const visible = allEvents.filter((e) => !removed.has(e.id));
  const newCount = visible.filter((e) => e.status === 'NEW').length;

  return (
    <div>
      {/* Sticky filters */}
      <div
        className="sticky top-0 z-10 -mx-4 px-4 py-3 mb-5 backdrop-blur-md border-b border-tft-border"
        style={{ background: 'rgba(8,8,26,0.85)' }}
      >
        <FilterBar
          status={status} onStatus={setStatus}
          priority={priority} onPriority={setPriority}
          ruleType={ruleType} onRuleType={setRuleType}
          onRefresh={events.refresh}
          onScanNow={handleScanNow}
          refreshing={events.loading}
          scanning={scanning}
          lastUpdatedAt={events.lastUpdatedAt}
        />
      </div>

      {/* Count line */}
      <div className="flex items-center gap-2 mb-4 text-[12px] text-tft-text-dim">
        <Radar
          size={13}
          className={newCount > 0 ? 'text-tft-purple-bright' : 'text-tft-text-muted'}
        />
        <span>
          <strong className="text-tft-text">{newCount}</strong> nouvelle{newCount !== 1 ? 's' : ''} ·{' '}
          <strong className="text-tft-text">{visible.length}</strong> active{visible.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Error banner */}
      {events.error && (
        <div className="mb-4 rounded-md px-4 py-2 text-[12px] bg-tft-danger-dim border border-tft-danger/40 text-tft-danger">
          {events.error}
        </div>
      )}

      {/* List */}
      {events.loading && !events.data ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-28 rounded-md animate-pulse bg-tft-bg-card" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-md p-12 text-center bg-tft-bg-card border border-tft-border">
          <Check size={24} className="mx-auto mb-3 text-tft-mint" />
          <p className="text-[14px] text-tft-text">
            Tout va bien — pas d&apos;opportunité détectée pour le moment.
          </p>
          <p className="text-[11px] mt-2 text-tft-text-muted">
            Le scanner tourne toutes les 6 h. Tu peux aussi relancer via « Scan now » ci-dessus.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {visible.map((event, index) => (
              <motion.div
                key={event.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, y: -4 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1], delay: Math.min(index * 0.03, 0.2) }}
              >
                <EventCard
                  event={event}
                  onActed={(e) => setActedTarget(e)}
                  onDismiss={handleDismiss}
                  busy={busyId === event.id}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <ActedModal
        open={actedTarget !== null}
        title={actedTarget?.title ?? ''}
        busy={busyId === actedTarget?.id}
        onClose={() => setActedTarget(null)}
        onConfirm={handleActedConfirm}
      />

      {/* Owner-only redeem-code management — shared with AgeOfMoney through
          the backend, so codes minted here are usable on either platform. */}
      <RedeemCodesSection ready={ready} />
    </div>
  );
}
