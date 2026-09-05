/**
 * Live win probability and pricing for a head-to-head fantasy matchup.
 *
 * Pure math, no data fetching and no heavy imports, so it can run on either
 * side of the wire and be tested directly.
 */

/**
 * Per-player projection error, fitted from **68,011 player-weeks across 2019-2025**.
 *
 * Critically, everything here is measured in **this league's own scoring**, not
 * Sleeper's generic `pts_ppr` field. Those are materially different numbers:
 * Graham's league is half-PPR, charges -2 per interception rather than -1, and
 * penalises `fum` and `fum_lost` separately. Dak Prescott's week-1 2026 line is
 * 21.11 as `pts_ppr` and 17.83 under these settings. An earlier fit used
 * `pts_ppr` and produced coefficients on the wrong scale — for quarterbacks it
 * overstated the bias by more than double (-2.99 vs the true -1.26).
 *
 * Projections are converted with calculateProjectedPoints(raw, scoringSettings),
 * so the model and the pricing agree on units.
 */

/** Fallback when a player's position is unknown. */
const RESID_SD_INTERCEPT = 3.419;
const RESID_SD_SLOPE = 0.2614;

/**
 * sd never drops below this. The kicker fit has a slightly negative slope
 * (higher-projected kickers are marginally steadier), which extrapolates to a
 * nonsensical negative sd at extreme projections; a floor keeps the variance
 * physical without distorting the fitted range.
 */
const MIN_RESID_SD = 1.5;

/**
 * Per-position sd = intercept + slope * projection, in league scoring.
 *
 * Kickers are much steadier than the flat model implies (~4.4 at a 12-point
 * projection, and essentially flat in projection). Tight ends swing hardest per
 * projected point. Defences are steadier than the pts_ppr fit suggested — that
 * earlier 7.97 was largely a scoring artifact, since this league scores DEF very
 * differently from Sleeper's default.
 */
const POSITION_SD: Record<string, { intercept: number; slope: number }> = {
  QB: { intercept: 4.402, slope: 0.1875 },
  RB: { intercept: 3.253, slope: 0.3573 },
  WR: { intercept: 3.521, slope: 0.3109 },
  TE: { intercept: 2.481, slope: 0.4167 },
  K: { intercept: 5.529, slope: -0.0928 },
  DEF: { intercept: 4.142, slope: 0.1678 },
};

/**
 * Mean projection bias by position, in league scoring (actual minus projected).
 *
 * Kickers are under-projected by about a point; defences over-projected by about
 * one and a half. Quarterbacks run -1.26, not the -2.99 a pts_ppr fit claimed.
 *
 * Means are used rather than medians on purpose: the mean is the unbiased
 * estimator of expected points, which is what a score projection needs. Note the
 * two diverge (RB mean +0.82 vs median -0.28), because weekly fantasy scoring is
 * right-skewed — most players slightly underperform and a few explode. That skew
 * is also why the normal approximation in winProbability is weakest when only one
 * or two players remain.
 *
 * Mostly cancels between two sides fielding the same slots — only 36% of
 * historical matchups had identical position mixes, and the residual asymmetry is
 * small — but it is free and it matters for lineups that genuinely differ.
 */
const POSITION_BIAS: Record<string, number> = {
  QB: -1.26,
  RB: 0.82,
  WR: 0.36,
  TE: 0.24,
  K: 1.18,
  DEF: -1.37,
};

/** Regulation minutes in an NFL game, used to scale remaining upside. */
export const REGULATION_MINUTES = 60;

/**
 * Overround applied across both sides. 4.76% is the level at which a true coin
 * flip prices at the sportsbook-standard -110 / -110.
 */
export const HOUSE_VIG = 0.0476;

/** Markets close once this little game time remains across the whole matchup. */
export const MARKET_CLOSE_MINUTES = 30;

export type PlayerGameState = 'pre' | 'in' | 'post' | 'unknown';

