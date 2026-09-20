import test from 'node:test';
import assert from 'node:assert/strict';
import { getBotDb } from '../bot/src/botDb';
import {
  DEFAULT_EVENT_TYPES,
  allSubscriptions,
  clearPingRoles,
  setPingRole,
  leaguesToPoll,
  setEventTypes,
  setIncludeFailed,
  setMinFaab,
  subscription,
  subscriptionsForGuild,
  unwatchLeague,
  watchLeague,
} from '../bot/src/subscriptions';

/**
 * Channel bindings — the bot's only persisted state.
 *
 * Two things here are security-adjacent rather than cosmetic: a guild must never see another
 * guild's bindings (that is the privacy boundary the read commands rest on), and rebinding a league
 * to a new channel must MOVE it rather than leaving two rows that both post.
 */

test('a league binds to a channel and reads back with sane defaults', () => {
  const sub = watchLeague({
    guildId: 'guild-a',
    channelId: 'chan-1',
    leagueId: 'league-1',
    leagueName: "Graham's",
  });

  assert.equal(sub.channelId, 'chan-1');
  assert.equal(sub.leagueName, "Graham's");
  assert.deepEqual(sub.eventTypes, DEFAULT_EVENT_TYPES);
  // Failed waiver claims are a third of all volume, so off unless asked for.
  assert.equal(sub.includeFailed, false);
  assert.equal(sub.minFaab, 0);
});

test('rebinding MOVES the subscription rather than duplicating it', () => {
  watchLeague({ guildId: 'guild-b', channelId: 'chan-1', leagueId: 'league-2' });
  watchLeague({ guildId: 'guild-b', channelId: 'chan-2', leagueId: 'league-2' });

  const forGuild = subscriptionsForGuild('guild-b').filter(s => s.leagueId === 'league-2');
  assert.equal(forGuild.length, 1, 'two rows would double-post every transaction');
  assert.equal(forGuild[0].channelId, 'chan-2');
});

test('a move preserves tuned filters', () => {
  watchLeague({ guildId: 'guild-c', channelId: 'chan-1', leagueId: 'league-3' });
  setIncludeFailed('guild-c', 'league-3', true);
  setMinFaab('guild-c', 'league-3', 15);
  setEventTypes('guild-c', 'league-3', ['trade']);

  // Moving the channel is not a request to reset how the league is filtered.
  watchLeague({ guildId: 'guild-c', channelId: 'chan-9', leagueId: 'league-3' });

  const sub = subscription('guild-c', 'league-3')!;
  assert.equal(sub.channelId, 'chan-9');
  assert.equal(sub.includeFailed, true);
  assert.equal(sub.minFaab, 15);
  assert.deepEqual(sub.eventTypes, ['trade']);
});

test('a guild sees only its own bindings', () => {
  watchLeague({ guildId: 'guild-mine', channelId: 'c', leagueId: 'league-mine' });
  watchLeague({ guildId: 'guild-theirs', channelId: 'c', leagueId: 'league-theirs' });

  const mine = subscriptionsForGuild('guild-mine');
  assert.deepEqual(mine.map(s => s.leagueId), ['league-mine']);
  assert.ok(
    !mine.some(s => s.leagueId === 'league-theirs'),
    'one league must never surface in another guild',
  );
});

test('two guilds may watch the same league, and it is polled once', () => {
  watchLeague({ guildId: 'guild-x', channelId: 'cx', leagueId: 'league-shared' });
  watchLeague({ guildId: 'guild-y', channelId: 'cy', leagueId: 'league-shared' });

  const subs = allSubscriptions().filter(s => s.leagueId === 'league-shared');
  assert.equal(subs.length, 2, 'both bindings exist, each with its own channel');
  assert.deepEqual([...subs.map(s => s.channelId)].sort(), ['cx', 'cy']);

  // One fetch serves both, or a popular league costs a call per guild watching it.
  const polled = leaguesToPoll().filter(id => id === 'league-shared');
  assert.equal(polled.length, 1);
});

