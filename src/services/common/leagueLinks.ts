/**
 * Where a league name links to.
 *
 * One helper so the "league mentions are clickable" rule has a single implementation
 * rather than a hardcoded URL at every call site.
 *
 * Points at Sleeper rather than anywhere in this app on purpose: from an analytics page the
 * useful next step is the league itself — the live matchup, the actual lineup, the chat —
 * and none of that exists here. If an in-app per-league weekly view is ever built, this is
 * the one place to repoint.
 */
const SLEEPER_LEAGUE_BASE = 'https://sleeper.com/leagues';

/** The league's matchup view, which is what you want during a slate. */
export function leagueUrl(leagueId: string): string {
  return `${SLEEPER_LEAGUE_BASE}/${leagueId}/matchup`;
}

/** The league's team/roster view. */
export function leagueTeamUrl(leagueId: string): string {
  return `${SLEEPER_LEAGUE_BASE}/${leagueId}/team`;
}
