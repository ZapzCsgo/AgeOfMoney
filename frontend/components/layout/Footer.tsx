'use client';

import { useState } from 'react';
import Link from 'next/link';
import { X, Shield, ChevronDown } from 'lucide-react';
import { useT, LANGUAGES } from '@/lib/i18n';

const PRIVACY_SECTIONS = [
  {
    title: 'Collecte des informations',
    content: `AgeOfMoney accorde une grande importance à votre vie privée et s'efforce de ne collecter que les informations nécessaires pour vous offrir une expérience utilisateur optimale. Lors de l'utilisation d'AgeOfMoney, les utilisateurs peuvent fournir des informations permettant de les identifier personnellement, notamment leur nom, leur adresse email et leurs informations de facturation (« Informations Personnelles »). Veuillez noter que nous ne stockons pas les informations de carte bancaire pour des raisons de sécurité.

De plus, lorsqu'un utilisateur visite AgeOfMoney, certaines informations sont automatiquement enregistrées, notamment l'adresse IP et le type de navigateur. Pour améliorer votre expérience, AgeOfMoney utilise des cookies — de petits fichiers texte stockés sur votre appareil. En utilisant AgeOfMoney, vous consentez à l'utilisation des cookies telle que décrite dans cette politique.`,
  },
  {
    title: 'Utilisation des informations',
    content: `Nous utilisons vos Informations Personnelles pour :

• Fournir et améliorer AgeOfMoney et ses services.
• Gérer votre compte et garantir la conformité à nos Conditions d'Utilisation.
• Mieux comprendre vos besoins et développer des fonctionnalités adaptées.
• Répondre à vos demandes et traiter vos transactions.
• Personnaliser votre expérience sur la plateforme.`,
  },
  {
    title: 'Divulgation à des tiers',
    content: `AgeOfMoney peut faire appel à des sociétés tierces pour faciliter ses services (support technique, analyse de données, traitement des paiements). Ces prestataires ont accès à vos données uniquement dans la limite nécessaire à l'exécution de leurs tâches. Nous sélectionnons soigneusement nos partenaires qui respectent des normes strictes de protection des données.`,
  },
  {
    title: 'Divulgation légale',
    content: `AgeOfMoney peut être tenu de coopérer avec les autorités compétentes et de divulguer certaines Informations Personnelles afin de prévenir, enquêter ou traiter toute activité illégale ou contraire à nos Conditions d'Utilisation. Toute divulgation ne sera effectuée que lorsqu'elle sera jugée nécessaire et appropriée.`,
  },
  {
    title: 'Modification et suppression de vos informations',
    content: `Il est de votre responsabilité de maintenir vos Informations Personnelles à jour. Si vous souhaitez faire supprimer vos données, vous pouvez en faire la demande à notre équipe support. Nous procéderons à la suppression dans un délai d'un an suivant votre demande.`,
  },
  {
    title: 'Sécurité',
    content: `La protection de vos Informations Personnelles est une priorité absolue pour AgeOfMoney. Nous utilisons des réseaux sécurisés et des technologies de chiffrement avancées pour la transmission des données sensibles. Vos informations sont stockées sur des serveurs sécurisés, accessibles uniquement au personnel autorisé.`,
  },
];

function PrivacyModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}>
      <div
        className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl overflow-hidden"
        style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 shrink-0" style={{ borderBottom: '1px solid #1e1a30', background: '#09080f' }}>
          <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: '#d4a01720', border: '1px solid #d4a01740' }}>
            <Shield size={15} style={{ color: '#d4a017' }} />
          </div>
          <div className="flex-1">
            <h2 className="text-[15px] font-bold" style={{ color: '#e8e2f5', fontFamily: 'Cinzel, serif' }}>
              Politique de Confidentialité
            </h2>
            <p className="text-[10px]" style={{ color: '#6b6488' }}>AgeOfMoney — Dernière mise à jour : 2026</p>
          </div>
          <button onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center transition-colors hover:bg-[#1e1a30]">
            <X size={14} style={{ color: '#6b6488' }} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          <p className="text-[13px] leading-relaxed" style={{ color: '#9990b8' }}>
            Bienvenue sur AgeOfMoney. Nous accordons la plus grande importance à la confidentialité et à la sécurité de vos informations personnelles. Cette Politique de Confidentialité est conçue pour vous aider à comprendre quelles informations nous collectons et comment nous les gérons.
          </p>

          {PRIVACY_SECTIONS.map(section => (
            <div key={section.title}>
              <h3 className="text-[13px] font-bold mb-2" style={{ color: '#d4a017' }}>{section.title}</h3>
              <p className="text-[12px] leading-relaxed whitespace-pre-line" style={{ color: '#9990b8' }}>{section.content}</p>
            </div>
          ))}

          <div className="rounded-xl p-4" style={{ background: '#13111f', border: '1px solid #1e1a30' }}>
            <p className="text-[11px] leading-relaxed" style={{ color: '#6b6488' }}>
              Pour toute question, contactez-nous à{' '}
              <a href="mailto:support@ageofmoney.gg" className="hover:opacity-80 transition-opacity" style={{ color: '#d4a017' }}>
                support@ageofmoney.gg
              </a>
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 shrink-0 flex justify-end" style={{ borderTop: '1px solid #1e1a30', background: '#09080f' }}>
          <button onClick={onClose}
            className="px-5 py-2 rounded-lg text-[12px] font-bold transition-all hover:opacity-90"
            style={{ background: '#d4a017', color: '#07060f' }}>
            J&apos;ai compris
          </button>
        </div>
      </div>
    </div>
  );
}

