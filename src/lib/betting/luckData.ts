import { SleeperService } from '@/services/sleeper/sleeperService';
import { analyzeLeague } from '@/services/stats/expectedWins';
import { sortLuckTeams, type LuckTeam } from '@/lib/betting/luckSort';

/**
 * Expected wins against actual wins for a league, for the /luck JSON route and its picture alike,
 * so the image and the text fallback beside it are one computation.
 *
 * Reuses `analyzeLeague` rather than re-deriving the figures. Its shrinkage and its deliberate
 * exclusion of the in-progress week are exactly the parts that would be got wrong by a second
 * implementation — and a second implementation would then disagree with the website.
 */
export type { LuckTeam } from '@/lib/betting/luckSort';

export type LuckResponse = {
  league: { leagueId: string; name: string; season: string };
  weeksCounted: number;
  teams: LuckTeam[];
};

export type LuckLoad =
  | { status: 200; body: LuckResponse }
  | { status: 400 | 404 | 502; body: { ok: false; error: string } };

export async function loadLuck(leagueId: string | null | undefined): Promise<LuckLoad> {
  if (!leagueId) return { status: 400, body: { ok: false, error: 'leagueId is required.' } };

  const league = await SleeperService.getLeague(leagueId);
  if (!league) return { status: 404, body: { ok: false, error: 'Sleeper does not know that league.' } };

  try {
    const analysis = await analyzeLeague(league);
    return {
      status: 200,
      body: {
        league: { leagueId, name: league.name, season: league.season },
        weeksCounted: analysis.weeksCounted,
        // Ordered by expected wins, the default view (see luckSort.ts for why).
        teams: sortLuckTeams(
          analysis.standings.map(t => ({
            name: t.name,
            teamName: t.teamName ?? null,
            actualWins: t.actualWins,
            expectedWins: t.expectedWins,
            luck: t.actualWins - t.expectedWins,
            pointsFor: t.pointsFor,
            pointsAgainst: t.pointsAgainst,
          })),
          'xw',
        ),
      },
    };
  } catch (err) {
    return {
      status: 502,
      body: { ok: false, error: err instanceof Error ? err.message : 'Could not analyse that league.' },
    };
  }
}
