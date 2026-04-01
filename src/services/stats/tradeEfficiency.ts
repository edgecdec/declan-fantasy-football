import { SleeperService, SleeperMatchup, SleeperDraftPick } from '@/services/sleeper/sleeperService';
import { CacheService } from '@/services/common/cacheService';
import { fetchLeagueTrades, TradeData } from '@/services/stats/tradeAnalyzer';
import {
  PlayerWeekEfficiency,
  TradeDraftPick,
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

function resolveDraftPick(
  dp: { season: string; round: number; rosterId: number },
  draftPicksByRound: Map<string, SleeperDraftPick[]>
): TradeDraftPick {
  const key = `${dp.season}_${dp.round}`;
  const roundPicks = draftPicksByRound.get(key) || [];
  const match = roundPicks.find((p) => p.roster_id === dp.rosterId);
  if (match) {
    const name = match.metadata
      ? `${match.metadata.first_name} ${match.metadata.last_name}`
      : getPlayerName(match.player_id);
    return {
      season: dp.season,
      round: dp.round,
      resolvedPick: `${match.round}.${String(match.draft_slot).padStart(2, '0')}`,
      resolvedPlayer: name,
    };
  }
  return { season: dp.season, round: dp.round };
}

function evaluateSidePlayers(
  side: TradeData['sides'][0],
  tradeWeek: number,
  totalWeeks: number,
  allMatchups: Map<number, SleeperMatchup[]>,
  getAvg: (week: number, position: string) => number,
  draftPicksByRound: Map<string, SleeperDraftPick[]>
): TradeEfficiencySide {
  const result: TradeEfficiencySide = {
    rosterId: side.rosterId,
    username: side.username,
    players: [],
    draftPicks: (side.draftPicks ?? []).map((dp) => resolveDraftPick(dp, draftPicksByRound)),
    faabItems: (side.faab ?? []).map((amount) => ({ amount })),
    totalEfficiency: 0,
  };

  for (const playerId of side.players) {
    const position = getPlayerPosition(playerId);
    if (!position) continue;

    const weeklyBreakdown: PlayerWeekEfficiency[] = [];
    let totalSeasonEff = 0;
    let totalSeasonWeeks = 0;

    for (let w = tradeWeek + 1; w <= totalWeeks; w++) {
      const weekMatchups = allMatchups.get(w) || [];

      // Check all rosters for total season efficiency
      for (const m of weekMatchups) {
        if (!m.starters?.length) continue;
        const starterIdx = m.starters.indexOf(playerId);
        if (starterIdx === -1) continue;
        const pts = (m as Record<string, unknown>).starters_points as number[] | undefined;
        const points = pts?.[starterIdx] ?? 0;
        const leagueAvg = getAvg(w, position);
        const eff = points - leagueAvg;
        totalSeasonEff += eff;
        totalSeasonWeeks++;

        // Also track team-specific efficiency for the receiving team
        if (m.roster_id === side.rosterId) {
          weeklyBreakdown.push({ week: w, points, leagueAvg, efficiency: eff });
        }
        break; // Player can only be on one roster per week
      }
    }

    const totalEff = weeklyBreakdown.reduce((s, wb) => s + wb.efficiency, 0);
    const lastStartedWeek = weeklyBreakdown.length > 0
      ? weeklyBreakdown[weeklyBreakdown.length - 1].week
      : null;
    const departureWeek = lastStartedWeek != null && lastStartedWeek < totalWeeks
      ? lastStartedWeek + 1
      : null;

    result.players.push({
      playerId,
      name: getPlayerName(playerId),
      position,
      weeksStarted: weeklyBreakdown.length,
      totalEfficiency: totalEff,
      avgEfficiency: weeklyBreakdown.length > 0 ? totalEff / weeklyBreakdown.length : 0,
      totalSeasonEfficiency: totalSeasonEff,
      totalSeasonWeeksStarted: totalSeasonWeeks,
      weeklyBreakdown,
      departureWeek,
    });
    result.totalEfficiency += totalSeasonEff;
  }

  return result;
}

async function fetchDraftPicksByRound(
  leagueId: string,
  season: string
): Promise<Map<string, SleeperDraftPick[]>> {
  const map = new Map<string, SleeperDraftPick[]>();
  try {
    const drafts = await SleeperService.getLeagueDrafts(leagueId);
    const seasonDraft = drafts.find((d) => d.season === season && d.status === 'complete');
    if (!seasonDraft) return map;
    const picks = await SleeperService.getDraftPicks(seasonDraft.draft_id);
    for (const p of picks) {
      const key = `${season}_${p.round}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
  } catch {
    // Draft may not exist yet — return empty map
  }
  return map;
}

async function getLastPlayoffWeek(leagueId: string, playoffWeekStart: number): Promise<number> {
  try {
    const bracket = await SleeperService.getWinnersBracket(leagueId);
    if (bracket.length > 0) {
      const maxRound = Math.max(...bracket.map((m) => m.r));
      return playoffWeekStart + maxRound - 1;
    }
  } catch {
    // Fall through to default
  }
  // Default: 3 playoff rounds
  return playoffWeekStart + 2;
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
  const playoffWeekStart = league?.settings?.playoff_week_start || (DEFAULT_REGULAR_SEASON_WEEKS + 1);
  const lastWeek = await getLastPlayoffWeek(leagueId, playoffWeekStart);
  const totalWeeks = lastWeek;

  const [fetched, draftPicksByRound] = await Promise.all([
    Promise.all(
      Array.from({ length: totalWeeks }, (_, i) => i + 1).map((w) =>
        SleeperService.getMatchups(leagueId, w)
      )
    ),
    fetchDraftPicksByRound(leagueId, season),
  ]);

  const allMatchups = new Map<number, SleeperMatchup[]>();
  fetched.forEach((m, i) => allMatchups.set(i + 1, m));

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
      evaluateSidePlayers(trade.sides[0], trade.week, totalWeeks, allMatchups, getAvg, draftPicksByRound),
      evaluateSidePlayers(trade.sides[1], trade.week, totalWeeks, allMatchups, getAvg, draftPicksByRound),
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
