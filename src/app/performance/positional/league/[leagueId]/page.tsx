'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Container,
  Box,
  Typography,
  LinearProgress,
  Grid,
  Button,
  ToggleButton,
  ToggleButtonGroup,
  Paper,
  Alert,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Avatar,
  Tooltip
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useUser } from '@/context/UserContext';
import { SleeperService, SleeperLeague } from '@/services/sleeper/sleeperService';
import { analyzePositionalBenchmarks, LeagueBenchmarkResult, PositionStats } from '@/services/stats/positionalBenchmarks';
import PageHeader from '@/components/common/PageHeader';
import SkillProfileChart, { AggregatePositionStats } from '@/components/performance/SkillProfileChart';
import PlayerImpactList, { PlayerImpact } from '@/components/performance/PlayerImpactList';

const VALID_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

type LeagueHeatmapData = {
  userId: string;
  displayName: string;
  avatar: string;
  stats: Record<string, { diffTotal: number, diffEff: number }>; // Pos -> Diffs
};

export default function LeaguePositionalPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useUser();
  
  const leagueId = params.leagueId as string;
  
  const [league, setLeague] = React.useState<SleeperLeague | null>(null);
  const [mode, setMode] = React.useState<'current' | 'history'>('current');
  const [loading, setLoading] = React.useState(false);
  const [status, setStatus] = React.useState('');
  const [progress, setProgress] = React.useState(0);
  
  const [aggData, setAggData] = React.useState<AggregatePositionStats[]>([]);
  const [impacts, setImpacts] = React.useState<PlayerImpact[]>([]);
  const [heatmapData, setHeatmapData] = React.useState<LeagueHeatmapData[]>([]);
  const [metric, setMetric] = React.useState<'total' | 'efficiency'>('efficiency');

  React.useEffect(() => {
    if (leagueId) fetchLeagueInfo();
  }, [leagueId]);

  React.useEffect(() => {
    if (league && user) {
      runAnalysis();
    }
  }, [league, mode, user]);

  const fetchLeagueInfo = async () => {
    try {
      const res = await fetch(`https://api.sleeper.app/v1/league/${leagueId}`);
      if (res.ok) {
        const data = await res.json();
        setLeague(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const runAnalysis = async () => {
    if (!league || !user) return;
    setLoading(true);
    setProgress(0);
    setStatus('Initializing...');

    try {
      let leaguesToAnalyze: SleeperLeague[] = [];

      if (mode === 'current') {
        leaguesToAnalyze = [league];
      } else {
        setStatus('Tracing league history...');
        leaguesToAnalyze = await SleeperService.getLeagueHistory(league.league_id);
      }

      const results: LeagueBenchmarkResult[] = [];
      const total = leaguesToAnalyze.length;

      for (let i = 0; i < total; i++) {
        const l = leaguesToAnalyze[i];
        setStatus(`Analyzing ${l.season}...`);
        try {
          const res = await analyzePositionalBenchmarks(l, user.user_id, true);
          results.push(res);
        } catch (e) {
          console.log(`Skipping ${l.season}`, e);
        }
        setProgress(((i + 1) / total) * 100);
      }

      aggregateResults(results);

    } catch (e) {
      console.error(e);
      setStatus('Error occurred');
    } finally {
      setLoading(false);
    }
  };

  const aggregateResults = (results: LeagueBenchmarkResult[]) => {
    if (results.length === 0) {
      setAggData([]);
      setImpacts([]);
      setHeatmapData([]);
      return;
    }

    // 1. Aggregate Skill Profile (Current User)
    const sums = {
      user: {} as Record<string, PositionStats>,
      league: {} as Record<string, PositionStats>
    };

    VALID_POSITIONS.forEach(pos => {
      sums.user[pos] = { position: pos, totalPoints: 0, starterCount: 0, gamesPlayed: 0, avgPointsPerWeek: 0, avgPointsPerStarter: 0 };
      sums.league[pos] = { position: pos, totalPoints: 0, starterCount: 0, gamesPlayed: 0, avgPointsPerWeek: 0, avgPointsPerStarter: 0 };
    });

    results.forEach(res => {
      VALID_POSITIONS.forEach(pos => {
        const u = res.userStats[pos];
        const l = res.leagueAverageStats[pos];

        if (u && l) {
          sums.user[pos].totalPoints += u.totalPoints;
          sums.user[pos].starterCount += u.starterCount;
          sums.user[pos].gamesPlayed += u.gamesPlayed;

          sums.league[pos].totalPoints += l.totalPoints;
          sums.league[pos].starterCount += l.starterCount;
          sums.league[pos].gamesPlayed += l.gamesPlayed;
        }
      });
    });

    const chartData: AggregatePositionStats[] = VALID_POSITIONS.map(pos => {
      const u = sums.user[pos];
      const l = sums.league[pos];

      const avgUserPoints = u.gamesPlayed > 0 ? u.totalPoints / u.gamesPlayed : 0;
      const avgLeaguePoints = l.gamesPlayed > 0 ? l.totalPoints / l.gamesPlayed : 0;
      
      const avgUserEff = u.starterCount > 0 ? u.totalPoints / u.starterCount : 0;
      const avgLeagueEff = l.starterCount > 0 ? l.totalPoints / l.starterCount : 0;

      const diffPoints = avgUserPoints - avgLeaguePoints;
      const diffPct = avgLeaguePoints > 0 ? (diffPoints / avgLeaguePoints) * 100 : 0;

      const diffEff = avgUserEff - avgLeagueEff;
      const diffEffPct = avgLeagueEff > 0 ? (diffEff / avgLeagueEff) * 100 : 0;

      return {
        position: pos,
        avgUserPoints, avgLeaguePoints, diffPoints, diffPct,
        avgUserEff, avgLeagueEff, diffEff, diffEffPct
      };
    });

    setAggData(chartData);

    // 2. Aggregate Player Impacts
    const impactMap = new Map<string, { totalPOLA: number, weeks: number, name: string, pos: string }>();
    
    results.forEach(res => {
      res.playerImpacts.forEach(p => {
        const curr = impactMap.get(p.playerId) || { totalPOLA: 0, weeks: 0, name: p.name, pos: p.position };
        curr.totalPOLA += p.totalPOLA;
        curr.weeks += (p.weeksStarted || 0);
        impactMap.set(p.playerId, curr);
      });
    });

    const impactList: PlayerImpact[] = Array.from(impactMap.entries()).map(([id, val]) => ({
      playerId: id,
      name: val.name,
      position: val.pos,
      totalPOLA: val.totalPOLA,
      weeksStarted: val.weeks,
      avgPOLA: val.totalPOLA / (val.weeks || 1)
    })).sort((a, b) => b.totalPOLA - a.totalPOLA);

    setImpacts(impactList);

    // 3. Aggregate Heatmap Data (All Users)
    const userAggr = new Map<string, {
      seasons: number,
      meta: { displayName: string, avatar: string },
      posSums: Record<string, { sumDiffTotal: number, sumDiffEff: number }>
    }>();

    results.forEach(res => {
      const lStats = res.leagueAverageStats;
      const allRosters = res.allRosterStats || {}; // Safety check if older API logic cached
      const meta = res.rosterMeta || {};

      Object.keys(allRosters).forEach(uid => {
        if (!userAggr.has(uid)) {
          userAggr.set(uid, {
            seasons: 0,
            meta: meta[uid] || { displayName: 'Unknown', avatar: '' },
            posSums: {}
          });
          VALID_POSITIONS.forEach(p => {
            userAggr.get(uid)!.posSums[p] = { sumDiffTotal: 0, sumDiffEff: 0 };
          });
        }

        const ua = userAggr.get(uid)!;
        // Update meta if more recent season (results usually pushed newest to oldest? No, loop pushed oldest to newest if history fetched that way. 
        // Let's assume we want latest. We can update meta every time.)
        if (meta[uid]) ua.meta = meta[uid];
        ua.seasons++;

        const uStats = allRosters[uid];
        VALID_POSITIONS.forEach(pos => {
          const u = uStats[pos];
          const l = lStats[pos];
          if (u && l) {
             const diffTotal = u.avgPointsPerWeek - l.avgPointsPerWeek;
             const diffEff = u.avgPointsPerStarter - l.avgPointsPerStarter;
             ua.posSums[pos].sumDiffTotal += diffTotal;
             ua.posSums[pos].sumDiffEff += diffEff;
          }
        });
      });
    });

    const heatmap: LeagueHeatmapData[] = Array.from(userAggr.entries()).map(([uid, val]) => {
      const stats: Record<string, { diffTotal: number, diffEff: number }> = {};
      VALID_POSITIONS.forEach(pos => {
        const s = val.posSums[pos];
        stats[pos] = {
          diffTotal: s.sumDiffTotal / val.seasons,
          diffEff: s.sumDiffEff / val.seasons
        };
      });
      return {
        userId: uid,
        displayName: val.meta.displayName,
        avatar: val.meta.avatar,
        stats
      };
    });

    // Sort by "Sum of Efficiency Diffs" to put best drafters at top?
    // Or alphabetical?
    // Let's sort by Total Efficiency Diff across all positions
    heatmap.sort((a, b) => {
       const sumA = VALID_POSITIONS.reduce((acc, p) => acc + a.stats[p].diffEff, 0);
       const sumB = VALID_POSITIONS.reduce((acc, p) => acc + b.stats[p].diffEff, 0);
       return sumB - sumA;
    });

    setHeatmapData(heatmap);
  };

  if (!league) return <LinearProgress />;

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <Button startIcon={<ArrowBackIcon />} onClick={() => router.back()} sx={{ mb: 2 }}>
        Back to Dashboard
      </Button>

      <PageHeader 
        title={league.name}
        subtitle={`Positional Analysis • ${mode === 'current' ? league.season : 'All-Time History'}`}
        action={
          <ToggleButtonGroup
            value={mode}
            exclusive
            onChange={(_, v) => v && setMode(v)}
            size="small"
            color="primary"
          >
            <ToggleButton value="current">{league.season} Only</ToggleButton>
            <ToggleButton value="history">All-Time History</ToggleButton>
          </ToggleButtonGroup>
        }
      />

      {loading && (
        <Box sx={{ mb: 4 }}>
          <Typography variant="body2" gutterBottom>{status} ({Math.round(progress)}%)</Typography>
          <LinearProgress variant="determinate" value={progress} />
        </Box>
      )}

      {!loading && aggData.length === 0 && (
        <Alert severity="info">No data found for this configuration.</Alert>
      )}

      {!loading && aggData.length > 0 && (
        <Grid container spacing={4}>
          <Grid size={{ xs: 12, lg: 8 }}>
            <SkillProfileChart 
              data={aggData} 
              metric={metric} 
              onMetricChange={setMetric} 
              height={500}
            />
          </Grid>
          <Grid size={{ xs: 12, lg: 4 }}>
            <PlayerImpactList 
              impacts={impacts} 
              maxItems={8}
              title={mode === 'current' ? "Season Impact" : "All-Time Legends & Busts"}
            />
          </Grid>

          {/* Heatmap Section */}
          <Grid size={{ xs: 12 }}>
            <Paper sx={{ p: 3, overflow: 'hidden' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                <Typography variant="h6">League Skill Heatmap</Typography>
                {/* We reuse the metric state for the heatmap toggle too */}
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
                Comparing each manager's {metric === 'total' ? 'weekly output' : 'starting efficiency'} to the league average. Green = Above Avg, Red = Below Avg.
              </Typography>
              
              <TableContainer sx={{ maxHeight: 600 }}>
                <Table stickyHeader size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ bgcolor: 'background.paper', zIndex: 3 }}>Manager</TableCell>
                      {VALID_POSITIONS.map(p => (
                        <TableCell key={p} align="center" sx={{ bgcolor: 'background.paper', fontWeight: 'bold' }}>{p}</TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {heatmapData.map(m => (
                      <TableRow key={m.userId} hover>
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Avatar src={`https://sleepercdn.com/avatars/${m.avatar}`} sx={{ width: 24, height: 24 }} />
                            <Typography variant="body2" noWrap sx={{ maxWidth: 150 }}>{m.displayName}</Typography>
                          </Box>
                        </TableCell>
                        {VALID_POSITIONS.map(p => {
                          const val = metric === 'total' ? m.stats[p].diffTotal : m.stats[p].diffEff;
                          
                          // Color logic
                          // Efficiency: +/- 3 pts is huge. +/- 0.5 is noise.
                          // Total: +/- 10 pts is huge.
                          const range = metric === 'total' ? 10 : 3;
                          let bg = 'transparent';
                          let color = 'inherit';
                          
                          if (val > 0) {
                             const intensity = Math.min(val / range, 1);
                             bg = `rgba(76, 175, 80, ${intensity * 0.4})`;
                          } else {
                             const intensity = Math.min(Math.abs(val) / range, 1);
                             bg = `rgba(244, 67, 54, ${intensity * 0.4})`;
                          }

                          return (
                            <TableCell key={p} align="center" sx={{ bgcolor: bg, color }}>
                              {val > 0 ? '+' : ''}{val.toFixed(1)}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          </Grid>
        </Grid>
      )}
    </Container>
  );
}