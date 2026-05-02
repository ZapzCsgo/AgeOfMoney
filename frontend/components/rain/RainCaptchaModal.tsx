'use client';

/**
 * Simple math captcha — "What is A + B?" where A and B are small ints
 * (1-9). Generated client-side, verified server-side (the backend
 * receives A, B, and the user's answer; checks answer === A + B). No
 * session store needed, deterministic.
 *
 * captchaMs tracks how long the user took between modal open and submit.
 * < 500 ms flags the claim as suspicious server-side (bot signal).
 */

import { useEffect, useRef, useState } from 'react';
import { X, Droplets, Check } from 'lucide-react';

function newChallenge() {
  // Keep the sum ≤ 18 so the answer stays a single digit or teen —
  // the user can type with their thumb on mobile without thinking.
  const a = 1 + Math.floor(Math.random() * 9); // 1..9
  const b = 1 + Math.floor(Math.random() * 9); // 1..9
  return { a, b };
}

export function RainCaptchaModal({
  open,
  onClose,
  onSubmit,
  busy,
  rainAmount,
  perUser,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: { captchaA: number; captchaB: number; captchaAnswer: number; captchaMs: number }) => Promise<void>;
  busy: boolean;
  rainAmount: number;
  perUser: number;
}) {
  const [{ a, b }, setChallenge] = useState(newChallenge);
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const openedAt = useRef<number>(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);

  // Fresh challenge every time the modal opens
  useEffect(() => {
    if (open) {
      setChallenge(newChallenge());
      setAnswer('');
      setError(null);
      openedAt.current = Date.now();
      // Focus after a frame so the dialog animation doesn't steal the cursor
      const id = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
  }, [open]);

  // ESC closes
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  async function handleSubmit() {
    const n = parseInt(answer, 10);
    if (!Number.isFinite(n)) { setError('Entre la réponse.'); return; }
    if (n !== a + b) {
      setError('Incorrect. Nouveau calcul.');
      setChallenge(newChallenge());
      setAnswer('');
      openedAt.current = Date.now();
      return;
    }
    const captchaMs = Date.now() - openedAt.current;
    setError(null);
    await onSubmit({ captchaA: a, captchaB: b, captchaAnswer: n, captchaMs });
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center px-4"
      style={{ background: 'rgba(7,6,15,0.85)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl overflow-hidden"
        style={{ background: '#0d0b1a', border: '1px solid rgba(255,197,66,0.3)', boxShadow: '0 0 60px rgba(255,197,66,0.25)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid #1e1a30' }}>
          <div className="flex items-center gap-2">
            <Droplets size={14} style={{ color: '#ffd97a' }} />
            <span className="font-bold text-[13px] tracking-widest uppercase" style={{ fontFamily: 'Cinzel, serif', color: '#ffd97a' }}>
              Claim your share
            </span>
          </div>
          <button onClick={onClose} className="hover:opacity-60 transition-opacity" aria-label="fermer">
            <X size={14} style={{ color: '#6b6488' }} />
          </button>
        </div>

        <div className="px-5 py-5 text-center">
          <p className="text-[12px] mb-1" style={{ color: '#9990b8' }}>
            Rain pool · <strong style={{ color: '#ffd97a' }}>{rainAmount.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ⚜</strong>
          </p>
          <p className="text-[12px] mb-5" style={{ color: '#9990b8' }}>
            Ta part si tu claim : <strong style={{ color: '#ffd97a' }}>{perUser} ⚜</strong>
          </p>

          <p className="text-[11px] mb-2" style={{ color: '#6b6488' }}>
            Combien font
          </p>
          <p className="text-[36px] font-bold mb-4" style={{ fontFamily: 'Cinzel, serif', color: '#ffd97a' }}>
            {a} + {b} ?
          </p>

          <input
            ref={inputRef}
            type="number"
            inputMode="numeric"
            value={answer}
            onChange={(e) => { setAnswer(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
            disabled={busy}
            className="w-full text-center rounded-lg px-3 py-3 text-[20px] font-bold outline-none"
            style={{ background: '#13111f', border: `1px solid ${error ? 'rgba(239,68,68,0.5)' : '#2a2640'}`, color: '#e5e5e5' }}
          />

          {error && (
            <p className="mt-2 text-[11px]" style={{ color: '#f87171' }}>{error}</p>
          )}

          <button
            onClick={handleSubmit}
            disabled={busy || !answer}
            className="mt-5 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-[12px] font-bold tracking-wider uppercase transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #f5c842 0%, #d4a017 100%)', color: '#1a1010', border: 'none' }}
          >
            <Check size={14} />
            {busy ? 'Claim en cours…' : 'Claim'}
          </button>
        </div>
      </div>
    </div>
  );
}
