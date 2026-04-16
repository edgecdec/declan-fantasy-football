'use client';

import * as React from 'react';
import { Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  Container, Box, Tabs, Tab, Typography, Paper, LinearProgress,
} from '@mui/material';
import BarChartIcon from '@mui/icons-material/BarChart';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import HistoryIcon from '@mui/icons-material/History';
import PageHeader from '@/components/common/PageHeader';
import { useUser } from '@/context/UserContext';
import { SleeperService } from '@/services/sleeper/sleeperService';
import { analyzePositionalBenchmarks, LeagueBenchmarkResult } from '@/services/stats/positionalBenchmarks';
import { analyzeLeagueAllManagers } from '@/services/stats/lineupOptimizer';
import { SeasonDecisionSummary } from '@/types/lineup';
import LeagueEfficiencyTable from '@/components/performance/LeagueEfficiencyTable';
import LeagueDecisionsTable from '@/components/performance/LeagueDecisionsTable';
import LeagueHistoricalContent from '@/components/performance/LeagueHistoricalContent';

const TABS = [
  { value: 'efficiency', label: 'Positional Efficiency', icon: <BarChartIcon /> },
  { value: 'decisions', label: 'Start/Sit Decisions', icon: <CompareArrowsIcon /> },
  { value: 'historical', label: 'Historical', icon: <HistoryIcon /> },
] as const;

type TabValue = typeof TABS[number]['value'];

function LeagueDrilldownContent() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const leagueId = params.leagueId as string;
  const { user } = useUser();
  const currentTab = (searchParams.get('tab') as TabValue) || 'efficiency';

  const [leagueName, setLeagueName] = React.useState('');
  const [benchmarkResult, setBenchmarkResult] = React.useState<LeagueBenchmarkResult | null>(null);
  const [decisionSummaries, setDecisionSummaries] = React.useState<SeasonDecisionSummary[]>([]);
  const [loadingEff, setLoadingEff] = React.useState(false);
  const [loadingDec, setLoadingDec] = React.useState(false);
  const [weekProgress, setWeekProgress] = React.useState({ done: 0, total: 0 });

  const handleTabChange = (_: React.SyntheticEvent, newValue: TabValue) => {
    router.push(`/skill/league/${leagueId}?tab=${newValue}`);
  };

  // Fetch league name
  React.useEffect(() => {
    SleeperService.getLeague(leagueId).then(l => {
      if (l) setLeagueName(l.name);
    });
  }, [leagueId]);

  // Fetch positional efficiency data for all managers
  React.useEffect(() => {
    if (!user || !leagueId) return;
    setLoadingEff(true);
    SleeperService.getLeague(leagueId).then(league => {
      if (!league) { setLoadingEff(false); return; }
      analyzePositionalBenchmarks(league, user.user_id).then(result => {
        setBenchmarkResult(result);
        setLoadingEff(false);
      }).catch(() => setLoadingEff(false));
    });
  }, [leagueId, user]);

  // Fetch start/sit decisions for ALL managers when decisions tab is shown
  React.useEffect(() => {
    if (currentTab !== 'decisions' || !leagueId || decisionSummaries.length > 0) return;
    setLoadingDec(true);
    SleeperService.getLeague(leagueId).then(league => {
      if (!league) { setLoadingDec(false); return; }
      analyzeLeagueAllManagers(leagueId, league.season, (done, total) => {
        setWeekProgress({ done, total });
      }).then(results => {
        setDecisionSummaries(results);
        setLoadingDec(false);
      }).catch(() => setLoadingDec(false));
    });
  }, [currentTab, leagueId, decisionSummaries.length]);

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <PageHeader
        title={leagueName || 'League Skill Analysis'}
        subtitle="Compare manager skills across positional efficiency and lineup decisions."
      />

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={currentTab} onChange={handleTabChange}>
          {TABS.map(tab => (
            <Tab key={tab.value} value={tab.value} label={tab.label} icon={tab.icon} iconPosition="start" />
          ))}
        </Tabs>
      </Box>

      {currentTab === 'efficiency' && (
        <>
          {loadingEff && <LinearProgress sx={{ mb: 2 }} />}
          {benchmarkResult && (
            <LeagueEfficiencyTable result={benchmarkResult} currentUserId={user?.user_id} />
          )}
          {!loadingEff && !benchmarkResult && (
            <Typography color="text.secondary" sx={{ textAlign: 'center', py: 8 }}>
              No positional data available for this league.
            </Typography>
          )}
        </>
      )}

      {currentTab === 'decisions' && (
        <>
          {loadingDec && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Analyzing week {weekProgress.done} of {weekProgress.total}…
              </Typography>
              <LinearProgress
                variant={weekProgress.total > 0 ? 'determinate' : 'indeterminate'}
                value={weekProgress.total > 0 ? (weekProgress.done / weekProgress.total) * 100 : 0}
              />
            </Box>
          )}
          {decisionSummaries.length > 0 && (
            <LeagueDecisionsTable summaries={decisionSummaries} currentUserId={user?.user_id} leagueId={leagueId} />
          )}
          {!loadingDec && decisionSummaries.length === 0 && (
            <Typography color="text.secondary" sx={{ textAlign: 'center', py: 8 }}>
              No start/sit decision data available for this league.
            </Typography>
          )}
        </>
      )}

      {currentTab === 'historical' && user && (
        <LeagueHistoricalContent leagueId={leagueId} userId={user.user_id} />
      )}
      {currentTab === 'historical' && !user && (
        <Typography color="text.secondary" sx={{ textAlign: 'center', py: 8 }}>
          Log in to view historical analysis.
        </Typography>
      )}
    </Container>
  );
}

export default function LeagueDrilldownPage() {
  return (
    <Suspense>
      <LeagueDrilldownContent />
    </Suspense>
  );
}
