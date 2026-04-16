'use client';

import * as React from 'react';
import { Box, Paper, Typography, LinearProgress, Grid } from '@mui/material';
import { useUser } from '@/context/UserContext';
import { SleeperService } from '@/services/sleeper/sleeperService';
import { analyzeMultiLeagueSeason } from '@/services/stats/lineupOptimizer';
import { SeasonDecisionSummary } from '@/types/lineup';
import { SortField, SortDir, aggregateWeekly, mergePositionAccuracy, sortValue } from '@/types/startSit';
import UserSearchInput from '@/components/common/UserSearchInput';
import YearSelector from '@/components/common/YearSelector';
import { WeeklyBreakdown, PositionAccuracyChart, WorstMistakesList } from '@/components/performance/StartSitPanels';

const WORST_MISTAKES_COUNT = 5;
const ACCURACY_THRESHOLD = 50;

export default function StartSitContent() {
  const { user, fetchUser } = useUser();
  const [username, setUsername] = React.useState('');
  const [year, setYear] = React.useState('2025');
  const [loading, setLoading] = React.useState(false);
  const [progress, setProgress] = React.useState({ done: 0, total: 0 });
  const [summaries, setSummaries] = React.useState<SeasonDecisionSummary[]>([]);
  const [sortField, setSortField] = React.useState<SortField>('week');
  const [sortDir, setSortDir] = React.useState<SortDir>('asc');
  const [expandedWeek, setExpandedWeek] = React.useState<number | null>(null);
  const prevTrigger = React.useRef('');

  React.useEffect(() => { if (user) setUsername(user.username); }, [user]);

  React.useEffect(() => {
    const key = `${username}|${year}`;
    if (username && key !== prevTrigger.current) {
      prevTrigger.current = key;
      const t = setTimeout(() => handleAnalyze(), 500);
      return () => clearTimeout(t);
    }
  }, [username, year]);

  const handleAnalyze = async () => {
    if (!username) return;
    setLoading(true);
    setSummaries([]);
    setProgress({ done: 0, total: 0 });
    try {
      let currentUser = user;
      if (!currentUser || currentUser.username.toLowerCase() !== username.toLowerCase()) {
        currentUser = await SleeperService.getUser(username);
        if (!currentUser) throw new Error('User not found');
        fetchUser(username);
      }
      const leagues = await SleeperService.getLeagues(currentUser.user_id, year);
      const valid = leagues.filter(l => !SleeperService.shouldIgnoreLeague(l));
      setProgress({ done: 0, total: valid.length });
      const results = await analyzeMultiLeagueSeason(valid, currentUser.user_id, year, (d, t) => setProgress({ done: d, total: t }));
      setSummaries(results);
    } catch (e) {
      console.error('Start/Sit analysis failed', e);
    } finally {
      setLoading(false);
    }
  };

  const totalPointsLeft = summaries.reduce((s, d) => s + d.totalPointsLeftOnBench, 0);
  const allWeekly = summaries.flatMap(s => s.weeklyDecisions);
  const optimalWeeks = allWeekly.filter(w => w.isOptimal).length;
  const accuracy = allWeekly.length > 0 ? (optimalWeeks / allWeekly.length) * 100 : 0;
  const posAccuracy = mergePositionAccuracy(summaries);
  const worstPosition = posAccuracy.length > 0 ? posAccuracy[0].position : '—';
  const weeklyRows = aggregateWeekly(summaries);
  const allMistakes = summaries.flatMap(s => s.worstMistakes).sort((a, b) => b.pointsDiff - a.pointsDiff).slice(0, WORST_MISTAKES_COUNT);

  const handleSort = (field: SortField) => {
    setSortDir(sortField === field && sortDir === 'asc' ? 'desc' : 'asc');
    setSortField(field);
  };

  const sortedRows = React.useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...weeklyRows].sort((a, b) => (sortValue(a, sortField) - sortValue(b, sortField)) * dir);
  }, [weeklyRows, sortField, sortDir]);

  return (
    <Box>
      <Paper sx={{ p: 2, mb: 3 }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <UserSearchInput username={username} setUsername={setUsername} disabled={loading} />
          <YearSelector userId={user?.user_id} selectedYear={year} onChange={setYear} disabled={loading} />
        </Box>
      </Paper>

      {loading && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Analyzing league {progress.done} of {progress.total}…</Typography>
          <LinearProgress variant={progress.total > 0 ? 'determinate' : 'indeterminate'} value={progress.total > 0 ? (progress.done / progress.total) * 100 : 0} />
        </Box>
      )}

      {summaries.length === 0 && !loading && (
        <Typography color="text.secondary" sx={{ textAlign: 'center', py: 8 }}>Enter a username to analyze start/sit decisions.</Typography>
      )}

      {summaries.length > 0 && (
        <>
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <Paper sx={{ p: 3, textAlign: 'center' }}>
                <Typography variant="h4" color="error.main">{totalPointsLeft.toFixed(1)}</Typography>
                <Typography variant="body2" color="text.secondary">Projected Pts Left on Bench</Typography>
              </Paper>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <Paper sx={{ p: 3, textAlign: 'center' }}>
                <Typography variant="h4" color={accuracy >= ACCURACY_THRESHOLD ? 'success.main' : 'error.main'}>{accuracy.toFixed(1)}%</Typography>
                <Typography variant="body2" color="text.secondary">Optimal Lineup Rate</Typography>
              </Paper>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <Paper sx={{ p: 3, textAlign: 'center' }}>
                <Typography variant="h4" color="warning.main">{worstPosition}</Typography>
                <Typography variant="body2" color="text.secondary">Worst Decision Position</Typography>
              </Paper>
            </Grid>
          </Grid>

          <WeeklyBreakdown rows={sortedRows} sortField={sortField} sortDir={sortDir} expandedWeek={expandedWeek} onSort={handleSort} onToggle={w => setExpandedWeek(expandedWeek === w ? null : w)} />

          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 6 }}><PositionAccuracyChart data={posAccuracy} /></Grid>
            <Grid size={{ xs: 12, md: 6 }}><WorstMistakesList mistakes={allMistakes} /></Grid>
          </Grid>
        </>
      )}
    </Box>
  );
}
