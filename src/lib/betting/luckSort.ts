/**
 * The /luck table's rows and its two orderings, shared by the site's picture and the bot's text
 * fallback so a sort button cannot reorder one and not the other.
 *
 * Imports nothing, because the bot loads it at runtime: anything it pulled in would ship to the bot.
 */
export type LuckTeam = {
  name: string;
  teamName: string | null;
  actualWins: number;
  expectedWins: number;
  /** actualWins − expectedWins */
  luck: number;
  pointsFor: number;
  pointsAgainst: number;
};

/**
 * `xw` — the DEFAULT: a power ranking by expected wins, ties broken on points scored. Sorting by
 * luck alone puts whoever had the flukiest fortnight on top, which reads as a leaderboard of
 * nothing: luck is noise by construction and reverts (2b5d7e5).
 *
 * `luck` — luckiest first, ties broken on expected wins. Offered as a toggle because the chart's
 * bars then read as one slope from luckiest to unluckiest, which is the view worth a glance.
 */
export type LuckSort = 'xw' | 'luck';

export function parseLuckSort(raw: string | null | undefined): LuckSort {
  return raw === 'luck' ? 'luck' : 'xw';
}

export function sortLuckTeams(teams: LuckTeam[], sort: LuckSort): LuckTeam[] {
  return [...teams].sort(sort === 'luck'
    ? (a, b) => b.luck - a.luck || b.expectedWins - a.expectedWins
    : (a, b) => b.expectedWins - a.expectedWins || b.pointsFor - a.pointsFor);
}
