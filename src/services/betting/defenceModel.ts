import { defenceCorrection, type DefenceCorrection } from '@/services/betting/defenseBrackets';
import { isDefenceRow, normalizeDefenceProjection, type DefenceStatMeans } from '@/services/stats/defenceProjection';
import { scoreStatLine } from '@/services/stats/scoring';

/**
 * League-relative model for a team defence's points: the one place both pricing paths (betting
 * `priceLeagueWeek` and the This Week / matchup markets) turn a DEF projection into a mean and a
 * variance, so the two pages cannot disagree about the same defence.
 *
 * WHY NOT THE POSITION SHAPE. liveOdds' DEF shape was fitted (2019-25) on Sleeper projections that
 * carried ~2.2 phantom return points a week (see stats/defenceProjection.ts), and the fit absorbed
 * them. Feed it repaired projections and it under-predicts; refit it in one league's units and it
 * drags every other league toward that league's DEF mean. Measured on held-out 2023-25 DEF-last
 * matchups (every other starter final, does the DEF cover the deficit): repairing the fields alone
 * makes the Brier WORSE (+0.0050), while this model improves it by -0.0039 (95% CI -0.0058 to
 * -0.0019) and brings every 2026 league to within +0.13 to +0.37 pts of actual.
 *
 * THE MODEL ("F" in the study):
 *
 *   mean = mu_L + 0.89 * (x - xbar)      sd = 0.97 * sigma_L
 *
 *   x       this DEF's repaired projection, in this league's scoring
 *   xbar    the mean repaired projection over every DEF on this week's slate
 *   mu_L    trailing mean of ACTUAL DEF points re-scored in this league's settings
 *   sigma_L trailing sd of the same
 *
 * Trailing = this season's completed weeks plus the prior season weighted as three weeks. The
 * projection explains only ~6% of DEF variance (only points/yards allowed carry real signal), so
 * most of the value is getting the LEVEL right, and the level comes from what defences in this
 * league's scoring actually score — not from the projection. Being centred also makes the price
 * immune to the next uniform level bug in Sleeper's feed: it shifts x and xbar together.
 *
 * Reference case: Graham's 2026 week 7, Junebugge needing 17.35 from DAL with everything else
 * final. The old shape priced it 28.51%; this prices it 10.5% (2026 base rate of a DEF scoring
 * 17.35+ in that league: 9.9%). Pinned in tests/defenceModel.test.ts.
 *
 * Study: SessionSwarm/runs/2026-10-13_180705/work/ff-def-projections/REPORT.md (section 5).
 */

/** b: a DEF's projected edge over the slate is shrunk by 11%. Fit LOSO 2021-25; held out 0.84-0.92. */
export const DEF_CENTRED_SLOPE = 0.89;
/** k: sd as a share of the league's trailing DEF sd. Fit LOSO 2021-25; held out 0.965-0.98. */
export const DEF_SD_FACTOR = 0.97;
/**
 * The prior season counts as this many team-games (three weeks of 32). Enough to anchor week 1,
 * small enough that the current season dominates by mid-October — which is what caught 2025's
 * kickoff change, where the prior season's level was wrong by a lot.
 */
export const PRIOR_SEASON_WEIGHT_TEAM_GAMES = 3 * 32;
/** Below one week of team-games the trailing level is not worth trusting. */
export const MIN_TRAILING_TEAM_GAMES = 32;
/**
 * Flag a week whose slate-mean DEF projection sits this far from the trailing actual mean.
 * On Sleeper's raw rows in Graham's scoring: 2024 -0.3..+0.1, 2025 at most +1.7, 2026 +3.5..+4.1
 * every week from week 1. Two points would have caught the phantom before the first 2026 slate.
 */
export const DEF_LEVEL_GUARD_POINTS = 2;
/** Floor on a live DEF's remaining non-bracket variance, as in liveOdds' starterMoments. */
const MIN_VARIANCE = 0.2;

/** One actual DEF stat line (Sleeper's `stats` object for a team-game that was played). */
export type DefenceStatLine = Record<string, number>;

/** Actual DEF stat lines the model trails over. */
export type DefenceHistory = {
  /** This season's completed weeks. */
  current: DefenceStatLine[];
  /** The whole prior season. Weighted as PRIOR_SEASON_WEIGHT_TEAM_GAMES, however many rows. */
  prior: DefenceStatLine[];
};

