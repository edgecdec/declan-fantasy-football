'use client';

import * as React from 'react';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Container,
  Box,
  Tabs,
  Tab,
  Typography
} from '@mui/material';
import BarChartIcon from '@mui/icons-material/BarChart';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import HistoryIcon from '@mui/icons-material/History';
import PageHeader from '@/components/common/PageHeader';
import PositionalBenchmarksContent from '@/components/performance/PositionalBenchmarksContent';
import StartSitContent from '@/components/performance/StartSitContent';
import HistoricalContent from '@/components/performance/HistoricalContent';

const TABS = [
  { value: 'efficiency', label: 'Positional Efficiency', icon: <BarChartIcon /> },
  { value: 'decisions', label: 'Start/Sit Decisions', icon: <CompareArrowsIcon /> },
  { value: 'historical', label: 'Historical', icon: <HistoryIcon /> },
] as const;

type TabValue = typeof TABS[number]['value'];

function SkillHubContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentTab = (searchParams.get('tab') as TabValue) || 'efficiency';

  const handleTabChange = (_: React.SyntheticEvent, newValue: TabValue) => {
    router.push(`/skill?tab=${newValue}`);
  };

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <PageHeader
        title="Manager Skill Hub"
        subtitle="Analyze your fantasy management skills — positional efficiency, lineup decisions, and historical trends."
      />

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={currentTab} onChange={handleTabChange} variant="scrollable" scrollButtons="auto">
          {TABS.map(tab => (
            <Tab key={tab.value} value={tab.value} label={tab.label} icon={tab.icon} iconPosition="start" />
          ))}
        </Tabs>
      </Box>

      {currentTab === 'efficiency' && <PositionalBenchmarksContent />}

      {currentTab === 'decisions' && <StartSitContent />}

      {currentTab === 'historical' && <HistoricalContent />}
    </Container>
  );
}

export default function SkillHubPage() {
  return (
    <Suspense>
      <SkillHubContent />
    </Suspense>
  );
}
