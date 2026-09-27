import { getMatches, getTournaments } from '@/lib/api';
import { getServerLocale, type ServerLocale } from '@/lib/serverLocale';
import { Match, Tournament } from '@/types';
import { HomePageClient } from './HomePageClient';

export const dynamic = 'force-dynamic';

async function fetchHomeData(): Promise<{ matches: Match[]; upcomingTourneys: Tournament[] }> {
  try {
    const [matchRes, tournRes] = await Promise.allSettled([
      getMatches({ hours: 168 }),
      getTournaments({ active: true, limit: 20 }),
    ]);
    const matches = matchRes.status === 'fulfilled' ? matchRes.value.data : [];
    let upcomingTourneys: Tournament[] = [];
    if (tournRes.status === 'fulfilled') {
      const now = Date.now();
      upcomingTourneys = (tournRes.value.data ?? []).filter((tourn: Tournament) => {
        if (tourn.tier !== 'S' && tourn.tier !== 'A') return false;
        const start = new Date(tourn.startDate).getTime();
        if (tourn.endDate) return new Date(tourn.endDate).getTime() >= now;
        return start > now;
      });
    }
    return { matches, upcomingTourneys };
  } catch {
    return { matches: [], upcomingTourneys: [] };
  }
}

function buildJsonLd(matches: Match[], locale: ServerLocale) {
  const copy = {
    en: { name: 'Age of Empires LIVE and upcoming matches', description: 'Professional Age of Empires matches open for betting on AgeOfMoney. Live odds.' },
    fr: { name: 'Matchs Age of Empires LIVE et à venir', description: 'Matchs professionnels Age of Empires disponibles au pari sur AgeOfMoney. Cotes en temps réel.' },
    es: { name: 'Partidas de Age of Empires en vivo y próximas', description: 'Partidas profesionales de Age of Empires disponibles para apostar en AgeOfMoney. Cuotas en tiempo real.' },
  }[locale];

  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: copy.name,
    description: copy.description,
    url: 'https://ageof.money',
    itemListElement: matches
      .filter(m => m.status !== 'COMPLETED')
      .slice(0, 10)
      .map((m, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: `${m.player1.name} vs ${m.player2.name}`,
        url: `https://ageof.money/matches/${m.id}`,
      })),
  };
}

export default async function Page() {
  const [{ matches, upcomingTourneys }, locale] = await Promise.all([fetchHomeData(), getServerLocale()]);
  const jsonLd = matches.length > 0 ? buildJsonLd(matches, locale) : null;

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <HomePageClient initialMatches={matches} initialTournaments={upcomingTourneys} />
    </>
  );
}