export type DefenceLevelGuard = {
  /** Repaired slate-mean projection minus the trailing actual mean, in league points. */
  level: number;
  /** Same for Sleeper's rows as published, before repair — the size of the feed's phantom. */
  rawLevel: number;
  /** |level| > DEF_LEVEL_GUARD_POINTS: the projection we price from is off the league's level. */
  fired: boolean;
  /**
   * Slate rows still matching `def_pr_yd == pr_yd + def_kr_yd`. When this drops below
   * `slateRows`, Sleeper has changed the feed — the repair stays correct either way (it keys on
   * `pr_yd`), but it is worth knowing.
   */
  identityRows: number;
  slateRows: number;
};

export type DefenceModel = {
  scoring: Record<string, number>;
  /** mu_L */
  actualMean: number;
  /** sigma_L */
  actualSd: number;
  /** xbar */
  slateMean: number;
  /** Effective team-games behind mu_L / sigma_L (prior season counted at its weight). */
  sampleSize: number;
  /** League-wide trailing means of actual DEF stats, used to fill what the projection lacks. */
  statMeans: DefenceStatMeans;
  guard: DefenceLevelGuard;
};

/** Never trailed: Sleeper's own point totals and ranks, game counts, and per-game extremes. */
const SKIP_PREFIXES = ['pts_', 'pos_rank', 'fan_pts', 'yds_allow_', 'pts_allow_'];
const SKIP_KEYS = new Set([
  'gp', 'adp_dd_ppr', 'pos_adp_dd_ppr', 'def_kr_lng', 'def_pr_lng', 'def_kr_ypa', 'def_pr_ypa',
]);
const trailable = (k: string) => !SKIP_KEYS.has(k) && !SKIP_PREFIXES.some(p => k.startsWith(p));

/**
 * Weighted mean of per-row values: current rows at 1 each, the prior season's MEAN at
 * PRIOR_SEASON_WEIGHT_TEAM_GAMES. Null when there is nothing at all.
 */
function trailingMean(current: number[], prior: number[]): number | null {
  const priorWeight = prior.length ? PRIOR_SEASON_WEIGHT_TEAM_GAMES : 0;
  const denominator = current.length + priorWeight;
  if (denominator === 0) return null;
  const priorMean = prior.length ? prior.reduce((s, v) => s + v, 0) / prior.length : 0;
  return (current.reduce((s, v) => s + v, 0) + priorMean * priorWeight) / denominator;
}

/** Effective sample size of the trailing window, in team-games. */
export function trailingSampleSize(history: DefenceHistory): number {
  return history.current.length + (history.prior.length ? PRIOR_SEASON_WEIGHT_TEAM_GAMES : 0);
}

/** League-wide trailing mean of every actual DEF stat, per team-game. A missing key counts as 0. */
export function trailingStatMeans(history: DefenceHistory): DefenceStatMeans {
  const keys = new Set<string>();
  for (const line of [...history.current, ...history.prior]) {
    for (const [k, v] of Object.entries(line)) if (typeof v === 'number' && trailable(k)) keys.add(k);
  }
  const out: DefenceStatMeans = {};
  for (const k of keys) {
    const m = trailingMean(
      history.current.map(l => l[k] ?? 0),
      history.prior.map(l => l[k] ?? 0),
    );
    if (m !== null) out[k] = m;
  }
  return out;
}

/** mu_L and sigma_L: trailing mean and sd of actual DEF points in this league's scoring. */
export function trailingActualMoments(
  history: DefenceHistory,
  scoring: Record<string, number>,
): { mean: number; sd: number } | null {
  const current = history.current.map(l => scoreStatLine(l, scoring));
  const prior = history.prior.map(l => scoreStatLine(l, scoring));
  const mean = trailingMean(current, prior);
  const second = trailingMean(current.map(v => v * v), prior.map(v => v * v));
  if (mean === null || second === null) return null;
  return { mean, sd: Math.sqrt(Math.max(1e-6, second - mean * mean)) };
}

/** A DEF projection row repaired and scored for the model: x. */
export function defenceProjectedPoints(
  rawProjection: Record<string, number>,
  model: Pick<DefenceModel, 'scoring' | 'statMeans'>,
): number {
  return scoreStatLine(normalizeDefenceProjection(rawProjection, model.statMeans), model.scoring);
}

/**
 * Builds the model for one league-week, or null when the trailing history is too thin or the
 * week has no DEF projections. Callers fall back to the repaired projection on the position shape.
 *
 * `projections` is the whole week's projection map (every player); its team-defence rows are the
 * slate.
 */
