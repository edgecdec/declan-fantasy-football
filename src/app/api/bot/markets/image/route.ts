import { NextResponse } from 'next/server';
import { requireBot } from '@/lib/betting/botApi';
import { loadMarkets } from '@/lib/betting/marketsData';
import { renderMarketsImage } from '@/lib/betting/marketsImage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The board as a PNG, for /markets. Same parameters and auth as /api/bot/markets — the bot asks for
 * the week the JSON answered with, so the picture and the text fallback cannot show different
 * weeks. Errors come back as JSON so the bot can say what went wrong and fall back to text.
 */
export async function GET(request: Request) {
  const denied = requireBot(request);
  if (denied) return denied;
  const { status, body } = await loadMarkets(new URL(request.url).searchParams);
  if (status !== 200) return NextResponse.json(body, { status });
  if (body.markets.length === 0) {
    return NextResponse.json({ ok: false, error: `Nothing priced for week ${body.week} yet.` }, { status: 404 });
  }
  return renderMarketsImage(body);
}
