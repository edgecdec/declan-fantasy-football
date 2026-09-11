import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Opening bankrolls, once per league.
 *
 * db.ts resolves its file from process.cwd() at module load, so the cwd moves to a scratch
 * directory before the modules are imported.
 */
const scratch = mkdtempSync(path.join(tmpdir(), 'grants-test-'));
mkdirSync(path.join(scratch, 'data'), { recursive: true });
process.chdir(scratch);

type AccountsMod = typeof import('@/lib/betting/accounts');
type DbMod = typeof import('@/lib/db');

let accounts: AccountsMod;
let getDb: DbMod['getDb'];

async function load() {
  if (!accounts) {
    accounts = await import('@/lib/betting/accounts');
    ({ getDb } = await import('@/lib/db'));
  }
  return { accounts, db: getDb() };
}

function seedMember(db: ReturnType<DbMod['getDb']>, name: string, leagues: string[]) {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO accounts (id, sleeper_user_id, username, display_name)
     VALUES (?, ?, ?, ?)`,
  ).run(id, `sleeper-${name}`, name, name);
  for (const leagueId of leagues) {
    db.prepare(
      `INSERT INTO account_leagues (account_id, league_id, season, balance_cents)
       VALUES (?, ?, '2026', 0)`,
    ).run(id, leagueId);
  }
  return id;
}

const bankroll = (db: ReturnType<DbMod['getDb']>, id: string, league: string) =>
  (db.prepare(
    'SELECT balance_cents b FROM account_leagues WHERE account_id = ? AND league_id = ?',
  ).get(id, league) as { b: number } | undefined)?.b;

test('setting a password grants EVERY league the account belongs to', async () => {
  const { accounts: a, db } = await load();
  const id = seedMember(db, 'dualLeague', ['LX', 'LY']);
  const token = a.issueSetupToken(id);

  const result = a.completeSetup(token, 'hashed-password');
  assert.ok(result);
  // One grant each. Granting once per ACCOUNT would leave the second league unfundable, which is
  // the bug this replaced: a membership row with nothing in it and no later chance to fix it.
  assert.equal(bankroll(db, id, 'LX'), a.START_BALANCE_CENTS);
  assert.equal(bankroll(db, id, 'LY'), a.START_BALANCE_CENTS);
  // The account-wide cache is the sum of both.
  const acct = db.prepare('SELECT balance_cents b FROM accounts WHERE id = ?').get(id) as { b: number };
  assert.equal(acct.b, a.START_BALANCE_CENTS * 2);
});

test('a re-issued token cannot grant twice', async () => {
  const { accounts: a, db } = await load();
  const id = seedMember(db, 'reissued', ['LZ']);
  a.completeSetup(a.issueSetupToken(id), 'hash-one');
  const before = bankroll(db, id, 'LZ');

  // Someone loses their password and gets a fresh link. The password changes; the money does not.
  const second = a.completeSetup(a.issueSetupToken(id), 'hash-two');
  assert.ok(second);
  assert.equal(bankroll(db, id, 'LZ'), before);
});

test('a league joined AFTER setup is granted by ensureLeagueGrant, once', async () => {
  const { accounts: a, db } = await load();
  const id = seedMember(db, 'joinedLater', ['LP']);
  a.completeSetup(a.issueSetupToken(id), 'hash');

  // Added to a second league later. completeSetup will never run for them again, so this is the
  // only thing that can fund it — the exact case of a manager already in one league being added
  // to a new one.
  db.prepare(
    `INSERT INTO account_leagues (account_id, league_id, season, balance_cents)
     VALUES (?, 'LQ', '2026', 0)`,
  ).run(id);

  assert.equal(a.ensureLeagueGrant(id, 'LQ'), true);
  assert.equal(bankroll(db, id, 'LQ'), a.START_BALANCE_CENTS);
  // Idempotent, so re-running a seed cannot hand out a second bankroll.
  assert.equal(a.ensureLeagueGrant(id, 'LQ'), false);
  assert.equal(bankroll(db, id, 'LQ'), a.START_BALANCE_CENTS);
  // And the first league is untouched.
  assert.equal(bankroll(db, id, 'LP'), a.START_BALANCE_CENTS);
});

test('a zero balance is not mistaken for an ungranted one', async () => {
  const { accounts: a, db } = await load();
  const id = seedMember(db, 'brokeButGranted', ['LR']);
  a.completeSetup(a.issueSetupToken(id), 'hash');
  // Lost the lot. The guard is a ledger row, not the balance, so this must NOT be re-granted —
  // otherwise losing everything hands you another thousand.
  a.creditAccount(id, 'LR', -a.START_BALANCE_CENTS, 'adjustment');
  assert.equal(bankroll(db, id, 'LR'), 0);
  assert.equal(a.ensureLeagueGrant(id, 'LR'), false);
  assert.equal(bankroll(db, id, 'LR'), 0);
});

test('crediting a league the account is not in throws rather than writing lost money', async () => {
  const { accounts: a, db } = await load();
  const id = seedMember(db, 'noSuchLeague', ['LS']);
  // A ledger row against a bankroll that does not exist would be money nobody can ever see.
  assert.throws(() => a.creditAccount(id, 'NOPE', 5_000, 'adjustment'), /no bankroll/);
  const rows = db.prepare(
    "SELECT COUNT(*) c FROM ledger WHERE account_id = ? AND league_id = 'NOPE'",
  ).get(id) as { c: number };
  assert.equal(rows.c, 0);
});

/**
 * Auto-joining a newly-enabled league.
 *
 * Enabling a league used to need the seed script re-run before existing members could see it, so
 * access depended on remembering a manual step. `fetchMembers` is injected here so the join logic
 * is tested without the network.
 */
test('an existing member of a newly-enabled league is joined and funded', async () => {
  const { accounts: a, db } = await load();
  const leagues = await import('@/lib/betting/leagues');
  const enabled = leagues.BETTING_LEAGUES[0].leagueId;

  const id = seedMember(db, 'autoJoiner', []); // no memberships at all
  db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run('already-set-up', id);

  const joined = await leagues.syncLeagueMemberships(
    { id, sleeper_user_id: 'sleeper-autoJoiner', password_hash: 'already-set-up' },
    async () => ['sleeper-autoJoiner', 'someone-else'],
  );

  assert.ok(joined.some(j => j.leagueId === enabled), 'should have joined an enabled league');
  assert.equal(bankroll(db, id, enabled), a.START_BALANCE_CENTS);
});

test('a non-member is not joined', async () => {
  const db = (await load()).db;
  const leagues = await import('@/lib/betting/leagues');
  const id = seedMember(db, 'notAMember', []);
  db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run('set-up', id);

  const joined = await leagues.syncLeagueMemberships(
    { id, sleeper_user_id: 'sleeper-notAMember', password_hash: 'set-up' },
    async () => ['somebody', 'else'],
  );
  assert.deepEqual(joined, []);
  assert.equal(bankroll(db, id, leagues.BETTING_LEAGUES[0].leagueId), undefined);
});

test('a failed Sleeper lookup does not read as "not a member"', async () => {
  const db = (await load()).db;
  const leagues = await import('@/lib/betting/leagues');
  const id = seedMember(db, 'lookupFailed', []);
  db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run('set-up', id);

  // null means the call failed. Treating that as absence would deny access until the next
  // successful call, indistinguishable from having actually left the league.
  const joined = await leagues.syncLeagueMemberships(
    { id, sleeper_user_id: 'sleeper-lookupFailed', password_hash: 'set-up' },
    async () => null,
  );
  assert.deepEqual(joined, []);
  // No membership row was written either, so the next attempt can still succeed.
  assert.equal(bankroll(db, id, leagues.BETTING_LEAGUES[0].leagueId), undefined);
});

test('an account already in every enabled league makes no Sleeper call at all', async () => {
  const db = (await load()).db;
  const leagues = await import('@/lib/betting/leagues');
  const all = leagues.BETTING_LEAGUES.map(l => l.leagueId);
  const id = seedMember(db, 'alreadyIn', all);
  db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run('set-up', id);

  let calls = 0;
  const joined = await leagues.syncLeagueMemberships(
    { id, sleeper_user_id: 'sleeper-alreadyIn', password_hash: 'set-up' },
    async () => { calls++; return []; },
  );
  // The steady state, and it must be free: this runs on every dashboard load.
  assert.equal(calls, 0);
  assert.deepEqual(joined, []);
});

test('an unclaimed account is joined but not funded', async () => {
  const db = (await load()).db;
  const leagues = await import('@/lib/betting/leagues');
  const enabled = leagues.BETTING_LEAGUES[0].leagueId;
  const id = seedMember(db, 'unclaimedJoin', []);

  const joined = await leagues.syncLeagueMemberships(
    { id, sleeper_user_id: 'sleeper-unclaimedJoin', password_hash: null },
    async () => ['sleeper-unclaimedJoin'],
  );
  assert.equal(joined.length > 0, true);
  assert.equal(joined[0].granted, false);
  // Membership yes, money no — completeSetup grants it when they set a password, so an account
  // nobody has claimed never shows a balance in the standings.
  assert.equal(bankroll(db, id, enabled), 0);
});
