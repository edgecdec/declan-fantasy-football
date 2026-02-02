import { SleeperService, SleeperLeague, SleeperMatchup } from '@/services/sleeper/sleeperService';
import playerData from '../../../data/sleeper_players.json';

// Types
export type PositionStats = {
  position: string;
  totalPoints: number;
  starterCount: number;
  gamesPlayed: number; // In case of byes/zeros, but mainly just weeks * slots?
  // Derived
  avgPointsPerWeek: number;
  avgPointsPerStarter: number;
};

export type LeagueBenchmarkResult = {
  leagueId: string;
  leagueName: string;
  userStats: Record<string, PositionStats>; // Key: Position (QB, RB...)
  leagueAverageStats: Record<string, PositionStats>; // Key: Position
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

  // 2. Fetch All Matchups
  // We need matchups for ALL teams to calculate league average
  const allWeeksMatchups = await Promise.all(
    weeks.map(w => SleeperService.getMatchups(league.league_id, w))
  );

  // 3. Initialize Aggregators
  // Map<RosterID, Map<Position, { points, count }>>
  const rosterStats = new Map<number, Map<string, { points: number, count: number }>>();
  
  // Helper to get roster map
  const getRosterMap = (rid: number) => {
    if (!rosterStats.has(rid)) {
      rosterStats.set(rid, new Map(VALID_POSITIONS.map(p => [p, { points: 0, count: 0 }])));
    }
    return rosterStats.get(rid)!;
  };

  // 4. Process Matchups
  const players = (playerData as any).players;

  for (const weekMatchups of allWeeksMatchups) {
    if (!weekMatchups || weekMatchups.length === 0) continue;

    for (const matchup of weekMatchups) {
      if (!matchup.starters) continue;

      const rMap = getRosterMap(matchup.roster_id);

      matchup.starters.forEach((playerId, index) => {
        // Resolve Position
        let position = 'FLEX'; // Default/Fallback
        const pData = players[playerId];
        
        if (pData) {
          position = pData.position;
        } else if (parseInt(playerId) === 0) {
           return; // Empty slot
        } else if (isNaN(parseInt(playerId))) {
           // Defense IDs are strings like "NE", but usually in player DB.
           // If not found, assume DEF if it looks like a team abbr?
           // Sleeper DEF IDs are usually just the team abbreviation string in some contexts, 
           // but normally they are mapped in the player DB.
           // Let's stick to valid positions.
        }

        if (!VALID_POSITIONS.includes(position)) return;

        // Get points
        // starters_points is not always in the type definition but it exists in API
        // @ts-ignore
        const points = matchup.starters_points ? matchup.starters_points[index] : 0;

        const current = rMap.get(position)!;
        current.points += points;
        current.count += 1;
      });
    }
  }

  // 5. Identify User's Roster ID
  // We need to fetch rosters to map Owner ID -> Roster ID
  const rostersRes = await fetch(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`);
  const rostersData = await rostersRes.json();
  const myRoster = rostersData.find((r: any) => r.owner_id === userId);
  
  if (!myRoster) throw new Error('User not in league');
  const myRosterId = myRoster.roster_id;

  // 6. Aggregate League Averages
  const leagueAgg = new Map<string, { points: number, count: number, rosterCount: number }>();
  VALID_POSITIONS.forEach(p => leagueAgg.set(p, { points: 0, count: 0, rosterCount: 0 }));

  rosterStats.forEach((posMap, rid) => {
    posMap.forEach((stats, pos) => {
      const agg = leagueAgg.get(pos)!;
      agg.points += stats.points;
      agg.count += stats.count;
      agg.rosterCount++; // How many rosters contributed to this position? (Usually all 12)
    });
  });

  const numTeams = rostersData.length;
  const numWeeks = weeks.length;

  // 7. Format Output
  const userStats: Record<string, PositionStats> = {};
  const leagueAverageStats: Record<string, PositionStats> = {};

  const myMap = rosterStats.get(myRosterId);

  VALID_POSITIONS.forEach(pos => {
    // User
    const myS = myMap?.get(pos) || { points: 0, count: 0 };
    userStats[pos] = {
      position: pos,
      totalPoints: myS.points,
      starterCount: myS.count,
      gamesPlayed: numWeeks,
      avgPointsPerWeek: myS.points / (numWeeks || 1),
      avgPointsPerStarter: myS.count > 0 ? myS.points / myS.count : 0
    };

    // League Avg
    const lAgg = leagueAgg.get(pos)!;
    // Avg Points Per Week = Total League Points / (NumTeams * NumWeeks)
    // This gives "Average Team's Output Per Week"
    const avgTotalPoints = lAgg.points / (numTeams || 1);
    
    leagueAverageStats[pos] = {
      position: pos,
      totalPoints: avgTotalPoints, // This is actually Total Points PER TEAM across season
      starterCount: lAgg.count / (numTeams || 1),
      gamesPlayed: numWeeks,
      avgPointsPerWeek: avgTotalPoints / (numWeeks || 1),
      avgPointsPerStarter: lAgg.count > 0 ? lAgg.points / lAgg.count : 0
    };
  });

  return {
    leagueId: league.league_id,
    leagueName: league.name,
    userStats,
    leagueAverageStats
  };
}
