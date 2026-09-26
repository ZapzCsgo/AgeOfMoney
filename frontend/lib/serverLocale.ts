import { NextRequest } from 'next/server';

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

function localeFromRequest(req: NextRequest): 'fr' | 'en' | 'es' {
  const val = req.cookies.get('aom_lang')?.value;
  return val === 'fr' || val === 'es' ? val : 'en';
}

export function serverError(req: NextRequest, key: ServerErrorKey): string {
  return SERVER_ERRORS[key][localeFromRequest(req)];
}
