'use client';

import * as React from 'react';
import {
  Box,
  Typography,
  LinearProgress,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormControlLabel,
  Switch,
  Paper
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
import { SleeperService, SleeperLeague } from '@/services/sleeper/sleeperService';
import { analyzeLeague, TeamStats } from '@/services/stats/expectedWins';

// Define a palette of colors for lines
const COLORS = [
  '#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#d0ed57', 
  '#a4de6c', '#8dd1e1', '#83a6ed', '#8e4585', '#ff0000',
  '#0088fe', '#00c49f'
];

type Props = {
  currentLeagueId: string;
};

type RawHistoryPoint = {
  year: number;
  data: Record<string, { actual: number; expected: number }>;
};

export default function LeagueHistoryChart({ currentLeagueId }: Props) {
  const [loading, setLoading] = React.useState(true);
  const [progress, setProgress] = React.useState(0);
  const [rawData, setRawData] = React.useState<RawHistoryPoint[]>([]);
  const [owners, setOwners] = React.useState<OwnerMeta[]>([]);
  const [mode, setMode] = React.useState<'expected' | 'actual'>('expected');
  const [selectedOwners, setSelectedOwners] = React.useState<string[]>([]);
  
  React.useEffect(() => {
    let mounted = true;
    
    const fetchData = async () => {
      setLoading(true);
      setProgress(0);
      try {
        const history = await SleeperService.getLeagueHistory(currentLeagueId);
        const total = history.length;
        const results: RawHistoryPoint[] = [];
        const ownerMap = new Map<string, string>(); 

        for (let i = 0; i < total; i++) {
          const league = history[i];
          const season = parseInt(league.season);
          
          try {
            const stats = await analyzeLeague(league);
            const point: RawHistoryPoint = { year: season, data: {} };
            
            stats.standings.forEach(team => {
              if (!ownerMap.has(team.ownerId)) {
                ownerMap.set(team.ownerId, team.name);
              }
              point.data[team.ownerId] = {
                actual: team.actualWins,
                expected: team.expectedWins
              };
            });
            results.push(point);
            
          } catch (e) {
            console.error(`Failed to analyze season ${season}`, e);
          }
          
          if (mounted) setProgress(((i + 1) / total) * 100);
        }

        if (mounted) {
          results.sort((a, b) => a.year - b.year);
          setRawData(results);
          
          const uniqueOwners = Array.from(ownerMap.entries()).map(([id, name]) => ({ id, name }));
          setOwners(uniqueOwners);
          setSelectedOwners(uniqueOwners.map(o => o.id));
        }

      } catch (e) {
        console.error(e);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchData();

    return () => { mounted = false; };
  }, [currentLeagueId]); // Mode removed from dependency

  const chartData = React.useMemo(() => {
    return rawData.map(pt => {
        const row: any = { year: pt.year };
        Object.entries(pt.data).forEach(([ownerId, stats]) => {
            row[ownerId] = mode === 'expected' ? stats.expected : stats.actual;
        });
        return row;
    });
  }, [rawData, mode]);
  
  return (
    <Box sx={{ height: 500, width: '100%', p: 1 }}>
      {loading ? (
        <Box sx={{ width: '100%', mt: 4 }}>
          <Typography align="center">Analyzing historical seasons... {Math.round(progress)}%</Typography>
          <LinearProgress variant="determinate" value={progress} />
        </Box>
      ) : (
        <>
          <Box sx={{ mb: 2, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 2 }}>
            <FormControlLabel
              control={<Switch checked={mode === 'expected'} onChange={() => setMode(m => m === 'expected' ? 'actual' : 'expected')} />}
              label={mode === 'expected' ? "Expected Wins" : "Actual Wins"}
            />
          </Box>
          <ResponsiveContainer width="100%" height="90%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="year" />
              <YAxis label={{ value: 'Wins', angle: -90, position: 'insideLeft' }} />
              <Tooltip 
                formatter={(value: number, name: string) => [
                  value.toFixed(2), 
                  owners.find(o => o.id === name)?.name || name
                ]}
                labelFormatter={(label) => `Season ${label}`}
              />
              <Legend 
                formatter={(value) => owners.find(o => o.id === value)?.name || value} 
              />
              {selectedOwners.map((ownerId, i) => (
                <Line
                  key={ownerId}
                  type="monotone"
                  dataKey={ownerId}
                  stroke={COLORS[i % COLORS.length]}
                  strokeWidth={2}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </>
      )}
    </Box>
  );
}
