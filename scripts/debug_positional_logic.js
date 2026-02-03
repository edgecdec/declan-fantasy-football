const fs = require('fs');
const path = require('path');

// Mock SleeperService for the script
const SleeperService = {
  getMatchups: async (leagueId, week) => {
    const res = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/matchups/${week}`);
    return res.json();
  }
};

const VALID_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

async function run() {
  const username = 'edgecdec';
  console.log(`Debugging logic for ${username}...`);

  // 1. Load Player Data
  console.log('Loading player data...');
  const playerPath = path.join(__dirname, '../data/sleeper_players.json');
  const playerDataRaw = fs.readFileSync(playerPath, 'utf8');
  const playerData = JSON.parse(playerDataRaw);
  const players = playerData.players; // Ensure structure is correct
  console.log(`Loaded ${Object.keys(players).length} players.`);

  // 2. Get User ID
  const userRes = await fetch(`https://api.sleeper.app/v1/user/${username}`);
  const user = await userRes.json();
  console.log(`User ID: ${user.user_id}`);

  // 3. Get Leagues (2025)
  const leaguesRes = await fetch(`https://api.sleeper.app/v1/user/${user.user_id}/leagues/nfl/2025`);
  const leagues = await leaguesRes.json();
  
  if (leagues.length === 0) {
    console.log('No leagues found for 2025.');
    return;
  }

  // Pick one active league to test
  const league = leagues.find(l => l.name.includes("Amazon Superflex")); // Known active league
  if (!league) {
    console.log('Could not find test league, using first one.');
    // league = leagues[0];
  }
  console.log(`Testing League: ${league.name} (${league.league_id})`);

  // 4. Run Analysis Logic (Copied from positionalBenchmarks.ts)
  const startWeek = league.settings.start_week || 1;
  const playoffStart = league.settings.playoff_week_start;
  const endWeek = (playoffStart === 0) ? 18 : (playoffStart || 15) - 1;
  
  const weeks = [];
  if (endWeek >= startWeek) {
    for (let w = startWeek; w <= endWeek; w++) {
      weeks.push(w);
    }
  }
  console.log(`Analyzing weeks: ${weeks.join(', ')}`);

  // Fetch Matchups & Rosters
  const rostersRes = await fetch(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`);
  const rostersData = await rostersRes.json();
  const myRoster = rostersData.find(r => r.owner_id === user.user_id);
  const myRosterId = myRoster.roster_id;
  const numTeams = rostersData.length;

  console.log(`My Roster ID: ${myRosterId}`);

  // Fetch all weeks (limit to first 3 for speed)
  const testWeeks = weeks.slice(0, 3); 
  const allWeeksMatchups = await Promise.all(testWeeks.map(w => SleeperService.getMatchups(league.league_id, w)));

  // Phase 1: League Avgs
  allWeeksMatchups.forEach((weekMatchups, i) => {
    const week = testWeeks[i];
    console.log(`
Week ${week}: Found ${weekMatchups.length} matchups`);
    
    // Check one matchup structure
    if (i === 0 && weekMatchups.length > 0) {
        const m = weekMatchups[0];
        console.log('Sample Matchup Keys:', Object.keys(m));
        console.log('Starters:', m.starters);
        console.log('Starters Points:', m.starters_points); // This is critical
    }

    const weekPosTotals = {};
    
    weekMatchups.forEach(matchup => {
      if (!matchup.starters) return;
      matchup.starters.forEach((playerId, index) => {
        let position = 'FLEX';
        const pData = players[playerId];
        if (pData) position = pData.position;
        
        // Debug specific player
        if (playerId === "4046") { // Mahomes? Or just check any
             // console.log(`Found player ${playerId} pos ${position}`);
        }

        if (!VALID_POSITIONS.includes(position)) return;

        const points = matchup.starters_points ? matchup.starters_points[index] : 0;
        weekPosTotals[position] = (weekPosTotals[position] || 0) + points;
      });
    });
    
    console.log(`Week ${week} League Totals:`, weekPosTotals);
  });

}

run();
