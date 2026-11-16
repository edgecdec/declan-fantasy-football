import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { findAccountById } from '@/lib/betting/accounts';
import { accountCanBetInLeague, findBettingLeague } from '@/lib/betting/leagues';
import { priceLeagueWeek } from '@/lib/betting/pricing';
import {
  TEAM_WEEK_SD, TRUE_SKILL_SD, MAX_FAAB_EDGE_POINTS, PROJECTION_PERSISTENCE, observedShrinkage, simulateSeason,
} from '@/lib/betting/seasonSim';
import { loadSeasonState } from '@/lib/betting/seasonState';

export const dynamic = 'force-dynamic';

const SIMS = 20_000;

/**
 * GET ?leagueId= — playoff and title odds from simulating the rest of the season.
 *
 * The live current week is fed in from its partial state so a game in progress
 * counts as far as it has actually gone, then the remaining weeks are played out on
 * the real Sleeper schedule. The team state is built by loadSeasonState, shared with
 * the bot's /playoffs; here the live week comes from the pricing pass, so the odds sit
 * on the same numbers as the markets.
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

  const loaded = await loadSeasonState(leagueId, async week => {
    const markets = await priceLeagueWeek(leagueId, week);
    return {
      sides: markets.flatMap(m => [
        { rosterId: m.rosterA, banked: m.pointsA, projected: m.projectedA, sd: m.sdA },
        { rosterId: m.rosterB, banked: m.pointsB, projected: m.projectedB, sd: m.sdB },
      ]),
      pairs: markets.map(m => [m.rosterA, m.rosterB] as [number, number]),
    };
  });
  if (!loaded.ok) return NextResponse.json({ ok: false, error: loaded.error }, { status: loaded.status });
  const {
    teams, remainingSchedule, currentWeekPairs, playoffTeams, currentWeek, lastRegularWeek,
    leagueMeanScore, leagueMeanProjection,
  } = loaded.state;

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
      trueSkillSd: TRUE_SKILL_SD,
      leagueMeanScore,
      leagueMeanProjection,
      // How much of an observed edge we are currently carrying forward, and how much
      // of the preseason projection — both surfaced so the UI can be honest about it.
      observedShrinkage: observedShrinkage(
        Math.max(0, ...teams.map(t => t.weeksPlayed)),
      ),
      projectionPersistence: PROJECTION_PERSISTENCE,
      maxFaabEdgePoints: MAX_FAAB_EDGE_POINTS,
    },
    results,
  });
}
