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

/**
 * Leagues whose members may bet. Single source of truth — adding a league is one entry here plus a
 * re-run of scripts/seed_betting_accounts.mjs.
 *
 * Lives in constants.ts, which imports nothing server-only, because the betting dashboard is a
 * client component and needs the labels. It used to sit in leagues.ts alongside the membership
 * queries — importing that from the client pulled better-sqlite3 into the browser bundle and the
 * build failed on `Can't resolve 'fs'`.
 *
 * Each league carries its OWN bankroll (account_leagues.balance_cents), so adding one does not
 * dilute an existing balance and a loss in one cannot restrict staking in another. Scoring settings
 * differ between them and that is fine — every market is priced with its own league's settings.
 *
 * Note there are two Silverback leagues in this user's account, a redraft and a dynasty. This is
 * the redraft one; the dynasty (1387602471991414784) is deliberately not enabled.
 */
export const BETTING_LEAGUES = [
  { leagueId: '1383248044669046784', season: '2026', label: "Graham's Football Fantasy" },
  { leagueId: '1387607608562565120', season: '2026', label: 'Silverback League' },
] as const;

export type BettingLeague = typeof BETTING_LEAGUES[number];