export function buildDefenceModel(args: {
  scoring: Record<string, number>;
  projections: Record<string, Record<string, number>>;
  history: DefenceHistory;
}): DefenceModel | null {
  const { scoring, projections, history } = args;
  const sampleSize = trailingSampleSize(history);
  if (sampleSize < MIN_TRAILING_TEAM_GAMES) return null;

  const actual = trailingActualMoments(history, scoring);
  if (!actual) return null;

  const slate = Object.values(projections).filter(isDefenceRow);
  if (slate.length === 0) return null;

  const statMeans = trailingStatMeans(history);
  const xs = slate.map(row => defenceProjectedPoints(row, { scoring, statMeans }));
  const slateMean = xs.reduce((s, v) => s + v, 0) / xs.length;
  const rawSlateMean = slate.reduce((s, row) => s + scoreStatLine(row, scoring), 0) / slate.length;

  const identityRows = slate.filter(
    r => typeof r.def_pr_yd === 'number'
      && Math.abs(r.def_pr_yd - ((r.pr_yd ?? 0) + (r.def_kr_yd ?? 0))) <= 0.02,
  ).length;

  const level = slateMean - actual.mean;
  return {
    scoring,
    actualMean: actual.mean,
    actualSd: actual.sd,
    slateMean,
    sampleSize,
    statMeans,
    guard: {
      level,
      rawLevel: rawSlateMean - actual.mean,
      fired: Math.abs(level) > DEF_LEVEL_GUARD_POINTS,
      identityRows,
      slateRows: slate.length,
    },
  };
}

/** Full-game mean and variance of a DEF projected at `projectedPoints` (x, from the model). */
export function defenceMoments(
  projectedPoints: number,
  model: Pick<DefenceModel, 'actualMean' | 'actualSd' | 'slateMean'>,
): { mean: number; variance: number } {
  const sd = DEF_SD_FACTOR * model.actualSd;
  return {
    mean: model.actualMean + DEF_CENTRED_SLOPE * (projectedPoints - model.slateMean),
    variance: sd * sd,
  };
}

/** The fields a lineup candidate needs for `applyDefenceModel`. */
export type DefenceStarterFields = {
  playerId: string;
  position: string | null;
  gameState: 'pre' | 'in' | 'post' | 'unknown';
  remainingMinutes: number;
  projectedPoints: number;
  meanAdjustment?: number;
  extraVariance?: number;
  moments?: { mean: number; variance: number };
};

/**
 * Prices one lineup candidate's defence: the league-relative model, then the live points-allowed
 * bracket correction on top. Every candidate builder calls this — betting pricing, the matchup
 * markets, and the This Week no-opponent lineups — which is what keeps them in agreement.
 *
 * Not a DEF: returned untouched. No model (history unavailable): the repaired projection already
 * on the candidate stands and liveOdds' position shape prices it; only the bracket correction is
 * applied, exactly as before.
 *
 * In a live game the bracket is handled by `defenceCorrection` (the credited bracket is replaced
 * by the one the game is heading for). The model's full-game mean and variance include a bracket,
 * so the projected one — the expectation the live model starts from at kickoff — comes out of
 * both. That keeps the price continuous across the kickoff whistle.
 */
export function applyDefenceModel<C extends DefenceStarterFields>(
  candidate: C,
  model: DefenceModel | null,
  scoring: Record<string, number>,
  liveStats: Record<string, number> | undefined,
  rawProjection: Record<string, number> | undefined,
): { candidate: C; note: DefenceCorrection['note'] | null } {
  if (candidate.position !== 'DEF') return { candidate, note: null };

  let next: C = candidate;
  if (model && isDefenceRow(rawProjection)) {
    const x = defenceProjectedPoints(rawProjection!, model);
    next = { ...next, projectedPoints: x, moments: defenceMoments(x, model) };
  }

  const fix = defenceCorrection(next, scoring, liveStats, rawProjection);
  if (!fix) return { candidate: next, note: null };

  return {
    candidate: {
      ...next,
      // actualPoints is left ALONE: Sleeper has genuinely credited those points, so the live score
      // must match Sleeper's to the cent. The correction is a claim about the FINAL score.
      meanAdjustment: (next.meanAdjustment ?? 0) + fix.meanAdjustment,
      projectedPoints: next.projectedPoints - fix.projectedBracket,
      extraVariance: (next.extraVariance ?? 0) + fix.variance,
      ...(next.moments
        ? {
            moments: {
              mean: next.moments.mean - fix.projectedBracket,
              variance: Math.max(MIN_VARIANCE, next.moments.variance - fix.projectedBracketVariance),
            },
          }
        : {}),
    },
    note: fix.note,
  };
}
