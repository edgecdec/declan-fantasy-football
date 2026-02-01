import { SleeperService, SleeperLeague, SleeperRoster } from '@/services/sleeper/sleeperService';

export type TeamStats = {
  rosterId: number;
  ownerId: string;
  name: string;
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
};

export async function analyzeLeague(league: SleeperLeague, userId?: string): Promise<LeagueAnalysisResult> {
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
      name: owner?.metadata?.team_name || owner?.display_name || `Team ${r.roster_id}`,
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
  const endWeek = (playoffStart === 0) ? 18 : (playoffStart || 15) - 1;
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

  return {
    standings,
    userStats: myStats
  };
}
