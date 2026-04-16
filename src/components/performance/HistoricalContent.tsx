'use client';

import * as React from 'react';
import {
  Box, Paper, Typography, LinearProgress, Grid,
  ToggleButton, ToggleButtonGroup, FormControl, Select, MenuItem,
  Modal, IconButton, Divider,
} from '@mui/material';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import CloseIcon from '@mui/icons-material/Close';
import { useUser } from '@/context/UserContext';
import { SleeperService } from '@/services/sleeper/sleeperService';
import { analyzePositionalBenchmarks } from '@/services/stats/positionalBenchmarks';
import { analyzeMultiLeagueSeason } from '@/services/stats/lineupOptimizer';
import { SeasonDecisionSummary } from '@/types/lineup';
import UserSearchInput from '@/components/common/UserSearchInput';
import PlayerImpactList from '@/components/performance/PlayerImpactList';
import SmartTable from '@/components/common/SmartTable';
import StartsTooltip from '@/components/performance/StartsTooltip';
import PositionalHeatmap from '@/components/performance/PositionalHeatmap';
import { getPositionColor } from '@/constants/colors';

const MIN_YEAR = 2017;
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const POSITION_COLORS: Record<string, string> = {
  QB: '#ef5350', RB: '#66bb6a', WR: '#42a5f5', TE: '#ffa726', K: '#ab47bc', DEF: '#8d6e63',
};

type YearlyPositionalStats = { year: string; [key: string]: string | number };

type AllTimeImpact = {
  playerId: string; name: string; position: string;
  totalPOLA: number; weeks: number; avgPOLA: number;
  seasons: number; leagues: number; startedWeeks: Record<string, number[]>;
};

type YearlyDecisionStats = {
  year: string; accuracy: number; pointsLeft: number; leagues: number;
};

type SeasonSummaryRow = {
  year: string; accuracy: number; pointsLeft: number;
  leagueCount: number; avgEffDiff: number;
};

