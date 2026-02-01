'use client';

import * as React from 'react';
import {
  Container,
  Box,
  Paper,
  LinearProgress,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Autocomplete,
  TextField,
  Tabs,
  Tab,
  TableContainer,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Avatar,
  Tooltip,
  Typography
} from '@mui/material';
import { SleeperService, SleeperUser, SleeperLeague, SleeperRoster, SleeperMatchup } from '@/services/sleeper/sleeperService';
import PageHeader from '@/components/common/PageHeader';

// --- Types ---
type MemberHistory = {
  userId: string;
  displayName: string;
  avatar: string;
  totalWins: number;
  totalLosses: number;
  totalPoints: number;
  seasons: number;
  opponents: Record<string, { wins: number; losses: number; scoreDiff: number }>;
};

// --- Helper Components ---

function H2HMatrix({ members, mode }: { members: MemberHistory[], mode: 'record' | 'diff' }) {
  const sortedMembers = React.useMemo(() => 
    [...members].sort((a, b) => b.totalWins - a.totalWins),
  [members]);

  if (members.length === 0) return null;

  return (
    <TableContainer component={Paper} sx={{ maxHeight: 800 }}>
      <Table stickyHeader size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={{ bgcolor: 'background.paper', zIndex: 3, left: 0, position: 'sticky' }}>Owner</TableCell>
            {sortedMembers.map(m => (
              <TableCell key={m.userId} align="center" sx={{ minWidth: 60 }}>
                <Tooltip title={m.displayName}>
                  <Avatar src={`https://sleepercdn.com/avatars/${m.avatar}`} sx={{ width: 24, height: 24, mx: 'auto' }} />
                </Tooltip>
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {sortedMembers.map(row => (
            <TableRow key={row.userId}>
              <TableCell sx={{ bgcolor: 'background.paper', zIndex: 2, left: 0, position: 'sticky', fontWeight: 'bold' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Avatar src={`https://sleepercdn.com/avatars/${row.avatar}`} sx={{ width: 24, height: 24 }} />
                  <Typography variant="caption" noWrap sx={{ maxWidth: 100 }}>{row.displayName}</Typography>
                </Box>
              </TableCell>
              
              {sortedMembers.map(col => {
                if (row.userId === col.userId) {
                  return <TableCell key={col.userId} sx={{ bgcolor: 'action.disabledBackground' }} />;
                }

                const stats = row.opponents[col.userId];
                if (!stats) {
                  return <TableCell key={col.userId} align="center" sx={{ color: 'text.disabled' }}>-</TableCell>;
                }

                let content: React.ReactNode = '-';
                let color = 'transparent';

                if (mode === 'record') {
                  content = `${stats.wins}-${stats.losses}`;
                  const total = stats.wins + stats.losses;
                  if (total > 0) {
                    const winRate = stats.wins / total;
                    if (winRate > 0.5) color = 'rgba(76, 175, 80, 0.2)'; // Green
                    if (winRate < 0.5) color = 'rgba(244, 67, 54, 0.2)'; // Red
                  }
                } else {
                  const diff = stats.scoreDiff;
                  content = diff > 0 ? `+${diff.toFixed(0)}` : diff.toFixed(0);
                  if (diff > 0) color = 'rgba(76, 175, 80, 0.2)';
                  if (diff < 0) color = 'rgba(244, 67, 54, 0.2)';
                }

                return (
                  <TableCell key={col.userId} align="center" sx={{ bgcolor: color, whiteSpace: 'nowrap', fontSize: '0.75rem' }}>
                    {content}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

// --- Main Page ---

export default function LeagueHistoryPage() {
  const [username, setUsername] = React.useState('');
  const [savedUsernames, setSavedUsernames] = React.useState<string[]>([]);
  const [year, setYear] = React.useState('2025');
  
  const [loading, setLoading] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [statusText, setStatusText] = React.useState('');
  
  const [leagues, setLeagues] = React.useState<SleeperLeague[]>([]);
  const [selectedLeagueId, setSelectedLeagueId] = React.useState('');
  
  const [historyData, setHistoryData] = React.useState<MemberHistory[]>([]);
  const [viewMode, setViewMode] = React.useState<'record' | 'diff'>('record');

  const [step, setStep] = React.useState<'user' | 'league' | 'analyzing' | 'done'>('user');

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

  // Auto-fetch leagues when username is available
  React.useEffect(() => {
    if (username && leagues.length === 0 && !loading) {
      const t = setTimeout(() => handleFetchLeagues(), 800);
      return () => clearTimeout(t);
    }
  }, [username]);

  const handleFetchLeagues = async () => {
    if (!username) return;
    setLoading(true);
    try {
      const userRes = await SleeperService.getUser(username);
      if (!userRes) throw new Error('User not found');
      
      const newSaved = [username, ...savedUsernames.filter(u => u !== username)].slice(0, 5);
      setSavedUsernames(newSaved);
      localStorage.setItem('sleeper_usernames', JSON.stringify(newSaved));

      const leaguesRes = await SleeperService.getLeagues(userRes.user_id, year);
      setLeagues(leaguesRes);
      
      // Removed setStep('league') because we now render inline
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyze = async () => {
    if (!selectedLeagueId) return;
    setLoading(true);
    setProgress(0);
    setHistoryData([]); // Clear previous
    setStatusText('Tracing league history...');

    try {
      // 1. Get League History Chain
      const leagueHistory = await SleeperService.getLeagueHistory(selectedLeagueId);
      
      // Use a mutable map to accumulate data across loops
      const memberMap = new Map<string, MemberHistory>();
      const totalSeasons = leagueHistory.length;
      let processedSeasons = 0;

      for (const league of leagueHistory) {
        setStatusText(`Analyzing ${league.season} season...`);
        
        // Fetch Rosters & Users for this season
        const [rostersRes, usersRes] = await Promise.all([
          fetch(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`),
          fetch(`https://api.sleeper.app/v1/league/${league.league_id}/users`)
        ]);
        const rosters: SleeperRoster[] = await rostersRes.json();
        const users: any[] = await usersRes.json();

        // Map RosterID -> UserID for this season
        const rosterToUser = new Map<number, string>();
        
        rosters.forEach(r => {
          rosterToUser.set(r.roster_id, r.owner_id);
          
          if (!r.owner_id) return; // Skip empty rosters (orphans)

          // Init or Update User History
          if (!memberMap.has(r.owner_id)) {
            const u = users.find((x: any) => x.user_id === r.owner_id);
            memberMap.set(r.owner_id, {
              userId: r.owner_id,
              displayName: u?.display_name || 'Unknown',
              avatar: u?.avatar || '',
              totalWins: 0,
              totalLosses: 0,
              totalPoints: 0,
              seasons: 0,
              opponents: {}
            });
          }
          const m = memberMap.get(r.owner_id)!;
          m.seasons++;
          
          // Update to latest name/avatar
          const u = users.find((x: any) => x.user_id === r.owner_id);
          if (u) {
            m.displayName = u.display_name;
            m.avatar = u.avatar;
          }
        });

        // Fetch Matchups
        const weeksToFetch = league.settings.playoff_week_start ? league.settings.playoff_week_start - 1 : 14;
        const weeks = Array.from({length: weeksToFetch}, (_, i) => i + 1);
        
        // Process weeks in batches
        const BATCH_SIZE = 4;
        for (let i = 0; i < weeks.length; i += BATCH_SIZE) {
            const batch = weeks.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(async (week) => {
                const matchups = await SleeperService.getMatchups(league.league_id, week);
                if (!matchups) return;

                const games = new Map<number, SleeperMatchup[]>();
                matchups.forEach(m => {
                    if (!games.has(m.matchup_id)) games.set(m.matchup_id, []);
                    games.get(m.matchup_id)!.push(m);
                });

                games.forEach(sides => {
                    if (sides.length === 2) {
                    const m1 = sides[0];
                    const m2 = sides[1];
                    const u1 = rosterToUser.get(m1.roster_id);
                    const u2 = rosterToUser.get(m2.roster_id);

                    if (u1 && u2 && m1.points && m2.points) {
                        const hist1 = memberMap.get(u1)!;
                        const hist2 = memberMap.get(u2)!;

                        hist1.totalPoints += m1.points;
                        hist2.totalPoints += m2.points;

                        if (!hist1.opponents[u2]) hist1.opponents[u2] = { wins: 0, losses: 0, scoreDiff: 0 };
                        if (!hist2.opponents[u1]) hist2.opponents[u1] = { wins: 0, losses: 0, scoreDiff: 0 };

                        hist1.opponents[u2].scoreDiff += (m1.points - m2.points);
                        hist2.opponents[u1].scoreDiff += (m2.points - m1.points);

                        if (m1.points > m2.points) {
                            hist1.totalWins++;
                            hist2.totalLosses++;
                            hist1.opponents[u2].wins++;
                            hist2.opponents[u1].losses++;
                        } else if (m2.points > m1.points) {
                            hist2.totalWins++;
                            hist1.totalLosses++;
                            hist2.opponents[u1].wins++;
                            hist1.opponents[u2].losses++;
                        }
                    }
                    }
                });
            }));
            // Small delay to be nice
            await new Promise(r => setTimeout(r, 50)); 
        }

        // Update UI progressively
        processedSeasons++;
        setProgress((processedSeasons / totalSeasons) * 100);
        setHistoryData(Array.from(memberMap.values()));
      }

      setStatusText('Complete!');

    } catch (e) {
      console.error(e);
      setStatusText('Error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <PageHeader 
        title="Legacy League Analyzer" 
        subtitle="Visualize the entire history of your league. Rivalries, All-Time Records, and more." 
      />

      {/* Input */}
      {step === 'user' && (
        <Paper sx={{ p: 3, mb: 4 }}>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
            <Autocomplete
              freeSolo
              options={savedUsernames}
              value={username}
              onInputChange={(e, newVal) => setUsername(newVal)}
              renderInput={(params) => <TextField {...params} label="Sleeper Username" sx={{ minWidth: 200 }} />}
              disabled={loading && leagues.length === 0}
            />
            <Button 
              variant="contained" 
              onClick={handleFetchLeagues} 
              disabled={loading && leagues.length === 0}
              sx={{ height: 56 }}
            >
              Find Leagues
            </Button>
          </Box>

          {leagues.length > 0 && (
            <Box sx={{ mt: 3, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
              <FormControl sx={{ minWidth: 250 }}>
                <InputLabel>Select League</InputLabel>
                <Select value={selectedLeagueId} label="Select League" onChange={(e) => setSelectedLeagueId(e.target.value)}>
                  {leagues.map(l => (
                    <MenuItem key={l.league_id} value={l.league_id}>{l.name} ({l.season})</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Button 
                variant="contained" 
                onClick={handleAnalyze} 
                disabled={loading || !selectedLeagueId}
                sx={{ height: 56 }}
              >
                {loading ? 'Analyzing...' : 'Analyze History'}
              </Button>
            </Box>
          )}

          {loading && (
            <Box sx={{ width: '100%', mt: 3 }}>
              <Typography align="center" gutterBottom>{statusText}</Typography>
              <LinearProgress variant="determinate" value={progress} />
            </Box>
          )}
        </Paper>
      )}

      {/* Results */}
      {historyData.length > 0 && (
        <Box sx={{ mt: 4 }}>
          <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
            <Tabs value={viewMode} onChange={(_, v) => setViewMode(v)}>
              <Tab label="Head-to-Head Record" value="record" />
              <Tab label="Score Difference" value="diff" />
            </Tabs>
          </Box>
          
          <H2HMatrix members={historyData} mode={viewMode} />
        </Box>
      )}
    </Container>
  );
}
