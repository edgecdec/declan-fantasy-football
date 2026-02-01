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
  CardContent,
  Avatar,
  Link as MuiLink,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Alert
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import WarningIcon from '@mui/icons-material/Warning';
import ErrorIcon from '@mui/icons-material/Error';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import MedicalServicesIcon from '@mui/icons-material/MedicalServices';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';

import { useUser } from '@/context/UserContext';
import { SleeperService, SleeperLeague, SleeperRoster } from '@/services/sleeper/sleeperService';
import playerData from '../../../data/sleeper_players.json';

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
  const { user } = useUser();
  const [loading, setLoading] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [results, setResults] = React.useState<LeagueHealth[]>([]);
  const [scanned, setScanned] = React.useState(false);

  // Constants
  const CURRENT_WEEK = 1; // TODO: Fetch from Sleeper State/NFL State

  const startScan = async () => {
    if (!user) return;
    setLoading(true);
    setProgress(0);
    setResults([]);
    setScanned(false);

    try {
      // 1. Get Leagues (2025)
      const leagues = await SleeperService.getLeagues(user.user_id, '2025');
      if (leagues.length === 0) {
        setLoading(false);
        return;
      }

      // 2. Fetch Rosters
      const rosterMap = await SleeperService.fetchAllRosters(
        leagues,
        user.user_id,
        (c, t) => setProgress((c / t) * 100)
      );

      // 3. Analyze
      const healthReports: LeagueHealth[] = [];
      const allPlayers = (playerData as any).players;

      leagues.forEach(league => {
        // Skip Best Ball / Guillotine if desired? Maybe Medic is still useful there.
        // Let's keep them for now but maybe flag differently.
        
        const roster = rosterMap.get(league.league_id);
        if (!roster) return;

        const issues: MedicIssue[] = [];
        
        // A. Check Empty Spots
        // Sleeper settings: max_roster_size usually includes bench but excludes IR/Taxi
        const maxRoster = league.settings.max_roster_size || 0;
        const totalPlayers = roster.players?.length || 0;
        const taxiCount = roster.taxi?.length || 0;
        const reserveCount = roster.reserve?.length || 0; // IR
        
        const activeCount = totalPlayers - taxiCount - reserveCount;
        
        // Note: Sometimes league.roster_positions.length is the true max size if max_roster_size is weird
        // usually max_roster_size is reliable for roster + bench.
        
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

        // B. Check IR Optimization
        const maxIr = league.settings.reserve_slots || 0;
        if (maxIr > 0 && reserveCount < maxIr) {
          // Look for eligible players on bench/starters
          const eligibleStatus = ['IR', 'PUP']; // Base eligibility
          if (league.settings.reserve_allow_out === 1) eligibleStatus.push('Out');
          if (league.settings.reserve_allow_doubtful === 1) eligibleStatus.push('Doubtful');
          if (league.settings.reserve_allow_sus === 1) eligibleStatus.push('Sus'); // Suspended? Verify key
          
          // Players NOT in reserve/taxi
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
                 message: `Move ${pInfo.first_name} ${pInfo.last_name} (${pInfo.injury_status}) to IR to free a spot.`,
                 player: pInfo
               });
            }
          });
        }

        // C. Check Starters
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
                 // Check Injury
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
                 // Check Bye (Need schedule data, skipping for now or use simplified logic if available in player obj)
                 // Note: player object doesn't update bye week dynamically usually.
               }
            }
          });
        }

        if (issues.length > 0) {
          healthReports.push({ league, issues });
        }
      });

      // Sort: Critical first, then Warning
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
    <Container maxWidth="md" sx={{ mt: 4, mb: 4 }}>
      <Box sx={{ textAlign: 'center', mb: 4 }}>
        <Typography variant="h4" gutterBottom fontWeight="bold" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
          <MedicalServicesIcon fontSize="large" color="error" /> Roster Medic
        </Typography>
        <Typography variant="body1" color="text.secondary" paragraph>
          Scan all your leagues for inactive starters, empty roster spots, and missed IR opportunities.
        </Typography>
        
        <Button 
          variant="contained" 
          size="large" 
          color="error"
          onClick={startScan}
          disabled={loading || !user}
          sx={{ px: 4, py: 1.5, fontSize: '1.1rem' }}
        >
          {loading ? 'Scanning...' : 'Scan My Rosters'}
        </Button>
      </Box>

      {loading && (
        <Box sx={{ width: '100%', mb: 4 }}>
          <LinearProgress variant="determinate" value={progress} color="error" />
          <Typography variant="caption" align="center" display="block" sx={{ mt: 1 }}>
            Checking {Math.round(progress)}%
          </Typography>
        </Box>
      )}

      {scanned && totalIssues === 0 && (
        <Alert severity="success" variant="filled" sx={{ mb: 4, justifyContent: 'center' }}>
          <Typography variant="h6">All clear! No roster issues found.</Typography>
        </Alert>
      )}

      {scanned && totalIssues > 0 && (
        <>
          <Paper sx={{ p: 2, mb: 4, bgcolor: '#fff3f3', border: '1px solid #ffcdd2' }}>
            <Typography variant="h6" color="error.main" fontWeight="bold" align="center">
              {totalIssues} Issues Found ({criticalCount} Critical)
            </Typography>
          </Paper>

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
