import { SleeperProjection } from '@/services/sleeper/sleeperService';
import { isDefenceRow, normalizeDefenceProjection } from '@/services/stats/defenceProjection';

/**
 * Converts a raw Sleeper stat projection into fantasy points under a league's own
 * scoring settings.
 *
 * Sleeper's projections are raw stat lines (pass_yd, rec, sack, def_pr_yd...), not
 * points. Its precomputed `pts_ppr` field is a generic PPR score and is NOT what a
 * custom league scores — see the note in liveOdds for how far apart they can be.
 *
 * Team-defence rows are repaired first (`normalizeDefenceProjection`): Sleeper's DEF
 * `def_pr_yd` double-counts kick-return yards, and the row carries offence-only keys. This is
 * the single choke point every page scores projections through, so no page can see the
 * phantom points. The pricing paths go further — see services/betting/defenceModel.ts.
 *
 * Lives here rather than in lineupOptimizer so server-side code can use it without
 * pulling in that module's 22 MB player-database import.
 */
export function calculateProjectedPoints(
  projection: SleeperProjection | undefined,
  scoringSettings: Record<string, number>,
): number {
  if (!projection) return 0;
  return scoreStatLine(isDefenceRow(projection) ? normalizeDefenceProjection(projection) : projection, scoringSettings);
}

/** Every key times its league multiplier. No repair: callers pass a line that is already right. */
export function scoreStatLine(
  stats: Record<string, number>,
  scoringSettings: Record<string, number>,
): number {
  let total = 0;
  for (const [stat, value] of Object.entries(stats)) {
    const multiplier = scoringSettings[stat];
    if (multiplier != null && typeof value === 'number') total += value * multiplier;
  }
  return total;
}
