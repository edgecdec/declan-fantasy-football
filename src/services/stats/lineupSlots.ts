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
