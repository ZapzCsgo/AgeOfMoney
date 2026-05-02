'use client';

/**
 * Admin-only modal for launching a Rain from an EventCard (or standalone).
 *
 * Inputs are bounded client-side ; backend re-checks. Live preview tells
 * the admin exactly how many coins each claimant will receive so they
 * don't spam-click before realising the pool is too small.
 *
 * Irreversible-style CTA (gold → darker-gold gradient + "Launch now" wording)
 * because once the rain is ACTIVE, the first claim locks it in — you
 * can't cancel mid-flight in V1.
 */

import { useEffect, useState } from 'react';
import { X, Droplets, AlertTriangle } from 'lucide-react';
import { apiClient } from '@/lib/api';

const DEFAULTS = { amount: 500, maxParticipants: 50, duration: 120 };
const BOUNDS = {
  amount:          { min: 10, max: 10_000 },
  maxParticipants: { min: 5,  max: 500 },
  duration:        { min: 30, max: 600 },
};

export function RainLaunchModal({
  open,
  onClose,
  onLaunched,
  eventSuggestionId,
  eventTitle,
}: {
  open: boolean;
  onClose: () => void;
  onLaunched: () => void;
  eventSuggestionId?: string | null;
  eventTitle?: string | null;
}) {
  const [amount, setAmount]   = useState(DEFAULTS.amount);
  const [maxP, setMaxP]       = useState(DEFAULTS.maxParticipants);
  const [duration, setDuration] = useState(DEFAULTS.duration);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setAmount(DEFAULTS.amount);
      setMaxP(DEFAULTS.maxParticipants);
      setDuration(DEFAULTS.duration);
      setBusy(false);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [open, onClose]);

  if (!open) return null;

  // Pool split now keeps 2-decimal precision (matches the Decimal-stored
  // backend RainParticipant.coinsReceived).
  const perUser = Math.round((amount / Math.max(1, maxP)) * 100) / 100;

  function clampedChange(value: number, key: keyof typeof BOUNDS): number {
    const b = BOUNDS[key];
    if (!Number.isFinite(value)) return b.min;
    return Math.max(b.min, Math.min(b.max, Math.floor(value)));
  }

  async function handleLaunch() {
    setBusy(true);
    setError(null);
    try {
      await apiClient.post('/admin/rain/launch', {
        amount,
        maxParticipants: maxP,
        duration,
        triggeredByEvent: eventSuggestionId ?? undefined,
      });
      onLaunched();
      onClose();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string; reason?: string } }; message?: string };
      setError(err.response?.data?.error ?? err.message ?? 'Launch failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center px-4"
      style={{ background: 'rgba(7,6,15,0.85)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl overflow-hidden"
        style={{ background: '#0d0b1a', border: '1px solid rgba(255,197,66,0.3)', boxShadow: '0 0 60px rgba(255,197,66,0.25)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid #1e1a30' }}>
          <div className="flex items-center gap-2">
            <Droplets size={14} style={{ color: '#ffd97a' }} />
            <span className="font-bold text-[13px] tracking-widest uppercase" style={{ fontFamily: 'Cinzel, serif', color: '#ffd97a' }}>
              Launch Rain
            </span>
          </div>
          <button onClick={onClose} className="hover:opacity-60 transition-opacity" aria-label="fermer">
            <X size={14} style={{ color: '#6b6488' }} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {eventTitle && (
            <p className="text-[11px]" style={{ color: '#9990b8' }}>
              Motivé par : <span style={{ color: '#c8c0e0' }}>{eventTitle}</span>
            </p>
          )}

          {/* Amount */}
          <div>
            <label className="block text-[10px] font-bold tracking-[0.2em] uppercase mb-1" style={{ color: '#6b6488' }}>
              Amount (coins)
            </label>
            <input
              type="number"
              min={BOUNDS.amount.min}
              max={BOUNDS.amount.max}
              value={amount}
              onChange={(e) => setAmount(clampedChange(parseInt(e.target.value, 10), 'amount'))}
              className="w-full rounded-lg px-3 py-2 text-[14px] font-bold outline-none"
              style={{ background: '#13111f', border: '1px solid #2a2640', color: '#ffd97a' }}
            />
            <p className="text-[10px] mt-1" style={{ color: '#6b6488' }}>
              [{BOUNDS.amount.min.toLocaleString('fr-FR')} – {BOUNDS.amount.max.toLocaleString('fr-FR')}] coins
            </p>
          </div>

          {/* Max participants */}
          <div>
            <label className="block text-[10px] font-bold tracking-[0.2em] uppercase mb-1" style={{ color: '#6b6488' }}>
              Max participants
            </label>
            <input
              type="number"
              min={BOUNDS.maxParticipants.min}
              max={BOUNDS.maxParticipants.max}
              value={maxP}
              onChange={(e) => setMaxP(clampedChange(parseInt(e.target.value, 10), 'maxParticipants'))}
              className="w-full rounded-lg px-3 py-2 text-[14px] font-bold outline-none"
              style={{ background: '#13111f', border: '1px solid #2a2640', color: '#e5e5e5' }}
            />
            <p className="text-[10px] mt-1" style={{ color: '#6b6488' }}>
              [{BOUNDS.maxParticipants.min} – {BOUNDS.maxParticipants.max}] users
            </p>
          </div>

          {/* Duration */}
          <div>
            <label className="block text-[10px] font-bold tracking-[0.2em] uppercase mb-1" style={{ color: '#6b6488' }}>
              Duration (seconds)
            </label>
            <input
              type="number"
              min={BOUNDS.duration.min}
              max={BOUNDS.duration.max}
              value={duration}
              onChange={(e) => setDuration(clampedChange(parseInt(e.target.value, 10), 'duration'))}
              className="w-full rounded-lg px-3 py-2 text-[14px] font-bold outline-none"
              style={{ background: '#13111f', border: '1px solid #2a2640', color: '#e5e5e5' }}
            />
            <p className="text-[10px] mt-1" style={{ color: '#6b6488' }}>
              [{BOUNDS.duration.min} – {BOUNDS.duration.max}] secondes ({Math.round(duration / 60)} min)
            </p>
          </div>

          {/* Preview */}
          <div
            className="rounded-lg px-3 py-2.5 text-[12px]"
            style={{ background: 'rgba(255,197,66,0.08)', border: '1px solid rgba(255,197,66,0.25)', color: '#c8c0e0' }}
          >
            <span className="font-bold" style={{ color: '#ffd97a' }}>{amount.toLocaleString('fr-FR')} ⚜</span>
            {' répartis sur max '}
            <span className="font-bold" style={{ color: '#ffd97a' }}>{maxP}</span>
            {' users = '}
            <span className="font-bold" style={{ color: '#ffd97a' }}>{perUser} ⚜</span>
            {' par claim'}
          </div>

          {/* Warning */}
          <div className="flex items-start gap-2 text-[11px]" style={{ color: '#9990b8' }}>
            <AlertTriangle size={12} className="shrink-0 mt-0.5" style={{ color: '#f87171' }} />
            <p>
              Action irréversible. Le rain devient ACTIVE immédiatement et tous les users connectés
              verront le bandeau. Pas d&apos;annulation possible en V1.
            </p>
          </div>

          {error && (
            <div
              className="rounded-lg px-3 py-2 text-[11px]"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5' }}
            >
              {error}
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <button
              onClick={onClose}
              disabled={busy}
              className="px-3 py-2 rounded-lg text-[11px] font-bold tracking-wider uppercase hover:opacity-80 transition-opacity disabled:opacity-50"
              style={{ background: '#13111f', border: '1px solid #2a2640', color: '#9990b8' }}
            >
              Annuler
            </button>
            <button
              onClick={handleLaunch}
              disabled={busy}
              className="px-4 py-2 rounded-lg text-[11px] font-bold tracking-wider uppercase hover:opacity-90 transition-opacity disabled:opacity-50"
              style={{
                background: 'linear-gradient(135deg, #f5c842 0%, #d4a017 100%)',
                color: '#1a1010', border: 'none',
                boxShadow: '0 2px 12px rgba(255,197,66,0.25)',
              }}
            >
              <Droplets size={11} className="inline mr-1" />
              {busy ? 'Launch…' : 'Launch now'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
