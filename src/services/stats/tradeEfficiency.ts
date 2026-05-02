import { SleeperService, SleeperMatchup, SleeperDraftPick } from '@/services/sleeper/sleeperService';
import { CacheService } from '@/services/common/cacheService';
import { fetchLeagueTrades, TradeData } from '@/services/stats/tradeAnalyzer';
import {
  PlayerWeekEfficiency,
  TradeDraftPick,
  TradeEfficiencySide,
  TradeEfficiencyResult,
  LeagueTradeEfficiencyResult,
  SeasonTradeStats,
  HistoricalTradeData,
} from '@/types/trade';
import playerData from '../../../data/sleeper_players.json';

export type { PlayerWeekEfficiency, PlayerTradeEfficiency, TradeEfficiencySide, TradeEfficiencyResult, LeagueTradeEfficiencyResult, SeasonTradeStats, HistoricalTradeData } from '@/types/trade';

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
  draftPicksByRound: Map<string, SleeperDraftPick[]>,
  rosterIdToDraftSlot: Map<number, number>,
): TradeDraftPick {
  const key = `${dp.season}_${dp.round}`;
  const roundPicks = draftPicksByRound.get(key) || [];
  // Match by draft_slot (original slot owner) since draft picks data uses
  // roster_id = who MADE the pick (current owner), not the original slot owner.
  // The transaction's rosterId is the original slot owner.
  const draftSlot = rosterIdToDraftSlot.get(dp.rosterId);
  const match = draftSlot != null
    ? roundPicks.find((p) => p.draft_slot === draftSlot)
    : roundPicks.find((p) => p.roster_id === dp.rosterId); // fallback
  if (match) {
    const name = match.metadata
      ? `${match.metadata.first_name} ${match.metadata.last_name}`
      : getPlayerName(match.player_id);
    return {
      season: dp.season,
      round: dp.round,
      resolvedPick: `${match.round}.${String(match.draft_slot).padStart(2, '0')}`,
      resolvedPlayer: name,
      resolvedPlayerId: match.player_id,
      resolvedPosition: getPlayerPosition(match.player_id) ?? undefined,
    };
  }
  return { season: dp.season, round: dp.round };
}

type PickTradeEntry = { transactionId: string; week: number; timestamp: number };
type PickTradeTimeline = Map<string, PickTradeEntry[]>;

function pickTimelineKey(season: string, round: number, rosterId: number): string {
  return `${season}_${round}_${rosterId}`;
}

function buildPickTradeTimeline(trades: TradeData[]): PickTradeTimeline {
  const timeline: PickTradeTimeline = new Map();
  for (const trade of trades) {
    for (const side of trade.sides) {
      for (const dp of side.draftPicks ?? []) {
        const key = pickTimelineKey(dp.season, dp.round, dp.rosterId);
        if (!timeline.has(key)) timeline.set(key, []);
        timeline.get(key)!.push({
          transactionId: trade.transactionId,
          week: trade.week,
          timestamp: trade.timestamp,
        });
      }
    }
  }
  // Sort each pick's trades chronologically
  for (const entries of timeline.values()) {
    entries.sort((a, b) => a.timestamp - b.timestamp);
  }
  return timeline;
}

function getRetradedWeek(
  timeline: PickTradeTimeline,
  dp: { season: string; round: number; rosterId: number },
  currentTransactionId: string,
): number | undefined {
  const key = pickTimelineKey(dp.season, dp.round, dp.rosterId);
  const entries = timeline.get(key);
  if (!entries || entries.length < 2) return undefined;
  const idx = entries.findIndex((e) => e.transactionId === currentTransactionId);
  if (idx === -1 || idx >= entries.length - 1) return undefined;
  return entries[idx + 1].week;
}

