'use client';

/**
 * Owner-only Redeem Codes management UI — lives at the bottom of the
 * /admin/events dashboard alongside Rain history (same screen real estate
 * the owner is already familiar with for promo levers).
 *
 * Capabilities :
 *   - List existing codes (active by default ; toggle to include disabled)
 *   - Create one or many codes in a single submit (the "quantité" field) :
 *       quantity = 1 → use the user-provided code name (or auto-gen if empty)
 *       quantity > 1 → ignore the name field, auto-generate N unique codes
 *                      with the same params (great for DM giveaways where
 *                      every recipient gets a single-use code)
 *   - Disable a code with one click
 *
 * Backend contracts :
 *   GET    /api/v1/admin/redeem-codes?includeDisabled=true|false
 *   POST   /api/v1/admin/redeem-codes              (requireOwner)
 *   PATCH  /api/v1/admin/redeem-codes/:id/disable  (requireOwner)
 *
 * Mass-create is N sequential POSTs from the frontend (no backend bulk
 * endpoint exists yet — the v1 surface stays minimal). N is capped at 100
 * client-side to avoid accidental thousand-code blasts.
 */

import { useCallback, useEffect, useState } from 'react';
import { Gift, Plus, Ban, RefreshCw, Calendar, Hash, Coins, Layers, AlertTriangle, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { apiClient } from '@/lib/api';

interface RedeemCodeRow {
  id: string;
  code: string;
  amount: string;
  maxUses: number | null;
  currentUses: number;
  expiresAt: string | null;
  wageringMultiplier: string;
  disabled: boolean;
  createdAt: string;
  notes: string | null;
}

const MAX_BATCH = 100;
const DEFAULT_MULT = 2;

// Tight A-Z 0-9 char set (no I/O/0/1 — anti-confusion for codes typed by
// users on mobile). 32-char alphabet → 8-char suffix = 32^8 ≈ 1.1e12 codes.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randCode(prefix: string, length = 8): string {
  let out = '';
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  for (let i = 0; i < length; i++) out += ALPHABET[arr[i] % ALPHABET.length];
  const trimmed = (prefix || '').trim().toUpperCase().slice(0, 12);
  return (trimmed + out).slice(0, 20);
}

