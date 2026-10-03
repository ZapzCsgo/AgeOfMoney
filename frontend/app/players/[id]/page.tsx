import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPlayer } from '@/lib/api';
import { getAvatarSrc } from '@/lib/utils';
import { getServerLocale, type ServerLocale } from '@/lib/serverLocale';
import { PlayerWithStats } from '@/types';

export const dynamic = 'force-dynamic';

async function fetchPlayer(id: string): Promise<PlayerWithStats | null> {
  try {
    const res = await getPlayer(id);
    return (res.data as unknown as PlayerWithStats) ?? null;
  } catch {
    return null;
  }
}

const NOT_FOUND_TITLE: Record<ServerLocale, string> = {
  en: 'Player not found | AgeOfMoney',
  fr: 'Joueur introuvable | AgeOfMoney',
  es: 'Jugador no encontrado | AgeOfMoney',
};

const LABELS: Record<ServerLocale, {
  record: string; tournamentWins: string; winrate: string; recentMatches: string; noRecentMatches: string;
}> = {
  en: { record: 'Record', tournamentWins: 'Tournament wins', winrate: 'Win rate', recentMatches: 'Recent matches', noRecentMatches: 'No completed matches tracked yet.' },
  fr: { record: 'Bilan', tournamentWins: 'Titres de tournoi', winrate: 'Taux de victoire', recentMatches: 'Matchs récents', noRecentMatches: "Aucun match terminé suivi pour l'instant." },
  es: { record: 'Récord', tournamentWins: 'Títulos de torneo', winrate: 'Tasa de victorias', recentMatches: 'Partidas recientes', noRecentMatches: 'Aún no hay partidas completadas registradas.' },
};

function buildDescription(player: PlayerWithStats, locale: ServerLocale): string {
  const wr = Math.round((player.stats?.winrateCalculated ?? 0) * 100);
  if (locale === 'fr') {
    return `${player.name} — statistiques de tournoi AoE : ${player.stats?.wins ?? 0}V/${player.stats?.losses ?? 0}D, ${wr}% de victoires. Cotes et matchs en direct sur AgeOfMoney.`;
  }
  if (locale === 'es') {
    return `${player.name} — estadísticas de torneo AoE: ${player.stats?.wins ?? 0}V/${player.stats?.losses ?? 0}D, ${wr}% de victorias. Cuotas y partidas en vivo en AgeOfMoney.`;
  }
  return `${player.name} — AoE tournament stats: ${player.stats?.wins ?? 0}W/${player.stats?.losses ?? 0}L, ${wr}% win rate. Live odds and matches on AgeOfMoney.`;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const [player, locale] = await Promise.all([fetchPlayer(id), getServerLocale()]);
  const url = `https://ageof.money/players/${id}`;

  if (!player) {
    return { title: { absolute: NOT_FOUND_TITLE[locale] }, alternates: { canonical: url } };
  }

  const title = `${player.name} — AoE tournament stats & odds | AgeOfMoney`;
  const description = buildDescription(player, locale);

  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: 'profile' },
    twitter: { card: 'summary', title, description },
  };
}

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [player, locale] = await Promise.all([fetchPlayer(id), getServerLocale()]);
  if (!player) notFound();

  const l = LABELS[locale];
  const avatarSrc = getAvatarSrc(player.id, player.avatarUrl);
  const url = `https://ageof.money/players/${id}`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    '@id': `${url}#person`,
    name: player.name,
    url,
    ...(player.country ? { nationality: player.country } : {}),
    ...(avatarSrc ? { image: avatarSrc } : {}),
  };

  return (
    <div className="min-h-screen px-4 py-12" style={{ background: '#07060f' }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8 flex flex-col items-center text-center">
          <div
            className="w-20 h-20 rounded-full overflow-hidden mb-4 flex items-center justify-center text-2xl font-bold"
            style={{ background: '#0d0b1a', border: '2px solid rgba(255,197,66,0.3)', color: '#ffc542' }}
          >
            {avatarSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarSrc} alt={player.name} className="w-full h-full object-cover object-top" />
            ) : (
              player.name.slice(0, 2).toUpperCase()
            )}
          </div>
          <h1 className="text-[26px] font-bold mb-1" style={{ color: '#e8e2f5', fontFamily: 'Cinzel, serif' }}>
            {player.name}
          </h1>
          {player.country && (
            <p className="text-[12px] uppercase tracking-widest" style={{ color: '#9990b8' }}>
              {player.country}
            </p>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="rounded-2xl p-4 text-center" style={{ background: '#0d0b1a', border: '1px solid rgba(255,197,66,0.2)' }}>
            <div className="text-[18px] font-bold" style={{ color: '#ffc542' }}>
              {player.stats?.wins ?? 0}–{player.stats?.losses ?? 0}
            </div>
            <div className="text-[11px] uppercase tracking-wide" style={{ color: '#9990b8' }}>{l.record}</div>
          </div>
          <div className="rounded-2xl p-4 text-center" style={{ background: '#0d0b1a', border: '1px solid rgba(255,197,66,0.2)' }}>
            <div className="text-[18px] font-bold" style={{ color: '#ffc542' }}>
              {Math.round((player.stats?.winrateCalculated ?? 0) * 100)}%
            </div>
            <div className="text-[11px] uppercase tracking-wide" style={{ color: '#9990b8' }}>{l.winrate}</div>
          </div>
          <div className="rounded-2xl p-4 text-center" style={{ background: '#0d0b1a', border: '1px solid rgba(255,197,66,0.2)' }}>
            <div className="text-[18px] font-bold" style={{ color: '#ffc542' }}>
              {player.stats?.tournamentWins ?? 0}
            </div>
            <div className="text-[11px] uppercase tracking-wide" style={{ color: '#9990b8' }}>{l.tournamentWins}</div>
          </div>
        </div>

        {/* Recent matches */}
        <h2 className="text-[15px] font-bold mb-3" style={{ color: '#ffc542', fontFamily: 'Cinzel, serif' }}>
          {l.recentMatches}
        </h2>
        <div className="space-y-3">
          {(player.recentMatches ?? []).length === 0 && (
            <p className="text-[13px]" style={{ color: '#9990b8' }}>{l.noRecentMatches}</p>
          )}
          {(player.recentMatches ?? []).map((m) => {
            const opponent = m.player1Id === player.id ? m.player2 : m.player1;
            const won = m.winnerId === player.id;
            return (
              <Link
                key={m.id}
                href={`/matches/${m.id}`}
                className="block rounded-2xl p-4 transition-colors hover:border-[rgba(255,197,66,0.4)]"
                style={{ background: '#0d0b1a', border: '1px solid rgba(255,197,66,0.2)' }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-medium" style={{ color: '#e8e2f5' }}>
                    vs {opponent?.name ?? '?'}
                  </span>
                  <span
                    className="text-[11px] font-bold uppercase px-2 py-0.5 rounded"
                    style={{ color: won ? '#34d399' : '#f87171', background: won ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)' }}
                  >
                    {won ? 'W' : 'L'} {m.resultScore ?? ''}
                  </span>
                </div>
                {m.tournament && (
                  <span className="text-[11px]" style={{ color: '#9990b8' }}>{m.tournament.name}</span>
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
