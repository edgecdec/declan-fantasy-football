import test from 'node:test';
import assert from 'node:assert/strict';
import type { SleeperTransaction } from '@/services/sleeper/sleeperService';
import {
  createStreamState,
  hasSeeded,
  pingRoleFor,
  pruneToWeek,
  seed,
  takeNew,
  wantsTransaction,
} from '../bot/src/transactionStream';
import { DEFAULT_EVENT_TYPES, type Subscription } from '../bot/src/subscriptions';

/**
 * League activity as a stream with no persistence.
 *
 * The property that matters most is the restart behaviour. Nothing is stored, so a fresh process
 * sees an empty seen-Set while Sleeper still returns the whole week — and a naive implementation
 * posts thirty-odd stale transactions into the channel every time the bot is deployed. That bug
 * would pass any test that only checked "new transactions get posted", so it is tested directly.
 */

let counter = 0;
function tx(over: Partial<SleeperTransaction> = {}): SleeperTransaction {
  counter += 1;
  return {
    transaction_id: `t${counter}`,
    type: 'free_agent',
    status: 'complete',
    roster_ids: [1],
    adds: { '1234': 1 },
    drops: null,
    creator: 'u1',
    created: 1_700_000_000_000 + counter * 1000,
    leg: 3,
    ...over,
  };
}

const sub = (over: Partial<Subscription> = {}): Subscription => ({
  guildId: 'g1',
  channelId: 'c1',
  leagueId: 'L1',
  leagueName: 'Test League',
  eventTypes: [...DEFAULT_EVENT_TYPES],
  includeFailed: false,
  minFaab: 0,
  pingRoles: {},
  ...over,
});

test('the FIRST sweep posts nothing — this is the restart defence', () => {
  const state = createStreamState();
  const week = [tx(), tx(), tx()];

  // A fresh process against a week already full of transactions.
  const first = takeNew(state, 'L1', 3, week);
  assert.deepEqual(first, [], 'a restart must not repost the week');
  assert.ok(hasSeeded(state, 'L1', 3));
});

test('after seeding, only genuinely new transactions come back', () => {
  const state = createStreamState();
  const existing = [tx(), tx()];
  seed(state, 'L1', 3, existing);

  const fresh = tx();
  const got = takeNew(state, 'L1', 3, [...existing, fresh]);
  assert.deepEqual(got.map(t => t.transaction_id), [fresh.transaction_id]);
});

test('a transaction is returned exactly once, however often it is polled', () => {
  const state = createStreamState();
  seed(state, 'L1', 3, []);
  const one = tx();

  assert.equal(takeNew(state, 'L1', 3, [one]).length, 1);
  // Sleeper keeps returning it for the rest of the week; we must not keep posting it.
  assert.equal(takeNew(state, 'L1', 3, [one]).length, 0);
  assert.equal(takeNew(state, 'L1', 3, [one]).length, 0);
});

test('an empty seeded week is distinguishable from a never-swept one', () => {
  const state = createStreamState();
  // A genuinely quiet week: swept, nothing there.
  seed(state, 'L1', 3, []);
  assert.ok(hasSeeded(state, 'L1', 3));

  // Now something happens. It must post, because the week WAS swept.
  const one = tx();
  assert.equal(takeNew(state, 'L1', 3, [one]).length, 1);

  // A different week has never been swept, so its first sweep stays silent.
  assert.ok(!hasSeeded(state, 'L1', 4));
  assert.equal(takeNew(state, 'L1', 4, [tx({ leg: 4 })]).length, 0);
});

test('new transactions come back oldest first', () => {
  const state = createStreamState();
  seed(state, 'L1', 3, []);
  const late = tx({ created: 5_000 });
  const early = tx({ created: 1_000 });
  const middle = tx({ created: 3_000 });

  // Sleeper's order is not chronological; a trade read after its own drops is nonsense.
  const got = takeNew(state, 'L1', 3, [late, early, middle]);
  assert.deepEqual(got.map(t => t.created), [1_000, 3_000, 5_000]);
});

test('leagues and weeks are tracked independently', () => {
  const state = createStreamState();
  const shared = tx();
  seed(state, 'L1', 3, [shared]);

  // Same id, different league: a league that has not been swept stays silent, and seeing the id
  // elsewhere must not mark it seen here.
  assert.equal(takeNew(state, 'L2', 3, [shared]).length, 0, 'L2 first sweep seeds');
  assert.equal(takeNew(state, 'L2', 3, [shared, tx()]).length, 1, 'then L2 reports its own new ones');
});

