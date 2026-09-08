/**
 * Fantasy point formatting.
 *
 * Sleeper reports scores to two decimals (137.54), and a matchup is genuinely decided at that
 * precision — a 0.04 margin is a real result, and rounding to one decimal can show two teams
 * tied when one of them won. So scores keep both decimals.
 *
 * Projections deliberately do not. They are estimates with a standard deviation of several
 * points; printing 12.47 implies a precision the model does not have, and reading a column of
 * them is harder for no benefit.
 */

/** A realized score. Always two decimals, so columns align and no result is hidden. */
export function formatScore(points: number): string {
  return points.toFixed(2);
}

/** A signed score difference, e.g. a margin. Two decimals, with an explicit sign. */
export function formatScoreDelta(points: number): string {
  return `${points > 0 ? '+' : ''}${points.toFixed(2)}`;
}

/** A projection. One decimal — the extra digit would be false precision. */
export function formatProjection(points: number): string {
  return points.toFixed(1);
}
