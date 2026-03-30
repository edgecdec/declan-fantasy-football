'use client';

import * as React from 'react';
import {
  Container,
  Typography,
  Box,
  Paper,
  LinearProgress,
  Button,
  ToggleButton,
  ToggleButtonGroup,
  Select,
  MenuItem,
  FormControl,
  Grid,
  Modal,
  IconButton,
  Divider
} from '@mui/material';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import { useRouter } from 'next/navigation';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CloseIcon from '@mui/icons-material/Close';
import { useUser } from '@/context/UserContext';
import { SleeperService } from '@/services/sleeper/sleeperService';
import { analyzePositionalBenchmarks } from '@/services/stats/positionalBenchmarks';
import PageHeader from '@/components/common/PageHeader';
import UserSearchInput from '@/components/common/UserSearchInput';
import PlayerImpactList from '@/components/performance/PlayerImpactList';
import SmartTable from '@/components/common/SmartTable';
import StartsTooltip from '@/components/performance/StartsTooltip';
import { getPositionColor } from '@/constants/colors';
import PositionalHeatmap from '@/components/performance/PositionalHeatmap';

const MIN_YEAR = 2017;
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const POSITION_COLORS: Record<string, string> = {
  QB: '#ef5350', RB: '#66bb6a', WR: '#42a5f5', TE: '#ffa726', K: '#ab47bc', DEF: '#8d6e63'
};

type YearlyPositionalStats = {
  year: string;
  [key: string]: string | number;
};

type AllTimeImpact = {
  playerId: string;
  name: string;
  position: string;
  totalPOLA: number;
  weeks: number;
  avgPOLA: number;
  seasons: number;
  leagues: number;
  startedWeeks: Record<string, number[]>;
};

