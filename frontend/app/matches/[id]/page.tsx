import type { Metadata } from 'next';
import { getMatch } from '@/lib/api';
import { getServerLocale, type ServerLocale } from '@/lib/serverLocale';
import { Match } from '@/types';
import { MatchPageClient } from './MatchPageClient';

export const dynamic = 'force-dynamic';

async function fetchMatch(id: string): Promise<Match | null> {
  try {
    const res = await getMatch(id);
    return res.data ?? null;
  } catch {
    return null;
  }
}

const NOT_FOUND_TITLE: Record<ServerLocale, string> = {
  en: 'Match not found | AgeOfMoney',
  fr: 'Match introuvable | AgeOfMoney',
  es: 'Partido no encontrado | AgeOfMoney',
};

const VS = { en: 'vs', fr: 'vs', es: 'vs' } as const;

function buildTitle(match: Match, locale: ServerLocale): string {
  const suffix = match.tournament ? ` – ${match.tournament.name}` : '';
  const oddsWord = { en: 'odds', fr: 'cotes', es: 'cuotas' }[locale];
  return `${match.player1.name} ${VS[locale]} ${match.player2.name}${suffix} — ${oddsWord} | AgeOfMoney`;
}

function buildDescription(match: Match, locale: ServerLocale): string {
  const o1 = match.odds1.toFixed(2);
  const o2 = match.odds2.toFixed(2);
  if (locale === 'fr') {
    return `Pariez sur ${match.player1.name} (×${o1}) ou ${match.player2.name} (×${o2}) en ${match.format}${match.tournament ? ` au tournoi ${match.tournament.name}` : ''}. Cotes Age of Empires en temps réel sur AgeOfMoney.`;
  }
  if (locale === 'es') {
    return `Apuesta por ${match.player1.name} (×${o1}) o ${match.player2.name} (×${o2}) en ${match.format}${match.tournament ? ` en el torneo ${match.tournament.name}` : ''}. Cuotas de Age of Empires en tiempo real en AgeOfMoney.`;
  }
  return `Bet on ${match.player1.name} (×${o1}) or ${match.player2.name} (×${o2}) in ${match.format}${match.tournament ? ` at ${match.tournament.name}` : ''}. Live Age of Empires odds on AgeOfMoney.`;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const [match, locale] = await Promise.all([fetchMatch(id), getServerLocale()]);
  const url = `https://ageof.money/matches/${id}`;

  if (!match) {
    return { title: { absolute: NOT_FOUND_TITLE[locale] }, alternates: { canonical: url } };
  }

  const title = buildTitle(match, locale);
  const description = buildDescription(match, locale);

  return {
    // Root layout's title template appends "· AgeOfMoney" to every page
    // title — these titles already end with "| AgeOfMoney" themselves
    // (matches the brief's requested format), so opt out via `absolute`
    // to avoid "... | AgeOfMoney · AgeOfMoney".
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: 'website' },
    twitter: { card: 'summary_large_image', title, description },
  };
}

function buildJsonLd(match: Match, locale: ServerLocale) {
  const url = `https://ageof.money/matches/${match.id}`;
  const twitchChannel = match.twitchChannel ?? match.tournament?.twitchChannel ?? null;

  const breadcrumbLabels = {
    en: { home: 'Home', matches: 'Matches' },
    fr: { home: 'Accueil', matches: 'Matchs' },
    es: { home: 'Inicio', matches: 'Partidas' },
  }[locale];

  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: breadcrumbLabels.home, item: 'https://ageof.money' },
      { '@type': 'ListItem', position: 2, name: breadcrumbLabels.matches, item: 'https://ageof.money/matches' },
      { '@type': 'ListItem', position: 3, name: `${match.player1.name} vs ${match.player2.name}`, item: url },
    ],
  };

  const winnerName = match.winnerId === match.player1Id ? match.player1.name : match.player2.name;
  const resultDescription = {
    en: `Final score: ${match.resultScore} — ${winnerName} wins`,
    fr: `Score final : ${match.resultScore} — ${winnerName} gagne`,
    es: `Marcador final: ${match.resultScore} — ${winnerName} gana`,
  }[locale];

  const offerDescription = {
    en: `Bet on ${match.player1.name} (×${match.odds1.toFixed(2)}) or ${match.player2.name} (×${match.odds2.toFixed(2)})`,
    fr: `Pariez sur ${match.player1.name} (×${match.odds1.toFixed(2)}) ou ${match.player2.name} (×${match.odds2.toFixed(2)})`,
    es: `Apuesta por ${match.player1.name} (×${match.odds1.toFixed(2)}) o ${match.player2.name} (×${match.odds2.toFixed(2)})`,
  }[locale];

  const matchSchema = {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    '@id': url,
    name: `${match.player1.name} vs ${match.player2.name}${match.tournament ? ` — ${match.tournament.name}` : ''}`,
    description: buildDescription(match, locale),
    url,
    startDate: match.scheduledAt,
    eventStatus: match.status === 'LIVE'
      ? 'https://schema.org/EventScheduled'
      : match.status === 'COMPLETED'
      ? 'https://schema.org/EventPostponed'
      : 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
    location: {
      '@type': 'VirtualLocation',
      url: twitchChannel ? `https://twitch.tv/${twitchChannel}` : 'https://ageof.money',
    },
    organizer: match.tournament ? {
      '@type': 'Organization',
      name: match.tournament.name,
    } : { '@id': 'https://ageof.money/#organization' },
    competitor: [
      {
        '@type': 'Person',
        name: match.player1.name,
        url: `https://ageof.money/matches?player=${encodeURIComponent(match.player1.name)}`,
      },
      {
        '@type': 'Person',
        name: match.player2.name,
        url: `https://ageof.money/matches?player=${encodeURIComponent(match.player2.name)}`,
      },
    ],
    ...(match.status === 'COMPLETED' && match.resultScore ? {
      result: { '@type': 'Result', description: resultDescription },
    } : {}),
    offers: {
      '@type': 'Offer',
      description: offerDescription,
      url,
      seller: { '@id': 'https://ageof.money/#organization' },
    },
  };

  return [breadcrumbSchema, matchSchema];
}

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [match, locale] = await Promise.all([fetchMatch(id), getServerLocale()]);
  const jsonLd = match ? buildJsonLd(match, locale) : null;

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <MatchPageClient matchId={id} initialMatch={match} />
    </>
  );
}
