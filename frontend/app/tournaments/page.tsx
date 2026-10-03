import type { Metadata } from 'next';
import { getTournaments } from '@/lib/api';
import { getServerLocale, type ServerLocale } from '@/lib/serverLocale';
import { TournamentsPageClient, type TournamentWithCount } from './TournamentsPageClient';

export const dynamic = 'force-dynamic';

async function fetchTournaments(): Promise<TournamentWithCount[]> {
  try {
    const res = await getTournaments({ limit: 50 });
    return (res.data as TournamentWithCount[]) ?? [];
  } catch {
    return [];
  }
}

const TITLE: Record<ServerLocale, string> = {
  en: 'Tournaments | AgeOfMoney',
  fr: 'Tournois | AgeOfMoney',
  es: 'Torneos | AgeOfMoney',
};

const DESCRIPTION: Record<ServerLocale, string> = {
  en: 'Upcoming and ongoing Age of Empires esports tournaments — AoE4, AoE2, AoE3, AoM, tier S/A competitions. Follow the competitive scene on AgeOfMoney.',
  fr: 'Tournois esport Age of Empires à venir et en cours — AoE4, AoE2, AoE3, AoM, compétitions tier S/A. Suivez la scène compétitive sur AgeOfMoney.',
  es: 'Torneos de esports de Age of Empires próximos y en curso — AoE4, AoE2, AoE3, AoM, competiciones tier S/A. Sigue la escena competitiva en AgeOfMoney.',
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getServerLocale();
  const url = 'https://ageof.money/tournaments';
  const title = TITLE[locale];
  const description = DESCRIPTION[locale];
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: 'website' },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function TournamentsPage() {
  const tournaments = await fetchTournaments();
  // Sorting/filtering below is "now"-relative (ongoing/ended/recently-finished).
  // Passing the server's own render-time instant down means the client's
  // pre-hydration render computes the exact same now-dependent output the
  // server did — calling `new Date()` fresh on the client instead would
  // read a different instant and produce a different list/order, a much
  // worse hydration mismatch than a text-only one (whole cards appearing/
  // disappearing/reordering). The client picks up its own live clock via
  // an effect right after mount.
  const serverNow = new Date().toISOString();
  return <TournamentsPageClient initialTournaments={tournaments} serverNow={serverNow} />;
}
