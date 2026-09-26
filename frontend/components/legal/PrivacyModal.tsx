'use client';

import { X, Shield } from 'lucide-react';
import { useT } from '@/lib/i18n';

export function PrivacyModal({ onClose }: { onClose: () => void }) {
  const { t } = useT();

  const sections = [
    { title: t('privacy_s1_title'), content: t('privacy_s1_content') },
    { title: t('privacy_s2_title'), content: t('privacy_s2_content') },
    { title: t('privacy_s3_title'), content: t('privacy_s3_content') },
    { title: t('privacy_s4_title'), content: t('privacy_s4_content') },
    { title: t('privacy_s5_title'), content: t('privacy_s5_content') },
    { title: t('privacy_s6_title'), content: t('privacy_s6_content') },
  ];

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}>
      <div
        className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl overflow-hidden"
        style={{ background: '#0d0b1a', border: '1px solid rgba(255,197,66,0.2)' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 shrink-0" style={{ borderBottom: '1px solid rgba(255,197,66,0.2)', background: '#09080f' }}>
          <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: '#ffc54220', border: '1px solid #ffc54240' }}>
            <Shield size={15} style={{ color: '#ffc542' }} />
          </div>
          <div className="flex-1">
            <h2 className="text-[15px] font-bold" style={{ color: '#e8e2f5', fontFamily: 'Cinzel, serif' }}>
              {t('privacy_modal_title')}
            </h2>
            <p className="text-[10px]" style={{ color: '#8981ab' }}>{t('privacy_modal_updated')}</p>
          </div>
          <button onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center transition-colors hover:bg-[#1e1a30]">
            <X size={14} style={{ color: '#8981ab' }} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          <p className="text-[13px] leading-relaxed" style={{ color: '#9990b8' }}>
            {t('privacy_intro')}
          </p>

          {sections.map(section => (
            <div key={section.title}>
              <h3 className="text-[13px] font-bold mb-2" style={{ color: '#ffc542' }}>{section.title}</h3>
              <p className="text-[12px] leading-relaxed whitespace-pre-line" style={{ color: '#9990b8' }}>{section.content}</p>
            </div>
          ))}

          <div className="rounded-xl p-4" style={{ background: '#13111f', border: '1px solid rgba(255,197,66,0.2)' }}>
            <p className="text-[11px] leading-relaxed" style={{ color: '#8981ab' }}>
              {t('privacy_contact_prefix')}{' '}
              <a href="mailto:support@ageofmoney.gg" className="hover:opacity-80 transition-opacity" style={{ color: '#ffc542' }}>
                support@ageofmoney.gg
              </a>
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 shrink-0 flex justify-end" style={{ borderTop: '1px solid rgba(255,197,66,0.2)', background: '#09080f' }}>
          <button onClick={onClose}
            className="px-5 py-2 rounded-lg text-[12px] font-bold transition-all hover:opacity-90"
            style={{ background: '#ffc542', color: '#07060f' }}>
            {t('legal_got_it')}
          </button>
        </div>
      </div>
    </div>
  );
}
