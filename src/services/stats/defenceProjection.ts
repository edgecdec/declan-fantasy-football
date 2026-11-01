import {
  PTS_ALLOW_BRACKETS,
  PTS_ALLOW_SD,
  YDS_ALLOW_BRACKETS,
  YDS_ALLOW_SD,
  bracketProbabilities,
} from '@/services/betting/defenseBrackets';

/**
 * Repairs a Sleeper team-defence projection row before it is scored.
 *
 * THE BUG. Sleeper's projected `def_pr_yd` is punt-return yards PLUS kick-return yards:
 * `def_pr_yd == pr_yd + def_kr_yd` (to the cent) in every DEF projection row from 2018 to 2026 —
 * 4,450 of 4,450. Actual DEF stats use `def_pr_yd` for punts only (about 16 yards a game). So any
 * league scoring DEF return yards counts kick returns twice in the projection, and in 2026, when
 * the kick-return projection caught up with the 2025 kickoff rule, that phantom doubled: +4.68 pts
 * per defence per week in Graham's, +11.70 in the Guillotine league.
 *
 * The same rows also carry individual-player keys that actual DEF rows never have — `pr_yd` (punt
 * yards a second time, in 26 league-seasons that score it) and `pass_int_td` (three leagues charge
 * a defence -6 or -1 for its OWN projected pick-six) — and project special-teams TDs as `st_td`
 * where actuals use `def_st_td`.
 *
 * Study (every number above, backtests, and why this alone is not enough):
 * SessionSwarm/runs/2026-10-13_180705/work/ff-def-projections/REPORT.md.
 *
 * NOT ENOUGH ON ITS OWN for pricing: the old DEF outcome shape was fitted on inflated projections
 * and under-predicts once they are corrected. The pricing paths pair this with the league-relative
 * model in services/betting/defenceModel.ts. This function is only the field repair.
 */

/**
 * Keys an actual DEF stat line never carries. `def_pr_td` / `def_kr_td` are the components of the
 * projected `st_td`, so keeping them would count a return TD twice in a league scoring both.
 */
const OFFENCE_KEYS_ON_DEF_ROW = ['pr_yd', 'pr_td', 'pass_int_td', 'def_pr_td', 'def_kr_td'] as const;

/**
 * True for a team-defence projection row.
 *
 * Keyed on points / yards allowed, which only team defences carry. NOT on `def_kr_yd` or
 * `def_pr_yd`: Sleeper puts those on ~300 individual returners' rows too (a WR projected 5.65
 * `def_kr_yd`), and those rows are not team defences.
 */
export function isDefenceRow(row: Record<string, number> | undefined): boolean {
  return !!row && (typeof row.pts_allow === 'number' || typeof row.yds_allow === 'number');
}

/** Bracket keys, so they can be dropped and replaced as a set. */
const BRACKET_KEYS = new Set([...PTS_ALLOW_BRACKETS, ...YDS_ALLOW_BRACKETS].map(b => b.key));

/**
 * League-wide trailing means of actual DEF stats, per team-game. When supplied, stats a DEF
 * projection has no signal for are replaced by them — see `normalizeDefenceProjection`.
 */
export type DefenceStatMeans = Record<string, number>;

/** Never filled from trailing means: projected per team, or bracket flags handled separately. */
const NEVER_FILLED = new Set(['def_pr_yd', 'def_kr_yd', 'pts_allow', 'yds_allow']);

/**
 * The repaired row. Pure; returns a new object.
 *
 *  1. `def_pr_yd := pr_yd` — the real punt-return projection, which tracks actuals (15.9 vs 16.0 a
 *     game in 2026). When Sleeper fixes its feed and drops `pr_yd`, `def_pr_yd` is left alone.
 *  2. Drop the offence-only keys; `st_td -> def_st_td`.
 *  3. Replace the single projected bracket flag with bracket PROBABILITIES from
 *     N(pts_allow, 9.66) and N(yds_allow, 83.5). A flag at the projected mean is a plug-in, not an
 *     expectation, and it is exactly what the live bracket model starts from at kickoff.
 *  4. With `trailing`: `def_kr_yd` becomes the league-wide trailing rate (team-level KR projections
 *     have r ~ 0 with actuals every season, and lag kickoff-rule changes by a season), and stats
 *     Sleeper never projects but leagues score (`def_4_and_stop`, `def_st_ff`, `def_st_fum_rec`,
 *     `def_2pt`, ...) are added at their trailing rates.
 */
export function normalizeDefenceProjection(
  raw: Record<string, number>,
  trailing?: DefenceStatMeans | null,
): Record<string, number> {
  const row: Record<string, number> = { ...raw };

  if (typeof raw.pr_yd === 'number') row.def_pr_yd = raw.pr_yd;
  for (const k of OFFENCE_KEYS_ON_DEF_ROW) delete row[k];
  if (typeof row.st_td === 'number') {
    row.def_st_td = row.st_td;
    delete row.st_td;
  }

  if (typeof raw.pts_allow === 'number') {
    for (const b of PTS_ALLOW_BRACKETS) delete row[b.key];
    Object.assign(row, bracketProbabilities(PTS_ALLOW_BRACKETS, raw.pts_allow, PTS_ALLOW_SD, true));
  }
  if (typeof raw.yds_allow === 'number') {
    for (const b of YDS_ALLOW_BRACKETS) delete row[b.key];
    Object.assign(row, bracketProbabilities(YDS_ALLOW_BRACKETS, raw.yds_allow, YDS_ALLOW_SD, false));
  }

  if (trailing) {
    if (typeof trailing.def_kr_yd === 'number') row.def_kr_yd = trailing.def_kr_yd;
    for (const [k, v] of Object.entries(trailing)) {
      if (k in row || NEVER_FILLED.has(k) || BRACKET_KEYS.has(k)) continue;
      row[k] = v;
    }
  }
  return row;
}
