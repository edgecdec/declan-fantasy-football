import { SleeperProjection } from '@/services/sleeper/sleeperService';
import { OptimalLineupResult, LineupSlot, LineupMistake } from '@/types/lineup';
import playerData from '../../../data/sleeper_players.json';

type PlayerRecord = { first_name: string; last_name: string; position: string };
const players = (playerData as unknown as { players: Record<string, PlayerRecord> }).players ?? {};

const VALID_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

/** Positions eligible for each roster slot */
const SLOT_ELIGIBILITY: Record<string, string[]> = {
  QB: ['QB'],
  RB: ['RB'],
  WR: ['WR'],
  TE: ['TE'],
  K: ['K'],
  DEF: ['DEF'],
  FLEX: ['RB', 'WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  REC_FLEX: ['WR', 'TE'],
  IDP_FLEX: ['DL', 'LB', 'DB'],
};

/** Slots ordered most-restrictive first for greedy assignment */
const SLOT_PRIORITY: string[] = ['K', 'DEF', 'QB', 'TE', 'RB', 'WR', 'REC_FLEX', 'FLEX', 'SUPER_FLEX', 'IDP_FLEX'];

function getPlayerPosition(playerId: string): string {
  return players[playerId]?.position || 'UNKNOWN';
}

function getPlayerName(playerId: string): string {
  const p = players[playerId];
  return p ? `${p.first_name} ${p.last_name}` : playerId;
}

/** Calculate projected points for a player using league scoring settings */
export function calculateProjectedPoints(
  projection: SleeperProjection | undefined,
  scoringSettings: Record<string, number>
): number {
  if (!projection) return 0;
  let total = 0;
  for (const stat in scoringSettings) {
    if (stat in projection) {
      total += projection[stat] * scoringSettings[stat];
    }
  }
  return total;
}

/**
 * Solve optimal lineup from a pool of players into roster slots.
 * Uses greedy approach filling most-restrictive slots first.
 */
function solveLineup(
  playerPool: Array<{ playerId: string; position: string; projectedPoints: number }>,
  rosterPositions: string[]
): LineupSlot[] {
  // Group slots by type, ordered by priority
  const slotsByType: Array<{ slotName: string; count: number }> = [];
  const slotCounts = new Map<string, number>();
  for (const slot of rosterPositions) {
    if (slot === 'BN') continue; // skip bench
    slotCounts.set(slot, (slotCounts.get(slot) || 0) + 1);
  }

  for (const slotName of SLOT_PRIORITY) {
    const count = slotCounts.get(slotName);
    if (count) slotsByType.push({ slotName, count });
    slotCounts.delete(slotName);
  }
  // Handle any remaining slot types not in SLOT_PRIORITY
  for (const [slotName, count] of slotCounts) {
    slotsByType.push({ slotName, count });
  }

  // Sort player pool by projected points descending
  const available = [...playerPool].sort((a, b) => b.projectedPoints - a.projectedPoints);
  const used = new Set<string>();
  const lineup: LineupSlot[] = [];

  for (const { slotName, count } of slotsByType) {
    const eligible = SLOT_ELIGIBILITY[slotName] || [slotName];
    for (let i = 0; i < count; i++) {
      const best = available.find(p => !used.has(p.playerId) && eligible.includes(p.position));
      if (best) {
        used.add(best.playerId);
        lineup.push({
          slot: slotName,
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
 * Calculate optimal lineup and compare to actual lineup.
 *
 * @param rosterPlayerIds All player IDs on the roster (starters + bench from matchup)
 * @param rosterPositions League roster_positions array (e.g. ['QB','RB','RB','WR','WR','TE','FLEX','K','DEF','BN',...])
 * @param projections Map of player_id -> stat projections for this week
 * @param scoringSettings League scoring_settings (stat key -> point value)
 * @param actualStarters The starters array from the matchup (ordered by roster slot)
 */
export function calculateOptimalLineup(
  rosterPlayerIds: string[],
  rosterPositions: string[],
  projections: Record<string, SleeperProjection>,
  scoringSettings: Record<string, number>,
  actualStarters: string[]
): OptimalLineupResult {
  // Build player pool with projected points
  const playerPool = rosterPlayerIds
    .filter(id => id && id !== '0')
    .map(id => ({
      playerId: id,
      position: getPlayerPosition(id),
      projectedPoints: calculateProjectedPoints(projections[id], scoringSettings),
    }))
    .filter(p => VALID_POSITIONS.includes(p.position));

  // Solve optimal lineup
  const optimalLineup = solveLineup(playerPool, rosterPositions);

  // Build actual lineup from starters
  const starterSlots = rosterPositions.filter(s => s !== 'BN');
  const actualLineup: LineupSlot[] = actualStarters
    .slice(0, starterSlots.length)
    .map((playerId, i) => ({
      slot: starterSlots[i],
      playerId,
      playerName: getPlayerName(playerId),
      position: getPlayerPosition(playerId),
      projectedPoints: calculateProjectedPoints(projections[playerId], scoringSettings),
    }));

  // Calculate points left on bench
  const optimalTotal = optimalLineup.reduce((s, p) => s + p.projectedPoints, 0);
  const actualTotal = actualLineup.reduce((s, p) => s + p.projectedPoints, 0);
  const pointsLeftOnBench = optimalTotal - actualTotal;

  // Find mistakes: players in optimal but not in actual starters
  const actualStarterSet = new Set(actualStarters);
  const optimalStarterSet = new Set(optimalLineup.map(s => s.playerId));
  const mistakes: LineupMistake[] = [];

  for (const optSlot of optimalLineup) {
    if (actualStarterSet.has(optSlot.playerId)) continue;
    // Find the actual starter in this slot type who was suboptimal
    const actualInSlot = actualLineup.find(
      a => a.slot === optSlot.slot && !optimalStarterSet.has(a.playerId)
    );
    if (actualInSlot) {
      mistakes.push({
        slot: optSlot.slot,
        started: {
          playerId: actualInSlot.playerId,
          playerName: actualInSlot.playerName,
          position: actualInSlot.position,
          projectedPoints: actualInSlot.projectedPoints,
        },
        shouldHaveStarted: {
          playerId: optSlot.playerId,
          playerName: optSlot.playerName,
          position: optSlot.position,
          projectedPoints: optSlot.projectedPoints,
        },
        pointsDiff: optSlot.projectedPoints - actualInSlot.projectedPoints,
      });
    }
  }

  mistakes.sort((a, b) => b.pointsDiff - a.pointsDiff);

  return { optimalLineup, actualLineup, pointsLeftOnBench, mistakes };
}
