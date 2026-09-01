import { SleeperService, SleeperLeague, SleeperMatchup } from '@/services/sleeper/sleeperService';
import { CacheService } from '@/services/common/cacheService';
import { completedWeekCount, getNflStateOrFallback } from '@/services/common/seasonService';
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
  totalPOLA: number;
  weeksStarted: number;
  avgPOLA: number;
  ownerId: string;
  ownerName: string;
  startedWeeks: Record<string, number[]>;
};

export type LeagueBenchmarkResult = {
  leagueId: string;
  leagueName: string;
  userStats: Record<string, PositionStats>; 
  leagueAverageStats: Record<string, PositionStats>; 
  playerImpacts: PlayerImpact[];
  // New Fields for League Heatmap
  allRosterStats: Record<string, Record<string, PositionStats>>; // userId -> Position -> Stats
  rosterMeta: Record<string, { userId: string, displayName: string, avatar: string, teamName?: string }>;
};

const VALID_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

export async function analyzePositionalBenchmarks(
  league: SleeperLeague,
  userId: string,
  includePlayoffs: boolean = true
): Promise<LeagueBenchmarkResult | null> {
  const cacheKey = `analysis_positional_${league.league_id}_${userId}_${includePlayoffs}`;
  const cached = CacheService.get<LeagueBenchmarkResult>(cacheKey, 'local');
  if (cached) return cached;

  // 1. Determine Weeks to Analyze
  const startWeek = league.settings.start_week || 1;
  const playoffStart = league.settings.playoff_week_start || 15;
  const lastScoredLeg = league.settings.last_scored_leg || 18;

  const settingsEndWeek = includePlayoffs ? lastScoredLeg : (playoffStart - 1);

  // Clamp to weeks that have actually been scored. Sleeper returns a full
  // matchup row for future weeks with the current roster in the starter slots,
  // so without this every rostered player is credited with a start in every
  // remaining week of the season — and `last_scored_leg` is absent before a
  // season scores, making the `|| 18` above invent 18 of them.
  const nflState = await getNflStateOrFallback();
  const playedWeeks = completedWeekCount(nflState, league.season, league.settings.last_scored_leg);
  const endWeek = Math.min(settingsEndWeek, playedWeeks);

  const weeks: number[] = [];
  if (endWeek >= startWeek) {
    for (let w = startWeek; w <= endWeek; w++) {
      weeks.push(w);
    }
  }

  // Nothing scored yet: report no data rather than a grid of zeroes.
  if (weeks.length === 0) return null;

  // 2. Fetch All Matchups, Rosters & Users
  const [allWeeksMatchups, rostersRes, usersRes] = await Promise.all([
    Promise.all(weeks.map(w => SleeperService.getMatchups(league.league_id, w))),
    fetch(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`),
    fetch(`https://api.sleeper.app/v1/league/${league.league_id}/users`)
  ]);
  
  const rostersData = await rostersRes.json();
  const usersData = await usersRes.json();

  // Skip league if user scored 0 total points (test league or season never played)
  const userRoster = rostersData.find((r: any) => r.owner_id === userId);
  if (userRoster && SleeperService.isZeroPointRoster(userRoster)) return null;
  
  // Map RosterID -> UserID and Meta
  const rosterToUser = new Map<number, string>();
  const userMeta = new Map<string, { userId: string, displayName: string, avatar: string, teamName?: string }>();
  
  rostersData.forEach((r: any) => {
    if (r.owner_id) {
      rosterToUser.set(r.roster_id, r.owner_id);
      const u = usersData.find((x: any) => x.user_id === r.owner_id);
      if (u) {
        userMeta.set(r.owner_id, {
          userId: r.owner_id,
          displayName: u.display_name,
          avatar: u.avatar,
          teamName: u.metadata?.team_name
        });
      }
    }
  });

  const numTeams = rostersData.length;
  const players = (playerData as any).players;

  // 3. Phase 1: Calculate League Weekly Averages (Same as before)
  const leagueWeeklyAvgs = new Map<number, Map<string, number>>();

  allWeeksMatchups.forEach((weekMatchups, weekIdx) => {
    const weekPosTotals = new Map<string, number>();
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
        weekPosTotals.set(position, (weekPosTotals.get(position) || 0) + points);
      });
    });

    const weekAvgs = new Map<string, number>();
    VALID_POSITIONS.forEach(pos => {
      const total = weekPosTotals.get(pos) || 0;
      weekAvgs.set(pos, total / (activeRostersThisWeek || 1));
    });
    leagueWeeklyAvgs.set(weekIdx, weekAvgs);
  });

  // 4. Phase 2: Process ALL Rosters for Stats
  // Map<UserId, Map<Position, { points, count }>>
  const allUserStatsMap = new Map<string, Map<string, { points: number, count: number }>>();
  // Initialize
  userMeta.forEach((_, uid) => {
    const m = new Map<string, { points: number, count: number }>();
    VALID_POSITIONS.forEach(p => m.set(p, { points: 0, count: 0 }));
    allUserStatsMap.set(uid, m);
  });

  // Map<UserId, weeksPlayed>
  const userWeeksPlayed = new Map<string, number>();

  // Player Impacts (For everyone now)
  // Key: `${userId}_${playerId}`
  const allPlayerImpactMap = new Map<string, { 
    totalPOLA: number, 
    weeks: number, 
    name: string, 
    pos: string, 
    ownerId: string,
    startedWeeks: Record<string, number[]> 
  }>();

  allWeeksMatchups.forEach((weekMatchups, weekIdx) => {
    const currentWeek = weeks[weekIdx]; // Get actual week number
    
    // Pre-calculate baseline per starter for this week (Efficiency)
    const weekAvgPerStarter = new Map<string, number>();
    const weekPosTotals = new Map<string, { points: number, count: number }>();
    
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

    // Now process every matchup for User Stats
    weekMatchups.forEach(matchup => {
        const uid = rosterToUser.get(matchup.roster_id);
        if (!uid) return;
        
        // Check active status
        if (!matchup.starters || matchup.starters.length === 0) return;
        if (!matchup.matchup_id && matchup.points === 0) return;

        userWeeksPlayed.set(uid, (userWeeksPlayed.get(uid) || 0) + 1);

        const pointsArray = (matchup as any).starters_points;
        if (!pointsArray) return;

        const uStats = allUserStatsMap.get(uid);
        if (!uStats) return;

        matchup.starters.forEach((playerId, index) => {
            let position = 'FLEX';
            const pData = players[playerId];
            if (pData) position = pData.position;
            if (!VALID_POSITIONS.includes(position)) return;

            const points = pointsArray[index] || 0;
            
            // Update User Stats
            const posStats = uStats.get(position)!;
            posStats.points += points;
            posStats.count += 1;

            // Update Player Impact
            const baseline = weekAvgPerStarter.get(position) || 0;
            const impact = points - baseline;
            
            const key = `${uid}_${playerId}`;
            const pImpact = allPlayerImpactMap.get(key) || { 
                totalPOLA: 0, 
                weeks: 0, 
                name: pData ? `${pData.first_name} ${pData.last_name}` : 'Unknown',
                pos: position,
                ownerId: uid,
                startedWeeks: {}
            };
            
            pImpact.totalPOLA += impact;
            pImpact.weeks += 1;
            
            // Track specific week
            if (!pImpact.startedWeeks[league.season]) {
                pImpact.startedWeeks[league.season] = [];
            }
            pImpact.startedWeeks[league.season].push(currentWeek);
            
            allPlayerImpactMap.set(key, pImpact);
        });
    });
  });

  // 5. Aggregate League Season Averages (Weighted)
  const leagueAgg = new Map<string, { points: number, count: number }>();
  let totalLeagueActiveWeeks = 0;

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
  const allRosterStats: Record<string, Record<string, PositionStats>> = {};
  
  allUserStatsMap.forEach((uStatsMap, uid) => {
      const stats: Record<string, PositionStats> = {};
      const weeksPlayed = userWeeksPlayed.get(uid) || 0;
      
      VALID_POSITIONS.forEach(pos => {
          const myS = uStatsMap.get(pos)!;
          stats[pos] = {
              position: pos,
              totalPoints: myS.points,
              starterCount: myS.count,
              gamesPlayed: weeksPlayed,
              avgPointsPerWeek: myS.points / (weeksPlayed || 1),
              avgPointsPerStarter: myS.count > 0 ? myS.points / myS.count : 0
          };
      });
      allRosterStats[uid] = stats;
  });

  const leagueAverageStats: Record<string, PositionStats> = {};
  // For the requested user, we normalize league stats to their games played
  const myWeeks = userWeeksPlayed.get(userId) || 0;

  VALID_POSITIONS.forEach(pos => {
    const lAgg = leagueAgg.get(pos) || { points: 0, count: 0 };
    const avgTotalPointsPerTeamWeek = lAgg.points / (totalLeagueActiveWeeks || 1); 
    
    leagueAverageStats[pos] = {
      position: pos,
      totalPoints: avgTotalPointsPerTeamWeek * (myWeeks || 1),
      starterCount: lAgg.count / (totalLeagueActiveWeeks || 1),
      gamesPlayed: myWeeks,
      avgPointsPerWeek: avgTotalPointsPerTeamWeek,
      avgPointsPerStarter: lAgg.count > 0 ? lAgg.points / lAgg.count : 0
    };
  });

  const playerImpacts: PlayerImpact[] = Array.from(allPlayerImpactMap.entries()).map(([key, val]) => {
      // Split key back if needed, but we stored data in val
      const ownerMeta = userMeta.get(val.ownerId);
      return {
          playerId: key.split('_')[1], // Original playerId
          name: val.name,
          position: val.pos,
          totalPOLA: val.totalPOLA,
          weeksStarted: val.weeks,
          avgPOLA: val.totalPOLA / val.weeks,
          ownerId: val.ownerId,
          ownerName: ownerMeta?.displayName || 'Unknown',
          startedWeeks: val.startedWeeks
      };
  }).sort((a, b) => b.totalPOLA - a.totalPOLA); 

  const result = {
    leagueId: league.league_id,
    leagueName: league.name,
    userStats: allRosterStats[userId] || {}, // Fallback if user not found
    leagueAverageStats,
    playerImpacts,
    allRosterStats,
    rosterMeta: Object.fromEntries(userMeta)
  };

  // Cache results
  const ttl = league.status === 'complete' ? 1000 * 60 * 60 * 24 * 7 : 1000 * 60 * 15;
  CacheService.set(cacheKey, result, { storage: 'local', ttl });

  return result;
}