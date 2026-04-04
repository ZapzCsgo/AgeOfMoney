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
  title: 'AgeOfMoney | Paris sur Age of Empires 4',
  description:
    'Pariez sur les matchs compétitifs Age of Empires 4 avec des coins virtuels. Suivez les tournois, analysez les stats et affrontez la communauté.',
  keywords: ['Age of Empires 4', 'AoE4', 'betting', 'esports', 'paris sportifs', 'tournoi', 'AgeOfMoney'],
  themeColor: '#080604',
  openGraph: {
    title: 'AgeOfMoney | Paris sur Age of Empires 4',
    description: 'La plateforme de paris virtuels dédiée à la scène compétitive AoE4',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${cinzel.variable} ${inter.variable} dark`} suppressHydrationWarning>
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
