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
  title: 'AgeOfMoney — #1 Age of Empires 4 Match Betting Platform',
  description:
    'The premier Age of Empires 4 match betting platform. Bet virtual coins on pro matches, live tournaments and competitive AoE4 events. La première plateforme de match betting dédiée à la scène compétitive Age of Empires 4.',
  keywords: [
    // English
    'Age of Empires 4 betting', 'AoE4 betting', 'AoE4 esports betting', 'Age of Empires 4 esports',
    'AoE4 match betting', 'AoE4 tournament betting', 'Age of Empires 4 gambling', 'AoE4 coins',
    'AoE4 pro matches', 'AoE4 competitive', 'esports betting', 'virtual betting platform',
    // French
    'paris Age of Empires 4', 'paris AoE4', 'paris esports', 'paris matchs AoE4',
    'plateforme paris virtuels', 'tournoi Age of Empires 4', 'paris compétitif AoE4',
    // German
    'Age of Empires 4 Wetten', 'AoE4 Wetten', 'AoE4 esports Wetten',
    // Spanish
    'apuestas Age of Empires 4', 'apuestas AoE4', 'apuestas esports',
    // General
    'AgeOfMoney', 'ageof.money', 'AoE4 world', 'aoe4world betting',
  ],
  applicationName: 'AgeOfMoney',
  authors: [{ name: 'AgeOfMoney', url: 'https://ageof.money' }],
  creator: 'AgeOfMoney',
  metadataBase: new URL('https://ageof.money'),
  alternates: {
    canonical: 'https://ageof.money',
    languages: {
      'en': 'https://ageof.money',
      'fr': 'https://ageof.money',
    },
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-snippet': -1, 'max-image-preview': 'large' },
  },
  openGraph: {
    title: 'AgeOfMoney — #1 Age of Empires 4 Match Betting Platform',
    description: 'Bet virtual coins on AoE4 pro matches & live tournaments. La première plateforme de match betting dédiée à la scène compétitive Age of Empires 4.',
    type: 'website',
    url: 'https://ageof.money',
    siteName: 'AgeOfMoney',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'AgeOfMoney — Age of Empires 4 Match Betting',
      },
    ],
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AgeOfMoney — #1 AoE4 Match Betting Platform',
    description: 'Bet virtual coins on AoE4 pro matches & live tournaments.',
    images: ['/og-image.png'],
  },
  category: 'esports betting',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${cinzel.variable} ${inter.variable} dark`} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
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