export default function HistoricalContent() {
  const { user, fetchUser } = useUser();
  const [username, setUsername] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [status, setStatus] = React.useState('');

  const [positionalData, setPositionalData] = React.useState<YearlyPositionalStats[]>([]);
  const [allTimeImpacts, setAllTimeImpacts] = React.useState<AllTimeImpact[]>([]);
  const [decisionData, setDecisionData] = React.useState<YearlyDecisionStats[]>([]);
  const [summaryRows, setSummaryRows] = React.useState<SeasonSummaryRow[]>([]);
  const [impactsModalData, setImpactsModalData] = React.useState<AllTimeImpact[] | null>(null);

  const [metric, setMetric] = React.useState<'total' | 'efficiency'>('total');
  const [positionFilter, setPositionFilter] = React.useState<string>('ALL');
  const prevTrigger = React.useRef('');

  React.useEffect(() => { if (user) setUsername(user.username); }, [user]);

  React.useEffect(() => {
    const key = username;
    if (username && key !== prevTrigger.current) {
      prevTrigger.current = key;
      const t = setTimeout(() => handleAnalyze(), 500);
      return () => clearTimeout(t);
    }
  }, [username]);

  const handleAnalyze = async () => {
    if (!username) return;
    setLoading(true);
    setProgress(0);
    setPositionalData([]);
    setAllTimeImpacts([]);
    setDecisionData([]);
    setSummaryRows([]);
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

      const posResults: YearlyPositionalStats[] = [];
      const decResults: YearlyDecisionStats[] = [];
      const sumResults: SeasonSummaryRow[] = [];
      const impactMap = new Map<string, {
        totalPOLA: number; weeks: number; name: string; position: string;
        seasonSet: Set<string>; leagueSet: Set<string>; startedWeeks: Record<string, number[]>;
      }>();

      for (let y = currentYear; y >= MIN_YEAR; y--) {
        const year = y.toString();
        setStatus(`Scanning ${year}...`);

        try {
          const leagues = await SleeperService.getLeagues(currentUser.user_id, year);
          const activeLeagues = leagues.filter(l => !SleeperService.shouldIgnoreLeague(l));
          if (activeLeagues.length === 0) {
            setProgress(((currentYear - y + 1) / totalYears) * 100);
            continue;
          }

          // Positional benchmarks
          const agg = {
            total: { user: {} as Record<string, number>, avg: {} as Record<string, number> },
            efficiency: { user: {} as Record<string, number>, avg: {} as Record<string, number> },
            count: {} as Record<string, number>,
          };
          POSITIONS.forEach(p => {
            agg.total.user[p] = 0; agg.total.avg[p] = 0;
            agg.efficiency.user[p] = 0; agg.efficiency.avg[p] = 0;
            agg.count[p] = 0;
          });

          const CHUNK = 3;
          for (let j = 0; j < activeLeagues.length; j += CHUNK) {
            const chunk = activeLeagues.slice(j, j + CHUNK);
            await Promise.all(chunk.map(async (league) => {
              try {
                const res = await analyzePositionalBenchmarks(league, currentUser!.user_id);
                if (!res) return;
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
                res.playerImpacts.filter(p => p.ownerId === currentUser!.user_id).forEach(p => {
                  let curr = impactMap.get(p.playerId);
                  if (!curr) {
                    curr = { totalPOLA: 0, weeks: 0, name: p.name, position: p.position,
                      seasonSet: new Set(), leagueSet: new Set(), startedWeeks: {} };
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
              } catch (e) { console.warn(`Failed positional ${league.name}`, e); }
            }));
          }

          const hasData = POSITIONS.some(p => agg.count[p] > 0);
          if (hasData) {
            const point: YearlyPositionalStats = { year };
            POSITIONS.forEach(p => {
              const c = agg.count[p] || 1;
              point[`${p}_User_total`] = agg.total.user[p] / c;
              point[`${p}_Avg_total`] = agg.total.avg[p] / c;
              point[`${p}_User_efficiency`] = agg.efficiency.user[p] / c;
              point[`${p}_Avg_efficiency`] = agg.efficiency.avg[p] / c;
            });
            posResults.push(point);
          }

          // Start/Sit decisions
          const decisionSummaries = await analyzeMultiLeagueSeason(activeLeagues, currentUser.user_id, year);
          if (decisionSummaries.length > 0) {
            const allWeekly = decisionSummaries.flatMap(s => s.weeklyDecisions);
            const optWeeks = allWeekly.filter(w => w.isOptimal).length;
            const acc = allWeekly.length > 0 ? (optWeeks / allWeekly.length) * 100 : 0;
            const ptsLeft = decisionSummaries.reduce((s, d) => s + d.totalPointsLeftOnBench, 0);
            decResults.push({ year, accuracy: acc, pointsLeft: ptsLeft, leagues: decisionSummaries.length });
          }

          // Build summary row
          let avgEffDiff = 0;
          let effCount = 0;
          POSITIONS.forEach(p => {
            const c = agg.count[p];
            if (c > 0) {
              const userVal = agg.efficiency.user[p] / c;
              const avgVal = agg.efficiency.avg[p] / c;
              avgEffDiff += userVal - avgVal;
              effCount++;
            }
          });

          const decEntry = decResults.find(d => d.year === year);
          sumResults.push({
            year,
            accuracy: decEntry?.accuracy ?? 0,
            pointsLeft: decEntry?.pointsLeft ?? 0,
            leagueCount: activeLeagues.length,
            avgEffDiff: effCount > 0 ? avgEffDiff / effCount : 0,
          });
        } catch (e) { console.error(`Error processing ${year}`, e); }

        // Progressive updates
        const sortedPos = [...posResults].sort((a, b) => (a.year as string).localeCompare(b.year as string));
        setPositionalData(sortedPos);
        const sortedDec = [...decResults].sort((a, b) => a.year.localeCompare(b.year));
        setDecisionData(sortedDec);
        const sortedSum = [...sumResults].sort((a, b) => b.year.localeCompare(a.year));
        setSummaryRows(sortedSum);

        const impacts: AllTimeImpact[] = Array.from(impactMap.entries())
          .map(([id, val]) => ({
            playerId: id, name: val.name, position: val.position,
            totalPOLA: val.totalPOLA, weeks: val.weeks,
            avgPOLA: val.weeks > 0 ? val.totalPOLA / val.weeks : 0,
            seasons: val.seasonSet.size, leagues: val.leagueSet.size,
            startedWeeks: val.startedWeeks,
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
    <Box>
      <Paper sx={{ p: 2, mb: 3 }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <UserSearchInput username={username} setUsername={setUsername} disabled={loading} />
        </Box>
      </Paper>

      {loading && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{status} ({Math.round(progress)}%)</Typography>
          <LinearProgress variant="determinate" value={progress} />
        </Box>
      )}

      {positionalData.length === 0 && decisionData.length === 0 && !loading && (
        <Typography color="text.secondary" sx={{ textAlign: 'center', py: 8 }}>
          Enter a username to analyze historical trends since 2017.
        </Typography>
      )}

      {/* Decision Accuracy Trend Chart */}
      {decisionData.length > 0 && (
        <Paper sx={{ p: 3, mb: 4, height: 400 }}>
          <Typography variant="h6" gutterBottom>Lineup Decision Accuracy Over Time</Typography>
          <ResponsiveContainer width="100%" height="85%">
            <LineChart data={decisionData} margin={{ top: 10, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#444" />
              <XAxis dataKey="year" stroke="#888" />
              <YAxis yAxisId="left" stroke="#42a5f5" domain={[0, 100]}
                label={{ value: 'Accuracy %', angle: -90, position: 'insideLeft' }} />
              <YAxis yAxisId="right" orientation="right" stroke="#ffa726"
                label={{ value: 'Pts Left on Bench', angle: 90, position: 'insideRight' }} />
              <Tooltip contentStyle={{ backgroundColor: '#333', border: 'none' }} />
              <Legend />
              <ReferenceLine yAxisId="left" y={50} stroke="#666" strokeDasharray="5 5" label={{ value: '50%', fill: '#888', position: 'left' }} />
              <Line yAxisId="left" type="monotone" dataKey="accuracy" name="Optimal Lineup Rate"
                stroke="#42a5f5" strokeWidth={3} activeDot={{ r: 6 }}
                dot={{ fill: '#42a5f5', r: 4 }} />
              <Line yAxisId="right" type="monotone" dataKey="pointsLeft" name="Proj Pts Left on Bench"
                stroke="#ffa726" strokeWidth={3} activeDot={{ r: 6 }}
                dot={{ fill: '#ffa726', r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </Paper>
      )}

      {/* Positional Trends + MVPs/LVPs */}
      {(positionalData.length > 0 || allTimeImpacts.length > 0) && (
        <>
          {positionalData.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', mb: 2 }}>
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

          <Grid container spacing={4} sx={{ mb: 4 }}>
            <Grid size={{ xs: 12, lg: 8 }}>
              <Paper sx={{ p: 3, height: 500 }}>
                <Typography variant="h6" gutterBottom>Positional Trends Over Time</Typography>
                <ResponsiveContainer width="100%" height="90%">
                  <LineChart data={positionalData} margin={{ top: 10, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                    <XAxis dataKey="year" stroke="#888" />
                    <YAxis stroke="#888"
                      label={{ value: metric === 'total' ? 'Avg Weekly Pts' : 'Pts Per Start', angle: -90, position: 'insideLeft' }} />
                    <Tooltip contentStyle={{ backgroundColor: '#333', border: 'none' }} labelStyle={{ color: '#aaa' }}
                      formatter={(val: number | undefined) => val != null ? val.toFixed(1) : '0'} />
                    <Legend />
                    {POSITIONS.map(pos => {
                      if (positionFilter !== 'ALL' && positionFilter !== pos) return null;
                      return (
                        <React.Fragment key={pos}>
                          <Line type="monotone" dataKey={`${pos}_User_${metric}`}
                            name={positionFilter === 'ALL' ? pos : `${pos} (You)`}
                            stroke={POSITION_COLORS[pos]} strokeWidth={3} activeDot={{ r: 6 }} />
                          {positionFilter === pos && (
                            <Line type="monotone" dataKey={`${pos}_Avg_${metric}`}
                              name="League Avg" stroke="#999" strokeWidth={2}
                              strokeDasharray="5 5" dot={false} />
                          )}
                        </React.Fragment>
                      );
                    })}
                  </LineChart>
                </ResponsiveContainer>
              </Paper>
            </Grid>
            <Grid size={{ xs: 12, lg: 4 }}>
              <PlayerImpactList impacts={allTimeImpacts} title="All-Time Portfolio MVPs & LVPs"
                onViewAll={() => setImpactsModalData(allTimeImpacts)} maxItems={5} />
            </Grid>
          </Grid>
        </>
      )}

      {/* Positional Heatmap */}
      {positionalData.length > 0 && (
        <Box sx={{ mb: 4 }}>
          <PositionalHeatmap chartData={positionalData} metric={metric} onMetricChange={setMetric} />
        </Box>
      )}

      {/* Per-Season Summary Table */}
      {summaryRows.length > 0 && (
        <Paper sx={{ p: 3, mb: 4 }}>
          <Typography variant="h6" gutterBottom>Per-Season Summary</Typography>
          <SmartTable
            data={summaryRows}
            keyField="year"
            defaultSortBy="year"
            defaultSortOrder="desc"
            columns={[
              { id: 'year', label: 'Season', numeric: false, sortable: true, width: 90 },
              { id: 'leagueCount', label: 'Leagues', numeric: true, sortable: true, width: 90 },
              {
                id: 'accuracy', label: 'Optimal Lineup Rate', numeric: true, sortable: true,
                render: (row: SeasonSummaryRow) => (
                  <Box sx={{ color: row.accuracy >= 50 ? 'success.main' : 'error.main', fontWeight: 'bold' }}>
                    {row.accuracy.toFixed(1)}%
                  </Box>
                ),
              },
              {
                id: 'pointsLeft', label: 'Proj Pts Left on Bench', numeric: true, sortable: true,
                render: (row: SeasonSummaryRow) => (
                  <Box sx={{ color: 'error.main' }}>{row.pointsLeft.toFixed(1)}</Box>
                ),
              },
              {
                id: 'avgEffDiff', label: 'Avg Positional Edge', numeric: true, sortable: true,
                render: (row: SeasonSummaryRow) => (
                  <Box sx={{ color: row.avgEffDiff > 0 ? 'success.main' : row.avgEffDiff < 0 ? 'error.main' : 'text.secondary', fontWeight: 'bold' }}>
                    {row.avgEffDiff > 0 ? '+' : ''}{row.avgEffDiff.toFixed(1)}
                  </Box>
                ),
              },
            ]}
          />
        </Paper>
      )}

      {/* Full Impact List Modal */}
      <Modal open={!!impactsModalData} onClose={() => setImpactsModalData(null)}>
        <Paper sx={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          width: '90%', maxWidth: 900, bgcolor: 'background.paper', boxShadow: 24, p: 4,
          maxHeight: '90vh', overflowY: 'auto',
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
                ),
              },
              { id: 'seasons', label: 'Seasons', numeric: true, sortable: true, width: 90 },
              { id: 'leagues', label: 'Leagues', numeric: true, sortable: true, width: 90 },
              {
                id: 'weeks', label: 'Starts', numeric: true, sortable: true,
                render: (row: AllTimeImpact) => (
                  <StartsTooltip weeksStarted={row.weeks} startedWeeks={row.startedWeeks} />
                ),
              },
              {
                id: 'totalPOLA', label: 'Total Impact', numeric: true, sortable: true,
                render: (row: AllTimeImpact) => (
                  <Box sx={{ color: row.totalPOLA > 0 ? 'success.main' : 'error.main', fontWeight: 'bold' }}>
                    {row.totalPOLA > 0 ? '+' : ''}{row.totalPOLA.toFixed(1)}
                  </Box>
                ),
              },
              {
                id: 'avgPOLA', label: 'Avg/Wk', numeric: true, sortable: true,
                render: (row: AllTimeImpact) => (
                  <Box sx={{ color: 'text.secondary' }}>
                    {row.avgPOLA > 0 ? '+' : ''}{row.avgPOLA.toFixed(1)}
                  </Box>
                ),
              },
            ]}
          />
        </Paper>
      </Modal>
    </Box>
  );
}
