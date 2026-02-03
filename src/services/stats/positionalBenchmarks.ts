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
  userId: string
): Promise<LeagueBenchmarkResult> {
  
  // 1. Determine Regular Season Weeks
  const startWeek = league.settings.start_week || 1;
  const playoffStart = league.settings.playoff_week_start;
  const endWeek = (playoffStart === 0) ? 18 : (playoffStart || 15) - 1;
  
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
  console.log(`[Benchmarks] League: ${league.name}, Teams: ${numTeams}, Weeks: ${weeks.length}`);
  console.log(`[Benchmarks] Players DB Size: ${Object.keys(players).length}`);

  // 3. Phase 1: Calculate League Weekly Averages
  // Map<WeekIndex, Map<Position, AvgScore>>
  const leagueWeeklyAvgs = new Map<number, Map<string, number>>();

  allWeeksMatchups.forEach((weekMatchups, weekIdx) => {
    const weekPosTotals = new Map<string, number>();
    
    // Sum points per position for the whole league this week
    weekMatchups.forEach(matchup => {
      const pointsArray = (matchup as any).starters_points;
      if (!pointsArray) return;

      matchup.starters?.forEach((playerId, index) => {
        let position = 'FLEX';
        const pData = players[playerId];
        if (pData) {
            position = pData.position;
        }
        
        if (!VALID_POSITIONS.includes(position)) return;

        const points = pointsArray[index] || 0;
        weekPosTotals.set(position, (weekPosTotals.get(position) || 0) + points);
      });
    });

    // Compute Average per Team (Total / NumTeams)
    const weekAvgs = new Map<string, number>();
    VALID_POSITIONS.forEach(pos => {
      const total = weekPosTotals.get(pos) || 0;
      // Note: This is "Average Output per Team", not "Average per Player"
      // If the league averages 25 RB points per team, and I scored 30, I am +5.
      weekAvgs.set(pos, total / (numTeams || 1));
    });
    leagueWeeklyAvgs.set(weekIdx, weekAvgs);
  });

  // 4. Phase 2: Process User's Roster for Stats & POLA
  const userPosStats = new Map<string, { points: number, count: number }>();
  const playerImpactMap = new Map<string, { totalPOLA: number, weeks: number, name: string, pos: string }>();

  VALID_POSITIONS.forEach(p => userPosStats.set(p, { points: 0, count: 0 }));

  allWeeksMatchups.forEach((weekMatchups, weekIdx) => {
    const myMatchup = weekMatchups.find(m => m.roster_id === myRosterId);
    if (!myMatchup || !myMatchup.starters) return;

    // Track which positions we have filled this week to subtract from league avg
    // Wait, comparing individual player to league average position total?
    // No, "Impact" is usually: (PlayerPoints - ReplacementLevel) or (PlayerPoints - LeagueAvgPerStarter).
    // The user asked: "output of a starter to the overall league average at that position".
    // If I start 2 RBs, and league average RBs score 12 pts/player.
    // RB1: 20 pts. Impact: +8.
    // RB2: 5 pts. Impact: -7.
    // Total RB Impact: +1.
    
    // So I need "League Average Points PER STARTER", not "Per Team".
    
    // Let's recalculate the baseline.
    // Baseline = TotalPointsForPos / TotalStartersForPos (in the league that week).
    
    // Re-calculating baseline...
    const weekAvgPerStarter = new Map<string, number>();
    const weekPosTotals = new Map<string, { points: number, count: number }>();
    
    weekMatchups.forEach(matchup => {
      const pointsArray = (matchup as any).starters_points;
      if (!pointsArray) return;

      matchup.starters?.forEach((playerId, index) => {
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

    // Now assess my players
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

  // 5. Aggregate League Season Averages (for the Charts)
  const leagueAgg = new Map<string, { points: number, count: number }>();
  // Re-looping simply to sum up totals for the season-long view
  allWeeksMatchups.forEach(weekMatchups => {
      weekMatchups.forEach(matchup => {
          const pointsArray = (matchup as any).starters_points;
          if (!pointsArray) return;

          matchup.starters?.forEach((playerId, index) => {
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
      gamesPlayed: weeks.length,
      avgPointsPerWeek: myS.points / (weeks.length || 1),
      avgPointsPerStarter: myS.count > 0 ? myS.points / myS.count : 0
    };

    // League
    const lAgg = leagueAgg.get(pos) || { points: 0, count: 0 };
    const avgTotalPointsPerTeam = lAgg.points / (numTeams || 1); // League Total / 12 teams
    leagueAverageStats[pos] = {
      position: pos,
      totalPoints: avgTotalPointsPerTeam,
      starterCount: lAgg.count / (numTeams || 1),
      gamesPlayed: weeks.length,
      avgPointsPerWeek: avgTotalPointsPerTeam / (weeks.length || 1),
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
  })).sort((a, b) => b.totalPOLA - a.totalPOLA); // Sort by highest impact first

  return {
    leagueId: league.league_id,
    leagueName: league.name,
    userStats,
    leagueAverageStats,
    playerImpacts
  };
}