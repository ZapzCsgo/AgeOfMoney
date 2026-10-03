import type { Metadata } from 'next';
import { getMatches } from '@/lib/api';
import { getServerLocale, type ServerLocale } from '@/lib/serverLocale';
import { Match } from '@/types';
import { MatchesPageClient } from './MatchesPageClient';

export const dynamic = 'force-dynamic';

async function fetchMatches(): Promise<Match[]> {
  try {
    const res = await getMatches({ hours: 168 });
    return res.data ?? [];
  } catch {
    return [];
  }
}

const TITLE: Record<ServerLocale, string> = {
  en: 'Matches | AgeOfMoney',
  fr: 'Matchs | AgeOfMoney',
  es: 'Partidas | AgeOfMoney',
};

const DESCRIPTION: Record<ServerLocale, string> = {
  en: 'Live and upcoming Age of Empires esports matches — AoE4, AoE2, AoE3, AoM. Real tournament matches with live odds on AgeOfMoney.',
  fr: 'Matchs esport Age of Empires en direct et à venir — AoE4, AoE2, AoE3, AoM. Vrais matchs de tournoi avec cotes en temps réel sur AgeOfMoney.',
  es: 'Partidas de esports de Age of Empires en vivo y próximas — AoE4, AoE2, AoE3, AoM. Partidas reales de torneo con cuotas en tiempo real en AgeOfMoney.',
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getServerLocale();
  const url = 'https://ageof.money/matches';
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

function buildJsonLd(matches: Match[]) {
  const url = 'https://ageof.money/matches';
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Matchs Age of Empires — AgeOfMoney',
    description: 'Liste des matchs professionnels Age of Empires disponibles pour les paris : AoE4, AoE2, AoE3, AoM.',
    url,
    numberOfItems: matches.filter(m => m.status !== 'COMPLETED').length,
    itemListElement: matches
      .filter(m => m.status !== 'COMPLETED')
      .slice(0, 20)
      .map((m, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: `${m.player1.name} vs ${m.player2.name}${m.tournament ? ` — ${m.tournament.name}` : ''}`,
        url: `https://ageof.money/matches/${m.id}`,
        item: {
          '@type': 'SportsEvent',
          name: `${m.player1.name} vs ${m.player2.name}`,
          startDate: m.scheduledAt,
          eventStatus: 'https://schema.org/EventScheduled',
          competitor: [
            { '@type': 'Person', name: m.player1.name },
            { '@type': 'Person', name: m.player2.name },
          ],
        },
      })),
  };
}

export default async function MatchesPage() {
  const matches = await fetchMatches();
  const jsonLd = matches.length > 0 ? buildJsonLd(matches) : null;

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <MatchesPageClient initialMatches={matches} />
    </>
  );
}
