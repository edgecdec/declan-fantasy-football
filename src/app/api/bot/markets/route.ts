import { NextResponse } from 'next/server';
import { requireBot } from '@/lib/betting/botApi';
import { readBotMarkets, type BotMarketsResponse } from '@/lib/betting/botMarkets';
import { findBettingLeague } from '@/lib/betting/leagues';
import { getDb } from '@/lib/db';
import { getNflStateOrFallback } from '@/services/common/seasonService';

export const dynamic = 'force-dynamic';

/**
 * The priced board for one league week.
 *
 * Reads the `markets` rows the tick route already wrote rather than pricing on demand. That matters:
 * `/api/betting/markets` prices as a side effect of being read, which was the whole read-driven
 * problem the tick route exists to fix. A bot command must never be the thing that moves a line.
 *
 * The query and the response type live in `@/lib/betting/botMarkets`, which the bot imports the type
 * from — see there for why it is always filtered by league.
 */
export async function GET(request: Request) {
  const denied = requireBot(request);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const leagueId = params.get('leagueId') ?? '';
  const cfg = findBettingLeague(leagueId);
  if (!cfg) {
    return NextResponse.json({ ok: false, error: 'Not a betting league.' }, { status: 404 });
  }

  const asked = Number(params.get('week'));
  const week = Number.isFinite(asked) && asked > 0 ? asked : (await getNflStateOrFallback()).week;

  const body: BotMarketsResponse = {
    league: { leagueId, season: cfg.season, label: cfg.label },
    week,
    markets: readBotMarkets(getDb(), leagueId, week),
  };
  return NextResponse.json({ ok: true, ...body });
}