/** One starter's contribution to a side's score. */
export type StarterInput = {
  playerId: string;
  /** QB/RB/WR/TE/K/DEF. Selects the variance and bias model; unknown falls back. */
  position?: string | null;
  /** Points already banked this week. */
  actualPoints: number;
  /** Full-week projected points under this league's scoring. */
  projectedPoints: number;
  gameState: PlayerGameState;
  /** Regulation minutes left in this player's game (0 when final, 60 pre-kick). */
  remainingMinutes: number;
  /**
   * Extra sd on top of the position model, added in quadrature. Used where the
   * player himself is uncertain — a streamed slot is an averaged tier, so the
   * spread across that tier is real uncertainty the position model can't see.
   */
  extraSd?: number;
};

export type SideDistribution = {
  /** Expected final score. */
  mean: number;
  variance: number;
  /** Points already scored. */
  banked: number;
  /** Expected points still to come. */
  remaining: number;
};

/** Per-player residual sd at a given projection, by position where known. */
export function projectionSd(projectedPoints: number, position?: string | null): number {
  const proj = Math.max(0, projectedPoints);
  const fit = position ? POSITION_SD[position] : undefined;
  const sd = fit
    ? fit.intercept + fit.slope * proj
    : RESID_SD_INTERCEPT + RESID_SD_SLOPE * proj;
  return Math.max(MIN_RESID_SD, sd);
}

/** Bias-corrected expected points for a player, by position where known. */
export function adjustedProjection(projectedPoints: number, position?: string | null): number {
  const bias = position ? POSITION_BIAS[position] : undefined;
  // Never push an expectation below zero — a player cannot be a net negative in
  // most scoring, and the bias is a population mean, not a floor.
  return Math.max(0, projectedPoints + (bias ?? 0));
}

/**
 * Collapses a side's starters into a mean and variance for its final score.
 *
 * A finished player is a known constant and contributes no variance. A player
 * yet to kick off contributes their whole projection and full variance. A player
 * mid-game contributes what they have plus a pro-rata slice of the projection,
 * with variance scaled by the fraction of the game left — uncertainty shrinks
 * with the clock, which is what makes the price move during a slate.
 */
/**
 * Per-position outcome shape, fitted on 33,841 player-weeks (2021-2025 weeks 1-17)
 * scored under this league's own settings.
 *
 * A plain normal around the projection is the natural model and it is wrong in a
 * specific, measurable way: it puts a large slab of probability BELOW zero, when in
 * reality a skill-position player almost never scores negative but very often scores
 * exactly zero.
 *
 *   position   P(exactly 0)   P(negative)   skew
 *   QB              1.0%          1.2%      0.31
 *   RB             14.5%          1.1%      1.39
 *   WR             19.4%          0.8%      1.50
 *   TE             34.4%          0.4%      1.97
 *   K               2.9%          1.2%      0.53
 *   DEF             0.2%          3.4%      0.86
 *
 * So DEF is the one position where a negative is a real outcome (3.4%, and it barely
 * ever posts an exact zero), while TE posts an exact zero more than a third of the
 * time and essentially never goes negative. The old normal fit gave a TE projected
 * around 4 points a 22% chance of finishing NEGATIVE — that probability mass belongs
 * at exactly zero instead.
 *
 * The zeros are genuine goose eggs, not missing data: 0.0-0.1% of projected players
 * are absent from Sleeper's stats payload, so a 0 means they played and did not score.
 *
 * P(zero) falls steeply with the projection, which is why it is a logistic in the
 * projection rather than a constant — a TE projected under 5 blanks 47.5% of the
 * time, one projected 15-25 essentially never does.
 *
 * Why bother, when the sum of ten starters is near-normal by the central limit
 * theorem either way? Two reasons. Aggregate matchup Brier is indeed unchanged
 * (0.2280 vs 0.2281 over 325 real games), but calibration improves where the sample
 * is thick (the 50-60% bucket lands 0.8pp off its target instead of 2.8pp). And CLT
 * stops applying exactly when the money is live: late in a slate with one or two
 * players left, a fake 20% negative tail on a single starter visibly distorts the
 * price.
 */
