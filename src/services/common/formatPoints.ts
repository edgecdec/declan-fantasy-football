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

/**
 * A win probability, phrased so it never claims a certainty that has not happened.
 *
 * Two rules, both about honesty rather than formatting:
 *
 *  - while a ball can still be thrown, the shown value is held below 100% and above 0%. A live
 *    matchup at 99.96% used to round to a flat "100%", which is a claim the model cannot make while
 *    the opponent still has starters on the field.
 *  - once every game is final the result IS known, so 100% is exactly right and gets shown.
 *
 * The counterpart bug is worth recording: for a while this page read its probability off the BETTING
 * price, which is struck from a copy clamped to the quoting band, so every matchup flatlined at 95%.
 * Display and pricing want different numbers.
 */
export function formatWinProbability(probability: number, decided: boolean): string {
  const p = Math.min(1, Math.max(0, probability));
  if (decided) return `${Math.round(p) * 100}%`;

  const pct = p * 100;
  // Nudged inside the bounds rather than rounded to them, so "99%" means "at least 99" and never
  // means "certain".
  if (pct > 99) return '>99%';
  if (pct < 1) return '<1%';
  return `${pct.toFixed(0)}%`;
}
