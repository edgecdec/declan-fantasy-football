/**
 * Re-projecting a defence's points-allowed and yards-allowed brackets from the live game state.
 *
 * THE PROBLEM, measured live. Sleeper credits a bracket bonus from the score SO FAR, so at
 * kickoff every defence is already holding the "0 points allowed" bonus. Nine minutes into the
 * 2026 week 1 opener, Seattle's defence showed `pts_std: 11` having recorded nothing at all:
 * 10 points of shutout bonus plus a sack. New England's showed 11 the same way.
 *
 * Treating that as banked is wrong twice over. It is credited in full when it is the least
 * certain part of the score, and the model then adds a full-game projection on top of it — which
 * itself already includes an expected bracket. Sized across all 18 of this user's leagues over
 * 10 weeks of 2025: the kickoff over-credit is +9.5 to +12.4 points per defence, worst case
 * +21.5. Every one of those leagues prices a bracket, so this is not an edge case.
 *
 * How wrong the naive credit is, from 512 team-games of 2025:
 *
 *   final points allowed    mean 22.71, sd 9.66, median 23, range 0-52
 *   ended in the 0 bracket  0.0%
 *   ended in 1-6            3%
 *
 * So the bonus a defence is credited at kickoff is one it essentially never keeps.
 *
 * THE FIX. Strip the credited bracket out of the live score and replace it with the expectation
 * of the bracket the game is heading for:
 *
 *   E[final points allowed] = allowed so far + (this defence's projected total) x share of the
 *                             game's scoring still to come
 *
 * then spread that over the brackets and take the mean. Sleeper's own per-team projection is used
 * for the total rather than a league average, so a good defence facing a bad offence is priced as
 * such — it publishes `pts_allow` and `yds_allow` per team.
 *
 * WHY NOT JUST SHRINK THE CREDITED BONUS BY THE TIME REMAINING. It is a tempting one-liner with
 * both endpoints right — nothing at kickoff, the true bracket at the whistle — and it is close
 * while a defence is holding up. It fails in the other direction: it only ever pulls the current
 * bracket toward zero, when what actually happens is the defence slides into a WORSE bracket. A
 * defence down 28 at halftime is heading for 35+, worth -3; shrinking its current -1 by half
 * gives -0.5. See `defenseBracketAdjustment` for the numbers either way.
 */

export type Bracket = {
  key: string;
  /** Highest value still inside this bracket; Infinity for the open-ended top one. */
  max: number;
};

/**
 * Sleeper's points-allowed brackets. Values are whole points, so the bounds are exact.
 */
export const PTS_ALLOW_BRACKETS: Bracket[] = [
  { key: 'pts_allow_0', max: 0 },
  { key: 'pts_allow_1_6', max: 6 },
  { key: 'pts_allow_7_13', max: 13 },
  { key: 'pts_allow_14_20', max: 20 },
  { key: 'pts_allow_21_27', max: 27 },
  { key: 'pts_allow_28_34', max: 34 },
  { key: 'pts_allow_35p', max: Infinity },
];

/**
 * Sleeper's yards-allowed brackets.
 *
 * The names overlap at the boundaries (`yds_allow_0_100` then `yds_allow_100_199`), which is
 * Sleeper's own sloppiness rather than a transcription error — treated as upper bounds, so 100
 * yards falls in the first.
 */
export const YDS_ALLOW_BRACKETS: Bracket[] = [
  { key: 'yds_allow_0_100', max: 100 },
  { key: 'yds_allow_100_199', max: 199 },
  { key: 'yds_allow_200_299', max: 299 },
  { key: 'yds_allow_300_349', max: 349 },
  { key: 'yds_allow_350_399', max: 399 },
  { key: 'yds_allow_400_449', max: 449 },
  { key: 'yds_allow_450_499', max: 499 },
  { key: 'yds_allow_500_549', max: 549 },
  { key: 'yds_allow_550p', max: Infinity },
];

/**
 * Cumulative share of a game's points scored by the end of each quarter.
 *
 * Measured over 256 completed 2025 games (11,804 combined points), because the obvious
 * assumption — that each minute allows the same points — is wrong: the first and third quarters
 * are light and the second and fourth heavy, which is the end-of-half drill showing up in the
 * data. Linear would say 25/50/75/100.
 *
 * It is very nearly linear AT HALFTIME (50.4%), which is why a straight time-based rule looks
 * fine when spot-checked there and drifts up to five points of share inside Q1 and Q3.
 */
