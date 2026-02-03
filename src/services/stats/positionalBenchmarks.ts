import { SleeperService, SleeperLeague, SleeperMatchup } from '@/services/sleeper/sleeperService';
import playerData from '../../../data/sleeper_players.json';

// Types
export type PositionStats = {
  position: string;
  totalPoints: number;
  starterCount: number;
  gamesPlayed: number; 
  avgPointsPerWeek: number;
  avgPointsPerStarter: number;
};

export type PlayerImpact = {
  playerId: string;
  name: string;
  position: string;
  totalPOLA: number; // Points Over League Average
  weeksStarted: number;
  avgPOLA: number;
};

export type LeagueBenchmarkResult = {
  leagueId: string;
  leagueName: string;
  userStats: Record<string, PositionStats>; 
  leagueAverageStats: Record<string, PositionStats>; 
  playerImpacts: PlayerImpact[];
};

const VALID_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

export async function analyzePositionalBenchmarks(
  league: SleeperLeague,
  userId: string,
  includePlayoffs: boolean = true
): Promise<LeagueBenchmarkResult> {
  
  // 1. Determine Weeks to Analyze
  const startWeek = league.settings.start_week || 1;
  const playoffStart = league.settings.playoff_week_start || 15;
  const lastScoredLeg = league.settings.last_scored_leg || 18; // Default to 18 if undefined/ongoing
  
  const endWeek = includePlayoffs ? lastScoredLeg : (playoffStart - 1);
  
  const weeks: number[] = [];
  if (endWeek >= startWeek) {
    for (let w = startWeek; w <= endWeek; w++) {
      weeks.push(w);
    }
  }

  // 2. Fetch All Matchups & Rosters
  const [allWeeksMatchups, rostersRes] = await Promise.all([
    Promise.all(weeks.map(w => SleeperService.getMatchups(league.league_id, w))),
    fetch(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`)
  ]);
  
  const rostersData = await rostersRes.json();
  const myRoster = rostersData.find((r: any) => r.owner_id === userId);
  if (!myRoster) throw new Error('User not in league');
  const myRosterId = myRoster.roster_id;
  const numTeams = rostersData.length;

  const players = (playerData as any).players;

  // 3. Phase 1: Calculate League Weekly Averages
  // Map<WeekIndex, Map<Position, AvgScore>>
  const leagueWeeklyAvgs = new Map<number, Map<string, number>>();

  allWeeksMatchups.forEach((weekMatchups, weekIdx) => {
    const weekPosTotals = new Map<string, number>();
    
    // In playoffs, only count active teams (teams with a valid matchup_id)
    // In regular season, usually everyone has a matchup_id.
    // Exception: Bye weeks in playoffs (matchup_id might be null or special).
    // Sleeper: Consolation bracket teams also have matchup_ids.
    // If a team is eliminated and NOT in consolation, they might not have matchup_id.
    
    // We will count how many rosters actually contributed to the stats this week
    // to calculate the correct average.
    let activeRostersThisWeek = 0;

    weekMatchups.forEach(matchup => {
      // Filter out empty/invalid matchups
      // Valid if they have starters AND (matchup_id exists OR points > 0)
      if (!matchup.starters || matchup.starters.length === 0) return;
      if (!matchup.matchup_id && matchup.points === 0) return; 

      activeRostersThisWeek++;

      const pointsArray = (matchup as any).starters_points;
      if (!pointsArray) return;

      matchup.starters.forEach((playerId, index) => {
        let position = 'FLEX';
        const pData = players[playerId];
        if (pData) position = pData.position;
        if (!VALID_POSITIONS.includes(position)) return;

        const points = pointsArray[index] || 0;
        weekPosTotals.set(position, (weekPosTotals.get(position) || 0) + points);
      });
    });

    // Compute Average per ACTIVE Team
    const weekAvgs = new Map<string, number>();
    VALID_POSITIONS.forEach(pos => {
      const total = weekPosTotals.get(pos) || 0;
      // Use active count for divisor, min 1
      weekAvgs.set(pos, total / (activeRostersThisWeek || 1));
    });
    leagueWeeklyAvgs.set(weekIdx, weekAvgs);
  });

  // 4. Phase 2: Process User's Roster for Stats & POLA
  const userPosStats = new Map<string, { points: number, count: number }>();
  const playerImpactMap = new Map<string, { totalPOLA: number, weeks: number, name: string, pos: string }>();

  VALID_POSITIONS.forEach(p => userPosStats.set(p, { points: 0, count: 0 }));

  let myWeeksPlayed = 0;

  allWeeksMatchups.forEach((weekMatchups, weekIdx) => {
    const myMatchup = weekMatchups.find(m => m.roster_id === myRosterId);
    
    // Check if I actually played this week
    if (!myMatchup || !myMatchup.starters || myMatchup.starters.length === 0) return;
    if (!myMatchup.matchup_id && myMatchup.points === 0) return;

    myWeeksPlayed++;

    // Re-calculate baseline per starter for this week (Efficiency comparison)
    const weekAvgPerStarter = new Map<string, number>();
    const weekPosTotals = new Map<string, { points: number, count: number }>();
    
    // Need to filter active rosters again for consistency
    weekMatchups.forEach(matchup => {
      if (!matchup.starters || matchup.starters.length === 0) return;
      if (!matchup.matchup_id && matchup.points === 0) return;

      const pointsArray = (matchup as any).starters_points;
      if (!pointsArray) return;

      matchup.starters.forEach((playerId, index) => {
        let position = 'FLEX';
        const pData = players[playerId];
        if (pData) position = pData.position;
        if (!VALID_POSITIONS.includes(position)) return;

        const points = pointsArray[index] || 0;
        const curr = weekPosTotals.get(position) || { points: 0, count: 0 };
        curr.points += points;
        curr.count += 1;
        weekPosTotals.set(position, curr);
      });
    });

    weekPosTotals.forEach((val, pos) => {
        weekAvgPerStarter.set(pos, val.count > 0 ? val.points / val.count : 0);
    });

    // Assess my players
    const myPointsArray = (myMatchup as any).starters_points;
    if (myPointsArray) {
        myMatchup.starters.forEach((playerId, index) => {
            let position = 'FLEX';
            const pData = players[playerId];
            if (pData) position = pData.position;
            if (!VALID_POSITIONS.includes(position)) return;

            const points = myPointsArray[index] || 0;
            const baseline = weekAvgPerStarter.get(position) || 0;
            const impact = points - baseline;

            // Update User Position Stats
            const uPos = userPosStats.get(position)!;
            uPos.points += points;
            uPos.count += 1;

            // Update Player Impact
            const pImpact = playerImpactMap.get(playerId) || { 
                totalPOLA: 0, 
                weeks: 0, 
                name: pData ? `${pData.first_name} ${pData.last_name}` : 'Unknown',
                pos: position
            };
            pImpact.totalPOLA += impact;
            pImpact.weeks += 1;
            playerImpactMap.set(playerId, pImpact);
        });
    }
  });

  // 5. Aggregate League Season Averages (Weighted by Active Weeks)
  const leagueAgg = new Map<string, { points: number, count: number }>();
  let totalLeagueActiveWeeks = 0; // Denominator for per-week avg

  allWeeksMatchups.forEach(weekMatchups => {
      let activeRostersThisWeek = 0;
      weekMatchups.forEach(matchup => {
          if (!matchup.starters || matchup.starters.length === 0) return;
          if (!matchup.matchup_id && matchup.points === 0) return;
          
          activeRostersThisWeek++;

          const pointsArray = (matchup as any).starters_points;
          if (!pointsArray) return;

          matchup.starters.forEach((playerId, index) => {
              let position = 'FLEX';
              const pData = players[playerId];
              if (pData) position = pData.position;
              if (!VALID_POSITIONS.includes(position)) return;
              
              const points = pointsArray[index] || 0;
              const curr = leagueAgg.get(position) || { points: 0, count: 0 };
              curr.points += points;
              curr.count += 1;
              leagueAgg.set(position, curr);
          });
      });
      totalLeagueActiveWeeks += activeRostersThisWeek;
  });

  // 6. Format Output
  const userStats: Record<string, PositionStats> = {};
  const leagueAverageStats: Record<string, PositionStats> = {};

  VALID_POSITIONS.forEach(pos => {
    // User
    const myS = userPosStats.get(pos)!;
    userStats[pos] = {
      position: pos,
      totalPoints: myS.points,
      starterCount: myS.count,
      gamesPlayed: myWeeksPlayed, // Use actual active weeks
      avgPointsPerWeek: myS.points / (myWeeksPlayed || 1),
      avgPointsPerStarter: myS.count > 0 ? myS.points / myS.count : 0
    };

    // League
    const lAgg = leagueAgg.get(pos) || { points: 0, count: 0 };
    // Avg Points Per Week = Total Points / Total Active Roster-Weeks
    // Example: 12 teams * 14 weeks = 168 roster-weeks.
    // If playoff adds 4 teams * 1 week, total = 172.
    const avgTotalPointsPerTeamWeek = lAgg.points / (totalLeagueActiveWeeks || 1); 
    
    leagueAverageStats[pos] = {
      position: pos,
      totalPoints: avgTotalPointsPerTeamWeek * (myWeeksPlayed || 1), // Normalized to user's duration
      starterCount: lAgg.count / (totalLeagueActiveWeeks || 1),
      gamesPlayed: myWeeksPlayed, // Normalized comparison
      avgPointsPerWeek: avgTotalPointsPerTeamWeek,
      avgPointsPerStarter: lAgg.count > 0 ? lAgg.points / lAgg.count : 0
    };
  });

  const playerImpacts: PlayerImpact[] = Array.from(playerImpactMap.entries()).map(([pid, val]) => ({
      playerId: pid,
      name: val.name,
      position: val.pos,
      totalPOLA: val.totalPOLA,
      weeksStarted: val.weeks,
      avgPOLA: val.totalPOLA / val.weeks
  })).sort((a, b) => b.totalPOLA - a.totalPOLA); 

  return {
    leagueId: league.league_id,
    leagueName: league.name,
    userStats,
    leagueAverageStats,
    playerImpacts
  };
}
