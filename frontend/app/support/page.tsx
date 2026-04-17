'use client';

export const dynamic = 'force-dynamic';

import { useState } from 'react';
import { Send, CheckCircle, ChevronDown } from 'lucide-react';
import { useT } from '@/lib/i18n';

export default function SupportPage() {
  const { t } = useT();
  const [form, setForm] = useState({
    email: '',
    subject: '',
    message: '',
  });
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const SUBJECTS = [
    { value: 'deposit',    label: t('support_subj_deposit') },
    { value: 'withdraw',   label: t('support_subj_withdraw') },
    { value: 'connection', label: t('support_subj_connection') },
    { value: 'bet',        label: t('support_subj_bet') },
    { value: 'roulette',   label: t('support_subj_roulette') },
    { value: 'account',    label: t('support_subj_account') },
    { value: 'question',   label: t('support_subj_question') },
    { value: 'other',      label: t('support_subj_other') },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.email || !form.subject || !form.message.trim()) {
      setError(t('support_fill_all'));
      return;
    }
    setError('');
    setLoading(true);

    const subjectLabel = SUBJECTS.find(s => s.value === form.subject)?.label ?? form.subject;

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/support`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email, subject: subjectLabel, message: form.message }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || t('support_fill_all'));
        return;
      }
      setSubmitted(true);
    } catch {
      setError('Erreur réseau. Veuillez réessayer.');
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: '#07060f' }}>
        <div className="max-w-md w-full rounded-2xl p-8 text-center" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: '#16a34a22', border: '1px solid #16a34a44' }}>
            <CheckCircle size={28} style={{ color: '#22c55e' }} />
          </div>
          <h2 className="text-[20px] font-bold mb-2" style={{ color: '#e8e2f5', fontFamily: 'Cinzel, serif' }}>
            {t('support_sent_title')}
          </h2>
          <p className="text-[13px] leading-relaxed mb-6" style={{ color: '#6b6488' }}>
            {t('support_sent_desc', { email: form.email })}
          </p>
          <a href="/"
            className="inline-block px-6 py-2.5 rounded-lg text-[13px] font-bold transition-all hover:opacity-90"
            style={{ background: '#d4a017', color: '#07060f' }}>
            {t('support_back_home')}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-4 py-12" style={{ background: '#07060f' }}>
      <div className="max-w-xl mx-auto">

        {/* Header */}
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-4 text-[11px] font-medium uppercase tracking-widest"
            style={{ background: '#d4a01715', border: '1px solid #d4a01730', color: '#d4a017' }}>
            {t('support_title')}
          </div>
          <h1 className="text-[28px] font-bold mb-2" style={{ color: '#e8e2f5', fontFamily: 'Cinzel, serif' }}>
            {t('support_open_ticket')}
          </h1>
          <p className="text-[13px]" style={{ color: '#6b6488' }}>
            {t('support_subtitle')}
          </p>
        </div>

        {/* Form card */}
        <form onSubmit={handleSubmit}
          className="rounded-2xl p-6 space-y-5"
          style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>

          {/* Email */}
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wider mb-2" style={{ color: '#9990b8' }}>
              {t('support_email')}
            </label>
            <input
              type="email"
              required
              placeholder="votre@email.com"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              className="w-full h-10 rounded-lg px-4 text-[13px] outline-none transition-all"
              style={{
                background: '#13111f',
                border: '1px solid #1e1a30',
                color: '#e8e2f5',
              }}
            />
          </div>

          {/* Subject */}
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wider mb-2" style={{ color: '#9990b8' }}>
              {t('support_subject')}
            </label>
            <div className="relative">
              <select
                required
                value={form.subject}
                onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                className="w-full h-10 rounded-lg px-4 pr-9 text-[13px] outline-none appearance-none transition-all"
                style={{
                  background: '#13111f',
                  border: '1px solid #1e1a30',
                  color: form.subject ? '#e8e2f5' : '#3d3860',
                }}>
                <option value="" disabled>{t('support_subject_placeholder')}</option>
                {SUBJECTS.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#6b6488' }} />
            </div>
          </div>

          {/* Message */}
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wider mb-2" style={{ color: '#9990b8' }}>
              {t('support_message')}
            </label>
            <textarea
              required
              placeholder={t('support_message_placeholder')}
              value={form.message}
              onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
              rows={6}
              maxLength={2000}
              className="w-full rounded-lg px-4 py-3 text-[13px] outline-none resize-none transition-all"
              style={{
                background: '#13111f',
                border: '1px solid #1e1a30',
                color: '#e8e2f5',
              }}
            />
            <p className="text-right text-[10px] mt-1" style={{ color: '#3d3860' }}>
              {form.message.length}/2000
            </p>
          </div>

          {error && (
            <p className="text-[12px] text-red-400 bg-red-400/10 rounded-lg px-3 py-2.5">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full h-11 rounded-lg flex items-center justify-center gap-2 text-[13px] font-bold transition-all disabled:opacity-60 hover:opacity-90"
            style={{ background: '#d4a017', color: '#07060f' }}>
            {loading ? (
              <span className="animate-spin w-4 h-4 border-2 border-[#07060f]/30 border-t-[#07060f] rounded-full" />
            ) : (
              <>
                <Send size={14} />
                {t('support_send')}
              </>
            )}
          </button>
        </form>

        {/* Info card */}
        <div className="mt-6">
          <div className="rounded-xl p-4 text-center" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
            <div className="text-[20px] mb-1">⏱</div>
            <p className="text-[11px] font-semibold mb-0.5" style={{ color: '#e8e2f5' }}>{t('support_response_time')}</p>
            <p className="text-[10px]" style={{ color: '#6b6488' }}>{t('support_response_desc')}</p>
          </div>
        </div>

      </div>
    </div>
  );
}
