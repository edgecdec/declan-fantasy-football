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

    remaining += adjustedProjection(s.projectedPoints, s.position) * fraction;
    const sd = projectionSd(s.projectedPoints, s.position) * Math.sqrt(fraction);
    variance += sd * sd;
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
