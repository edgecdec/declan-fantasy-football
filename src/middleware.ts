import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const POSITIONAL_REDIRECTS: Record<string, string> = {
  '/performance/positional': '/skill?tab=efficiency',
  '/performance/positional/history': '/skill?tab=historical',
};

export function middleware(request: NextRequest) {
  const hostname = request.headers.get('host');

  // Redirect old Vercel domains to new self-hosted domain
  const oldDomains = [
    'fantasy-football-full-website.vercel.app',
    'declan-fantasy-football.vercel.app',
  ];

  if (hostname && oldDomains.includes(hostname)) {
    const url = new URL(request.url);
    url.hostname = 'fantasyfootball.edgecdec.com';
    url.protocol = 'https';
    return NextResponse.redirect(url);
  }

  // Redirect old positional benchmarks URLs to /skill
  const { pathname } = request.nextUrl;
  const redirect = POSITIONAL_REDIRECTS[pathname];
  if (redirect) {
    const url = request.nextUrl.clone();
    const [path, query] = redirect.split('?');
    url.pathname = path;
    if (query) {
      url.search = `?${query}`;
    }
    return NextResponse.redirect(url, 308);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
