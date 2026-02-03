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
  Typography,
  TableSortLabel,
  ToggleButton,
  ToggleButtonGroup
} from '@mui/material';
import { SleeperService, SleeperLeague } from '@/services/sleeper/sleeperService';
import { analyzeLeagueHistory, LeagueHistoryResult, MemberHistoryStats } from '@/services/stats/leagueHistory';
import PageHeader from '@/components/common/PageHeader';
import YearSelector from '@/components/common/YearSelector';

// --- Sub-Components ---

function StandingsTable({ members }: { members: MemberHistoryStats[] }) {
  const [orderBy, setOrderBy] = React.useState<keyof MemberHistoryStats>('regWins');
  const [order, setOrder] = React.useState<'asc' | 'desc'>('desc');

  const handleSort = (property: keyof MemberHistoryStats) => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);
  };

  const sorted = React.useMemo(() => {
    return [...members].sort((a, b) => {
      const valA = a[orderBy] as number;
      const valB = b[orderBy] as number;
      return order === 'asc' ? valA - valB : valB - valA;
    });
  }, [members, orderBy, order]);

  return (
    <TableContainer component={Paper} sx={{ maxHeight: 800 }}>
      <Table stickyHeader size="small">
        <TableHead>
          <TableRow>
            <TableCell>Manager</TableCell>
            <TableCell align="right" sortDirection={orderBy === 'seasonsPlayed' ? order : false}>
              <TableSortLabel active={orderBy === 'seasonsPlayed'} direction={orderBy === 'seasonsPlayed' ? order : 'asc'} onClick={() => handleSort('seasonsPlayed')}>
                Seasons
              </TableSortLabel>
            </TableCell>
            <TableCell align="right" sortDirection={orderBy === 'regWins' ? order : false}>
              <TableSortLabel active={orderBy === 'regWins'} direction={orderBy === 'regWins' ? order : 'asc'} onClick={() => handleSort('regWins')}>
                Reg W-L
              </TableSortLabel>
            </TableCell>
            <TableCell align="right" sortDirection={orderBy === 'regWins' ? order : false}> {/* Sort by wins proxy for % */}
               Win %
            </TableCell>
            <TableCell align="right" sortDirection={orderBy === 'totalPF' ? order : false}>
              <TableSortLabel active={orderBy === 'totalPF'} direction={orderBy === 'totalPF' ? order : 'asc'} onClick={() => handleSort('totalPF')}>
                PF
              </TableSortLabel>
            </TableCell>
            <TableCell align="right" sortDirection={orderBy === 'playoffWins' ? order : false}>
              <TableSortLabel active={orderBy === 'playoffWins'} direction={orderBy === 'playoffWins' ? order : 'asc'} onClick={() => handleSort('playoffWins')}>
                Playoff W-L
              </TableSortLabel>
            </TableCell>
            <TableCell align="right" sortDirection={orderBy === 'championships' ? order : false}>
              <TableSortLabel active={orderBy === 'championships'} direction={orderBy === 'championships' ? order : 'asc'} onClick={() => handleSort('championships')}>
                Titles
              </TableSortLabel>
            </TableCell>
            <TableCell align="right">Avg Finish</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sorted.map((m) => {
            const totalReg = m.regWins + m.regLosses + m.regTies;
            const winPct = totalReg > 0 ? ((m.regWins / totalReg) * 100).toFixed(1) : '0.0';
            const avgFinish = m.seasonsPlayed > 0 ? (m.sumFinalRanks / m.seasonsPlayed).toFixed(1) : '-';

            return (
              <TableRow key={m.userId} hover>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Avatar src={`https://sleepercdn.com/avatars/${m.avatar}`} sx={{ width: 24, height: 24 }} />
                    <Box>
                      <Typography variant="body2" fontWeight="bold">{m.displayName}</Typography>
                      <Typography variant="caption" color="text.secondary">{m.teamName}</Typography>
                    </Box>
                  </Box>
                </TableCell>
                <TableCell align="right">{m.seasonsPlayed}</TableCell>
                <TableCell align="right">{m.regWins}-{m.regLosses}{m.regTies > 0 ? `-${m.regTies}` : ''}</TableCell>
                <TableCell align="right">{winPct}%</TableCell>
                <TableCell align="right">{m.totalPF.toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                <TableCell align="right">{m.playoffWins}-{m.playoffLosses}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 'bold', color: m.championships > 0 ? 'gold' : 'inherit' }}>
                  {m.championships}
                </TableCell>
                <TableCell align="right">{avgFinish}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function H2HMatrix({ members, mode }: { members: MemberHistoryStats[], mode: 'record' | 'diff' }) {
  const sortedMembers = React.useMemo(() => 
    [...members].sort((a, b) => b.regWins - a.regWins),
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
                  <Typography variant="caption" display="block" noWrap sx={{ maxWidth: 80 }}>{row.displayName}</Typography>
                </Box>
              </TableCell>
              
              {sortedMembers.map(col => {
                if (row.userId === col.userId) return <TableCell key={col.userId} sx={{ bgcolor: '#eee' }} />;

                const stats = row.opponents[col.userId];
                if (!stats) return <TableCell key={col.userId} align="center" sx={{ color: 'text.disabled' }}>-</TableCell>;

                let content: React.ReactNode = '-';
                let color = 'transparent';

                if (mode === 'record') {
                  content = `${stats.wins}-${stats.losses}`;
                  const total = stats.wins + stats.losses;
                  if (total > 0) {
                    const winRate = stats.wins / total;
                    if (winRate > 0.5) color = 'rgba(76, 175, 80, 0.2)';
                    if (winRate < 0.5) color = 'rgba(244, 67, 54, 0.2)';
                  }
                } else {
                  const diff = stats.scoreDiff;
                  content = diff > 0 ? `+${diff.toFixed(0)}` : diff.toFixed(0);
                  if (diff > 0) color = 'rgba(76, 175, 80, 0.2)';
                  if (diff < 0) color = 'rgba(244, 67, 54, 0.2)';
                }

                return (
                  <TableCell key={col.userId} align="center" sx={{ bgcolor: color, fontSize: '0.75rem' }}>
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

function PositionalHeatmap({ members }: { members: MemberHistoryStats[] }) {
  const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
  
  // Calculate League Averages per Position (Total Points / Seasons)
  // Wait, some members play fewer seasons.
  // We should calculate Avg Points PER SEASON per Position.
  
  const heatmapData = React.useMemo(() => {
    // 1. Calculate Average Per Season for each Member
    const memberAvgs = members.map(m => {
      const avgs: Record<string, number> = {};
      POSITIONS.forEach(p => {
        avgs[p] = m.seasonsPlayed > 0 ? (m.positionalPoints[p] || 0) / m.seasonsPlayed : 0;
      });
      return { ...m, avgs };
    });

    // 2. Calculate League Baseline (Avg of Member Avgs)
    const leagueBaselines: Record<string, number> = {};
    POSITIONS.forEach(p => {
      const sum = memberAvgs.reduce((acc, m) => acc + m.avgs[p], 0);
      leagueBaselines[p] = sum / (memberAvgs.length || 1);
    });

    return { memberAvgs, leagueBaselines };
  }, [members]);

  const { memberAvgs, leagueBaselines } = heatmapData;

  // Sort by Total Points (roughly)
  const sortedMembers = [...memberAvgs].sort((a, b) => b.totalPF - a.totalPF);

  return (
    <TableContainer component={Paper}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Manager</TableCell>
            {POSITIONS.map(p => <TableCell key={p} align="center">{p}</TableCell>)}
          </TableRow>
        </TableHead>
        <TableBody>
          {sortedMembers.map(m => (
            <TableRow key={m.userId}>
              <TableCell component="th" scope="row">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Avatar src={`https://sleepercdn.com/avatars/${m.avatar}`} sx={{ width: 24, height: 24 }} />
                  <Typography variant="body2">{m.displayName}</Typography>
                </Box>
              </TableCell>
              {POSITIONS.map(p => {
                const val = m.avgs[p];
                const baseline = leagueBaselines[p];
                const diff = val - baseline;
                const pctDiff = baseline > 0 ? diff / baseline : 0;
                
                // Color Logic: +/- 20%
                // Red (-0.2) -> White (0) -> Green (+0.2)
                let bgColor = 'transparent';
                if (pctDiff > 0) {
                   const intensity = Math.min(pctDiff / 0.3, 1); // Cap at 30% better
                   bgColor = `rgba(76, 175, 80, ${intensity * 0.5})`; 
                } else {
                   const intensity = Math.min(Math.abs(pctDiff) / 0.3, 1);
                   bgColor = `rgba(244, 67, 54, ${intensity * 0.5})`;
                }

                return (
                  <TableCell key={p} align="center" sx={{ bgcolor: bgColor }}>
                    <Tooltip title={`${val.toFixed(0)} avg pts (${diff > 0 ? '+' : ''}${diff.toFixed(0)} vs avg)`}>
                      <span>{val.toFixed(0)}</span>
                    </Tooltip>
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
  const [userId, setUserId] = React.useState<string | undefined>(undefined);
  const [savedUsernames, setSavedUsernames] = React.useState<string[]>([]);
  const [year, setYear] = React.useState('2025');
  
  const [loading, setLoading] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [statusText, setStatusText] = React.useState('');
  
  const [leagues, setLeagues] = React.useState<SleeperLeague[]>([]);
  const [selectedLeagueId, setSelectedLeagueId] = React.useState('');
  
  const [result, setResult] = React.useState<LeagueHistoryResult | null>(null);
  const [tab, setTab] = React.useState(0);
  const [h2hMode, setH2HMode] = React.useState<'record' | 'diff'>('record');

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

  const handleFetchLeagues = async () => {
    if (!username) return;
    setLoading(true);
    try {
      const userRes = await SleeperService.getUser(username);
      if (!userRes) throw new Error('User not found');
      
      setUserId(userRes.user_id);
      const newSaved = [username, ...savedUsernames.filter(u => u !== username)].slice(0, 5);
      setSavedUsernames(newSaved);
      localStorage.setItem('sleeper_usernames', JSON.stringify(newSaved));

      const leaguesRes = await SleeperService.getLeagues(userRes.user_id, year);
      setLeagues(leaguesRes);
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
    setResult(null);
    setStatusText('Starting...');

    try {
      const res = await analyzeLeagueHistory(selectedLeagueId, (msg, pct) => {
        setStatusText(msg);
        setProgress(pct);
      });
      setResult(res);
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
          <YearSelector 
            userId={userId} 
            selectedYear={year} 
            onChange={setYear} 
            disabled={loading} 
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

      {/* Results */}
      {result && (
        <Paper sx={{ width: '100%', mb: 2 }}>
          <Tabs
            value={tab}
            onChange={(e, v) => setTab(v)}
            indicatorColor="primary"
            textColor="primary"
            centered
          >
            <Tab label="Historical Standings" />
            <Tab label="Head-to-Head Matrix" />
            <Tab label="Positional Heatmap" />
          </Tabs>

          <Box sx={{ p: 2 }}>
            {tab === 0 && <StandingsTable members={result.members} />}
            
            {tab === 1 && (
              <Box>
                <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
                  <ToggleButtonGroup
                    value={h2hMode}
                    exclusive
                    onChange={(_, v) => v && setH2HMode(v)}
                    size="small"
                  >
                    <ToggleButton value="record">Win-Loss Record</ToggleButton>
                    <ToggleButton value="diff">Score Difference</ToggleButton>
                  </ToggleButtonGroup>
                </Box>
                <H2HMatrix members={result.members} mode={h2hMode} />
              </Box>
            )}

            {tab === 2 && <PositionalHeatmap members={result.members} />}
          </Box>
        </Paper>
      )}
    </Container>
  );
}