const CUMULATIVE_SCORING_BY_QUARTER = [0.201, 0.504, 0.712, 1] as const;

const REGULATION_MINUTES = 60;
const MINUTES_PER_QUARTER = 15;

/**
 * Full-game sd of points and yards allowed, from 512 team-games of 2025.
 *
 * Only the spread is taken from the league; the CENTRE comes from Sleeper's per-team projection,
 * which knows who is playing whom.
 */
export const PTS_ALLOW_SD = 9.66;
export const YDS_ALLOW_SD = 83.53;

/** Fallbacks for when a projection is missing, from the same 512 team-games. */
export const LEAGUE_MEAN_PTS_ALLOW = 22.71;
export const LEAGUE_MEAN_YDS_ALLOW = 328.64;

/**
 * Share of a game's scoring still to come, given the regulation minutes left.
 *
 * Uses the measured quarter curve rather than minutes/60. Interpolates linearly WITHIN a quarter,
 * where there is no finer measurement to justify anything else.
 */
export function remainingScoringShare(minutesRemaining: number): number {
  const remaining = Math.min(REGULATION_MINUTES, Math.max(0, minutesRemaining));
  const elapsed = REGULATION_MINUTES - remaining;
  const quarterIndex = Math.min(3, Math.floor(elapsed / MINUTES_PER_QUARTER));
  const intoQuarter = (elapsed - quarterIndex * MINUTES_PER_QUARTER) / MINUTES_PER_QUARTER;
  const before = quarterIndex === 0 ? 0 : CUMULATIVE_SCORING_BY_QUARTER[quarterIndex - 1];
  const after = CUMULATIVE_SCORING_BY_QUARTER[quarterIndex];
  const elapsedShare = before + intoQuarter * (after - before);
  return Math.min(1, Math.max(0, 1 - elapsedShare));
}

/** The bracket a value falls in. */
export function bracketFor(brackets: Bracket[], value: number): Bracket {
  return brackets.find(b => value <= b.max) ?? brackets[brackets.length - 1];
}

/** What a league pays for the bracket a value falls in. Zero when it prices no brackets. */
export function bracketPoints(
  brackets: Bracket[],
  scoring: Record<string, number>,
  value: number,
): number {
  return scoring[bracketFor(brackets, value).key] ?? 0;
}

/** True when a league prices any of these brackets at all. */
export function pricesBrackets(brackets: Bracket[], scoring: Record<string, number>): boolean {
  return brackets.some(b => scoring[b.key] != null);
}

const sqrt2 = Math.SQRT2;

/** Standard normal CDF via Abramowitz & Stegun 7.1.26. */
function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / sqrt2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * Mean and variance of the bracket points, given a normal belief about the final value.
 *
 * `integerValued` applies a continuity correction, which matters for points allowed: the 0
 * bracket is the single value 0, and without the half-point widening a normal assigns it almost
 * no mass and a shutout in progress reads as worthless.
 */
export function bracketMoments(
  brackets: Bracket[],
  scoring: Record<string, number>,
  mean: number,
  sd: number,
  integerValued: boolean,
): { mean: number; variance: number } {
  const edge = integerValued ? 0.5 : 0;
  // A degenerate sd means the value is known: the bracket is simply the one it lands in.
  if (!(sd > 0)) {
    const points = bracketPoints(brackets, scoring, mean);
    return { mean: points, variance: 0 };
  }

  let expected = 0;
  let second = 0;
  let lower = -Infinity;
  for (const b of brackets) {
    const upper = b.max === Infinity ? Infinity : b.max + edge;
    const pBelowUpper = upper === Infinity ? 1 : normalCdf((upper - mean) / sd);
    const pBelowLower = lower === -Infinity ? 0 : normalCdf((lower - mean) / sd);
    const p = Math.max(0, pBelowUpper - pBelowLower);
    const points = scoring[b.key] ?? 0;
    expected += p * points;
    second += p * points * points;
    lower = upper;
  }
  return { mean: expected, variance: Math.max(0, second - expected * expected) };
}

