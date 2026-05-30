'use client';

/**
 * Owner-only Redeem Codes management UI — bottom of the /admin/events
 * dashboard on tft.money.
 *
 * The backend is shared between AgeOfMoney and tft.money, so codes minted
 * here are redeemable on either site.
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
        setSubmitMsg({ ok: true, text: `${ok} code${ok > 1 ? 's' : ''} créé${ok > 1 ? 's' : ''}` });
        setCode(''); setNotes('');
      } else if (ok > 0) {
        setSubmitMsg({ ok: true, text: `${ok} créés, ${failures.length} échec(s) (${failures[0]})` });
      } else {
        setSubmitMsg({ ok: false, text: failures[0] || 'Toutes les créations ont échoué' });
      }
      await refresh();
    } finally {
      setSubmitting(false);
    }
  }, [amount, code, expiresAt, maxUses, notes, quantity, refresh, wageringMultiplier]);

  const handleDisable = useCallback(async (id: string, codeName: string) => {
    if (!window.confirm(`Désactiver le code "${codeName}" ? Réversible uniquement via la DB.`)) return;
    try {
      await apiClient.patch(`/admin/redeem-codes/${id}/disable`);
      await refresh();
    } catch (e) {
      window.alert(`Échec : ${e instanceof Error ? e.message : 'unknown'}`);
    }
  }, [refresh]);

  return (
    <div className="mt-8">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 rounded-md border transition-colors bg-tft-bg-card border-tft-border"
      >
        <div className="flex items-center gap-2">
          <Gift size={15} className="text-tft-purple-bright" />
          <span className="font-display font-bold text-[14px] text-tft-purple-bright">
            REDEEM CODES
          </span>
          {codes !== null && (
            <span className="text-[11px] px-2 py-0.5 rounded bg-tft-purple/15 text-tft-text-dim font-ui">
              {codes.length} actifs
            </span>
          )}
        </div>
        {open ? <ChevronUp size={16} className="text-tft-text-dim" /> : <ChevronDown size={16} className="text-tft-text-dim" />}
      </button>

      {open && (
        <div className="mt-3 space-y-4">
          {/* ── CREATE FORM ───────────────────────────────────── */}
          <div className="rounded-md p-4 bg-tft-bg-card border border-tft-border">
            <h3 className="font-display text-[12px] font-bold mb-3 flex items-center gap-1.5 tracking-widest uppercase text-tft-purple-bright">
              <Plus size={12} /> Créer un ou plusieurs codes
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Code name */}
              <div>
                <label className="text-[10px] tracking-widest uppercase mb-1 block text-tft-text-dim font-ui">
                  Nom du code {parseInt(quantity, 10) > 1 ? '(utilisé comme préfixe)' : '(vide = auto-gen)'}
                </label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder={parseInt(quantity, 10) > 1 ? 'PROMO' : 'LAUNCH50'}
                  maxLength={20}
                  className="w-full h-9 px-3 text-xs uppercase tracking-widest rounded-md font-mono bg-tft-bg border border-tft-border text-tft-text"
                />
              </div>

              {/* Amount */}
              <div>
                <label className="text-[10px] tracking-widest uppercase mb-1 flex items-center gap-1 text-tft-text-dim font-ui">
                  <Coins size={9} /> Coins par redeem
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full h-9 px-3 text-xs rounded-md bg-tft-bg border border-tft-border text-tft-text"
                />
              </div>

              {/* Max uses */}
              <div>
                <label className="text-[10px] tracking-widest uppercase mb-1 flex items-center gap-1 text-tft-text-dim font-ui">
                  <Hash size={9} /> Max redeems / code (vide = illimité)
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={maxUses}
                  onChange={(e) => setMaxUses(e.target.value)}
                  placeholder="∞"
                  className="w-full h-9 px-3 text-xs rounded-md bg-tft-bg border border-tft-border text-tft-text"
                />
              </div>

              {/* Quantity */}
              <div>
                <label className="text-[10px] tracking-widest uppercase mb-1 flex items-center gap-1 text-tft-text-dim font-ui">
                  <Layers size={9} /> Quantité (codes à créer) — max {MAX_BATCH}
                </label>
                <input
                  type="number"
                  min="1"
                  max={MAX_BATCH}
                  step="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="w-full h-9 px-3 text-xs rounded-md bg-tft-bg border border-tft-border text-tft-text"
                />
              </div>

              {/* Expires at */}
              <div>
                <label className="text-[10px] tracking-widest uppercase mb-1 flex items-center gap-1 text-tft-text-dim font-ui">
                  <Calendar size={9} /> Expire le (vide = jamais)
                </label>
                <input
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  className="w-full h-9 px-3 text-xs rounded-md bg-tft-bg border border-tft-border text-tft-text"
                />
              </div>

              {/* Wagering multiplier */}
              <div>
                <label className="text-[10px] tracking-widest uppercase mb-1 block text-tft-text-dim font-ui">
                  Wagering × (1 à 5)
                </label>
                <input
                  type="number"
                  min="1"
                  max="5"
                  step="0.5"
                  value={wageringMultiplier}
                  onChange={(e) => setWageringMultiplier(e.target.value)}
                  className="w-full h-9 px-3 text-xs rounded-md bg-tft-bg border border-tft-border text-tft-text"
                />
              </div>

              {/* Notes */}
              <div className="md:col-span-2">
                <label className="text-[10px] tracking-widest uppercase mb-1 block text-tft-text-dim font-ui">
                  Notes (internes, max 500 chars)
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Lancement Reddit, giveaway Discord, partenaire X, etc."
                  maxLength={500}
                  className="w-full h-9 px-3 text-xs rounded-md bg-tft-bg border border-tft-border text-tft-text"
                />
              </div>
            </div>

            {/* Submit + message */}
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={handleCreate}
                disabled={submitting}
                className="flex items-center gap-2 px-5 h-9 rounded-md text-[12px] font-bold tracking-wider uppercase transition-all font-display text-white"
                style={{
                  background: submitting ? 'rgba(167,139,250,0.3)' : 'linear-gradient(135deg, #5b21b6, #a78bfa)',
                  cursor: submitting ? 'not-allowed' : 'pointer',
                }}
              >
                {submitting ? <RefreshCw size={12} className="animate-spin" /> : <Plus size={12} />}
                {submitting ? 'Création…' : `Créer ${parseInt(quantity, 10) > 1 ? `${quantity} codes` : 'le code'}`}
              </button>
              {submitMsg && (
                <span
                  className="text-[12px] flex items-center gap-1.5"
                  style={{ color: submitMsg.ok ? '#34d399' : '#fca5a5' }}
                >
                  {submitMsg.ok ? <Check size={12} /> : <AlertTriangle size={12} />}
                  {submitMsg.text}
                </span>
              )}
            </div>
          </div>

          {/* ── EXISTING CODES TABLE ───────────────────────────── */}
          <div className="rounded-md p-4 bg-tft-bg-card border border-tft-border">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display text-[12px] font-bold tracking-widest uppercase text-tft-purple-bright">
                Codes existants
              </h3>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-[11px] cursor-pointer text-tft-text-dim font-ui">
                  <input
                    type="checkbox"
                    checked={includeDisabled}
                    onChange={(e) => setIncludeDisabled(e.target.checked)}
                    className="cursor-pointer"
                  />
                  Afficher désactivés
                </label>
                <button
                  onClick={refresh}
                  disabled={loading}
                  className="flex items-center gap-1 text-[11px] hover:text-tft-purple-bright transition-colors text-tft-text-dim font-ui"
                >
                  <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Refresh
                </button>
              </div>
            </div>

            {err && (
              <div className="mb-3 px-3 py-2 rounded-md text-[12px] bg-tft-danger-dim text-tft-danger">
                {err}
              </div>
            )}

            {codes === null ? (
              <p className="text-[12px] text-tft-text-muted">Chargement…</p>
            ) : codes.length === 0 ? (
              <p className="text-[12px] text-center py-6 text-tft-text-muted">
                Aucun code pour l&apos;instant. Crée le premier ci-dessus.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-tft-text-muted border-b border-tft-border">
                      <th className="text-left py-2 font-normal uppercase tracking-widest font-ui">Code</th>
                      <th className="text-right py-2 font-normal uppercase tracking-widest font-ui">Montant</th>
                      <th className="text-right py-2 font-normal uppercase tracking-widest font-ui">Wagering</th>
                      <th className="text-right py-2 font-normal uppercase tracking-widest font-ui">Uses</th>
                      <th className="text-left py-2 font-normal uppercase tracking-widest font-ui">Expire</th>
                      <th className="text-left py-2 font-normal uppercase tracking-widest font-ui">Statut</th>
                      <th className="text-right py-2 font-normal uppercase tracking-widest font-ui"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {codes.map((c) => {
                      const expired = c.expiresAt && new Date(c.expiresAt).getTime() < Date.now();
                      const exhausted = c.maxUses !== null && c.currentUses >= c.maxUses;
                      const status = c.disabled ? 'disabled' : expired ? 'expired' : exhausted ? 'exhausted' : 'active';
                      const statusColor = status === 'active' ? '#34d399' : status === 'disabled' ? '#fca5a5' : '#94a3b8';
                      return (
                        <tr key={c.id} className="border-b border-tft-border/60">
                          <td className="py-2 font-mono font-bold text-tft-text">{c.code}</td>
                          <td className="py-2 text-right text-tft-gold-bright">
                            {parseFloat(c.amount).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ◈
                          </td>
                          <td className="py-2 text-right text-tft-text-dim">×{parseFloat(c.wageringMultiplier)}</td>
                          <td className="py-2 text-right text-tft-text-dim">
                            {c.currentUses}{c.maxUses !== null ? `/${c.maxUses}` : ''}
                          </td>
                          <td className="py-2 text-tft-text-dim">
                            {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' }) : 'jamais'}
                          </td>
                          <td className="py-2">
                            <span style={{ color: statusColor }}>{status}</span>
                          </td>
                          <td className="py-2 text-right">
                            {!c.disabled && (
                              <button
                                onClick={() => handleDisable(c.id, c.code)}
                                className="p-1 rounded hover:bg-tft-danger-dim transition-colors"
                                title="Désactiver le code"
                                aria-label={`Désactiver le code ${c.code}`}
                              >
                                <Ban size={12} className="text-tft-danger" />
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
