'use client';

import { useState } from 'react';
import Link from 'next/link';
import { X, Shield, ChevronDown, Globe } from 'lucide-react';

const PRIVACY_SECTIONS = [
  {
    title: 'Collecte des informations',
    content: `tft.money accorde une grande importance à votre vie privée et ne collecte que les informations strictement nécessaires (nom Steam, adresse email, informations de facturation crypto). Nous ne stockons jamais les clés privées de vos wallets et n'avons pas accès à vos comptes Steam au-delà de votre identifiant public.`,
  },
  {
    title: 'Utilisation des informations',
    content: `Vos données sont utilisées pour : gérer votre compte, traiter les dépôts et retraits, calculer les paiements de paris gagnants, garantir le respect de nos Conditions d'Utilisation et lutter contre la fraude.`,
  },
  {
    title: 'Divulgation à des tiers',
    content: `tft.money fait appel à NOWPayments (crypto) et MoonPay (carte) pour les paiements. Aucune autre donnée n'est partagée avec des tiers, sauf obligation légale.`,
  },
  {
    title: 'Sécurité',
    content: `La protection de vos informations personnelles est une priorité absolue. Connexion via Steam OpenID, communications chiffrées (TLS 1.3), serveurs européens, authentification 2FA disponible.`,
  },
];

function PrivacyModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl overflow-hidden border border-tft-border bg-tft-bg-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-6 py-4 shrink-0 border-b border-tft-border bg-tft-bg">
          <div className="w-8 h-8 rounded-md flex items-center justify-center bg-tft-purple/15 border border-tft-purple/40">
            <Shield size={15} className="text-tft-purple-bright" />
          </div>
          <div className="flex-1">
            <h2 className="text-[15px] font-bold font-display text-tft-text">
              Politique de confidentialité
            </h2>
            <p className="text-[10px] text-tft-text-muted">tft.money — Dernière mise à jour : 2026</p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center transition-colors hover:bg-tft-bg-hover cursor-pointer"
            aria-label="Fermer"
          >
            <X size={14} className="text-tft-text-dim" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6 scrollbar-arcane">
          <p className="text-[13px] leading-relaxed text-tft-text-dim">
            Bienvenue sur tft.money. Nous accordons la plus grande importance à la confidentialité et à la sécurité de vos informations personnelles.
          </p>
          {PRIVACY_SECTIONS.map((s) => (
            <div key={s.title}>
              <h3 className="text-[13px] font-bold mb-2 text-tft-purple-bright font-ui tracking-wide uppercase">
                {s.title}
              </h3>
              <p className="text-[12px] leading-relaxed whitespace-pre-line text-tft-text-dim">
                {s.content}
              </p>
            </div>
          ))}
          <div className="rounded-xl p-4 bg-tft-bg-elevated border border-tft-border">
            <p className="text-[11px] leading-relaxed text-tft-text-muted">
              Pour toute question, contactez-nous à{' '}
              <a
                href="mailto:support@tft.money"
                className="text-tft-cyan-bright hover:opacity-80 transition-opacity"
              >
                support@tft.money
              </a>
            </p>
          </div>
        </div>
        <div className="px-6 py-4 shrink-0 flex justify-end border-t border-tft-border bg-tft-bg">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-lg text-[12px] font-ui font-bold tracking-wide uppercase transition-all bg-gradient-rose text-white shadow-rose-md hover:shadow-arcane-md cursor-pointer"
          >
            J&apos;ai compris
          </button>
        </div>
      </div>
    </div>
  );
}

const TOS_SECTIONS = [
  { title: '1. Acceptation', content: 'En accédant aux Services, l\'Utilisateur certifie avoir au moins 18 ans et accepte d\'être lié par ces Conditions.' },
  { title: '2. Monnaie virtuelle', content: 'Tous les crédits en jeu (coins ◈) n\'ont aucune valeur monétaire réelle. Ils sont destinés au divertissement uniquement. Partage, transfert ou multi-compte sont strictement interdits.' },
  { title: '3. Dépôts et retraits', content: 'Les dépôts et retraits crypto sont définitifs. tft.money n\'est pas responsable des transferts effectués sur un mauvais réseau. Taux : 1 USD = 1.69 ◈ (dépôt) / 1.69 ◈ = 0.99 USD (retrait).' },
  { title: '4. Paris', content: 'Les odds sont fixées par tft.money. Les paris ferment au début du tournoi/match. Forfait d\'un participant = remboursement intégral.' },
  { title: '5. Jeu responsable', content: 'Options d\'auto-exclusion et limites de dépôt disponibles dans /profile. Politique stricte 18+. Mesures anti-abus en place.' },
  { title: '6. Non-affiliation', content: 'tft.money n\'est pas affilié à Riot Games, Inc. ni à Tencent. Teamfight Tactics est une marque déposée de Riot Games.' },
  { title: '7. Limitation de responsabilité', content: 'L\'utilisation est à vos propres risques. tft.money n\'est pas responsable des dommages indirects, fonds perdus ou comptes piratés.' },
  { title: '8. Code de conduite', content: 'Interdit : activités illégales, harcèlement, bots, multi-compte, vente de compte. Violation = suspension immédiate sans remboursement.' },
];

function TermsModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl overflow-hidden border border-tft-border bg-tft-bg-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-6 py-4 shrink-0 border-b border-tft-border bg-tft-bg">
          <div className="w-8 h-8 rounded-md flex items-center justify-center bg-tft-purple/15 border border-tft-purple/40">
            <Shield size={15} className="text-tft-purple-bright" />
          </div>
          <div className="flex-1">
            <h2 className="text-[15px] font-bold font-display text-tft-text">Conditions d&apos;utilisation</h2>
            <p className="text-[10px] text-tft-text-muted">tft.money — Mai 2026</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center transition-colors hover:bg-tft-bg-hover cursor-pointer" aria-label="Fermer">
            <X size={14} className="text-tft-text-dim" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 scrollbar-arcane">
          {TOS_SECTIONS.map((s) => (
            <div key={s.title}>
              <h3 className="text-[13px] font-bold mb-1.5 text-tft-purple-bright font-ui tracking-wide uppercase">{s.title}</h3>
              <p className="text-[12px] leading-relaxed text-tft-text-dim">{s.content}</p>
            </div>
          ))}
        </div>
        <div className="px-6 py-4 shrink-0 flex justify-end border-t border-tft-border bg-tft-bg">
          <button onClick={onClose} className="px-5 py-2 rounded-lg text-[12px] font-ui font-bold tracking-wide uppercase transition-all bg-gradient-rose text-white shadow-rose-md hover:shadow-arcane-md cursor-pointer">
            J&apos;ai compris
          </button>
        </div>
      </div>
    </div>
  );
}

const LANGUAGES = [
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'en', label: 'English',  flag: '🇬🇧' },
  { code: 'es', label: 'Español',  flag: '🇪🇸' },
];