type PositionShape = {
  /** P(exactly zero) = sigmoid(zeroIntercept + zeroSlope * projection). */
  zeroIntercept: number;
  zeroSlope: number;
  /** The small, position-specific chance of a negative, and its shape. */
  negProb: number;
  negMean: number;
  negSd: number;
  /** Mean and sd GIVEN the player scored something, both linear in the projection. */
  scoreMean: number;
  scoreMeanSlope: number;
  scoreSd: number;
  scoreSdSlope: number;
};

const POSITION_SHAPE: Record<string, PositionShape> = {
  QB: {
    zeroIntercept: 0.680, zeroSlope: -0.5260,
    negProb: 0.0125, negMean: -1.72, negSd: 1.66,
    scoreMean: 2.97, scoreMeanSlope: 0.788,
    scoreSd: 4.81, scoreSdSlope: 0.162,
  },
  RB: {
    zeroIntercept: 0.365, zeroSlope: -0.7059,
    negProb: 0.0114, negMean: -0.51, negSd: 0.52,
    scoreMean: 1.74, scoreMeanSlope: 0.965,
    scoreSd: 3.27, scoreSdSlope: 0.367,
  },
  WR: {
    zeroIntercept: 0.237, zeroSlope: -0.3966,
    negProb: 0.0081, negMean: -0.82, negSd: 0.67,
    scoreMean: 2.06, scoreMeanSlope: 0.880,
    scoreSd: 3.14, scoreSdSlope: 0.376,
  },
  TE: {
    zeroIntercept: 0.965, zeroSlope: -0.5820,
    negProb: 0.0036, negMean: -0.70, negSd: 0.48,
    scoreMean: 2.17, scoreMeanSlope: 0.839,
    scoreSd: 2.53, scoreSdSlope: 0.437,
  },
  K: {
    zeroIntercept: -0.031, zeroSlope: -0.5071,
    negProb: 0.0124, negMean: -1.29, negSd: 0.45,
    scoreMean: 6.75, scoreMeanSlope: 0.285,
    scoreSd: 5.38, scoreSdSlope: -0.080,
  },
  DEF: {
    zeroIntercept: -0.085, zeroSlope: -0.7126,
    negProb: 0.0336, negMean: -1.53, negSd: 1.06,
    scoreMean: 2.45, scoreMeanSlope: 0.704,
    scoreSd: 3.06, scoreSdSlope: 0.266,
  },
};

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));

/**
 * Mean and variance of one starter's score, as a three-part mixture: a small chance
 * of a negative, a projection-dependent chance of exactly zero, and otherwise a
 * normal truncated at zero.
 *
 * Falls back to the old plain-normal moments for a player whose position we cannot
 * identify, so an unmapped id degrades rather than throwing.
 */
export function starterMoments(
  projectedPoints: number,
  position: string | null,
): { mean: number; variance: number } {
  const shape = position ? POSITION_SHAPE[position] : undefined;
  if (!shape) {
    const mean = adjustedProjection(projectedPoints, position);
    const sd = projectionSd(projectedPoints, position);
    return { mean, variance: sd * sd };
  }

  const proj = Math.max(0, projectedPoints);
  const pZero = sigmoid(shape.zeroIntercept + shape.zeroSlope * proj);
  const pNeg = shape.negProb;
  const pScore = Math.max(0, 1 - pZero - pNeg);

  // Mean and sd GIVEN the player scored. Fitted straight off the empirical
  // conditional moments per projection bin, so no distributional shape is assumed —
  // which matters because these are strongly right-skewed (skew 1.4 at RB, 2.0 at
  // TE) and a symmetric fit understates the spread.
  const scoreMean = Math.max(0.1, shape.scoreMean + shape.scoreMeanSlope * proj);
  const scoreSd = Math.max(0.8, shape.scoreSd + shape.scoreSdSlope * proj);

  // Three-part mixture. The zero component contributes nothing to the mean but a lot
  // to the variance: a coin flip between 0 and a real score is genuinely volatile,
  // which a single normal could only imitate by being too wide everywhere.
  const mean = pNeg * shape.negMean + pScore * scoreMean;
  const second =
    pNeg * (shape.negMean * shape.negMean + shape.negSd * shape.negSd) +
    pScore * (scoreMean * scoreMean + scoreSd * scoreSd);
  return { mean, variance: Math.max(0.2, second - mean * mean) };
}

