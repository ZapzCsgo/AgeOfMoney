import { NextRequest } from 'next/server';

export type ServerLocale = 'fr' | 'en' | 'es';

/**
 * Minimal locale-aware error strings for Next.js API route handlers, which
 * run server-side and can't use the client useT() hook. Reads the same
 * aom_lang cookie the middleware sets, so these routes' JSON error bodies
 * (surfaced directly to the user via data.error in deposit/withdraw pages)
 * respect the visitor's language instead of always being French.
 */
const SERVER_ERRORS = {
  notAuthenticated: { fr: 'Non authentifié', en: 'Not authenticated', es: 'No autenticado' },
  serverError:      { fr: 'Erreur serveur',  en: 'Server error',      es: 'Error del servidor' },
} as const;

type ServerErrorKey = keyof typeof SERVER_ERRORS;

function localeFromRequest(req: NextRequest): ServerLocale {
  const val = req.cookies.get('aom_lang')?.value;
  return val === 'fr' || val === 'es' ? val : 'en';
}

export function serverError(req: NextRequest, key: ServerErrorKey): string {
  return SERVER_ERRORS[key][localeFromRequest(req)];
}

/**
 * Same aom_lang priority as the client LanguageProvider (cookie set by
 * middleware from geo/Accept-Language, English fallback), but for use in
 * Server Components / generateMetadata() where only next/headers'
 * cookies()/headers() are available — no NextRequest, no localStorage.
 * Deliberately does NOT check localStorage (a manual in-app language pick):
 * that preference never reaches the server on first load anyway, and by
 * the time it would, the client bundle already re-renders in the right
 * language — this only governs the very first server-rendered HTML/metadata.
 */
export async function getServerLocale(): Promise<ServerLocale> {
  const { cookies, headers } = await import('next/headers');
  try {
    const cookieStore = await cookies();
    const val = cookieStore.get('aom_lang')?.value;
    if (val === 'fr' || val === 'es') return val;
    if (val === 'en') return 'en';
  } catch { /* no request context */ }
  try {
    const h = await headers();
    const accept = h.get('accept-language') ?? '';
    const first = accept.split(',')[0]?.trim().toLowerCase().slice(0, 2);
    if (first === 'fr' || first === 'es') return first;
  } catch { /* no request context */ }
  return 'en';
}
