'use client';

/**
 * Redeem-code popover trigger — sits in the Navbar at the left of the
 * notification bell. Visual contract mirrors the bell : square 9×9 button
 * with the same border/hover treatment, then a right-anchored dropdown
 * panel with the same dark background as the notif panel.
 *
 * Why a standalone popover (not a tab inside WalletModal) :
 *   - Discoverability for the soft-launch promo blast — the whole point
 *     of LAUNCH50 / DISCORD10 is one-click redeem visibility, not buried
 *     three scrolls down inside the wallet modal.
 *   - Wallet modal stays focused on deposit/withdraw flows.
 *
 * The auth bearer is attached automatically by `apiClient` (axios instance
 * in lib/api.ts), so no manual header wiring here.
 */

import { useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Gift, RefreshCw, Check, Lock, X } from 'lucide-react';
import { signInWithSteam } from '@/lib/authHelpers';
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';

interface RedemptionRow {
  id: string;
  code: string;
  amount: string;
  wageringRequired: string;
  wageringDone: string;
  unlocked: boolean;
  redeemedAt: string;
}

export function RedeemPopover() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [history, setHistory] = useState<RedemptionRow[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const res = await apiClient.get('/redeem/me/history');
      setHistory(Array.isArray(res.data?.data) ? res.data.data : []);
    } catch {
      setHistory([]);
    }
  }, []);

  const handleRedeem = useCallback(async () => {
    if (!session) { signInWithSteam(); return; }
    const c = code.trim().toUpperCase();
    if (!c) { setMsg({ ok: false, text: 'Enter a code' }); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await apiClient.post('/redeem', { code: c });
      const data = res.data;
      if (data.ok === false) {
        setMsg({ ok: false, text: data.message ?? 'Code rejected' });
      } else {
        setMsg({
          ok: true,
          text: `+${data.amount} ⚜ locked. Wager ${data.wageringRequired} ⚜ to unlock.`,
        });
        setCode('');
        if (historyOpen) loadHistory();
      }
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Network error' });
    } finally {
      setBusy(false);
    }
  }, [session, code, historyOpen, loadHistory]);

  const toggleHistory = useCallback(() => {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next && history === null) loadHistory();
  }, [historyOpen, history, loadHistory]);

  const closePanel = () => {
    setOpen(false);
    setMsg(null);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative w-9 h-9 flex items-center justify-center rounded border border-aoe-border bg-aoe-stone/30 hover:border-aoe-border-gold transition-colors"
        title="Redeem code"
        aria-label="Redeem promo code"
      >
        <Gift size={15} className="text-aoe-parchment-dim" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={closePanel} />
          <div
            className="absolute right-0 top-full mt-2 w-80 rounded-xl overflow-hidden shadow-2xl z-20"
            style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e1a30]">
              <span className="font-cinzel text-[13px] text-[#ffc542] font-bold flex items-center gap-1.5">
                <Gift size={12} /> Redeem code
              </span>
              <button
                onClick={closePanel}
                className="text-[#6b6488] hover:text-aoe-parchment p-0.5"
                aria-label="Close"
              >
                <X size={13} />
              </button>
            </div>

            {/* Body */}
            <div className="px-4 py-3 space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleRedeem(); }}
                  placeholder="LAUNCH50"
                  maxLength={20}
                  autoFocus
                  className="aom-input h-9 text-xs flex-1 uppercase tracking-widest font-cinzel"
                />
                <button
                  onClick={handleRedeem}
                  disabled={busy || !code.trim()}
                  className={cn(
                    'px-4 h-9 rounded-md text-xs font-cinzel font-bold tracking-wide transition-all shrink-0',
                    (busy || !code.trim()) && 'opacity-60 cursor-not-allowed',
                  )}
                  style={{ background: 'linear-gradient(135deg, #b8881a, #ffc542)', color: '#07060f' }}
                >
                  {busy ? <RefreshCw size={11} className="animate-spin" /> : 'Redeem'}
                </button>
              </div>

              {msg ? (
                <p
                  className={cn(
                    'text-[11px] leading-snug',
                    msg.ok ? 'text-aoe-emerald-bright' : 'text-aoe-crimson-bright',
                  )}
                >
                  {msg.text}
                </p>
              ) : (
                <p className="text-[11px] text-[#6b6488] leading-snug">
                  Bonus coins are locked until you wager them through. Withdraw is blocked on locked coins.
                </p>
              )}

              <button
                onClick={toggleHistory}
                className="text-[11px] text-[#9988bb] hover:text-aoe-gold font-cinzel tracking-wide transition-colors"
              >
                {historyOpen ? '− Hide history' : '+ Show history'}
              </button>

              {historyOpen && (
                <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
                  {history === null ? (
                    <p className="text-[11px] text-[#6b6488]">Loading…</p>
                  ) : history.length === 0 ? (
                    <p className="text-[11px] text-[#6b6488]">No codes redeemed yet.</p>
                  ) : (
                    history.map((r) => {
                      const done = parseFloat(r.wageringDone);
                      const required = parseFloat(r.wageringRequired);
                      const pct = required > 0 ? Math.min(100, Math.round((done / required) * 100)) : 0;
                      return (
                        <div
                          key={r.id}
                          className="rounded-md p-2 border"
                          style={{ background: '#07060f', borderColor: '#1e1a30' }}
                        >
                          <div className="flex items-center justify-between text-[11px] mb-1">
                            <span className="font-cinzel font-bold text-aoe-parchment">{r.code}</span>
                            <span className="font-cinzel text-aoe-gold">+{r.amount} ⚜</span>
                          </div>
                          {r.unlocked ? (
                            <div className="text-[10px] text-aoe-emerald-bright flex items-center gap-1">
                              <Check size={10} /> Unlocked — added to spendable
                            </div>
                          ) : (
                            <>
                              <div className="text-[10px] text-[#9988bb] flex items-center gap-1 mb-1">
                                <Lock size={9} /> {done.toFixed(0)} / {required.toFixed(0)} ⚜ wagered ({pct}%)
                              </div>
                              <div className="h-1 rounded-full overflow-hidden" style={{ background: '#1e1a30' }}>
                                <div
                                  className="h-full transition-all"
                                  style={{
                                    width: `${pct}%`,
                                    background: 'linear-gradient(90deg, #b8881a, #ffc542)',
                                  }}
                                />
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