export function Footer() {
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [termsOpen, setTermsOpen]     = useState(false);
  const [langOpen, setLangOpen]       = useState(false);
  const [currentLang, setCurrentLang] = useState(LANGUAGES[0]);

  const PARI_LINKS = [
    { href: '/tournaments', label: 'Tournois TFT' },
    { href: '/matches',     label: 'Matchs live'  },
    { href: '/leaderboard', label: 'Classement'   },
    { href: '/affiliate',   label: 'Affiliés'     },
  ];

  const PLATFORM_LINKS = [
    { href: '/how-it-works', label: 'Comment ça marche' },
    { href: '/support',      label: 'Support' },
    { href: '/responsible-gaming', label: 'Jeu responsable' },
  ];

  return (
    <>
      <footer className="relative border-t border-tft-border bg-tft-bg">
        {/* Top accent line — arcane gradient */}
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-arcane opacity-40" />

        {/* Hex grid pattern overlay */}
        <div className="absolute inset-0 bg-hex-grid opacity-[0.06] pointer-events-none" aria-hidden="true" />

        <div className="relative max-w-6xl mx-auto px-6 py-14">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-10">

            {/* Brand */}
            <div className="md:col-span-1 space-y-4">
              <Link href="/" className="flex items-center gap-2.5 group">
                <svg width="28" height="25" viewBox="0 0 32 28" fill="none" aria-hidden="true">
                  <defs>
                    <linearGradient id="footer-hex-grad" x1="0" y1="0" x2="32" y2="28" gradientUnits="userSpaceOnUse">
                      <stop offset="0%"  stopColor="#a78bfa" />
                      <stop offset="60%" stopColor="#7c3aed" />
                      <stop offset="100%" stopColor="#22d3ee" />
                    </linearGradient>
                  </defs>
                  <path d="M16 1.5l12.5 7.3v10.4L16 26.5 3.5 19.2V8.8z" fill="url(#footer-hex-grad)" fillOpacity="0.2" stroke="url(#footer-hex-grad)" strokeWidth="1.6" />
                  <path d="M11 9l5 4 5-4 1 2-6 5-6-5z" fill="#fcd34d" />
                </svg>
                <span className="font-display font-bold text-[16px] tracking-[0.18em] text-arcane">
                  tft.money
                </span>
              </Link>
              <p className="text-[12px] leading-relaxed text-tft-text-muted">
                © 2026 tft.money — Tous droits réservés.
              </p>
              <p className="text-[11px] leading-relaxed text-tft-text-faint">
                tft.money opère avec des coins virtuels ◈ uniquement.{' '}
                <strong className="text-tft-gold-bright">18+ uniquement.</strong>{' '}
                Non affilié à Riot Games.
              </p>
              <div className="flex items-center gap-3 pt-1">
                <a href="https://x.com" target="_blank" rel="noopener noreferrer" className="hover:opacity-70 transition-opacity" aria-label="Twitter/X">
                  <svg width="16" height="16" fill="#64748b" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                  </svg>
                </a>
                <a href="https://discord.com" target="_blank" rel="noopener noreferrer" className="hover:opacity-70 transition-opacity" aria-label="Discord">
                  <svg width="16" height="16" fill="#64748b" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.249a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.036A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.331c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
                  </svg>
                </a>
              </div>
            </div>

            {/* PARIS */}
            <div>
              <h4 className="text-[11px] font-bold uppercase tracking-[0.22em] mb-4 text-tft-purple-bright font-ui">Paris</h4>
              <ul className="space-y-2.5">
                {PARI_LINKS.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="text-[13px] transition-colors hover:text-tft-text text-tft-text-muted">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* PLATFORME */}
            <div>
              <h4 className="text-[11px] font-bold uppercase tracking-[0.22em] mb-4 text-tft-purple-bright font-ui">Plateforme</h4>
              <ul className="space-y-2.5">
                {PLATFORM_LINKS.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="text-[13px] transition-colors hover:text-tft-text text-tft-text-muted">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* À PROPOS */}
            <div>
              <h4 className="text-[11px] font-bold uppercase tracking-[0.22em] mb-4 text-tft-purple-bright font-ui">À propos</h4>
              <ul className="space-y-2.5">
                <li>
                  <button onClick={() => setTermsOpen(true)} className="text-[13px] transition-colors hover:text-tft-text text-tft-text-muted text-left cursor-pointer">
                    Conditions d&apos;utilisation
                  </button>
                </li>
                <li>
                  <button onClick={() => setPrivacyOpen(true)} className="text-[13px] transition-colors hover:text-tft-text text-tft-text-muted text-left cursor-pointer">
                    Confidentialité
                  </button>
                </li>
                <li>
                  <Link href="/fairness" className="text-[13px] transition-colors hover:text-tft-text text-tft-text-muted">
                    Provably Fair
                  </Link>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="relative border-t border-tft-border">
          <div className="max-w-6xl mx-auto px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex flex-col sm:flex-row gap-6">
              <div>
                <p className="text-[10px] uppercase tracking-wider mb-0.5 text-tft-text-faint font-ui">Support</p>
                <Link href="/support" className="text-[12px] font-semibold hover:opacity-80 transition-opacity text-tft-text-dim">
                  Ouvrir un ticket ↗
                </Link>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider mb-0.5 text-tft-text-faint font-ui">Partenariats</p>
                <a href="mailto:partners@tft.money" className="text-[12px] font-semibold hover:opacity-80 transition-opacity text-tft-text-dim">
                  partners@tft.money ↗
                </a>
              </div>
            </div>
            <div className="relative">
              <button
                onClick={() => setLangOpen(!langOpen)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-tft-bg-card border border-tft-border hover:border-tft-purple/50 transition-colors cursor-pointer"
              >
                <Globe size={13} className="text-tft-purple-bright" />
                <span className="text-[12px]">{currentLang.flag}</span>
                <span className="text-[12px] text-tft-text-dim">{currentLang.label}</span>
                <ChevronDown size={12} className="text-tft-text-muted" />
              </button>
              {langOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setLangOpen(false)} />
                  <div className="absolute right-0 bottom-full mb-1.5 w-36 z-20 py-1 rounded-md shadow-xl border border-tft-border bg-tft-bg-card">
                    {LANGUAGES.map((l) => (
                      <button
                        key={l.code}
                        onClick={() => { setCurrentLang(l); setLangOpen(false); }}
                        className={`flex items-center gap-2 w-full px-3 py-2 text-[12px] transition-colors text-left hover:bg-tft-bg-hover cursor-pointer ${
                          l.code === currentLang.code ? 'text-tft-purple-bright' : 'text-tft-text-dim'
                        }`}
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
      {termsOpen   && <TermsModal   onClose={() => setTermsOpen(false)}   />}
    </>
  );
}
