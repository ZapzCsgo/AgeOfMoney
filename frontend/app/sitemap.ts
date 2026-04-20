import type { MetadataRoute } from 'next';

/**
 * Sitemap dynamique — revalidé toutes les heures. Inclut :
 *   - pages statiques publiques (/, /matches, /tournaments, /roulette,
 *     /coinflip, /leaderboard, /support, /privacy)
 *   - toutes les pages matchs COMPLETED récents + UPCOMING (URLs canoniques
 *     `/matches/{id}` — c'est là qu'est le contenu unique qui intéresse
 *     les moteurs de recherche)
 *   - toutes les pages tournois actifs (`/tournaments/{id}`)
 *
 * Les pages auth-only (profile, deposit, withdraw, affiliate, admin) ne
 * sont PAS incluses — déjà disallow par robots.ts et nécessitent un login.
 *
 * Si le backend est injoignable au build/render du sitemap, on tombe sur
 * les pages statiques uniquement (mieux qu'un 500 sur /sitemap.xml).
 */

export const revalidate = 3600; // 1h

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const SITE_BASE = 'https://ageof.money';

async function safeFetch<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}/api/v1${path}`, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    { url: `${SITE_BASE}/`,            lastModified: now, changeFrequency: 'daily',  priority: 1.0 },
    { url: `${SITE_BASE}/matches`,     lastModified: now, changeFrequency: 'hourly', priority: 0.9 },
    { url: `${SITE_BASE}/tournaments`, lastModified: now, changeFrequency: 'daily',  priority: 0.8 },
    { url: `${SITE_BASE}/roulette`,    lastModified: now, changeFrequency: 'daily',  priority: 0.7 },
    { url: `${SITE_BASE}/coinflip`,    lastModified: now, changeFrequency: 'daily',  priority: 0.7 },
    { url: `${SITE_BASE}/leaderboard`, lastModified: now, changeFrequency: 'daily',  priority: 0.6 },
    { url: `${SITE_BASE}/support`,     lastModified: now, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${SITE_BASE}/privacy`,     lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
  ];

  // Matchs — upcoming + live + recent completed. Le backend retourne déjà
  // les matchs qui ont du sens publiquement (pas ceux orphelins/cancellés).
  const matches = await safeFetch<{ data?: Array<{ id: string; updatedAt?: string; status?: string }> }>(
    '/matches?limit=200'
  );
  const matchPages: MetadataRoute.Sitemap = (matches?.data ?? []).map(m => ({
    url: `${SITE_BASE}/matches/${m.id}`,
    lastModified: m.updatedAt ? new Date(m.updatedAt) : now,
    changeFrequency: m.status === 'COMPLETED' ? 'monthly' : 'hourly',
    priority: m.status === 'UPCOMING' ? 0.8 : 0.5,
  }));

  // Tournois actifs. Un tournoi COMPLETED garde sa page mais moins souvent
  // mise à jour.
  const tournaments = await safeFetch<{ data?: Array<{ id: string; endDate?: string; isActive?: boolean }> }>(
    '/tournaments?limit=100'
  );
  const tournamentPages: MetadataRoute.Sitemap = (tournaments?.data ?? []).map(t => ({
    url: `${SITE_BASE}/tournaments/${t.id}`,
    lastModified: t.endDate ? new Date(t.endDate) : now,
    changeFrequency: t.isActive ? 'daily' : 'monthly',
    priority: t.isActive ? 0.7 : 0.4,
  }));

  return [...staticPages, ...matchPages, ...tournamentPages];
}
