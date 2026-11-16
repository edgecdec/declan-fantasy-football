import { LEAGUE_MEAN_SCORE, type TeamState, type WeekPairings } from '@/lib/betting/seasonSim';

/**
 * Everything simulateSeason needs about a league right now: each team's record and scoring, the
 * live week's partial state, and the real remaining schedule.
 *
 * Shared by the site's season-odds (betting leagues, live week from the pricing pass) and the
 * bot's /playoffs (any league, live week from the read-only matchup builder), so the two cannot
 * model the same league differently. Moved here from season-odds/route.ts unchanged; the only
 * new part is `liveWeek`, the seam where the two differ.
 */

const SLEEPER_BASE = 'https://api.sleeper.app/v1';
export const DEFAULT_PLAYOFF_TEAMS = 6;
export const DEFAULT_PLAYOFF_WEEK_START = 15;

async function j<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

type RosterLite = {
  roster_id: number;
  owner_id: string | null;
  settings: {
    wins?: number; losses?: number; ties?: number;
    fpts?: number; fpts_decimal?: number;
    waiver_budget_used?: number;
    division?: number;
  };
};
type MatchupLite = { roster_id: number; matchup_id: number | null; points: number | null };

export type LeagueLite = {
  league_id?: string;
  name?: string;
  season: string;
  status?: string;
  settings: Record<string, number>;
  total_rosters: number;
};

/** One side of the live week: points banked, the expected final, and the spread of what is left. */
export type LiveSide = { rosterId: number; banked: number; projected: number; sd: number };

/** The live week as the caller models it: every side, and who plays whom. */
export type LiveWeek = { sides: LiveSide[]; pairs: [number, number][] };

export type SeasonState = {
  league: LeagueLite;
  currentWeek: number;
  playoffWeekStart: number;
  playoffTeams: number;
  lastRegularWeek: number;
  teams: TeamState[];
  remainingSchedule: WeekPairings;
  currentWeekPairs: [number, number][];
  leagueMeanScore: number;
  leagueMeanProjection: number;
  /** Division by roster, when the league has divisions (Sleeper numbers them from 1). */
  divisions: Map<number, number> | null;
  /** The league also plays the weekly median (league_average_match). */
  medianGame: boolean;
};

export type SeasonStateResult = { ok: true; state: SeasonState } | { ok: false; status: number; error: string };

