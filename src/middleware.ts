import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const hostname = request.headers.get('host');
  
  // Configuration
  const oldDomain = 'fantasy-football-full-website.vercel.app';
  const newDomain = 'declan-fantasy-football.vercel.app';

  // Check if we are on the old domain
  if (hostname === oldDomain) {
    const url = new URL(request.url);
    url.hostname = newDomain;
    url.protocol = 'https'; // Ensure secure
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

// Only run on main pages, exclude static files/api/images to save resources
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
