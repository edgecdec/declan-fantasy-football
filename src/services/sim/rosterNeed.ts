/**
 * Which positions can still enter your STARTING lineup, given what you have already drafted.
 *
 * WHY THIS MATTERS FOR THE ODDS PANEL. The candidate list offers the top few at every
 * position, so in a 1-QB league it kept offering a second and third QB after Lamar Jackson was
 * already rostered. Those are not peers of a startable TE, but the odds put them side by side:
 * measured at pick 65 in Graham's 2026 draft, Jalen Hurts ranked 5th of 38 on season
 * points-for, ahead of a startable RB.
 *
 * That ranking is not a simulation error -- it is QB-slot insurance being priced correctly.
 * fillLineup() picks the best eligible player for each slot every week, so when the starter's
 * weekly projection dips (bye week, or simply a bad one) the backup fills the QB slot instead
 * of it scoring zero. Worth ~6-10 points across a season here, which is ~0.5% of a ~1660-point
 * total and therefore inside the noise floor. Real: the QB2 candidates separate cleanly by
 * quality (Hurts 1661 down to Dak Prescott 1652), which could not happen if the backup never
 * started.
 *
 * So the fix is presentational, not numerical: a player who cannot crack the starting lineup is
 * labelled as bench depth and kept out of the default view, rather than being silently ranked
 * against players who will start every week.
 */

const FLEX_ELIGIBLE: Record<string, string[]> = {
  FLEX: ["RB", "WR", "TE"], WRRBTE_FLEX: ["RB", "WR", "TE"],
  REC_FLEX: ["WR", "TE"], WRRB_FLEX: ["RB", "WR"], SUPER_FLEX: ["QB"],
};

export type RosterNeed = {
  /** position -> how many more of them could still take a STARTING slot */
  openStarters: Record<string, number>;
  /** position -> how many you already have */
  have: Record<string, number>;
  /** starting slots still unfilled, e.g. ["K", "DEF", "FLEX", "FLEX"] */
  openSlots: string[];
};

/**
 * Greedily seat what you own into the starting slots, in the slot order the league lists them,
 * then report what is left. Dedicated slots are filled before FLEX because `slots` is ordered
 * that way, which matches how Sleeper presents a lineup.
 *
 * Deliberately ignores who is better than whom -- the question is only "can another player at
 * this position still start", so a count is enough.
 */
export function rosterNeed(slots: string[], myPositions: string[]): RosterNeed {
  const pool: Record<string, number> = {};
  for (const p of myPositions) pool[p] = (pool[p] ?? 0) + 1;
  const have = { ...pool };
  const openSlots: string[] = [];

  for (const slot of slots) {
    const elig = FLEX_ELIGIBLE[slot] ?? [slot];
    // For a FLEX, spend whichever eligible position you have most of, so a single RB is not
    // consumed by FLEX while the dedicated RB slot goes begging. Dedicated slots come first in
    // `slots`, so by the time a FLEX is reached the required ones are already covered.
    let pick = "";
    for (const p of elig) if ((pool[p] ?? 0) > 0 && (pool[p] ?? 0) > (pool[pick] ?? 0)) pick = p;
    if (pick) pool[pick] -= 1;
    else openSlots.push(slot);
  }

  const openStarters: Record<string, number> = {};
  for (const slot of openSlots) {
    for (const p of FLEX_ELIGIBLE[slot] ?? [slot]) {
      openStarters[p] = (openStarters[p] ?? 0) + 1;
    }
  }
  return { openStarters, have, openSlots };
}

/** True when another player at `pos` cannot reach your starting lineup -- bench depth only. */
export function isBenchOnly(need: RosterNeed, pos: string): boolean {
  return (need.openStarters[pos] ?? 0) === 0;
}
