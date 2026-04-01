import { SleeperService, SleeperMatchup } from '@/services/sleeper/sleeperService';
import { CacheService } from '@/services/common/cacheService';
import { fetchLeagueTrades, TradeData } from '@/services/stats/tradeAnalyzer';
import {
  PlayerWeekEfficiency,
  TradeEfficiencySide,
  TradeEfficiencyResult,
  LeagueTradeEfficiencyResult,
} from '@/types/trade';
import playerData from '../../../data/sleeper_players.json';

export type { PlayerWeekEfficiency, PlayerTradeEfficiency, TradeEfficiencySide, TradeEfficiencyResult, LeagueTradeEfficiencyResult } from '@/types/trade';

const DEFAULT_REGULAR_SEASON_WEEKS = 14;
const VALID_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

type PlayerRecord = { first_name: string; last_name: string; position: string };
const players = (playerData as unknown as { players: Record<string, PlayerRecord> }).players ?? {};

function getPlayerPosition(playerId: string): string | null {
  const pos = players[playerId]?.position;
  return pos && VALID_POSITIONS.includes(pos) ? pos : null;
}

function getPlayerName(playerId: string): string {
  const p = players[playerId];
  return p ? `${p.first_name} ${p.last_name}` : 'Unknown';
}

function calcPositionalAvg(matchups: SleeperMatchup[], position: string): number {
  let total = 0;
  let count = 0;
  for (const m of matchups) {
    if (!m.starters?.length) continue;
    const pts = (m as Record<string, unknown>).starters_points as number[] | undefined;
    if (!pts) continue;
    for (let i = 0; i < m.starters.length; i++) {
      if (getPlayerPosition(m.starters[i]) === position) {
        total += pts[i] || 0;
        count++;
      }
    }
  }
  return count > 0 ? total / count : 0;
}

function evaluateSidePlayers(
  side: TradeData['sides'][0],
  tradeWeek: number,
  totalWeeks: number,
  allMatchups: Map<number, SleeperMatchup[]>,
  getAvg: (week: number, position: string) => number
): TradeEfficiencySide {
  const result: TradeEfficiencySide = {
    rosterId: side.rosterId,
    username: side.username,
    players: [],
    draftPicks: (side.draftPicks ?? []).map((dp) => ({ season: dp.season, round: dp.round })),
    faabItems: (side.faab ?? []).map((amount) => ({ amount })),
    totalEfficiency: 0,
  };

  for (const playerId of side.players) {
    const position = getPlayerPosition(playerId);
    if (!position) continue;

    const weeklyBreakdown: PlayerWeekEfficiency[] = [];

    for (let w = tradeWeek + 1; w <= totalWeeks; w++) {
      const weekMatchups = allMatchups.get(w) || [];
      const roster = weekMatchups.find((m) => m.roster_id === side.rosterId);
      if (!roster?.starters?.length) continue;

      const starterIdx = roster.starters.indexOf(playerId);
      if (starterIdx === -1) continue;

      const pts = (roster as Record<string, unknown>).starters_points as number[] | undefined;
      const points = pts?.[starterIdx] ?? 0;
      const leagueAvg = getAvg(w, position);
      weeklyBreakdown.push({ week: w, points, leagueAvg, efficiency: points - leagueAvg });
    }

    const totalEff = weeklyBreakdown.reduce((s, wb) => s + wb.efficiency, 0);
    const lastStartedWeek = weeklyBreakdown.length > 0
      ? weeklyBreakdown[weeklyBreakdown.length - 1].week
      : tradeWeek;
    const departureWeek = lastStartedWeek < totalWeeks ? lastStartedWeek + 1 : null;

    result.players.push({
      playerId,
      name: getPlayerName(playerId),
      position,
      weeksStarted: weeklyBreakdown.length,
      totalEfficiency: totalEff,
      avgEfficiency: weeklyBreakdown.length > 0 ? totalEff / weeklyBreakdown.length : 0,
      weeklyBreakdown,
      departureWeek,
    });
    result.totalEfficiency += totalEff;
  }

  return result;
}

export async function evaluateTradeEfficiency(
  leagueId: string,
  season: string
): Promise<LeagueTradeEfficiencyResult> {
  const cacheKey = `trade_efficiency_${leagueId}_${season}`;
  const cached = CacheService.get<LeagueTradeEfficiencyResult>(cacheKey, 'session');
  if (cached) return cached;

  const tradeResult = await fetchLeagueTrades(leagueId, season);
  const league = await SleeperService.getLeague(leagueId);
  const totalWeeks = league?.settings?.playoff_week_start
    ? league.settings.playoff_week_start - 1
    : DEFAULT_REGULAR_SEASON_WEEKS;

  const weekNums = Array.from({ length: totalWeeks }, (_, i) => i + 1);
  const fetched = await Promise.all(weekNums.map((w) => SleeperService.getMatchups(leagueId, w)));
  const allMatchups = new Map<number, SleeperMatchup[]>();
  weekNums.forEach((w, i) => allMatchups.set(w, fetched[i]));

  const avgCache = new Map<string, number>();
  function getAvg(week: number, position: string): number {
    const key = `${week}_${position}`;
    if (!avgCache.has(key)) {
      avgCache.set(key, calcPositionalAvg(allMatchups.get(week) || [], position));
    }
    return avgCache.get(key)!;
  }

  const trades: TradeEfficiencyResult[] = tradeResult.trades.map((trade) => ({
    transactionId: trade.transactionId,
    week: trade.week,
    timestamp: trade.timestamp,
    sides: [
      evaluateSidePlayers(trade.sides[0], trade.week, totalWeeks, allMatchups, getAvg),
      evaluateSidePlayers(trade.sides[1], trade.week, totalWeeks, allMatchups, getAvg),
    ],
  }));

  const result: LeagueTradeEfficiencyResult = {
    leagueId: tradeResult.leagueId,
    leagueName: tradeResult.leagueName,
    season: tradeResult.season,
    trades,
    rosterToUsername: tradeResult.rosterToUsername,
  };

  CacheService.set(cacheKey, result, { storage: 'session' });
  return result;
}
