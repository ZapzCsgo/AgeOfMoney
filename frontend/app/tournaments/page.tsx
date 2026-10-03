import type { Metadata } from 'next';
import { getServerLocale, type ServerLocale } from '@/lib/serverLocale';
import TournamentsPageClient from './TournamentsPageClient';

export const dynamic = 'force-dynamic';

const META: Record<ServerLocale, { title: string; description: string }> = {
  en: {
    title: 'AoE4 Tournaments — Brackets & Odds | AgeOfMoney',
    description: 'Follow Age of Empires IV, II, III and Mythology tournaments with real brackets from Liquipedia and live betting odds on every match.',
  },
  fr: {
    title: 'Tournois AoE4 — Brackets et cotes | AgeOfMoney',
    description: 'Suivez les tournois Age of Empires IV, II, III et Mythology avec les vrais brackets Liquipedia et les cotes en direct sur chaque match.',
  },
  es: {
    title: 'Torneos AoE4 — Brackets y cuotas | AgeOfMoney',
    description: 'Sigue los torneos de Age of Empires IV, II, III y Mythology con los brackets reales de Liquipedia y cuotas en vivo en cada partida.',
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getServerLocale();
  const m = META[locale];
  const url = 'https://ageof.money/tournaments';

  return {
    title: { absolute: m.title },
    description: m.description,
    alternates: { canonical: url },
    openGraph: { title: m.title, description: m.description, url, type: 'website' },
    twitter: { card: 'summary_large_image', title: m.title, description: m.description },
  };
}

export default function TournamentsPage() {
  return <TournamentsPageClient />;
}
