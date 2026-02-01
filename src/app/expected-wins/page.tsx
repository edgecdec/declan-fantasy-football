'use client';

import * as React from 'react';
import {
  Container,
  Typography,
  Box,
  TextField,
  Button,
  Paper,
  LinearProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Avatar,
  Card,
  CardContent,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Grid,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Autocomplete,
  Divider,
  IconButton,
  Tooltip,
  Checkbox,
  FormControlLabel
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import { SleeperService, SleeperUser, SleeperLeague, SleeperRoster } from '@/services/sleeper/sleeperService';

// --- Types ---
type AnalysisStatus = 'idle' | 'pending' | 'loading' | 'complete' | 'error';

type LeagueData = {
  league: SleeperLeague;
  status: AnalysisStatus;
  category: 'included' | 'excluded';
  userStats?: {
    actualWins: number;
    expectedWins: number;
    pointsFor: number;
    pointsAgainst: number;
  };
  standings?: TeamStats[];
};

type TeamStats = {
  rosterId: number;
  ownerId: string;
  name: string;
  avatar: string;
  actualWins: number;
  expectedWins: number;
  pointsFor: number;
  pointsAgainst: number;
};

// --- Helper Components ---

function SummaryCard({ data, showAdvanced }: { data: LeagueData[], showAdvanced: boolean }) {
  // Only sum up INCLUDED and COMPLETE leagues
  const active = data.filter(d => d.category === 'included' && d.status === 'complete');
  
  const totalActual = active.reduce((sum, d) => sum + (d.stats?.actualWins || 0), 0);
  const totalExpected = active.reduce((sum, d) => sum + (d.stats?.expectedWins || 0), 0);
  const diff = totalActual - totalExpected;

  // Advanced Stats
  const totalPF = active.reduce((sum, d) => sum + (d.stats?.pointsFor || 0), 0);
  const totalPA = active.reduce((sum, d) => sum + (d.stats?.pointsAgainst || 0), 0);
  const pointsDiff = totalPF - totalPA;

  const approxGames = active.length * 14; 
  const actualPct = approxGames > 0 ? (totalActual / approxGames) * 100 : 0;
  const expectedPct = approxGames > 0 ? (totalExpected / approxGames) * 100 : 0;

  return (
    <Card sx={{ mb: 4, bgcolor: 'primary.dark', color: 'white' }}>
      <CardContent>
        <Grid container spacing={4} textAlign="center">
          <Grid size={{ xs: 12, md: 4 }}>
            <Typography variant="h6" color="primary.light">Record</Typography>
            <Typography variant="h3" fontWeight="bold">
              {totalActual.toFixed(0)} <Typography component="span" variant="h5" color="rgba(255,255,255,0.7)">Wins</Typography>
            </Typography>
            <Typography variant="body2">Win Rate: {actualPct.toFixed(1)}%</Typography>
          </Grid>
          
          <Grid size={{ xs: 12, md: 4 }}>
            <Typography variant="h6" color="primary.light">Expected</Typography>
            <Typography variant="h3" fontWeight="bold">
              {totalExpected.toFixed(1)} <Typography component="span" variant="h5" color="rgba(255,255,255,0.7)">Wins</Typography>
            </Typography>
            <Typography variant="body2">Exp. Win Rate: {expectedPct.toFixed(1)}%</Typography>
          </Grid>

          <Grid size={{ xs: 12, md: 4 }}>
            <Typography variant="h6" color="primary.light">Luck</Typography>
            <Typography variant="h3" fontWeight="bold" sx={{ color: diff > 0 ? '#66bb6a' : '#f44336' }}>
              {diff > 0 ? '+' : ''}{diff.toFixed(1)}
            </Typography>
            <Typography variant="body2">Wins vs Expected</Typography>
          </Grid>

          {showAdvanced && (
            <>
              <Grid size={{ xs: 12 }}><Divider sx={{ bgcolor: 'rgba(255,255,255,0.2)' }} /></Grid>
              
              <Grid size={{ xs: 12, md: 4 }}>
                <Typography variant="h6" color="primary.light">Points For</Typography>
                <Typography variant="h4" fontWeight="bold">{totalPF.toLocaleString()}</Typography>
              </Grid>
              
              <Grid size={{ xs: 12, md: 4 }}>
                <Typography variant="h6" color="primary.light">Points Against</Typography>
                <Typography variant="h4" fontWeight="bold">{totalPA.toLocaleString()}</Typography>
              </Grid>

              <Grid size={{ xs: 12, md: 4 }}>
                <Typography variant="h6" color="primary.light">Point Diff</Typography>
                <Typography variant="h4" fontWeight="bold" sx={{ color: pointsDiff > 0 ? '#66bb6a' : '#f44336' }}>
                  {pointsDiff > 0 ? '+' : ''}{pointsDiff.toLocaleString()}
                </Typography>
              </Grid>
            </>
          )}
        </Grid>
      </CardContent>
    </Card>
  );
}

function LeagueRow({ item, userId, onToggle, showAdvanced }: { item: LeagueData, userId: string, onToggle: () => void, showAdvanced: boolean }) {
  const { league, status, stats, standings, category } = item;
  const isIncluded = category === 'included';

  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', mb: 1, opacity: isIncluded ? 1 : 0.75 }}>
      {/* Action Button - Outside Accordion */}
      <Tooltip title={isIncluded ? "Exclude from totals" : "Include in totals"}>
        <IconButton 
          size="small" 
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          color={isIncluded ? "error" : "success"}
          sx={{ mt: 1.5, mr: 1 }}
        >
          {isIncluded ? <RemoveCircleOutlineIcon /> : <AddCircleOutlineIcon />}
        </IconButton>
      </Tooltip>

      <Accordion 
        disabled={status !== 'complete'} 
        sx={{ 
          flexGrow: 1,
          border: '1px solid',
          borderColor: isIncluded ? 'transparent' : 'action.disabledBackground',
        }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', pr: 2 }}>
            <Avatar src={`https://sleepercdn.com/avatars/${league.avatar}`} sx={{ width: 32, height: 32, mr: 2 }} />
            
            <Box sx={{ flexGrow: 1 }}>
              <Typography fontWeight={isIncluded ? "bold" : "normal"}>
                {league.name}
              </Typography>
              {status === 'loading' && <Typography variant="caption" color="primary">Analyzing...</Typography>}
              {status === 'pending' && <Typography variant="caption" color="text.secondary">Queued</Typography>}
              {status === 'error' && <Typography variant="caption" color="error">Error</Typography>}
            </Box>

            {status === 'complete' && stats && (
              <Box sx={{ textAlign: 'right', display: 'flex', gap: 2, alignItems: 'center' }}>
                {showAdvanced && (
                  <Box sx={{ display: { xs: 'none', sm: 'block' }, mr: 2 }}>
                    <Typography variant="caption" display="block" color="text.secondary">PF</Typography>
                    <Typography fontWeight="bold">{stats.pointsFor.toFixed(0)}</Typography>
                  </Box>
                )}
                
                <Box>
                  <Typography variant="caption" display="block" color="text.secondary">Record</Typography>
                  <Typography fontWeight="bold">{stats.actualWins.toFixed(1)}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" display="block" color="text.secondary">Exp</Typography>
                  <Typography fontWeight="bold">{stats.expectedWins.toFixed(1)}</Typography>
                </Box>
                <Chip 
                  size="small"
                  label={`${(stats.actualWins - stats.expectedWins).toFixed(1)} Luck`}
                  color={stats.actualWins - stats.expectedWins > 0 ? 'success' : 'error'}
                  variant={isIncluded ? "filled" : "outlined"}
                />
              </Box>
            )}
          </Box>
        </AccordionSummary>
        
        <AccordionDetails>
          {standings && (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Team</TableCell>
                    <TableCell align="right">Actual</TableCell>
                    <TableCell align="right">Expected</TableCell>
                    <TableCell align="right">Diff</TableCell>
                    {showAdvanced && (
                      <>
                        <TableCell align="right">PF</TableCell>
                        <TableCell align="right">PA</TableCell>
                        <TableCell align="right">+/-</TableCell>
                      </>
                    )}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {standings.map((team) => (
                    <TableRow key={team.rosterId} selected={team.ownerId === userId}>
                      <TableCell sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Avatar src={`https://sleepercdn.com/avatars/${team.avatar}`} sx={{ width: 24, height: 24 }} />
                        {team.name}
                      </TableCell>
                      <TableCell align="right">{team.actualWins}</TableCell>
                      <TableCell align="right">{team.expectedWins.toFixed(2)}</TableCell>
                      <TableCell align="right" sx={{ 
                        color: team.actualWins - team.expectedWins > 0 ? 'success.main' : 'error.main',
                        fontWeight: 'bold'
                      }}>
                        {(team.actualWins - team.expectedWins).toFixed(2)}
                      </TableCell>
                      {showAdvanced && (
                        <>
                          <TableCell align="right">{team.pointsFor.toFixed(1)}</TableCell>
                          <TableCell align="right">{team.pointsAgainst.toFixed(1)}</TableCell>
                          <TableCell align="right" sx={{ color: team.pointsFor - team.pointsAgainst > 0 ? 'success.main' : 'error.main' }}>
                            {(team.pointsFor - team.pointsAgainst).toFixed(1)}
                          </TableCell>
                        </>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </AccordionDetails>
      </Accordion>
    </Box>
  );
}

// --- Main Component ---

export default function ExpectedWinsPage() {
  // Inputs
  const [username, setUsername] = React.useState('');
  const [savedUsernames, setSavedUsernames] = React.useState<string[]>([]);
  const [year, setYear] = React.useState('2025');
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  
  // State
  const [loadingUser, setLoadingUser] = React.useState(false);
  const [analyzing, setAnalyzing] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [user, setUser] = React.useState<SleeperUser | null>(null);
  
  // The Master Data Store
  const [leagueData, setLeagueData] = React.useState<LeagueData[]>([]);

  const YEARS = ['2025', '2024', '2023', '2022', '2021'];

  // Load Saved Usernames
  React.useEffect(() => {
    const saved = localStorage.getItem('sleeper_usernames');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setSavedUsernames(parsed);
        if (parsed.length > 0) setUsername(parsed[0]);
      } catch (e) { console.error(e); }
    }
    const savedAdv = localStorage.getItem('sleeper_show_advanced');
    if (savedAdv === 'true') setShowAdvanced(true);
  }, []);

  const toggleAdvanced = () => {
    const newVal = !showAdvanced;
    setShowAdvanced(newVal);
    localStorage.setItem('sleeper_show_advanced', String(newVal));
  };

  const saveUsername = (name: string) => {
    if (!name) return;
    const newSaved = [name, ...savedUsernames.filter(u => u !== name)].slice(0, 5);
    setSavedUsernames(newSaved);
    localStorage.setItem('sleeper_usernames', JSON.stringify(newSaved));
  };

  const handleStart = async () => {
    if (!username) return;
    setLoadingUser(true);
    setAnalyzing(false);
    setLeagueData([]);
    setProgress(0);

    try {
      const userRes = await SleeperService.getUser(username);
      if (!userRes) throw new Error('User not found');
      setUser(userRes);
      saveUsername(username);

      const leaguesRes = await SleeperService.getLeagues(userRes.user_id, year);
      
      // Initialize Data
      const initialData: LeagueData[] = leaguesRes.map(l => ({
        league: l,
        status: 'idle',
        category: SleeperService.shouldIgnoreLeague(l) ? 'excluded' : 'included',
      }));
      
      setLeagueData(initialData);
      
      // Auto-start analysis for INCLUDED leagues
      const toAnalyze = initialData.filter(d => d.category === 'included').map(d => d.league);
      setAnalyzing(true);
      processQueue(toAnalyze, userRes.user_id);

    } catch (e) {
      console.error(e);
    } finally {
      setLoadingUser(false);
    }
  };

  const processQueue = async (leaguesToProcess: SleeperLeague[], userId: string) => {
    const total = leaguesToProcess.length;
    let completed = 0;

    for (const league of leaguesToProcess) {
      // Mark as loading
      setLeagueData(prev => prev.map(d => d.league.league_id === league.league_id ? { ...d, status: 'loading' } : d));

      try {
        const result = await analyzeLeague(league, userId);
        setLeagueData(prev => prev.map(d => 
          d.league.league_id === league.league_id 
            ? { ...d, status: 'complete', stats: result.userStats, standings: result.standings } 
            : d
        ));
      } catch (e) {
        setLeagueData(prev => prev.map(d => d.league.league_id === league.league_id ? { ...d, status: 'error' } : d));
      }

      completed++;
      // We don't update global progress bar here strictly because user might add more to queue
      // But we can show a spinner if needed.
      
      await new Promise(r => setTimeout(r, 500)); 
    }
    setAnalyzing(false); // Queue finished
  };

  const toggleCategory = (id: string) => {
    setLeagueData(prev => {
      const target = prev.find(d => d.league.league_id === id);
      if (!target) return prev;

      const newCategory = target.category === 'included' ? 'excluded' : 'included';
      
      // If moving to included and NOT analyzed, trigger analysis
      if (newCategory === 'included' && (target.status === 'idle' || target.status === 'error')) {
        // Trigger background analysis for this single league
        // Note: Ideally we add to a queue manager, but firing one off is okay
        processQueue([target.league], user!.user_id);
      }

      return prev.map(d => d.league.league_id === id ? { ...d, category: newCategory } : d);
    });
  };

  // Reused Analysis Logic
  const analyzeLeague = async (league: SleeperLeague, userId: string) => {
    const [rostersRes, usersRes] = await Promise.all([
      fetch(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`),
      fetch(`https://api.sleeper.app/v1/league/${league.league_id}/users`)
    ]);
    const rosters: SleeperRoster[] = await rostersRes.json();
    const users: any[] = await usersRes.json();

    const rosterMap = new Map<number, TeamStats>();
    let myRosterId = -1;

    rosters.forEach(r => {
      if (r.owner_id === userId) myRosterId = r.roster_id;
      const owner = users.find(u => u.user_id === r.owner_id);
      rosterMap.set(r.roster_id, {
        rosterId: r.roster_id,
        ownerId: r.owner_id,
        name: owner?.metadata?.team_name || owner?.display_name || `Team ${r.roster_id}`,
        avatar: owner?.avatar || '',
        actualWins: r.settings.wins,
        expectedWins: 0,
        pointsFor: r.settings.fpts + (r.settings.fpts_decimal || 0) / 100,
        pointsAgainst: 0
      });
    });

    const playoffStart = league.settings.playoff_week_start;
    const weeksToAnalyze = (playoffStart === 0) ? 18 : (playoffStart || 15) - 1;
    const useMedian = league.settings.league_average_match === 1;

    const weeks = Array.from({length: weeksToAnalyze}, (_, i) => i + 1);
    for (let i = 0; i < weeks.length; i += 4) {
        const chunk = weeks.slice(i, i + 4);
        await Promise.all(chunk.map(async (week) => {
            const matchups = await SleeperService.getMatchups(league.league_id, week);
            if (!matchups || matchups.length < 2) return;
            const validMatchups = matchups.filter(m => m.points !== undefined && m.points !== null);
            if (validMatchups.length < 2) return;

            const sortedByScore = [...validMatchups].sort((a, b) => b.points - a.points);
            const medianCutoffIndex = Math.floor(validMatchups.length / 2);
            const medianThreshold = sortedByScore[medianCutoffIndex - 1]?.points || 0;

            validMatchups.forEach(m1 => {
                // Calculate Points Against
                const opponent = validMatchups.find(m2 => m2.matchup_id === m1.matchup_id && m2.roster_id !== m1.roster_id);
                const t = rosterMap.get(m1.roster_id);
                if (t && opponent) {
                    t.pointsAgainst += opponent.points;
                }

                let wins = 0;
                validMatchups.forEach(m2 => {
                    if (m1.roster_id === m2.roster_id) return;
                    if (m1.points > m2.points) wins += 1;
                    if (m1.points === m2.points) wins += 0.5;
                });
                const h2hEw = wins / (validMatchups.length - 1);
                
                let medianEw = 0;
                if (useMedian && m1.points >= medianThreshold && m1.points > 0) medianEw = 1;

                if (t) t.expectedWins += (h2hEw + medianEw);
            });
        }));
    }

    const standings = Array.from(rosterMap.values()).sort((a, b) => b.expectedWins - a.expectedWins);
    const myStats = rosterMap.get(myRosterId);

    return {
      standings,
      userStats: myStats ? {
        actualWins: myStats.actualWins,
        expectedWins: myStats.expectedWins,
        pointsFor: myStats.pointsFor,
        pointsAgainst: myStats.pointsAgainst
      } : undefined
    };
  };

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h4" gutterBottom fontWeight="bold">
        League Luck Analyzer
      </Typography>
      
      {/* Input */}
      <Paper sx={{ p: 3, mb: 4 }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <Autocomplete
            freeSolo
            options={savedUsernames}
            value={username}
            onInputChange={(e, newVal) => setUsername(newVal)}
            renderInput={(params) => (
              <TextField {...params} label="Sleeper Username" variant="outlined" sx={{ minWidth: 200 }} />
            )}
            disabled={analyzing || loadingUser}
          />
          <FormControl sx={{ minWidth: 100 }}>
            <InputLabel>Year</InputLabel>
            <Select value={year} label="Year" onChange={(e) => setYear(e.target.value)} disabled={analyzing}>
              {YEARS.map(y => <MenuItem key={y} value={y}>{y}</MenuItem>)}
            </Select>
          </FormControl>
          
          <FormControlLabel
            control={<Checkbox checked={showAdvanced} onChange={toggleAdvanced} />}
            label="Advanced Stats"
            sx={{ mr: 2 }}
          />

          <Button 
            variant="contained" 
            size="large" 
            onClick={handleStart}
            disabled={loadingUser || !username}
            sx={{ height: 56 }}
          >
            {loadingUser ? 'Fetching...' : 'Analyze'}
          </Button>
        </Box>
      </Paper>

      {/* Summary */}
      {leagueData.length > 0 && <SummaryCard data={leagueData} showAdvanced={showAdvanced} />}

      {/* Included Leagues */}
      {leagueData.some(d => d.category === 'included') && (
        <Box sx={{ mb: 4 }}>
          <Typography variant="h6" gutterBottom color="primary">Included Leagues</Typography>
          {leagueData.filter(d => d.category === 'included').map(item => (
            <LeagueRow 
              key={item.league.league_id} 
              item={item} 
              userId={user!.user_id} 
              onToggle={() => toggleCategory(item.league.league_id)}
              showAdvanced={showAdvanced} 
            />
          ))}
        </Box>
      )}

      {/* Excluded Leagues */}
      {leagueData.some(d => d.category === 'excluded') && (
        <Box sx={{ mb: 4, opacity: 0.8 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
            <Typography variant="h6" color="text.secondary">Excluded Leagues</Typography>
            <Chip label="Ignored from Totals" size="small" />
          </Box>
          <Divider sx={{ mb: 2 }} />
          {leagueData.filter(d => d.category === 'excluded').map(item => (
            <LeagueRow 
              key={item.league.league_id} 
              item={item} 
              userId={user!.user_id} 
              onToggle={() => toggleCategory(item.league.league_id)} 
              showAdvanced={showAdvanced} 
            />
          ))}
        </Box>
      )}
    </Container>
  );
}