import { NextRequest, NextResponse } from 'next/server';

// ── Language auto-detection ────────────────────────────────────────────────
const SUPPORTED_LANGS = ['fr', 'en', 'es'] as const;
type Lang = (typeof SUPPORTED_LANGS)[number];

function pickLanguage(acceptLanguage: string): Lang {
  // Accept-Language: "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7"
  const candidates = acceptLanguage
    .split(',')
    .map(part => {
      const [tag, qStr] = part.trim().split(';q=');
      const q = qStr ? parseFloat(qStr) : 1;
      return { tag: tag.toLowerCase().slice(0, 2), q };
    })
    .sort((a, b) => b.q - a.q);
  for (const c of candidates) {
    if ((SUPPORTED_LANGS as readonly string[]).includes(c.tag)) return c.tag as Lang;
  }
  // International fallback → English
  return 'en';
}

function applyLangCookie(req: NextRequest, res: NextResponse) {
  const existing = req.cookies.get('aom_lang')?.value;
  if (existing && (SUPPORTED_LANGS as readonly string[]).includes(existing)) return;
  const accept = req.headers.get('accept-language') ?? '';
  const lang = pickLanguage(accept);
  res.cookies.set('aom_lang', lang, {
    maxAge: 60 * 60 * 24 * 365, // 1 year
    path: '/',
    sameSite: 'lax',
  });
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always allow static assets, API routes and SEO metadata files.
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/api/') ||
    pathname === '/robots.txt' ||
    pathname === '/sitemap.xml' ||
    pathname === '/manifest.webmanifest' ||
    pathname === '/sitemap-0.xml'
  ) {
    return NextResponse.next();
  }

  // Pass-through + auto language cookie
  const res = NextResponse.next();
  applyLangCookie(req, res);
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
