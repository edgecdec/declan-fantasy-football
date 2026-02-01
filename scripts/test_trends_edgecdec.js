// scripts/test_trends_edgecdec.js

async function run() {
  const username = 'edgecdec';
  console.log(`Starting analysis for user: ${username}`);

  // 1. Get User ID
  const userRes = await fetch(`https://api.sleeper.app/v1/user/${username}`);
  const user = await userRes.json();
  
  if (!user.user_id) {
    console.error('User not found');
    return;
  }
  console.log(`User ID: ${user.user_id}`);

  // Years to test
  const years = [2025, 2024, 2023, 2022, 2021, 2020];

  for (const year of years) {
    console.log(`
--- Analyzing ${year} ---`);
    
    // 2. Get Leagues
    const leaguesRes = await fetch(`https://api.sleeper.app/v1/user/${user.user_id}/leagues/nfl/${year}`);
    const leagues = await leaguesRes.json();
    
    console.log(`Found ${leagues.length} leagues.`);

    let yearStats = {
      actualWins: 0,
      expectedWins: 0,
      opportunities: 0
    };

    for (const league of leagues) {
      // Filter logic simulation
      const name = league.name.toLowerCase();
      if (name.includes('best ball') || name.includes('mock')) {
        console.log(`  Skipping ${league.name} (Filtered)`);
        continue;
      }

      console.log(`  Checking: ${league.name} (${league.league_id})`);
      
      // Schedule Settings
      const startWeek = league.settings.start_week || 1;
      const playoffStart = league.settings.playoff_week_start;
      const endWeek = (playoffStart === 0) ? 18 : (playoffStart || 15) - 1;
      const useMedian = league.settings.league_average_match === 1;

      // Simulate Valid Weeks Scan
      // We'll just check a few sample weeks to see if scores exist
      let validWeeks = 0;
      
      // Check Week 1
      const m1Res = await fetch(`https://api.sleeper.app/v1/league/${league.league_id}/matchups/1`);
      const m1 = await m1Res.json();
      const hasScoresWeek1 = m1 && m1.some(m => m.points > 0);
      
      // Check Week 8
      const m8Res = await fetch(`https://api.sleeper.app/v1/league/${league.league_id}/matchups/8`);
      const m8 = await m8Res.json();
      const hasScoresWeek8 = m8 && m8.some(m => m.points > 0);

      // Check Week 13
      const m13Res = await fetch(`https://api.sleeper.app/v1/league/${league.league_id}/matchups/13`);
      const m13 = await m13Res.json();
      const hasScoresWeek13 = m13 && m13.some(m => m.points > 0);

      if (!hasScoresWeek1 && !hasScoresWeek8 && !hasScoresWeek13) {
        console.log(`    -> Status: INACTIVE (No scores found in sample weeks)`);
        continue;
      }

      console.log(`    -> Status: ACTIVE`);
      
      // In a real run, we'd sum up all valid weeks.
      // Here we just want to verify if the league counts as "active" or not.
    }
  }
}

run();
