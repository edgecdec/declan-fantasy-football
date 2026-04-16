export type LineupSlot = {
  slot: string;
  playerId: string;
  playerName: string;
  position: string;
  projectedPoints: number;
  actualPoints?: number;
};

export type LineupMistake = {
  slot: string;
  started: { playerId: string; playerName: string; position: string; projectedPoints: number; actualPoints?: number };
  shouldHaveStarted: { playerId: string; playerName: string; position: string; projectedPoints: number; actualPoints?: number };
  pointsDiff: number;
  actualDiff?: number;
};

export type OptimalLineupResult = {
  optimalLineup: LineupSlot[];
  actualLineup: LineupSlot[];
  pointsLeftOnBench: number;
  mistakes: LineupMistake[];
};

export type WeeklyDecision = {
  week: number;
  leagueId?: string;
  leagueName?: string;
  optimal: OptimalLineupResult;
  isOptimal: boolean;
};

export type PositionAccuracy = {
  position: string;
  correct: number;
  total: number;
  accuracy: number;
};

export type SeasonDecisionSummary = {
  leagueId: string;
  leagueName: string;
  season: string;
  totalPointsLeftOnBench: number;
  decisionAccuracy: number;
  weeklyDecisions: WeeklyDecision[];
  positionAccuracy: PositionAccuracy[];
  worstMistakes: LineupMistake[];
  userId?: string;
};
