import test from 'node:test';
import assert from 'node:assert/strict';
import { getAuthUser, getServiceCaller } from '@/lib/auth';
import { findAccountByDiscordId, setDiscordId } from '@/lib/betting/accounts';
import { getDb } from '@/lib/db';

/**
 * The service-auth boundary for /api/bot/*.
 *
 * This secret can move money — it authorises placing bets against someone's bankroll — so the
 * failure modes worth pinning are the ones that silently widen access: a missing env var read as
 * "allow everyone" instead of "allow nobody", and `getAuthUser` quietly starting to accept a header
 * because the two were merged.
 */

const SECRET = 'test-bot-secret-value';

function withSecret<T>(value: string | undefined, fn: () => T): T {
  const before = process.env.BOT_SERVICE_SECRET;
  if (value === undefined) delete process.env.BOT_SERVICE_SECRET;
  else process.env.BOT_SERVICE_SECRET = value;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env.BOT_SERVICE_SECRET;
    else process.env.BOT_SERVICE_SECRET = before;
  }
}

const req = (headers: Record<string, string> = {}) =>
  new Request('https://example.test/api/bot/me', { headers });

test('the right secret identifies the bot', () => {
  withSecret(SECRET, () => {
    assert.deepEqual(getServiceCaller(req({ 'x-bot-secret': SECRET })), { service: 'bot' });
  });
});

test('a wrong or absent secret is refused', () => {
  withSecret(SECRET, () => {
    assert.equal(getServiceCaller(req({ 'x-bot-secret': 'wrong' })), null);
    assert.equal(getServiceCaller(req()), null);
    // A prefix of the real secret must not pass — the length check and the constant-time compare
    // both have to hold.
    assert.equal(getServiceCaller(req({ 'x-bot-secret': SECRET.slice(0, -1) })), null);
    assert.equal(getServiceCaller(req({ 'x-bot-secret': SECRET + 'x' })), null);
  });
});

test('an UNSET secret refuses everyone rather than admitting everyone', () => {
  withSecret(undefined, () => {
    assert.equal(getServiceCaller(req({ 'x-bot-secret': SECRET })), null);
    assert.equal(getServiceCaller(req({ 'x-bot-secret': '' })), null);
    assert.equal(getServiceCaller(req()), null);
  });
  // An empty string is a real deployment mistake (`BOT_SERVICE_SECRET=` in .env) and must fail the
  // same way, not match a caller who also sends nothing.
  withSecret('', () => {
    assert.equal(getServiceCaller(req({ 'x-bot-secret': '' })), null);
  });
});

test('the bot secret is NOT a session — getAuthUser still refuses it', () => {
  withSecret(SECRET, () => {
    assert.equal(getAuthUser(req({ 'x-bot-secret': SECRET })), null);
    // Nor does a cookie named after it do anything.
    assert.equal(getAuthUser(req({ cookie: `x-bot-secret=${SECRET}` })), null);
  });
});

/** A real account row, since the Discord helpers hit the unique index. */
function makeAccount(username: string): string {
  const id = `acct-${username}`;
  getDb()
    .prepare(
      `INSERT INTO accounts (id, sleeper_user_id, username, display_name, balance_cents)
       VALUES (?, ?, ?, ?, 0)`,
    )
    .run(id, `sleeper-${username}`, username, username);
  return id;
}

test('a Discord id resolves to its account, and moves cleanly when re-linked', () => {
  const first = makeAccount('linkfirst');
  const second = makeAccount('linksecond');

  setDiscordId(first, '999000111');
  assert.equal(findAccountByDiscordId('999000111')?.id, first);

  /*
   * Re-linking the same Discord user to a different account must MOVE the link, not fail on the
   * unique index and not leave both rows claiming it. Two accounts claiming one Discord id would
   * let one person bet from the other's bankroll.
   */
  setDiscordId(second, '999000111');
  assert.equal(findAccountByDiscordId('999000111')?.id, second);

  const stillLinked = getDb()
    .prepare('SELECT COUNT(*) AS n FROM accounts WHERE discord_user_id = ?')
    .get('999000111') as { n: number };
  assert.equal(stillLinked.n, 1, 'exactly one account may hold a given Discord id');
});

test('unlinking clears it and leaves the account otherwise untouched', () => {
  const id = makeAccount('unlinkme');
  setDiscordId(id, '222333444');
  setDiscordId(id, null);

  assert.equal(findAccountByDiscordId('222333444'), undefined);
  const row = getDb().prepare('SELECT username, balance_cents FROM accounts WHERE id = ?').get(id) as
    { username: string; balance_cents: number };
  assert.equal(row.username, 'unlinkme');
  assert.equal(row.balance_cents, 0);
});

test('two different Discord users can link to two different accounts', () => {
  const a = makeAccount('twoa');
  const b = makeAccount('twob');
  setDiscordId(a, '111');
  setDiscordId(b, '222');
  assert.equal(findAccountByDiscordId('111')?.id, a);
  assert.equal(findAccountByDiscordId('222')?.id, b);
});
