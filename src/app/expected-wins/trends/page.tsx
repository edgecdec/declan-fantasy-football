'use client';

import * as React from 'react';
import {
  Container,
  Typography,
  Box,
  Paper,
  LinearProgress,
  Button,
  Alert
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
import { useRouter } from 'next/navigation';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useUser } from '@/context/UserContext';
import { SleeperService } from '@/services/sleeper/sleeperService';
import { analyzeLeague } from '@/services/stats/expectedWins';
import PageHeader from '@/components/common/PageHeader';
import UserSearchInput from '@/components/common/UserSearchInput';
import LuckSummaryCard from '@/components/analytics/LuckSummaryCard';

// Min year for Sleeper
const MIN_YEAR = 2017;

type YearlyStats = {
  year: string;
  actualPct: number;
  expectedPct: number;
  luck: number; // diff
  totalActual: number;
  totalExpected: number;
  totalOpportunities: number;
  totalPF: number;
  totalPA: number;
  leaguesCount: number;
};

export default function LuckTrendsPage() {
  const router = useRouter();
  const { user, fetchUser } = useUser();
  const [username, setUsername] = React.useState('');
  
  const [loading, setLoading] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [status, setStatus] = React.useState('');
  const [history, setHistory] = React.useState<YearlyStats[]>([]);

  // Init username from user context or local storage
  React.useEffect(() => {
    if (user) {
      setUsername(user.username);
    } else {
      const saved = localStorage.getItem('sleeper_usernames');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed.length > 0) setUsername(parsed[0]);
        } catch (e) {}
      }
    }
  }, [user]);

  const handleAnalyze = async () => {
    if (!username) return;
    setLoading(true);
    setProgress(0);
    setHistory([]);
    setStatus('Initializing...');

    try {
      // Ensure we have the user object
      let currentUser = user;
      if (!currentUser || currentUser.username.toLowerCase() !== username.toLowerCase()) {
        currentUser = await SleeperService.getUser(username);
        if (!currentUser) throw new Error('User not found');
        fetchUser(username); // Update context
      }

      const results: YearlyStats[] = [];
      
      // Determine start year (If before June, assume we want previous season as "current")
      const now = new Date();
      let currentYear = now.getMonth() < 5 ? now.getFullYear() - 1 : now.getFullYear();
      
      // We will scan backwards until MIN_YEAR
      let processedYears = 0;
      // Est total for progress bar (e.g. scan back 6 years)
      const EST_TOTAL_YEARS = 6; 

      while (currentYear >= MIN_YEAR) {
        const year = currentYear.toString();
        setStatus(`Scanning ${year}...`);
        
        try {
          // 1. Get Leagues for Year
          const leagues = await SleeperService.getLeagues(currentUser.user_id, year);
          const activeLeagues = leagues.filter(l => !SleeperService.shouldIgnoreLeague(l));
          
          if (activeLeagues.length === 0) {
             // Just skip this year if no leagues found
             currentYear--;
             processedYears++;
             setProgress(Math.min((processedYears / EST_TOTAL_YEARS) * 100, 95));
             continue;
          }
          
          let yearActual = 0;
          let yearExpected = 0;
          let yearOpp = 0;
          let yearPF = 0;
          let yearPA = 0;
          let count = 0;

          // 2. Analyze leagues in chunks
          const CHUNK_SIZE = 3;
          for (let j = 0; j < activeLeagues.length; j += CHUNK_SIZE) {
             const chunk = activeLeagues.slice(j, j + CHUNK_SIZE);
             await Promise.all(chunk.map(async (league) => {
                 try {
                     const stats = await analyzeLeague(league, currentUser!.user_id);
                     if (stats.userStats) {
                         yearActual += stats.userStats.actualWins;
                         yearExpected += stats.userStats.expectedWins;
                         yearOpp += stats.userStats.totalOpportunities;
                         yearPF += stats.userStats.pointsFor;
                         yearPA += stats.userStats.pointsAgainst;
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
                  totalPF: yearPF,
                  totalPA: yearPA,
                  actualPct: parseFloat(((yearActual / yearOpp) * 100).toFixed(1)),
                  expectedPct: parseFloat(((yearExpected / yearOpp) * 100).toFixed(1)),
                  luck: yearActual - yearExpected,
                  leaguesCount: count
              });
          }

        } catch (e) {
           console.error(`Failed year ${year}`, e);
        }

        // Update live graph
        const sorted = [...results].sort((a, b) => a.year.localeCompare(b.year));
        setHistory(sorted);
        
        currentYear--;
        processedYears++;
        setProgress(Math.min((processedYears / EST_TOTAL_YEARS) * 100, 99));
      }

    } catch (e) {
      console.error(e);
      setStatus('Error occurred');
    } finally {
      setLoading(false);
      setProgress(100);
    }
  };

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <Button 
        startIcon={<ArrowBackIcon />} 
        onClick={() => router.back()} 
        sx={{ mb: 2 }}
      >
        Back to Analysis
      </Button>

      <PageHeader 
        title="Historical Luck Trends" 
        subtitle="Visualize your Actual vs. Expected Win Rate over the years."
      />

      <Paper sx={{ p: 3, mb: 4 }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <UserSearchInput 
            username={username} 
            setUsername={setUsername} 
            disabled={loading} 
          />
          <Button 
            variant="contained" 
            size="large"
            onClick={handleAnalyze}
            disabled={loading || !username}
            sx={{ height: 56, px: 4 }}
          >
            {loading ? 'Scanning...' : 'Generate Trend Graph'}
          </Button>
        </Box>
        
        {loading && (
          <Box sx={{ width: '100%', mt: 3 }}>
            <Typography variant="body2" gutterBottom>{status} ({Math.round(progress)}%)</Typography>
            <LinearProgress variant="determinate" value={progress} />
          </Box>
        )}
      </Paper>

      {history.length > 0 ? (
        <>
          {/* Historical Totals Dashboard */}
          {(() => {
            const grandTotal = history.reduce((acc, curr) => ({
              actual: acc.actual + curr.totalActual,
              expected: acc.expected + curr.totalExpected,
              opp: acc.opp + curr.totalOpportunities,
              pf: acc.pf + curr.totalPF,
              pa: acc.pa + curr.totalPA
            }), { actual: 0, expected: 0, opp: 0, pf: 0, pa: 0 });

            return (
              <LuckSummaryCard
                actualWins={grandTotal.actual}
                expectedWins={grandTotal.expected}
                totalOpportunities={grandTotal.opp}
                pointsFor={grandTotal.pf}
                pointsAgainst={grandTotal.pa}
                showAdvanced={true}
              />
            );
          })()}

          <Paper sx={{ p: 3, height: 600 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={history} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#444" />
              <XAxis dataKey="year" stroke="#888" />
              <YAxis 
                stroke="#888" 
                label={{ value: 'Win %', angle: -90, position: 'insideLeft' }} 
                domain={['auto', 'auto']}
              />
              <Tooltip 
                contentStyle={{ backgroundColor: '#333', border: 'none' }}
                itemStyle={{ color: '#fff' }}
                labelStyle={{ color: '#aaa' }}
                formatter={(val: any) => `${val}%`}
              />
              <Legend />
              
              <Line 
                type="monotone" 
                dataKey="actualPct" 
                name="Actual Win %" 
                stroke="#82ca9d" 
                strokeWidth={3}
                activeDot={{ r: 8 }}
              />
              <Line 
                type="monotone" 
                dataKey="expectedPct" 
                name="Expected Win %" 
                stroke="#8884d8" 
                strokeWidth={3}
                activeDot={{ r: 8 }}
              />
            </LineChart>
          </ResponsiveContainer>
          
          <Box sx={{ mt: 2, textAlign: 'center' }}>
             <Typography variant="caption" color="text.secondary">
               * Calculated using aggregate All-Play vs Actual record across all leagues for each year.
             </Typography>
          </Box>
        </Paper>
        </>
      ) : (
        !loading && (
          <Alert severity="info">
            Enter a username and click &quot;Generate Trend Graph&quot; to see historical performance.
          </Alert>
        )
      )}
    </Container>
  );
}