function calculateResolvedPickEfficiency(
  pick: TradeDraftPick,
  tradeWeek: number,
  endWeek: number,
  totalWeeks: number,
  allMatchups: Map<number, SleeperMatchup[]>,
  getAvg: (week: number, position: string) => number,
  receivingRosterId: number,
): TradeDraftPick {
  if (!pick.resolvedPlayerId || !pick.resolvedPosition) return pick;

  const weeklyBreakdown: PlayerWeekEfficiency[] = [];
  let totalSeasonEff = 0;
  let totalSeasonWeeks = 0;

  for (let w = tradeWeek + 1; w <= totalWeeks; w++) {
    const weekMatchups = allMatchups.get(w) || [];
    for (const m of weekMatchups) {
      if (!m.starters?.length) continue;
      const starterIdx = m.starters.indexOf(pick.resolvedPlayerId);
      if (starterIdx === -1) continue;
      const pts = (m as Record<string, unknown>).starters_points as number[] | undefined;
      const points = pts?.[starterIdx] ?? 0;
      const leagueAvg = getAvg(w, pick.resolvedPosition);
      const eff = points - leagueAvg;
      totalSeasonEff += eff;
      totalSeasonWeeks++;
      // Only count team-specific efficiency within the ownership window
      if (m.roster_id === receivingRosterId && w <= endWeek) {
        weeklyBreakdown.push({ week: w, points, leagueAvg, efficiency: eff });
      }
      break;
    }
  }

  const totalEff = weeklyBreakdown.reduce((s, wb) => s + wb.efficiency, 0);
  const lastStartedWeek = weeklyBreakdown.length > 0 ? weeklyBreakdown[weeklyBreakdown.length - 1].week : null;
  const departureWeek = lastStartedWeek != null && lastStartedWeek < endWeek ? lastStartedWeek + 1 : null;

  return {
    ...pick,
    efficiency: {
      playerId: pick.resolvedPlayerId,
      name: pick.resolvedPlayer || 'Unknown',
      position: pick.resolvedPosition,
      weeksStarted: weeklyBreakdown.length,
      totalEfficiency: totalEff,
      avgEfficiency: weeklyBreakdown.length > 0 ? totalEff / weeklyBreakdown.length : 0,
      totalSeasonEfficiency: totalSeasonEff,
      totalSeasonWeeksStarted: totalSeasonWeeks,
      weeklyBreakdown,
      departureWeek,
    },
  };
}

