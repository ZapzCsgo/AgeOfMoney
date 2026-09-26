'use client';

import { useEffect, useState } from 'react';
import { Shield, X } from 'lucide-react';
import { subscribeTotpChallenge, resolveTotpCode, rejectTotpCode } from '@/lib/totpChallenge';
import { useT } from '@/lib/i18n';

/**
 * Global 2FA challenge modal, monté une fois dans le layout. S'affiche
 * automatiquement quand une requête API renvoie TOTP_REQUIRED via
 * l'axios interceptor. Ferme tout seul après succès.
 *
 * Jamais de `autoFocus` sur mobile pour ne pas scroller la page ; on
 * autofocus uniquement quand le modal s'ouvre effectivement.
 */
export function TotpChallengeModal() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<'unknown_ip' | 'sensitive_action' | undefined>();
  const [invalidAttempt, setInvalidAttempt] = useState(false);
  const [code, setCode] = useState('');

  useEffect(() => {
    return subscribeTotpChallenge((s) => {
      setOpen(s.open);
      setReason(s.reason);
      setInvalidAttempt(!!s.invalidAttempt);
      if (s.open) setCode('');
    });
  }, []);

  function submit() {
    if (!/^\d{6}$/.test(code)) return;
    resolveTotpCode(code);
  }

  function cancel() {
    rejectTotpCode('cancelled');
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) cancel(); }}
    >
      <div
        className="w-full max-w-sm rounded-2xl overflow-hidden relative"
        style={{ background: '#0d0b1a', border: '1px solid rgba(255,197,66,0.2)', boxShadow: '0 0 60px rgba(255,197,66,0.12)' }}
      >
        <button
          onClick={cancel}
          aria-label={t('sec_cancel')}
          className="absolute top-3 right-3 w-7 h-7 rounded-full flex items-center justify-center text-[#9990b8] hover:text-[#e8e2f5] hover:bg-[#1e1a30] transition-all"
        >
          <X size={16} />
        </button>

        <div className="px-6 pt-7 pb-5 flex flex-col items-center text-center">
          <div className="w-12 h-12 rounded-full flex items-center justify-center mb-3" style={{ background: 'rgba(255,197,66,0.1)', border: '1px solid rgba(255,197,66,0.3)' }}>
            <Shield size={20} className="text-[#ffc542]" />
          </div>
          <h2 className="font-bold text-lg text-[#ffc542] mb-1" style={{ fontFamily: 'Cinzel, serif' }}>
            {t('sec_2fa_modal_title')}
          </h2>
          <p className="text-[12px] text-[#9990b8] leading-relaxed max-w-[280px]">
            {reason === 'sensitive_action'
              ? t('sec_2fa_reason_sensitive')
              : t('sec_2fa_reason_new_login')}
          </p>

          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder="000000"
            className="mt-5 w-full rounded-lg px-4 py-3 text-center text-2xl tracking-[0.5em] font-mono text-[#e8e2f5] placeholder-[#3d3860] outline-none"
            style={{
              background: '#07060f',
              border: `1px solid ${invalidAttempt ? '#ef4444' : 'rgba(255,197,66,0.2)'}`,
            }}
          />
          {invalidAttempt && (
            <p className="text-[11px] text-red-400 mt-2">{t('sec_2fa_wrong_code')}</p>
          )}

          <div className="flex gap-2 mt-5 w-full">
            <button
              onClick={cancel}
              className="flex-1 py-2.5 rounded-lg text-[13px] font-semibold text-[#8981ab] hover:text-[#c8c0e0] border border-[#1e1a30] transition-colors"
            >
              {t('sec_cancel')}
            </button>
            <button
              onClick={submit}
              disabled={!/^\d{6}$/.test(code)}
              className="flex-1 py-2.5 rounded-lg text-[13px] font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: 'linear-gradient(135deg, #b8881a, #ffc542)',
                color: '#07060f',
              }}
            >
              {t('common_validate')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
