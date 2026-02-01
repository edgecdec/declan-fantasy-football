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
  Alert,
  Grid,
  Chip
} from '@mui/material';
import { SleeperService, SleeperUser, SleeperLeague, SleeperRoster, SleeperMatchup } from '@/services/sleeper/sleeperService';

type TeamStats = {
  rosterId: number;
  ownerId: string;
  name: string;
  avatar: string;
  actualWins: number;
  expectedWins: number;
  pointsFor: number;
};

export default function ExpectedWinsPage() {
  const [username, setUsername] = React.useState('');
  const [year, setYear] = React.useState('2025');
  const [loading, setLoading] = React.useState(false);
  const [analyzing, setAnalyzing] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  
  const [user, setUser] = React.useState<SleeperUser | null>(null);
  const [leagues, setLeagues] = React.useState<SleeperLeague[]>([]);
  const [selectedLeague, setSelectedLeague] = React.useState<SleeperLeague | null>(null);
  const [results, setResults] = React.useState<TeamStats[]>([]);

  const handleFetchLeagues = async () => {
    if (!username) return;
    setLoading(true);
    setLeagues([]);
    setSelectedLeague(null);
    setResults([]);
    
    try {
      const userRes = await SleeperService.getUser(username);
      if (userRes) {
        setUser(userRes);
        const leaguesRes = await SleeperService.getLeagues(userRes.user_id, year);
        setLeagues(leaguesRes);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyzeLeague = async (league: SleeperLeague) => {
    setSelectedLeague(league);
    setAnalyzing(true);
    setProgress(0);
    setResults([]);

    try {
      // 1. Get Rosters (to map IDs to Names)
      // Note: We need rosters for THIS specific league to get names/avatars
      const rosterRes = await fetch(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`);
      const rosters: SleeperRoster[] = await rosterRes.json();
      
      const usersRes = await fetch(`https://api.sleeper.app/v1/league/${league.league_id}/users`);
      const users: any[] = await usersRes.json();

      // Map roster_id to user info
      const rosterMap = new Map<number, TeamStats>();
      rosters.forEach(r => {
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

      // 2. Analyze Weeks 1-N (Regular Season)
      // Sleeper provides 'playoff_week_start'. Regular season ends the week before.
      const playoffStart = league.settings.playoff_week_start || 15;
      const REGULAR_SEASON_WEEKS = playoffStart - 1;
      
      for (let week = 1; week <= REGULAR_SEASON_WEEKS; week++) {
        const matchups = await SleeperService.getMatchups(league.league_id, week);
        
        if (!matchups || matchups.length === 0) continue;

        // Calculate All-Play Wins for this week
        // Formula: For each team, how many other teams did they outscore?
        // EW = (Wins vs Field) / (Total Teams - 1)
        
        const validMatchups = matchups.filter(m => m.points !== undefined && m.points !== null);
        const totalTeams = validMatchups.length;
        
        if (totalTeams < 2) continue; // Skip empty weeks

        validMatchups.forEach(m1 => {
          let winsVsField = 0;
          
          validMatchups.forEach(m2 => {
            if (m1.roster_id === m2.roster_id) return;
            if (m1.points > m2.points) winsVsField += 1;
            if (m1.points === m2.points) winsVsField += 0.5;
          });

          const ew = winsVsField / (totalTeams - 1);
          
          const team = rosterMap.get(m1.roster_id);
          if (team) {
            team.expectedWins += ew;
          }
        });

        setProgress((week / REGULAR_SEASON_WEEKS) * 100);
      }

      setResults(Array.from(rosterMap.values()).sort((a, b) => b.expectedWins - a.expectedWins));

    } catch (e) {
      console.error(e);
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h4" gutterBottom fontWeight="bold">
        Expected Wins Calculator
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
        Calculate "All-Play" wins to see who is actually the best team in your league.
      </Typography>

      {/* Input Section */}
      <Paper sx={{ p: 3, mb: 4 }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <TextField
            label="Sleeper Username"
            variant="outlined"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <Button 
            variant="contained" 
            size="large" 
            onClick={handleFetchLeagues}
            disabled={loading || !username}
            sx={{ height: 56 }}
          >
            Find Leagues
          </Button>
        </Box>
      </Paper>

      {/* League List */}
      {!selectedLeague && leagues.length > 0 && (
        <Box>
          <Typography variant="h6" gutterBottom>Select a League:</Typography>
          <Grid container spacing={2}>
            {leagues.map(league => (
              <Grid item xs={12} md={6} key={league.league_id}>
                <Card 
                  sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
                  onClick={() => handleAnalyzeLeague(league)}
                >
                  <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Avatar src={`https://sleepercdn.com/avatars/${league.avatar}`} />
                    <Box>
                      <Typography variant="subtitle1" fontWeight="bold">{league.name}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {league.total_rosters} Teams • {league.status}
                      </Typography>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Box>
      )}

      {/* Analysis View */}
      {selectedLeague && (
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
            <Button variant="outlined" onClick={() => setSelectedLeague(null)}>
              ← Back to Leagues
            </Button>
            <Typography variant="h5">{selectedLeague.name}</Typography>
          </Box>

          {analyzing && (
            <Box sx={{ width: '100%', mb: 4 }}>
              <Typography variant="body2" gutterBottom>
                Calculating Expected Wins (Weeks 1-14)... {Math.round(progress)}%
              </Typography>
              <LinearProgress variant="determinate" value={progress} />
            </Box>
          )}

          {!analyzing && results.length > 0 && (
            <TableContainer component={Paper}>
              <Table>
                <TableHead>
                  <TableRow sx={{ bgcolor: 'background.default' }}>
                    <TableCell>Rank</TableCell>
                    <TableCell>Team</TableCell>
                    <TableCell align="right">Actual Wins</TableCell>
                    <TableCell align="right">Expected Wins</TableCell>
                    <TableCell align="right">Luck Difference</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {results.map((team, index) => {
                    const diff = team.actualWins - team.expectedWins;
                    return (
                      <TableRow key={team.rosterId} hover>
                        <TableCell>{index + 1}</TableCell>
                        <TableCell sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                          <Avatar src={`https://sleepercdn.com/avatars/${team.avatar}`} sx={{ width: 32, height: 32 }} />
                          {team.name}
                          {user && team.ownerId === user.user_id && <Chip label="YOU" size="small" color="primary" />}
                        </TableCell>
                        <TableCell align="right">{team.actualWins}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                          {team.expectedWins.toFixed(2)}
                        </TableCell>
                        <TableCell align="right">
                          <Chip 
                            label={diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2)}
                            color={diff > 1 ? 'success' : diff < -1 ? 'error' : 'default'}
                            size="small"
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Box>
      )}
    </Container>
  );
}
