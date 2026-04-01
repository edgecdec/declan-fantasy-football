import { SleeperService, SleeperTransaction } from '@/services/sleeper/sleeperService';
import { CacheService } from '@/services/common/cacheService';

export type TradeSide = {
  rosterId: number;
  username: string;
  players: string[];
  draftPicks: { season: string; round: number }[];
  faab: number[];
};

export type TradeData = {
  transactionId: string;
  week: number;
  timestamp: number;
  sides: [TradeSide, TradeSide];
};

export type LeagueTradeResult = {
  leagueId: string;
  leagueName: string;
  season: string;
  trades: TradeData[];
  rosterToUsername: Record<number, string>;
};

const DEFAULT_REGULAR_SEASON_WEEKS = 14;

function buildRosterUsernameMap(
  users: Awaited<ReturnType<typeof SleeperService.getLeagueUsers>>,
  rosters: Awaited<ReturnType<typeof SleeperService.getRosters>>
): Record<number, string> {
  const ownerToName: Record<string, string> = {};
  for (const u of users) {
    ownerToName[u.user_id] = u.display_name || u.username;
  }
  const map: Record<number, string> = {};
  for (const r of rosters) {
    map[r.roster_id] = ownerToName[r.owner_id] || `Team ${r.roster_id}`;
  }
  return map;
}

function parseTrade(
  tx: SleeperTransaction,
  rosterToUsername: Record<number, string>
): TradeData | null {
  if (tx.roster_ids.length < 2) return null;

  const sideMap = new Map<number, TradeSide>();
  for (const rid of tx.roster_ids) {
    sideMap.set(rid, {
      rosterId: rid,
      username: rosterToUsername[rid] || `Team ${rid}`,
      players: [],
      draftPicks: [],
      faab: [],
    });
  }

  if (tx.adds) {
    for (const [playerId, toRosterId] of Object.entries(tx.adds)) {
      sideMap.get(toRosterId)?.players.push(playerId);
    }
  }

  for (const dp of tx.draft_picks ?? []) {
    const ownerSide = sideMap.get(dp.owner_id);
    ownerSide?.draftPicks.push({ season: dp.season, round: dp.round });
  }

  for (const wb of tx.waiver_budget ?? []) {
    sideMap.get(wb.receiver)?.faab.push(wb.amount);
  }

  const sides = Array.from(sideMap.values());
  if (sides.length < 2) return null;

  return {
    transactionId: tx.transaction_id,
    week: tx.leg,
    timestamp: tx.created,
    sides: [sides[0], sides[1]],
  };
}

export async function fetchLeagueTrades(
  leagueId: string,
  season: string
): Promise<LeagueTradeResult> {
  const cacheKey = `league_trades_${leagueId}_${season}`;
  const cached = CacheService.get<LeagueTradeResult>(cacheKey, 'session');
  if (cached) return cached;

  const [league, users, rosters] = await Promise.all([
    SleeperService.getLeague(leagueId),
    SleeperService.getLeagueUsers(leagueId),
    SleeperService.getRosters(leagueId),
  ]);

  const rosterToUsername = buildRosterUsernameMap(users, rosters);
  const totalWeeks = league?.settings?.playoff_week_start
    ? league.settings.playoff_week_start - 1
    : DEFAULT_REGULAR_SEASON_WEEKS;

  const weeks = Array.from({ length: totalWeeks }, (_, i) => i + 1);
  const allTransactions = await Promise.all(
    weeks.map((w) => SleeperService.getTransactions(leagueId, w))
  );

  const trades: TradeData[] = [];
  for (const weekTxs of allTransactions) {
    for (const tx of weekTxs) {
      if (tx.type !== 'trade') continue;
      const parsed = parseTrade(tx, rosterToUsername);
      if (parsed) trades.push(parsed);
    }
  }

  trades.sort((a, b) => b.week - a.week);

  const result: LeagueTradeResult = {
    leagueId,
    leagueName: league?.name || 'Unknown League',
    season,
    trades,
    rosterToUsername,
  };

  CacheService.set(cacheKey, result, { storage: 'session' });
  return result;
}