test('pruning forgets old weeks and keeps the live one', () => {
  const state = createStreamState();
  seed(state, 'L1', 2, [tx({ leg: 2 })]);
  seed(state, 'L1', 3, [tx({ leg: 3 })]);
  seed(state, 'L2', 3, [tx({ leg: 3 })]);

  pruneToWeek(state, 3);

  assert.ok(!hasSeeded(state, 'L1', 2), 'week 2 is gone');
  assert.ok(hasSeeded(state, 'L1', 3));
  assert.ok(hasSeeded(state, 'L2', 3), 'pruning is by week, not by league');
});

test('failed claims are suppressed unless asked for', () => {
  const failed = tx({ type: 'waiver', status: 'failed' });
  assert.equal(wantsTransaction(sub(), failed), false);
  assert.equal(wantsTransaction(sub({ includeFailed: true }), failed), true);
  // A complete one is always wanted.
  assert.equal(wantsTransaction(sub(), tx({ type: 'waiver', status: 'complete' })), true);
});

test('event types filter, and an unwatched type is silent', () => {
  const trade = tx({ type: 'trade' });
  assert.equal(wantsTransaction(sub({ eventTypes: ['trade'] }), trade), true);
  assert.equal(wantsTransaction(sub({ eventTypes: ['waiver'] }), trade), false);
  // An elimination is its own type and must be selectable on its own.
  assert.equal(
    wantsTransaction(sub({ eventTypes: ['chopped'] }), tx({ type: 'chopped' })),
    true,
  );
});

test('the FAAB floor applies to waivers only, never silencing free agents', () => {
  const cheap = tx({ type: 'waiver', settings: { waiver_bid: 1 } });
  const dear = tx({ type: 'waiver', settings: { waiver_bid: 40 } });
  const withFloor = sub({ minFaab: 10 });

  assert.equal(wantsTransaction(withFloor, cheap), false);
  assert.equal(wantsTransaction(withFloor, dear), true);

  /*
   * The trap: a free agent pickup carries no bid at all. Applying a FAAB floor to it would filter
   * on a threshold it can never meet, silently disabling the highest-volume event type the moment
   * anyone set a floor.
   */
  assert.equal(wantsTransaction(withFloor, tx({ type: 'free_agent' })), true);
  // A waiver with no bid recorded is also kept rather than assumed to be zero.
  assert.equal(wantsTransaction(withFloor, tx({ type: 'waiver', settings: null })), true);
});

test('a role is pinged only for the types it is configured for', () => {
  // One role per (league, type): trades wake the league, waiver churn stays silent.
  const s = sub({ pingRoles: { trade: 'role-traders' } });

  assert.equal(pingRoleFor(s, tx({ type: 'trade' })), 'role-traders');
  assert.equal(pingRoleFor(s, tx({ type: 'waiver' })), null);
  assert.equal(pingRoleFor(s, tx({ type: 'free_agent' })), null);
});

test('different types can ping different roles', () => {
  const s = sub({ pingRoles: { trade: 'role-a', chopped: 'role-b' } });
  assert.equal(pingRoleFor(s, tx({ type: 'trade' })), 'role-a');
  assert.equal(pingRoleFor(s, tx({ type: 'chopped' })), 'role-b');
});

test('no ping configuration means no ping', () => {
  assert.equal(pingRoleFor(sub(), tx({ type: 'trade' })), null);
});

test('a failed transaction never pings, even when its type is configured', () => {
  /*
   * A guild that opted into failed claims still sees them posted — but waking a role for a claim
   * that LOST is pure noise, and it is the case most likely to make someone mute the channel.
   */
  const s = sub({ pingRoles: { waiver: 'role-x' }, includeFailed: true });
  const failed = tx({ type: 'waiver', status: 'failed' });

  assert.equal(wantsTransaction(s, failed), true, 'still posted');
  assert.equal(pingRoleFor(s, failed), null, 'but never pinged');
});

test('pinging is independent of whether the type is even posted', () => {
  /*
   * Deliberately not enforced: a ping role for a type the subscription does not post simply never
   * fires, because the post is what carries the ping. Coupling them would mean setting a ping role
   * silently widened which events appear in the channel.
   */
  const s = sub({ eventTypes: ['trade'], pingRoles: { waiver: 'role-x' } });
  assert.equal(wantsTransaction(s, tx({ type: 'waiver' })), false);
});
