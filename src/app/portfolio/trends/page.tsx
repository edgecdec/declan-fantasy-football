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
  Button,
  createFilterOptions,
  ToggleButton,
  ToggleButtonGroup,
  Chip,
  Stack,
  FormControl,
  InputLabel,
  Select,
  MenuItem
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
type WeeklyStats = {
  total: number;
  starter: number;
  bench: number;
};

type PlayerMeta = {
  id: string;
  name: string;
  position: string;
  totalWeeksOwned: number;
};

// Colors for lines
const COLORS = [
  '#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#d0ed57', 
  '#a4de6c', '#8dd1e1', '#83a6ed', '#8e4585', '#ff0000'
];

const MAX_YEAR = new Date().getMonth() < 5 ? new Date().getFullYear() - 1 : new Date().getFullYear();
const YEARS = Array.from({ length: MAX_YEAR - 2017 + 1 }, (_, i) => (MAX_YEAR - i).toString());

const filterOptions = createFilterOptions({
  matchFrom: 'any',
  limit: 50,
});

// Custom Tooltip Component
const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    // 1. Filter out 0 values
    // 2. Sort by value descending
    const filteredAndSorted = payload
      .filter((entry: any) => entry.value > 0)
      .sort((a: any, b: any) => b.value - a.value);

    if (filteredAndSorted.length === 0) return null;

    return (
      <Paper sx={{ p: 1.5, bgcolor: 'rgba(20, 20, 20, 0.95)', border: '1px solid #333', minWidth: 200 }}>
        <Typography variant="subtitle2" sx={{ mb: 1, color: '#fff' }}>Week {label}</Typography>
        {filteredAndSorted.map((entry: any) => (
          <Box key={entry.dataKey} sx={{ display: 'flex', justifyContent: 'space-between', gap: 3, mb: 0.5 }}>
            <Typography variant="caption" sx={{ color: entry.color, fontWeight: 'medium' }}>
              {entry.name}
            </Typography>
            <Typography variant="caption" sx={{ color: '#fff', fontWeight: 'bold' }}>
              {entry.value}
            </Typography>
          </Box>
        ))}
      </Paper>
    );
  }
  return null;
};