export type DefenseBracketInput = {
  /** The league's scoring settings. */
  scoring: Record<string, number>;
  /** Points allowed so far. Sleeper omits the key at zero, so treat a missing value as 0. */
  currentPtsAllow: number;
  /** Yards allowed so far. */
  currentYdsAllow: number;
  /** Sleeper's projected full-game points allowed for THIS defence, if known. */
  projectedPtsAllow?: number | null;
  projectedYdsAllow?: number | null;
  /** Regulation minutes left. 60 before kickoff, 0 once final. */
  minutesRemaining: number;
};

export type BracketAdjustment = {
  /** Bracket points the live score already contains, from the state so far. */
  credited: number;
  /** Bracket points the game is actually heading for, in expectation. */
  expected: number;
  /** Variance of that expectation, so the uncertainty reaches the win probability. */
  variance: number;
  /** expected - credited: add this to a live score to correct it. */
  correction: number;
};

/**
 * The bracket correction for one defence.
 *
 * Add `correction` to the defence's live score and the bracket component stops being a certainty
 * credited from a scoreline that has barely happened, and becomes an expectation about the final
 * one. At kickoff it removes the whole spurious bonus and substitutes the projected bracket; at
 * the final whistle it is exactly zero, because there is nothing left to project.
 *
 * Worked example, a league paying 10 / 7 / 4 / 1 / 0 / -1 / -4 and a defence projected to allow
 * 23 points. Generated by the `worked example` case in tests/defenseBrackets.test.ts rather than
 * typed here, so it cannot drift from what the code does:
 *
 *   state                    credited   this model    sd   shrink-by-time rule
 *   kickoff, 0 allowed        +10.00       +0.38     2.59        0.00
 *   end of Q1, 0 allowed      +10.00       +1.53     2.63       +2.50
 *   halftime, 0 allowed       +10.00       +3.63     2.76       +5.00
 *   halftime, 14 allowed       +1.00       -0.29     1.61       +0.50
 *   halftime, 28 allowed       -1.00       -3.25     1.37       -0.50
 *   end of Q3, 0 allowed      +10.00       +5.55     2.47       +7.50
 *   two minutes left, 0        +10.00       +8.25     1.49       +9.67
 *   final, 24 allowed           0.00        0.00     0.00        0.00
 *
 * The `halftime, 28 allowed` row is where a time-based rule goes wrong: it can only pull the
 * current bracket toward zero (-1 to -0.5), while the defence is in fact sliding toward a worse
 * one (-3.25), with another eleven points or so still to come.
 */
export function defenseBracketAdjustment(input: DefenseBracketInput): BracketAdjustment {
  const { scoring, minutesRemaining } = input;
  const remainingShare = remainingScoringShare(minutesRemaining);

  const currentPts = Math.max(0, input.currentPtsAllow || 0);
  const currentYds = Math.max(0, input.currentYdsAllow || 0);

  let credited = 0;
  let expected = 0;
  let variance = 0;

  if (pricesBrackets(PTS_ALLOW_BRACKETS, scoring)) {
    credited += bracketPoints(PTS_ALLOW_BRACKETS, scoring, currentPts);
    const projected = input.projectedPtsAllow ?? LEAGUE_MEAN_PTS_ALLOW;
    const m = bracketMoments(
      PTS_ALLOW_BRACKETS,
      scoring,
      currentPts + projected * remainingShare,
      // Uncertainty scales with the share of the game still to come: at the whistle there is
      // none left, and the bracket is simply known.
      PTS_ALLOW_SD * Math.sqrt(remainingShare),
      true,
    );
    expected += m.mean;
    variance += m.variance;
  }

  if (pricesBrackets(YDS_ALLOW_BRACKETS, scoring)) {
    credited += bracketPoints(YDS_ALLOW_BRACKETS, scoring, currentYds);
    const projected = input.projectedYdsAllow ?? LEAGUE_MEAN_YDS_ALLOW;
    const m = bracketMoments(
      YDS_ALLOW_BRACKETS,
      scoring,
      currentYds + projected * remainingShare,
      YDS_ALLOW_SD * Math.sqrt(remainingShare),
      false,
    );
    expected += m.mean;
    variance += m.variance;
  }

  return { credited, expected, variance, correction: expected - credited };
}
