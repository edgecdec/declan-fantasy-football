'use client';

import * as React from 'react';
import {
  Box, Paper, Typography, LinearProgress, Grid,
  ToggleButton, ToggleButtonGroup,
} from '@mui/material';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { SleeperService } from '@/services/sleeper/sleeperService';
import { analyzePositionalBenchmarks } from '@/services/stats/positionalBenchmarks';
import { analyzeStartSitDecisions } from '@/services/stats/lineupOptimizer';
import PositionalHeatmap from '@/components/performance/PositionalHeatmap';
import SmartTable from '@/components/common/SmartTable';

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const POSITION_COLORS: Record<string, string> = {
  QB: '#ef5350', RB: '#66bb6a', WR: '#42a5f5', TE: '#ffa726', K: '#ab47bc', DEF: '#8d6e63',
};

type YearlyPositionalStats = { year: string; [key: string]: string | number };
type YearlyDecisionStats = { year: string; accuracy: number; pointsLeft: number };
type SeasonSummaryRow = {
  year: string; accuracy: number; pointsLeft: number; avgEffDiff: number;
};

type Props = { leagueId: string; userId: string };

export default function LeagueHistoricalContent({ leagueId, userId }: Props) {
  const [loading, setLoading] = React.useState(false);
  const [progress, setProgress] = React.useState({ done: 0, total: 0 });
  const [positionalData, setPositionalData] = React.useState<YearlyPositionalStats[]>([]);
  const [decisionData, setDecisionData] = React.useState<YearlyDecisionStats[]>([]);
  const [summaryRows, setSummaryRows] = React.useState<SeasonSummaryRow[]>([]);
  const [metric, setMetric] = React.useState<'total' | 'efficiency'>('total');
  const fetchedRef = React.useRef('');

  React.useEffect(() => {
    const key = `${leagueId}|${userId}`;
    if (!leagueId || !userId || key === fetchedRef.current) return;
    fetchedRef.current = key;
    loadHistory();
  }, [leagueId, userId]);

  const loadHistory = async () => {
    setLoading(true);
    setPositionalData([]);
    setDecisionData([]);
    setSummaryRows([]);

    try {
      const history = await SleeperService.getLeagueHistory(leagueId);
      const validLeagues = history.filter(l => l.status === 'complete' || l.status === 'in_season');
      setProgress({ done: 0, total: validLeagues.length });

      const posResults: YearlyPositionalStats[] = [];
      const decResults: YearlyDecisionStats[] = [];
      const sumResults: SeasonSummaryRow[] = [];

      for (let i = 0; i < validLeagues.length; i++) {
        const league = validLeagues[i];
        const year = league.season;

        try {
          // Positional benchmarks
          const benchRes = await analyzePositionalBenchmarks(league, userId);
          let avgEffDiff = 0;
          let effCount = 0;

          if (benchRes) {
            const point: YearlyPositionalStats = { year };
            POSITIONS.forEach(p => {
              const u = benchRes.userStats[p];
              const l = benchRes.leagueAverageStats[p];
              if (u && l) {
                point[`${p}_User_total`] = u.avgPointsPerWeek;
                point[`${p}_Avg_total`] = l.avgPointsPerWeek;
                point[`${p}_User_efficiency`] = u.avgPointsPerStarter;
                point[`${p}_Avg_efficiency`] = l.avgPointsPerStarter;
                avgEffDiff += u.avgPointsPerStarter - l.avgPointsPerStarter;
                effCount++;
              }
            });
            posResults.push(point);
          }

          // Start/sit decisions
          const decSummary = await analyzeStartSitDecisions(league.league_id, userId, year);
          let accuracy = 0;
          let pointsLeft = 0;
          if (decSummary) {
            const allWeekly = decSummary.weeklyDecisions;
            const optWeeks = allWeekly.filter(w => w.isOptimal).length;
            accuracy = allWeekly.length > 0 ? (optWeeks / allWeekly.length) * 100 : 0;
            pointsLeft = decSummary.totalActualPointsLeftOnBench;
            decResults.push({ year, accuracy, pointsLeft });
          }

          sumResults.push({
            year,
            accuracy,
            pointsLeft,
            avgEffDiff: effCount > 0 ? avgEffDiff / effCount : 0,
          });
        } catch (e) { console.warn(`Failed ${year}`, e); }

        // Progressive updates
        setProgress({ done: i + 1, total: validLeagues.length });
        setPositionalData([...posResults].sort((a, b) => (a.year as string).localeCompare(b.year as string)));
        setDecisionData([...decResults].sort((a, b) => a.year.localeCompare(b.year)));
        setSummaryRows([...sumResults].sort((a, b) => b.year.localeCompare(a.year)));
      }
    } catch (e) { console.error('League history error', e); } finally { setLoading(false); }
  };

  if (loading && positionalData.length === 0 && decisionData.length === 0) {
    return (
      <Box sx={{ mb: 3 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Loading season {progress.done} of {progress.total}…
        </Typography>
        <LinearProgress variant={progress.total > 0 ? 'determinate' : 'indeterminate'}
          value={progress.total > 0 ? (progress.done / progress.total) * 100 : 0} />
      </Box>
    );
  }

  if (!loading && positionalData.length === 0 && decisionData.length === 0) {
    return (
      <Typography color="text.secondary" sx={{ textAlign: 'center', py: 8 }}>
        No historical data available for this league.
      </Typography>
    );
  }

  return (
    <Box>
      {loading && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Loading season {progress.done} of {progress.total}…
          </Typography>
          <LinearProgress variant="determinate" value={(progress.done / progress.total) * 100} />
        </Box>
      )}

      {/* Decision Accuracy Trend */}
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
              <ReferenceLine yAxisId="left" y={50} stroke="#666" strokeDasharray="5 5" />
              <Line yAxisId="left" type="monotone" dataKey="accuracy" name="Optimal Lineup Rate"
                stroke="#42a5f5" strokeWidth={3} dot={{ fill: '#42a5f5', r: 4 }} />
              <Line yAxisId="right" type="monotone" dataKey="pointsLeft" name="Proj Pts Left on Bench"
                stroke="#ffa726" strokeWidth={3} dot={{ fill: '#ffa726', r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </Paper>
      )}

      {/* Positional Trends */}
      {positionalData.length > 0 && (
        <>
          <Paper sx={{ p: 3, mb: 4, height: 500 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography variant="h6">Positional Efficiency Over Time</Typography>
              <ToggleButtonGroup value={metric} exclusive onChange={(_, v) => v && setMetric(v)} size="small">
                <ToggleButton value="total">Output</ToggleButton>
                <ToggleButton value="efficiency">Efficiency</ToggleButton>
              </ToggleButtonGroup>
            </Box>
            <ResponsiveContainer width="100%" height="85%">
              <LineChart data={positionalData} margin={{ top: 10, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                <XAxis dataKey="year" stroke="#888" />
                <YAxis stroke="#888"
                  label={{ value: metric === 'total' ? 'Avg Weekly Pts' : 'Pts Per Start', angle: -90, position: 'insideLeft' }} />
                <Tooltip contentStyle={{ backgroundColor: '#333', border: 'none' }}
                  formatter={(val: number | undefined) => val != null ? val.toFixed(1) : '0'} />
                <Legend />
                {POSITIONS.map(pos => (
                  <React.Fragment key={pos}>
                    <Line type="monotone" dataKey={`${pos}_User_${metric}`} name={`${pos} (You)`}
                      stroke={POSITION_COLORS[pos]} strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey={`${pos}_Avg_${metric}`} name={`${pos} (Avg)`}
                      stroke={POSITION_COLORS[pos]} strokeWidth={1} strokeDasharray="4 4" dot={false} />
                  </React.Fragment>
                ))}
              </LineChart>
            </ResponsiveContainer>
          </Paper>

          <Box sx={{ mb: 4 }}>
            <PositionalHeatmap chartData={positionalData} metric={metric} onMetricChange={setMetric} />
          </Box>
        </>
      )}

      {/* Per-Season Summary */}
      {summaryRows.length > 0 && (
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>Per-Season Summary</Typography>
          <SmartTable
            data={summaryRows}
            keyField="year"
            defaultSortBy="year"
            defaultSortOrder="desc"
            columns={[
              { id: 'year', label: 'Season', numeric: false, sortable: true, width: 90 },
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
    </Box>
  );
}
