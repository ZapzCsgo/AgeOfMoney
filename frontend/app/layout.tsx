import type { Metadata } from 'next';
import { Cinzel, Inter } from 'next/font/google';
import './globals.css';
import { Navbar } from '@/components/layout/Navbar';
import { LeftSidebar } from '@/components/layout/LeftSidebar';
import { ChatPanel } from '@/components/layout/ChatPanel';
import { Footer } from '@/components/layout/Footer';
import { MobileNav } from '@/components/layout/MobileNav';
import { Providers } from './providers';
import { BetNotifications } from '@/components/BetNotifications';
import { MyBetsPanel } from '@/components/MyBetsPanel';

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

export const metadata: Metadata = {
  title: {
    default: 'AgeOfMoney — Paris esport Age of Empires',
    template: '%s · AgeOfMoney',
  },
  description:
    "Paris en ligne sur les matchs pro Age of Empires (AoE4, AoE2, AoE3, AoM). Cotes en temps réel, roulette provably fair, tournois cash, dépôts crypto. La plateforme dédiée à la communauté AoE.",
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
    title: 'AgeOfMoney — Paris esport Age of Empires',
    description:
      "Paris en ligne sur les matchs pro Age of Empires (AoE4, AoE2, AoE3, AoM). Cotes live, roulette provably fair, tournois cash, dépôts crypto.",
    type: 'website',
    url: 'https://ageof.money',
    siteName: 'AgeOfMoney',
    images: [
      {
        url: '/banneraom.png',
        width: 1200,
        height: 630,
        alt: 'AgeOfMoney — Paris esport Age of Empires',
      },
    ],
    locale: 'fr_FR',
    alternateLocale: ['en_US', 'es_ES'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AgeOfMoney — Paris esport Age of Empires',
    description:
      "Paris sur les matchs pro Age of Empires. Cotes live, roulette, tournois cash.",
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

// Structured data for Google Rich Results — WebSite + Organization schema
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
      sameAs: [],
    },
    {
      '@type': 'WebSite',
      '@id': 'https://ageof.money/#website',
      url: 'https://ageof.money',
      name: 'AgeOfMoney',
      description: 'Paris esport Age of Empires — matchs pro, roulette, tournois cash',
      publisher: { '@id': 'https://ageof.money/#organization' },
      inLanguage: ['fr-FR', 'en-US', 'es-ES'],
      potentialAction: {
        '@type': 'SearchAction',
        target: 'https://ageof.money/matches?search={search_term_string}',
        'query-input': 'required name=search_term_string',
      },
    },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${cinzel.variable} ${inter.variable} dark`} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
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

          {/* Floating "Mes Paris" panel */}
          <MyBetsPanel />
        </Providers>
      </body>
    </html>
  );
}
