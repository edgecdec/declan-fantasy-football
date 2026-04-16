export type LineupSlot = {
  slot: string;
  playerId: string;
  playerName: string;
  position: string;
  projectedPoints: number;
};

export type LineupMistake = {
  slot: string;
  started: { playerId: string; playerName: string; position: string; projectedPoints: number };
  shouldHaveStarted: { playerId: string; playerName: string; position: string; projectedPoints: number };
  pointsDiff: number;
};

export type OptimalLineupResult = {
  optimalLineup: LineupSlot[];
  actualLineup: LineupSlot[];
  pointsLeftOnBench: number;
  mistakes: LineupMistake[];
};

export type WeeklyDecision = {
  week: number;
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
