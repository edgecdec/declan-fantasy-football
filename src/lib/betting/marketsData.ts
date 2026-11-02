import { readBotMarkets, type BotMarketsResponse } from '@/lib/betting/botMarkets';
import { findBettingLeague } from '@/lib/betting/leagues';
import { getDb } from '@/lib/db';
import { getNflStateOrFallback } from '@/services/common/seasonService';

/**
 * One league week's board, for the JSON route and the picture route alike, so the image and the
 * text fallback beside it are one read. Kept apart from botMarkets.ts, which the bot imports and so
 * must not pull in the database.
 */
export type MarketsLoad =
  | { status: 200; body: BotMarketsResponse }
  | { status: 404; body: { ok: false; error: string } };

export async function loadMarkets(params: URLSearchParams): Promise<MarketsLoad> {
  const leagueId = params.get('leagueId') ?? '';
  const cfg = findBettingLeague(leagueId);
  if (!cfg) return { status: 404, body: { ok: false, error: 'Not a betting league.' } };

  const asked = Number(params.get('week'));
  const week = Number.isFinite(asked) && asked > 0 ? asked : (await getNflStateOrFallback()).week;

  return {
    status: 200,
    body: {
      league: { leagueId, season: cfg.season, label: cfg.label },
      week,
      markets: readBotMarkets(getDb(), leagueId, week),
    },
  };
}
