'use client';

import * as React from 'react';
import {
  Container,
  Typography,
  Box,
  Paper,
  LinearProgress,
  Autocomplete,
  TextField,
  Button
} from '@mui/material';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer 
} from 'recharts';
import { useUser } from '@/context/UserContext';
import { SleeperService, SleeperLeague, SleeperMatchup } from '@/services/sleeper/sleeperService';
import playerData from '../../../../data/sleeper_players.json';
import PageHeader from '@/components/common/PageHeader';

// --- Types ---
type WeeklyData = {
  week: number;
  [playerId: string]: number; // dynamic keys for player counts
};

// Colors for lines
const COLORS = [
  '#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#d0ed57', 
  '#a4de6c', '#8dd1e1', '#83a6ed', '#8e4585', '#ff0000'
];

export default function TrendsPage() {
  const { user } = useUser();
  const [year, setYear] = React.useState('2025');
  const [loading, setLoading] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  
  // Data Store: Map<Week, Map<PlayerId, Count>>
  const [history, setHistory] = React.useState<WeeklyData[]>([]);
  
  // Selection
  const [selectedPlayers, setSelectedPlayers] = React.useState<string[]>([]);
  const [availablePlayers, setAvailablePlayers] = React.useState<{id: string, name: string}[]>([]);

  // Helpers
  const getPlayerName = (id: string) => {
    const p = (playerData.players as any)[id];
    return p ? `${p.first_name} ${p.last_name}` : id;
  };

  const startAnalysis = async () => {
    if (!user) return;
    setLoading(true);
    setProgress(0);
    setHistory([]);

    try {
      // 1. Get Leagues
      const leagues = await SleeperService.getLeagues(user.user_id, year);
      if (leagues.length === 0) {
        setLoading(false);
        return;
      }

      // 2. Fetch Rosters (to get mapping of Owner -> Roster ID)
      // We assume roster IDs mostly don't change, though technically they can in dynasty.
      // For trends, we'll map User -> Roster ID per league.
      const rosterMap = await SleeperService.fetchAllRosters(
        leagues, 
        user.user_id, 
        (c, t) => setProgress((c/t) * 10) // First 10%
      );

      // Create a lookup: LeagueID -> MyRosterID
      const myRosterIds = new Map<string, number>();
      leagues.forEach(l => {
        const r = rosterMap.get(l.league_id);
        if (r) myRosterIds.set(l.league_id, r.roster_id);
      });

      // 3. Fetch Weeks 1-18
      const WEEKS = Array.from({length: 18}, (_, i) => i + 1);
      const tempHistory: WeeklyData[] = [];
      const playersSet = new Set<string>();

      // We fetch one week at a time to update UI progressively
      for (let i = 0; i < WEEKS.length; i++) {
        const week = WEEKS[i];
        
        // Fetch matchups for all leagues for this week
        const weekMatchups = await SleeperService.fetchAllMatchups(
          leagues,
          week,
          (c, t) => {
            // Progress logic: We have 18 weeks. Each week is ~5% of total.
            // (i / 18) * 90 + (c/t * (1/18) * 90) + 10
            const base = 10 + (i / 18) * 90;
            const step = (c / t) * (90 / 18);
            setProgress(base + step);
          }
        );

        // Aggregate counts for this week
        const weekData: WeeklyData = { week };
        
        weekMatchups.forEach((matchups, leagueId) => {
          const myRid = myRosterIds.get(leagueId);
          if (!myRid) return;

          const myMatchup = matchups.find(m => m.roster_id === myRid);
          if (myMatchup && myMatchup.players) {
            myMatchup.players.forEach(pid => {
              weekData[pid] = (weekData[pid] || 0) + 1;
              playersSet.add(pid);
            });
          }
        });

        tempHistory.push(weekData);
        // Live update the chart data
        setHistory([...tempHistory]);
      }

      // Populate autocomplete list
      const playerOptions = Array.from(playersSet).map(id => ({
        id,
        name: getPlayerName(id)
      })).sort((a, b) => a.name.localeCompare(b.name));
      
      setAvailablePlayers(playerOptions);
      
      // Default select top 3 most owned players in final week
      const lastWeek = tempHistory[tempHistory.length - 1];
      const topOwned = Array.from(playersSet)
        .sort((a, b) => (lastWeek[b] || 0) - (lastWeek[a] || 0))
        .slice(0, 3);
      setSelectedPlayers(topOwned);

    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setProgress(100);
    }
  };

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <PageHeader 
        title="Exposure Trends" 
        subtitle="Visualize how your player ownership has changed throughout the season."
        action={
          <Button 
            variant="contained" 
            onClick={startAnalysis} 
            disabled={loading || !user}
          >
            {loading ? 'Scanning History...' : 'Generate Graph'}
          </Button>
        }
      />

      {loading && (
        <Box sx={{ width: '100%', mb: 4 }}>
          <Typography variant="body2" gutterBottom>Fetching historical data... {Math.round(progress)}%</Typography>
          <LinearProgress variant="determinate" value={progress} />
        </Box>
      )}

      {history.length > 0 && (
        <Paper sx={{ p: 3 }}>
          {/* Player Selector */}
          <Box sx={{ mb: 4 }}>
            <Autocomplete
              multiple
              options={availablePlayers}
              getOptionLabel={(option) => option.name}
              value={availablePlayers.filter(p => selectedPlayers.includes(p.id))}
              onChange={(_, newValue) => {
                setSelectedPlayers(newValue.map(p => p.id));
              }}
              renderInput={(params) => (
                <TextField {...params} variant="outlined" label="Select Players to Graph" placeholder="Add player..." />
              )}
            />
          </Box>

          {/* Chart */}
          <Box sx={{ height: 500, width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                <XAxis dataKey="week" stroke="#888" label={{ value: 'Week', position: 'insideBottom', offset: -5 }} />
                <YAxis stroke="#888" label={{ value: 'Shares', angle: -90, position: 'insideLeft' }} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#333', border: 'none' }}
                  itemStyle={{ color: '#fff' }}
                  labelStyle={{ color: '#aaa' }}
                />
                <Legend />
                {selectedPlayers.map((pid, index) => (
                  <Line 
                    key={pid}
                    type="monotone" 
                    dataKey={pid} 
                    name={getPlayerName(pid)}
                    stroke={COLORS[index % COLORS.length]} 
                    activeDot={{ r: 8 }} 
                    strokeWidth={2}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </Box>
        </Paper>
      )}
    </Container>
  );
}
