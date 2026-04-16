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

export default function StartSitContent() {
  const { user, fetchUser } = useUser();
  const [username, setUsername] = React.useState('');
  const [year, setYear] = React.useState('2025');
  const [loading, setLoading] = React.useState(false);
  const [progress, setProgress] = React.useState({ done: 0, total: 0 });
  const [summaries, setSummaries] = React.useState<SeasonDecisionSummary[]>([]);
  const [sortField, setSortField] = React.useState<SortField>('week');
  const [sortDir, setSortDir] = React.useState<SortDir>('asc');
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

  // Compute summary stats
  const allMistakes = summaries.flatMap(s => s.worstMistakes).sort((a, b) => b.pointsDiff - a.pointsDiff);

  // Net actual points lost: sum actualDiff for all mistakes (negative = user lost pts)
  const totalActualLost = allMistakes.reduce((s, m) => {
    if (m.actualDiff != null && m.actualDiff < 0) return s + m.actualDiff;
    return s;
  }, 0);

  // Times user beat projections (their pick scored more than the optimal pick)
  const timesBeatProjection = allMistakes.filter(m => m.actualDiff != null && m.actualDiff > 0).length;

  // Net skill: sum of all actualDiff values (positive = user is better than projections overall)
  const netSkill = allMistakes.reduce((s, m) => s + (m.actualDiff ?? 0), 0);

  const posAccuracy = mergePositionAccuracy(summaries);
  const worstPosition = posAccuracy.length > 0 ? posAccuracy[0].position : '—';
  const weeklyRows = aggregateWeekly(summaries);
  const topMistakes = allMistakes.slice(0, WORST_MISTAKES_COUNT);

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
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <Paper sx={{ p: 3, textAlign: 'center' }}>
                <Typography variant="h4" color="error.main">{totalActualLost.toFixed(1)}</Typography>
                <Typography variant="body2" color="text.secondary">Actual Pts Lost</Typography>
              </Paper>
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <Paper sx={{ p: 3, textAlign: 'center' }}>
                <Typography variant="h4" color="success.main">{timesBeatProjection}</Typography>
                <Typography variant="body2" color="text.secondary">Times Beat Projections</Typography>
              </Paper>
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <Paper sx={{ p: 3, textAlign: 'center' }}>
                <Typography variant="h4" color={netSkill >= 0 ? 'success.main' : 'error.main'}>
                  {netSkill >= 0 ? '+' : ''}{netSkill.toFixed(1)}
                </Typography>
                <Typography variant="body2" color="text.secondary">Net Skill Score</Typography>
              </Paper>
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <Paper sx={{ p: 3, textAlign: 'center' }}>
                <Typography variant="h4" color="warning.main">{worstPosition}</Typography>
                <Typography variant="body2" color="text.secondary">Worst Position</Typography>
              </Paper>
            </Grid>
          </Grid>

          <WeeklyBreakdown rows={sortedRows} sortField={sortField} sortDir={sortDir} onSort={handleSort} />

          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 6 }}><PositionAccuracyChart data={posAccuracy} /></Grid>
            <Grid size={{ xs: 12, md: 6 }}><WorstMistakesList mistakes={topMistakes} /></Grid>
          </Grid>
        </>
      )}
    </Box>
  );
}
