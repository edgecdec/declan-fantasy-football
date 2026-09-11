import { getDb } from '@/lib/db';
import { BETTING_LEAGUES, type BettingLeague } from '@/lib/betting/constants';
import { ensureLeagueGrant } from '@/lib/betting/accounts';

// The list itself lives in constants.ts, which imports nothing server-only, so a client component
// can read the labels without pulling better-sqlite3 into the browser bundle. Re-exported here so
// server-side callers can keep importing it alongside the membership queries.
export { BETTING_LEAGUES } from '@/lib/betting/constants';
export type { BettingLeague };

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

/**
 * Joins an account to any newly-enabled league it is already a member of on Sleeper.
 *
 * Enabling a league used to require re-running the seed script before existing members could see
 * it — so whether someone got access depended on whether that step was remembered. This makes it
 * self-healing: the next time they load the dashboard, the league is simply there.
 *
 * Costs nothing in the steady state. The Sleeper lookup only happens when the account is missing a
 * membership for an enabled league, which after the first successful join is never again.
 *
 * The opening bankroll is granted only for an account that has actually been set up, matching the
 * rule everywhere else: an unclaimed account holding money would appear in the standings as a
 * manager who has never logged in.
 *
 * `fetchMembers` is injected so the join logic can be tested without the network.
 */
export async function syncLeagueMemberships(
  account: { id: string; sleeper_user_id: string; password_hash: string | null },
  fetchMembers: (leagueId: string) => Promise<string[] | null> = fetchSleeperMemberIds,
): Promise<{ leagueId: string; label: string; granted: boolean }[]> {
  const db = getDb();
  const held = new Set(
    (
      db
        .prepare('SELECT league_id FROM account_leagues WHERE account_id = ?')
        .all(account.id) as { league_id: string }[]
    ).map(r => r.league_id),
  );

  const missing = BETTING_LEAGUES.filter(l => !held.has(l.leagueId));
  if (missing.length === 0) return [];

  const joined: { leagueId: string; label: string; granted: boolean }[] = [];
  for (const league of missing) {
    const memberIds = await fetchMembers(league.leagueId);
    // A failed lookup must not be read as "not a member" — that would be indistinguishable from
    // having left, and would quietly deny access until the next successful call.
    if (memberIds === null) continue;
    if (!memberIds.includes(account.sleeper_user_id)) continue;

    db.prepare(
      `INSERT OR IGNORE INTO account_leagues (account_id, league_id, season, balance_cents)
       VALUES (?, ?, ?, 0)`,
    ).run(account.id, league.leagueId, league.season);

    const granted = account.password_hash !== null
      ? ensureLeagueGrant(account.id, league.leagueId)
      : false;
    joined.push({ leagueId: league.leagueId, label: league.label, granted });
  }
  return joined;
}

/** League member Sleeper ids, cached briefly. Null means the lookup failed, not "no members". */
const memberCache = new Map<string, { ids: string[]; at: number }>();
const MEMBER_CACHE_MS = 300_000;

async function fetchSleeperMemberIds(leagueId: string): Promise<string[] | null> {
  const hit = memberCache.get(leagueId);
  if (hit && Date.now() - hit.at < MEMBER_CACHE_MS) return hit.ids;
  try {
    const res = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const users = (await res.json()) as { user_id: string }[];
    const ids = users.map(u => u.user_id).filter(Boolean);
    memberCache.set(leagueId, { ids, at: Date.now() });
    return ids;
  } catch {
    return null;
  }
}
