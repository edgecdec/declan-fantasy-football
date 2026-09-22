import { NextResponse } from 'next/server';
import { requireBot } from '@/lib/betting/botApi';
import { SleeperService } from '@/services/sleeper/sleeperService';
import { analyzeLeague } from '@/services/stats/expectedWins';

export const dynamic = 'force-dynamic';

/**
 * Expected wins against actual wins — how lucky a league has been.
 *
 * Deliberately NOT restricted to betting leagues, unlike every other /api/bot route. This is public
 * Sleeper data with no money anywhere near it: the schedule, the scores, and the arithmetic of "how
 * often would this team's weekly total have beaten a random opponent". Any league id is fair game,
 * which is what makes the command useful for a league that has no Declan Dollars at all.
 *
 * Reuses `analyzeLeague` rather than re-deriving the figures. Its shrinkage and its deliberate
 * exclusion of the in-progress week are exactly the parts that would be got wrong by a second
 * implementation — and a second implementation would then disagree with the website.
 */
export async function GET(request: Request) {
  const denied = requireBot(request);
  if (denied) return denied;

  const leagueId = new URL(request.url).searchParams.get('leagueId')?.trim();
  if (!leagueId) {
    return NextResponse.json({ ok: false, error: 'leagueId is required.' }, { status: 400 });
  }

  const league = await SleeperService.getLeague(leagueId);
  if (!league) {
    return NextResponse.json({ ok: false, error: 'Sleeper does not know that league.' }, { status: 404 });
  }

  try {
    const analysis = await analyzeLeague(league);
    return NextResponse.json({
      ok: true,
      league: { leagueId, name: league.name, season: league.season },
      weeksCounted: analysis.weeksCounted,
      /*
       * Ordered by EXPECTED wins, descending — a power ranking rather than a luck ranking.
       *
       * Sorting by luck put whoever had the flukiest fortnight on top, which reads as a leaderboard
       * of nothing: luck is noise by construction and reverts. Expected wins is the durable figure,
       * so the table now ranks teams by how good they have actually been and shows luck as the
       * deviation from it. Ties break on points scored, since two identical expectations are
       * genuinely separated by that.
       */
      teams: analysis.standings
        .map(t => ({
          name: t.name,
          teamName: t.teamName ?? null,
          actualWins: t.actualWins,
          expectedWins: t.expectedWins,
          luck: t.actualWins - t.expectedWins,
          pointsFor: t.pointsFor,
          pointsAgainst: t.pointsAgainst,
        }))
        .sort((a, b) => b.expectedWins - a.expectedWins || b.pointsFor - a.pointsFor),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Could not analyse that league.' },
      { status: 502 },
    );
  }
}
