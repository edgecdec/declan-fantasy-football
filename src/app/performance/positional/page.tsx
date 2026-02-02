'use client';

import * as React from 'react';
import Link from 'next/link';
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
  Chip,
  ToggleButton,
  ToggleButtonGroup
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import HistoryIcon from '@mui/icons-material/History';
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

type AggregatePositionStats = {
  position: string;
  // Total Output Stats
  avgUserPoints: number;
  avgLeaguePoints: number;
  diffPoints: number;
  diffPct: number;
  // Efficiency Stats
  avgUserEff: number;
  avgLeagueEff: number;
  diffEff: number;
  diffEffPct: number;
};

// Custom Tooltip Component
const CustomTooltip = ({ active, payload, label, metric }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload as AggregatePositionStats;
    const isTotal = metric === 'total';
    
    // Select values based on metric
    const userVal = isTotal ? data.avgUserPoints : data.avgUserEff;
    const leagueVal = isTotal ? data.avgLeaguePoints : data.avgLeagueEff;
    const diffVal = isTotal ? data.diffPoints : data.diffEff;
    const diffPct = isTotal ? data.diffPct : data.diffEffPct;
    const unit = isTotal ? 'pts/wk' : 'pts/start';

    return (
      <Paper sx={{ p: 2, bgcolor: 'rgba(20, 20, 20, 0.95)', border: '1px solid #333', minWidth: 200 }}>
        <Typography variant="h6" sx={{ mb: 1, color: '#fff', fontWeight: 'bold' }}>
          {data.position} ({isTotal ? 'Output' : 'Efficiency'})
        </Typography>
        
        <Box sx={{ mb: 1 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="body2" sx={{ color: '#aaa' }}>Your Avg:</Typography>
            <Typography variant="body2" sx={{ color: '#fff', fontWeight: 'bold' }}>{userVal.toFixed(1)} {unit}</Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="body2" sx={{ color: '#aaa' }}>League Avg:</Typography>
            <Typography variant="body2" sx={{ color: '#fff' }}>{leagueVal.toFixed(1)} {unit}</Typography>
          </Box>
        </Box>
        
        <Divider sx={{ my: 1, bgcolor: 'rgba(255,255,255,0.1)' }} />
        
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="body2" sx={{ color: '#aaa' }}>Difference:</Typography>
          <Box sx={{ textAlign: 'right' }}>
            <Typography variant="body2" sx={{ color: diffVal > 0 ? '#66bb6a' : '#ef5350', fontWeight: 'bold' }}>
              {diffVal > 0 ? '+' : ''}{diffVal.toFixed(1)}
            </Typography>
            <Typography variant="caption" sx={{ color: diffVal > 0 ? '#66bb6a' : '#ef5350' }}>
              ({diffPct > 0 ? '+' : ''}{diffPct.toFixed(1)}%)
            </Typography>
          </Box>
        </Box>
      </Paper>
    );
  }
  return null;
};

export default function PositionalBenchmarksPage() {
  const { user, fetchUser } = useUser();
  const [username, setUsername] = React.useState('');
  const [year, setYear] = React.useState('2025');
  
  const [loading, setLoading] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [status, setStatus] = React.useState('');
  
  const [results, setResults] = React.useState<LeagueBenchmarkResult[]>([]);
  const [aggregateData, setAggregateData] = React.useState<AggregatePositionStats[]>([]);
  const [metric, setMetric] = React.useState<'total' | 'efficiency'>('total');

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
    const sums = {
        total: { user: {} as Record<string, number>, league: {} as Record<string, number> },
        efficiency: { user: {} as Record<string, number>, league: {} as Record<string, number> }
    };
    const counts = {} as Record<string, number>;

    data.forEach(res => {
      VALID_POSITIONS.forEach(pos => {
        const u = res.userStats[pos];
        const l = res.leagueAverageStats[pos];
        
        if (l.avgPointsPerWeek > 0) {
          sums.total.user[pos] = (sums.total.user[pos] || 0) + u.avgPointsPerWeek;
          sums.total.league[pos] = (sums.total.league[pos] || 0) + l.avgPointsPerWeek;
          
          sums.efficiency.user[pos] = (sums.efficiency.user[pos] || 0) + u.avgPointsPerStarter;
          sums.efficiency.league[pos] = (sums.efficiency.league[pos] || 0) + l.avgPointsPerStarter;
          
          counts[pos] = (counts[pos] || 0) + 1;
        }
      });
    });

    const aggData: AggregatePositionStats[] = VALID_POSITIONS.map(pos => {
        const c = counts[pos] || 1;
        
        const avgUserPoints = sums.total.user[pos] / c;
        const avgLeaguePoints = sums.total.league[pos] / c;
        const diffPoints = avgUserPoints - avgLeaguePoints;
        const diffPct = avgLeaguePoints > 0 ? (diffPoints / avgLeaguePoints) * 100 : 0;

        const avgUserEff = sums.efficiency.user[pos] / c;
        const avgLeagueEff = sums.efficiency.league[pos] / c;
        const diffEff = avgUserEff - avgLeagueEff;
        const diffEffPct = avgLeagueEff > 0 ? (diffEff / avgLeagueEff) * 100 : 0;

        return {
            position: pos,
            avgUserPoints,
            avgLeaguePoints,
            diffPoints,
            diffPct,
            avgUserEff,
            avgLeagueEff,
            diffEff,
            diffEffPct
        };
    });

    setAggregateData(aggData);
  };

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <PageHeader 
        title="Positional Benchmarks" 
        subtitle="Compare your positional scoring output against league averages to identify roster strengths and weaknesses."
        action={
          <Link href="/performance/positional/history" passHref>
            <Button
              variant="outlined"
              startIcon={<HistoryIcon />}
              sx={{ height: 40 }}
            >
              Historical Analysis
            </Button>
          </Link>
        }
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
      {!loading && aggregateData.length > 0 && (
        <Paper sx={{ p: 3, mb: 4, bgcolor: '#1e293b' }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Box>
                <Typography variant="h5" gutterBottom color="white">Overall "Skill Profile"</Typography>
                <Typography variant="body2" color="rgba(255,255,255,0.7)">
                    Your average {metric === 'total' ? 'scoring surplus/deficit' : 'efficiency gap'} vs league average across all leagues.
                </Typography>
            </Box>
            
            <ToggleButtonGroup
                value={metric}
                exclusive
                onChange={(_, v) => v && setMetric(v)}
                size="small"
                sx={{ bgcolor: 'rgba(255,255,255,0.1)' }}
            >
                <ToggleButton value="total" sx={{ color: 'white', '&.Mui-selected': { bgcolor: 'primary.main', color: 'white' } }}>
                    Total Output
                </ToggleButton>
                <ToggleButton value="efficiency" sx={{ color: 'white', '&.Mui-selected': { bgcolor: 'primary.main', color: 'white' } }}>
                    Efficiency
                </ToggleButton>
            </ToggleButtonGroup>
          </Box>
          
          <Box sx={{ height: 400, width: '100%' }}>
            <ResponsiveContainer>
              <BarChart data={aggregateData} layout="vertical" margin={{ left: 20, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#444" horizontal={false} />
                <XAxis type="number" stroke="#888" unit="%" />
                <YAxis dataKey="position" type="category" stroke="#fff" width={50} />
                <Tooltip content={<CustomTooltip metric={metric} />} />
                <ReferenceLine x={0} stroke="#fff" />
                <Bar dataKey={metric === 'total' ? 'diffPct' : 'diffEffPct'} name="% Diff">
                  {aggregateData.map((entry, index) => {
                    const val = metric === 'total' ? entry.diffPct : entry.diffEffPct;
                    return <Cell key={`cell-${index}`} fill={val > 0 ? '#66bb6a' : '#ef5350'} />;
                  })}
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
              <Grid size={{ xs: 12 }} key={res.leagueId}>
                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography variant="h6">{res.leagueName}</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Grid container spacing={4}>
                      {/* Chart 1: Total Output */}
                      <Grid size={{ xs: 12, md: 6 }}>
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
                      <Grid size={{ xs: 12, md: 6 }}>
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