export default function PositionalHistoryPage() {
  const router = useRouter();
  const { user, fetchUser } = useUser();
  const [username, setUsername] = React.useState('');

  const [loading, setLoading] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [status, setStatus] = React.useState('');
  const [chartData, setChartData] = React.useState<YearlyPositionalStats[]>([]);
  const [allTimeImpacts, setAllTimeImpacts] = React.useState<AllTimeImpact[]>([]);
  const [impactsModalData, setImpactsModalData] = React.useState<AllTimeImpact[] | null>(null);

  const [metric, setMetric] = React.useState<'total' | 'efficiency'>('total');
  const [positionFilter, setPositionFilter] = React.useState<string>('ALL');

  React.useEffect(() => {
    if (user) {
      setUsername(user.username);
    } else {
      const saved = localStorage.getItem('sleeper_usernames');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed.length > 0) setUsername(parsed[0]);
        } catch { /* ignore */ }
      }
    }
  }, [user]);

  const handleAnalyze = async () => {
    if (!username) return;
    setLoading(true);
    setProgress(0);
    setChartData([]);
    setAllTimeImpacts([]);
    setStatus('Initializing...');

    try {
      let currentUser = user;
      if (!currentUser || currentUser.username.toLowerCase() !== username.toLowerCase()) {
        currentUser = await SleeperService.getUser(username);
        if (!currentUser) throw new Error('User not found');
        fetchUser(username);
      }

      const now = new Date();
      const currentYear = now.getMonth() < 5 ? now.getFullYear() - 1 : now.getFullYear();
      const totalYears = currentYear - MIN_YEAR + 1;

      const yearResults: YearlyPositionalStats[] = [];
      // Track all-time impacts: playerId -> accumulated data
      const impactMap = new Map<string, {
        totalPOLA: number;
        weeks: number;
        name: string;
        position: string;
        seasonSet: Set<string>;
        leagueSet: Set<string>;
        startedWeeks: Record<string, number[]>;
      }>();

      for (let y = currentYear; y >= MIN_YEAR; y--) {
        const year = y.toString();
        setStatus(`Scanning ${year}...`);

        try {
          const leagues = await SleeperService.getLeagues(currentUser.user_id, year);
          const activeLeagues = leagues.filter(l => !SleeperService.shouldIgnoreLeague(l));

          if (activeLeagues.length > 0) {
            const agg = {
              total: { user: {} as Record<string, number>, avg: {} as Record<string, number> },
              efficiency: { user: {} as Record<string, number>, avg: {} as Record<string, number> },
              count: {} as Record<string, number>
            };
            POSITIONS.forEach(p => {
              agg.total.user[p] = 0; agg.total.avg[p] = 0;
              agg.efficiency.user[p] = 0; agg.efficiency.avg[p] = 0;
              agg.count[p] = 0;
            });

            const CHUNK_SIZE = 3;
            for (let j = 0; j < activeLeagues.length; j += CHUNK_SIZE) {
              const chunk = activeLeagues.slice(j, j + CHUNK_SIZE);
              await Promise.all(chunk.map(async (league) => {
                try {
                  const res = await analyzePositionalBenchmarks(league, currentUser!.user_id);

                  // Aggregate chart data
                  POSITIONS.forEach(p => {
                    const u = res.userStats[p];
                    const l = res.leagueAverageStats[p];
                    if (u && l) {
                      agg.total.user[p] += u.avgPointsPerWeek;
                      agg.total.avg[p] += l.avgPointsPerWeek;
                      agg.efficiency.user[p] += u.avgPointsPerStarter;
                      agg.efficiency.avg[p] += l.avgPointsPerStarter;
                      agg.count[p]++;
                    }
                  });

                  // Accumulate player impacts (only user's own)
                  res.playerImpacts
                    .filter(p => p.ownerId === currentUser!.user_id)
                    .forEach(p => {
                      let curr = impactMap.get(p.playerId);
                      if (!curr) {
                        curr = {
                          totalPOLA: 0, weeks: 0, name: p.name, position: p.position,
                          seasonSet: new Set(), leagueSet: new Set(), startedWeeks: {}
                        };
                        impactMap.set(p.playerId, curr);
                      }
                      curr.totalPOLA += p.totalPOLA;
                      curr.weeks += p.weeksStarted;
                      curr.seasonSet.add(year);
                      curr.leagueSet.add(res.leagueId);
                      if (p.startedWeeks) {
                        Object.entries(p.startedWeeks).forEach(([yr, wks]) => {
                          if (!curr!.startedWeeks[yr]) curr!.startedWeeks[yr] = [];
                          curr!.startedWeeks[yr] = Array.from(new Set([...curr!.startedWeeks[yr], ...wks]));
                        });
                      }
                    });
                } catch (e) {
                  console.warn(`Failed ${league.name}`, e);
                }
              }));
            }

            // Build year data point
            const point: YearlyPositionalStats = { year };
            POSITIONS.forEach(p => {
              const c = agg.count[p] || 1;
              point[`${p}_User_total`] = agg.total.user[p] / c;
              point[`${p}_Avg_total`] = agg.total.avg[p] / c;
              point[`${p}_User_efficiency`] = agg.efficiency.user[p] / c;
              point[`${p}_Avg_efficiency`] = agg.efficiency.avg[p] / c;
            });
            yearResults.push(point);
          }
        } catch (e) {
          console.error(`Error processing ${year}`, e);
        }

        // Progressive update after each year
        const sorted = [...yearResults].sort((a, b) => (a.year as string).localeCompare(b.year as string));
        setChartData(sorted);

        const impacts: AllTimeImpact[] = Array.from(impactMap.entries())
          .map(([id, val]) => ({
            playerId: id, name: val.name, position: val.position,
            totalPOLA: val.totalPOLA, weeks: val.weeks,
            avgPOLA: val.weeks > 0 ? val.totalPOLA / val.weeks : 0,
            seasons: val.seasonSet.size, leagues: val.leagueSet.size,
            startedWeeks: val.startedWeeks
          }))
          .sort((a, b) => b.totalPOLA - a.totalPOLA);
        setAllTimeImpacts(impacts);

        setProgress(((currentYear - y + 1) / totalYears) * 100);
      }
    } catch (e) {
      console.error(e);
      setStatus('Error');
    } finally {
      setLoading(false);
      setProgress(100);
    }
  };

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <Button startIcon={<ArrowBackIcon />} onClick={() => router.back()} sx={{ mb: 2 }}>
        Back to Benchmarks
      </Button>

      <PageHeader
        title="Positional History"
        subtitle="All-time positional trends and career MVPs/LVPs across every season since 2017."
      />

      <Paper sx={{ p: 3, mb: 4 }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 3 }}>
          <UserSearchInput username={username} setUsername={setUsername} disabled={loading} />
          <Button
            variant="contained" size="large"
            onClick={handleAnalyze}
            disabled={loading || !username}
            sx={{ height: 56 }}
          >
            {loading ? 'Scanning...' : 'Generate History'}
          </Button>
        </Box>
        {loading && (
          <Box>
            <Typography variant="body2" gutterBottom>{status} ({Math.round(progress)}%)</Typography>
            <LinearProgress variant="determinate" value={progress} />
          </Box>
        )}

        {chartData.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', mt: 2 }}>
            <Box>
              <Typography variant="caption" display="block" color="text.secondary" gutterBottom>Metric</Typography>
              <ToggleButtonGroup value={metric} exclusive onChange={(_, v) => v && setMetric(v)} size="small">
                <ToggleButton value="total">Total Output</ToggleButton>
                <ToggleButton value="efficiency">Efficiency</ToggleButton>
              </ToggleButtonGroup>
            </Box>
            <Box>
              <Typography variant="caption" display="block" color="text.secondary" gutterBottom>Filter Position</Typography>
              <FormControl size="small" sx={{ minWidth: 120 }}>
                <Select value={positionFilter} onChange={(e) => setPositionFilter(e.target.value)}>
                  <MenuItem value="ALL">All Positions</MenuItem>
                  {POSITIONS.map(p => <MenuItem key={p} value={p}>{p}</MenuItem>)}
                </Select>
              </FormControl>
            </Box>
          </Box>
        )}
      </Paper>

      {/* All-Time MVPs/LVPs + Chart */}
      {(chartData.length > 0 || allTimeImpacts.length > 0) && (
        <Grid container spacing={4} sx={{ mb: 4 }}>
          <Grid size={{ xs: 12, lg: 8 }}>
            <Paper sx={{ p: 3, height: 500 }}>
              <Typography variant="h6" gutterBottom>Positional Trends Over Time</Typography>
              <ResponsiveContainer width="100%" height="90%">
                <LineChart data={chartData} margin={{ top: 10, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                  <XAxis dataKey="year" stroke="#888" />
                  <YAxis
                    stroke="#888"
                    label={{ value: metric === 'total' ? 'Avg Weekly Pts' : 'Pts Per Start', angle: -90, position: 'insideLeft' }}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#333', border: 'none' }}
                    labelStyle={{ color: '#aaa' }}
                    formatter={(val: number | undefined) => val != null ? val.toFixed(1) : '0'}
                  />
                  <Legend />
                  {POSITIONS.map(pos => {
                    if (positionFilter !== 'ALL' && positionFilter !== pos) return null;
                    return (
                      <React.Fragment key={pos}>
                        <Line
                          type="monotone"
                          dataKey={`${pos}_User_${metric}`}
                          name={positionFilter === 'ALL' ? pos : `${pos} (You)`}
                          stroke={POSITION_COLORS[pos]}
                          strokeWidth={3}
                          activeDot={{ r: 6 }}
                        />
                        {positionFilter === pos && (
                          <Line
                            type="monotone"
                            dataKey={`${pos}_Avg_${metric}`}
                            name="League Avg"
                            stroke="#999"
                            strokeWidth={2}
                            strokeDasharray="5 5"
                            dot={false}
                          />
                        )}
                      </React.Fragment>
                    );
                  })}
                </LineChart>
              </ResponsiveContainer>
            </Paper>
          </Grid>

          <Grid size={{ xs: 12, lg: 4 }}>
            <PlayerImpactList
              impacts={allTimeImpacts}
              title="All-Time Portfolio MVPs & LVPs"
              onViewAll={() => setImpactsModalData(allTimeImpacts)}
              maxItems={5}
            />
          </Grid>
        </Grid>
      )}

      {/* Positional Edge Heatmap */}
      {chartData.length > 0 && (
        <Box sx={{ mb: 4 }}>
          <PositionalHeatmap chartData={chartData} metric={metric} onMetricChange={setMetric} />
        </Box>
      )}

      {/* Full List Modal */}
      <Modal open={!!impactsModalData} onClose={() => setImpactsModalData(null)}>
        <Paper sx={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          width: '90%', maxWidth: 900, bgcolor: 'background.paper', boxShadow: 24, p: 4,
          maxHeight: '90vh', overflowY: 'auto'
        }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h5">All-Time Player Impact</Typography>
            <IconButton onClick={() => setImpactsModalData(null)}><CloseIcon /></IconButton>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Cumulative Points Over League Average (POLA) across all seasons since 2017.
          </Typography>

          <SmartTable
            data={impactsModalData || []}
            keyField="playerId"
            defaultSortBy="totalPOLA"
            defaultSortOrder="desc"
            rowsPerPageOptions={[10, 25, 50, 100, 250, 500]}
            columns={[
              { id: 'name', label: 'Player', numeric: false, sortable: true, filterVariant: 'text' },
              {
                id: 'position', label: 'Pos', numeric: false, sortable: true, filterVariant: 'multi-select', width: 80,
                render: (row: AllTimeImpact) => (
                  <Box component="span" sx={{ color: getPositionColor(row.position), fontWeight: 'bold' }}>{row.position}</Box>
                )
              },
              { id: 'seasons', label: 'Seasons', numeric: true, sortable: true, width: 90 },
              { id: 'leagues', label: 'Leagues', numeric: true, sortable: true, width: 90 },
              {
                id: 'weeks', label: 'Starts', numeric: true, sortable: true,
                render: (row: AllTimeImpact) => (
                  <StartsTooltip weeksStarted={row.weeks} startedWeeks={row.startedWeeks} />
                )
              },
              {
                id: 'totalPOLA', label: 'Total Impact', numeric: true, sortable: true,
                render: (row: AllTimeImpact) => (
                  <Box sx={{ color: row.totalPOLA > 0 ? 'success.main' : 'error.main', fontWeight: 'bold' }}>
                    {row.totalPOLA > 0 ? '+' : ''}{row.totalPOLA.toFixed(1)}
                  </Box>
                )
              },
              {
                id: 'avgPOLA', label: 'Avg/Wk', numeric: true, sortable: true,
                render: (row: AllTimeImpact) => (
                  <Box sx={{ color: 'text.secondary' }}>
                    {row.avgPOLA > 0 ? '+' : ''}{row.avgPOLA.toFixed(1)}
                  </Box>
                )
              }
            ]}
          />
        </Paper>
      </Modal>
    </Container>
  );
}
