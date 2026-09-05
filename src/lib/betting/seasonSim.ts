/**
 * Monte Carlo simulation of the rest of a fantasy season, for a "wins the league"
 * market.
 *
 * Every constant is fitted from this league's own 650 completed team-weeks
 * (2021-2025, scored under its own settings). The fits are SEASON-CENTERED, which is
 * the correction that matters most here — see PERSISTENCE below for what going
 * without it cost.
 *
 *   team-week scoring, pooled     mean 125.4, sd 23.3
 *   within-team, week to week     sd 22.2   <- real weekly noise
 *   observed spread of team means sd  7.5
 *   ...of which luck alone explains  6.2
 *   => TRUE spread between teams  sd  4.2   <- only 32% of the observed spread
 *
 * That last line is the whole story: weekly noise is 5.2x the real difference
 * between teams. Almost everything that looks like a team being good is variance,
 * so an observed scoring edge has to be shrunk hard, and a PRESEASON edge has to be
 * shrunk almost to nothing.
 */

/**
 * Weekly scoring noise for a single team, fitted within-team and season-centered.
 *
 * Was 20.8, which came from a fit that did not remove season-to-season scoring
 * drift. This league's mean moved 121.0 -> 136.4 across the five seasons, and
 * leaving that in understated the within-team figure.
 */
export const TEAM_WEEK_SD = 22.16;

/**
 * League-average team-week score across all five seasons.
 *
 * Only used as a level anchor before any games are played. Once the season starts
 * we anchor on THIS season's observed mean instead, because the level moves a lot
 * year to year (121.0 to 136.4). The level mostly cancels in a head-to-head market
 * anyway — both sides shift together — so it matters for the displayed points-per-week
 * far more than for any probability.
 */
export const LEAGUE_MEAN_SCORE = 125.4;

/**
 * TRUE spread of team ability, in points per week, with luck removed.
 *
 * Derived by decomposing the observed spread of team season means (sd 7.46) against
 * what pure sampling noise would produce over ~13 games (sd 6.15):
 * sqrt(7.46^2 - 6.15^2) = 4.23. Only 32% of the observed variance in team means is
 * real; the rest is luck.
 */
export const TRUE_SKILL_SD = 4.23;

/**
 * Fraction of an observed scoring edge that carries forward.
 *
 * NOT a constant — it depends on how many games you have seen, which is the point.
 * See `observedShrinkage`.
 *
 * The previous value was a flat 0.362, and it was wrong by about 3x early in the
 * season. It came from regressing each team-season's second-half mean on its
 * first-half mean WITHOUT centering each season first. Because this league's scoring
 * level swung from 121.0 to 136.4 across the five seasons, a merely average team in
 * a high-scoring year looked "persistently above average" in both halves, and that
 * shared season effect was counted as team skill. Season-centering the identical
 * regression drops the slope from 0.362 to 0.123.
 *
 * Cross-checked directly: regressing each team's remaining-weeks scoring on its
 * scoring so far gives 0.11 at 3 weeks, 0.13 at 7, 0.39 at 10, 0.62 at 11 — a curve,
 * matching `observedShrinkage`, never a flat 0.362.
 */
export const PERSISTENCE_NOTE = 'see observedShrinkage';

/**
 * How much of a PRESEASON projected edge is real: essentially none.
 *
 * Measured directly. For all 50 completed team-seasons, a team's week-1 projected
 * starting lineup (Sleeper projections under this league's scoring) was regressed
 * against the points it actually averaged over that season. Season-centered:
 *
 *   correlation r = +0.030   (r^2 = 0.1%)   regression slope = 0.037
 *   per season:  -0.171, +0.095, +0.103, +0.405, +0.002
 *
 * At n=50 the standard error on r is about 0.15, so +0.030 is statistically
 * indistinguishable from zero. Preseason roster projections carry no measurable
 * information about season-long scoring in this league.
 *
 * The term is kept rather than hard-zeroed, at its measured coefficient, so the
 * mechanism stays visible and degrades gracefully if that ever changes. In practice
 * it converts a +9 point projected edge into +0.3, which is the honest answer.
 *
 * Why so useless? Two reasons visible in the data. Roster-shape differences dominate
 * the raw number (a WR-heavy lineup projects +12.7 at WR and -11.8 at RB, which is
 * not an edge, just a shape). And the residual is concentrated in the positions
 * projections predict worst: DEF projections explain 7% of week-1 variance, and a
 * defense's week-1 score correlates with its rest-of-season average at r = -0.011,
 * -0.051, +0.030 across three seasons. Defense is not sticky at all.
 */
export const PROJECTION_PERSISTENCE = 0.037;

/**
 * Bayesian shrinkage for an observed scoring mean, given how many weeks it covers.
 *
 * k = tau^2 / (tau^2 + sigma^2/n) — the standard posterior weight on an observation
 * whose noise is sigma^2/n against a prior spread of tau^2. This replaces the old
 * `min(1, n/6) * 0.362`, which was both too confident early and, because it capped
 * at 0.362, too timid late.
 *
 *   weeks:   1      3      6      10     13
 *   k:       0.035  0.098  0.179  0.267  0.321
 *   measured 0.11   0.11   0.12   0.39   0.62   (direct, remaining-weeks regression)
 *
 * The measured column is noisy (r never exceeds 0.27 at n=50) but tracks the curve
 * and rules out anything like a flat 0.36.
 */
export function observedShrinkage(weeksPlayed: number): number {
  if (weeksPlayed <= 0) return 0;
  const tau2 = TRUE_SKILL_SD * TRUE_SKILL_SD;
  const sigma2 = TEAM_WEEK_SD * TEAM_WEEK_SD;
  return tau2 / (tau2 + sigma2 / weeksPlayed);
}

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
  /**
   * Scoring level to anchor on: this season's observed league mean once games exist,
   * else LEAGUE_MEAN_SCORE. Shared by every team, so it cancels in head-to-head.
   */
  leagueMeanScore: number;
  /**
   * Mean projected score across the whole field this week. The projection tilt is
   * measured relative to THIS, not to the historical scoring mean — projections and
   * actuals sit on different scales (the 2026 field projects 132.7 against a
   * historical actual mean of 125.4), and differencing against the wrong one would
   * shift every team by the same several points for no reason.
   */
  leagueMeanProjection: number;
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
 * Starts from a prior that is the field's own scoring level, tilted by the team's
 * projection at the projection's measured worth (about 4% — see
 * PROJECTION_PERSISTENCE), then moves toward observed scoring by the Bayesian weight
 * for however many games have been played.
 *
 * Before any games this is deliberately almost flat across the league, because
 * nothing in the preseason data distinguishes these teams. A model that spread them
 * out here would be inventing confidence: the previous version took the week-1
 * projection at FACE VALUE as a season-long ability, which turned a +9.8 projected
 * edge into a +9.8 modeled edge and a 29.6% title chance for the top team, when the
 * measured value of that edge is +0.36.
 */
export function effectiveWeekMean(t: TeamState): number {
  const tilt = (t.projectedWeekMean - t.leagueMeanProjection) * PROJECTION_PERSISTENCE;
  const prior = t.leagueMeanScore + tilt;

  let base = prior;
  if (t.observedWeekMean !== null && t.weeksPlayed > 0) {
    base = prior + (t.observedWeekMean - prior) * observedShrinkage(t.weeksPlayed);
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
