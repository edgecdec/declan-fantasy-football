'use client';

import * as React from 'react';
import {
  Box,
  Typography,
  LinearProgress,
  FormControlLabel,
  Switch,
  Alert
} from '@mui/material';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine
} from 'recharts';
import { SleeperService } from '@/services/sleeper/sleeperService';
import { analyzeLeague } from '@/services/stats/expectedWins';

// Years to analyze for User History
const YEARS_TO_ANALYZE = ['2020', '2021', '2022', '2023', '2024', '2025'];

type UserYearlyStats = {
  year: string;
  totalActual: number;
  totalExpected: number;
  totalOpportunities: number;
  actualPct: number;
  expectedPct: number;
  luck: number; // diff
  leaguesCount: number;
};

type Props = {
  userId: string;
};

export default function UserHistoryChart({ userId }: Props) {
  const [loading, setLoading] = React.useState(true);
  const [progress, setProgress] = React.useState(0);
  const [data, setData] = React.useState<UserYearlyStats[]>([]);
  const [status, setStatus] = React.useState('');

  React.useEffect(() => {
    let mounted = true;

    const analyzeAll = async () => {
      setLoading(true);
      setProgress(0);
      const results: UserYearlyStats[] = [];
      const totalSteps = YEARS_TO_ANALYZE.length;

      try {
        for (let i = 0; i < totalSteps; i++) {
          const year = YEARS_TO_ANALYZE[i];
          setStatus(`Scanning ${year}...`);
          
          try {
            // 1. Get Leagues for Year
            const leagues = await SleeperService.getLeagues(userId, year);
            const activeLeagues = leagues.filter(l => !SleeperService.shouldIgnoreLeague(l));
            
            if (activeLeagues.length === 0) continue;

            let yearActual = 0;
            let yearExpected = 0;
            let yearOpp = 0;
            let count = 0;

            // 2. Analyze each league (Parallel within year is risky for rate limits, so chunk it)
            // Reuse the batch logic if possible, or just loop sequentially for safety
            // Given we are doing multiple years, let's go parallel but capped.
            
            const CHUNK_SIZE = 3;
            for (let j = 0; j < activeLeagues.length; j += CHUNK_SIZE) {
               const chunk = activeLeagues.slice(j, j + CHUNK_SIZE);
               await Promise.all(chunk.map(async (league) => {
                   try {
                       const stats = await analyzeLeague(league, userId);
                       if (stats.userStats) {
                           yearActual += stats.userStats.actualWins;
                           yearExpected += stats.userStats.expectedWins;
                           yearOpp += stats.userStats.totalOpportunities;
                           count++;
                       }
                   } catch (e) {
                       console.warn(`Failed ${league.name} ${year}`);
                   }
               }));
            }

            if (yearOpp > 0) {
                results.push({
                    year,
                    totalActual: yearActual,
                    totalExpected: yearExpected,
                    totalOpportunities: yearOpp,
                    actualPct: (yearActual / yearOpp) * 100,
                    expectedPct: (yearExpected / yearOpp) * 100,
                    luck: yearActual - yearExpected,
                    leaguesCount: count
                });
            }

          } catch (e) {
             console.error(`Failed year ${year}`, e);
          }

          if (mounted) setProgress(((i + 1) / totalSteps) * 100);
        }

        if (mounted) {
            results.sort((a, b) => a.year.localeCompare(b.year));
            setData(results);
        }

      } catch (e) {
        console.error(e);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    analyzeAll();
    return () => { mounted = false; };
  }, [userId]);

  return (
    <Box sx={{ height: 500, width: '100%', p: 1 }}>
      {loading ? (
        <Box sx={{ width: '100%', mt: 4 }}>
          <Typography align="center" gutterBottom>{status} ({Math.round(progress)}%)</Typography>
          <LinearProgress variant="determinate" value={progress} />
          <Alert severity="info" sx={{ mt: 2 }}>
            This performs a deep scan of all your leagues since 2020. This may take a minute.
          </Alert>
        </Box>
      ) : data.length === 0 ? (
         <Alert severity="warning">No history found for this user.</Alert>
      ) : (
        <ResponsiveContainer width="100%" height="90%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="year" />
            <YAxis label={{ value: 'Win %', angle: -90, position: 'insideLeft' }} domain={[0, 100]} />
            <Tooltip 
                formatter={(value: number, name: string) => [value.toFixed(1) + '%', name]}
                labelStyle={{ color: '#000' }}
            />
            <Legend />
            <ReferenceLine y={50} stroke="#666" strokeDasharray="3 3" />
            <Bar dataKey="actualPct" name="Actual Win %" fill="#82ca9d" />
            <Bar dataKey="expectedPct" name="Expected Win %" fill="#8884d8" />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Box>
  );
}
