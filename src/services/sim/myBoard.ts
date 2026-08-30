/**
 * The board YOUR seat drafts from: the selected ranking set's order, plus an identity for it.
 *
 * A ranking set contributes exactly one thing -- the ORDER you take players in. It does not
 * contribute value. Value comes from the artifact's ADP-priced ex-ante board, and positional
 * scarcity is already applied on top of your order by the engine:
 *
 *     buildSheets:  mktFor(yourRank) * (1 + VORP_TILT * vorp[i] / 120)
 *
 * where `vorp = max(board - repl[pos], 0)` and `repl` is this league's replacement level per
 * position, computed by `greedy_repl` in scripts/bot_league.py with the real FLEX allocation
 * (RB 24 / WR 36 / TE 10 for a 10-team 2-FLEX league) and shipped in the artifact. So the
 * scarcity adjustment is already there, in the league's own currency.
 *
 * TWO THINGS DELIBERATELY NOT DONE HERE, both tried and rejected:
 *
 * 1. **Do not re-rank by the set's projected_points minus a replacement level.** It computes
 *    a second scarcity adjustment on top of the engine's, and it prices players in a
 *    projection currency this repo does not trust for valuation (Sleeper's season projections
 *    are look-ahead-contaminated for past seasons, so nothing can validate them). Measured on
 *    Graham's 10-team league it also produced a board with exactly 10 K and 10 DEF inside the
 *    top 100 and the first kicker at pick 38 -- naive points-over-replacement rates the top
 *    kicker's ~14-point surplus alongside a WR3's, when we measured a kicker at pick 5 costing
 *    13-15pp of playoff odds. The engine avoids this by making market rank the base and VORP a
 *    weak tilt; see the `build_sheets` docstring, which rejected pure VORP for putting elite
 *    QBs at 1.01.
 * 2. **Do not apply your board to the other managers.** They draft consensus ADP, which is
 *    what makes the availability column mean anything.
 */
import { hashSeed } from "./engine";

export type MyBoard = {
  /** denseIndex -> 1-based rank on your board; 0 = not on it */
  rank: Int32Array;
  matched: number;
  /** identity of this board, so selecting a different set re-triggers simulation */
  fingerprint: string;
};

/** Minimum rows that must match the artifact before a set is usable as a board. Below this
 *  it would leave most of the pool unranked and your seat would draft near-randomly. */
const MIN_MATCHED = 50;

export function buildMyBoard(
  players: { player_id: string }[],
  idx: Map<string, number> | null,
  size: number,
): MyBoard | null {
  if (!idx || !players.length || !size) return null;
  const rank = new Int32Array(size);
  const matchedIds: string[] = [];
  let r = 0;
  for (const p of players) {
    const i = idx.get(p.player_id);
    if (i === undefined) continue;
    rank[i] = ++r;
    if (matchedIds.length < 250) matchedIds.push(p.player_id);
  }
  if (r < MIN_MATCHED) return null;
  return { rank, matched: r, fingerprint: fingerprintOf(matchedIds, r) };
}

/**
 * Identity of a board, used as part of the simulation seed.
 *
 * This exists because the seed previously recorded only WHETHER a board was active
 * (`rankOverride ? "ranked" : "adp"`). Switching between two different uploaded sets left the
 * seed unchanged, so the effect keyed on it never re-fired and the odds silently stayed on the
 * previous board's results. Hashing the matched ids in order makes any reordering a new seed.
 */
export function fingerprintOf(orderedIds: string[], matched: number): string {
  return `b${matched}-${hashSeed(orderedIds.join(",")).toString(36)}`;
}
