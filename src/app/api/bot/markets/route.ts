import { NextResponse } from 'next/server';
import { requireBot } from '@/lib/betting/botApi';
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
 * ALWAYS filtered by league. An earlier hand-rolled sample of this query left the league filter out
 * and produced a board mixing two leagues' matchups, which looks plausible and is nonsense — those
 * managers are not playing each other.
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

  const rows = getDb()
    .prepare(
      `SELECT id, matchup_id, name_a, name_b, prob_a, price_a, price_b, status,
              remaining_minutes, final_a, final_b, winner
       FROM markets
       WHERE league_id = ? AND week = ?
       ORDER BY ABS(prob_a - 0.5) ASC`,
    )
    .all(leagueId, week) as {
      id: string;
      matchup_id: number;
      name_a: string | null;
      name_b: string | null;
      prob_a: number;
      price_a: number;
      price_b: number;
      status: string;
      remaining_minutes: number;
      final_a: number | null;
      final_b: number | null;
      winner: string | null;
    }[];

  return NextResponse.json({
    ok: true,
    league: { leagueId, season: cfg.season, label: cfg.label },
    week,
    // Closest first, matching the website's default: those are the ones worth looking at.
    markets: rows.map(r => ({
      marketId: r.id,
      matchupId: r.matchup_id,
      nameA: r.name_a,
      nameB: r.name_b,
      probA: r.prob_a,
      priceA: r.price_a,
      priceB: r.price_b,
      status: r.status,
      remainingMinutes: r.remaining_minutes,
      finalA: r.final_a,
      finalB: r.final_b,
      winner: r.winner,
    })),
  });
}
