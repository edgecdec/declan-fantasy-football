/**
 * Election-forecast style ratings for a matchup, from Solid You through Toss-up to Solid Them.
 *
 * A raw 57% is hard to feel. "Lean you" is not, and it is the same information — which is
 * exactly why Cook and 538 publish ratings alongside numbers rather than instead of them.
 *
 * The thresholds are not invented. They were checked against 650 predictions drawn from both
 * sides of 325 real completed matchups in this league (2021-2025), priced at kickoff by the
 * same model the page uses:
 *
 *   bucket         n    mean predicted   actually won    gap
 *   Solid you      12        78.2%           83.3%      +5.2
 *   Likely you    116        65.9%           67.2%      +1.3
 *   Lean you       92        57.8%           65.2%      +7.4
 *   Toss-up       210        50.0%           50.0%       0.0
 *
 * Two alternatives were rejected on that evidence rather than on taste. Cook's wider bands
 * (lean 55, likely 65, solid 80) put just 3 of 650 predictions in Solid — a rating that
 * essentially never fires is dead weight. A wider scheme still (60/70/85) never reached Solid
 * at all and swept 394 of 650 into Toss-up, which stops being a distinction.
 *
 * Note the favoured bands run slightly HOTTER than predicted — Lean you won 65% against a
 * 58% prediction. That direction matches the model's known mild under-confidence in the
 * 50-60% band, so the labels are, if anything, conservative.
 */

export type WinRatingKey =
  | 'solid_you' | 'likely_you' | 'lean_you'
  | 'tossup'
  | 'lean_them' | 'likely_them' | 'solid_them';

export type WinRating = {
  key: WinRatingKey;
  label: string;
  /** Which side it favours; null at a toss-up. */
  favours: 'you' | 'them' | null;
  /**
   * How far out on the scale, 0 at a toss-up to 3 at solid. Drives the visual intensity, so
   * the ramp is built from one validated colour per side rather than seven bespoke hexes.
   */
  step: 0 | 1 | 2 | 3;
  /** Position on the 7-slot scale, left (solid you) to right (solid them). */
  index: number;
};

/**
 * Lower bound of each favoured band, as a win probability. Mirrored for the other side.
 *
 * Expressed this way because it is how the bands are discussed, but the rating is computed
 * from distance to a coin flip instead — see EDGE_BANDS.
 */
export const RATING_THRESHOLDS = {
  lean: 0.55,
  likely: 0.60,
  solid: 0.75,
} as const;

/**
 * The same bands as distance from 0.5, which is what the rating actually uses.
 *
 * Deriving the rating from |p - 0.5| removes the obvious asymmetry: comparing p against
 * 0.55/0.60/0.75 on one side and 0.45/0.40/0.25 on the other looks symmetric and is not,
 * because `1 - 0.55` is 0.44999999999999996 in floating point.
 *
 * That alone is still not enough, which is worth writing down because it is not obvious.
 * `|p - 0.5|` and `|(1 - p) - 0.5|` are equal in real arithmetic but not always in floating
 * point: for p = 0.25000000000000006, `1 - p` rounds to exactly 0.75, so the two edges come
 * out as 0.24999999999999994 and 0.25 and land in different bands. The same matchup would
 * then be rated "Likely them" by one manager and "Solid you" by their opponent.
 *
 * So the edge is quantised before it is banded. 1e-9 is nine orders of magnitude finer than
 * any probability this model produces, so it cannot change a real rating — it exists purely
 * to make the mirror exact.
 */
/** Fine enough to be invisible, coarse enough to make mirrored inputs agree exactly. */
const EDGE_QUANTUM = 1e-9;

const quantise = (n: number): number => Math.round(n / EDGE_QUANTUM) * EDGE_QUANTUM;

// The band edges are quantised too, not just the value being tested. `0.55 - 0.5` is
// 0.05000000000000004, so comparing a quantised 0.05 against it put a matchup at exactly the
// lean threshold back into Toss-up.
const EDGE_BANDS = {
  lean: quantise(RATING_THRESHOLDS.lean - 0.5),
  likely: quantise(RATING_THRESHOLDS.likely - 0.5),
  solid: quantise(RATING_THRESHOLDS.solid - 0.5),
} as const;

const RATINGS: Record<WinRatingKey, Omit<WinRating, 'key'>> = {
  solid_you: { label: 'Solid you', favours: 'you', step: 3, index: 0 },
  likely_you: { label: 'Likely you', favours: 'you', step: 2, index: 1 },
  lean_you: { label: 'Lean you', favours: 'you', step: 1, index: 2 },
  tossup: { label: 'Toss-up', favours: null, step: 0, index: 3 },
  lean_them: { label: 'Lean them', favours: 'them', step: 1, index: 4 },
  likely_them: { label: 'Likely them', favours: 'them', step: 2, index: 5 },
  solid_them: { label: 'Solid them', favours: 'them', step: 3, index: 6 },
};

/** Every rating, left to right, for drawing the scale. */
export const RATING_SCALE: WinRating[] = (
  ['solid_you', 'likely_you', 'lean_you', 'tossup', 'lean_them', 'likely_them', 'solid_them'] as WinRatingKey[]
).map(key => ({ key, ...RATINGS[key] }));

/**
 * Rates a matchup from the probability that YOU win it.
 *
 * Symmetric by construction: rate(p) and rate(1-p) are mirror images, so the rating never
 * depends on which side of a matchup you happen to be looking from.
 */
export function rateWinProbability(probabilityYouWin: number): WinRating {
  const p = Math.min(1, Math.max(0, probabilityYouWin));
  const edge = quantise(Math.abs(p - 0.5));

  if (edge < EDGE_BANDS.lean) return { key: 'tossup', ...RATINGS.tossup };

  const favoursYou = p > 0.5;
  let key: WinRatingKey;
  if (edge < EDGE_BANDS.likely) key = favoursYou ? 'lean_you' : 'lean_them';
  else if (edge < EDGE_BANDS.solid) key = favoursYou ? 'likely_you' : 'likely_them';
  else key = favoursYou ? 'solid_you' : 'solid_them';

  return { key, ...RATINGS[key] };
}
