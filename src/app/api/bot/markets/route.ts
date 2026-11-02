import { NextResponse } from 'next/server';
import { requireBot } from '@/lib/betting/botApi';
import { loadMarkets } from '@/lib/betting/marketsData';

export const dynamic = 'force-dynamic';

/**
 * The priced board for one league week.
 *
 * Reads the `markets` rows the tick route already wrote rather than pricing on demand. That matters:
 * `/api/betting/markets` prices as a side effect of being read, which was the whole read-driven
 * problem the tick route exists to fix. A bot command must never be the thing that moves a line.
 *
 * The read lives in `@/lib/betting/marketsData` (shared with the picture route) and the response
 * type in `@/lib/betting/botMarkets`, which the bot imports — see there for why it is always
 * filtered by league.
 */
export async function GET(request: Request) {
  const denied = requireBot(request);
  if (denied) return denied;
  const { status, body } = await loadMarkets(new URL(request.url).searchParams);
  if (status !== 200) return NextResponse.json(body, { status });
  return NextResponse.json({ ok: true, ...body });
}
