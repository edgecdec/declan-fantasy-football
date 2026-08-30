/**
 * Who actually owns each pick, once draft-pick trades are taken into account.
 *
 * WHY THIS IS NOT OPTIONAL. Without it the simulation assumes a pure snake, which gets both
 * the past and the future wrong whenever a pick has been traded:
 *   * PAST -- already-made picks are replayed by overall pick number, and each one is credited
 *     to whichever seat the snake says owns it. In Graham's 2026 draft, picks 25 and 26 were
 *     swapped between slot 5 and slot 6, so the snake credited Brock Bowers to slot 5 and
 *     George Pickens to slot 6 when the reverse happened. Two rosters were wrong from round 3
 *     onward, one of them the user's.
 *   * FUTURE -- the remaining draft is simulated on the same order, so a seat that traded away
 *     a round 8 pick keeps getting one, and the seat that acquired it never does.
 *
 * Sleeper's model: `GET /draft/<id>/traded_picks` returns `{round, roster_id, owner_id,
 * previous_owner_id}` where **all three ids are ROSTER ids, not user ids**, and `roster_id` is
 * the pick's ORIGINAL owner -- i.e. the roster whose draft slot the pick physically sits in.
 * So a pick is located by (round, slot-of-original-roster) and reassigned to
 * slot-of-current-owner. `slot_to_roster_id` maps 1-indexed slot -> roster id and is only
 * present on the full draft object, not on the league's draft list.
 */
import { SleeperTradedPick } from "@/services/sleeper/sleeperService";

/** 0-based seat index for a roster, or -1. `slot_to_roster_id` is keyed by 1-indexed slot. */
export function seatOfRoster(
  rosterId: number,
  slotToRosterId: Record<string, number> | null | undefined,
): number {
  if (!slotToRosterId) return -1;
  for (const [slot, rid] of Object.entries(slotToRosterId)) {
    if (rid === rosterId) return Number(slot) - 1;
  }
  return -1;
}

/** Overall pick number for a (round, 0-based seat) under snake rules. */
export function overallPick(round: number, seat: number, teams: number,
                            reversalRound = 0): number {
  let fwd = round % 2 === 1;
  if (reversalRound && round >= reversalRound) fwd = !fwd;
  const k = fwd ? seat : teams - 1 - seat;
  return (round - 1) * teams + k + 1;
}

/**
 * overallPick -> 0-based seat that owns it, for every traded pick. Picks absent from the map
 * follow the plain snake.
 *
 * Chains resolve correctly without extra work: Sleeper reports only the CURRENT owner per
 * (round, original roster), so a pick traded twice appears once with its final owner.
 */
export function buildSwaps(
  tradedPicks: SleeperTradedPick[] | null | undefined,
  slotToRosterId: Record<string, number> | null | undefined,
  teams: number,
  rounds: number,
  reversalRound = 0,
): Map<number, number> {
  const swaps = new Map<number, number>();
  if (!tradedPicks?.length || !slotToRosterId || !teams) return swaps;
  for (const tp of tradedPicks) {
    if (tp.round < 1 || tp.round > rounds) continue;      // a future-season pick
    const fromSeat = seatOfRoster(tp.roster_id, slotToRosterId);
    const toSeat = seatOfRoster(tp.owner_id, slotToRosterId);
    if (fromSeat < 0 || toSeat < 0 || fromSeat === toSeat) continue;
    swaps.set(overallPick(tp.round, fromSeat, teams, reversalRound), toSeat);
  }
  return swaps;
}

/** Stable string for the seed, so executing a trade mid-draft re-simulates. */
export function swapsFingerprint(swaps: Map<number, number>): string {
  if (!swaps.size) return "";
  return [...swaps.entries()].sort((a, b) => a[0] - b[0])
    .map(([ov, t]) => `${ov}>${t}`).join(",");
}
