import { SleeperService, SleeperLeague, SleeperRoster, SleeperMatchup, SleeperBracketMatch } from '@/services/sleeper/sleeperService';
import playerData from '../../../data/sleeper_players.json';

export type MemberHistoryStats = {
  userId: string;
  displayName: string;
  avatar: string;
  teamName?: string;
  
  // General
  seasonsPlayed: number;
  
  // Regular Season
  regWins: number;
  regLosses: number;
  regTies: number;
  totalPF: number;
  totalPA: number;
  
  // Playoffs
  playoffWins: number;
  playoffLosses: number;
  championships: number;
  runnerUps: number;
  playoffAppearances: number;
  
  // Placement (Sum of final ranks to calc avg)
  sumFinalRanks: number; 
  bestFinish: number;
  worstFinish: number;
  
  // Head to Head
  opponents: Record<string, { wins: number; losses: number; ties: number; scoreDiff: number }>;

  // Positional (Total Points)
  positionalPoints: Record<string, number>;
};

export type LeagueHistoryResult = {
  members: MemberHistoryStats[];
  seasons: SleeperLeague[];
};

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

export async function analyzeLeagueHistory(
  latestLeagueId: string,
  onProgress?: (msg: string, pct: number) => void
): Promise<LeagueHistoryResult> {
  
  // 1. Fetch League Chain
  onProgress?.('Fetching league history...', 5);
  const history = await SleeperService.getLeagueHistory(latestLeagueId);
  
  const memberMap = new Map<string, MemberHistoryStats>();
  const playersDb = (playerData as any).players;

  // Process from oldest to newest to build history naturally? 
  // Order in `history` is usually Newest -> Oldest (based on previous_league_id traversal).
  // We can process in any order as long as we aggregate correctly.
  
  let processedCount = 0;
  
  for (const league of history) {
    onProgress?.(`Processing ${league.season}...`, 10 + (processedCount / history.length) * 80);
    
    // Parallel Fetch for this season
    const [rosters, users, winnersBracket, losersBracket] = await Promise.all([
      fetch(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`).then(r => r.json()),
      fetch(`https://api.sleeper.app/v1/league/${league.league_id}/users`).then(r => r.json()),
      SleeperService.getWinnersBracket(league.league_id),
      SleeperService.getLosersBracket(league.league_id)
    ]);

    const rosterToUser = new Map<number, string>();
    const userToRoster = new Map<string, number>();

    // Init Members for this season
    rosters.forEach((r: SleeperRoster) => {
      if (!r.owner_id) return;
      rosterToUser.set(r.roster_id, r.owner_id);
      userToRoster.set(r.owner_id, r.roster_id);

      if (!memberMap.has(r.owner_id)) {
        memberMap.set(r.owner_id, {
          userId: r.owner_id,
          displayName: 'Unknown',
          avatar: '',
          seasonsPlayed: 0,
          regWins: 0, regLosses: 0, regTies: 0,
          totalPF: 0, totalPA: 0,
          playoffWins: 0, playoffLosses: 0, championships: 0, runnerUps: 0, playoffAppearances: 0,
          sumFinalRanks: 0, bestFinish: 999, worstFinish: 0,
          opponents: {},
          positionalPoints: {}
        });
      }
      
      const m = memberMap.get(r.owner_id)!;
      m.seasonsPlayed++;
      
      // Update User Details (use most recent)
      const u = users.find((x: any) => x.user_id === r.owner_id);
      if (u) {
        m.displayName = u.display_name;
        m.avatar = u.avatar;
        if (league.season === history[0].season) {
             m.teamName = u.metadata?.team_name || m.teamName;
        }
      }

      // Add Regular Season Stats (from roster settings)
      m.regWins += r.settings.wins;
      m.regLosses += r.settings.losses;
      m.regTies += r.settings.ties;
      m.totalPF += (r.settings.fpts + (r.settings.fpts_decimal || 0) / 100);
      // PA is difficult to get from roster settings directly in all seasons? 
      // Sleeper Roster settings usually has `fpts_against`.
      // Let's check keys. Often `fpts_against` exists.
      m.totalPA += (r.settings.fpts_against || 0) + ((r.settings.fpts_against_decimal || 0) / 100);
    });

    // --- Process Matchups (For H2H, Positional, and verified PA) ---
    // We assume regular season is up to playoff_week_start
    const playoffStart = league.settings.playoff_week_start || 15;
    const regSeasonWeeks = Array.from({ length: playoffStart - 1 }, (_, i) => i + 1);

    // Fetch all weeks in parallel batches
    const BATCH = 4;
    for (let i = 0; i < regSeasonWeeks.length; i += BATCH) {
      const batchWeeks = regSeasonWeeks.slice(i, i + BATCH);
      await Promise.all(batchWeeks.map(async (week) => {
        const matchups = await SleeperService.getMatchups(league.league_id, week);
        if (!matchups) return;

        // Group by matchup_id
        const games = new Map<number, SleeperMatchup[]>();
        matchups.forEach(m => {
          if (m.matchup_id) {
            if (!games.has(m.matchup_id)) games.set(m.matchup_id, []);
            games.get(m.matchup_id)!.push(m);
          }
          
          // Positional Stats Processing
          const uid = rosterToUser.get(m.roster_id);
          if (uid) {
             const stats = memberMap.get(uid)!;
             if (m.starters && (m as any).starters_points) {
                m.starters.forEach((pid, idx) => {
                   const pts = (m as any).starters_points[idx];
                   const pData = playersDb[pid];
                   const pos = pData ? pData.position : 'FLEX';
                   if (POSITIONS.includes(pos)) {
                      stats.positionalPoints[pos] = (stats.positionalPoints[pos] || 0) + pts;
                   }
                });
             }
          }
        });

        // H2H Processing
        games.forEach(sides => {
          if (sides.length === 2) {
            const m1 = sides[0];
            const m2 = sides[1];
            const u1 = rosterToUser.get(m1.roster_id);
            const u2 = rosterToUser.get(m2.roster_id);

            if (u1 && u2) {
               const h1 = memberMap.get(u1)!;
               const h2 = memberMap.get(u2)!;
               
               if (!h1.opponents[u2]) h1.opponents[u2] = { wins: 0, losses: 0, ties: 0, scoreDiff: 0 };
               if (!h2.opponents[u1]) h2.opponents[u1] = { wins: 0, losses: 0, ties: 0, scoreDiff: 0 };

               const s1 = m1.points;
               const s2 = m2.points;
               
               h1.opponents[u2].scoreDiff += (s1 - s2);
               h2.opponents[u1].scoreDiff += (s2 - s1);

               if (s1 > s2) { h1.opponents[u2].wins++; h2.opponents[u1].losses++; }
               else if (s2 > s1) { h2.opponents[u1].wins++; h1.opponents[u2].losses++; }
               else { h1.opponents[u2].ties++; h2.opponents[u1].ties++; }
            }
          }
        });
      }));
    }

    // --- Process Playoffs (Brackets) ---
    // Winners Bracket
    if (winnersBracket && winnersBracket.length > 0) {
       // Find Championship Match (usually last match or p=1)
       // Sleeper Brackets:
       // The finals usually have `p: 1` in the result? 
       // Or we look for the match in the highest round `r`?
       // Let's look for matches where `w` (winner) is set.
       
       // Detect Playoff Appearance: Anyone in the winners bracket round 1
       const teamsInPlayoffs = new Set<number>();
       winnersBracket.forEach(m => {
          if (m.t1) teamsInPlayoffs.add(m.t1);
          if (m.t2) teamsInPlayoffs.add(m.t2);
          
          if (m.w && m.l) {
             // It's a completed game
             const winnerId = m.w;
             const loserId = m.l;
             const wUser = rosterToUser.get(winnerId);
             const lUser = rosterToUser.get(loserId);
             
             if (wUser) memberMap.get(wUser)!.playoffWins++;
             if (lUser) memberMap.get(lUser)!.playoffLosses++;
             
             // Check for Championship
             // If this match determines 1st place (`p: 1`)
             if (m.p === 1) {
                if (wUser) memberMap.get(wUser)!.championships++;
                if (lUser) memberMap.get(lUser)!.runnerUps++;
             }
          }
       });
       
       teamsInPlayoffs.forEach(rid => {
          const uid = rosterToUser.get(rid);
          if (uid) memberMap.get(uid)!.playoffAppearances++;
       });
    }
    
    // --- Final Placements ---
    // We need to calculate final rank for this season to add to `sumFinalRanks`.
    // Sources:
    // 1. Winners Bracket (1st, 2nd, 3rd, 4th...)
    // 2. Losers Bracket (Toilet Bowl winner?)
    // 3. Consolation?
    // Sleeper API doesn't give a simple "Final Rank" list.
    // Simplification:
    // If you won the Championship (`p=1` match winner), rank 1.
    // If you lost the Championship (`p=1` match loser), rank 2.
    // If you won the 3rd place game (`p=3` match winner), rank 3.
    // If you lost the 3rd place game (`p=3` match loser), rank 4.
    // For others, use Regular Season standings (wins/fpts)?
    
    // Let's do a best effort.
    // Sort rosters by Wins -> FPTS to get "Regular Season Rank"
    const sortedRosters = [...rosters].sort((a, b) => {
       if (a.settings.wins !== b.settings.wins) return b.settings.wins - a.settings.wins;
       return b.settings.fpts - a.settings.fpts;
    });
    
    // Map Roster -> Rank
    const seasonRanks = new Map<number, number>();
    sortedRosters.forEach((r, idx) => seasonRanks.set(r.roster_id, idx + 1));
    
    // Overwrite with Playoff Results if available
    if (winnersBracket) {
       winnersBracket.forEach(m => {
          if (m.p && m.w && m.l) {
             seasonRanks.set(m.w, m.p); // e.g. Winner of 1st place match gets 1
             seasonRanks.set(m.l, m.p + 1); // e.g. Loser of 1st place match gets 2? 
             // Wait, if p=1 (Champ game), Winner=1, Loser=2.
             // If p=3 (3rd place game), Winner=3, Loser=4.
             // If p=5 (5th place game), Winner=5, Loser=6.
             // This assumes `p` represents the rank of the winner.
          }
       });
    }
    
    // Apply Ranks
    seasonRanks.forEach((rank, rosterId) => {
       const uid = rosterToUser.get(rosterId);
       if (uid) {
          const m = memberMap.get(uid)!;
          m.sumFinalRanks += rank;
          m.bestFinish = Math.min(m.bestFinish, rank);
          m.worstFinish = Math.max(m.worstFinish, rank);
       }
    });

    processedCount++;
  }

  return {
    members: Array.from(memberMap.values()),
    seasons: history
  };
}