export default function TrendsPage() {
  const { user } = useUser();
  const [year, setYear] = React.useState('2025');
  const [loading, setLoading] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  
  // Raw Data: Array of Maps (Index 0 = Week 1)
  // Each Map: PlayerId -> { total, starter, bench }
  const [rawHistory, setRawHistory] = React.useState<Map<string, WeeklyStats>[]>([]);
  
  // Selection
  const [selectedPlayers, setSelectedPlayers] = React.useState<string[]>([]);
  const [playerOptions, setPlayerOptions] = React.useState<PlayerMeta[]>([]);
  
  // Controls
  const [viewMode, setViewMode] = React.useState<'total' | 'starter' | 'bench'>('total');

  // Helpers
  const getPlayerName = (id: string) => {
    const p = (playerData.players as any)[id];
    return p ? `${p.first_name} ${p.last_name}` : id;
  };

  const getPlayerPosition = (id: string) => {
    const p = (playerData.players as any)[id];
    return p ? p.position : '??';
  };

  // Auto-run
  React.useEffect(() => {
    if (user && !loading && rawHistory.length === 0) {
      startAnalysis();
    }
  }, [user]);

  const startAnalysis = async () => {
    if (!user) return;
    setLoading(true);
    setProgress(0);
    setRawHistory([]);
    setPlayerOptions([]);

    try {
      const leagues = await SleeperService.getLeagues(user.user_id, year);
      if (leagues.length === 0) {
        setLoading(false);
        return;
      }

      const rosterMap = await SleeperService.fetchAllRosters(
        leagues, 
        user.user_id, 
        (c, t) => setProgress((c/t) * 10)
      );

      const myRosterIds = new Map<string, number>();
      leagues.forEach(l => {
        const r = rosterMap.get(l.league_id);
        if (r) myRosterIds.set(l.league_id, r.roster_id);
      });

      const numWeeks = parseInt(year) < 2021 ? 16 : 18; // 17 games = 18 weeks (2021+). Pre-2021 was 16 games (17 weeks).
      // Actually, Sleeper API supports up to 17 weeks for pre-2021. 
      // 2021+: 18 weeks.
      // Let's set it safely.
      const maxWeeks = parseInt(year) < 2021 ? 17 : 18;
      
      const WEEKS = Array.from({length: maxWeeks}, (_, i) => i + 1);
      const newRawHistory: Map<string, WeeklyStats>[] = [];
      const globalPlayerCounts = new Map<string, number>(); // PlayerID -> Total Weeks Owned

      for (let i = 0; i < WEEKS.length; i++) {
        const week = WEEKS[i];
        const weekData = new Map<string, WeeklyStats>();
        
        const weekMatchups = await SleeperService.fetchAllMatchups(
          leagues,
          week,
          (c, t) => {
            const base = 10 + (i / maxWeeks) * 90;
            const step = (c / t) * (90 / maxWeeks);
            setProgress(base + step);
          }
        );

        weekMatchups.forEach((matchups, leagueId) => {
          const myRid = myRosterIds.get(leagueId);
          if (!myRid) return;

          const myMatchup = matchups.find(m => m.roster_id === myRid);
          if (myMatchup && myMatchup.players) {
            const startersSet = new Set(myMatchup.starters || []);
            
            myMatchup.players.forEach(pid => {
              const current = weekData.get(pid) || { total: 0, starter: 0, bench: 0 };
              current.total++;
              if (startersSet.has(pid)) current.starter++;
              else current.bench++;
              weekData.set(pid, current);

              // Update global counts
              const globalCount = globalPlayerCounts.get(pid) || 0;
              globalPlayerCounts.set(pid, globalCount + 1);
            });
          }
        });

        newRawHistory.push(weekData);
        // We can't update state incrementally easily with this structure without causing flicker/re-calc
        // We'll update at end or in chunks if needed. For now, let's update at end for smoothness.
      }

      setRawHistory(newRawHistory);

      // Build Options List
      const options: PlayerMeta[] = Array.from(globalPlayerCounts.entries())
        .map(([id, count]) => ({
          id,
          name: getPlayerName(id),
          position: getPlayerPosition(id),
          totalWeeksOwned: count
        }))
        .sort((a, b) => b.totalWeeksOwned - a.totalWeeksOwned);
      
      setPlayerOptions(options);
      
      // Select Top 3 by default
      setSelectedPlayers(options.slice(0, 3).map(o => o.id));

    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setProgress(100);
    }
  };

  // Calculate dynamic counts based on view mode
  const playerCountsByMode = React.useMemo(() => {
    const counts = new Map<string, number>();
    rawHistory.forEach(weekMap => {
      weekMap.forEach((stats, pid) => {
        const val = viewMode === 'total' ? stats.total : 
                    viewMode === 'starter' ? stats.starter : stats.bench;
        counts.set(pid, (counts.get(pid) || 0) + val);
      });
    });
    return counts;
  }, [rawHistory, viewMode]);

  // Transform Data for Chart
  const chartData = React.useMemo(() => {
    return rawHistory.map((weekMap, index) => {
      const point: any = { week: index + 1 };
      selectedPlayers.forEach(pid => {
        const stats = weekMap.get(pid);
        if (stats) {
          point[pid] = viewMode === 'total' ? stats.total : 
                       viewMode === 'starter' ? stats.starter : stats.bench;
        } else {
          point[pid] = 0;
        }
      });
      return point;
    });
  }, [rawHistory, selectedPlayers, viewMode]);

  // Bulk Select Handlers
  const selectPosition = (pos: string) => {
    const playersToAdd = playerOptions
      .filter(p => p.position === pos)
      .map(p => p.id);
    
    // Add to existing selection, avoiding duplicates
    const newSet = new Set([...selectedPlayers, ...playersToAdd]);
    setSelectedPlayers(Array.from(newSet));
  };

  const clearSelection = () => setSelectedPlayers([]);

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <PageHeader 
        title="Exposure Trends" 
        subtitle="Visualize how your player ownership has changed throughout the season."
        action={
          <Box sx={{ display: 'flex', gap: 2 }}>
            <FormControl size="small" sx={{ minWidth: 100 }}>
              <InputLabel>Year</InputLabel>
              <Select value={year} label="Year" onChange={(e) => setYear(e.target.value)} disabled={loading}>
                {YEARS.map(y => <MenuItem key={y} value={y}>{y}</MenuItem>)}
              </Select>
            </FormControl>
            <Button 
              variant="contained" 
              onClick={startAnalysis} 
              disabled={loading || !user}
            >
              {loading ? 'Scanning...' : 'Generate Graph'}
            </Button>
          </Box>
        }
      />

      {loading && (
        <Box sx={{ width: '100%', mb: 4 }}>
          <Typography variant="body2" gutterBottom>Fetching historical data... {Math.round(progress)}%</Typography>
          <LinearProgress variant="determinate" value={progress} />
        </Box>
      )}

      {playerOptions.length > 0 && (
        <Paper sx={{ p: 3 }}>
          
          {/* Controls Row */}
          <Box sx={{ mb: 3, display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 3, alignItems: 'flex-start' }}>
            
            {/* View Mode Toggle */}
            <Box>
              <Typography variant="subtitle2" gutterBottom>View Mode</Typography>
              <ToggleButtonGroup
                value={viewMode}
                exclusive
                onChange={(_, v) => v && setViewMode(v)}
                size="small"
              >
                <ToggleButton value="total">Total Owned</ToggleButton>
                <ToggleButton value="starter">Starters Only</ToggleButton>
                <ToggleButton value="bench">Bench Only</ToggleButton>
              </ToggleButtonGroup>
            </Box>

            {/* Quick Select */}
            <Box sx={{ flexGrow: 1 }}>
              <Typography variant="subtitle2" gutterBottom>Quick Select</Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map(pos => (
                  <Chip 
                    key={pos} 
                    label={pos} 
                    onClick={() => selectPosition(pos)} 
                    variant="outlined"
                    color="primary"
                    size="small"
                  />
                ))}
                <Chip label="Clear All" onClick={clearSelection} color="error" variant="outlined" size="small" />
              </Stack>
            </Box>
          </Box>

          {/* Player Selector */}
          <Box sx={{ mb: 4 }}>
            <Autocomplete
              multiple
              options={playerOptions}
              filterOptions={filterOptions}
              getOptionLabel={(option: any) => `${option.name} (${playerCountsByMode.get(option.id) || 0})`}
              value={playerOptions.filter(p => selectedPlayers.includes(p.id))}
              onChange={(_, newValue) => {
                setSelectedPlayers(newValue.map((p: any) => p.id));
              }}
              renderInput={(params) => (
                <TextField 
                  {...params} 
                  variant="outlined" 
                  label="Select Players to Graph" 
                  placeholder="Type to search..." 
                  helperText="Number in parentheses indicates total weeks owned across all leagues."
                />
              )}
            />
          </Box>

          {/* Chart */}
          <Box sx={{ height: 500, width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                <XAxis dataKey="week" stroke="#888" label={{ value: 'Week', position: 'insideBottom', offset: -5 }} />
                <YAxis stroke="#888" label={{ value: 'Shares', angle: -90, position: 'insideLeft' }} />
                <Tooltip content={<CustomTooltip />} />
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
                    connectNulls
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