test('unwatching removes only that guild-league pair', () => {
  watchLeague({ guildId: 'guild-u', channelId: 'c', leagueId: 'league-keep' });
  watchLeague({ guildId: 'guild-u', channelId: 'c', leagueId: 'league-drop' });
  watchLeague({ guildId: 'guild-other', channelId: 'c', leagueId: 'league-drop' });

  assert.equal(unwatchLeague('guild-u', 'league-drop'), true);
  assert.deepEqual(subscriptionsForGuild('guild-u').map(s => s.leagueId), ['league-keep']);
  // The other guild's binding on the same league is untouched.
  assert.equal(subscription('guild-other', 'league-drop')?.channelId, 'c');
  // Unwatching something not bound is a no-op, not an error.
  assert.equal(unwatchLeague('guild-u', 'league-never'), false);
});

test('an unknown event type is dropped rather than kept forever', () => {
  watchLeague({ guildId: 'guild-z', channelId: 'c', leagueId: 'league-z' });
  // Simulates a binding written by a future build that knew a type this one does not.
  setEventTypes('guild-z', 'league-z', ['trade', 'teleportation' as never]);
  assert.deepEqual(subscription('guild-z', 'league-z')!.eventTypes, ['trade']);
});

test('a negative FAAB floor is clamped, not stored', () => {
  watchLeague({ guildId: 'guild-f', channelId: 'c', leagueId: 'league-f' });
  setMinFaab('guild-f', 'league-f', -5);
  assert.equal(subscription('guild-f', 'league-f')!.minFaab, 0);
});

test('a ping role is stored per event type, and cleared independently', () => {
  watchLeague({ guildId: 'guild-p', channelId: 'c', leagueId: 'league-p' });

  setPingRole('guild-p', 'league-p', 'trade', 'role-trade');
  setPingRole('guild-p', 'league-p', 'chopped', 'role-chop');
  assert.deepEqual(subscription('guild-p', 'league-p')!.pingRoles, {
    trade: 'role-trade',
    chopped: 'role-chop',
  });

  // Clearing one leaves the other alone — the whole point of a per-type map.
  setPingRole('guild-p', 'league-p', 'trade', null);
  assert.deepEqual(subscription('guild-p', 'league-p')!.pingRoles, { chopped: 'role-chop' });

  clearPingRoles('guild-p', 'league-p');
  assert.deepEqual(subscription('guild-p', 'league-p')!.pingRoles, {});
});

test('setting a ping role on an unwatched league fails rather than creating one', () => {
  assert.equal(setPingRole('guild-p', 'league-nonexistent', 'trade', 'r'), false);
});

test('a new binding pings nobody until asked', () => {
  const sub = watchLeague({ guildId: 'guild-q', channelId: 'c', leagueId: 'league-q' });
  assert.deepEqual(sub.pingRoles, {}, 'silence is the default');
});

test('ping roles survive a channel move', () => {
  watchLeague({ guildId: 'guild-r', channelId: 'c1', leagueId: 'league-r' });
  setPingRole('guild-r', 'league-r', 'trade', 'role-keep');
  watchLeague({ guildId: 'guild-r', channelId: 'c2', leagueId: 'league-r' });

  const sub = subscription('guild-r', 'league-r')!;
  assert.equal(sub.channelId, 'c2');
  assert.deepEqual(sub.pingRoles, { trade: 'role-keep' }, 'moving a channel is not a reset');
});

test('an unknown type in a stored ping map is ignored', () => {
  watchLeague({ guildId: 'guild-s', channelId: 'c', leagueId: 'league-s' });
  setPingRole('guild-s', 'league-s', 'trade', 'role-ok');
  // Simulates a map written by a future build that knew a type this one does not.
  getBotDb()
    .prepare('UPDATE guild_subscriptions SET ping_roles = ? WHERE guild_id = ? AND league_id = ?')
    .run(JSON.stringify({ trade: 'role-ok', teleport: 'role-bad' }), 'guild-s', 'league-s');

  assert.deepEqual(subscription('guild-s', 'league-s')!.pingRoles, { trade: 'role-ok' });
});
