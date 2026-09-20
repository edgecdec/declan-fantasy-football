import test from 'node:test';
import assert from 'node:assert/strict';
import { MANAGE_GUILD, adminRefusalReason, canAdminGuild, isGlobalAdmin } from '../bot/src/permissions';

/**
 * Who may reconfigure the bot.
 *
 * The shape being pinned: global operators can fix any guild, a server's own admins can configure
 * THEIR guild only, and nobody else gets in. The failure that matters is the second person in the
 * allowlist quietly gaining authority over the first person's league channels.
 */

const OWNER = '642244387002253342';
const FRIEND = '423731305042149386';
const RANDOM = '111111111111111111';

function withAdmins<T>(value: string | undefined, fn: () => T): T {
  const before = process.env.DISCORD_ADMIN_IDS;
  if (value === undefined) delete process.env.DISCORD_ADMIN_IDS;
  else process.env.DISCORD_ADMIN_IDS = value;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env.DISCORD_ADMIN_IDS;
    else process.env.DISCORD_ADMIN_IDS = before;
  }
}

const NO_PERMS = BigInt(0);
const MANAGER = MANAGE_GUILD;
/** Discord's ADMINISTRATOR already implies Manage Server, so it arrives with the bit set. */
const ADMINISTRATOR = (BigInt(1) << BigInt(3)) | MANAGE_GUILD;

test('a global admin can configure any guild, with or without server permissions', () => {
  withAdmins(OWNER, () => {
    assert.ok(canAdminGuild(OWNER, NO_PERMS));
    assert.ok(canAdminGuild(OWNER, null));
    assert.ok(isGlobalAdmin(OWNER));
  });
});

test('Manage Server grants authority in that guild only', () => {
  withAdmins(OWNER, () => {
    // The friend in his own server: has Manage Server, so he can point the bot at his channels.
    assert.ok(canAdminGuild(FRIEND, MANAGER));
    assert.ok(canAdminGuild(FRIEND, ADMINISTRATOR));

    /*
     * The same friend in a server where he is an ordinary member. This is the case the global
     * allowlist would have got wrong: adding him there to let him run his own server would have
     * handed him control of every other one.
     */
    assert.equal(canAdminGuild(FRIEND, NO_PERMS), false);
    assert.equal(isGlobalAdmin(FRIEND), false);
  });
});

test('an ordinary member is never an admin', () => {
  withAdmins(OWNER, () => {
    assert.equal(canAdminGuild(RANDOM, NO_PERMS), false);
    assert.equal(canAdminGuild(RANDOM, undefined), false);
    // Permission bits that are not Manage Server do not count.
    assert.equal(
      canAdminGuild(RANDOM, BigInt(1) << BigInt(11)),
      false,
      'Send Messages is not Manage Server',
    );
  });
});

test('an unset allowlist leaves nobody globally privileged, and does not crash', () => {
  withAdmins(undefined, () => {
    assert.equal(isGlobalAdmin(OWNER), false);
    // Local authority still works: a server's own manager is not locked out by a missing env var.
    assert.ok(canAdminGuild(OWNER, MANAGER));
    assert.equal(canAdminGuild(OWNER, NO_PERMS), false);
  });
});

test('the allowlist tolerates spaces and trailing commas', () => {
  withAdmins(` ${OWNER} , ${FRIEND} ,`, () => {
    assert.ok(isGlobalAdmin(OWNER));
    assert.ok(isGlobalAdmin(FRIEND));
    assert.equal(isGlobalAdmin(RANDOM), false);
  });
  // An empty entry must not become a wildcard that matches an empty user id.
  withAdmins(',,', () => {
    assert.equal(isGlobalAdmin(''), false);
    assert.equal(isGlobalAdmin(OWNER), false);
  });
});

test('a refusal names the permission needed', () => {
  assert.match(adminRefusalReason(), /Manage Server/);
});
