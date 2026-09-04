/**
 * Monte Carlo simulation of the rest of a fantasy season, for a "wins the league"
 * market.
 *
 * Every constant here is fitted from this league's own 650 completed team-weeks
 * (2021-2025, scored under its own settings), not assumed. Two measurements drive
 * the whole design:
 *
 *   team-week scoring         mean 125.4, sd 23.3
 *   spread of TEAM means      sd  9.4   <- how much teams actually differ
 *   within-team week to week   sd 20.8   <- 2.2x larger than the skill spread
 *   first half -> second half  r 0.326, regression slope 0.362
 *
 * That last number is the one that matters most. Only about 36% of an observed
 * scoring edge carries into the rest of the season, so an observed mean has to be
 * shrunk hard toward the league average. Skipping that step is what makes naive
 * season simulators wildly overconfident about who is good — with noise 2.2x the
 * size of real skill, most of a hot start is luck.
 */

/** Weekly scoring noise for a single team, fitted within-team. */
export const TEAM_WEEK_SD = 20.8;

/** League-average team-week score, the target we shrink observed means toward. */
export const LEAGUE_MEAN_SCORE = 125.4;

/**
 * Fraction of an observed scoring edge that persists. Fitted by regressing each
 * team-season's second-half mean on its first-half mean across 50 team-seasons.
 */
export const PERSISTENCE = 0.362;

/**
 * Weeks of observed scoring needed before we lean on it as much as PERSISTENCE
 * allows. Below this we blend toward the projection-based estimate, because six
 * games of noise at sd 20.8 says very little.
 */
const OBSERVED_WEIGHT_FULL_WEEKS = 6;

/**
 * Maximum weekly scoring bump from having a full FAAB budget left rather than none.
 *
 * Deliberately tiny, and deliberately NOT fitted, because the data does not support
 * a fitted value: the correlation between FAAB spent and season points across the
 * five completed seasons is +0.53, -0.10, -0.09, +0.46, -0.36, pooling to -0.28.
 * That is noise at n=50, and if anything points the wrong way — probably because
 * struggling teams churn their roster hardest.
 *
 * It is included because the *mechanism* is real even though the correlation is
 * not measurable: budget left is optionality to patch an injury or stream a good
 * matchup, which is a forward-looking capability rather than something a
 * backward-looking correlation would capture. Capped at well under a tenth of the
 * weekly noise so it can nudge a close market without ever distorting one, and
 * teams historically finish 82-89% spent, so the effect is naturally concentrated
 * early in the season where the optionality genuinely exists.
 */
export const MAX_FAAB_EDGE_POINTS = 1.5;

export type TeamState = {
  rosterId: number;
  ownerId: string | null;
  displayName: string;
  /** Banked regular-season record so far. */
  wins: number;
  losses: number;
  ties: number;
  /** Points for, the seeding tiebreaker. */
  pointsFor: number;
  /**
   * Expected score per remaining week, before shrinkage — from the current
   * roster's projections, so it reflects trades and waiver moves.
   */
  projectedWeekMean: number;
  /** Observed mean score per week so far, or null before any games. */
  observedWeekMean: number | null;
  /** Weeks of observed scoring behind observedWeekMean. */
  weeksPlayed: number;
  /** Fraction of the FAAB budget still unspent, 0..1. */
  faabRemaining: number;
  /** Live current week: points already banked. */
  currentBanked: number;
  /** Live current week: expected points still to come. */
  currentRemainingMean: number;
  /** Live current week: sd of the points still to come. */
  currentRemainingSd: number;
};

export type SeasonSimResult = {
  rosterId: number;
  ownerId: string | null;
  displayName: string;
  titleProb: number;
  playoffProb: number;
  /** Binomial standard error, so a reader can see how settled the number is. */
  titleSe: number;
  playoffSe: number;
  /** Mean final regular-season wins across sims. */
  expectedWins: number;
  /** The shrunk per-week mean actually used, for explaining the number. */
  weekMean: number;
};

