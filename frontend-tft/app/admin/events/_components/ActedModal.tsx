'use client';

import { useEffect, useState } from 'react';
import { X, Check } from 'lucide-react';

export function ActedModal({
  open,
  onClose,
  onConfirm,
  title,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (note: string) => Promise<void> | void;
  title: string;
  busy: boolean;
}) {
  const [note, setNote] = useState('');

  // Reset note every time the modal opens with a new target
  useEffect(() => {
    if (open) setNote('');
  }, [open]);

  // ESC closes
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center px-4"
      style={{ background: 'rgba(8,8,26,0.85)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-md overflow-hidden bg-tft-bg-card border border-tft-border shadow-arcane-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-tft-border">
          <div className="flex items-center gap-2">
            <Check size={14} className="text-tft-mint" />
            <span className="font-display font-bold text-[13px] tracking-widest uppercase text-tft-text">
              Marqué comme traité
            </span>
          </div>
          <button onClick={onClose} className="hover:opacity-60 transition-opacity" aria-label="fermer">
            <X size={14} className="text-tft-text-muted" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <p className="text-[12px] text-tft-text">
            <span className="font-bold">{title}</span>
          </p>
          <p className="text-[11px] text-tft-text-dim">
            Note optionnelle — ce que tu as lancé, quand, résultat attendu. Utile pour relire plus tard.
          </p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 500))}
            placeholder="Ex : bonus de dépôt 50% lancé sur Discord + bannière site pendant 72h…"
            className="w-full rounded-md px-3 py-2 text-[12px] outline-none resize-none bg-tft-bg-elevated border border-tft-border text-tft-text"
            rows={4}
          />
          <div className="flex justify-between items-center">
            <span className="text-[10px] text-tft-text-muted">
              {note.length} / 500
            </span>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                disabled={busy}
                className="px-3 py-1.5 rounded-md text-[11px] font-bold tracking-wider uppercase hover:opacity-80 transition-opacity disabled:opacity-50 font-ui bg-tft-bg-elevated border border-tft-border text-tft-text-dim"
              >
                Annuler
              </button>
              <button
                onClick={() => onConfirm(note.trim())}
                disabled={busy}
                className="px-3 py-1.5 rounded-md text-[11px] font-bold tracking-wider uppercase hover:opacity-80 transition-opacity disabled:opacity-50 font-ui text-white"
                style={{ background: 'linear-gradient(135deg, #34d399 0%, #059669 100%)' }}
              >
                {busy ? '…' : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