export function Footer() {
  const [privacyOpen, setPrivacyOpen] = useState(false);
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
    { href: '/faq', label: t('footer_faq') },
    { href: '/affiliate', label: t('footer_partners') },
  ];

  return (
    <>
      <footer style={{ background: '#09080f', borderTop: '1px solid #1e1a30' }}>
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
                <span className="font-bold text-[15px] tracking-widest" style={{ fontFamily: 'Cinzel,serif', color: '#f5c842' }}>
                  AgeOfMoney
                </span>
              </Link>

              <p className="text-[12px] leading-relaxed" style={{ color: '#6b6488' }}>
                © 2026 AgeOfMoney | Tous droits réservés.
              </p>
              <p className="text-[11px] leading-relaxed" style={{ color: '#4a4468' }}>
                AgeOfMoney est opéré avec des coins virtuels uniquement. <strong style={{ color: '#d4a017' }}>18+ only.</strong> Non affilié à Xbox Game Studios.
              </p>

              <div className="flex items-center gap-3 pt-1">
                <a href="https://twitter.com" target="_blank" rel="noopener noreferrer"
                  className="hover:opacity-70 transition-opacity" aria-label="Twitter/X">
                  <svg width="16" height="16" fill="#6b6488" viewBox="0 0 24 24">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                  </svg>
                </a>
              </div>
            </div>

            {/* GAMES column */}
            <div>
              <h4 className="text-[11px] font-bold uppercase tracking-widest mb-4" style={{ color: '#f5c842' }}>{t('footer_games')}</h4>
              <ul className="space-y-2.5">
                {GAMES_LINKS.map(l => (
                  <li key={l.href}>
                    <Link href={l.href} className="text-[13px] transition-colors hover:text-[#e8e2f5]" style={{ color: '#6b6488' }}>
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* PLATFORM column */}
            <div>
              <h4 className="text-[11px] font-bold uppercase tracking-widest mb-4" style={{ color: '#f5c842' }}>{t('footer_platform')}</h4>
              <ul className="space-y-2.5">
                {PLATFORM_LINKS.map(l => (
                  <li key={l.href}>
                    <Link href={l.href} className="text-[13px] transition-colors hover:text-[#e8e2f5]" style={{ color: '#6b6488' }}>
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* ABOUT US column */}
            <div>
              <h4 className="text-[11px] font-bold uppercase tracking-widest mb-4" style={{ color: '#f5c842' }}>{t('footer_about')}</h4>
              <ul className="space-y-2.5">
                <li>
                  <Link href="/terms" className="text-[13px] transition-colors hover:text-[#e8e2f5]" style={{ color: '#6b6488' }}>
                    {t('footer_terms')}
                  </Link>
                </li>
                <li>
                  <button onClick={() => setPrivacyOpen(true)}
                    className="text-[13px] transition-colors hover:text-[#e8e2f5] text-left"
                    style={{ color: '#6b6488' }}>
                    {t('footer_privacy')}
                  </button>
                </li>
                <li>
                  <Link href="/roulette" className="text-[13px] transition-colors hover:text-[#e8e2f5]" style={{ color: '#6b6488' }}>
                    {t('footer_fairness')}
                  </Link>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div style={{ borderTop: '1px solid #1e1a30' }}>
          <div className="max-w-6xl mx-auto px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex flex-col sm:flex-row gap-6">
              <div>
                <p className="text-[11px] mb-0.5" style={{ color: '#4a4468' }}>{t('footer_support')}</p>
                <Link href="/support"
                  className="text-[12px] font-semibold hover:opacity-80 transition-opacity"
                  style={{ color: '#9990b8' }}>
                  Ouvrir un ticket ↗
                </Link>
              </div>
              <div>
                <p className="text-[11px] mb-0.5" style={{ color: '#4a4468' }}>{t('footer_partners')}</p>
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
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors"
                style={{ background: '#13111f', border: '1px solid #1e1a30' }}
              >
                <span className="text-[12px]">{currentLang.flag}</span>
                <span className="text-[12px]" style={{ color: '#9990b8' }}>{currentLang.label}</span>
                <ChevronDown width={12} height={12} style={{ color: '#6b6488' }} />
              </button>
              {langOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setLangOpen(false)} />
                  <div
                    className="absolute right-0 bottom-full mb-1.5 w-36 z-20 py-1 rounded-md shadow-xl"
                    style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}
                  >
                    {LANGUAGES.map(l => (
                      <button
                        key={l.code}
                        onClick={() => { setLang(l.code); setLangOpen(false); }}
                        className="flex items-center gap-2 w-full px-3 py-2 text-[12px] transition-colors text-left"
                        style={{ color: l.code === lang ? '#d4a017' : '#9990b8' }}
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
    </>
  );
}
