'use client';

import Link from 'next/link';
import { useSession, signIn } from 'next-auth/react';
import { useT } from '@/lib/i18n';

interface HeroBannerProps {
  activeMatches: number;
  weeklyBets: number;
  activePlayers: number;
}

export function HeroBanner({ activeMatches, weeklyBets, activePlayers }: HeroBannerProps) {
  const { data: session } = useSession();
  const { t } = useT();

  return (
    <div className="relative overflow-hidden" style={{ minHeight: 500 }}>
      {/* Dark medieval background gradient */}
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(180deg, #080604 0%, #12100a 40%, #1a1508 60%, #0a0804 100%)',
        }}
      />

      {/* Subtle radial glow in center */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse 70% 50% at 50% 60%, rgba(201, 162, 39, 0.07) 0%, transparent 70%)',
        }}
      />

      {/* Castle/battlements silhouette SVG at bottom */}
      <svg
        className="absolute bottom-0 left-0 w-full"
        viewBox="0 0 1440 200"
        preserveAspectRatio="none"
        style={{ height: 200 }}
      >
        <defs>
          <linearGradient id="battlementGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#1a1610" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#080604" stopOpacity="1" />
          </linearGradient>
        </defs>
        {/* Castle battlements pattern */}
        <path
          d="M0,200 L0,140 L20,140 L20,120 L40,120 L40,140 L60,140 L60,120 L80,120 L80,140 L100,140 L100,160
             L150,160 L150,130 L170,130 L170,110 L190,110 L190,130 L210,130 L210,110 L230,110 L230,130 L250,130 L250,160
             L320,160 L320,140 L340,140 L340,115 L360,115 L360,140 L380,140 L380,115 L400,115 L400,140 L420,140 L420,165
             L500,165 L500,145 L520,145 L520,125 L540,125 L540,145 L560,145 L560,125 L580,125 L580,145 L600,145 L600,165
             L680,165 L680,140 L700,140 L700,118 L720,118 L720,140 L740,140 L740,118 L760,118 L760,140 L780,140 L780,165
             L860,165 L860,145 L880,145 L880,128 L900,128 L900,145 L920,145 L920,128 L940,128 L940,145 L960,145 L960,165
             L1040,165 L1040,138 L1060,138 L1060,115 L1080,115 L1080,138 L1100,138 L1100,115 L1120,115 L1120,138 L1140,138 L1140,165
             L1220,165 L1220,142 L1240,142 L1240,120 L1260,120 L1260,142 L1280,142 L1280,120 L1300,120 L1300,142 L1320,142 L1320,165
             L1440,165 L1440,200 Z"
          fill="url(#battlementGrad)"
        />
        {/* Subtle gold glow on top edge of battlements */}
        <path
          d="M0,140 L20,140 L20,120 L40,120 L40,140 L100,140 L100,160
             L150,160 L150,130 L170,130 L170,110 L190,110 L190,130 L250,130 L250,160"
          fill="none"
          stroke="#c9a227"
          strokeWidth="0.5"
          strokeOpacity="0.25"
        />
      </svg>

      {/* Decorative particles (pure CSS) */}
      {[...Array(12)].map((_, i) => (
        <div
          key={i}
          className="absolute w-1 h-1 rounded-full bg-aoe-gold opacity-40"
          style={{
            left: `${8 + i * 8}%`,
            top: `${20 + (i % 3) * 15}%`,
            animationDelay: `${i * 0.3}s`,
            animation: `float ${3 + (i % 3)}s ease-in-out ${i * 0.25}s infinite`,
          }}
        />
      ))}

      {/* Decorative crossed swords SVG - center top */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 opacity-20">
        <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
          <line x1="10" y1="10" x2="70" y2="70" stroke="#c9a227" strokeWidth="2" strokeLinecap="round" />
          <line x1="70" y1="10" x2="10" y2="70" stroke="#c9a227" strokeWidth="2" strokeLinecap="round" />
          <circle cx="10" cy="10" r="4" fill="#c9a227" />
          <circle cx="70" cy="10" r="4" fill="#c9a227" />
          <rect x="36" y="34" width="8" height="12" rx="1" fill="#c9a227" />
        </svg>
      </div>

      {/* Decorative corner ornaments */}
      <div className="absolute top-4 left-4 opacity-30">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
          <path d="M0,40 L0,0 L40,0" stroke="#c9a227" strokeWidth="1.5" fill="none"/>
          <path d="M5,35 L5,5 L35,5" stroke="#c9a227" strokeWidth="0.5" fill="none" opacity="0.5"/>
          <circle cx="0" cy="0" r="3" fill="#c9a227"/>
        </svg>
      </div>
      <div className="absolute top-4 right-4 opacity-30">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
          <path d="M40,40 L40,0 L0,0" stroke="#c9a227" strokeWidth="1.5" fill="none"/>
          <path d="M35,35 L35,5 L5,5" stroke="#c9a227" strokeWidth="0.5" fill="none" opacity="0.5"/>
          <circle cx="40" cy="0" r="3" fill="#c9a227"/>
        </svg>
      </div>

      {/* Main content */}
      <div className="relative z-10 max-w-4xl mx-auto px-4 pt-16 pb-32 text-center">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 mb-6 px-4 py-1.5 rounded border border-aoe-border-gold bg-aoe-gold/10">
          <span className="w-1.5 h-1.5 rounded-full bg-aoe-gold animate-pulse" />
          <span className="font-cinzel text-xs tracking-widest text-aoe-gold uppercase">
            Plateforme de paris virtuels AoE4
          </span>
        </div>

        {/* Main title */}
        <h1
          className="font-cinzel font-black mb-4 leading-none"
          style={{
            fontSize: 'clamp(2.2rem, 5vw, 4rem)',
            background: 'linear-gradient(135deg, #8b6914 0%, #c9a227 35%, #e8c547 50%, #c9a227 65%, #8b6914 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            letterSpacing: '0.05em',
          }}
        >
          PARIEZ SUR L&apos;AVENIR
          <br />
          DES EMPIRES
        </h1>

        {/* Decorative divider */}
        <div className="flex items-center justify-center gap-4 my-5">
          <div className="h-px w-24 bg-gradient-to-r from-transparent to-aoe-gold-dark" />
          <svg width="20" height="20" viewBox="0 0 20 20" fill="#c9a227">
            <polygon points="10,2 12,7 18,7 13.5,11 15.5,17 10,13 4.5,17 6.5,11 2,7 8,7" />
          </svg>
          <div className="h-px w-24 bg-gradient-to-l from-transparent to-aoe-gold-dark" />
        </div>

        {/* Subtitle */}
        <p className="text-aoe-parchment-dim text-lg mb-8 max-w-2xl mx-auto leading-relaxed">
          {t('hero_subtitle')}
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link href="/matches" className="aoe-btn-gold text-base py-3 px-8">
            {t('hero_see_matches')}
          </Link>
          {!session && (
            <button
              onClick={() => signIn()}
              className="aoe-btn-outline text-base py-3 px-8"
            >
              {t('hero_create_account')}
            </button>
          )}
        </div>

        {/* Stats row */}
        <div className="flex flex-wrap justify-center gap-8 mt-12">
          <div className="text-center">
            <div className="font-cinzel font-bold text-2xl text-aoe-gold">{activeMatches}</div>
            <div className="text-aoe-parchment-dim text-xs uppercase tracking-wider mt-1">{t('hero_active_matches')}</div>
          </div>
          <div className="w-px bg-aoe-border hidden sm:block" />
          <div className="text-center">
            <div className="font-cinzel font-bold text-2xl text-aoe-gold">
              {new Intl.NumberFormat('fr-FR').format(weeklyBets)} ⚜
            </div>
            <div className="text-aoe-parchment-dim text-xs uppercase tracking-wider mt-1">{t('hero_wagered_weekly')}</div>
          </div>
          <div className="w-px bg-aoe-border hidden sm:block" />
          <div className="text-center">
            <div className="font-cinzel font-bold text-2xl text-aoe-gold">
              {new Intl.NumberFormat('fr-FR').format(activePlayers)}
            </div>
            <div className="text-aoe-parchment-dim text-xs uppercase tracking-wider mt-1">{t('hero_active_players')}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
