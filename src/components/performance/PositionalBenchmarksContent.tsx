'use client';

import * as React from 'react';
import {
  Box,
  Paper,
  Typography,
  LinearProgress,
  Grid,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Divider,
  Checkbox,
  FormControlLabel
} from '@mui/material';
import { useUser } from '@/context/UserContext';
import { SleeperService, SleeperLeague } from '@/services/sleeper/sleeperService';
import { analyzePositionalBenchmarks, LeagueBenchmarkResult } from '@/services/stats/positionalBenchmarks';
import UserSearchInput from '@/components/common/UserSearchInput';
import YearSelector from '@/components/common/YearSelector';
import SkillProfileChart, { AggregatePositionStats } from '@/components/performance/SkillProfileChart';
import PlayerImpactList from '@/components/performance/PlayerImpactList';
import LeagueBreakdown from '@/components/performance/LeagueBreakdown';
import ImpactsModal from '@/components/performance/ImpactsModal';
import useSeason from '@/hooks/useSeason';

const VALID_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

type LeagueResultItem = {
  league: SleeperLeague;
  result: LeagueBenchmarkResult;
  category: 'included' | 'excluded';
};

export default function PositionalBenchmarksContent() {
  const { user, fetchUser } = useUser();
  const [username, setUsername] = React.useState('');
  // Benchmarks compare against completed-season output, so seed to the last
  // season with games rather than an upcoming one.
  const { season: year, setSeason: setYear } = useSeason('results');
  const [loading, setLoading] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [status, setStatus] = React.useState('');
  const [results, setResults] = React.useState<LeagueResultItem[]>([]);
  const [aggregateData, setAggregateData] = React.useState<AggregatePositionStats[]>([]);
  const [metric, setMetric] = React.useState<'total' | 'efficiency'>('efficiency');
  const [globalImpacts, setGlobalImpacts] = React.useState<any[]>([]);
  const [impactsModalData, setImpactsModalData] = React.useState<any[] | null>(null);
  const [includePlayoffs, setIncludePlayoffs] = React.useState(true);
  const [leagueType, setLeagueType] = React.useState<'all' | 'redraft' | 'dynasty'>('all');

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

  React.useEffect(() => {
    if (username && !loading && results.length === 0) {
      const t = setTimeout(() => handleAnalyze(), 500);
      return () => clearTimeout(t);
    }
  }, [username]);

  React.useEffect(() => {
    if (results.length > 0) {
      calculateAggregates(results);
      calculateGlobalImpacts(results);
    }
  }, [leagueType]);

  const handleAnalyze = async () => {
    if (!username) return;
    setLoading(true);
    setProgress(0);
    setResults([]);
    setAggregateData([]);
    setGlobalImpacts([]);
    setStatus('Finding leagues...');

    try {
      let currentUser = user;
      if (!currentUser || currentUser.username.toLowerCase() !== username.toLowerCase()) {
        currentUser = await SleeperService.getUser(username);
        if (!currentUser) throw new Error('User not found');
        fetchUser(username);
      }

      const leagues = await SleeperService.getLeagues(currentUser.user_id, year);
      const totalSteps = leagues.length;
      const accumulated: LeagueResultItem[] = [];

      for (let i = 0; i < totalSteps; i++) {
        const league = leagues[i];
        const isExcluded = SleeperService.shouldIgnoreLeague(league);
        setStatus(`Loading league ${i + 1} of ${totalSteps}: ${league.name}`);
        try {
          const res = await analyzePositionalBenchmarks(league, currentUser.user_id, includePlayoffs);
          if (!res) continue;
          accumulated.push({ league, result: res, category: isExcluded ? 'excluded' : 'included' });
          const snapshot = [...accumulated];
          setResults(snapshot);
          calculateAggregates(snapshot);
          calculateGlobalImpacts(snapshot);
        } catch (e) {
          console.warn(`Failed to analyze ${league.name}`, e);
        }
        setProgress(((i + 1) / totalSteps) * 100);
      }
    } catch (e) {
      console.error(e);
      setStatus('Error occurred');
    } finally {
      setLoading(false);
    }
  };

  const toggleLeagueCategory = (leagueId: string) => {
    const newResults = results.map(item =>
      item.result.leagueId === leagueId
        ? { ...item, category: item.category === 'included' ? 'excluded' : 'included' as 'included' | 'excluded' }
        : item
    );
    setResults(newResults);
    calculateAggregates(newResults);
    calculateGlobalImpacts(newResults);
  };

  const calculateGlobalImpacts = (data: LeagueResultItem[]) => {
    const impactMap = new Map<string, {
      totalPOLA: number; weeks: number; name: string; position: string;
      startedWeeks: Record<string, number[]>;
    }>();

    data
      .filter(item => item.category === 'included')
      .filter(item => {
        if (leagueType === 'all') return true;
        const isDynasty = item.league.settings.type === 2;
        return leagueType === 'dynasty' ? isDynasty : !isDynasty;
      })
      .forEach(item => {
        item.result.playerImpacts.forEach(p => {
          if (p.ownerId === user?.user_id) {
            let curr = impactMap.get(p.playerId);
            if (!curr) {
              curr = { totalPOLA: 0, weeks: 0, name: p.name, position: p.position, startedWeeks: {} };
              impactMap.set(p.playerId, curr);
            }
            curr.totalPOLA += p.totalPOLA;
            curr.weeks += p.weeksStarted;
            if (p.startedWeeks) {
              Object.entries(p.startedWeeks).forEach(([yr, wks]) => {
                if (!curr!.startedWeeks[yr]) curr!.startedWeeks[yr] = [];
                curr!.startedWeeks[yr] = Array.from(new Set([...curr!.startedWeeks[yr], ...wks]));
              });
            }
          }
        });
      });

    setGlobalImpacts(
      Array.from(impactMap.entries())
        .map(([id, val]) => ({ playerId: id, ...val, avgPOLA: val.totalPOLA / val.weeks }))
        .sort((a, b) => b.totalPOLA - a.totalPOLA)
    );
  };

  const calculateAggregates = (data: LeagueResultItem[]) => {
    const sums = {
      total: { user: {} as Record<string, number>, league: {} as Record<string, number> },
      efficiency: { user: {} as Record<string, number>, league: {} as Record<string, number> }
    };
    const counts = {} as Record<string, number>;
    VALID_POSITIONS.forEach(pos => {
      sums.total.user[pos] = 0; sums.total.league[pos] = 0;
      sums.efficiency.user[pos] = 0; sums.efficiency.league[pos] = 0;
      counts[pos] = 0;
    });

    data
      .filter(item => item.category === 'included')
      .filter(item => {
        if (leagueType === 'all') return true;
        const isDynasty = item.league.settings.type === 2;
        return leagueType === 'dynasty' ? isDynasty : !isDynasty;
      })
      .forEach(item => {
        const res = item.result;
        VALID_POSITIONS.forEach(pos => {
          const u = res.userStats[pos];
          const l = res.leagueAverageStats[pos];
          const lVal = l?.avgPointsPerWeek || 0;
          if (lVal > 0) {
            sums.total.user[pos] += (u?.avgPointsPerWeek || 0);
            sums.total.league[pos] += lVal;
            sums.efficiency.user[pos] += (u?.avgPointsPerStarter || 0);
            sums.efficiency.league[pos] += (l?.avgPointsPerStarter || 0);
            counts[pos]++;
          }
        });
      });

    setAggregateData(VALID_POSITIONS.map(pos => {
      const c = counts[pos] || 1;
      const avgUserPoints = sums.total.user[pos] / c;
      const avgLeaguePoints = sums.total.league[pos] / c;
      const diffPoints = avgUserPoints - avgLeaguePoints;
      const diffPct = avgLeaguePoints > 0 ? (diffPoints / avgLeaguePoints) * 100 : 0;
      const avgUserEff = sums.efficiency.user[pos] / c;
      const avgLeagueEff = sums.efficiency.league[pos] / c;
      const diffEff = avgUserEff - avgLeagueEff;
      const diffEffPct = avgLeagueEff > 0 ? (diffEff / avgLeagueEff) * 100 : 0;
      return { position: pos, avgUserPoints, avgLeaguePoints, diffPoints, diffPct, avgUserEff, avgLeagueEff, diffEff, diffEffPct };
    }));
  };

  return (
    <>
      <Paper sx={{ p: 3, mb: 4 }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <UserSearchInput username={username} setUsername={setUsername} disabled={loading} />
          <YearSelector userId={user?.user_id} selectedYear={year} onChange={setYear} disabled={loading} />
          <FormControl sx={{ minWidth: 140 }}>
            <InputLabel>League Type</InputLabel>
            <Select value={leagueType} label="League Type" onChange={(e) => setLeagueType(e.target.value as any)} disabled={loading}>
              <MenuItem value="all">All Leagues</MenuItem>
              <MenuItem value="redraft">Redraft Only</MenuItem>
              <MenuItem value="dynasty">Dynasty Only</MenuItem>
            </Select>
          </FormControl>
          <FormControlLabel
            control={<Checkbox checked={includePlayoffs} onChange={(e) => setIncludePlayoffs(e.target.checked)} disabled={loading} />}
            label="Include Playoffs"
            sx={{ mr: 2 }}
          />
          <Button variant="contained" size="large" onClick={handleAnalyze} disabled={loading || !username} sx={{ height: 56 }}>
            {loading ? 'Analyzing...' : 'Analyze'}
          </Button>
        </Box>
        {loading && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="body2" gutterBottom>{status} ({Math.round(progress)}%)</Typography>
            <LinearProgress variant="determinate" value={progress} />
          </Box>
        )}
      </Paper>

      {aggregateData.length > 0 && (
        <Grid container spacing={4} sx={{ mb: 4 }}>
          <Grid size={{ xs: 12, lg: 8 }}>
            <SkillProfileChart data={aggregateData} metric={metric} onMetricChange={setMetric} />
          </Grid>
          <Grid size={{ xs: 12, lg: 4 }}>
            <PlayerImpactList impacts={globalImpacts} title="Portfolio MVPs & LVPs" onViewAll={() => setImpactsModalData(globalImpacts)} />
          </Grid>
        </Grid>
      )}

      {results.length > 0 && (
        <Box>
          <Typography variant="h5" gutterBottom sx={{ mt: 4, mb: 2 }}>Included Leagues</Typography>
          <Grid container spacing={3}>
            {results.filter(item => item.category === 'included').map(item => (
              <LeagueBreakdown key={item.result.leagueId} item={item} onToggle={toggleLeagueCategory} onViewImpacts={setImpactsModalData} />
            ))}
          </Grid>
          {results.some(item => item.category === 'excluded') && (
            <>
              <Divider sx={{ my: 4 }} />
              <Typography variant="h5" gutterBottom sx={{ mb: 2, opacity: 0.7 }}>Excluded Leagues</Typography>
              <Grid container spacing={3} sx={{ opacity: 0.7 }}>
                {results.filter(item => item.category === 'excluded').map(item => (
                  <LeagueBreakdown key={item.result.leagueId} item={item} onToggle={toggleLeagueCategory} onViewImpacts={setImpactsModalData} />
                ))}
              </Grid>
            </>
          )}
        </Box>
      )}

      <ImpactsModal data={impactsModalData} onClose={() => setImpactsModalData(null)} />
    </>
  );
}
