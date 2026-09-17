import { normalCdf } from '@/services/betting/liveOdds';

/**
 * Elimination risk in a format with no opponent.
 *
 * A guillotine or chopped league does not pair anyone up: every roster posts a score and the
 * LOWEST one goes out. So there is no win probability to compute — the question is "what is the
 * chance I finish last this week", which depends on all N rosters at once rather than on one
 * opponent. That is why these leagues had no number at all before: `buildMatchupMarkets` returns
 * nothing for them, so the page could show their players but never their stakes.
 *
 * ## Why an integral rather than a simulation
 *
 * P(roster i is lowest) = integral over x of f_i(x) * product over j != i of (1 - F_j(x)) — the
 * chance i lands on x and everyone else beats it. With normal scores that is a one-dimensional
 * integral, so a grid evaluates it directly.
 *
 * Monte Carlo would have been the obvious choice and is worse here on the point that matters:
 * the page re-polls every 20 seconds, and a sampled probability would jitter by a few tenths of
 * a percent every refresh with no underlying change. A deterministic integral gives the same
 * inputs the same answer, always. It is also more accurate in the tail that decides this, where
 * a 5% probability means only 1 sample in 20 lands where it counts.
 *
 * ## What it assumes, and where that is thin
 *
 *  - **Normal scores.** Same approximation the head-to-head model already makes. Real weekly
 *    totals are mildly right-skewed, which slightly understates the chance of a very low score,
 *    so this is a touch optimistic about the bottom of the table.
 *  - **Independence between rosters.** Wrong in the same direction for everyone when rosters
 *    share players, and there is no shared-player term here. Across 15-18 rosters the effect on
 *    who is LAST is small, but it is a real simplification, not an exact answer.
 *  - **Exactly one roster goes out per week.** True of both live formats measured. A league that
 *    chops two at once would need this generalised.
 */

/** One roster's final-score distribution. */
export type RosterScore = {
  rosterId: number;
  /** Points already banked. */
  banked: number;
  /** Expected FINAL score, banked included. */
  mean: number;
  /** Standard deviation of the final score. */
  sd: number;
};

/**
 * A floor on the standard deviation, so a finished roster is a narrow spike rather than a
 * zero-width one the grid would step straight over. Fantasy points move in hundredths, so a
 * twentieth of a point is far below anything that could change an answer.
 */
const MIN_SD = 0.05;

/** Grid resolution. 1000 points across ~12 sd is comfortably finer than the answer needs. */
const GRID_STEPS = 1000;
const TAIL_SDS = 6;

/**
 * The chance each roster posts the LOWEST score, keyed by roster id.
 *
 * Every roster passed in must still be alive — an eliminated roster has no lineup and would
 * otherwise be a guaranteed minimum, which is exactly backwards.
 *
 * Probabilities are normalised to sum to 1: someone finishes last, and normalising also absorbs
 * whatever the grid loses in the tails.
 */
export function eliminationProbabilities(rosters: RosterScore[]): Map<number, number> {
  const out = new Map<number, number>();
  if (rosters.length === 0) return out;
  if (rosters.length === 1) {
    // Last roster standing. Degenerate, but the alternative is dividing by zero below.
    out.set(rosters[0].rosterId, 1);
    return out;
  }

  const spread = rosters.map(r => ({ ...r, sd: Math.max(MIN_SD, r.sd) }));
  const lo = Math.min(...spread.map(r => r.mean - TAIL_SDS * r.sd));
  const hi = Math.max(...spread.map(r => r.mean + TAIL_SDS * r.sd));
  const dx = (hi - lo) / GRID_STEPS;

  const totals = new Array<number>(spread.length).fill(0);
  for (let k = 0; k <= GRID_STEPS; k++) {
    const x = lo + k * dx;
    // Survival of each roster at x, computed once per grid point and reused across i.
    const above = spread.map(r => 1 - normalCdf((x - r.mean) / r.sd));
    for (let i = 0; i < spread.length; i++) {
      const r = spread[i];
      const z = (x - r.mean) / r.sd;
      const density = Math.exp(-0.5 * z * z) / (r.sd * Math.sqrt(2 * Math.PI));
      if (density === 0) continue;
      let others = 1;
      for (let j = 0; j < spread.length && others > 0; j++) {
        if (j !== i) others *= above[j];
      }
      totals[i] += density * others * dx;
    }
  }

  const sum = totals.reduce((s, t) => s + t, 0);
  spread.forEach((r, i) => {
    out.set(r.rosterId, sum > 0 ? totals[i] / sum : 1 / spread.length);
  });
  return out;
}
