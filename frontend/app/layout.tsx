import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Cinzel, Inter } from 'next/font/google';
import './globals.css';
import { Navbar } from '@/components/layout/Navbar';
import { LeftSidebar } from '@/components/layout/LeftSidebar';
import { ChatPanel } from '@/components/layout/ChatPanel';
import { Footer } from '@/components/layout/Footer';
import { MobileNav } from '@/components/layout/MobileNav';
import { Providers } from './providers';
import { BetNotifications } from '@/components/BetNotifications';
import { JackpotCountdownAlert } from '@/components/JackpotCountdownAlert';
// RainWidget is mounted inside ChatPanel (top of the right column) so it
// doesn't overlay the navbar. See components/layout/ChatPanel.tsx.
import { MyBetsPanel } from '@/components/MyBetsPanel';
import { TotpChallengeModal } from '@/components/security/TotpChallengeModal';

const cinzel = Cinzel({
  subsets: ['latin'],
  variable: '--font-cinzel',
  display: 'swap',
  weight: ['400', '500', '600', '700', '800', '900'],
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

// ─── Locale-aware metadata ─────────────────────────────────────────────────
// Discord/Twitter/etc. fetch the URL once from their crawler datacenters and
// show the SAME preview to every recipient — we can't adapt per viewer there.
// What we CAN do : look at the Accept-Language of the incoming request and
// pick the best matching locale (fr / en / es). Browsers send it correctly,
// most crawlers send `*` or nothing → we fall back to EN as the most
// international description.
type Locale = 'fr' | 'en' | 'es';

function pickLocale(acceptLanguage: string | null): Locale {
  if (!acceptLanguage) return 'en';
  // Parse "fr-FR,fr;q=0.9,en-US;q=0.8" → ordered list of [lang, q]
  const parts = acceptLanguage
    .split(',')
    .map(s => s.trim())
    .map(s => {
      const [tag, ...rest] = s.split(';');
      const qMatch = rest.find(p => p.startsWith('q='));
      const q = qMatch ? parseFloat(qMatch.slice(2)) : 1;
      return { lang: tag.toLowerCase().split('-')[0], q: Number.isFinite(q) ? q : 1 };
    })
    .sort((a, b) => b.q - a.q);
  for (const p of parts) {
    if (p.lang === 'fr' || p.lang === 'en' || p.lang === 'es') return p.lang as Locale;
  }
  return 'en';
}

const META: Record<Locale, {
  title: string;
  description: string;
  ogDescription: string;
  twitterDescription: string;
  ogLocale: string;
  imageAlt: string;
}> = {
  fr: {
    title: 'AgeOfMoney — Paris esport Age of Empires',
    description:
      "Paris en ligne sur les matchs pro Age of Empires (AoE4, AoE2, AoE3, AoM). Cotes en temps réel, roulette provably fair, dépôts crypto. La plateforme dédiée à la communauté AoE.",
    ogDescription:
      "Paris en ligne sur les matchs pro Age of Empires (AoE4, AoE2, AoE3, AoM). Cotes live, roulette provably fair, dépôts crypto.",
    twitterDescription: "Paris sur les matchs pro Age of Empires. Cotes live, roulette",
    ogLocale: 'fr_FR',
    imageAlt: 'AgeOfMoney — Paris esport Age of Empires',
  },
  en: {
    title: 'AgeOfMoney — Age of Empires esports betting',
    description:
      "Bet on pro Age of Empires matches (AoE4, AoE2, AoE3, AoM). Live odds, provably-fair roulette, crypto deposits. The betting platform built for the AoE community.",
    ogDescription:
      "Bet on pro Age of Empires matches (AoE4, AoE2, AoE3, AoM). Live odds, provably-fair roulette, crypto deposits.",
    twitterDescription: "Bet on pro Age of Empires matches. Live odds, roulette, crypto.",
    ogLocale: 'en_US',
    imageAlt: 'AgeOfMoney — Age of Empires esports betting',
  },
  es: {
    title: 'AgeOfMoney — Apuestas esports Age of Empires',
    description:
      "Apuestas en línea sobre los partidos profesionales de Age of Empires (AoE4, AoE2, AoE3, AoM). Cuotas en tiempo real, ruleta provably fair, depósitos en cripto.",
    ogDescription:
      "Apuestas en línea sobre los partidos profesionales de Age of Empires (AoE4, AoE2, AoE3, AoM). Cuotas en vivo, ruleta provably fair, depósitos en cripto.",
    twitterDescription: "Apuestas en partidos profesionales de Age of Empires. Cuotas en vivo, ruleta.",
    ogLocale: 'es_ES',
    imageAlt: 'AgeOfMoney — Apuestas esports Age of Empires',
  },
};

export async function generateMetadata(): Promise<Metadata> {
  // headers() is async in Next 15+, sync in 14. Both shapes are accepted by
  // an `await` (no-op on the sync flavor). Wrapping in try/catch covers
  // either signature without locking us to a Next version.
  let accept: string | null = null;
  try {
    const h = await headers();
    accept = h.get('accept-language');
  } catch {
    /* SSG / no request context → fall through to default */
  }
  const lang = pickLocale(accept);
  const m = META[lang];

  return {
    title: {
      default: m.title,
      template: '%s · AgeOfMoney',
    },
    description: m.description,
    keywords: [
      // FR — priority audience
      'paris esport Age of Empires', 'paris AoE4', 'paris AoE2', 'paris Age of Empires',
      'paris matchs AoE4', 'plateforme paris AoE', 'tournois AoE4', 'cotes AoE4',
      'roulette AoE', 'paris crypto esport', 'AgeOfMoney',
      // EN
      'Age of Empires betting', 'AoE4 betting', 'AoE2 betting', 'AoE esports betting',
      'Age of Empires 4 match betting', 'AoE tournament betting', 'AoE pro matches',
      'Age of Empires esports', 'AoE crypto betting', 'provably fair roulette',
      // ES
      'apuestas Age of Empires', 'apuestas AoE4', 'apuestas esports AoE',
    ],
    applicationName: 'AgeOfMoney',
    authors: [{ name: 'AgeOfMoney', url: 'https://ageof.money' }],
    creator: 'AgeOfMoney',
    publisher: 'AgeOfMoney',
    metadataBase: new URL('https://ageof.money'),
    alternates: {
      canonical: 'https://ageof.money',
      languages: {
        'fr': 'https://ageof.money',
        'en': 'https://ageof.money',
        'es': 'https://ageof.money',
        'x-default': 'https://ageof.money',
      },
    },
    robots: {
      index: true,
      follow: true,
      nocache: false,
      googleBot: {
        index: true,
        follow: true,
        'max-snippet': -1,
        'max-image-preview': 'large',
        'max-video-preview': -1,
      },
    },
    openGraph: {
      title: m.title,
      description: m.ogDescription,
      type: 'website',
      url: 'https://ageof.money',
      siteName: 'AgeOfMoney',
      images: [
        {
          url: '/banneraom.png',
          width: 1200,
          height: 630,
          alt: m.imageAlt,
        },
      ],
      locale: m.ogLocale,
      alternateLocale: (['fr_FR', 'en_US', 'es_ES'] as const).filter(l => l !== m.ogLocale),
    },
    twitter: {
      card: 'summary_large_image',
      title: m.title,
      description: m.twitterDescription,
      images: ['/banneraom.png'],
      site: '@ageofmoney',
      creator: '@ageofmoney',
    },
    category: 'esports betting',
    icons: {
      icon: [
        { url: '/aomlogo.png', type: 'image/png' },
      ],
      apple: [
        { url: '/aomlogo.png', type: 'image/png' },
      ],
      shortcut: ['/aomlogo.png'],
    },
    formatDetection: {
      telephone: false,
      email: false,
      address: false,
    },
    other: {
      'theme-color': '#07060f',
    },
  };
}

// Structured data for Google Rich Results — WebSite + Organization + FAQ schema
const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': 'https://ageof.money/#organization',
      name: 'AgeOfMoney',
      url: 'https://ageof.money',
      logo: {
        '@type': 'ImageObject',
        url: 'https://ageof.money/aomlogo.png',
      },
      image: {
        '@type': 'ImageObject',
        url: 'https://ageof.money/banneraom.png',
        width: 1200,
        height: 630,
      },
      description: 'La première plateforme de paris esport dédiée à Age of Empires (AoE4, AoE2, AoE3, AoM). Cotes en temps réel, roulette provably fair, dépôts crypto.',
      sameAs: [],
    },
    {
      '@type': 'WebSite',
      '@id': 'https://ageof.money/#website',
      url: 'https://ageof.money',
      name: 'AgeOfMoney',
      description: 'Paris esport Age of Empires — matchs pro, roulette provably fair, cotes live, dépôts crypto.',
      publisher: { '@id': 'https://ageof.money/#organization' },
      inLanguage: ['fr-FR', 'en-US', 'es-ES'],
      potentialAction: {
        '@type': 'SearchAction',
        target: 'https://ageof.money/matches?search={search_term_string}',
        'query-input': 'required name=search_term_string',
      },
    },
    {
      '@type': 'FAQPage',
      '@id': 'https://ageof.money/#faq',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'Qu\'est-ce qu\'AgeOfMoney ?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'AgeOfMoney est la première plateforme de paris esport dédiée à Age of Empires. Elle permet de parier sur des matchs professionnels AoE4, AoE2, AoE3 et AoM avec des jetons virtuels, via un système de cotes calculées en temps réel.',
          },
        },
        {
          '@type': 'Question',
          name: 'Comment parier sur un match Age of Empires ?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Connectez-vous via Steam, déposez des coins (1$ = 1.69 ⚜), puis rendez-vous sur la page d\'un match UPCOMING pour choisir votre joueur et placer votre mise. Les cotes sont affichées en temps réel et ajustées selon le volume de paris.',
          },
        },
        {
          '@type': 'Question',
          name: 'Comment sont calculées les cotes sur AgeOfMoney ?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Les cotes sont calculées par un moteur propriétaire basé sur l\'algorithme Glicko-2, enrichi des résultats H2H (tête-à-tête) en tournoi issus de Liquipedia. Elles sont recalculées toutes les 10 minutes et s\'ajustent en temps réel selon les paris placés.',
          },
        },
        {
          '@type': 'Question',
          name: 'Quels tournois Age of Empires sont disponibles pour les paris ?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'AgeOfMoney intègre les tournois de Tier S et A scrapés depuis Liquipedia et le calendrier officiel ageofempires.com. Sont couverts : les tournois AoE4 (Red Bull Wololo, Nations Cup, etc.), AoE2 (Red Bull Wololo Legacy, etc.), AoE3 et AoM.',
          },
        },
        {
          '@type': 'Question',
          name: 'La roulette AgeOfMoney est-elle équitable ?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Oui, la roulette est "provably fair" : le résultat de chaque tour est déterminé par un seed cryptographique public vérifiable. Vous pouvez contrôler l\'équité de chaque partie en vérifiant le hash avant et après chaque tour.',
          },
        },
        {
          '@type': 'Question',
          name: 'Comment déposer des coins sur AgeOfMoney ?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Les dépôts se font en crypto (Bitcoin, Ethereum, USDT et autres) via NOWPayments. Le taux est fixe : 1 USD = 1.69 ⚜ (coins). Les retraits sont possibles au taux de 1.69 ⚜ = 0.99 USD.',
          },
        },
        {
          '@type': 'Question',
          name: 'What is AgeOfMoney?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'AgeOfMoney (ageof.money) is the first esports betting platform dedicated to Age of Empires (AoE4, AoE2, AoE3, AoM). It offers real-time odds on professional matches, a provably fair roulette, coinflip, jackpot, and crypto deposits.',
          },
        },
        {
          '@type': 'Question',
          name: 'How to bet on Age of Empires matches?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Sign in with Steam on ageof.money, deposit coins via crypto (1 USD = 1.69 coins), go to any upcoming AoE4 or AoE2 match page, pick your winner and enter your stake. Odds update live based on betting volume.',
          },
        },
      ],
    },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${cinzel.variable} ${inter.variable} dark`} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* llms.txt — AI crawler briefing (emerging standard) */}
        <link rel="ai-info" href="https://ageof.money/llms.txt" type="text/plain" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      </head>
      <body className="min-h-screen bg-aoe overflow-hidden">
        <Providers>
          {/* Fixed top navbar */}
          <Navbar />

          {/* 3-column layout below navbar */}
          <div className="flex h-screen pt-14">
            {/* Left sidebar - hidden on mobile */}
            <div className="hidden md:flex">
              <LeftSidebar />
            </div>

            {/* Main content - scrollable */}
            <main className="flex-1 overflow-y-auto min-w-0 bg-aoe pb-16 md:pb-0">
              {children}
              <Footer />
            </main>

            {/* Right chat panel - hidden on small screens */}
            <div className="hidden lg:flex">
              <ChatPanel />
            </div>
          </div>

          {/* Mobile bottom nav */}
          <MobileNav />

          {/* Global bet result notifications */}
          <BetNotifications />

          {/* Global jackpot "8s before launch" toast — fires anywhere on the site */}
          <JackpotCountdownAlert />

          {/* RainWidget is rendered inside ChatPanel (top of the right column)
              so it never overlays the navbar. See components/layout/ChatPanel.tsx. */}

          {/* Floating "Mes Paris" panel */}
          <MyBetsPanel />

          {/* Global 2FA challenge modal — rendu conditionnellement par l'axios
              interceptor quand le backend répond TOTP_REQUIRED. */}
          <TotpChallengeModal />
        </Providers>
      </body>
    </html>
  );
}
