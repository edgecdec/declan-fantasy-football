import { SleeperService, SleeperLeague, SleeperRoster } from '@/services/sleeper/sleeperService';
import { CacheService } from '@/services/common/cacheService';
import { completedWeekCount, getNflStateOrFallback } from '@/services/common/seasonService';

export type TeamStats = {
  rosterId: number;
  ownerId: string;
  name: string;
  teamName?: string;
  avatar: string;
  actualWins: number;
  expectedWins: number;
  pointsFor: number;
  pointsAgainst: number;
  totalOpportunities: number;
};

export type LeagueAnalysisResult = {
  standings: TeamStats[];
  userStats?: TeamStats;
  /**
   * How many weeks actually went into these figures.
   *
   * Reported because the numbers mean very different things at week 2 and week 12, and nothing on
   * the page said which you were looking at. Half a win of "luck" over one week is noise; over
   * twelve it is a real story.
   */
  weeksCounted: number;
};

export async function analyzeLeague(league: SleeperLeague, userId?: string): Promise<LeagueAnalysisResult> {
  const cacheKey = `analysis_luck_${league.league_id}_${userId || 'global'}`;
  const cached = CacheService.get<LeagueAnalysisResult>(cacheKey, 'local');
  if (cached) return cached;

  // 1. Fetch Rosters & Users
  const [rostersRes, usersRes] = await Promise.all([
    fetch(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`),
    fetch(`https://api.sleeper.app/v1/league/${league.league_id}/users`)
  ]);
  
  if (!rostersRes.ok || !usersRes.ok) {
    throw new Error('Failed to fetch league data');
  }

  const rosters: SleeperRoster[] = await rostersRes.json();
  const users: any[] = await usersRes.json();

  const rosterMap = new Map<number, TeamStats>();
  let myRosterId = -1;

  // 2. Initialize Stats from Rosters
  rosters.forEach(r => {
    if (userId && r.owner_id === userId) myRosterId = r.roster_id;
    const owner = users.find((u: any) => u.user_id === r.owner_id);
    rosterMap.set(r.roster_id, {
      rosterId: r.roster_id,
      ownerId: r.owner_id,
      name: owner?.display_name || `Team ${r.roster_id}`,
      teamName: owner?.metadata?.team_name,
      avatar: owner?.avatar || '',
      actualWins: r.settings.wins,
      expectedWins: 0,
      pointsFor: r.settings.fpts + (r.settings.fpts_decimal || 0) / 100,
      pointsAgainst: 0,
      totalOpportunities: 0 // Set later
    });
  });

  // 3. Determine Schedule
  const startWeek = league.settings.start_week || 1;
  const playoffStart = league.settings.playoff_week_start;
  const settingsEndWeek = (playoffStart === 0) ? 18 : (playoffStart || 15) - 1;

  /*
   * Bounded by the weeks that have actually finished, matching every other week-looping service
   * here — this was the one that never got that guard.
   *
   * It rules out the IN-PROGRESS week as well as the future ones, which the points-total check below
   * cannot: mid-slate a live week has partial scores, so it would pass as played and every all-play
   * record would be computed against teams whose players had not kicked off yet.
   */
  const nflState = await getNflStateOrFallback();
  const playedWeeks = completedWeekCount(nflState, league.season, league.settings.last_scored_leg);
  const endWeek = Math.min(settingsEndWeek, playedWeeks);
  const useMedian = league.settings.league_average_match === 1;

  const weeks: number[] = [];
  if (endWeek >= startWeek) {
    for (let w = startWeek; w <= endWeek; w++) {
      weeks.push(w);
    }
  }

  // 4. Calculate Total Opportunities (Initialize to 0, will increment based on valid weeks)
  // rosterMap.forEach(t => t.totalOpportunities = 0); // Already set in step 2

  // 5. Fetch Matchups & Calculate Expected Wins
  // Process in chunks to avoid rate limits
  for (let i = 0; i < weeks.length; i += 4) {
      const chunk = weeks.slice(i, i + 4);
      await Promise.all(chunk.map(async (week) => {
          const matchups = await SleeperService.getMatchups(league.league_id, week);
          if (!matchups || matchups.length < 2) return;
          const validMatchups = matchups.filter(m => m.points !== undefined && m.points !== null);
          if (validMatchups.length < 2) return;

          /*
           * A week nobody has played yet is not a week.
           *
           * Sleeper returns a full set of matchups for the WHOLE season from day one, with
           * `points: 0` on every future week. `points !== null` therefore passes for all of them,
           * and every unplayed week was being counted: each team ties everyone at 0, so
           * `points === points` scores half a win against each opponent and the week hands out
           * exactly 0.5 expected wins to all ten teams plus an opportunity.
           *
           * Measured on a real league in week 2: 12 phantom weeks, +6.0 expected wins for every
           * team and +12 opportunities. Luck is actual minus expected, so mid-season it read as
           * though everyone had been catastrophically unlucky.
           *
           * Detected by the week's own total rather than by the calendar, so it needs no extra call
           * and stays correct for a league that starts late or has an unusual schedule. A week in
           * which every team genuinely scored zero is indistinguishable from an unplayed one, and
           * cannot happen in practice.
           */
          const weekTotal = validMatchups.reduce((sum, m) => sum + m.points, 0);
          if (weekTotal <= 0) return;

          // Increment opportunities for all teams since this was a valid week
          const weekOpps = useMedian ? 2 : 1;
          rosterMap.forEach(t => t.totalOpportunities += weekOpps);

          const sortedByScore = [...validMatchups].sort((a, b) => b.points - a.points);
          const medianCutoffIndex = Math.floor(validMatchups.length / 2);
          const medianThreshold = sortedByScore[medianCutoffIndex - 1]?.points || 0;

          validMatchups.forEach(m1 => {
              const opponent = validMatchups.find(m2 => m2.matchup_id === m1.matchup_id && m2.roster_id !== m1.roster_id);
              const t = rosterMap.get(m1.roster_id);
              if (t && opponent) {
                  t.pointsAgainst += opponent.points;
              }

              let wins = 0;
              validMatchups.forEach(m2 => {
                  if (m1.roster_id === m2.roster_id) return;
                  if (m1.points > m2.points) wins += 1;
                  if (m1.points === m2.points) wins += 0.5;
              });
              const h2hEw = wins / (validMatchups.length - 1);
              
              let medianEw = 0;
              if (useMedian && m1.points >= medianThreshold && m1.points > 0) medianEw = 1;

              if (t) t.expectedWins += (h2hEw + medianEw);
          });
      }));
  }

  const standings = Array.from(rosterMap.values()).sort((a, b) => b.expectedWins - a.expectedWins);
  const myStats = rosterMap.get(myRosterId);

  // Exclude teams with 0 total points (test leagues or leagues with no real games)
  const validUserStats = myStats && myStats.pointsFor > 0 ? myStats : undefined;

  // Counted from the weeks that survived the played-week guard, so it can never disagree with the
  // figures it describes.
  const weekOppsPerWeek = useMedian ? 2 : 1;
  const weeksCounted = standings.length > 0
    ? Math.round((standings[0].totalOpportunities || 0) / weekOppsPerWeek)
    : 0;

  const result = {
    standings,
    userStats: validUserStats,
    weeksCounted,
  };

  // Cache results: Long-lived for complete leagues, short-lived for active ones
  const ttl = league.status === 'complete' ? 1000 * 60 * 60 * 24 * 7 : 1000 * 60 * 15;
  CacheService.set(cacheKey, result, { storage: 'local', ttl });

  return result;
}
