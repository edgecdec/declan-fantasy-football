'use client';

import * as React from 'react';
import {
  Container,
  Typography,
  Box,
  Paper,
  Button,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Chip,
  Card,
  Avatar,
  Link as MuiLink,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Alert,
  Autocomplete,
  TextField
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import WarningIcon from '@mui/icons-material/Warning';
import ErrorIcon from '@mui/icons-material/Error';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';

import { useUser } from '@/context/UserContext';
import { SleeperService, SleeperLeague } from '@/services/sleeper/sleeperService';
import playerData from '../../../data/sleeper_players.json';
import PageHeader from '@/components/common/PageHeader';
import UserSearchInput from '@/components/common/UserSearchInput';

// --- Types ---
type IssueType = 'critical' | 'warning' | 'info';

type MedicIssue = {
  id: string;
  leagueId: string;
  leagueName: string;
  leagueAvatar: string;
  type: IssueType;
  message: string;
  player?: any;
};

type LeagueHealth = {
  league: SleeperLeague;
  issues: MedicIssue[];
};

export default function RosterMedicPage() {
  const [username, setUsername] = React.useState('');
  
  const [loading, setLoading] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [results, setResults] = React.useState<LeagueHealth[]>([]);
  const [scanned, setScanned] = React.useState(false);
  
  const { fetchUser } = useUser(); 

  // Initialize username logic matches others (via UserSearchInput internal + parent state)
  // We rely on UserSearchInput for the dropdown, but we need to load initial state here if we want auto-fill
  React.useEffect(() => {
    const saved = localStorage.getItem('sleeper_usernames');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.length > 0) setUsername(parsed[0]);
      } catch (e) { console.error(e); }
    }
  }, []);

  // Auto-run scan when username is available
  React.useEffect(() => {
    if (username && !loading && !scanned) {
      const t = setTimeout(() => startScan(), 500);
      return () => clearTimeout(t);
    }
  }, [username]);

  const saveUsername = (name: string) => {
    if (!name) return;
    const saved = localStorage.getItem('sleeper_usernames');
    let list = saved ? JSON.parse(saved) : [];
    list = [name, ...list.filter((u: string) => u !== name)].slice(0, 5);
    localStorage.setItem('sleeper_usernames', JSON.stringify(list));
  };

  const startScan = async () => {
    if (!username) return;
    setLoading(true);
    setProgress(0);
    setResults([]);
    setScanned(false);

    try {
      const user = await SleeperService.getUser(username);
      if (!user) throw new Error("User not found");
      saveUsername(username);

      const leagues = await SleeperService.getLeagues(user.user_id, '2025');
      if (leagues.length === 0) {
        setLoading(false);
        return;
      }

      const rosterMap = await SleeperService.fetchAllRosters(
        leagues,
        user.user_id,
        (c, t) => setProgress((c / t) * 100)
      );

      const healthReports: LeagueHealth[] = [];
      const allPlayers = (playerData as any).players;

      leagues.forEach(league => {
        const roster = rosterMap.get(league.league_id);
        if (!roster) return;

        const issues: MedicIssue[] = [];
        
        // A. Empty Spots
        const maxRoster = league.settings.max_roster_size || 0;
        const totalPlayers = roster.players?.length || 0;
        const taxiCount = roster.taxi?.length || 0;
        const reserveCount = roster.reserve?.length || 0; 
        const activeCount = totalPlayers - taxiCount - reserveCount;
        
        if (maxRoster > 0 && activeCount < maxRoster) {
          const open = maxRoster - activeCount;
          issues.push({
            id: `open-${league.league_id}`,
            leagueId: league.league_id,
            leagueName: league.name,
            leagueAvatar: league.avatar || '',
            type: 'info',
            message: `You have ${open} open roster spot${open > 1 ? 's' : ''}.`
          });
        }

        // B. IR Optimization
        const maxIr = league.settings.reserve_slots || 0;
        if (maxIr > 0 && reserveCount < maxIr) {
          const eligibleStatus = ['IR', 'PUP'];
          if (league.settings.reserve_allow_out === 1) eligibleStatus.push('Out');
          if (league.settings.reserve_allow_doubtful === 1) eligibleStatus.push('Doubtful');
          if (league.settings.reserve_allow_sus === 1) eligibleStatus.push('Sus');
          
          const activePlayerIds = (roster.players || []).filter(pid => 
            (!roster.reserve || !roster.reserve.includes(pid)) && 
            (!roster.taxi || !roster.taxi.includes(pid))
          );

          activePlayerIds.forEach(pid => {
            const pInfo = allPlayers[pid];
            if (pInfo && pInfo.injury_status && eligibleStatus.includes(pInfo.injury_status)) {
               issues.push({
                 id: `ir-${league.league_id}-${pid}`,
                 leagueId: league.league_id,
                 leagueName: league.name,
                 leagueAvatar: league.avatar || '',
                 type: 'warning',
                 message: `Move ${pInfo.first_name} ${pInfo.last_name} (${pInfo.injury_status}) to IR.`,
                 player: pInfo
               });
            }
          });
        }

        // C. Starters
        if (roster.starters) {
          roster.starters.forEach((pid, index) => {
            if (pid === '0') {
               issues.push({
                 id: `start-empty-${league.league_id}-${index}`,
                 leagueId: league.league_id,
                 leagueName: league.name,
                 leagueAvatar: league.avatar || '',
                 type: 'critical',
                 message: `Empty starter slot detected!`
               });
            } else {
               const pInfo = allPlayers[pid];
               if (pInfo) {
                 if (['Out', 'IR', 'PUP', 'Doubtful'].includes(pInfo.injury_status)) {
                    issues.push({
                      id: `start-inj-${league.league_id}-${pid}`,
                      leagueId: league.league_id,
                      leagueName: league.name,
                      leagueAvatar: league.avatar || '',
                      type: 'critical',
                      message: `Starting ${pInfo.first_name} ${pInfo.last_name} is ${pInfo.injury_status || 'Inactive'}.`,
                      player: pInfo
                    });
                 }
               }
            }
          });
        }

        if (issues.length > 0) {
          healthReports.push({ league, issues });
        }
      });

      healthReports.sort((a, b) => {
        const score = (i: MedicIssue) => i.type === 'critical' ? 3 : i.type === 'warning' ? 2 : 1;
        const scoreA = a.issues.reduce((sum, i) => sum + score(i), 0);
        const scoreB = b.issues.reduce((sum, i) => sum + score(i), 0);
        return scoreB - scoreA;
      });

      setResults(healthReports);
      setScanned(true);

    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const totalIssues = results.reduce((sum, r) => sum + r.issues.length, 0);
  const criticalCount = results.reduce((sum, r) => sum + r.issues.filter(i => i.type === 'critical').length, 0);

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <PageHeader 
        title="Roster Medic" 
        subtitle="Scan all your leagues for inactive starters, empty roster spots, and missed IR opportunities." 
      />

      <Alert severity="info" sx={{ mb: 4 }}>
        <strong>Note:</strong> Roster Medic is designed for <strong>in-season use</strong>. During the offseason, many status checks (like injury status or empty starters) may show incorrect or irrelevant warnings.
      </Alert>

      {/* Input Section */}
      <Paper sx={{ p: 3, mb: 4 }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <UserSearchInput 
            username={username} 
            setUsername={setUsername} 
            disabled={loading} 
          />
          
          <Button 
            variant="contained" 
            size="large" 
            onClick={startScan}
            disabled={loading || !username}
            sx={{ height: 56, px: 4 }}
          >
            {loading ? 'Scanning...' : 'Scan My Rosters'}
          </Button>
        </Box>
        {loading && <LinearProgress variant="determinate" value={progress} color="primary" sx={{ mt: 3 }} />}
      </Paper>

      {scanned && totalIssues === 0 && (
        <Alert severity="success" variant="filled" sx={{ mb: 4 }}>
          <Typography variant="h6">All clear! No roster issues found.</Typography>
        </Alert>
      )}

      {scanned && totalIssues > 0 && (
        <>
          <Alert severity="error" variant="outlined" sx={{ mb: 4, justifyContent: 'center' }}>
            <Typography variant="h6" fontWeight="bold">
              {totalIssues} Issues Found ({criticalCount} Critical)
            </Typography>
          </Alert>

          {results.map((report) => (
            <Card key={report.league.league_id} sx={{ mb: 2, borderLeft: '6px solid', borderColor: report.issues.some(i => i.type === 'critical') ? 'error.main' : 'warning.main' }}>
              <Accordion defaultExpanded disableGutters elevation={0}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', pr: 2 }}>
                    <Avatar src={`https://sleepercdn.com/avatars/${report.league.avatar}`} sx={{ mr: 2 }} />
                    <Typography fontWeight="bold" sx={{ flexGrow: 1 }}>{report.league.name}</Typography>
                    <Chip 
                      label={`${report.issues.length} Issues`} 
                      color={report.issues.some(i => i.type === 'critical') ? 'error' : 'warning'} 
                      size="small" 
                    />
                  </Box>
                </AccordionSummary>
                <AccordionDetails sx={{ pt: 0 }}>
                  <List dense>
                    {report.issues.map((issue) => (
                      <ListItem key={issue.id}>
                        <ListItemIcon sx={{ minWidth: 40 }}>
                          {issue.type === 'critical' ? <ErrorIcon color="error" /> : 
                           issue.type === 'warning' ? <WarningIcon color="warning" /> : 
                           <CheckCircleIcon color="info" />}
                        </ListItemIcon>
                        <ListItemText 
                          primary={issue.message} 
                          primaryTypographyProps={{ 
                            fontWeight: issue.type === 'critical' ? 'bold' : 'medium',
                            color: issue.type === 'critical' ? 'error.main' : 'text.primary'
                          }}
                        />
                        <Button 
                          component={MuiLink}
                          href={`https://sleeper.com/leagues/${issue.leagueId}`}
                          target="_blank"
                          size="small"
                          endIcon={<ArrowForwardIcon />}
                        >
                          Fix
                        </Button>
                      </ListItem>
                    ))}
                  </List>
                </AccordionDetails>
              </Accordion>
            </Card>
          ))}
        </>
      )}
    </Container>
  );
}
