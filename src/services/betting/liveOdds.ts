/**
 * Live win probability and pricing for a head-to-head fantasy matchup.
 *
 * Pure math, no data fetching and no heavy imports, so it can run on either
 * side of the wire and be tested directly.
 */

/**
 * Per-player projection error, fitted from 4,636 player-weeks of 2025
 * (Sleeper `pts_ppr` projection vs actual, weeks 1-14):
 *
 *   proj range   n     mean proj   resid sd
 *   0-3          902        1.32       2.95
 *   3-6          751        4.63       5.04
 *   6-9         1151        7.48       5.64
 *   9-12         633       10.23       6.00
 *   12-15        432       13.46       7.34
 *   15-18        331       16.51       7.62
 *   18-22        337       19.70       7.94
 *   22+           99       23.72       9.43
 *
 * Least squares over the bucket means gives sd = 3.386 + 0.2562 * projection,
 * within 0.78 sd points on every bucket. Variance genuinely scales with
 * projection size, so a flat sd would badly misprice a matchup whose remaining
 * players are all kickers.
 */
const RESID_SD_INTERCEPT = 3.386;
const RESID_SD_SLOPE = 0.2562;

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

/** Per-player residual sd at a given projection, floored at zero. */
export function projectionSd(projectedPoints: number): number {
  const proj = Math.max(0, projectedPoints);
  return RESID_SD_INTERCEPT + RESID_SD_SLOPE * proj;
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

    remaining += s.projectedPoints * fraction;
    const sd = projectionSd(s.projectedPoints) * Math.sqrt(fraction);
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