export function RedeemCodesSection({ ready }: { ready: boolean }) {
  const [open, setOpen] = useState(false);
  const [codes, setCodes] = useState<RedeemCodeRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [includeDisabled, setIncludeDisabled] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Form state
  const [code, setCode] = useState('');
  const [amount, setAmount] = useState('50');
  const [maxUses, setMaxUses] = useState(''); // empty = unlimited
  const [expiresAt, setExpiresAt] = useState(''); // datetime-local format
  const [wageringMultiplier, setWageringMultiplier] = useState(String(DEFAULT_MULT));
  const [quantity, setQuantity] = useState('1');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(async () => {
    if (!ready) return;
    setLoading(true); setErr(null);
    try {
      const res = await apiClient.get(`/admin/redeem-codes?includeDisabled=${includeDisabled}`);
      setCodes(Array.isArray(res.data?.data) ? res.data.data : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load codes');
    } finally {
      setLoading(false);
    }
  }, [ready, includeDisabled]);

  useEffect(() => { if (open && ready) refresh(); }, [open, ready, refresh]);

  const handleCreate = useCallback(async () => {
    setSubmitMsg(null);
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setSubmitMsg({ ok: false, text: 'Amount must be > 0' });
      return;
    }
    const mult = parseFloat(wageringMultiplier);
    if (!Number.isFinite(mult) || mult < 1 || mult > 5) {
      setSubmitMsg({ ok: false, text: 'Wagering multiplier must be in [1, 5]' });
      return;
    }
    const qty = Math.max(1, Math.min(MAX_BATCH, parseInt(quantity, 10) || 1));
    const maxUsesNum = maxUses.trim() === '' ? null : parseInt(maxUses, 10);
    if (maxUsesNum !== null && (!Number.isInteger(maxUsesNum) || maxUsesNum < 1)) {
      setSubmitMsg({ ok: false, text: 'Max uses must be a positive integer or empty' });
      return;
    }
    let expiresAtIso: string | null = null;
    if (expiresAt.trim()) {
      const d = new Date(expiresAt);
      if (Number.isNaN(d.getTime())) {
        setSubmitMsg({ ok: false, text: 'Invalid expiration date' });
        return;
      }
      if (d.getTime() < Date.now()) {
        setSubmitMsg({ ok: false, text: 'Expiration must be in the future' });
        return;
      }
      expiresAtIso = d.toISOString();
    }

    setSubmitting(true);
    let ok = 0;
    const failures: string[] = [];
    try {
      for (let i = 0; i < qty; i++) {
        // qty=1 + name given → use it as-is. Otherwise auto-generate (with
        // optional prefix from the name field).
        const codeName = qty === 1 && code.trim() ? code.trim().toUpperCase() : randCode(code);
        try {
          await apiClient.post('/admin/redeem-codes', {
            code: codeName,
            amount: amt,
            maxUses: maxUsesNum ?? undefined,
            expiresAt: expiresAtIso ?? undefined,
            wageringMultiplier: mult,
            notes: notes.trim() || undefined,
          });
          ok++;
        } catch (e) {
          failures.push(`${codeName}: ${e instanceof Error ? e.message : 'failed'}`);
        }
      }
      if (ok > 0 && failures.length === 0) {
        setSubmitMsg({ ok: true, text: `✓ ${ok} code${ok > 1 ? 's' : ''} created` });
        setCode(''); setNotes('');
      } else if (ok > 0) {
        setSubmitMsg({ ok: true, text: `${ok} created, ${failures.length} failed (${failures[0]})` });
      } else {
        setSubmitMsg({ ok: false, text: failures[0] || 'All creates failed' });
      }
      await refresh();
    } finally {
      setSubmitting(false);
    }
  }, [amount, code, expiresAt, maxUses, notes, quantity, refresh, wageringMultiplier]);

  const handleDisable = useCallback(async (id: string, codeName: string) => {
    if (!window.confirm(`Disable code "${codeName}" ? This is reversible only via DB.`)) return;
    try {
      await apiClient.patch(`/admin/redeem-codes/${id}/disable`);
      await refresh();
    } catch (e) {
      window.alert(`Failed to disable: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  }, [refresh]);

  return (
    <div className="mt-8">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-colors"
        style={{ background: '#0e0d1a', borderColor: '#1e1a30' }}
      >
        <div className="flex items-center gap-2">
          <Gift size={15} style={{ color: '#ffd97a' }} />
          <span className="font-bold text-[14px]" style={{ fontFamily: 'Cinzel, serif', color: '#ffd97a' }}>
            REDEEM CODES
          </span>
          {codes !== null && (
            <span className="text-[11px] px-2 py-0.5 rounded" style={{ background: 'rgba(255,217,122,0.1)', color: '#9990b8' }}>
              {codes.length} active
            </span>
          )}
        </div>
        {open ? <ChevronUp size={16} style={{ color: '#9990b8' }} /> : <ChevronDown size={16} style={{ color: '#9990b8' }} />}
      </button>

      {open && (
        <div className="mt-3 space-y-4">
          {/* ── CREATE FORM ───────────────────────────────────── */}
          <div
            className="rounded-xl p-4"
            style={{ background: '#0e0d1a', border: '1px solid #1e1a30' }}
          >
            <h3 className="text-[12px] font-bold mb-3 flex items-center gap-1.5 tracking-widest uppercase" style={{ color: '#ffd97a', fontFamily: 'Cinzel, serif' }}>
              <Plus size={12} /> Create code(s)
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Code name */}
              <div>
                <label className="text-[10px] tracking-widest uppercase mb-1 block" style={{ color: '#9990b8' }}>
                  Code name {parseInt(quantity, 10) > 1 ? '(used as prefix)' : '(empty = auto-gen)'}
                </label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder={parseInt(quantity, 10) > 1 ? 'PROMO' : 'LAUNCH50'}
                  maxLength={20}
                  className="w-full h-9 px-3 text-xs uppercase tracking-widest rounded font-mono"
                  style={{ background: '#07060f', border: '1px solid #1e1a30', color: '#e8e2f5' }}
                />
              </div>

              {/* Amount */}
              <div>
                <label className="text-[10px] tracking-widest uppercase mb-1 flex items-center gap-1" style={{ color: '#9990b8' }}>
                  <Coins size={9} /> Coins per redeem
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full h-9 px-3 text-xs rounded"
                  style={{ background: '#07060f', border: '1px solid #1e1a30', color: '#e8e2f5' }}
                />
              </div>

              {/* Max uses */}
              <div>
                <label className="text-[10px] tracking-widest uppercase mb-1 flex items-center gap-1" style={{ color: '#9990b8' }}>
                  <Hash size={9} /> Max redeems / code (empty = unlimited)
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={maxUses}
                  onChange={(e) => setMaxUses(e.target.value)}
                  placeholder="∞"
                  className="w-full h-9 px-3 text-xs rounded"
                  style={{ background: '#07060f', border: '1px solid #1e1a30', color: '#e8e2f5' }}
                />
              </div>

              {/* Quantity */}
              <div>
                <label className="text-[10px] tracking-widest uppercase mb-1 flex items-center gap-1" style={{ color: '#9990b8' }}>
                  <Layers size={9} /> Quantity (codes to create) — max {MAX_BATCH}
                </label>
                <input
                  type="number"
                  min="1"
                  max={MAX_BATCH}
                  step="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="w-full h-9 px-3 text-xs rounded"
                  style={{ background: '#07060f', border: '1px solid #1e1a30', color: '#e8e2f5' }}
                />
              </div>

              {/* Expires at */}
              <div>
                <label className="text-[10px] tracking-widest uppercase mb-1 flex items-center gap-1" style={{ color: '#9990b8' }}>
                  <Calendar size={9} /> Expires at (empty = never)
                </label>
                <input
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  className="w-full h-9 px-3 text-xs rounded"
                  style={{ background: '#07060f', border: '1px solid #1e1a30', color: '#e8e2f5' }}
                />
              </div>

              {/* Wagering multiplier */}
              <div>
                <label className="text-[10px] tracking-widest uppercase mb-1 block" style={{ color: '#9990b8' }}>
                  Wagering × (1 to 5)
                </label>
                <input
                  type="number"
                  min="1"
                  max="5"
                  step="0.5"
                  value={wageringMultiplier}
                  onChange={(e) => setWageringMultiplier(e.target.value)}
                  className="w-full h-9 px-3 text-xs rounded"
                  style={{ background: '#07060f', border: '1px solid #1e1a30', color: '#e8e2f5' }}
                />
              </div>

              {/* Notes */}
              <div className="md:col-span-2">
                <label className="text-[10px] tracking-widest uppercase mb-1 block" style={{ color: '#9990b8' }}>
                  Notes (internal, max 500 chars)
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Reddit launch, Discord giveaway, partner X, etc."
                  maxLength={500}
                  className="w-full h-9 px-3 text-xs rounded"
                  style={{ background: '#07060f', border: '1px solid #1e1a30', color: '#e8e2f5' }}
                />
              </div>
            </div>

            {/* Submit + message */}
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={handleCreate}
                disabled={submitting}
                className="flex items-center gap-2 px-5 h-9 rounded text-[12px] font-bold tracking-wider uppercase transition-all"
                style={{
                  background: submitting ? 'rgba(255,217,122,0.3)' : 'linear-gradient(135deg, #b8881a, #ffc542)',
                  color: '#07060f',
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  fontFamily: 'Cinzel, serif',
                }}
              >
                {submitting ? <RefreshCw size={12} className="animate-spin" /> : <Plus size={12} />}
                {submitting ? 'Creating…' : `Create ${parseInt(quantity, 10) > 1 ? `${quantity} codes` : 'code'}`}
              </button>
              {submitMsg && (
                <span
                  className="text-[12px] flex items-center gap-1.5"
                  style={{ color: submitMsg.ok ? '#10b981' : '#fca5a5' }}
                >
                  {submitMsg.ok ? <Check size={12} /> : <AlertTriangle size={12} />}
                  {submitMsg.text}
                </span>
              )}
            </div>
          </div>

          {/* ── EXISTING CODES TABLE ───────────────────────────── */}
          <div
            className="rounded-xl p-4"
            style={{ background: '#0e0d1a', border: '1px solid #1e1a30' }}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[12px] font-bold tracking-widest uppercase" style={{ color: '#ffd97a', fontFamily: 'Cinzel, serif' }}>
                Existing codes
              </h3>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-[11px] cursor-pointer" style={{ color: '#9990b8' }}>
                  <input
                    type="checkbox"
                    checked={includeDisabled}
                    onChange={(e) => setIncludeDisabled(e.target.checked)}
                    className="cursor-pointer"
                  />
                  Show disabled
                </label>
                <button
                  onClick={refresh}
                  disabled={loading}
                  className="flex items-center gap-1 text-[11px] hover:text-[#ffd97a] transition-colors"
                  style={{ color: '#9990b8' }}
                >
                  <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Refresh
                </button>
              </div>
            </div>

            {err && (
              <div className="mb-3 px-3 py-2 rounded text-[12px]" style={{ background: 'rgba(239,68,68,0.08)', color: '#fca5a5' }}>
                {err}
              </div>
            )}

            {codes === null ? (
              <p className="text-[12px]" style={{ color: '#6b6488' }}>Loading…</p>
            ) : codes.length === 0 ? (
              <p className="text-[12px] text-center py-6" style={{ color: '#6b6488' }}>
                No codes yet. Create your first one above.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr style={{ color: '#6b6488', borderBottom: '1px solid #1e1a30' }}>
                      <th className="text-left py-2 font-normal uppercase tracking-widest">Code</th>
                      <th className="text-right py-2 font-normal uppercase tracking-widest">Amount</th>
                      <th className="text-right py-2 font-normal uppercase tracking-widest">Wagering</th>
                      <th className="text-right py-2 font-normal uppercase tracking-widest">Uses</th>
                      <th className="text-left py-2 font-normal uppercase tracking-widest">Expires</th>
                      <th className="text-left py-2 font-normal uppercase tracking-widest">Status</th>
                      <th className="text-right py-2 font-normal uppercase tracking-widest"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {codes.map((c) => {
                      const expired = c.expiresAt && new Date(c.expiresAt).getTime() < Date.now();
                      const exhausted = c.maxUses !== null && c.currentUses >= c.maxUses;
                      const status = c.disabled ? 'disabled' : expired ? 'expired' : exhausted ? 'exhausted' : 'active';
                      const statusColor = status === 'active' ? '#10b981' : status === 'disabled' ? '#fca5a5' : '#9990b8';
                      return (
                        <tr key={c.id} style={{ borderBottom: '1px solid #1a1830' }}>
                          <td className="py-2 font-mono font-bold" style={{ color: '#e8e2f5' }}>{c.code}</td>
                          <td className="py-2 text-right" style={{ color: '#ffd97a' }}>
                            {parseFloat(c.amount).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ⚜
                          </td>
                          <td className="py-2 text-right" style={{ color: '#9990b8' }}>×{parseFloat(c.wageringMultiplier)}</td>
                          <td className="py-2 text-right" style={{ color: '#9990b8' }}>
                            {c.currentUses}{c.maxUses !== null ? `/${c.maxUses}` : ''}
                          </td>
                          <td className="py-2" style={{ color: '#9990b8' }}>
                            {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' }) : 'never'}
                          </td>
                          <td className="py-2">
                            <span style={{ color: statusColor }}>{status}</span>
                          </td>
                          <td className="py-2 text-right">
                            {!c.disabled && (
                              <button
                                onClick={() => handleDisable(c.id, c.code)}
                                className="p-1 rounded hover:bg-red-500/10 transition-colors"
                                title="Disable code"
                                aria-label={`Disable code ${c.code}`}
                              >
                                <Ban size={12} style={{ color: '#fca5a5' }} />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
