import { getDb } from '@/lib/db';

/**
 * Leagues whose members may bet. Single source of truth — adding a league is
 * one entry here plus a re-run of scripts/seed_betting_accounts.mjs.
 */
export const BETTING_LEAGUES = [
  { leagueId: '1383248044669046784', season: '2026', label: "Graham's Football Fantasy" },
] as const;

export type BettingLeague = typeof BETTING_LEAGUES[number];

export function isBettingLeague(leagueId: string): boolean {
  return BETTING_LEAGUES.some(l => l.leagueId === leagueId);
}

export function findBettingLeague(leagueId: string): BettingLeague | undefined {
  return BETTING_LEAGUES.find(l => l.leagueId === leagueId);
}

/**
 * Whether an account is a member of a league it's trying to bet in.
 *
 * A manager who leaves the league loses this row but keeps their account and
 * balance, so they can still sign in and read their history.
 */
export function accountCanBetInLeague(accountId: string, leagueId: string): boolean {
  if (!isBettingLeague(leagueId)) return false;
  const row = getDb()
    .prepare('SELECT 1 AS ok FROM account_leagues WHERE account_id = ? AND league_id = ?')
    .get(accountId, leagueId) as { ok: number } | undefined;
  return row !== undefined;
}
