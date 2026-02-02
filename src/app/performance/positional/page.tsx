'use client';

import * as React from 'react';
import {
  Container,
  Box,
  Paper,
  Typography,
  LinearProgress,
  Grid,
  Card,
  CardContent,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Divider,
  Chip
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  Cell
} from 'recharts';
import { useUser } from '@/context/UserContext';
import { SleeperService } from '@/services/sleeper/sleeperService';
import { analyzePositionalBenchmarks, LeagueBenchmarkResult } from '@/services/stats/positionalBenchmarks';
import PageHeader from '@/components/common/PageHeader';
import UserSearchInput from '@/components/common/UserSearchInput';

const VALID_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

export default function PositionalBenchmarksPage() {
  const { user, fetchUser } = useUser();
  const [username, setUsername] = React.useState('');
  const [year, setYear] = React.useState('2025');
  
  const [loading, setLoading] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [status, setStatus] = React.useState('');
  
  const [results, setResults] = React.useState<LeagueBenchmarkResult[]>([]);
  const [aggregateDiffs, setAggregateDiffs] = React.useState<any[]>([]);

  // Init
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

  // Auto-run
  React.useEffect(() => {
    if (username && !loading && results.length === 0) {
      const t = setTimeout(() => handleAnalyze(), 500);
      return () => clearTimeout(t);
    }
  }, [username]);

  const handleAnalyze = async () => {
    if (!username) return;
    setLoading(true);
    setProgress(0);
    setResults([]);
    setStatus('Finding leagues...');

    try {
      let currentUser = user;
      if (!currentUser || currentUser.username.toLowerCase() !== username.toLowerCase()) {
        currentUser = await SleeperService.getUser(username);
        if (!currentUser) throw new Error('User not found');
        fetchUser(username);
      }

      const leagues = await SleeperService.getLeagues(currentUser.user_id, year);
      const activeLeagues = leagues.filter(l => !SleeperService.shouldIgnoreLeague(l));
      
      const totalSteps = activeLeagues.length;
      const batchResults: LeagueBenchmarkResult[] = [];

      for (let i = 0; i < totalSteps; i++) {
        const league = activeLeagues[i];
        setStatus(`Analyzing ${league.name}...`);
        
        try {
          const res = await analyzePositionalBenchmarks(league, currentUser.user_id);
          batchResults.push(res);
        } catch (e) {
          console.warn(`Failed to analyze ${league.name}`, e);
        }
        
        setProgress(((i + 1) / totalSteps) * 100);
      }

      setResults(batchResults);
      calculateAggregates(batchResults);

    } catch (e) {
      console.error(e);
      setStatus('Error occurred');
    } finally {
      setLoading(false);
    }
  };

  const calculateAggregates = (data: LeagueBenchmarkResult[]) => {
    // Calculate Weighted Avg % Diff across all leagues
    // We simply average the % Diff for each position
    
    const sums: Record<string, number> = {};
    const counts: Record<string, number> = {};

    data.forEach(res => {
      VALID_POSITIONS.forEach(pos => {
        const u = res.userStats[pos];
        const l = res.leagueAverageStats[pos];
        
        if (l.avgPointsPerWeek > 0) {
          const diffPct = ((u.avgPointsPerWeek - l.avgPointsPerWeek) / l.avgPointsPerWeek) * 100;
          sums[pos] = (sums[pos] || 0) + diffPct;
          counts[pos] = (counts[pos] || 0) + 1;
        }
      });
    });

    const aggData = VALID_POSITIONS.map(pos => ({
      position: pos,
      diff: counts[pos] ? sums[pos] / counts[pos] : 0
    }));

    setAggregateDiffs(aggData);
  };

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <PageHeader 
        title="Positional Benchmarks" 
        subtitle="Compare your positional scoring output against league averages to identify roster strengths and weaknesses."
      />

      {/* Controls */}
      <Paper sx={{ p: 3, mb: 4 }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <UserSearchInput username={username} setUsername={setUsername} disabled={loading} />
          <FormControl sx={{ minWidth: 100 }}>
            <InputLabel>Year</InputLabel>
            <Select value={year} label="Year" onChange={(e) => setYear(e.target.value)} disabled={loading}>
              {['2025', '2024', '2023'].map(y => <MenuItem key={y} value={y}>{y}</MenuItem>)}
            </Select>
          </FormControl>
          <Button 
            variant="contained" 
            size="large"
            onClick={handleAnalyze}
            disabled={loading || !username}
            sx={{ height: 56 }}
          >
            {loading ? 'Analyzing...' : 'Analyze'}
          </Button>
        </Box>
        {loading && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="body2" gutterBottom>{status} ({Math.round(progress)}%)</Typography>
            <LinearProgress variant="determinate" value={progress} />
          </Box>
        )}
      </Paper>

      {/* Aggregate Chart */}
      {!loading && aggregateDiffs.length > 0 && (
        <Paper sx={{ p: 3, mb: 4, bgcolor: '#1e293b' }}>
          <Typography variant="h5" gutterBottom color="white">Overall "Skill Profile"</Typography>
          <Typography variant="body2" color="rgba(255,255,255,0.7)" sx={{ mb: 3 }}>
            Your average scoring surplus/deficit compared to league median across all leagues.
          </Typography>
          
          <Box sx={{ height: 400, width: '100%' }}>
            <ResponsiveContainer>
              <BarChart data={aggregateDiffs} layout="vertical" margin={{ left: 20, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#444" horizontal={false} />
                <XAxis type="number" stroke="#888" unit="%" />
                <YAxis dataKey="position" type="category" stroke="#fff" width={50} />
                <Tooltip 
                  cursor={{ fill: 'transparent' }}
                  contentStyle={{ backgroundColor: '#333', border: 'none', color: '#fff' }}
                  formatter={(val: number) => `${val > 0 ? '+' : ''}${val.toFixed(1)}%`}
                />
                <ReferenceLine x={0} stroke="#fff" />
                <Bar dataKey="diff" name="% Diff">
                  {aggregateDiffs.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.diff > 0 ? '#66bb6a' : '#ef5350'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Box>
        </Paper>
      )}

      {/* Individual Leagues */}
      {!loading && results.length > 0 && (
        <Box>
          <Typography variant="h5" gutterBottom sx={{ mt: 4, mb: 2 }}>League Details</Typography>
          <Grid container spacing={3}>
            {results.map((res) => (
              <Grid item xs={12} key={res.leagueId}>
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography variant="h6">{res.leagueName}</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Grid container spacing={4}>
                      {/* Chart 1: Total Output */}
                      <Grid item xs={12} md={6}>
                        <Typography variant="subtitle1" gutterBottom align="center">Average Weekly Output</Typography>
                        <Box sx={{ height: 300 }}>
                          <ResponsiveContainer>
                            <BarChart 
                              data={VALID_POSITIONS.map(pos => ({
                                pos,
                                You: res.userStats[pos].avgPointsPerWeek,
                                Avg: res.leagueAverageStats[pos].avgPointsPerWeek
                              }))}
                            >
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey="pos" />
                              <YAxis />
                              <Tooltip />
                              <Legend />
                              <Bar dataKey="You" fill="#8884d8" />
                              <Bar dataKey="Avg" fill="#82ca9d" />
                            </BarChart>
                          </ResponsiveContainer>
                        </Box>
                      </Grid>

                      {/* Chart 2: Efficiency */}
                      <Grid item xs={12} md={6}>
                        <Typography variant="subtitle1" gutterBottom align="center">Efficiency (Points Per Start)</Typography>
                        <Box sx={{ height: 300 }}>
                          <ResponsiveContainer>
                            <BarChart 
                              data={VALID_POSITIONS.map(pos => ({
                                pos,
                                You: res.userStats[pos].avgPointsPerStarter,
                                Avg: res.leagueAverageStats[pos].avgPointsPerStarter
                              }))}
                            >
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey="pos" />
                              <YAxis />
                              <Tooltip />
                              <Legend />
                              <Bar dataKey="You" fill="#ffc658" />
                              <Bar dataKey="Avg" fill="#82ca9d" />
                            </BarChart>
                          </ResponsiveContainer>
                        </Box>
                      </Grid>
                    </Grid>
                  </AccordionDetails>
                </Accordion>
              </Grid>
            ))}
          </Grid>
        </Box>
      )}
    </Container>
  );
}
