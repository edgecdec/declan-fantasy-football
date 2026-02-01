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
  Chip,
  Alert,
  Avatar,
  Select,
  MenuItem,
  InputLabel,
  FormControl,
  TableSortLabel
} from '@mui/material';
import { SleeperService, SleeperUser } from '@/services/sleeper/sleeperService';
import playerData from '../../../data/sleeper_players.json';

// Types
type PortfolioItem = {
  playerId: string;
  playerData: any; 
  shares: number;
  startersCount: number;
  benchCount: number;
  exposure: number; // calculated field for easier sorting
  leagues: {
    id: string;
    name: string;
  }[];
};

type Order = 'asc' | 'desc';

// Headers Configuration
const HEAD_CELLS = [
  { id: 'playerData.last_name', label: 'Player', numeric: false },
  { id: 'playerData.position', label: 'Position', numeric: false },
  { id: 'playerData.team', label: 'Team', numeric: false },
  { id: 'shares', label: 'Shares', numeric: true },
  { id: 'startersCount', label: 'Start', numeric: true },
  { id: 'benchCount', label: 'Bench', numeric: true },
  { id: 'exposure', label: 'Exposure', numeric: true },
];

function descendingComparator<T>(a: T, b: T, orderBy: keyof T | string) {
  let aValue: any;
  let bValue: any;

  // Handle nested sorting
  if (orderBy.startsWith('playerData.')) {
    const key = orderBy.split('.')[1];
    aValue = (a as any).playerData[key] ?? '';
    bValue = (b as any).playerData[key] ?? '';
  } else {
    aValue = (a as any)[orderBy] ?? 0;
    bValue = (b as any)[orderBy] ?? 0;
  }

  if (bValue < aValue) return -1;
  if (bValue > aValue) return 1;
  return 0;
}

function getComparator<Key extends keyof any>(
  order: Order,
  orderBy: Key,
): (a: any, b: any) => number {
  return order === 'desc'
    ? (a, b) => descendingComparator(a, b, orderBy as string)
    : (a, b) => -descendingComparator(a, b, orderBy as string);
}

