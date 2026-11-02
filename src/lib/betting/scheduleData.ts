import { SleeperService, type SleeperLeague } from '@/services/sleeper/sleeperService';
import { countableWeeks } from '@/services/stats/expectedWins';
import { buildScheduleSwap, toSwapWeek, type ScheduleSwapResponse, type SwapWeek } from '@/lib/betting/scheduleSwap';

/**
 * The schedule-swap matrix for a league season, for the /schedules JSON route and its picture
 * alike, so the image and the text fallback beside it are one computation.
 *
 * Straight from Sleeper's matchups over the same weeks /luck counts (countableWeeks): regular
 * season, finished weeks only. Like /luck, any league id is accepted — it is public schedule and
 * score data with no money near it.
 *
 * `season` walks the league's previous_league_id chain, since Sleeper gives every season its own
 * league id. Omitted, it is the season of the league asked for.
 */
export type ScheduleLoad =
  | { status: 200; body: ScheduleSwapResponse }
  | { status: 400 | 404 | 502; body: { ok: false; error: string } };

export async function loadScheduleSwap(
  leagueId: string | null | undefined,
  season?: string | null,
): Promise<ScheduleLoad> {
  if (!leagueId) return { status: 400, body: { ok: false, error: 'leagueId is required.' } };

  let league: SleeperLeague | null = await SleeperService.getLeague(leagueId);
  if (!league) return { status: 404, body: { ok: false, error: 'Sleeper does not know that league.' } };
  if (season && season !== league.season) {
    const history = await SleeperService.getLeagueHistory(leagueId);
    league = history.find(l => l.season === season) ?? null;
    if (!league) return { status: 404, body: { ok: false, error: `That league has no ${season} season on Sleeper.` } };
  }

  try {
    const [rosters, users, weekNumbers] = await Promise.all([
      SleeperService.getRosters(league.league_id),
      SleeperService.getLeagueUsers(league.league_id),
      countableWeeks(league),
    ]);

    const weeks: SwapWeek[] = [];
    // In chunks, as analyzeLeague does, so a full season is not 17 requests at once.
    for (let i = 0; i < weekNumbers.length; i += 4) {
      const chunk = await Promise.all(
        weekNumbers.slice(i, i + 4).map(async w => toSwapWeek(w, await SleeperService.getMatchups(league!.league_id, w))),
      );
      for (const wk of chunk) if (wk) weeks.push(wk);
    }
    if (weeks.length === 0) {
      return {
        status: 404,
        body: { ok: false, error: 'No completed head-to-head weeks yet — or this league has no opponents to swap.' },
      };
    }

    const userById = new Map(users.map(u => [u.user_id, u]));
    const managers = rosters.map(r => {
      const u = r.owner_id ? userById.get(r.owner_id) : undefined;
      return {
        rosterId: r.roster_id,
        name: u?.display_name || `Team ${r.roster_id}`,
        teamName: u?.metadata?.team_name ?? null,
      };
    });

    return {
      status: 200,
      body: buildScheduleSwap({ leagueId: league.league_id, name: league.name, season: league.season }, managers, weeks),
    };
  } catch (err) {
    return {
      status: 502,
      body: { ok: false, error: err instanceof Error ? err.message : 'Could not build that schedule matrix.' },
    };
  }
}
