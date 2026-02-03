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
  ToggleButtonGroup,
  Modal,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Tooltip,
  Checkbox,
  FormControlLabel
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import HistoryIcon from '@mui/icons-material/History';
import CloseIcon from '@mui/icons-material/Close';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  Cell
} from 'recharts';
import { useUser } from '@/context/UserContext';
import { SleeperService, SleeperLeague } from '@/services/sleeper/sleeperService';
import { analyzePositionalBenchmarks, LeagueBenchmarkResult } from '@/services/stats/positionalBenchmarks';
import PageHeader from '@/components/common/PageHeader';
import UserSearchInput from '@/components/common/UserSearchInput';

const VALID_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

type LeagueResultItem = {
  league: SleeperLeague;
  result: LeagueBenchmarkResult;
  category: 'included' | 'excluded';
};

type AggregatePositionStats = {
  position: string;
  avgUserPoints: number;
  avgLeaguePoints: number;
  diffPoints: number;
  diffPct: number;
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
  
  const [results, setResults] = React.useState<LeagueResultItem[]>([]);
  const [aggregateData, setAggregateData] = React.useState<AggregatePositionStats[]>([]);
  const [metric, setMetric] = React.useState<'total' | 'efficiency'>('efficiency');
  const [globalImpacts, setGlobalImpacts] = React.useState<any[]>([]);
  const [showAllImpacts, setShowAllImpacts] = React.useState(false);
  const [includePlayoffs, setIncludePlayoffs] = React.useState(true);
  const [leagueType, setLeagueType] = React.useState<'all' | 'redraft' | 'dynasty'>('all');

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

  // Rerun aggregates when type filter changes
  React.useEffect(() => {
    if (results.length > 0) {
      calculateAggregates(results);
      calculateGlobalImpacts(results);
    }
  }, [leagueType]);

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
      // We process ALL leagues initially, but mark some as excluded
      const totalSteps = leagues.length;
      const batchResults: LeagueResultItem[] = [];

      for (let i = 0; i < totalSteps; i++) {
        const league = leagues[i];
        const isExcluded = SleeperService.shouldIgnoreLeague(league);
        setStatus(`Analyzing ${league.name}...`);
        
        try {
          const res = await analyzePositionalBenchmarks(league, currentUser.user_id, includePlayoffs);
          batchResults.push({
            league,
            result: res,
            category: isExcluded ? 'excluded' : 'included'
          });
        } catch (e) {
          console.warn(`Failed to analyze ${league.name}`, e);
        }
        
        setProgress(((i + 1) / totalSteps) * 100);
      }

      setResults(batchResults);
      calculateAggregates(batchResults);
      calculateGlobalImpacts(batchResults);

    } catch (e) {
      console.error(e);
      setStatus('Error occurred');
    } finally {
      setLoading(false);
    }
  };

  const toggleLeagueCategory = (leagueId: string) => {
    const newResults = results.map(item => 
      item.result.leagueId === leagueId 
        ? { ...item, category: item.category === 'included' ? 'excluded' : 'included' as 'included' | 'excluded' } 
        : item
    );
    setResults(newResults);
    calculateAggregates(newResults);
    calculateGlobalImpacts(newResults);
  };

  const calculateGlobalImpacts = (data: LeagueResultItem[]) => {
    const impactMap = new Map<string, { totalPOLA: number, weeks: number, name: string, pos: string }>();

    data
      .filter(item => item.category === 'included')
      .filter(item => {
        if (leagueType === 'all') return true;
        const isDynasty = item.league.settings.type === 2;
        return leagueType === 'dynasty' ? isDynasty : !isDynasty;
      })
      .forEach(item => {
        item.result.playerImpacts.forEach(p => {
          const curr = impactMap.get(p.playerId) || { totalPOLA: 0, weeks: 0, name: p.name, pos: p.position };
          curr.totalPOLA += p.totalPOLA;
          curr.weeks += p.weeksStarted;
          impactMap.set(p.playerId, curr);
        });
      });

    const sorted = Array.from(impactMap.entries()).map(([id, val]) => ({
      playerId: id,
      ...val,
      avgPOLA: val.totalPOLA / val.weeks
    })).sort((a, b) => b.totalPOLA - a.totalPOLA);

    setGlobalImpacts(sorted);
  };

  const calculateAggregates = (data: LeagueResultItem[]) => {
    const sums = {
        total: { user: {} as Record<string, number>, league: {} as Record<string, number> },
        efficiency: { user: {} as Record<string, number>, league: {} as Record<string, number> }
    };
    const counts = {} as Record<string, number>;

    // Initialize with 0
    VALID_POSITIONS.forEach(pos => {
        sums.total.user[pos] = 0;
        sums.total.league[pos] = 0;
        sums.efficiency.user[pos] = 0;
        sums.efficiency.league[pos] = 0;
        counts[pos] = 0;
    });

    data
      .filter(item => item.category === 'included')
      .filter(item => {
        if (leagueType === 'all') return true;
        const isDynasty = item.league.settings.type === 2;
        return leagueType === 'dynasty' ? isDynasty : !isDynasty;
      })
      .forEach(item => {
        const res = item.result;
      VALID_POSITIONS.forEach(pos => {
        const u = res.userStats[pos];
        const l = res.leagueAverageStats[pos];
        
        if (l.avgPointsPerWeek > 0) {
          sums.total.user[pos] += u.avgPointsPerWeek;
          sums.total.league[pos] += l.avgPointsPerWeek;
          
          sums.efficiency.user[pos] += u.avgPointsPerStarter;
          sums.efficiency.league[pos] += l.avgPointsPerStarter;
          
          counts[pos]++;
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

  const renderLeagueRow = (item: LeagueResultItem) => {
    const { result: res, category } = item;
    const isIncluded = category === 'included';

    return (
      <Grid size={{ xs: 12 }} key={res.leagueId}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', opacity: isIncluded ? 1 : 0.75 }}>
          <Tooltip title={isIncluded ? "Exclude" : "Include"}>
            <IconButton 
              size="small" 
              onClick={() => toggleLeagueCategory(res.leagueId)}
              color={isIncluded ? "error" : "success"}
              sx={{ mt: 1.5, mr: 1 }}
            >
              {isIncluded ? <RemoveCircleOutlineIcon /> : <AddCircleOutlineIcon />}
            </IconButton>
          </Tooltip>

          <Accordion sx={{ flexGrow: 1 }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="h6">{res.leagueName}</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Grid container spacing={4}>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Typography variant="subtitle1" gutterBottom align="center">Average Weekly Output</Typography>
                  <Box sx={{ height: 300 }}>
                    <ResponsiveContainer>
                      <BarChart data={VALID_POSITIONS.map(pos => ({ pos, You: res.userStats[pos].avgPointsPerWeek, Avg: res.leagueAverageStats[pos].avgPointsPerWeek }))}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="pos" />
                        <YAxis />
                        <RechartsTooltip />
                        <Legend />
                        <Bar dataKey="You" fill="#8884d8" />
                        <Bar dataKey="Avg" fill="#82ca9d" />
                      </BarChart>
                    </ResponsiveContainer>
                  </Box>
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Typography variant="subtitle1" gutterBottom align="center">Efficiency (Points Per Start)</Typography>
                  <Box sx={{ height: 300 }}>
                    <ResponsiveContainer>
                      <BarChart data={VALID_POSITIONS.map(pos => ({ pos, You: res.userStats[pos].avgPointsPerStarter, Avg: res.leagueAverageStats[pos].avgPointsPerStarter }))}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="pos" />
                        <YAxis />
                        <RechartsTooltip />
                        <Legend />
                        <Bar dataKey="You" fill="#ffc658" />
                        <Bar dataKey="Avg" fill="#82ca9d" />
                      </BarChart>
                    </ResponsiveContainer>
                  </Box>
                </Grid>
              </Grid>

              <Divider sx={{ my: 3 }} />
              <Typography variant="subtitle1" gutterBottom sx={{ mt: 2 }}>League Player Impact (Points Over League Avg)</Typography>
              <Grid container spacing={4}>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Typography variant="body2" color="text.secondary" gutterBottom>Top Contributors (Carriers)</Typography>
                  {res.playerImpacts.slice(0, 5).map((p) => (
                    <Box key={p.playerId} sx={{ display: 'flex', justifyContent: 'space-between', mb: 1, p: 1, bgcolor: 'rgba(76, 175, 80, 0.1)', borderRadius: 1 }}>
                      <Box>
                        <Typography variant="body2" fontWeight="bold">{p.name}</Typography>
                        <Typography variant="caption" color="text.secondary">{p.position} • {p.weeksStarted} starts</Typography>
                      </Box>
                      <Box sx={{ textAlign: 'right' }}>
                        <Typography variant="body2" fontWeight="bold" color="#66bb6a">+{p.totalPOLA.toFixed(1)}</Typography>
                        <Typography variant="caption" color="text.secondary">+{p.avgPOLA.toFixed(1)} / wk</Typography>
                      </Box>
                    </Box>
                  ))}
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Typography variant="body2" color="text.secondary" gutterBottom>Underperformers (Anchors)</Typography>
                  {[...res.playerImpacts].reverse().slice(0, 5).map((p) => (
                    <Box key={p.playerId} sx={{ display: 'flex', justifyContent: 'space-between', mb: 1, p: 1, bgcolor: 'rgba(239, 83, 80, 0.1)', borderRadius: 1 }}>
                      <Box>
                        <Typography variant="body2" fontWeight="bold">{p.name}</Typography>
                        <Typography variant="caption" color="text.secondary">{p.position} • {p.weeksStarted} starts</Typography>
                      </Box>
                      <Box sx={{ textAlign: 'right' }}>
                        <Typography variant="body2" fontWeight="bold" color="#ef5350">{p.totalPOLA.toFixed(1)}</Typography>
                        <Typography variant="caption" color="text.secondary">{p.avgPOLA.toFixed(1)} / wk</Typography>
                      </Box>
                    </Box>
                  ))}
                </Grid>
              </Grid>
            </AccordionDetails>
          </Accordion>
        </Box>
      </Grid>
    );
  };

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <PageHeader 
        title="Positional Benchmarks" 
        subtitle="Compare your positional scoring output against league averages to identify roster strengths and weaknesses."
        action={
          <Link href="/performance/positional/history" passHref>
            <Button variant="outlined" startIcon={<HistoryIcon />} sx={{ height: 40 }}>
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

          <FormControl sx={{ minWidth: 140 }}>
            <InputLabel>League Type</InputLabel>
            <Select 
              value={leagueType} 
              label="League Type" 
              onChange={(e) => setLeagueType(e.target.value as any)} 
              disabled={loading}
            >
              <MenuItem value="all">All Leagues</MenuItem>
              <MenuItem value="redraft">Redraft Only</MenuItem>
              <MenuItem value="dynasty">Dynasty Only</MenuItem>
            </Select>
          </FormControl>

          <FormControlLabel
            control={<Checkbox checked={includePlayoffs} onChange={(e) => setIncludePlayoffs(e.target.checked)} disabled={loading} />}
            label="Include Playoffs"
            sx={{ mr: 2 }}
          />
          <Button variant="contained" size="large" onClick={handleAnalyze} disabled={loading || !username} sx={{ height: 56 }}>
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

      {/* Aggregate Stats Section */}
      {!loading && aggregateData.length > 0 && (
        <Grid container spacing={4} sx={{ mb: 4 }}>
          {/* Chart */}
          <Grid size={{ xs: 12, lg: 8 }}>
            <Paper sx={{ p: 3, height: '100%', bgcolor: '#1e293b' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Box>
                    <Typography variant="h5" gutterBottom color="white">Overall "Skill Profile"</Typography>
                    <Typography variant="body2" color="rgba(255,255,255,0.7)">
                        Your average {metric === 'total' ? 'scoring surplus/deficit' : 'efficiency gap'} across all leagues.
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
                    <RechartsTooltip content={<CustomTooltip metric={metric} />} />
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
          </Grid>

          {/* Global Impact (MVPs) */}
          <Grid size={{ xs: 12, lg: 4 }}>
            <Paper sx={{ p: 3, height: '100%' }}>
              <Typography variant="h6" gutterBottom>Portfolio MVPs & LVPs</Typography>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
                Players who gained/lost you the most points vs position average across all leagues.
              </Typography>
              
              <Typography variant="subtitle2" color="success.main" gutterBottom sx={{ mt: 2 }}>Top Contributors (Carriers)</Typography>
              {globalImpacts.slice(0, 4).map((p) => (
                <Box key={p.playerId} sx={{ display: 'flex', justifyContent: 'space-between', mb: 1.5, p: 1, borderLeft: '4px solid #66bb6a', bgcolor: 'background.default' }}>
                  <Box>
                    <Typography variant="body2" fontWeight="bold">{p.name}</Typography>
                    <Typography variant="caption" color="text.secondary">{p.position} • {p.weeks} starts</Typography>
                  </Box>
                  <Box sx={{ textAlign: 'right' }}>
                    <Typography variant="body2" fontWeight="bold" color="#66bb6a">+{p.totalPOLA.toFixed(1)}</Typography>
                    <Typography variant="caption" color="text.secondary">+{p.avgPOLA.toFixed(1)} / wk</Typography>
                  </Box>
                </Box>
              ))}

              <Divider sx={{ my: 2 }} />

              <Typography variant="subtitle2" color="error.main" gutterBottom>Biggest Anchors</Typography>
              {[...globalImpacts].reverse().slice(0, 4).map((p) => (
                <Box key={p.playerId} sx={{ display: 'flex', justifyContent: 'space-between', mb: 1.5, p: 1, borderLeft: '4px solid #ef5350', bgcolor: 'background.default' }}>
                  <Box>
                    <Typography variant="body2" fontWeight="bold">{p.name}</Typography>
                    <Typography variant="caption" color="text.secondary">{p.position} • {p.weeks} starts</Typography>
                  </Box>
                  <Box sx={{ textAlign: 'right' }}>
                    <Typography variant="body2" fontWeight="bold" color="#ef5350">{p.totalPOLA.toFixed(1)}</Typography>
                    <Typography variant="caption" color="text.secondary">{p.avgPOLA.toFixed(1)} / wk</Typography>
                  </Box>
                </Box>
              ))}
              
              <Box sx={{ mt: 2, textAlign: 'center' }}>
                <Button variant="outlined" size="small" onClick={() => setShowAllImpacts(true)}>
                  View All Players
                </Button>
              </Box>
            </Paper>
          </Grid>
        </Grid>
      )}

      {/* Individual Leagues */}
      {!loading && results.length > 0 && (
        <Box>
          <Typography variant="h5" gutterBottom sx={{ mt: 4, mb: 2 }}>Included Leagues</Typography>
          <Grid container spacing={3}>
            {results.filter(item => item.category === 'included').map(renderLeagueRow)}
          </Grid>

          {results.some(item => item.category === 'excluded') && (
            <>
              <Divider sx={{ my: 4 }} />
              <Typography variant="h5" gutterBottom sx={{ mb: 2, opacity: 0.7 }}>Excluded Leagues</Typography>
              <Grid container spacing={3} sx={{ opacity: 0.7 }}>
                {results.filter(item => item.category === 'excluded').map(renderLeagueRow)}
              </Grid>
            </>
          )}
        </Box>
      )}

      {/* All Players Modal */}
      <Modal
        open={showAllImpacts}
        onClose={() => setShowAllImpacts(false)}
        aria-labelledby="all-impacts-modal"
      >
        <Paper sx={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '90%',
          maxWidth: 800,
          bgcolor: 'background.paper',
          boxShadow: 24,
          p: 4,
          maxHeight: '90vh',
          overflowY: 'auto'
        }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h5" component="h2">
              All Player Impacts (Global)
            </Typography>
            <IconButton onClick={() => setShowAllImpacts(false)}>
              <CloseIcon />
            </IconButton>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Cumulative Points Over League Average (POLA) across all analyzed leagues.
          </Typography>
          
          <TableContainer>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Rank</TableCell>
                  <TableCell>Player</TableCell>
                  <TableCell>Pos</TableCell>
                  <TableCell align="right">Starts</TableCell>
                  <TableCell align="right">Total Impact</TableCell>
                  <TableCell align="right">Avg Impact/Wk</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {globalImpacts.map((p, index) => (
                  <TableRow key={p.playerId} hover>
                    <TableCell>{index + 1}</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>{p.name}</TableCell>
                    <TableCell>{p.position}</TableCell>
                    <TableCell align="right">{p.weeks}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 'bold', color: p.totalPOLA > 0 ? 'success.main' : 'error.main' }}>
                      {p.totalPOLA > 0 ? '+' : ''}{p.totalPOLA.toFixed(1)}
                    </TableCell>
                    <TableCell align="right" sx={{ color: 'text.secondary' }}>
                      {p.avgPOLA > 0 ? '+' : ''}{p.avgPOLA.toFixed(1)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      </Modal>
    </Container>
  );
}