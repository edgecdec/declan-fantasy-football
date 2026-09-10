/**
 * Roster-slot rules, kept free of any heavy import.
 *
 * Extracted from lineupOptimizer so server-side code can use them. That module
 * imports data/sleeper_players.json at module scope — 22 MB, which is fine in a
 * client bundle that already ships it but not something to parse in the Next
 * server process on a 1.9 GB box.
 */

/** Slots that do not score. */
export const BENCH_SLOTS = new Set(['BN', 'IR', 'TAXI']);

/** Position eligibility per roster slot. */
export const SLOT_ELIGIBILITY: Record<string, string[]> = {
  QB: ['QB'],
  RB: ['RB'],
  WR: ['WR'],
  TE: ['TE'],
  K: ['K'],
  DEF: ['DEF'],
  FLEX: ['RB', 'WR', 'TE'],
  REC_FLEX: ['WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  IDP_FLEX: ['DL', 'LB', 'DB'],
  DL: ['DL'],
  LB: ['LB'],
  DB: ['DB'],
};

/** Fill most-restrictive slots first so elite flex-eligible players aren't wasted. */
export const SLOT_PRIORITY: string[] = [
  'K', 'DEF', 'QB', 'TE', 'RB', 'WR',
  'DL', 'LB', 'DB',
  'REC_FLEX', 'FLEX', 'SUPER_FLEX', 'IDP_FLEX',
];

/**
 * How a roster slot is written for a reader.
 *
 * Sleeper's own names are machine-shaped — `SUPER_FLEX`, `REC_FLEX` — and showing them raw makes a
 * message like "Empty SUPER_FLEX slot" read as a bug. Anything not listed falls back to swapping
 * underscores for spaces, so a slot type Sleeper adds later degrades to something legible rather
 * than to `undefined`.
 */
const SLOT_LABELS: Record<string, string> = {
  QB: 'QB',
  RB: 'RB',
  WR: 'WR',
  TE: 'TE',
  K: 'K',
  DEF: 'DEF',
  FLEX: 'FLEX',
  REC_FLEX: 'REC FLEX',
  WRRB_FLEX: 'WR/RB FLEX',
  SUPER_FLEX: 'SUPERFLEX',
  IDP_FLEX: 'IDP FLEX',
  DL: 'DL',
  LB: 'LB',
  DB: 'DB',
};

export function slotLabel(slot: string): string {
  return SLOT_LABELS[slot] ?? slot.replace(/_/g, ' ');
}

/**
 * The scoring slots of a roster, in the order Sleeper reports starters in.
 *
 * This alignment is the whole point: a roster's `starters` and `starters_points` arrays are
 * positionally aligned to the NON-BENCH entries of `roster_positions`, so index 3 of `starters` is
 * whatever slot index 3 of this list names. Filtering bench slots out is therefore not cosmetic —
 * without it every label after the first bench entry would name the wrong slot.
 */
export function startingSlots(rosterPositions: string[] | null | undefined): string[] {
  return (rosterPositions ?? []).filter(slot => !BENCH_SLOTS.has(slot));
}

/**
 * The label for the starter at `index`, or null when the roster shape cannot explain it.
 *
 * Null rather than a guess: a league whose `roster_positions` is missing or shorter than its
 * starters array would otherwise get a confidently wrong slot name, which is worse than saying
 * nothing.
 */
export function starterSlotLabel(
  rosterPositions: string[] | null | undefined,
  index: number,
): string | null {
  const slots = startingSlots(rosterPositions);
  const slot = slots[index];
  return slot ? slotLabel(slot) : null;
}
