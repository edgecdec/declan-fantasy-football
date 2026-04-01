export type DraftPickEfficiency = {
  pickNumber: number;
  round: number;
  draftSlot: number;
  playerId: string;
  playerName: string;
  position: string;
  team: string;
  totalEfficiency: number;
  weeksStarted: number;
  avgEfficiencyPerWeek: number;
  draftedByRosterId: number;
  draftedByUsername: string;
  changedTeams: boolean;
};

export type LogCurveCoefficients = {
  a: number;
  b: number;
};

export type DraftEfficiencyResult = {
  picks: DraftPickEfficiency[];
  curve: LogCurveCoefficients;
};

export type PositionBreakdown = {
  total: number;
  count: number;
  avg: number;
};

export type ManagerDraftEfficiency = {
  rosterId: number;
  username: string;
  totalEfficiency: number;
  avgPerPick: number;
  pickCount: number;
  positionBreakdown: Record<string, PositionBreakdown>;
};

export type HistoricalPickAverage = {
  pickNumber: number;
  avgEfficiency: number;
  sampleCount: number;
};

export type SeasonDraftSummary = {
  season: string;
  leagueName: string;
  leagueId: string;
  draftId: string;
  totalEfficiency: number;
  avgPerPick: number;
  pickCount: number;
};

export type HistoricalDraftData = {
  averagesByPick: HistoricalPickAverage[];
  seasonSummaries: SeasonDraftSummary[];
};
