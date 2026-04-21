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
      style={{ background: 'rgba(7,6,15,0.85)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl overflow-hidden"
        style={{ background: '#0d0b1a', border: '1px solid #1e1a30', boxShadow: '0 0 60px rgba(255,197,66,0.15)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid #1e1a30' }}>
          <div className="flex items-center gap-2">
            <Check size={14} style={{ color: '#10b981' }} />
            <span className="font-bold text-[13px] tracking-widest uppercase" style={{ fontFamily: 'Cinzel, serif', color: '#e8e2f5' }}>
              Marqué comme traité
            </span>
          </div>
          <button onClick={onClose} className="hover:opacity-60 transition-opacity" aria-label="fermer">
            <X size={14} style={{ color: '#6b6488' }} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <p className="text-[12px]" style={{ color: '#c8c0e0' }}>
            <span className="font-bold">{title}</span>
          </p>
          <p className="text-[11px]" style={{ color: '#9990b8' }}>
            Note optionnelle — ce que tu as lancé, quand, résultat attendu. Utile pour relire plus tard.
          </p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 500))}
            placeholder="Ex : bonus de dépôt 50% lancé sur Discord + bannière site pendant 72h…"
            className="w-full rounded-lg px-3 py-2 text-[12px] outline-none resize-none"
            rows={4}
            style={{ background: '#13111f', border: '1px solid #2a2640', color: '#e5e5e5' }}
          />
          <div className="flex justify-between items-center">
            <span className="text-[10px]" style={{ color: '#6b6488' }}>
              {note.length} / 500
            </span>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                disabled={busy}
                className="px-3 py-1.5 rounded-lg text-[11px] font-bold tracking-wider uppercase hover:opacity-80 transition-opacity disabled:opacity-50"
                style={{ background: '#13111f', border: '1px solid #2a2640', color: '#9990b8' }}
              >
                Annuler
              </button>
              <button
                onClick={() => onConfirm(note.trim())}
                disabled={busy}
                className="px-3 py-1.5 rounded-lg text-[11px] font-bold tracking-wider uppercase hover:opacity-80 transition-opacity disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', color: '#04110a', border: 'none' }}
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
