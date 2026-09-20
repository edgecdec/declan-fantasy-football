import { NextResponse } from 'next/server';
import { requireBot } from '@/lib/betting/botApi';
import { findBettingLeague } from '@/lib/betting/leagues';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Bounded so one command cannot drag the whole season into memory. */
const MAX_LIMIT = 200;

/**
 * Settled bets for a league — the history the standings cannot show.
 *
 * `/api/bot/leaderboard` returns OPEN positions only, because that is what it needs to mark to the
 * live line. Anything resolved is gone from it, so "what happened last week" had no source at all.
 *
 * Joined through `markets` to this league, like every other aggregate in the betting schema. Without
 * that filter a second league's bets appear in this league's history — the same mistake that put two
 * leagues' matchups in one markets board.
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

  const asked = Number(params.get('limit'));
  const limit = Number.isFinite(asked) && asked > 0 ? Math.min(MAX_LIMIT, asked) : 100;

  const rows = getDb()
    .prepare(
      `SELECT w.id, a.display_name AS bettor, w.side, w.stake_cents, w.price, w.to_win_cents,
              w.status, w.settled_at, m.week, m.name_a, m.name_b, m.final_a, m.final_b
       FROM wagers w
       JOIN accounts a ON a.id = w.account_id
       JOIN markets m ON m.id = w.market_id
       WHERE m.league_id = ? AND w.status <> 'open'
       ORDER BY w.settled_at DESC, w.id DESC
       LIMIT ?`,
    )
    .all(leagueId, limit) as {
      id: string;
      bettor: string;
      side: string;
      stake_cents: number;
      price: number;
      to_win_cents: number;
      status: string;
      settled_at: string | null;
      week: number;
      name_a: string | null;
      name_b: string | null;
      final_a: number | null;
      final_b: number | null;
    }[];

  return NextResponse.json({
    ok: true,
    league: { leagueId, season: cfg.season, label: cfg.label },
    bets: rows.map(r => ({
      wagerId: r.id,
      bettor: r.bettor,
      // The side actually backed, resolved from the names frozen at pricing time.
      pick: (r.side === 'a' ? r.name_a : r.name_b) ?? r.side.toUpperCase(),
      opponent: (r.side === 'a' ? r.name_b : r.name_a) ?? null,
      stakeCents: r.stake_cents,
      price: r.price,
      toWinCents: r.to_win_cents,
      status: r.status,
      settledAt: r.settled_at,
      week: r.week,
      /*
       * Signed outcome, computed here so every reader agrees. A loss is the stake back out, a win is
       * the profit only (the stake was already returned), and a void is nothing either way.
       */
      netCents:
        r.status === 'won' ? r.to_win_cents : r.status === 'lost' ? -r.stake_cents : 0,
      finalA: r.final_a,
      finalB: r.final_b,
    })),
  });
}
