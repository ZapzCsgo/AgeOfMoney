'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Globe } from 'lucide-react';
import { useT, LANGUAGES } from '@/lib/i18n';
import { PrivacyModal } from '@/components/legal/PrivacyModal';
import { TermsModal } from '@/components/legal/TermsModal';

export function Footer() {
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const { t, lang, setLang } = useT();

  const currentLang = LANGUAGES.find(l => l.code === lang) ?? LANGUAGES[0];

  const GAMES_LINKS = [
    { href: '/', label: t('nav_matches') },
    { href: '/roulette', label: t('nav_roulette') },
    { href: '/affiliate', label: t('nav_affiliates') },
  ];

  const PLATFORM_LINKS = [
    { href: '/support', label: t('footer_support') },
    { href: '/affiliate', label: t('footer_partners') },
  ];

  return (
    <>
      <footer style={{ background: '#09080f', borderTop: '1px solid rgba(255,197,66,0.2)' }}>
        {/* Main section */}
        <div className="max-w-6xl mx-auto px-6 py-12">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-10">

            {/* Brand column */}
            <div className="md:col-span-1 space-y-4">
              <Link href="/" className="flex items-center gap-2 group">
                <svg width="26" height="20" viewBox="0 0 32 28" fill="none">
                  <path d="M2 22L6 8L12 16L16 4L20 16L26 8L30 22H2Z" fill="#c9a227" stroke="#e8c547" strokeWidth="0.8" strokeLinejoin="round"/>
                  <path d="M2 22H30V26H2V22Z" fill="#8b6914" stroke="#c9a227" strokeWidth="0.8"/>
                  <circle cx="2" cy="8" r="2" fill="#e8c547"/>
                  <circle cx="16" cy="4" r="2" fill="#e8c547"/>
                  <circle cx="30" cy="8" r="2" fill="#e8c547"/>
                </svg>
                <span className="font-bold text-[15px] tracking-widest" style={{ fontFamily: 'Cinzel,serif', color: '#ffd97a' }}>
                  AgeOfMoney
                </span>
              </Link>

              <p className="text-[12px] leading-relaxed" style={{ color: '#8981ab' }}>
                {t('footer_copyright')}
              </p>
              <p className="text-[11px] leading-relaxed" style={{ color: '#6a6390' }}>
                {t('footer_disclaimer_before')}<strong style={{ color: '#ffc542' }}>{t('footer_disclaimer_bold')}</strong>{t('footer_disclaimer_after')}
              </p>

              <div className="flex items-center gap-3 pt-1">
                <a href="https://twitter.com" target="_blank" rel="noopener noreferrer"
                  className="hover:opacity-70 transition-opacity" aria-label="Twitter/X">
                  <svg width="16" height="16" fill="#8981ab" viewBox="0 0 24 24">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                  </svg>
                </a>
              </div>
            </div>

            {/* GAMES column */}
            <div>
              <h4 className="text-[11px] font-bold uppercase tracking-widest mb-4" style={{ color: '#ffd97a' }}>{t('footer_games')}</h4>
              <ul className="space-y-2.5">
                {GAMES_LINKS.map(l => (
                  <li key={l.href}>
                    <Link href={l.href} className="text-[13px] transition-colors hover:text-[#e8e2f5]" style={{ color: '#8981ab' }}>
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* PLATFORM column */}
            <div>
              <h4 className="text-[11px] font-bold uppercase tracking-widest mb-4" style={{ color: '#ffd97a' }}>{t('footer_platform')}</h4>
              <ul className="space-y-2.5">
                {PLATFORM_LINKS.map(l => (
                  <li key={l.href}>
                    <Link href={l.href} className="text-[13px] transition-colors hover:text-[#e8e2f5]" style={{ color: '#8981ab' }}>
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* ABOUT US column */}
            <div>
              <h4 className="text-[11px] font-bold uppercase tracking-widest mb-4" style={{ color: '#ffd97a' }}>{t('footer_about')}</h4>
              <ul className="space-y-2.5">
                <li>
                  <button onClick={() => setTermsOpen(true)} className="text-[13px] transition-colors hover:text-[#e8e2f5] text-left" style={{ color: '#8981ab' }}>
                    {t('footer_terms')}
                  </button>
                </li>
                <li>
                  <button onClick={() => setPrivacyOpen(true)}
                    className="text-[13px] transition-colors hover:text-[#e8e2f5] text-left"
                    style={{ color: '#8981ab' }}>
                    {t('footer_privacy')}
                  </button>
                </li>
                <li>
                  <Link href="/roulette" className="text-[13px] transition-colors hover:text-[#e8e2f5]" style={{ color: '#8981ab' }}>
                    {t('footer_fairness')}
                  </Link>
                </li>
                <li>
                  <Link href="/faq" className="text-[13px] transition-colors hover:text-[#e8e2f5]" style={{ color: '#8981ab' }}>
                    {t('footer_faq')}
                  </Link>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div style={{ borderTop: '1px solid rgba(255,197,66,0.2)' }}>
          <div className="max-w-6xl mx-auto px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex flex-col sm:flex-row gap-6">
              <div>
                <p className="text-[11px] mb-0.5" style={{ color: '#6a6390' }}>{t('footer_support')}</p>
                <Link href="/support"
                  className="text-[12px] font-semibold hover:opacity-80 transition-opacity"
                  style={{ color: '#9990b8' }}>
                  {t('support_open_ticket')} ↗
                </Link>
              </div>
              <div>
                <p className="text-[11px] mb-0.5" style={{ color: '#6a6390' }}>{t('footer_partners')}</p>
                <a href="mailto:partners@ageofmoney.gg"
                  className="text-[12px] font-semibold hover:opacity-80 transition-opacity"
                  style={{ color: '#9990b8' }}>
                  partners@ageofmoney.gg ↗
                </a>
              </div>
            </div>
            {/* Shifted left so the floating "My Bets" button doesn't sit on top of it */}
            <div className="relative sm:mr-40">
              <button
                onClick={() => setLangOpen(!langOpen)}
                className="flex items-center gap-2 px-3.5 py-2 rounded-lg transition-colors hover:bg-[#1a1730] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffc542]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#09080f]"
                style={{ background: '#13111f', border: '1px solid rgba(255,197,66,0.45)' }}
              >
                <Globe size={13} style={{ color: '#ffc542' }} />
                <span className="text-[13px]">{currentLang.flag}</span>
                <span className="text-[13px] font-semibold" style={{ color: '#e8e2f5' }}>{currentLang.label}</span>
                <ChevronDown width={13} height={13} style={{ color: '#ffc542' }} />
              </button>
              {langOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setLangOpen(false)} />
                  <div
                    className="absolute right-0 bottom-full mb-1.5 w-36 z-20 py-1 rounded-md shadow-xl"
                    style={{ background: '#0d0b1a', border: '1px solid rgba(255,197,66,0.2)' }}
                  >
                    {LANGUAGES.map(l => (
                      <button
                        key={l.code}
                        onClick={() => { setLang(l.code); setLangOpen(false); }}
                        className="flex items-center gap-2 w-full px-3 py-2 text-[12px] transition-colors text-left"
                        style={{ color: l.code === lang ? '#ffc542' : '#9990b8' }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#13111f')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <span>{l.flag}</span>
                        <span>{l.label}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </footer>

      {privacyOpen && <PrivacyModal onClose={() => setPrivacyOpen(false)} />}
      {termsOpen && <TermsModal onClose={() => setTermsOpen(false)} />}
    </>
  );
}
