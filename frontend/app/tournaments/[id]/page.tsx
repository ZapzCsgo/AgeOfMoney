import type { Metadata } from 'next';
import { apiClient } from '@/lib/api';
import { getServerLocale, type ServerLocale } from '@/lib/serverLocale';
import { TournamentPageClient, TournamentDetail } from './TournamentPageClient';

export const dynamic = 'force-dynamic';

async function fetchTournament(id: string): Promise<{ tournament: TournamentDetail | null; notFound: boolean }> {
  try {
    const res = await apiClient.get(`/tournaments/${id}`);
    return { tournament: res.data?.data ?? null, notFound: false };
  } catch (err) {
    const status = (err as { response?: { status?: number } }).response?.status;
    return { tournament: null, notFound: status === 404 };
  }
}

const NOT_FOUND_TITLE: Record<ServerLocale, string> = {
  en: 'Tournament not found | AgeOfMoney',
  fr: 'Tournoi introuvable | AgeOfMoney',
  es: 'Torneo no encontrado | AgeOfMoney',
};

function buildTitle(tournament: TournamentDetail, locale: ServerLocale): string {
  const oddsWord = { en: 'odds & betting', fr: 'cotes & paris', es: 'cuotas y apuestas' }[locale];
  return `${tournament.name} — ${oddsWord} | AgeOfMoney`;
}

function buildDescription(tournament: TournamentDetail, locale: ServerLocale): string {
  const game = tournament.game ?? 'Age of Empires';
  if (locale === 'fr') {
    return `Tournoi ${game} — Tier ${tournament.tier}${tournament.prizePool ? `, prize pool ${tournament.prizePool}` : ''}. Pariez sur les matchs de ce tournoi sur AgeOfMoney, la plateforme de paris esport Age of Empires.`;
  }
  if (locale === 'es') {
    return `Torneo de ${game} — Tier ${tournament.tier}${tournament.prizePool ? `, premio ${tournament.prizePool}` : ''}. Apuesta por los partidos de este torneo en AgeOfMoney.`;
  }
  return `${game} tournament — Tier ${tournament.tier}${tournament.prizePool ? `, prize pool ${tournament.prizePool}` : ''}. Bet on this tournament's matches on AgeOfMoney, the Age of Empires esports betting platform.`;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const [{ tournament }, locale] = await Promise.all([fetchTournament(id), getServerLocale()]);
  const url = `https://ageof.money/tournaments/${id}`;

  if (!tournament) {
    return { title: { absolute: NOT_FOUND_TITLE[locale] }, alternates: { canonical: url } };
  }

  const title = buildTitle(tournament, locale);
  const description = buildDescription(tournament, locale);

  return {
    // See app/matches/[id]/page.tsx — `absolute` avoids the root layout's
    // title template doubling up "AgeOfMoney".
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: 'website' },
    twitter: { card: 'summary_large_image', title, description },
  };
}

function buildJsonLd(tournament: TournamentDetail, locale: ServerLocale) {
  const url = `https://ageof.money/tournaments/${tournament.id}`;
  const endDate = tournament.endDate ? new Date(tournament.endDate) : null;

  const breadcrumbLabels = {
    en: { home: 'Home', tournaments: 'Tournaments' },
    fr: { home: 'Accueil', tournaments: 'Tournois' },
    es: { home: 'Inicio', tournaments: 'Torneos' },
  }[locale];

  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: breadcrumbLabels.home, item: 'https://ageof.money' },
      { '@type': 'ListItem', position: 2, name: breadcrumbLabels.tournaments, item: 'https://ageof.money/tournaments' },
      { '@type': 'ListItem', position: 3, name: tournament.name, item: url },
    ],
  };

  const prizePoolLabel = { en: 'Prize pool', fr: 'Prize pool', es: 'Premio' }[locale];

  const tournamentSchema = {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    '@id': url,
    name: tournament.name,
    description: buildDescription(tournament, locale),
    url,
    startDate: tournament.startDate,
    ...(endDate ? { endDate: tournament.endDate } : {}),
    eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
    eventStatus: tournament.isActive
      ? 'https://schema.org/EventScheduled'
      : 'https://schema.org/EventPostponed',
    location: {
      '@type': 'VirtualLocation',
      url: tournament.twitchChannel
        ? `https://twitch.tv/${tournament.twitchChannel}`
        : 'https://ageof.money',
    },
    organizer: { '@id': 'https://ageof.money/#organization' },
    sport: 'Age of Empires',
    ...(tournament.prizePool ? {
      offers: {
        '@type': 'Offer',
        description: `${prizePoolLabel}: ${tournament.prizePool}`,
        url,
      },
    } : {}),
  };

  return [breadcrumbSchema, tournamentSchema];
}

export default async function TournamentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ tournament, notFound }, locale] = await Promise.all([fetchTournament(id), getServerLocale()]);
  const jsonLd = tournament ? buildJsonLd(tournament, locale) : null;

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <TournamentPageClient tournamentId={id} initialTournament={tournament} initialNotFound={notFound} />
    </>
  );
}
