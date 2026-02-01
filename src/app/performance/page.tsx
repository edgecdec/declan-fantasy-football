'use client';

import * as React from 'react';
import {
  Container,
  Typography,
  Box,
  Paper,
  LinearProgress,
  Grid,
  Card,
  CardContent,
  Avatar,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Autocomplete,
  TextField,
  Divider,
  IconButton,
  Tooltip,
  Link as MuiLink,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import { SleeperService, SleeperUser, SleeperLeague, SleeperRoster, SleeperBracketMatch } from '@/services/sleeper/sleeperService';

// --- Types ---
type AnalysisStatus = 'idle' | 'pending' | 'loading' | 'complete' | 'error';

type Standing = {
  rosterId: number;
  ownerId: string;
  name: string;
  avatar: string;
  rank: number;
  madePlayoffs: boolean;
  pointsFor: number;
  rankSource: 'winner_bracket' | 'loser_bracket' | 'regular_season';
};

type LeaguePerformanceData = {
  league: SleeperLeague;
  status: AnalysisStatus;
  category: 'included' | 'excluded';
  result?: {
    rank: number;
    totalTeams: number;
    percentile: number; // 0 to 100
    madePlayoffs: boolean;
    rosterId: number;
    pointsFor: number;
    standings: Standing[];
  };
};

// --- Helper Logic ---

function getOrdinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function determineFinalRank(
  rosterId: number, 
  rosters: SleeperRoster[], 
  winnersBracket: SleeperBracketMatch[], 
  losersBracket: SleeperBracketMatch[],
  league: SleeperLeague
): { rank: number, madePlayoffs: boolean, source: 'winner_bracket' | 'loser_bracket' | 'regular_season' } {
  // 1. Check Winners Bracket
  const championship = winnersBracket.find(m => m.p === 1);
  if (championship) {
    if (championship.w === rosterId) return { rank: 1, madePlayoffs: true, source: 'winner_bracket' };
    if (championship.l === rosterId) return { rank: 2, madePlayoffs: true, source: 'winner_bracket' };
  }
  const thirdPlace = winnersBracket.find(m => m.p === 3);
  if (thirdPlace) {
    if (thirdPlace.w === rosterId) return { rank: 3, madePlayoffs: true, source: 'winner_bracket' };
    if (thirdPlace.l === rosterId) return { rank: 4, madePlayoffs: true, source: 'winner_bracket' };
  }
  const fifthPlace = winnersBracket.find(m => m.p === 5);
  if (fifthPlace) {
    if (fifthPlace.w === rosterId) return { rank: 5, madePlayoffs: true, source: 'winner_bracket' };
    if (fifthPlace.l === rosterId) return { rank: 6, madePlayoffs: true, source: 'winner_bracket' };
  }

  const inPlayoffs = winnersBracket.some(m => m.t1 === rosterId || m.t2 === rosterId);
  
  // 2. Check Losers Bracket
  const playoffTeams = league.settings.playoff_teams || 6;
  const totalTeams = rosters.length;
  
  // Auto-detect Bracket Type (Toilet Bowl vs Consolation)
  // If ANY match in the bracket comes from a 'loser' source ({l: ...}), it's a Toilet Bowl structure (Loser Advances).
  let isToiletBowl = losersBracket.some(m => m.t1_from?.l || m.t2_from?.l);
  
  // Fallback: Check setting
  if (league.settings.playoff_type === 1) isToiletBowl = true;

  const consolationMatch = losersBracket.find(m => (m.w === rosterId || m.l === rosterId) && m.p);
  
  if (consolationMatch && consolationMatch.p) {
    const isWinner = consolationMatch.w === rosterId;
    const place = consolationMatch.p;
    
    if (isToiletBowl) {
      // Toilet Bowl Logic (Loser Advances)
      // p=1 Match: The "Finals" of the Toilet Bowl (Bottom 2 teams). Determines 11th/12th.
      // p=3 Match: Determines 9th/10th.
      // p=5 Match: Determines 7th/8th (Best of the losers).
      
      // In Toilet Bowl API, 'w' is the team that "Won the Bracket Node" (Advanced).
      // But in a Toilet Bowl, Advancing means LOSING the football game (Scoring Less).
      // So 'w' = Score Loser = Worse Rank.
      // 'l' = Score Winner = Better Rank.
      
      const isBracketWinner = consolationMatch.w === rosterId; // API says we are 'w'
      
      if (place === 1) { // 11th/12th
        return { rank: isBracketWinner ? 12 : 11, madePlayoffs: false, source: 'loser_bracket' };
      }
      if (place === 3) { // 9th/10th
        return { rank: isBracketWinner ? 10 : 9, madePlayoffs: false, source: 'loser_bracket' };
      }
      if (place === 5) { // 7th/8th
        return { rank: isBracketWinner ? 8 : 7, madePlayoffs: false, source: 'loser_bracket' };
      }
      
      // Fallback
      return { rank: isBracketWinner ? 12 : 11, madePlayoffs: false, source: 'loser_bracket' };
      
    } else {
      // Consolation Logic (Winner Advances)
      // p=1 Match: Winner -> 7th, Loser -> 8th
      const offset = playoffTeams;
      if (isWinner) return { rank: offset + place, madePlayoffs: false, source: 'loser_bracket' };
      return { rank: offset + place + 1, madePlayoffs: false, source: 'loser_bracket' };
    }
  }

  // 3. Fallback: Regular Season Rank
  const sortedRosters = [...rosters].sort((a, b) => {
    if (a.settings.wins !== b.settings.wins) return b.settings.wins - a.settings.wins;
    return b.settings.fpts - a.settings.fpts;
  });
  const regSeasonRank = sortedRosters.findIndex(r => r.roster_id === rosterId) + 1;
  return { rank: regSeasonRank, madePlayoffs: inPlayoffs, source: 'regular_season' };
}

// --- Components ---

function SummaryCard({ data }: { data: LeaguePerformanceData[] }) {
  const active = data.filter(d => d.category === 'included' && d.status === 'complete');
  
  if (active.length === 0) return null;

  const avgFinish = active.reduce((s, d) => s + (d.result?.rank || 0), 0) / active.length;
  const avgPercentile = active.reduce((s, d) => s + (d.result?.percentile || 0), 0) / active.length;
  
  const championships = active.filter(d => d.result?.rank === 1).length;
  const podiums = active.filter(d => (d.result?.rank || 99) <= 3).length;
  const playoffRate = (active.filter(d => d.result?.madePlayoffs).length / active.length) * 100;

  // Expected Calculations
  const expChampionships = active.reduce((sum, d) => sum + (1 / (d.result?.totalTeams || 12)), 0);
  const expPodiums = active.reduce((sum, d) => sum + (3 / (d.result?.totalTeams || 12)), 0);

  return (
    <Card sx={{ mb: 4, bgcolor: 'secondary.dark', color: 'white' }}>
      <CardContent>
        <Grid container spacing={4} textAlign="center">
          <Grid size={{ xs: 6, md: 3 }}>
            <Typography variant="h6" color="secondary.light">Avg Finish %</Typography>
            <Typography variant="h3" fontWeight="bold">{avgPercentile.toFixed(0)}%</Typography>
            <Typography variant="caption">Avg Rank: {avgFinish.toFixed(1)}</Typography>
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <Typography variant="h6" color="secondary.light">Golds 🥇</Typography>
            <Typography variant="h3" fontWeight="bold">
              {championships} <Typography component="span" variant="body1" sx={{ opacity: 0.7 }}>({expChampionships.toFixed(1)})</Typography>
            </Typography>
            <Typography variant="caption">Exp: {expChampionships.toFixed(1)}</Typography>
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <Typography variant="h6" color="secondary.light">Podiums 🏆</Typography>
            <Typography variant="h3" fontWeight="bold">
              {podiums} <Typography component="span" variant="body1" sx={{ opacity: 0.7 }}>({expPodiums.toFixed(1)})</Typography>
            </Typography>
            <Typography variant="caption">Exp: {expPodiums.toFixed(1)}</Typography>
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <Typography variant="h6" color="secondary.light">Playoffs</Typography>
            <Typography variant="h3" fontWeight="bold">{playoffRate.toFixed(0)}%</Typography>
            <Typography variant="caption">Rate</Typography>
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );
}

function LeagueRow({ item, onToggle, userId }: { item: LeaguePerformanceData, onToggle: () => void, userId: string }) {
  const { league, status, result, category } = item;
  const isIncluded = category === 'included';

  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', mb: 1, opacity: isIncluded ? 1 : 0.75 }}>
      {/* Action Button - Outside Accordion */}
      <Tooltip title={isIncluded ? "Exclude" : "Include"}>
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
            
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <MuiLink
                href={`https://sleeper.com/leagues/${league.league_id}`}
                target="_blank"
                rel="noopener"
                color="inherit"
                underline="hover"
                onClick={(e) => e.stopPropagation()}
                sx={{ fontWeight: isIncluded ? "bold" : "normal", fontSize: '1rem', cursor: 'pointer' }}
              >
                {league.name}
              </MuiLink>
              <Box>
                {status === 'loading' && <Typography variant="caption" color="primary">Analyzing...</Typography>}
                {status === 'pending' && <Typography variant="caption" color="text.secondary">Queued</Typography>}
                {status === 'error' && <Typography variant="caption" color="error">Error</Typography>}
              </Box>
            </Box>

            {status === 'complete' && result && (
              <Box sx={{ textAlign: 'right', display: 'flex', gap: 2, alignItems: 'center' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="h5" fontWeight="bold">
                    {getOrdinal(result.rank)}
                  </Typography>
                  {result.rank === 1 && <EmojiEventsIcon sx={{ color: 'gold' }} />}
                </Box>
                <Chip 
                  label={`${result.percentile.toFixed(0)}%`} 
                  size="small" 
                  color={result.percentile > 75 ? 'success' : result.percentile > 50 ? 'info' : 'default'}
                  variant={isIncluded ? "filled" : "outlined"}
                />
              </Box>
            )}
          </Box>
        </AccordionSummary>
        
        <AccordionDetails>
          {result?.standings && (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Rank</TableCell>
                    <TableCell>Team</TableCell>
                    <TableCell align="right">Points</TableCell>
                    <TableCell align="right">Source</TableCell>
                    <TableCell align="right">Playoffs</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {result.standings.map((team) => (
                    <TableRow key={team.rosterId} selected={team.ownerId === userId} hover>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          <Typography fontWeight="bold" sx={{ width: 24 }}>{team.rank}</Typography>
                          {team.rank === 1 && <EmojiEventsIcon fontSize="small" sx={{ color: 'gold' }} />}
                          {team.rank === 2 && <EmojiEventsIcon fontSize="small" sx={{ color: 'silver' }} />}
                          {team.rank === 3 && <EmojiEventsIcon fontSize="small" sx={{ color: '#cd7f32' }} />}
                        </Box>
                      </TableCell>
                      <TableCell sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Avatar src={`https://sleepercdn.com/avatars/${team.avatar}`} sx={{ width: 24, height: 24 }} />
                        {team.name}
                        {team.ownerId === userId && <Chip label="YOU" size="small" color="primary" sx={{ height: 20 }} />}
                      </TableCell>
                      <TableCell align="right">{team.pointsFor.toFixed(0)}</TableCell>
                      <TableCell align="right">
                        <Chip 
                          label={team.rankSource === 'regular_season' ? 'Reg Season' : 'Bracket'} 
                          size="small" 
                          variant="outlined" 
                          color="default"
                        />
                      </TableCell>
                      <TableCell align="right">
                        {team.madePlayoffs ? <Chip label="Yes" size="small" color="success" variant="outlined" /> : '-'}
                      </TableCell>
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

// --- Main Page ---

export default function PerformancePage() {
  const [username, setUsername] = React.useState('');
  const [savedUsernames, setSavedUsernames] = React.useState<string[]>([]);
  const [year, setYear] = React.useState('2025');
  
  const [loadingUser, setLoadingUser] = React.useState(false);
  const [analyzing, setAnalyzing] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  
  const [leagueData, setLeagueData] = React.useState<LeaguePerformanceData[]>([]);
  const [user, setUser] = React.useState<SleeperUser | null>(null);

  const YEARS = ['2025', '2024', '2023', '2022', '2021'];

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
      
      const initialData: LeaguePerformanceData[] = leaguesRes.map(l => ({
        league: l,
        status: 'idle',
        category: SleeperService.shouldIgnoreLeague(l) ? 'excluded' : 'included',
      }));
      setLeagueData(initialData);

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
      setLeagueData(prev => prev.map(d => d.league.league_id === league.league_id ? { ...d, status: 'loading' } : d));

      try {
        const result = await analyzeLeague(league, userId);
        setLeagueData(prev => prev.map(d => 
          d.league.league_id === league.league_id 
            ? { ...d, status: 'complete', result } 
            : d
        ));
      } catch (e) {
        setLeagueData(prev => prev.map(d => d.league.league_id === league.league_id ? { ...d, status: 'error' } : d));
      }

      completed++;
      setProgress((completed / total) * 100);
      await new Promise(r => setTimeout(r, 200)); 
    }
    setAnalyzing(false);
  };

  const analyzeLeague = async (league: SleeperLeague, userId: string) => {
    const rosterRes = await fetch(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`);
    const rosters: SleeperRoster[] = await rosterRes.json();
    const myRoster = rosters.find(r => r.owner_id === userId);

    if (!myRoster) throw new Error("User not in league");

    const [winnersBracket, losersBracket, usersRes] = await Promise.all([
      SleeperService.getWinnersBracket(league.league_id),
      SleeperService.getLosersBracket(league.league_id),
      fetch(`https://api.sleeper.app/v1/league/${league.league_id}/users`)
    ]);
    const users: any[] = await usersRes.json();

    // Calculate rank for EVERY roster
    const standings = rosters.map(r => {
      const { rank, madePlayoffs, source } = determineFinalRank(r.roster_id, rosters, winnersBracket, losersBracket, league);
      const owner = users.find(u => u.user_id === r.owner_id);
      
      return {
        rosterId: r.roster_id,
        ownerId: r.owner_id,
        name: owner?.metadata?.team_name || owner?.display_name || `Team ${r.roster_id}`,
        avatar: owner?.avatar || '',
        rank,
        madePlayoffs,
        pointsFor: r.settings.fpts,
        rankSource: source
      };
    }).sort((a, b) => a.rank - b.rank);

    const myResult = standings.find(s => s.ownerId === userId);
    if (!myResult) throw new Error("User not in league");

    // Calculate Percentile for User
    const totalTeams = rosters.length;
    const percentile = totalTeams > 1 ? ((totalTeams - myResult.rank) / (totalTeams - 1)) * 100 : 100;

    return {
      rank: myResult.rank,
      totalTeams,
      percentile,
      madePlayoffs: myResult.madePlayoffs,
      rosterId: myResult.rosterId,
      pointsFor: myResult.pointsFor,
      standings // Return full standings
    };
  };

  const toggleCategory = (id: string) => {
    setLeagueData(prev => {
      const target = prev.find(d => d.league.league_id === id);
      if (!target) return prev;

      const newCategory = target.category === 'included' ? 'excluded' : 'included';
      
      if (newCategory === 'included' && (target.status === 'idle' || target.status === 'error')) {
        processQueue([target.league], user!.user_id);
      }

      return prev.map(d => d.league.league_id === id ? { ...d, category: newCategory } : d);
    });
  };

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h4" gutterBottom fontWeight="bold">
        Season Performance Analyzer
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
          <Button 
            variant="contained" 
            size="large" 
            onClick={handleStart}
            disabled={loadingUser || !username}
            sx={{ height: 56 }}
          >
            {loadingUser ? 'Fetching...' : 'Analyze Season'}
          </Button>
        </Box>
        {analyzing && <LinearProgress variant="determinate" value={progress} sx={{ mt: 3 }} />}
      </Paper>

      <SummaryCard data={leagueData} />

      {leagueData.some(d => d.category === 'included') && (
        <Box sx={{ mb: 4 }}>
          <Typography variant="h6" gutterBottom color="primary">Included Leagues</Typography>
          {leagueData
            .filter(d => d.category === 'included')
            .sort((a, b) => (a.result?.rank || 99) - (b.result?.rank || 99))
            .map(item => (
              <LeagueRow 
                key={item.league.league_id} 
                item={item} 
                onToggle={() => toggleCategory(item.league.league_id)} 
                userId={user!.user_id} 
              />
            ))}
        </Box>
      )}

      {leagueData.some(d => d.category === 'excluded') && (
        <Box sx={{ mb: 4, opacity: 0.8 }}>
          <Divider sx={{ mb: 2 }} >Excluded Leagues</Divider>
          {leagueData
            .filter(d => d.category === 'excluded')
            .sort((a, b) => (a.result?.rank || 99) - (b.result?.rank || 99))
            .map(item => (
              <LeagueRow 
                key={item.league.league_id} 
                item={item} 
                onToggle={() => toggleCategory(item.league.league_id)} 
                userId={user!.user_id} 
              />
            ))}
        </Box>
      )}
    </Container>
  );
}