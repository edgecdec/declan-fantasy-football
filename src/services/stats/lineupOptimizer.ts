import { SleeperService, SleeperProjection, SleeperLeague } from '@/services/sleeper/sleeperService';
import {
  OptimalLineupResult, LineupSlot, LineupMistake,
  WeeklyDecision, PositionAccuracy, SeasonDecisionSummary,
} from '@/types/lineup';
import playerData from '../../../data/sleeper_players.json';

type PlayerRecord = { first_name: string; last_name: string; position: string };
const players = (playerData as unknown as { players: Record<string, PlayerRecord> }).players ?? {};

/** Non-bench slot types to fill */
const BENCH_SLOTS = new Set(['BN', 'IR', 'TAXI']);

/** Position eligibility per roster slot */
const SLOT_ELIGIBILITY: Record<string, string[]> = {
  QB: ['QB'],
  RB: ['RB'],
  WR: ['WR'],
  TE: ['TE'],
  K: ['K'],
  DEF: ['DEF'],
  FLEX: ['RB', 'WR', 'TE'],
  REC_FLEX: ['WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  IDP_FLEX: ['DL', 'LB', 'DB'],
  DL: ['DL'],
  LB: ['LB'],
  DB: ['DB'],
};

/** Fill most-restrictive slots first to avoid wasting elite players on flex */
const SLOT_PRIORITY: string[] = [
  'K', 'DEF', 'QB', 'TE', 'RB', 'WR',
  'DL', 'LB', 'DB',
  'REC_FLEX', 'FLEX', 'SUPER_FLEX', 'IDP_FLEX',
];

function getPlayerPosition(playerId: string): string {
  return players[playerId]?.position || 'UNKNOWN';
}

function getPlayerName(playerId: string): string {
  const p = players[playerId];
  return p ? `${p.first_name} ${p.last_name}` : playerId;
}

/** Calculate projected points for a single player using league scoring */
export function calculateProjectedPoints(
  projection: SleeperProjection | undefined,
  scoringSettings: Record<string, number>,
): number {
  if (!projection) return 0;
  let total = 0;
  for (const stat in scoringSettings) {
    if (stat in projection) total += projection[stat] * scoringSettings[stat];
  }
  return total;
}

type PlayerCandidate = { playerId: string; position: string; projectedPoints: number };

/**
 * Greedy optimal lineup solver.
 * Fills most-restrictive single-position slots first, then flex slots,
 * always picking the highest-projected eligible player remaining.
 */
function solveLineup(pool: PlayerCandidate[], rosterPositions: string[]): LineupSlot[] {
  // Count starting slots grouped by type, ordered by priority
  const slotCounts = new Map<string, number>();
  for (const slot of rosterPositions) {
    if (BENCH_SLOTS.has(slot)) continue;
    slotCounts.set(slot, (slotCounts.get(slot) || 0) + 1);
  }

  const orderedSlots: Array<{ name: string; count: number }> = [];
  for (const name of SLOT_PRIORITY) {
    const count = slotCounts.get(name);
    if (count) { orderedSlots.push({ name, count }); slotCounts.delete(name); }
  }
  // Any remaining unknown slot types
  for (const [name, count] of slotCounts) orderedSlots.push({ name, count });

  // Sort pool descending by projected points
  const available = [...pool].sort((a, b) => b.projectedPoints - a.projectedPoints);
  const used = new Set<string>();
  const lineup: LineupSlot[] = [];

  for (const { name, count } of orderedSlots) {
    const eligible = SLOT_ELIGIBILITY[name] || [name];
    for (let i = 0; i < count; i++) {
      const best = available.find(p => !used.has(p.playerId) && eligible.includes(p.position));
      if (best) {
        used.add(best.playerId);
        lineup.push({
          slot: name,
          playerId: best.playerId,
          playerName: getPlayerName(best.playerId),
          position: best.position,
          projectedPoints: best.projectedPoints,
        });
      }
    }
  }
  return lineup;
}

/**
 * Calculate optimal lineup and compare to actual.
 */
export function calculateOptimalLineup(
  rosterPlayerIds: string[],
  rosterPositions: string[],
  projections: Record<string, SleeperProjection>,
  scoringSettings: Record<string, number>,
  actualStarters: string[],
  playersPoints?: Record<string, number>,
): OptimalLineupResult {
  // Build candidate pool
  const pool: PlayerCandidate[] = rosterPlayerIds
    .filter(id => id && id !== '0')
    .map(id => ({
      playerId: id,
      position: getPlayerPosition(id),
      projectedPoints: calculateProjectedPoints(projections[id], scoringSettings),
    }));

  const optimalLineup = solveLineup(pool, rosterPositions);
  for (const slot of optimalLineup) slot.actualPoints = playersPoints?.[slot.playerId];

  // Build actual lineup from starters array (each index maps to same-index starter slot)
  const starterSlots = rosterPositions.filter(s => !BENCH_SLOTS.has(s));
  const actualLineup: LineupSlot[] = actualStarters
    .slice(0, starterSlots.length)
    .map((playerId, i) => ({
      slot: starterSlots[i],
      playerId,
      playerName: getPlayerName(playerId),
      position: getPlayerPosition(playerId),
      projectedPoints: calculateProjectedPoints(projections[playerId], scoringSettings),
      actualPoints: playersPoints?.[playerId],
    }));

  // Projected points left on bench
  const optProj = optimalLineup.reduce((s, p) => s + p.projectedPoints, 0);
  const actProj = actualLineup.reduce((s, p) => s + p.projectedPoints, 0);
  const pointsLeftOnBench = optProj - actProj;

  // Actual points left on bench
  const optActual = optimalLineup.reduce((s, p) => s + (p.actualPoints ?? 0), 0);
  const actActual = actualLineup.reduce((s, p) => s + (p.actualPoints ?? 0), 0);
  const actualPointsLeftOnBench = optActual - actActual;

  // Find mistakes: slots where actual differs from optimal
  const actualSet = new Set(actualStarters);
  const optimalSet = new Set(optimalLineup.map(s => s.playerId));
  const mistakes: LineupMistake[] = [];

  for (const optSlot of optimalLineup) {
    if (actualSet.has(optSlot.playerId)) continue;
    const actualInSlot = actualLineup.find(
      a => a.slot === optSlot.slot && !optimalSet.has(a.playerId),
    );
    if (actualInSlot) {
      const startedActual = playersPoints?.[actualInSlot.playerId];
      const optimalActual = playersPoints?.[optSlot.playerId];
      mistakes.push({
        slot: optSlot.slot,
        started: {
          playerId: actualInSlot.playerId,
          playerName: actualInSlot.playerName,
          position: actualInSlot.position,
          projectedPoints: actualInSlot.projectedPoints,
          actualPoints: startedActual,
        },
        shouldHaveStarted: {
          playerId: optSlot.playerId,
          playerName: optSlot.playerName,
          position: optSlot.position,
          projectedPoints: optSlot.projectedPoints,
          actualPoints: optimalActual,
        },
        pointsDiff: optSlot.projectedPoints - actualInSlot.projectedPoints,
        actualDiff: startedActual != null && optimalActual != null
          ? startedActual - optimalActual : undefined,
      });
    }
  }

  mistakes.sort((a, b) => (a.actualDiff ?? 0) - (b.actualDiff ?? 0));

  return { optimalLineup, actualLineup, pointsLeftOnBench, actualPointsLeftOnBench, mistakes };
}

const DEFAULT_REGULAR_SEASON_WEEKS = 14;

/** Compute skill efficiency metrics from weekly decision data */
function computeSkillMetrics(weekly: WeeklyDecision[]) {
  let totalActualStarted = 0;
  let totalActualOptimal = 0;
  let optimalWeeks = 0;
  let netSkillPlusMinus = 0;

  for (const w of weekly) {
    const actPts = w.optimal.actualLineup.reduce((s, p) => s + (p.actualPoints ?? 0), 0);
    const optPts = w.optimal.optimalLineup.reduce((s, p) => s + (p.actualPoints ?? 0), 0);
    totalActualStarted += actPts;
    totalActualOptimal += optPts;
    const weekSkill = actPts - optPts;
    netSkillPlusMinus += weekSkill;
    if (weekSkill >= 0) optimalWeeks++;
  }

  const skillEfficiency = totalActualOptimal > 0
    ? (totalActualStarted / totalActualOptimal) * 100 : 100;
  const netSkillPerWeek = weekly.length > 0 ? netSkillPlusMinus / weekly.length : 0;

  return { skillEfficiency, netSkillPlusMinus, netSkillPerWeek, optimalWeeks, totalActualStarted, totalActualOptimal };
}

/** Analyze one user across all regular-season weeks in one league */
export async function analyzeStartSitDecisions(
  leagueId: string,
  userId: string,
  season: string,
  onWeekComplete?: (week: number, total: number) => void,
): Promise<SeasonDecisionSummary | null> {
  const league = await SleeperService.getLeague(leagueId);
  if (!league) return null;

  const rosters = await SleeperService.getRosters(leagueId);
  const userRoster = rosters.find(r => r.owner_id === userId);
  if (!userRoster) return null;

  const leagueAny = league as SleeperLeague & {
    roster_positions?: string[];
    scoring_settings?: Record<string, number>;
  };
  const rosterPositions = leagueAny.roster_positions;
  const scoringSettings = leagueAny.scoring_settings;
  if (!rosterPositions || !scoringSettings) return null;

  const totalWeeks = league.settings.playoff_week_start
    ? league.settings.playoff_week_start - 1
    : DEFAULT_REGULAR_SEASON_WEEKS;

  const weekly: WeeklyDecision[] = [];
  const allMistakes: LineupMistake[] = [];
  let optimalWeeks = 0;
  const posMistakes = new Map<string, number>();

  for (let week = 1; week <= totalWeeks; week++) {
    const [matchups, projections] = await Promise.all([
      SleeperService.getMatchups(leagueId, week),
      SleeperService.getWeeklyProjections(season, week),
    ]);

    const um = matchups.find(m => m.roster_id === userRoster.roster_id);
    if (!um?.starters?.length || !um?.players?.length) {
      onWeekComplete?.(week, totalWeeks);
      continue;
    }

    const result = calculateOptimalLineup(
      um.players, rosterPositions, projections, scoringSettings, um.starters, um.players_points,
    );

    const isOptimal = result.mistakes.length === 0;
    if (isOptimal) optimalWeeks++;

    weekly.push({ week, leagueId, leagueName: league.name, optimal: result, isOptimal });
    allMistakes.push(...result.mistakes);
    for (const m of result.mistakes) posMistakes.set(m.slot, (posMistakes.get(m.slot) || 0) + 1);

    onWeekComplete?.(week, totalWeeks);
  }

  if (weekly.length === 0) return null;

  const totalPtsLeft = weekly.reduce((s, w) => s + w.optimal.pointsLeftOnBench, 0);
  const totalActualPtsLeft = weekly.reduce((s, w) => s + w.optimal.actualPointsLeftOnBench, 0);
  const accuracy = (optimalWeeks / weekly.length) * 100;

  const starterSlots = rosterPositions.filter(s => !BENCH_SLOTS.has(s));
  const slotTotals = new Map<string, number>();
  for (const slot of starterSlots) slotTotals.set(slot, (slotTotals.get(slot) || 0) + weekly.length);

  const positionAccuracy: PositionAccuracy[] = Array.from(slotTotals.entries())
    .map(([position, total]) => {
      const mistakes = posMistakes.get(position) || 0;
      return { position, correct: total - mistakes, total, accuracy: total > 0 ? ((total - mistakes) / total) * 100 : 100 };
    })
    .sort((a, b) => a.accuracy - b.accuracy);

  allMistakes.sort((a, b) => (a.actualDiff ?? 0) - (b.actualDiff ?? 0));

  const skill = computeSkillMetrics(weekly);

  return {
    leagueId, leagueName: league.name, season,
    totalPointsLeftOnBench: totalPtsLeft,
    totalActualPointsLeftOnBench: totalActualPtsLeft,
    decisionAccuracy: accuracy,
    weeklyDecisions: weekly,
    positionAccuracy,
    worstMistakes: allMistakes,
    ...skill,
  };
}

/** Analyze all managers in a single league (shared matchup/projection fetches) */
export async function analyzeLeagueAllManagers(
  leagueId: string,
  season: string,
  onWeekComplete?: (week: number, total: number) => void,
): Promise<SeasonDecisionSummary[]> {
  const league = await SleeperService.getLeague(leagueId);
  if (!league) return [];

  const rosters = await SleeperService.getRosters(leagueId);
  const leagueAny = league as SleeperLeague & {
    roster_positions?: string[];
    scoring_settings?: Record<string, number>;
  };
  const rosterPositions = leagueAny.roster_positions;
  const scoringSettings = leagueAny.scoring_settings;
  if (!rosterPositions || !scoringSettings) return [];

  const totalWeeks = league.settings.playoff_week_start
    ? league.settings.playoff_week_start - 1
    : DEFAULT_REGULAR_SEASON_WEEKS;

  type MgrAccum = {
    ownerId: string;
    weekly: WeeklyDecision[];
    mistakes: LineupMistake[];
    optimalWeeks: number;
    posMistakes: Map<string, number>;
  };

  const mgrs = new Map<number, MgrAccum>();
  for (const r of rosters) {
    if (!r.owner_id) continue;
    mgrs.set(r.roster_id, {
      ownerId: r.owner_id, weekly: [], mistakes: [],
      optimalWeeks: 0, posMistakes: new Map(),
    });
  }

  for (let week = 1; week <= totalWeeks; week++) {
    const [matchups, projections] = await Promise.all([
      SleeperService.getMatchups(leagueId, week),
      SleeperService.getWeeklyProjections(season, week),
    ]);

    for (const matchup of matchups) {
      const mgr = mgrs.get(matchup.roster_id);
      if (!mgr || !matchup.starters?.length || !matchup.players?.length) continue;

      const result = calculateOptimalLineup(
        matchup.players, rosterPositions, projections, scoringSettings, matchup.starters, matchup.players_points,
      );
      const isOptimal = result.mistakes.length === 0;
      if (isOptimal) mgr.optimalWeeks++;
      mgr.weekly.push({ week, optimal: result, isOptimal });
      mgr.mistakes.push(...result.mistakes);
      for (const m of result.mistakes) mgr.posMistakes.set(m.slot, (mgr.posMistakes.get(m.slot) || 0) + 1);
    }

    onWeekComplete?.(week, totalWeeks);
  }

  const starterSlots = rosterPositions.filter(s => !BENCH_SLOTS.has(s));
  const results: SeasonDecisionSummary[] = [];

  for (const [, mgr] of mgrs) {
    if (mgr.weekly.length === 0) continue;
    const totalPtsLeft = mgr.weekly.reduce((s, w) => s + w.optimal.pointsLeftOnBench, 0);
    const totalActualPtsLeft = mgr.weekly.reduce((s, w) => s + w.optimal.actualPointsLeftOnBench, 0);
    const accuracy = (mgr.optimalWeeks / mgr.weekly.length) * 100;

    const slotTotals = new Map<string, number>();
    for (const slot of starterSlots) slotTotals.set(slot, (slotTotals.get(slot) || 0) + mgr.weekly.length);

    const positionAccuracy: PositionAccuracy[] = Array.from(slotTotals.entries())
      .map(([position, total]) => {
        const mistakes = mgr.posMistakes.get(position) || 0;
        return { position, correct: total - mistakes, total, accuracy: total > 0 ? ((total - mistakes) / total) * 100 : 100 };
      })
      .sort((a, b) => a.accuracy - b.accuracy);

    mgr.mistakes.sort((a, b) => (a.actualDiff ?? 0) - (b.actualDiff ?? 0));

    const skill = computeSkillMetrics(mgr.weekly);

    results.push({
      leagueId, leagueName: league.name, season,
      totalPointsLeftOnBench: totalPtsLeft,
      totalActualPointsLeftOnBench: totalActualPtsLeft,
      decisionAccuracy: accuracy,
      weeklyDecisions: mgr.weekly,
      positionAccuracy,
      worstMistakes: mgr.mistakes,
      userId: mgr.ownerId,
      ...skill,
    });
  }

  return results;
}

/** Aggregate across multiple leagues for one user in one season */
export async function analyzeMultiLeagueSeason(
  leagues: SleeperLeague[],
  userId: string,
  season: string,
  onLeagueComplete?: (completed: number, total: number) => void,
): Promise<SeasonDecisionSummary[]> {
  const results: SeasonDecisionSummary[] = [];
  for (let i = 0; i < leagues.length; i++) {
    const summary = await analyzeStartSitDecisions(leagues[i].league_id, userId, season);
    if (summary) results.push(summary);
    onLeagueComplete?.(i + 1, leagues.length);
  }
  return results;
}

/** Aggregate across all seasons of a single league chain */
export async function analyzeLeagueChainHistory(
  currentLeagueId: string,
  userId: string,
  onSeasonComplete?: (season: string, completed: number, total: number) => void,
): Promise<SeasonDecisionSummary[]> {
  const history = await SleeperService.getLeagueHistory(currentLeagueId);
  const results: SeasonDecisionSummary[] = [];
  for (let i = 0; i < history.length; i++) {
    const league = history[i];
    if (league.status !== 'complete' && league.status !== 'in_season') continue;
    const summary = await analyzeStartSitDecisions(league.league_id, userId, league.season);
    if (summary) results.push(summary);
    onSeasonComplete?.(league.season, i + 1, history.length);
  }
  return results;
}
