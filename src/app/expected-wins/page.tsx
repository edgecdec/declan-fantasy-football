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
  Checkbox,
  FormControlLabel,
  Autocomplete
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { SleeperService, SleeperUser, SleeperLeague, SleeperRoster, SleeperMatchup } from '@/services/sleeper/sleeperService';

// --- Types ---
type LeagueAnalysis = {
  leagueId: string;
  name: string;
  avatar: string;
  status: 'pending' | 'loading' | 'complete' | 'error';
  userStats?: {
    actualWins: number;
    expectedWins: number;
    pointsFor: number;
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
};

// --- Helper Components ---

function SummaryCard({ analyses }: { analyses: LeagueAnalysis[] }) {
  const completed = analyses.filter(a => a.status === 'complete');
  
  const totalActual = completed.reduce((sum, a) => sum + (a.userStats?.actualWins || 0), 0);
  const totalExpected = completed.reduce((sum, a) => sum + (a.userStats?.expectedWins || 0), 0);
  const diff = totalActual - totalExpected;

  const approxGames = completed.length * 14; 
  const actualPct = approxGames > 0 ? (totalActual / approxGames) * 100 : 0;
  const expectedPct = approxGames > 0 ? (totalExpected / approxGames) * 100 : 0;

  return (
    <Card sx={{ mb: 4, bgcolor: 'primary.dark', color: 'white' }}>
      <CardContent>
        <Grid container spacing={4} textAlign="center">
          <Grid item xs={12} md={4}>
            <Typography variant="h6" color="primary.light">Record</Typography>
            <Typography variant="h3" fontWeight="bold">
              {totalActual.toFixed(0)} <Typography component="span" variant="h5" color="rgba(255,255,255,0.7)">Wins</Typography>
            </Typography>
            <Typography variant="body2">Win Rate: {actualPct.toFixed(1)}%</Typography>
          </Grid>
          
          <Grid item xs={12} md={4}>
            <Typography variant="h6" color="primary.light">Expected</Typography>
            <Typography variant="h3" fontWeight="bold">
              {totalExpected.toFixed(1)} <Typography component="span" variant="h5" color="rgba(255,255,255,0.7)">Wins</Typography>
            </Typography>
            <Typography variant="body2">Exp. Win Rate: {expectedPct.toFixed(1)}%</Typography>
          </Grid>

          <Grid item xs={12} md={4}>
            <Typography variant="h6" color="primary.light">Luck</Typography>
            <Typography variant="h3" fontWeight="bold" sx={{ color: diff > 0 ? '#66bb6a' : '#f44336' }}>
              {diff > 0 ? '+' : ''}{diff.toFixed(1)}
            </Typography>
            <Typography variant="body2">Wins vs Expected</Typography>
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );
}

// --- Main Component ---

export default function ExpectedWinsPage() {
  const [username, setUsername] = React.useState('');
  const [savedUsernames, setSavedUsernames] = React.useState<string[]>([]);
  const [year, setYear] = React.useState('2025');
  
  const [loadingLeagues, setLoadingLeagues] = React.useState(false);
  const [analyzing, setAnalyzing] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  
  const [user, setUser] = React.useState<SleeperUser | null>(null);
  const [leagues, setLeagues] = React.useState<SleeperLeague[]>([]);
  
  // Selection State
  const [selectedLeagueIds, setSelectedLeagueIds] = React.useState<Set<string>>(new Set());
  const [hasFetched, setHasFetched] = React.useState(false);

  // Analysis State
  const [analyses, setAnalyses] = React.useState<LeagueAnalysis[]>([]);

  const YEARS = ['2025', '2024', '2023', '2022', '2021'];

  // Load username from local storage on mount
  React.useEffect(() => {
    const saved = localStorage.getItem('sleeper_usernames');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setSavedUsernames(parsed);
        if (parsed.length > 0) setUsername(parsed[0]);
      } catch (e) { console.error(e); }
    }
  }, []);

  const saveUsername = (name: string) => {
    if (!name) return;
    const newSaved = [name, ...savedUsernames.filter(u => u !== name)].slice(0, 5); // Keep top 5
    setSavedUsernames(newSaved);
    localStorage.setItem('sleeper_usernames', JSON.stringify(newSaved));
  };

  const handleFetchLeagues = async () => {
    if (!username) return;
    setLoadingLeagues(true);
    setHasFetched(false);
    setLeagues([]);
    setAnalyses([]);
    
    try {
      const userRes = await SleeperService.getUser(username);
      if (!userRes) throw new Error('User not found');
      setUser(userRes);
      saveUsername(username);

      const leaguesRes = await SleeperService.getLeagues(userRes.user_id, year);
      setLeagues(leaguesRes);

      // Auto-select leagues that are NOT ignored
      const initialSelection = new Set<string>();
      leaguesRes.forEach(l => {
        if (!SleeperService.shouldIgnoreLeague(l)) {
          initialSelection.add(l.league_id);
        }
      });
      setSelectedLeagueIds(initialSelection);
      setHasFetched(true);

    } catch (e) {
      console.error(e);
    } finally {
      setLoadingLeagues(false);
    }
  };

  const handleAnalyzeSelected = async () => {
    if (!user) return;
    
    // Filter leagues to only selected ones
    const leaguesToAnalyze = leagues.filter(l => selectedLeagueIds.has(l.league_id));
    
    // Initialize Analysis State
    const initialAnalyses: LeagueAnalysis[] = leaguesToAnalyze.map(l => ({
      leagueId: l.league_id,
      name: l.name,
      avatar: l.avatar || '',
      status: 'pending'
    }));
    setAnalyses(initialAnalyses);
    
    setAnalyzing(true);
    processQueue(leaguesToAnalyze, user.user_id);
  };

  const processQueue = async (leagues: SleeperLeague[], userId: string) => {
    const total = leagues.length;
    let completed = 0;

    for (const league of leagues) {
      // Update status to loading
      setAnalyses(prev => prev.map(a => 
        a.leagueId === league.league_id ? { ...a, status: 'loading' } : a
      ));

      try {
        const result = await analyzeLeague(league, userId);
        
        // Update with result
        setAnalyses(prev => prev.map(a => 
          a.leagueId === league.league_id ? { ...a, status: 'complete', ...result } : a
        ));
      } catch (e) {
        setAnalyses(prev => prev.map(a => 
          a.leagueId === league.league_id ? { ...a, status: 'error' } : a
        ));
      }

      completed++;
      setProgress((completed / total) * 100);
      
      // Rate limit delay
      await new Promise(r => setTimeout(r, 500)); 
    }
    setAnalyzing(false);
  };

  const analyzeLeague = async (league: SleeperLeague, userId: string): Promise<Partial<LeagueAnalysis>> => {
    // 1. Get Rosters & Users
    const [rostersRes, usersRes] = await Promise.all([
      fetch(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`),
      fetch(`https://api.sleeper.app/v1/league/${league.league_id}/users`)
    ]);
    const rosters: SleeperRoster[] = await rostersRes.json();
    const users: any[] = await usersRes.json();

    // Init Map
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
        pointsFor: r.settings.fpts + (r.settings.fpts_decimal || 0) / 100
      });
    });

    // 2. Process Weeks
    const playoffStart = league.settings.playoff_week_start || 15;
    const weeksToAnalyze = playoffStart - 1;
    const useMedian = league.settings.league_average_match === 1;

    const weeks = Array.from({length: weeksToAnalyze}, (_, i) => i + 1);
    
    for (let i = 0; i < weeks.length; i += 4) {
        const chunk = weeks.slice(i, i + 4);
        await Promise.all(chunk.map(async (week) => {
            const matchups = await SleeperService.getMatchups(league.league_id, week);
            if (!matchups || matchups.length < 2) return;

            const validMatchups = matchups.filter(m => m.points !== undefined && m.points !== null);
            const totalTeams = validMatchups.length;
            if (totalTeams < 2) return;

            // Sort for Median
            const sortedByScore = [...validMatchups].sort((a, b) => b.points - a.points);
            const medianCutoffIndex = Math.floor(totalTeams / 2);
            const medianThreshold = sortedByScore[medianCutoffIndex - 1]?.points || 0;

            validMatchups.forEach(m1 => {
                // H2H
                let wins = 0;
                validMatchups.forEach(m2 => {
                    if (m1.roster_id === m2.roster_id) return;
                    if (m1.points > m2.points) wins += 1;
                    if (m1.points === m2.points) wins += 0.5;
                });
                const h2hEw = wins / (totalTeams - 1);
                
                // Median
                let medianEw = 0;
                if (useMedian && m1.points >= medianThreshold && m1.points > 0) {
                    medianEw = 1;
                }

                const t = rosterMap.get(m1.roster_id);
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
        pointsFor: myStats.pointsFor
      } : undefined
    };
  };

  const handleToggleLeague = (id: string) => {
    const newSet = new Set(selectedLeagueIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedLeagueIds(newSet);
  };

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h4" gutterBottom fontWeight="bold">
        League Luck Analyzer
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
        See your "True" record across all leagues based on All-Play Expected Wins.
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
            disabled={analyzing}
          />
          
          <FormControl sx={{ minWidth: 100 }}>
            <InputLabel>Year</InputLabel>
            <Select value={year} label="Year" onChange={(e) => setYear(e.target.value)} disabled={analyzing}>
              {YEARS.map(y => <MenuItem key={y} value={y}>{y}</MenuItem>)}
            </Select>
          </FormControl>
          <Button 
            variant="contained" 
            size="large" 
            onClick={handleFetchLeagues}
            disabled={loadingLeagues || analyzing || !username}
            sx={{ height: 56 }}
          >
            {loadingLeagues ? 'Fetching...' : 'Find Leagues'}
          </Button>
        </Box>
      </Paper>

      {/* League Selection Step */}
      {hasFetched && !analyzing && analyses.length === 0 && (
        <Box sx={{ mb: 4 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">
              Found {leagues.length} Leagues ({selectedLeagueIds.size} Selected)
            </Typography>
            <Button 
              variant="contained" 
              color="primary" 
              onClick={handleAnalyzeSelected}
              disabled={selectedLeagueIds.size === 0}
            >
              Analyze Selected
            </Button>
          </Box>
          
          <Grid container spacing={2}>
            {leagues.map(l => {
              const ignored = SleeperService.shouldIgnoreLeague(l);
              return (
                <Grid item xs={12} md={6} lg={4} key={l.league_id}>
                  <Paper variant="outlined" sx={{ 
                    p: 2, 
                    display: 'flex', 
                    alignItems: 'center', 
                    opacity: selectedLeagueIds.has(l.league_id) ? 1 : 0.6,
                    bgcolor: selectedLeagueIds.has(l.league_id) ? 'background.paper' : 'action.hover'
                  }}>
                    <Checkbox 
                      checked={selectedLeagueIds.has(l.league_id)}
                      onChange={() => handleToggleLeague(l.league_id)}
                    />
                    <Avatar src={`https://sleepercdn.com/avatars/${l.avatar}`} sx={{ width: 32, height: 32, mr: 1 }} />
                    <Box sx={{ overflow: 'hidden' }}>
                      <Typography noWrap fontWeight="medium" title={l.name}>{l.name}</Typography>
                      {ignored && <Typography variant="caption" color="warning.main">Auto-Ignored</Typography>}
                    </Box>
                  </Paper>
                </Grid>
              );
            })}
          </Grid>
        </Box>
      )}

      {/* Results */}
      {(analyzing || analyses.length > 0) && (
        <>
          {analyzing && <LinearProgress variant="determinate" value={progress} sx={{ mb: 3 }} />}
          <SummaryCard analyses={analyses} />

          <Typography variant="h5" gutterBottom sx={{ mt: 4 }}>
            League Breakdown
          </Typography>
          
          {analyses.map((league) => (
            <Accordion key={league.leagueId} disabled={league.status !== 'complete'}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', pr: 2 }}>
                  <Avatar src={`https://sleepercdn.com/avatars/${league.avatar}`} sx={{ width: 32, height: 32, mr: 2 }} />
                  
                  <Box sx={{ flexGrow: 1 }}>
                    <Typography fontWeight="bold">{league.name}</Typography>
                    {league.status === 'loading' && <Typography variant="caption" color="text.secondary">Analyzing...</Typography>}
                    {league.status === 'pending' && <Typography variant="caption" color="text.secondary">Queued</Typography>}
                  </Box>

                  {league.status === 'complete' && league.userStats && (
                    <Box sx={{ textAlign: 'right', display: 'flex', gap: 2, alignItems: 'center' }}>
                      <Box>
                        <Typography variant="caption" display="block" color="text.secondary">Record</Typography>
                        <Typography fontWeight="bold">{league.userStats.actualWins.toFixed(1)} Wins</Typography>
                      </Box>
                      <Box>
                        <Typography variant="caption" display="block" color="text.secondary">Expected</Typography>
                        <Typography fontWeight="bold">{league.userStats.expectedWins.toFixed(1)} Wins</Typography>
                      </Box>
                      <Chip 
                        size="small"
                        label={`${(league.userStats.actualWins - league.userStats.expectedWins).toFixed(1)} Luck`}
                        color={league.userStats.actualWins - league.userStats.expectedWins > 0 ? 'success' : 'error'}
                        variant="outlined"
                      />
                    </Box>
                  )}
                </Box>
              </AccordionSummary>
              
              <AccordionDetails>
                {league.standings && (
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Team</TableCell>
                          <TableCell align="right">Actual</TableCell>
                          <TableCell align="right">Expected</TableCell>
                          <TableCell align="right">Diff</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {league.standings.map((team) => (
                          <TableRow key={team.rosterId} selected={user && team.ownerId === user.user_id}>
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
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </AccordionDetails>
            </Accordion>
          ))}
        </>
      )}
    </Container>
  );
}
