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
