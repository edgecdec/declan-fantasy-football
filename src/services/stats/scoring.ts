import { SleeperProjection } from '@/services/sleeper/sleeperService';

/**
 * Converts a raw Sleeper stat projection into fantasy points under a league's own
 * scoring settings.
 *
 * Sleeper's projections are raw stat lines (pass_yd, rec, sack, def_pr_yd...), not
 * points. Its precomputed `pts_ppr` field is a generic PPR score and is NOT what a
 * custom league scores — see the note in liveOdds for how far apart they can be.
 *
 * Lives here rather than in lineupOptimizer so server-side code can use it without
 * pulling in that module's 22 MB player-database import.
 */
export function calculateProjectedPoints(
  projection: SleeperProjection | undefined,
  scoringSettings: Record<string, number>,
): number {
  if (!projection) return 0;
  let total = 0;
  for (const [stat, value] of Object.entries(projection)) {
    const multiplier = scoringSettings[stat];
    if (multiplier != null && typeof value === 'number') total += value * multiplier;
  }
  return total;
}