function evaluateSidePlayers(
  side: TradeData['sides'][0],
  tradeWeek: number,
  totalWeeks: number,
  allMatchups: Map<number, SleeperMatchup[]>,
  getAvg: (week: number, position: string) => number,
  draftPicksByRound: Map<string, SleeperDraftPick[]>,
  rosterIdToDraftSlot: Map<number, number>,
  pickTimeline: PickTradeTimeline,
  transactionId: string,
): TradeEfficiencySide {
  const resolvedPicks = (side.draftPicks ?? []).map((dp) => {
    const resolved = resolveDraftPick(dp, draftPicksByRound, rosterIdToDraftSlot);
    const retradedWeek = getRetradedWeek(pickTimeline, dp, transactionId);
    const endWeek = retradedWeek != null ? retradedWeek : totalWeeks;
    const withEff = calculateResolvedPickEfficiency(resolved, tradeWeek, endWeek, totalWeeks, allMatchups, getAvg, side.rosterId);
    if (retradedWeek != null) withEff.retradedWeek = retradedWeek;
    return withEff;
  });

  const result: TradeEfficiencySide = {
    rosterId: side.rosterId,
    ownerId: side.ownerId,
    username: side.username,
    players: [],
    draftPicks: resolvedPicks,
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

  // Add resolved draft pick efficiency to side total
  for (const dp of resolvedPicks) {
    if (dp.efficiency) {
      result.totalEfficiency += dp.efficiency.totalSeasonEfficiency;
    }
  }

  return result;
}

type DraftPicksResult = {
  picksByRound: Map<string, SleeperDraftPick[]>;
  rosterIdToDraftSlot: Map<number, number>;
};

async function fetchDraftPicksByRound(
  leagueId: string,
  season: string
): Promise<DraftPicksResult> {
  const picksByRound = new Map<string, SleeperDraftPick[]>();
  const rosterIdToDraftSlot = new Map<number, number>();
  try {
    const drafts = await SleeperService.getLeagueDrafts(leagueId);
    const seasonDraft = drafts.find((d) => d.season === season && d.status === 'complete');
    if (!seasonDraft) return { picksByRound, rosterIdToDraftSlot };
    // getLeagueDrafts doesn't include slot_to_roster_id — fetch full draft details
    const fullDraft = await SleeperService.getDraft(seasonDraft.draft_id);
    const slotMap = fullDraft?.slot_to_roster_id ?? seasonDraft.slot_to_roster_id;
    if (slotMap) {
      for (const [slot, rosterId] of Object.entries(slotMap)) {
        rosterIdToDraftSlot.set(rosterId, Number(slot));
      }
    }
    const picks = await SleeperService.getDraftPicks(seasonDraft.draft_id);
    for (const p of picks) {
      const key = `${season}_${p.round}`;
      if (!picksByRound.has(key)) picksByRound.set(key, []);
      picksByRound.get(key)!.push(p);
    }
  } catch {
    // Draft may not exist yet — return empty
  }
  return { picksByRound, rosterIdToDraftSlot };
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

  const [fetched, draftPicksResult] = await Promise.all([
    Promise.all(
      Array.from({ length: totalWeeks }, (_, i) => i + 1).map((w) =>
        SleeperService.getMatchups(leagueId, w)
      )
    ),
    fetchDraftPicksByRound(leagueId, season),
  ]);

  const { picksByRound: draftPicksByRound, rosterIdToDraftSlot } = draftPicksResult;

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

  const pickTimeline = buildPickTradeTimeline(tradeResult.trades);

  const trades: TradeEfficiencyResult[] = tradeResult.trades
    .filter((trade) => trade?.sides?.[0] && trade?.sides?.[1])
    .map((trade) => ({
      transactionId: trade.transactionId,
      week: trade.week,
      timestamp: trade.timestamp,
      sides: [
        evaluateSidePlayers(trade.sides[0], trade.week, totalWeeks, allMatchups, getAvg, draftPicksByRound, rosterIdToDraftSlot, pickTimeline, trade.transactionId),
        evaluateSidePlayers(trade.sides[1], trade.week, totalWeeks, allMatchups, getAvg, draftPicksByRound, rosterIdToDraftSlot, pickTimeline, trade.transactionId),
      ],
    }));

  const result: LeagueTradeEfficiencyResult = {
    leagueId: tradeResult.leagueId,
    leagueName: tradeResult.leagueName,
    season: tradeResult.season,
    trades,
    rosterToUsername: tradeResult.rosterToUsername,
    rosterToOwnerId: tradeResult.rosterToOwnerId,
  };

  CacheService.set(cacheKey, result, { storage: 'session' });
  return result;
}

const TRADE_WIN_THRESHOLD = 1;

function buildSeasonStats(
  seasonResult: LeagueTradeEfficiencyResult,
): SeasonTradeStats {
  const managerStats: SeasonTradeStats['managerStats'] = {};
  for (const trade of seasonResult.trades) {
    if (!trade?.sides?.[0] || !trade?.sides?.[1]) continue;
    for (let i = 0; i < 2; i++) {
      const mySide = trade.sides[i];
      const oppSide = trade.sides[1 - i];
      if (!mySide || !oppSide) continue;
      const margin = (mySide.totalEfficiency ?? 0) - (oppSide.totalEfficiency ?? 0);
      const key = mySide.ownerId || mySide.username;
      if (!key) continue;
      if (!managerStats[key]) {
        managerStats[key] = { totalMargin: 0, tradesWon: 0, tradesLost: 0, totalTrades: 0 };
      }
      const s = managerStats[key];
      s.totalTrades++;
      s.totalMargin += margin;
      if (margin > TRADE_WIN_THRESHOLD) s.tradesWon++;
      else if (margin < -TRADE_WIN_THRESHOLD) s.tradesLost++;
    }
  }
  return {
    season: seasonResult.season,
    leagueId: seasonResult.leagueId,
    leagueName: seasonResult.leagueName,
    tradeCount: seasonResult.trades.length,
    managerStats,
  };
}

export async function fetchHistoricalTradeEfficiency(
  leagueId: string,
  onProgress: (data: HistoricalTradeData) => void,
): Promise<HistoricalTradeData> {
  const cacheKey = `hist_trade_eff_${leagueId}`;
  const cached = CacheService.get<HistoricalTradeData>(cacheKey, 'session');
  if (cached) {
    onProgress(cached);
    return cached;
  }

  const leagueHistory = await SleeperService.getLeagueHistory(leagueId);
  const eligibleLeagues = leagueHistory.filter(
    (l) => l.status === 'complete' || l.status === 'in_season',
  );

  // Build ownerIdToUsername from the current (most recent) season's users
  const currentLeague = eligibleLeagues[0];
  const ownerIdToUsername: Record<string, string> = {};
  if (currentLeague) {
    const users = await SleeperService.getLeagueUsers(currentLeague.league_id);
    for (const u of users) {
      ownerIdToUsername[u.user_id] = u.display_name || u.username;
    }
  }

  const seasons: SeasonTradeStats[] = [];
  const allTrades: TradeEfficiencyResult[] = [];

  for (const league of eligibleLeagues) {
    try {
      const result = await evaluateTradeEfficiency(league.league_id, league.season);
      if (result.trades.length === 0) continue;

      // Backfill ownerIdToUsername from older seasons for managers not in current season
      const rtu = result.rosterToUsername ?? {};
      const rto = result.rosterToOwnerId ?? {};
      for (const [rosterId, username] of Object.entries(rtu)) {
        const ownerId = rto[Number(rosterId)];
        if (ownerId && !ownerIdToUsername[ownerId]) {
          ownerIdToUsername[ownerId] = username;
        }
      }

      seasons.push(buildSeasonStats(result));
      allTrades.push(...result.trades);

      onProgress({ seasons: [...seasons], allTrades: [...allTrades], ownerIdToUsername: { ...ownerIdToUsername } });
    } catch {
      // Skip seasons that fail
    }
  }

  const final: HistoricalTradeData = { seasons, allTrades, ownerIdToUsername };
  CacheService.set(cacheKey, final, { storage: 'session' });
  return final;
}
