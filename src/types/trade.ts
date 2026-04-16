export type PlayerWeekEfficiency = {
  week: number;
  points: number;
  leagueAvg: number;
  efficiency: number;
};

export type PlayerTradeEfficiency = {
  playerId: string;
  name: string;
  position: string;
  weeksStarted: number;
  totalEfficiency: number;
  avgEfficiency: number;
  totalSeasonEfficiency: number;
  totalSeasonWeeksStarted: number;
  weeklyBreakdown: PlayerWeekEfficiency[];
  departureWeek: number | null;
};

export type TradeDraftPick = {
  season: string;
  round: number;
  resolvedPick?: string;
  resolvedPlayer?: string;
  resolvedPlayerId?: string;
  resolvedPosition?: string;
  efficiency?: PlayerTradeEfficiency;
};

export type TradeFaab = {
  amount: number;
};

export type TradeEfficiencySide = {
  rosterId: number;
  username: string;
  players: PlayerTradeEfficiency[];
  draftPicks: TradeDraftPick[];
  faabItems: TradeFaab[];
  totalEfficiency: number;
};

export type TradeEfficiencyResult = {
  transactionId: string;
  week: number;
  timestamp: number;
  sides: [TradeEfficiencySide, TradeEfficiencySide];
};

export type LeagueTradeEfficiencyResult = {
  leagueId: string;
  leagueName: string;
  season: string;
  trades: TradeEfficiencyResult[];
  rosterToUsername: Record<number, string>;
};
