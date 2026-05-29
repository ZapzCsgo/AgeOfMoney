import type { Metadata } from 'next';
import { Cormorant_Garamond, Chakra_Petch, Inter } from 'next/font/google';
import { Navbar } from '@/components/layout/Navbar';
import { LeftSidebar } from '@/components/layout/LeftSidebar';
import { Footer } from '@/components/layout/Footer';
import { Providers } from '@/components/Providers';
import './globals.css';

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-cormorant',
  display: 'swap',
});

const chakra = Chakra_Petch({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-chakra',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://tft.money'),
  title: {
    default: 'tft.money — Paris esports Teamfight Tactics',
    template: '%s · tft.money',
  },
  description:
    'Place tes paris sur les tournois Teamfight Tactics. Dépôts crypto instantanés, odds fixées à la main par nos analystes, retraits sous 2 minutes. 18+, jeu responsable.',
  openGraph: {
    title: 'tft.money — Paris esports TFT',
    description:
      'Le seul site de paris dédié à la scène compétitive Teamfight Tactics. Dépôts crypto, odds maison, retraits instantanés.',
    url: 'https://tft.money',
    siteName: 'tft.money',
    locale: 'fr_FR',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${cormorant.variable} ${chakra.variable} ${inter.variable}`}>
      <body className="font-sans bg-tft-bg text-tft-text antialiased min-h-screen flex flex-col">
        <Providers>
          <Navbar />
          {/* pt-14 to clear the fixed navbar. Sidebar + content live in a
              flex row below it. Sidebar is hidden on mobile (md:flex inside
              the component) so phones keep a single-column layout driven
              by the top nav alone. */}
          <div className="flex flex-1 pt-14">
            <LeftSidebar />
            <main className="flex-1 min-w-0">{children}</main>
          </div>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