export default function PortfolioPage() {
  // State
  const [username, setUsername] = React.useState('');
  const [year, setYear] = React.useState('2025');
  const [loading, setLoading] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  
  const [user, setUser] = React.useState<SleeperUser | null>(null);
  const [portfolio, setPortfolio] = React.useState<PortfolioItem[]>([]);
  const [totalLeagues, setTotalLeagues] = React.useState(0);

  // Sorting
  const [order, setOrder] = React.useState<Order>('desc');
  const [orderBy, setOrderBy] = React.useState<string>('shares');

  const handleRequestSort = (property: string) => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);
  };

  // Auto-analyze when year changes
  React.useEffect(() => {
    if (username && !loading) {
      handleAnalyze();
    }
  }, [year]);

  const sortedPortfolio = React.useMemo(() => {
    return [...portfolio].sort(getComparator(order, orderBy));
  }, [portfolio, order, orderBy]);

  const YEARS = ['2025', '2024', '2023', '2022', '2021', '2020'];

  const handleAnalyze = async () => {
    if (!username) return;
    
    setLoading(true);
    setError(null);
    setProgress(0);
    setPortfolio([]);
    setUser(null);

    try {
      const userRes = await SleeperService.getUser(username);
      if (!userRes) throw new Error('User not found');
      setUser(userRes);

      const leagues = await SleeperService.getLeagues(userRes.user_id, year);
      setTotalLeagues(leagues.length);

      if (leagues.length === 0) {
        setLoading(false);
        return;
      }

      const rosterMap = await SleeperService.fetchAllRosters(
        leagues, 
        userRes.user_id,
        (completed, total) => setProgress((completed / total) * 100)
      );

      const playerCounts = new Map<string, { count: number, startCount: number, benchCount: number, leagueIds: string[] }>();
      
      rosterMap.forEach((roster, leagueId) => {
        if (roster.players) {
          roster.players.forEach(pid => {
            const current = playerCounts.get(pid) || { count: 0, startCount: 0, benchCount: 0, leagueIds: [] };
            current.count++;
            
            const isStarter = roster.starters && roster.starters.includes(pid);
            if (isStarter) current.startCount++;
            else current.benchCount++;

            current.leagueIds.push(leagueId);
            playerCounts.set(pid, current);
          });
        }
      });

      const items: PortfolioItem[] = [];
      const playersJson = (playerData as any).players;

      playerCounts.forEach((data, pid) => {
        const pInfo = playersJson[pid];
        if (pInfo && ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(pInfo.position)) {
           items.push({
             playerId: pid,
             playerData: pInfo,
             shares: data.count,
             startersCount: data.startCount,
             benchCount: data.benchCount,
             exposure: (data.count / leagues.length) * 100,
             leagues: data.leagueIds.map(lid => {
               const l = leagues.find(x => x.league_id === lid);
               return { id: lid, name: l ? l.name : 'Unknown League' };
             })
           });
        }
      });

      // Initial sort by shares
      items.sort((a, b) => b.shares - a.shares);
      setPortfolio(items);

    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
       <Typography variant="h4" gutterBottom fontWeight="bold">
        Fantasy Portfolio Tracker
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
        Analyze your exposure across all your Sleeper leagues.
      </Typography>

      <Paper sx={{ p: 3, mb: 4 }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField
            label="Sleeper Username"
            variant="outlined"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={loading}
          />
          <FormControl sx={{ minWidth: 100 }}>
            <InputLabel>Year</InputLabel>
            <Select value={year} label="Year" onChange={(e) => setYear(e.target.value)} disabled={loading}>
              {YEARS.map(y => <MenuItem key={y} value={y}>{y}</MenuItem>)}
            </Select>
          </FormControl>
          <Button 
            variant="contained" 
            size="large" 
            onClick={handleAnalyze}
            disabled={loading || !username}
            sx={{ height: 56 }}
          >
            {loading ? 'Analyzing...' : 'Analyze Portfolio'}
          </Button>
        </Box>
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </Paper>

      {loading && (
        <Box sx={{ width: '100%', mb: 4 }}>
          <Typography variant="body2" gutterBottom>
            Scanning Leagues... {Math.round(progress)}%
          </Typography>
          <LinearProgress variant="determinate" value={progress} />
        </Box>
      )}

      {user && !loading && (
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

          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow sx={{ bgcolor: 'background.default' }}>
                  {HEAD_CELLS.map((headCell) => (
                    <TableCell
                      key={headCell.id}
                      align={headCell.numeric ? 'right' : 'left'}
                      sortDirection={orderBy === headCell.id ? order : false}
                      sx={{ fontWeight: 'bold' }}
                    >
                      <TableSortLabel
                        active={orderBy === headCell.id}
                        direction={orderBy === headCell.id ? order : 'asc'}
                        onClick={() => handleRequestSort(headCell.id)}
                      >
                        {headCell.label}
                      </TableSortLabel>
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {sortedPortfolio.map((item) => (
                  <TableRow key={item.playerId} hover>
                    <TableCell sx={{ fontWeight: 'bold' }}>
                      {item.playerData.first_name} {item.playerData.last_name}
                    </TableCell>
                    <TableCell>
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
                    </TableCell>
                    <TableCell>{item.playerData.team || 'FA'}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 'bold', fontSize: '1.1rem' }}>
                      {item.shares}
                    </TableCell>
                    <TableCell align="right" sx={{ color: 'success.main', fontWeight: 'bold' }}>
                      {item.startersCount}
                    </TableCell>
                    <TableCell align="right" sx={{ color: 'text.secondary' }}>
                      {item.benchCount}
                    </TableCell>
                    <TableCell align="right">
                      {item.exposure.toFixed(0)}%
                    </TableCell>
                  </TableRow>
                ))}
                {portfolio.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                      No players found in your rosters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
    </Container>
  );
}
