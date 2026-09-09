/**
 * Scoring an individual play in a league's own settings.
 *
 * Sleeper's GraphQL `plays` query returns, per play, a stat delta per player
 * (`{rec: 1, rec_td: 1, rec_yd: 27}`). Those primitives reconcile EXACTLY with Sleeper's
 * official weekly stats — verified across all 2,978 plays of a completed week.
 *
 * What they do NOT include is the league bonuses, because Sleeper only reports those as
 * game-level aggregates. That absence is the entire discrepancy between summed plays and
 * official totals: for one league it came to 0.5 per first down, and it explained the gap on
 * every player checked. So the bonuses have to be derived here, and they come in two kinds
 * that behave completely differently per play:
 *
 *   per-event   fires every time the thing happens — a reception, a first down
 *   milestone   fires once, when a cumulative total crosses a line (100 rush yards)
 *
 * A milestone therefore cannot be scored from the play alone. It needs the player's totals
 * BEFORE the play, so we can ask whether this play is the one that crossed the line. Getting
 * that wrong in the obvious way — scoring the bonus on every play once the total is past the
 * threshold — would award it repeatedly for the rest of the game.
 *
 * SCOPE, measured rather than assumed. Replaying every play of a completed week and comparing
 * against Sleeper's official stats:
 *
 *   QB / RB / WR / TE / K     exact to the cent, 0.00 difference, every player
 *   team DEF                  NOT derivable from plays at all
 *
 * The play feed is offence-only. Across all 2,978 plays of that week it carried ONE sack and
 * ZERO interceptions league-wide, while one defence alone officially recorded four sacks and
 * two interceptions. Team entries carry only series-level stats (`def_3_and_out`,
 * `def_forced_punts`). Defensive scoring has to come from the periodic stats feed instead —
 * which it would anyway, since `pts_allow_*` and `yds_allow_*` are game-level brackets that
 * only have a value relative to the current score, not per play.
 *
 * Two-point conversions needed a translation step rather than being a genuine gap — see
 * `normalisePlayStats`. With that in place every offensive player reconciles to the cent.
 */

/** A stat delta or cumulative total, keyed by Sleeper's stat names. */
export type StatLine = Record<string, number>;

/** Positions Sleeper suffixes its per-position bonuses with. */
const BONUS_POSITIONS = ['qb', 'rb', 'wr', 'te'] as const;

/**
 * Bonuses that fire once per occurrence, and which primitive counts them.
 *
 * `bonus_fd_qb` counts passing first downs as well as rushing ones, which is why the source
 * list differs by position rather than being one rule.
 */
const PER_EVENT_SOURCES: Record<string, string[]> = {
  qb: ['pass_fd', 'rush_fd'],
  rb: ['rush_fd', 'rec_fd'],
  wr: ['rush_fd', 'rec_fd'],
  te: ['rush_fd', 'rec_fd'],
};

/**
 * Bonuses that fire once when a cumulative total crosses a threshold.
 *
 * Each is an independent 0-or-1 flag rather than a repeating step: a 200-yard game earns
 * both `bonus_rush_yd_100` and `bonus_rush_yd_200`, not two hundreds.
 */
const MILESTONES: { key: string; stats: string[]; threshold: number }[] = [
  { key: 'bonus_pass_yd_300', stats: ['pass_yd'], threshold: 300 },
  { key: 'bonus_pass_yd_400', stats: ['pass_yd'], threshold: 400 },
  { key: 'bonus_pass_cmp_25', stats: ['pass_cmp'], threshold: 25 },
  { key: 'bonus_rush_yd_100', stats: ['rush_yd'], threshold: 100 },
  { key: 'bonus_rush_yd_200', stats: ['rush_yd'], threshold: 200 },
  { key: 'bonus_rush_att_20', stats: ['rush_att'], threshold: 20 },
  { key: 'bonus_rec_yd_100', stats: ['rec_yd'], threshold: 100 },
  { key: 'bonus_rec_yd_200', stats: ['rec_yd'], threshold: 200 },
  { key: 'bonus_rush_rec_yd_100', stats: ['rush_yd', 'rec_yd'], threshold: 100 },
  { key: 'bonus_rush_rec_yd_200', stats: ['rush_yd', 'rec_yd'], threshold: 200 },
];

