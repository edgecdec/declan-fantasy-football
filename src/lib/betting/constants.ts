/**
 * Money constants and formatting for Declan Dollars.
 *
 * Kept free of any server-only import (no db, no better-sqlite3) so client
 * components can use it — importing accounts.ts from the browser would drag the
 * native SQLite binary into the client bundle.
 */

/** Stored as integer cents; floats drift when summed over a long ledger. */
export const START_BALANCE_CENTS = 100_000; // $1,000

/** While a balance is negative, total unsettled stake may not exceed this. */
export const NEGATIVE_OPEN_EXPOSURE_CAP_CENTS = 10_000; // $100

export const CENTS_PER_DOLLAR = 100;

/** e.g. 100000 -> "$1,000.00"; -42050 -> "-$420.50" */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = (abs / CENTS_PER_DOLLAR).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}$${dollars}`;
}

/** Human label for a ledger row's `reason`. */
export const LEDGER_REASON_LABELS: Record<string, string> = {
  initial_grant: 'Opening balance',
  wager_place: 'Bet placed',
  wager_win: 'Bet won',
  wager_void: 'Bet voided',
  adjustment: 'Adjustment',
};
