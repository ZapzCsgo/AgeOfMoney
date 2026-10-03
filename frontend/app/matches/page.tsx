import type { Metadata } from 'next';
import { getServerLocale, type ServerLocale } from '@/lib/serverLocale';
import MatchesPageClient from './MatchesPageClient';

export const dynamic = 'force-dynamic';

const META: Record<ServerLocale, { title: string; description: string }> = {
  en: {
    title: 'AoE4 Betting — Live Match Odds | AgeOfMoney',
    description: 'Bet on live and upcoming Age of Empires IV, II, III and Mythology matches. Real tournament odds, updated as the game plays out.',
  },
  fr: {
    title: 'Paris AoE4 — Cotes en direct | AgeOfMoney',
    description: 'Pariez sur les matchs en direct et à venir d’Age of Empires IV, II, III et Mythology. Vraies cotes de tournoi, mises à jour en direct.',
  },
  es: {
    title: 'Apuestas AoE4 — Cuotas en vivo | AgeOfMoney',
    description: 'Apuesta en partidas en vivo y próximas de Age of Empires IV, II, III y Mythology. Cuotas reales de torneo, actualizadas en vivo.',
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getServerLocale();
  const m = META[locale];
  const url = 'https://ageof.money/matches';

  return {
    title: { absolute: m.title },
    description: m.description,
    alternates: { canonical: url },
    openGraph: { title: m.title, description: m.description, url, type: 'website' },
    twitter: { card: 'summary_large_image', title: m.title, description: m.description },
  };
}

export default function MatchesPage() {
  return <MatchesPageClient />;
}
