'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Container,
  Box,
  Button,
  Paper,
  LinearProgress,
  Chip,
  Alert,
  Avatar,
  Select,
  MenuItem,
  InputLabel,
  FormControl,
  List,
  ListItem,
  ListItemText,
  Grid,
  Link as MuiLink,
  Typography
} from '@mui/material';
import { SleeperService, SleeperUser, SleeperMatchup, SleeperLeague } from '@/services/sleeper/sleeperService';
import playerData from '../../../data/sleeper_players.json';
import SmartTable, { SmartColumn } from '@/components/common/SmartTable';
import PageHeader from '@/components/common/PageHeader';
import UserSearchInput from '@/components/common/UserSearchInput';

// Types
type LeagueInfo = {
  id: string;
  name: string;
  isStarter: boolean;
};

type PortfolioItem = {
  playerId: string;
  playerData: any; 
  shares: number;
  startersCount: number;
  benchCount: number;
  exposure: number;
  leagues: LeagueInfo[];
};

const YEARS = ['2025', '2024', '2023', '2022', '2021', '2020'];
const WEEKS = Array.from({length: 18}, (_, i) => i + 1);

export default function PortfolioPage() {
  const [username, setUsername] = React.useState('');
  const [year, setYear] = React.useState('2025');
  const [week, setWeek] = React.useState<string>('live'); 
  
  const [loading, setLoading] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [statusText, setStatusText] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  
  const [user, setUser] = React.useState<SleeperUser | null>(null);
  const [portfolio, setPortfolio] = React.useState<PortfolioItem[]>([]);
  const [totalLeagues, setTotalLeagues] = React.useState(0);

  // Init username from localStorage if available
  React.useEffect(() => {
    const saved = localStorage.getItem('sleeper_usernames');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.length > 0) setUsername(parsed[0]);
      } catch (e) {}
    }
  }, []);

  // Auto-run if username exists and not loaded
  React.useEffect(() => {
    if (username && !loading && !user) {
      const t = setTimeout(() => handleAnalyze(), 500);
      return () => clearTimeout(t);
    }
  }, [username]);

  // Re-run on filter change if user is loaded
  React.useEffect(() => {
    if (user && !loading) {
      handleAnalyze();
    }
  }, [year, week]);

  // Save helper
  const saveUsername = (name: string) => {
    const saved = localStorage.getItem('sleeper_usernames');
    let list = saved ? JSON.parse(saved) : [];
    list = [name, ...list.filter((u: string) => u !== name)].slice(0, 5);
    localStorage.setItem('sleeper_usernames', JSON.stringify(list));
  };

  const handleAnalyze = async () => {
    if (!username) return;
    
    setLoading(true);
    setError(null);
    setProgress(0);
    setPortfolio([]);
    setStatusText('Finding leagues...');
    
    try {
      let currentUser = user;
      if (!currentUser || currentUser.username.toLowerCase() !== username.toLowerCase()) {
        currentUser = await SleeperService.getUser(username);
        if (!currentUser) throw new Error('User not found');
        setUser(currentUser);
        saveUsername(username);
      }

      const leagues = await SleeperService.getLeagues(currentUser.user_id, year);
      setTotalLeagues(leagues.length);

      if (leagues.length === 0) {
        setLoading(false);
        return;
      }

      // --- Progressive Loading Logic ---
      
      const playerCounts = new Map<string, { count: number, startCount: number, benchCount: number, leagues: LeagueInfo[] }>();
      const playersJson = (playerData as any).players;
      
      // Batch size for processing (update UI every X leagues)
      const BATCH_SIZE = 5;
      
      for (let i = 0; i < leagues.length; i += BATCH_SIZE) {
        const batchLeagues = leagues.slice(i, i + BATCH_SIZE);
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(leagues.length / BATCH_SIZE);
        
        setStatusText(`Analyzing batch ${batchNumber}/${totalBatches}...`);

        // 1. Fetch Rosters for Batch
        const rosterMap = await SleeperService.fetchAllRosters(
          batchLeagues, 
          currentUser.user_id,
          () => {} // No granular progress needed here, we track by batch
        );

        // 2. Fetch Matchups for Batch (if needed)
        let matchupMap = new Map<string, SleeperMatchup[]>();
        if (week !== 'live') {
          matchupMap = await SleeperService.fetchAllMatchups(
            batchLeagues,
            parseInt(week, 10),
            () => {}
          );
        }

        // 3. Process Batch
        batchLeagues.forEach(league => {
          const userRoster = rosterMap.get(league.league_id);
          if (!userRoster) return;

          let players: string[] = [];
          let starters: string[] = [];

          if (week === 'live') {
            players = userRoster.players || [];
            starters = userRoster.starters || [];
          } else {
            const leagueMatchups = matchupMap.get(league.league_id);
            const myMatchup = leagueMatchups?.find(m => m.roster_id === userRoster.roster_id);
            if (myMatchup) {
              players = myMatchup.players || [];
              starters = myMatchup.starters || [];
            }
          }

          players.forEach(pid => {
            const current = playerCounts.get(pid) || { count: 0, startCount: 0, benchCount: 0, leagues: [] };
            current.count++;
            
            const isStarter = starters.includes(pid);
            if (isStarter) current.startCount++;
            else current.benchCount++;

            current.leagues.push({
              id: league.league_id,
              name: league.name,
              isStarter
            });
            
            playerCounts.set(pid, current);
          });
        });

        // 4. Update State Progressively
        const items: PortfolioItem[] = [];
        playerCounts.forEach((data, pid) => {
          const pInfo = playersJson[pid];
          // Filter valid positions
          if (pInfo && ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(pInfo.position)) {
             items.push({
               playerId: pid,
               playerData: pInfo,
               shares: data.count,
               startersCount: data.startCount,
               benchCount: data.benchCount,
               // Exposure calc: using TOTAL leagues found, not just processed.
               // This ensures the % represents "Global Portfolio Exposure" correctly.
               exposure: (data.count / leagues.length) * 100,
               leagues: data.leagues
             });
          }
        });

        setPortfolio(items);
        setProgress(((i + batchLeagues.length) / leagues.length) * 100);
        
        // Small delay to allow UI render cycle if needed, though await helps
        await new Promise(r => setTimeout(r, 10));
      }

      setStatusText('Complete!');

    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  // Define Columns
  const columns: SmartColumn<PortfolioItem>[] = [
    { 
      id: 'playerData.last_name', 
      label: 'Player', 
      render: (item) => (
        <Typography fontWeight="bold">
          {item.playerData.first_name} {item.playerData.last_name}
        </Typography>
      )
    },
    { 
      id: 'playerData.position', 
      label: 'Position', 
      filterVariant: 'multi-select', 
      render: (item) => (
        <Chip 
          label={item.playerData.position} 
          size="small"
          color={
            item.playerData.position === 'QB' ? 'error' :
            item.playerData.position === 'RB' ? 'success' :
            item.playerData.position === 'WR' ? 'info' :
            item.playerData.position === 'TE' ? 'warning' : 'default'
          } 
        />
      )
    },
    { 
      id: 'playerData.team', 
      label: 'Team',
      filterVariant: 'multi-select'
    },
    { 
      id: 'shares', 
      label: 'Shares', 
      numeric: true,
      render: (item) => <Typography fontWeight="bold" fontSize="1.1rem">{item.shares}</Typography>
    },
    { 
      id: 'startersCount', 
      label: 'Start', 
      numeric: true,
      render: (item) => <Typography color="success.main" fontWeight="bold">{item.startersCount}</Typography>
    },
    { 
      id: 'benchCount', 
      label: 'Bench', 
      numeric: true,
      render: (item) => <Typography color="text.secondary">{item.benchCount}</Typography>
    },
    { 
      id: 'exposure', 
      label: 'Exposure', 
      numeric: true,
      render: (item) => `${item.exposure.toFixed(0)}%`
    },
  ];

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <PageHeader 
        title="Fantasy Portfolio Tracker" 
        subtitle="Analyze your exposure across all your Sleeper leagues."
        action={
          <Link href="/portfolio/trends" passHref>
            <Button variant="outlined">View Trends</Button>
          </Link>
        }
      />

      <Paper sx={{ p: 3, mb: 4 }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <UserSearchInput 
            username={username} 
            setUsername={setUsername} 
            disabled={loading} 
          />
          
          <FormControl sx={{ minWidth: 100 }}>
            <InputLabel>Year</InputLabel>
            <Select
              value={year}
              label="Year"
              onChange={(e) => setYear(e.target.value)}
              disabled={loading}
            >
              {YEARS.map(y => <MenuItem key={y} value={y}>{y}</MenuItem>)}
            </Select>
          </FormControl>

          <FormControl sx={{ minWidth: 120 }}>
            <InputLabel>Week</InputLabel>
            <Select
              value={week}
              label="Week"
              onChange={(e) => setWeek(e.target.value)}
              disabled={loading}
            >
              <MenuItem value="live">Live / End</MenuItem>
              {WEEKS.map(w => <MenuItem key={w} value={w.toString()}>Week {w}</MenuItem>)}
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

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>
        )}
      </Paper>

      {loading && (
        <Box sx={{ width: '100%', mb: 4 }}>
          <Typography variant="body2" gutterBottom align="center">
            {statusText} ({Math.round(progress)}%)
          </Typography>
          <LinearProgress variant="determinate" value={progress} />
        </Box>
      )}

      {user && (portfolio.length > 0 || !loading) && (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
            <Avatar 
              src={`https://sleepercdn.com/avatars/${user.avatar}`} 
              sx={{ width: 56, height: 56 }}
            />
            <Box>
              <Typography variant="h5">{user.display_name}</Typography>
              <Typography variant="body2" color="text.secondary">
                {totalLeagues} Leagues found in {year}
              </Typography>
            </Box>
          </Box>

          <SmartTable
            data={portfolio}
            columns={columns}
            keyField="playerId"
            defaultSortBy="shares"
            defaultSortOrder="desc"
            defaultRowsPerPage={25}
            noDataMessage="No players found in your rosters."
            renderDetailPanel={(item) => (
              <Grid container spacing={4}>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Typography variant="subtitle2" color="success.main" gutterBottom>
                    Starting In ({item.startersCount})
                  </Typography>
                  <List dense>
                    {item.leagues.filter(l => l.isStarter).map(l => (
                      <ListItem key={l.id} disablePadding>
                        <MuiLink 
                          href={`https://sleeper.com/leagues/${l.id}`} 
                          target="_blank" 
                          rel="noopener"
                          color="inherit"
                          underline="hover"
                        >
                          <ListItemText primary={l.name} />
                        </MuiLink>
                      </ListItem>
                    ))}
                  </List>
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                    Bench In ({item.benchCount})
                  </Typography>
                  <List dense>
                    {item.leagues.filter(l => !l.isStarter).map(l => (
                      <ListItem key={l.id} disablePadding>
                        <MuiLink 
                          href={`https://sleeper.com/leagues/${l.id}`} 
                          target="_blank" 
                          rel="noopener"
                          color="inherit"
                          underline="hover"
                        >
                          <ListItemText primary={l.name} />
                        </MuiLink>
                      </ListItem>
                    ))}
                  </List>
                </Grid>
              </Grid>
            )}
          />
        </>
      )}
    </Container>
  );
}