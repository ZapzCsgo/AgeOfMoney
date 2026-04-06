import { NextRequest, NextResponse } from 'next/server';

const SECRET = process.env.MAINTENANCE_SECRET;
const COOKIE  = 'aom_access';

const MAINTENANCE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AgeOfMoney — Maintenance</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #07060f;
      color: #e8e2f5;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: sans-serif;
    }
    .wrap { text-align: center; padding: 2rem; }
    svg { margin-bottom: 2rem; }
    h1 {
      font-size: 2rem;
      font-weight: 700;
      letter-spacing: 0.15em;
      color: #d4a017;
      margin-bottom: 1rem;
      font-family: Georgia, serif;
    }
    p { color: #6b6488; font-size: 0.95rem; line-height: 1.7; }
    .line {
      width: 40px; height: 2px; margin: 2rem auto 0;
      background: linear-gradient(90deg, transparent, #d4a017, transparent);
    }
  </style>
</head>
<body>
  <div class="wrap">
    <svg width="64" height="64" viewBox="0 0 24 24" fill="none">
      <path d="M3 17L5 9L9 13L12 7L15 13L19 9L21 17H3Z" fill="#d4a017" stroke="#d4a017" stroke-width="1" stroke-linejoin="round"/>
      <rect x="3" y="17" width="18" height="2" rx="1" fill="#d4a017"/>
    </svg>
    <h1>AGEOFMONEY</h1>
    <p>The site is currently under maintenance.<br/>We'll be back soon.</p>
    <div class="line"></div>
  </div>
</body>
</html>`;

export function middleware(req: NextRequest) {
  if (!SECRET) return NextResponse.next();

  const { pathname, searchParams } = req.nextUrl;

  // Always allow static assets and API routes
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/api/')
  ) {
    return NextResponse.next();
  }

  // ?unlock=SECRET → set access cookie and redirect to home
  const unlockParam = searchParams.get('unlock');
  if (unlockParam === SECRET) {
    const res = NextResponse.redirect(new URL('/', req.url));
    res.cookies.set(COOKIE, SECRET, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
      path: '/',
    });
    return res;
  }

  // Valid cookie → allow through
  const cookie = req.cookies.get(COOKIE);
  if (cookie?.value === SECRET) return NextResponse.next();

  // Blocked → return raw HTML, no Next.js layout at all
  return new NextResponse(MAINTENANCE_HTML, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
