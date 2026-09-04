import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { findAccountById } from '@/lib/betting/accounts';
import { accountCanBetInLeague, findBettingLeague } from '@/lib/betting/leagues';
import { priceLeagueWeek } from '@/lib/betting/pricing';
import {
  LEAGUE_MEAN_SCORE, PERSISTENCE, TEAM_WEEK_SD, MAX_FAAB_EDGE_POINTS,
  TeamState, WeekPairings, simulateSeason,
} from '@/lib/betting/seasonSim';

export const dynamic = 'force-dynamic';

const SLEEPER_BASE = 'https://api.sleeper.app/v1';
const SIMS = 20_000;
const DEFAULT_PLAYOFF_TEAMS = 6;
const DEFAULT_PLAYOFF_WEEK_START = 15;

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
  };
};
type MatchupLite = { roster_id: number; matchup_id: number | null; points: number | null };

/**
 * GET ?leagueId= — playoff and title odds from simulating the rest of the season.
 *
 * The live current week is fed in from its partial state so a game in progress
 * counts as far as it has actually gone, then the remaining weeks are played out on
 * the real Sleeper schedule.
 */
export async function GET(request: Request) {
  const auth = getAuthUser(request);
  if (!auth) return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  const account = findAccountById(auth.accountId);
  if (!account) return NextResponse.json({ ok: false, error: 'Account not found.' }, { status: 401 });

  const leagueId = new URL(request.url).searchParams.get('leagueId') ?? '';
  const cfg = findBettingLeague(leagueId);
  if (!cfg) return NextResponse.json({ ok: false, error: 'Not a betting league.' }, { status: 404 });
  if (!accountCanBetInLeague(account.id, leagueId)) {
    return NextResponse.json({ ok: false, error: 'You are not a member of this league.' }, { status: 403 });
  }

  const [league, rosters, users, state] = await Promise.all([
    j<{ season: string; settings: Record<string, number>; total_rosters: number }>(`${SLEEPER_BASE}/league/${leagueId}`),
    j<RosterLite[]>(`${SLEEPER_BASE}/league/${leagueId}/rosters`),
    j<{ user_id: string; display_name: string }[]>(`${SLEEPER_BASE}/league/${leagueId}/users`),
    j<{ week: number; season_type: string }>(`${SLEEPER_BASE}/state/nfl`),
  ]);
  if (!league || !rosters || !state) {
    return NextResponse.json({ ok: false, error: 'Could not reach Sleeper.' }, { status: 502 });
  }

  const currentWeek = Math.max(1, state.week);
  const playoffWeekStart = league.settings.playoff_week_start || DEFAULT_PLAYOFF_WEEK_START;
  const playoffTeams = league.settings.playoff_teams || DEFAULT_PLAYOFF_TEAMS;
  const lastRegularWeek = playoffWeekStart - 1;
  const faabBudget = league.settings.waiver_budget || 0;
  const nameByUser = new Map((users ?? []).map(u => [u.user_id, u.display_name]));

  // Live current week, for banked points and what is still to come.
  const markets = await priceLeagueWeek(leagueId, currentWeek);
  const live = new Map<number, { banked: number; remainingMean: number; remainingSd: number }>();
  const currentWeekPairs: [number, number][] = [];
  for (const m of markets) {
    live.set(m.rosterA, { banked: m.pointsA, remainingMean: m.projectedA - m.pointsA, remainingSd: m.sdA });
    live.set(m.rosterB, { banked: m.pointsB, remainingMean: m.projectedB - m.pointsB, remainingSd: m.sdB });
    currentWeekPairs.push([m.rosterA, m.rosterB]);
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
  for (const m of markets) {
    projectedByRoster.set(m.rosterA, m.projectedA);
    projectedByRoster.set(m.rosterB, m.projectedB);
  }

  const teams: TeamState[] = rosters.map(r => {
    const obs = observed.get(r.roster_id) ?? [];
    const l = live.get(r.roster_id);
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
      currentBanked: l?.banked ?? 0,
      currentRemainingMean: l?.remainingMean ?? 0,
      currentRemainingSd: l?.remainingSd ?? 0,
    };
  });

  const results = simulateSeason({
    teams,
    remainingSchedule,
    currentWeekLive: currentWeekPairs.length > 0,
    currentWeekPairs,
    playoffTeams,
    sims: SIMS,
    seed: 20260904,
  }).sort((a, b) => b.titleProb - a.titleProb);

  return NextResponse.json({
    ok: true,
    league: { leagueId, season: cfg.season, label: cfg.label },
    currentWeek,
    lastRegularWeek,
    playoffTeams,
    sims: SIMS,
    weeksRemaining: remainingSchedule.length + (currentWeekPairs.length > 0 ? 1 : 0),
    model: {
      teamWeekSd: TEAM_WEEK_SD,
      leagueMeanScore: LEAGUE_MEAN_SCORE,
      persistence: PERSISTENCE,
      maxFaabEdgePoints: MAX_FAAB_EDGE_POINTS,
    },
    results,
  });
}
