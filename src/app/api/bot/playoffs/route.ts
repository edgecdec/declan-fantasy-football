import { NextResponse } from 'next/server';
import { requireBot } from '@/lib/betting/botApi';
import { loadPlayoffs } from '@/lib/betting/playoffsData';

export const dynamic = 'force-dynamic';

/**
 * Playoff odds for any Sleeper league — the bot's /playoffs. Bot-secret only, like every
 * /api/bot route; not limited to betting leagues, since it is public schedule-and-scores data
 * (as /api/bot/luck). See playoffsData.ts for the model and why it never prices.
 */
export async function GET(request: Request) {
  const denied = requireBot(request);
  if (denied) return denied;
  const { status, body } = await loadPlayoffs(new URL(request.url).searchParams.get('leagueId')?.trim());
  if (status !== 200) return NextResponse.json(body, { status });
  return NextResponse.json({ ok: true, ...body });
}
