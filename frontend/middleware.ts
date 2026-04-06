import { NextRequest, NextResponse } from 'next/server';

const SECRET = process.env.MAINTENANCE_SECRET;
const COOKIE  = 'aom_access';

export function middleware(req: NextRequest) {
  // Maintenance mode only active when MAINTENANCE_SECRET is set
  if (!SECRET) return NextResponse.next();

  const { pathname, searchParams } = req.nextUrl;

  // Always allow: maintenance page itself, static assets, Next.js internals, API routes
  if (
    pathname === '/maintenance' ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/api/')
  ) {
    return NextResponse.next();
  }

  // ?unlock=SECRET in URL → set access cookie then redirect to home
  const unlockParam = searchParams.get('unlock');
  if (unlockParam === SECRET) {
    const res = NextResponse.redirect(new URL('/', req.url));
    res.cookies.set(COOKIE, SECRET, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: '/',
    });
    return res;
  }

  // Check access cookie
  const cookie = req.cookies.get(COOKIE);
  if (cookie?.value === SECRET) return NextResponse.next();

  // No access → maintenance page
  return NextResponse.redirect(new URL('/maintenance', req.url));
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
