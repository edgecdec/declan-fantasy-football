import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

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

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