export async function loadSeasonState(
  leagueId: string,
  liveWeek: (week: number) => Promise<LiveWeek>,
): Promise<SeasonStateResult> {
  const [league, rosters, users, state] = await Promise.all([
    j<LeagueLite>(`${SLEEPER_BASE}/league/${leagueId}`),
    j<RosterLite[]>(`${SLEEPER_BASE}/league/${leagueId}/rosters`),
    j<{ user_id: string; display_name: string }[]>(`${SLEEPER_BASE}/league/${leagueId}/users`),
    j<{ week: number; season_type: string }>(`${SLEEPER_BASE}/state/nfl`),
  ]);
  if (!state) return { ok: false, status: 502, error: 'Could not reach Sleeper.' };
  // Sleeper answers an unknown league id with a 200 and a null body, so null here means "no such
  // league", not "Sleeper is down" — the NFL state call above proves Sleeper is up.
  if (!league) return { ok: false, status: 404, error: 'Sleeper does not know that league.' };
  if (!rosters) return { ok: false, status: 502, error: 'Could not reach Sleeper.' };

  const currentWeek = Math.max(1, state.week);
  const playoffWeekStart = league.settings.playoff_week_start || DEFAULT_PLAYOFF_WEEK_START;
  const playoffTeams = league.settings.playoff_teams || DEFAULT_PLAYOFF_TEAMS;
  const lastRegularWeek = playoffWeekStart - 1;
  const faabBudget = league.settings.waiver_budget || 0;
  const nameByUser = new Map((users ?? []).map(u => [u.user_id, u.display_name]));

  // Live current week, for banked points and what is still to come.
  const live = await liveWeek(currentWeek);
  const liveByRoster = new Map<number, { banked: number; remainingMean: number; remainingSd: number }>();
  const currentWeekPairs: [number, number][] = live.pairs;
  for (const side of live.sides) {
    liveByRoster.set(side.rosterId, { banked: side.banked, remainingMean: side.projected - side.banked, remainingSd: side.sd });
  }

  // Observed scoring from weeks already finished, for the shrinkage blend.
  const observed = new Map<number, number[]>();
  const completedWeeks: number[] = [];
  for (let wk = 1; wk < currentWeek; wk++) completedWeeks.push(wk);
  const past = await Promise.all(
    completedWeeks.map(wk => j<MatchupLite[]>(`${SLEEPER_BASE}/league/${leagueId}/matchups/${wk}`)),
  );
  for (const wkRows of past) {
    for (const r of wkRows ?? []) {
      // A zero here means the week hasn't been scored, not that they scored nothing.
      if (r.points == null || r.points === 0) continue;
      const list = observed.get(r.roster_id) ?? [];
      list.push(r.points);
      observed.set(r.roster_id, list);
    }
  }

  // Real remaining schedule, after the live week.
  const futureWeeks: number[] = [];
  for (let wk = currentWeek + 1; wk <= lastRegularWeek; wk++) futureWeeks.push(wk);
  const futureRows = await Promise.all(
    futureWeeks.map(wk => j<MatchupLite[]>(`${SLEEPER_BASE}/league/${leagueId}/matchups/${wk}`)),
  );
  const remainingSchedule: WeekPairings = [];
  futureWeeks.forEach((wk, i) => {
    const pairs = new Map<number, number[]>();
    for (const r of futureRows[i] ?? []) {
      if (r.matchup_id == null) continue;
      const l = pairs.get(r.matchup_id) ?? [];
      l.push(r.roster_id);
      pairs.set(r.matchup_id, l);
    }
    const p: [number, number][] = [];
    for (const v of pairs.values()) if (v.length === 2) p.push([v[0], v[1]]);
    if (p.length > 0) remainingSchedule.push({ week: wk, pairs: p });
  });

  const projectedByRoster = new Map<number, number>();
  for (const side of live.sides) projectedByRoster.set(side.rosterId, side.projected);

  /*
   * Level anchor. Once games exist we use THIS season's observed mean rather than the
   * five-year average, because the league's scoring level swings a lot year to year
   * (121.0 to 136.4) and anchoring on the wrong level would shift every team's
   * displayed points-per-week by several points.
   */
  const observedAll = [...observed.values()].flat();
  const leagueMeanScore = observedAll.length > 0
    ? observedAll.reduce((a, b) => a + b, 0) / observedAll.length
    : LEAGUE_MEAN_SCORE;

  // The projection tilt is measured against the FIELD's mean projection, since
  // projections and actual scores sit on different scales.
  const projValues = rosters
    .map(r => projectedByRoster.get(r.roster_id))
    .filter((v): v is number => typeof v === 'number' && v > 0);
  const leagueMeanProjection = projValues.length > 0
    ? projValues.reduce((a, b) => a + b, 0) / projValues.length
    : leagueMeanScore;

  const teams: TeamState[] = rosters.map(r => {
    const obs = observed.get(r.roster_id) ?? [];
    const l = liveByRoster.get(r.roster_id);
    const used = r.settings.waiver_budget_used ?? 0;
    return {
      rosterId: r.roster_id,
      ownerId: r.owner_id,
      displayName: (r.owner_id && nameByUser.get(r.owner_id)) || `Roster ${r.roster_id}`,
      wins: r.settings.wins ?? 0,
      losses: r.settings.losses ?? 0,
      ties: r.settings.ties ?? 0,
      pointsFor: (r.settings.fpts ?? 0) + (r.settings.fpts_decimal ?? 0) / 100,
      projectedWeekMean: projectedByRoster.get(r.roster_id) ?? LEAGUE_MEAN_SCORE,
      observedWeekMean: obs.length > 0 ? obs.reduce((a, b) => a + b, 0) / obs.length : null,
      weeksPlayed: obs.length,
      faabRemaining: faabBudget > 0 ? Math.max(0, Math.min(1, 1 - used / faabBudget)) : 0.5,
      leagueMeanScore,
      leagueMeanProjection,
      currentBanked: l?.banked ?? 0,
      currentRemainingMean: l?.remainingMean ?? 0,
      currentRemainingSd: l?.remainingSd ?? 0,
    };
  });

  const divisionCount = league.settings.divisions ?? 0;
  const divisions = divisionCount > 0
    ? new Map(rosters.filter(r => r.settings.division).map(r => [r.roster_id, r.settings.division as number]))
    : null;

  return {
    ok: true,
    state: {
      league,
      currentWeek,
      playoffWeekStart,
      playoffTeams,
      lastRegularWeek,
      teams,
      remainingSchedule,
      currentWeekPairs,
      leagueMeanScore,
      leagueMeanProjection,
      divisions,
      medianGame: league.settings.league_average_match === 1,
    },
  };
}