/**
 * The play feed names two-point conversions differently from the scoring settings.
 *
 * A successful 2pt arrives as `{conv_cmp: 1, conv_pass_att: 1}` on the passer and
 * `{conv_cmp: 1, conv_rec_att: 1}` on the receiver, while a league prices `pass_2pt` and
 * `rec_2pt`. Without translating, a converted two-pointer scores nothing — it was the only
 * non-defensive discrepancy in a full-week replay, costing four players exactly 2.00 each.
 *
 * `conv_cmp` is the success flag; an unconverted attempt carries the `_att` keys without it and
 * correctly scores nothing.
 */
const CONVERSION_KEYS: { attempt: string; scored: string }[] = [
  { attempt: 'conv_pass_att', scored: 'pass_2pt' },
  { attempt: 'conv_rec_att', scored: 'rec_2pt' },
  { attempt: 'conv_rush_att', scored: 'rush_2pt' },
];

/**
 * Rewrites a play delta into the stat names a league's scoring settings use.
 *
 * Kept separate from scoring so the mapping is inspectable and testable on its own, and so any
 * future divergence between the play feed's vocabulary and the settings' has one home.
 */
export function normalisePlayStats(delta: StatLine): StatLine {
  if (!delta.conv_cmp) return delta;
  const out: StatLine = { ...delta };
  for (const { attempt, scored } of CONVERSION_KEYS) {
    if (delta[attempt]) out[scored] = (out[scored] ?? 0) + delta.conv_cmp;
  }
  return out;
}

const sum = (line: StatLine, keys: string[]): number =>
  keys.reduce((t, k) => t + (line[k] ?? 0), 0);

/** Adds a delta onto a running total, returning a new line. */
export function addStats(total: StatLine, delta: StatLine): StatLine {
  const out: StatLine = { ...total };
  for (const [k, v] of Object.entries(delta)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

/**
 * The bonus stats a player earns ON this play.
 *
 * `before` is their cumulative total prior to the play; `delta` is the play itself. Returns
 * only what was earned now, so the caller can score it like any other stat line.
 */
export function derivedBonusStats(
  position: string | null,
  before: StatLine,
  delta: StatLine,
): StatLine {
  const earned: StatLine = {};
  const pos = (position ?? '').toLowerCase();

  if ((BONUS_POSITIONS as readonly string[]).includes(pos)) {
    const receptions = delta.rec ?? 0;
    if (receptions > 0) earned[`bonus_rec_${pos}`] = receptions;

    const firstDowns = sum(delta, PER_EVENT_SOURCES[pos] ?? []);
    if (firstDowns > 0) earned[`bonus_fd_${pos}`] = firstDowns;
  }

  const after = addStats(before, delta);
  for (const m of MILESTONES) {
    // Only the crossing counts. Comparing the flag before and after is what stops the bonus
    // being re-awarded on every subsequent play of the game.
    const wasPast = sum(before, m.stats) >= m.threshold ? 1 : 0;
    const isPast = sum(after, m.stats) >= m.threshold ? 1 : 0;
    if (isPast > wasPast) earned[m.key] = 1;
  }

  return earned;
}

/** Points for a stat line under a league's scoring settings. */
export function scoreStatLine(line: StatLine, scoring: Record<string, number>): number {
  let total = 0;
  for (const [k, v] of Object.entries(line)) {
    const mult = scoring[k];
    if (mult != null && typeof v === 'number' && Number.isFinite(v)) total += v * mult;
  }
  return total;
}

export type ScoredPlay = {
  /** Points from the play's own stats. */
  base: number;
  /** Points from bonuses this play triggered. */
  bonus: number;
  /** What the player actually gained on this play. */
  total: number;
  /** The bonus stats earned, for explaining the number. */
  bonusStats: StatLine;
};

/**
 * Scores one player's contribution to one play.
 *
 * Rounded to two decimals because that is the precision Sleeper reports and settles on, and
 * because summing unrounded floats across a game drifts visibly by the fourth quarter.
 */
export function scorePlayForPlayer(
  rawDelta: StatLine,
  before: StatLine,
  position: string | null,
  scoring: Record<string, number>,
): ScoredPlay {
  const delta = normalisePlayStats(rawDelta);
  const bonusStats = derivedBonusStats(position, before, delta);
  const base = scoreStatLine(delta, scoring);
  const bonus = scoreStatLine(bonusStats, scoring);
  const round = (n: number) => Math.round(n * 100) / 100;
  return { base: round(base), bonus: round(bonus), total: round(base + bonus), bonusStats };
}
