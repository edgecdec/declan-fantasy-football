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
  Link as MuiLink
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import { SleeperService, SleeperUser, SleeperLeague, SleeperRoster, SleeperBracketMatch } from '@/services/sleeper/sleeperService';

// --- Types ---
type AnalysisStatus = 'idle' | 'pending' | 'loading' | 'complete' | 'error';

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
): { rank: number, madePlayoffs: boolean } {
  // 1. Check Winners Bracket
  const championship = winnersBracket.find(m => m.p === 1);
  if (championship) {
    if (championship.w === rosterId) return { rank: 1, madePlayoffs: true };
    if (championship.l === rosterId) return { rank: 2, madePlayoffs: true };
  }
  const thirdPlace = winnersBracket.find(m => m.p === 3);
  if (thirdPlace) {
    if (thirdPlace.w === rosterId) return { rank: 3, madePlayoffs: true };
    if (thirdPlace.l === rosterId) return { rank: 4, madePlayoffs: true };
  }
  const fifthPlace = winnersBracket.find(m => m.p === 5);
  if (fifthPlace) {
    if (fifthPlace.w === rosterId) return { rank: 5, madePlayoffs: true };
    if (fifthPlace.l === rosterId) return { rank: 6, madePlayoffs: true };
  }

  const inPlayoffs = winnersBracket.some(m => m.t1 === rosterId || m.t2 === rosterId);
  
  // 2. Check Losers Bracket
  const playoffTeams = league.settings.playoff_teams || 6;
  const offset = playoffTeams;
  const consolationMatch = losersBracket.find(m => (m.w === rosterId || m.l === rosterId) && m.p);
  
  if (consolationMatch && consolationMatch.p) {
    const isWinner = consolationMatch.w === rosterId;
    const place = consolationMatch.p;
    // Assuming standard consolation: Winner gets better rank
    if (isWinner) return { rank: offset + place, madePlayoffs: false };
    return { rank: offset + place + 1, madePlayoffs: false };
  }

  // 3. Fallback: Regular Season Rank
  const sortedRosters = [...rosters].sort((a, b) => {
    if (a.settings.wins !== b.settings.wins) return b.settings.wins - a.settings.wins;
    return b.settings.fpts - a.settings.fpts;
  });
  const regSeasonRank = sortedRosters.findIndex(r => r.roster_id === rosterId) + 1;
  return { rank: regSeasonRank, madePlayoffs: inPlayoffs };
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

  return (
    <Card sx={{ mb: 4, bgcolor: 'secondary.dark', color: 'white' }}>
      <CardContent>
        <Grid container spacing={4} textAlign="center">
          <Grid item xs={6} md={3}>
            <Typography variant="h6" color="secondary.light">Avg Percentile</Typography>
            <Typography variant="h3" fontWeight="bold">{avgPercentile.toFixed(0)}%</Typography>
            <Typography variant="caption">Avg Finish: {avgFinish.toFixed(1)}</Typography>
          </Grid>
          <Grid item xs={6} md={3}>
            <Typography variant="h6" color="secondary.light">Golds 🥇</Typography>
            <Typography variant="h3" fontWeight="bold">{championships}</Typography>
          </Grid>
          <Grid item xs={6} md={3}>
            <Typography variant="h6" color="secondary.light">Podiums 🏆</Typography>
            <Typography variant="h3" fontWeight="bold">{podiums}</Typography>
          </Grid>
          <Grid item xs={6} md={3}>
            <Typography variant="h6" color="secondary.light">Playoffs</Typography>
            <Typography variant="h3" fontWeight="bold">{playoffRate.toFixed(0)}%</Typography>
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );
}

function LeagueRow({ item, onToggle }: { item: LeaguePerformanceData, onToggle: () => void }) {
  const { league, status, result, category } = item;
  const isIncluded = category === 'included';

  return (
    <Card sx={{ 
      mb: 2, 
      opacity: isIncluded ? 1 : 0.75,
      borderLeft: '6px solid',
      borderColor: !result ? 'grey.500' : result.rank === 1 ? 'gold' : result.rank <= 3 ? 'silver' : result.madePlayoffs ? 'success.main' : 'error.main'
    }}>
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center' }}>
        <Tooltip title={isIncluded ? "Exclude" : "Include"}>
          <IconButton 
            size="small" 
            onClick={onToggle}
            color={isIncluded ? "error" : "success"}
            sx={{ mr: 2 }}
          >
            {isIncluded ? <RemoveCircleOutlineIcon /> : <AddCircleOutlineIcon />}
          </IconButton>
        </Tooltip>

        <Avatar src={`https://sleepercdn.com/avatars/${league.avatar}`} sx={{ mr: 2 }} />
        
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <MuiLink
            href={`https://sleeper.com/leagues/${league.league_id}`}
            target="_blank"
            rel="noopener"
            color="inherit"
            underline="hover"
            sx={{ fontWeight: 'bold', fontSize: '1.1rem', display: 'block' }}
          >
            {league.name}
          </MuiLink>
          <Typography variant="caption" color="text.secondary">
            {league.total_rosters} Teams
          </Typography>
        </Box>

        <Box sx={{ textAlign: 'right', minWidth: 100 }}>
          {status === 'loading' && <Typography variant="caption" color="primary">Analyzing...</Typography>}
          {status === 'pending' && <Typography variant="caption" color="text.secondary">Queued</Typography>}
          {status === 'complete' && result && (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1 }}>
                <Typography variant="h4" fontWeight="bold">
                  {getOrdinal(result.rank)}
                </Typography>
                {result.rank === 1 && <EmojiEventsIcon sx={{ color: 'gold' }} />}
              </Box>
              <Chip 
                label={`${result.percentile.toFixed(0)}%ile`} 
                size="small" 
                color={result.percentile > 75 ? 'success' : result.percentile > 50 ? 'info' : 'default'}
                variant="outlined"
              />
            </>
          )}
        </Box>
      </Box>
    </Card>
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

    const [winnersBracket, losersBracket] = await Promise.all([
      SleeperService.getWinnersBracket(league.league_id),
      SleeperService.getLosersBracket(league.league_id)
    ]);

    const { rank, madePlayoffs } = determineFinalRank(myRoster.roster_id, rosters, winnersBracket, losersBracket, league);
    
    // Calculate Percentile
    // Rank 1/12 -> 100%. Rank 12/12 -> 0%.
    const totalTeams = rosters.length;
    const percentile = totalTeams > 1 ? ((totalTeams - rank) / (totalTeams - 1)) * 100 : 100;

    return {
      rank,
      totalTeams,
      percentile,
      madePlayoffs,
      rosterId: myRoster.roster_id,
      pointsFor: myRoster.settings.fpts
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
          <Grid container spacing={2}>
            {leagueData.filter(d => d.category === 'included').map(item => (
              <Grid item xs={12} md={6} key={item.league.league_id}>
                <LeagueRow item={item} onToggle={() => toggleCategory(item.league.league_id)} />
              </Grid>
            ))}
          </Grid>
        </Box>
      )}

      {leagueData.some(d => d.category === 'excluded') && (
        <Box sx={{ mb: 4, opacity: 0.8 }}>
          <Divider sx={{ mb: 2 }} >Excluded Leagues</Divider>
          <Grid container spacing={2}>
            {leagueData.filter(d => d.category === 'excluded').map(item => (
              <Grid item xs={12} md={6} key={item.league.league_id}>
                <LeagueRow item={item} onToggle={() => toggleCategory(item.league.league_id)} />
              </Grid>
            ))}
          </Grid>
        </Box>
      )}
    </Container>
  );
}