export function sideDistribution(starters: StarterInput[]): SideDistribution {
  let banked = 0;
  let remaining = 0;
  let variance = 0;

  for (const s of starters) {
    banked += s.actualPoints;

    if (s.gameState === 'post') continue; // settled, no upside and no variance

    const fraction =
      s.gameState === 'pre'
        ? 1
        : Math.min(1, Math.max(0, s.remainingMinutes / REGULATION_MINUTES));

    if (fraction <= 0) continue;

    const m = starterMoments(s.projectedPoints, s.position ?? null);
    remaining += m.mean * fraction;
    // Independent sources of error add in quadrature, so square-sum rather than
    // summing the sds.
    const extra = s.extraSd ?? 0;
    variance += m.variance * fraction + extra * extra * fraction;
  }

  return { mean: banked + remaining, variance, banked, remaining };
}

/** Standard normal CDF via Abramowitz & Stegun 7.1.26 on erf. */
function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * P(side A finishes above side B).
 *
 * Uses a normal approximation to the score difference. Legitimate here because
 * each side is a sum of ~10 starters and the CLT does the work — but it
 * understates tail outcomes late in a matchup when only one boom-or-bust player
 * is left, where the true distribution is that single player's, not a normal.
 */
export function winProbability(a: SideDistribution, b: SideDistribution): number {
  const meanDiff = a.mean - b.mean;
  const sd = Math.sqrt(a.variance + b.variance);

  if (sd <= 0) {
    // Everything is final: the result is known.
    if (meanDiff > 0) return 1;
    if (meanDiff < 0) return 0;
    return 0.5;
  }
  return normalCdf(meanDiff / sd);
}

/** American odds from an implied probability. */
export function toAmericanOdds(impliedProbability: number): number {
  const p = Math.min(0.995, Math.max(0.005, impliedProbability));
  return p >= 0.5
    ? -Math.round((100 * p) / (1 - p))
    : Math.round((100 * (1 - p)) / p);
}

/** Profit on a winning stake at American odds. */
export function profitForStake(stakeCents: number, americanOdds: number): number {
  return americanOdds < 0
    ? Math.round((stakeCents * 100) / Math.abs(americanOdds))
    : Math.round((stakeCents * americanOdds) / 100);
}

export type PricedSides = {
  probA: number;
  probB: number;
  impliedA: number;
  impliedB: number;
  oddsA: number;
  oddsB: number;
  /** Total implied probability. Above 1 by construction — that's the edge. */
  overround: number;
};

/**
 * Shades a fair probability pair into prices carrying the house edge, so the
 * implied probabilities sum above 100%.
 */
export function priceSides(probA: number, vig: number = HOUSE_VIG): PricedSides {
  const pA = Math.min(1, Math.max(0, probA));
  const pB = 1 - pA;
  const impliedA = pA * (1 + vig);
  const impliedB = pB * (1 + vig);
  return {
    probA: pA,
    probB: pB,
    impliedA,
    impliedB,
    oddsA: toAmericanOdds(impliedA),
    oddsB: toAmericanOdds(impliedB),
    overround: impliedA + impliedB,
  };
}

/**
 * Total regulation minutes left across every distinct unfinished game holding a
 * starter from either side.
 *
 * Deliberately counts each NFL game once, not once per starter in it — two
 * players in the same game share one clock. This is the number the 30-minute
 * market cutoff is measured against.
 */
export function matchupRemainingMinutes(
  starters: StarterInput[],
  gameIdForPlayer: (playerId: string) => string | undefined,
): number {
  const seen = new Map<string, number>();
  for (const s of starters) {
    if (s.gameState === 'post') continue;
    const gameId = gameIdForPlayer(s.playerId);
    if (!gameId) continue;
    if (!seen.has(gameId)) seen.set(gameId, s.remainingMinutes);
  }
  let total = 0;
  for (const minutes of seen.values()) total += minutes;
  return total;
}

export function isMarketOpen(remainingMinutes: number): boolean {
  return remainingMinutes >= MARKET_CLOSE_MINUTES;
}
