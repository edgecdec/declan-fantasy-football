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
 * Two-point conversions and return touchdowns need translation rather than being genuine gaps —
 * see `normalisePlayStats`.
 *
 * KNOWN UPSTREAM INCONSISTENCIES, measured across 6 weeks x 18 leagues (~2,280 player-weeks).
 * About 0.4% of player-weeks disagree with Sleeper's official stats by a point or two, and every
 * remaining case is an inconsistency inside Sleeper's own data rather than something derivable:
 *
 *  - Position disagreement. Sleeper's player database lists Connor Heyward as `position: RB` with
 *    `fantasy_positions: ['RB']`, while its stats engine awards him `bonus_fd_te`. Nothing
 *    available to us predicts that, and it is worth at most the difference between the two
 *    bonus rates. Taysom Hill has the same QB/TE ambiguity.
 *  - The feed occasionally emits a negative count, e.g. `fum: -1` where official says 0.
 *  - `pass_int_td` is credited to the intercepted quarterback in the feed but not officially.
 *  - `st_ff` (special-teams forced fumble) is absent from the feed.
 *  - A couple of return touchdowns credit the returner in the feed where official does not,
 *    presumably a lateral or a score by another player on the return.
 *
 * These are deliberately NOT special-cased. Each fix would be a guess about Sleeper's internals
 * that could as easily break a correct case, and the live design reconciles against the
 * authoritative stats feed anyway — which is what corrects them.
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
 * What a play was, for the handful of stats that cannot be read off the delta alone.
 */
export type PlayContext = {
  /** Sleeper's play_type, e.g. `rush`, `pass_complete`, `kickoff`, `punt`. */
  playType?: string | null;
  /** Sleeper's is_scoring_play flag. */
  isScoringPlay?: boolean;
  /** Sleeper's play description. Needed to tell a return TD from any other scoring kick play. */
  description?: string | null;
};

/** Play types on which a returner can score. */
const RETURN_PLAY_TYPES = new Set(['kickoff', 'punt']);

/**
 * Rewrites a play delta into the stat names a league's scoring settings use.
 *
 * Kept separate from scoring so the mapping is inspectable and testable on its own, and so any
 * future divergence between the play feed's vocabulary and the settings' has one home.
 *
 * Two translations live here, both found by reconciling real weeks:
 *
 *  - two-point conversions arrive as `conv_cmp` + `conv_*_att`, priced as `*_2pt`
 *  - a return TOUCHDOWN carries no `st_td` at all. The play says what happened — a scoring
 *    kickoff or punt where this player has `kr`/`pr` — but the six points are only in Sleeper's
 *    game-level stats. That cost one receiver exactly 6.00 in a week where everything else in
 *    18 leagues reconciled to the cent, which is how it was found. Detection verified against
 *    every return TD in five weeks: week 14 had three officially and all three were identified.
 */
export function normalisePlayStats(delta: StatLine, context: PlayContext = {}): StatLine {
  /*
   * A return touchdown, only when the feed has not already said so.
   *
   * The feed is INCONSISTENT about this, which is the whole trap: one week had three return
   * touchdowns, two of which arrived with `st_td: 1` already in the delta and one of which did
   * not. Deriving unconditionally double-counts the first kind; not deriving at all under-counts
   * the second. So this fills the gap rather than adding to it.
   *
   * The description must say TOUCHDOWN. `is_scoring_play` alone is too broad — the kickoff
   * FOLLOWING a score carries that flag too.
   */
  const isReturnTd = Boolean(
    !delta.st_td
    && RETURN_PLAY_TYPES.has((context.playType ?? '').toLowerCase())
    && /touchdown/i.test(context.description ?? '')
    && (delta.kr || delta.pr),
  );
  if (!delta.conv_cmp && !isReturnTd) return delta;

  const out: StatLine = { ...delta };
  if (delta.conv_cmp) {
    for (const { attempt, scored } of CONVERSION_KEYS) {
      if (delta[attempt]) out[scored] = (out[scored] ?? 0) + delta.conv_cmp;
    }
  }
  if (isReturnTd) out.st_td = (out.st_td ?? 0) + 1;
  return out;
}

