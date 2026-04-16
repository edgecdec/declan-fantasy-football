import { WeeklyDecision, SeasonDecisionSummary, PositionAccuracy } from '@/types/lineup';

export type AggWeek = {
  week: number;
  projected: number;
  optimal: number;
  pointsLeft: number;
  mistakeCount: number;
  decisions: WeeklyDecision[];
};

export type SortField = 'week' | 'projected' | 'optimal' | 'pointsLeft' | 'mistakes';
export type SortDir = 'asc' | 'desc';

export function aggregateWeekly(summaries: SeasonDecisionSummary[]): AggWeek[] {
  const byWeek = new Map<number, AggWeek>();
  for (const s of summaries) {
    for (const w of s.weeklyDecisions) {
      const e = byWeek.get(w.week) || { week: w.week, projected: 0, optimal: 0, pointsLeft: 0, mistakeCount: 0, decisions: [] };
      e.projected += w.optimal.actualLineup.reduce((a, b) => a + b.projectedPoints, 0);
      e.optimal += w.optimal.optimalLineup.reduce((a, b) => a + b.projectedPoints, 0);
      e.pointsLeft += w.optimal.pointsLeftOnBench;
      e.mistakeCount += w.optimal.mistakes.length;
      e.decisions.push(w);
      byWeek.set(w.week, e);
    }
  }
  return Array.from(byWeek.values()).sort((a, b) => a.week - b.week);
}

export function mergePositionAccuracy(summaries: SeasonDecisionSummary[]): PositionAccuracy[] {
  const map = new Map<string, { correct: number; total: number }>();
  for (const s of summaries) {
    for (const pa of s.positionAccuracy) {
      const e = map.get(pa.position) || { correct: 0, total: 0 };
      e.correct += pa.correct;
      e.total += pa.total;
      map.set(pa.position, e);
    }
  }
  return Array.from(map.entries())
    .map(([position, d]) => ({ position, ...d, accuracy: d.total > 0 ? (d.correct / d.total) * 100 : 100 }))
    .sort((a, b) => a.accuracy - b.accuracy);
}

export function sortValue(row: AggWeek, field: SortField): number {
  switch (field) {
    case 'week': return row.week;
    case 'projected': return row.projected;
    case 'optimal': return row.optimal;
    case 'pointsLeft': return row.pointsLeft;
    case 'mistakes': return row.mistakeCount;
  }
}