/**
 * The per-week mean actually simulated.
 *
 * Blends the projection-based estimate with observed scoring, shrinking any
 * observed edge by PERSISTENCE and weighting it in only as games accumulate. Then
 * a small FAAB term.
 */
export function effectiveWeekMean(t: TeamState): number {
  const projected = t.projectedWeekMean;

  let base = projected;
  if (t.observedWeekMean !== null && t.weeksPlayed > 0) {
    // Only the persistent part of an observed edge is real.
    const shrunkObserved =
      LEAGUE_MEAN_SCORE + (t.observedWeekMean - LEAGUE_MEAN_SCORE) * PERSISTENCE;
    const w = Math.min(1, t.weeksPlayed / OBSERVED_WEIGHT_FULL_WEEKS);
    base = projected * (1 - w) + shrunkObserved * w;
  }

  // Budget left is optionality, so it is centred: a team at half budget gets
  // nothing, full budget gets +half the cap, empty gets -half.
  const faab = (t.faabRemaining - 0.5) * MAX_FAAB_EDGE_POINTS;
  return base + faab;
}

/** mulberry32 — small, fast, seedable, so a run is reproducible. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller, returning one standard normal per call. */
function normal(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export type WeekPairings = { week: number; pairs: [number, number][] }[];

export type SeasonSimInput = {
  teams: TeamState[];
  /** Remaining regular-season weeks and who plays whom, from Sleeper. */
  remainingSchedule: WeekPairings;
  /** True when the current week is still live and needs simulating from partials. */
  currentWeekLive: boolean;
  /** Pairings for the live current week. */
  currentWeekPairs: [number, number][];
  playoffTeams: number;
  sims: number;
  seed?: number;
};

/**
 * Runs the season out `sims` times and returns title and playoff probabilities.
 *
 * The live current week is simulated from its partial state — banked points plus a
 * draw on what is still to come — rather than from the season-long mean, so a team
 * already 40 points up in an unfinished game is treated as 40 points up.
 */
export function simulateSeason(input: SeasonSimInput): SeasonSimResult[] {
  const { teams, remainingSchedule, currentWeekLive, currentWeekPairs, playoffTeams, sims } = input;
  const rng = makeRng(input.seed ?? 1);

  const byRoster = new Map(teams.map(t => [t.rosterId, t]));
  const means = new Map(teams.map(t => [t.rosterId, effectiveWeekMean(t)]));

  const titleCount = new Map<number, number>(teams.map(t => [t.rosterId, 0]));
  const playoffCount = new Map<number, number>(teams.map(t => [t.rosterId, 0]));
  const winsTotal = new Map<number, number>(teams.map(t => [t.rosterId, 0]));

  for (let s = 0; s < sims; s++) {
    const wins = new Map<number, number>();
    const pf = new Map<number, number>();
    for (const t of teams) {
      wins.set(t.rosterId, t.wins + t.ties * 0.5);
      pf.set(t.rosterId, t.pointsFor);
    }

    const scoreOnce = (rosterId: number): number => {
      const mean = means.get(rosterId) ?? LEAGUE_MEAN_SCORE;
      return mean + normal(rng) * TEAM_WEEK_SD;
    };

    // The live week, from partial state.
    if (currentWeekLive) {
      for (const [x, y] of currentWeekPairs) {
        const tx = byRoster.get(x);
        const ty = byRoster.get(y);
        if (!tx || !ty) continue;
        const sx = tx.currentBanked + tx.currentRemainingMean + normal(rng) * tx.currentRemainingSd;
        const sy = ty.currentBanked + ty.currentRemainingMean + normal(rng) * ty.currentRemainingSd;
        pf.set(x, (pf.get(x) ?? 0) + sx);
        pf.set(y, (pf.get(y) ?? 0) + sy);
        if (sx > sy) wins.set(x, (wins.get(x) ?? 0) + 1);
        else if (sy > sx) wins.set(y, (wins.get(y) ?? 0) + 1);
        else {
          wins.set(x, (wins.get(x) ?? 0) + 0.5);
          wins.set(y, (wins.get(y) ?? 0) + 0.5);
        }
      }
    }

    // Future weeks, on the real schedule.
    for (const wk of remainingSchedule) {
      for (const [x, y] of wk.pairs) {
        const sx = scoreOnce(x);
        const sy = scoreOnce(y);
        pf.set(x, (pf.get(x) ?? 0) + sx);
        pf.set(y, (pf.get(y) ?? 0) + sy);
        if (sx > sy) wins.set(x, (wins.get(x) ?? 0) + 1);
        else if (sy > sx) wins.set(y, (wins.get(y) ?? 0) + 1);
        else {
          wins.set(x, (wins.get(x) ?? 0) + 0.5);
          wins.set(y, (wins.get(y) ?? 0) + 0.5);
        }
      }
    }

    for (const t of teams) winsTotal.set(t.rosterId, (winsTotal.get(t.rosterId) ?? 0) + (wins.get(t.rosterId) ?? 0));

    // Seed on wins, then points for — Sleeper's default.
    const seeded = [...teams]
      .map(t => ({ id: t.rosterId, w: wins.get(t.rosterId) ?? 0, p: pf.get(t.rosterId) ?? 0 }))
      .sort((m, n) => (n.w - m.w) || (n.p - m.p))
      .slice(0, playoffTeams)
      .map(x => x.id);

    for (const id of seeded) playoffCount.set(id, (playoffCount.get(id) ?? 0) + 1);

    const champ = simulateBracket(seeded, scoreOnce);
    if (champ !== null) titleCount.set(champ, (titleCount.get(champ) ?? 0) + 1);
  }

  return teams.map(t => {
    const titleProb = (titleCount.get(t.rosterId) ?? 0) / sims;
    const playoffProb = (playoffCount.get(t.rosterId) ?? 0) / sims;
    return {
      rosterId: t.rosterId,
      ownerId: t.ownerId,
      displayName: t.displayName,
      titleProb,
      playoffProb,
      titleSe: Math.sqrt((titleProb * (1 - titleProb)) / sims),
      playoffSe: Math.sqrt((playoffProb * (1 - playoffProb)) / sims),
      expectedWins: (winsTotal.get(t.rosterId) ?? 0) / sims,
      weekMean: means.get(t.rosterId) ?? LEAGUE_MEAN_SCORE,
    };
  });
}

/**
 * Plays out the bracket for the seeded field and returns the champion's roster id.
 *
 * Shaped from this league's actual 2025 winners bracket rather than assumed: with
 * six teams the top two seeds get a bye, and the bracket is FIXED rather than
 * re-seeded — seed 1 meets the winner of 3v6 and seed 2 the winner of 4v5.
 */
function simulateBracket(seeded: number[], scoreOnce: (id: number) => number): number | null {
  if (seeded.length === 0) return null;
  if (seeded.length === 1) return seeded[0];

  const beat = (x: number, y: number): number => (scoreOnce(x) >= scoreOnce(y) ? x : y);

  if (seeded.length >= 6) {
    const [s1, s2, s3, s4, s5, s6] = seeded;
    const w36 = beat(s3, s6);
    const w45 = beat(s4, s5);
    const semi1 = beat(s1, w36);
    const semi2 = beat(s2, w45);
    return beat(semi1, semi2);
  }

  if (seeded.length === 4) {
    const [s1, s2, s3, s4] = seeded;
    return beat(beat(s1, s4), beat(s2, s3));
  }

  // Odd field sizes aren't a shape this league uses; play it as a ladder rather
  // than guessing a bracket.
  let survivor = seeded[0];
  for (let i = 1; i < seeded.length; i++) survivor = beat(survivor, seeded[i]);
  return survivor;
}
