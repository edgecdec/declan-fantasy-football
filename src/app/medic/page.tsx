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
import { starterSlotLabel } from '@/services/stats/lineupSlots';
import { espnTeamCode, type NflGamesResponse } from '@/app/api/betting/nfl-games/route';
import useSeason from '@/hooks/useSeason';
import { safeLocalSet } from '@/services/common/cacheService';

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
  /**
   * Problems that are real but can no longer be fixed, because the player's game has started.
   *
   * Counted rather than silently dropped. A to-do list should only list things you can do — an
   * inactive starter whose game kicked off two hours ago is a fact, not a task — but hiding them
   * without trace would leave someone wondering whether the scan had run.
   */
  lockedCount: number;
};

export default function RosterMedicPage() {
  const [username, setUsername] = React.useState('');
  // Medic is a "check my current rosters" tool with no year picker by design, so
  // it just tracks whichever season the user's rosters live in.
  const { season, loading: seasonLoading } = useSeason('roster');

  const [loading, setLoading] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [results, setResults] = React.useState<LeagueHealth[]>([]);
  const [scanned, setScanned] = React.useState(false);
  /** Problems whose games have started, so they can no longer be acted on. */
  const [lockedTotal, setLockedTotal] = React.useState(0);
  
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
    // Wait for the season, or the scan would request leagues for an empty year.
    if (seasonLoading || !season) return;
    if (username && !loading && !scanned) {
      const t = setTimeout(() => startScan(), 500);
      return () => clearTimeout(t);
    }
  }, [username, seasonLoading, season]);

  const saveUsername = (name: string) => {
    if (!name) return;
    const saved = localStorage.getItem('sleeper_usernames');
    let list = saved ? JSON.parse(saved) : [];
    list = [name, ...list.filter((u: string) => u !== name)].slice(0, 5);
    safeLocalSet('sleeper_usernames', JSON.stringify(list));
  };

  const startScan = async () => {
    if (!username) return;
    setLoading(true);
    setProgress(0);
    setResults([]);
    setLockedTotal(0);
    setScanned(false);

    try {
      const user = await SleeperService.getUser(username);
      if (!user) throw new Error("User not found");
      saveUsername(username);

      const leagues = await SleeperService.getLeagues(user.user_id, season);
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
      // Locked problems in leagues that ended up with nothing actionable at all.
      let lockedElsewhere = 0;
      const allPlayers = (playerData as any).players;

      /*
       * NFL game state, so the scan only reports what can still be acted on.
       *
       * Fetched once for every league rather than per league: the scoreboard is identical for all
       * of them. A failed fetch leaves `games` null and every issue is reported as before —
       * degrading to noisy is right, degrading to silent would hide a real inactive starter.
       */
      const games = await fetch('/api/betting/nfl-games')
        .then(r => (r.ok ? (r.json() as Promise<NflGamesResponse>) : null))
        .catch(() => null);

      const stateOf = (playerId: string): 'pre' | 'in' | 'post' | 'unknown' => {
        if (!games) return 'unknown';
        const team = allPlayers[playerId]?.team;
        if (!team) return 'unknown';
        const gameId = games.teamToGame[espnTeamCode(team)];
        const game = gameId ? games.games.find(g => g.id === gameId) : undefined;
        return game ? game.state : 'unknown';
      };

      // An empty slot can be filled by anyone whose game has not kicked off. Once the whole week is
      // final there is nobody left to add, so reporting the hole is pure noise.
      const anyGameLeft = games ? games.games.some(g => g.state === 'pre') : true;

      leagues.forEach(league => {
        const roster = rosterMap.get(league.league_id);
        if (!roster) return;
        if (SleeperService.isZeroPointRoster(roster)) return;

        const issues: MedicIssue[] = [];
        let locked = 0;
        
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
          const emptyCount = roster.starters.filter(pid => pid === '0').length;
          /*
           * A lineup nobody has touched collapses to ONE issue instead of ten identical ones.
           *
           * Ten criticals from one league would bury the single genuinely actionable empty slot in
           * another. Pre-draft rosters never reach here — isZeroPointRoster already skips a roster
           * with no players and no points — so this is the case of a drafted team whose owner has
           * not set a lineup at all.
           */
          const wholeLineupUnset = emptyCount > 1 && emptyCount === roster.starters.length;
          if (!anyGameLeft) {
            // Every game is final, so no empty slot can be filled any more.
            locked += wholeLineupUnset ? 1 : emptyCount;
          } else if (wholeLineupUnset) {
            issues.push({
              id: `start-unset-${league.league_id}`,
              leagueId: league.league_id,
              leagueName: league.name,
              leagueAvatar: league.avatar || '',
              type: 'critical',
              message: `Lineup not set — none of the ${emptyCount} starting slots are filled.`
            });
          }

          roster.starters.forEach((pid, index) => {
            if (pid === '0') {
               if (!anyGameLeft) return;      // nobody left to add — counted as locked above
               if (wholeLineupUnset) return;  // already reported once, above
               // Name the slot. "Empty starter slot detected!" told you a lineup was broken but
               // not where, so fixing it meant opening the league and comparing by eye.
               const slot = starterSlotLabel(league.roster_positions, index);
               issues.push({
                 id: `start-empty-${league.league_id}-${index}`,
                 leagueId: league.league_id,
                 leagueName: league.name,
                 leagueAvatar: league.avatar || '',
                 type: 'critical',
                 message: slot
                   ? `Empty ${slot} slot — nothing is set to start there.`
                   : 'Empty starter slot — the league does not report which one.'
               });
            } else {
               const pInfo = allPlayers[pid];
               if (pInfo) {
                 if (['Out', 'IR', 'PUP', 'Doubtful'].includes(pInfo.injury_status)) {
                    // Only while the player could still be benched. Once his game is under way or
                    // over, an inactive starter is a result rather than something to fix, and
                    // listing it buries the leagues where a swap is still possible.
                    const state = stateOf(pid);
                    if (state === 'in' || state === 'post') {
                      locked++;
                    } else {
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
            }
          });
        }

        // A league with nothing left to fix gets no card — its locked count rolls into the one
        // line at the bottom, so a scan does not open a section you cannot act on.
        if (issues.length > 0) {
          healthReports.push({ league, issues, lockedCount: locked });
        } else if (locked > 0) {
          lockedElsewhere += locked;
        }
      });

      healthReports.sort((a, b) => {
        const score = (i: MedicIssue) => i.type === 'critical' ? 3 : i.type === 'warning' ? 2 : 1;
        const scoreA = a.issues.reduce((sum, i) => sum + score(i), 0);
        const scoreB = b.issues.reduce((sum, i) => sum + score(i), 0);
        return scoreB - scoreA;
      });

      setResults(healthReports);
      setLockedTotal(
        healthReports.reduce((sum, r) => sum + r.lockedCount, 0) + lockedElsewhere,
      );
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
        <Alert severity="success" variant="filled" sx={{ mb: lockedTotal > 0 ? 1 : 4 }}>
          <Typography variant="h6">
            {lockedTotal > 0 ? 'Nothing left to fix.' : 'All clear! No roster issues found.'}
          </Typography>
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

      {/*
        * Said once, quietly, and AFTER the results — a caveat printed above the headline count read
        * as though it were the headline.
        *
        * These are real problems (an inactive starter, an unfilled slot) whose games have kicked
        * off, so there is nothing to do about them. Listing them as tasks buried the leagues where
        * a swap is still possible; dropping them silently would leave you wondering whether the
        * scan had worked.
        */}
      {scanned && lockedTotal > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
          {lockedTotal} other problem{lockedTotal === 1 ? '' : 's'} can no longer be fixed — those
          games have already kicked off.
        </Typography>
      )}
    </Container>
  );
}