/**
 * Stat keys the play feed reports but that must NOT be scored from plays.
 *
 * The play feed's defensive data disagrees with Sleeper's official stats in both directions and
 * cannot be trusted:
 *
 *  - it UNDER-reports the real defensive events (one full week carried 1 sack and 0
 *    interceptions league-wide, against a single defence officially recording 4 and 2)
 *  - it OVER-attributes IDP stats to offensive players (a quarterback with `idp_ff: 2` in the
 *    feed and 0 officially; a receiver credited two solo tackles against an official one)
 *
 * That second half only shows up in a league that actually prices `idp_*`, which is why it
 * survived a single-league check and appeared the moment the reconciliation was run across
 * every league a user is in. In an IDP league it was worth up to 6 points on one quarterback.
 *
 * So defence is sourced from the periodic stats feed, not from plays — the same conclusion team
 * DEF already forced, for the same reason. Prefixes rather than an exact list, because Sleeper
 * has many `idp_*` and `def_*` keys and a new one appearing must not silently start scoring.
 */
const NON_PLAY_STAT_PREFIXES = ['idp_', 'def_', 'tkl_', 'pts_allow', 'yds_allow'] as const;
const NON_PLAY_STAT_KEYS = new Set([
  'sack', 'int', 'ff', 'fum_rec', 'fum_rec_td', 'safe', 'blk_kick', 'tkl', 'tkl_solo', 'tkl_ast',
]);

/** True when a stat must come from the stats feed rather than from a play. */
export function isNonPlayStat(key: string): boolean {
  if (NON_PLAY_STAT_KEYS.has(key)) return true;
  return NON_PLAY_STAT_PREFIXES.some(pre => key.startsWith(pre));
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

/**
 * Points for a stat line under a league's scoring settings.
 *
 * `fromPlay` excludes the defensive and IDP keys the play feed cannot be trusted for. Pass false
 * when scoring an authoritative line from the stats feed, where those keys are correct.
 */
export function scoreStatLine(
  line: StatLine,
  scoring: Record<string, number>,
  fromPlay = false,
): number {
  let total = 0;
  for (const [k, v] of Object.entries(line)) {
    if (fromPlay && isNonPlayStat(k)) continue;
    const mult = scoring[k];
    if (mult != null && typeof v === 'number' && Number.isFinite(v)) total += v * mult;
  }
  return total;
}

export type ScoredPlay = {
  /** Points from the play's own stats. Unrounded — see below. */
  base: number;
  /** Points from bonuses this play triggered. Unrounded. */
  bonus: number;
  /** What the player gained on this play. Unrounded; round only to display. */
  total: number;
  /** The bonus stats earned, for explaining the number. */
  bonusStats: StatLine;
};

/**
 * Scores one player's contribution to one play.
 *
 * Returns UNROUNDED points, deliberately. Rounding each play to two decimals seems harmless and
 * is not: a league pricing yards at 0.125 produces three decimals on most plays, and the error
 * accumulates over a game — it put one running back 0.08 above his official total across a
 * single week, and every player in that league off by some multiple of 0.02. Sleeper computes
 * from season totals, so matching it means accumulating exactly and rounding only for display.
 */
export function scorePlayForPlayer(
  rawDelta: StatLine,
  before: StatLine,
  position: string | null,
  scoring: Record<string, number>,
  context: PlayContext = {},
): ScoredPlay {
  const delta = normalisePlayStats(rawDelta, context);
  const bonusStats = derivedBonusStats(position, before, delta);
  const base = scoreStatLine(delta, scoring, true);
  const bonus = scoreStatLine(bonusStats, scoring, true);
  return { base, bonus, total: base + bonus, bonusStats };
}

/** Two decimals, for display only. Never feed this back into a running total. */
export function displayPoints(points: number): string {
  return points.toFixed(2);
}
