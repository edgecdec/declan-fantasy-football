import type Database from 'better-sqlite3';

/**
 * The priced board as `/api/bot/markets` serves it, and the type the bot reads it with.
 *
 * Lives on the site side and the bot imports the TYPE, so the two cannot drift: a field renamed here
 * is a compile error in the bot rather than an `undefined` rendered as "NaN" in a Discord embed.
 * Type-only imports are erased, so the bot pulls in nothing at runtime — which is also why this file
 * imports nothing but a type.
 */
export type BotMarket = {
  marketId: string;
  matchupId: number;
  nameA: string | null;
  nameB: string | null;
  probA: number;
  priceA: number;
  priceB: number;
  /** open | closed | settled | void */
  status: string;
  remainingMinutes: number;
  /** Points banked so far, as of the last pricing pass. Null on rows priced before it was stored. */
  pointsA: number | null;
  pointsB: number | null;
  /**
   * Projected final: banked plus expected remaining, from the same distributions as `probA`. Before
   * kickoff it is the pre-game projection; once games are on it is the live projected final.
   */
  projectedA: number | null;
  projectedB: number | null;
  /** Graded scores, set only at settlement. */
  finalA: number | null;
  finalB: number | null;
  /** 'a' | 'b' | 'push', set only at settlement. */
  winner: string | null;
};

export type BotMarketsResponse = {
  league: { leagueId: string; season: string; label: string };
  week: number;
  markets: BotMarket[];
};

type Row = {
  id: string;
  matchup_id: number;
  name_a: string | null;
  name_b: string | null;
  prob_a: number;
  price_a: number;
  price_b: number;
  status: string;
  remaining_minutes: number;
  points_a: number | null;
  points_b: number | null;
  projected_a: number | null;
  projected_b: number | null;
  final_a: number | null;
  final_b: number | null;
  winner: string | null;
};

/**
 * One league week's markets, closest first — matching the website's default, since those are the
 * ones worth looking at.
 *
 * Reads what the tick route already wrote rather than pricing: a bot command must never be the
 * thing that moves a line. ALWAYS filtered by league — an earlier hand-rolled version of this query
 * left the filter out and produced a board mixing two leagues' matchups, which looks plausible and
 * is nonsense.
 */
export function readBotMarkets(
  db: Database.Database,
  leagueId: string,
  week: number,
): BotMarket[] {
  const rows = db
    .prepare(
      `SELECT id, matchup_id, name_a, name_b, prob_a, price_a, price_b, status,
              remaining_minutes, points_a, points_b, projected_a, projected_b,
              final_a, final_b, winner
       FROM markets
       WHERE league_id = ? AND week = ?
       ORDER BY ABS(prob_a - 0.5) ASC`,
    )
    .all(leagueId, week) as Row[];

  return rows.map(r => ({
    marketId: r.id,
    matchupId: r.matchup_id,
    nameA: r.name_a,
    nameB: r.name_b,
    probA: r.prob_a,
    priceA: r.price_a,
    priceB: r.price_b,
    status: r.status,
    remainingMinutes: r.remaining_minutes,
    pointsA: r.points_a,
    pointsB: r.points_b,
    projectedA: r.projected_a,
    projectedB: r.projected_b,
    finalA: r.final_a,
    finalB: r.final_b,
    winner: r.winner,
  }));
}
