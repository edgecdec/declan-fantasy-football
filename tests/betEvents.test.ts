import test from 'node:test';
import assert from 'node:assert/strict';
import { getDb } from '@/lib/db';
import {
  attachDiscordMessage,
  betEventsAfter,
  latestBetEventId,
  recordBetEvent,
} from '@/lib/betting/events';

/**
 * The bet event outbox.
 *
 * The load-bearing property is TRANSACTIONALITY: an event is written inside the same transaction as
 * the state change it describes, so a watcher can never announce a bet that does not exist. That is
 * the whole reason the outbox exists rather than the bot polling `wagers` and diffing, and it is
 * the one thing a plausible-looking implementation gets wrong — by grabbing its own `getDb()`
 * handle, which puts the insert outside the caller's transaction where a rollback cannot reach it.
 *
 * Ordering is the second property. A cursor reads forward by id, so ids must be monotonic and
 * reads must be ascending; descending would make "everything I have not seen" inexpressible.
 */

const args = (over: Partial<Parameters<typeof recordBetEvent>[1]> = {}) => ({
  type: 'wager_placed' as const,
  leagueId: 'L1',
  season: 2026,
  week: 3,
  refId: 'w1',
  payload: { stakeCents: 500 },
  ...over,
});

test('an event survives its transaction committing', () => {
  const db = getDb();
  const before = latestBetEventId();
  db.transaction(() => {
    recordBetEvent(db, args({ refId: 'committed' }));
  })();

  const events = betEventsAfter(before);
  assert.equal(events.length, 1);
  assert.equal(events[0].refId, 'committed');
  assert.equal(events[0].type, 'wager_placed');
  assert.deepEqual(events[0].payload, { stakeCents: 500 });
});

test('an event ROLLS BACK with its transaction — the point of the outbox', () => {
  const db = getDb();
  const before = latestBetEventId();

  assert.throws(() => {
    db.transaction(() => {
      recordBetEvent(db, args({ refId: 'doomed' }));
      // Stands in for any later failure in the same transaction: a bankroll check, a constraint,
      // a thrown guard. The event must not outlive it.
      throw new Error('placement failed after the event was written');
    })();
  }, /placement failed/);

  const events = betEventsAfter(before);
  assert.deepEqual(
    events.map(e => e.refId),
    [],
    'a rolled-back transaction must leave no event behind',
  );
});

test('ids are monotonic and reads come back oldest first', () => {
  const db = getDb();
  const before = latestBetEventId();
  for (const ref of ['a', 'b', 'c']) {
    db.transaction(() => recordBetEvent(db, args({ refId: ref })))();
  }

  const events = betEventsAfter(before);
  assert.deepEqual(events.map(e => e.refId), ['a', 'b', 'c']);
  const ids = events.map(e => e.id);
  assert.deepEqual([...ids].sort((x, y) => x - y), ids, 'ids must ascend');
});

test('a cursor reads each event exactly once', () => {
  const db = getDb();
  let cursor = latestBetEventId();
  db.transaction(() => recordBetEvent(db, args({ refId: 'first' })))();

  const firstPass = betEventsAfter(cursor);
  assert.deepEqual(firstPass.map(e => e.refId), ['first']);
  cursor = firstPass[firstPass.length - 1].id;

  // Nothing new since, so a second poll at the advanced cursor must be empty rather than
  // re-delivering — that is what stops a restart double-posting to Discord.
  assert.deepEqual(betEventsAfter(cursor), []);

  db.transaction(() => recordBetEvent(db, args({ refId: 'second' })))();
  assert.deepEqual(betEventsAfter(cursor).map(e => e.refId), ['second']);
});

test('a malformed payload does not break the cursor', () => {
  const db = getDb();
  const before = latestBetEventId();
  // Written past the helper on purpose: a bad row from any source must still be readable, because
  // the type and ref_id a watcher routes on are columns rather than payload.
  db.prepare(
    `INSERT INTO bet_events (type, league_id, season, week, ref_id, payload)
     VALUES ('wager_won', 'L1', 2026, 3, 'broken', 'not json{')`,
  ).run();

  const events = betEventsAfter(before);
  assert.equal(events.length, 1);
  assert.equal(events[0].refId, 'broken');
  assert.equal(events[0].type, 'wager_won');
  assert.deepEqual(events[0].payload, { malformed: 'not json{' });
});

test('a placement message id can be attached, and nothing else is mutable', () => {
  const db = getDb();
  const before = latestBetEventId();
  db.transaction(() => recordBetEvent(db, args({ refId: 'announced' })))();
  const [event] = betEventsAfter(before);

  attachDiscordMessage(event.id, '1234567890');
  const [again] = betEventsAfter(before);
  assert.equal(again.discordMessageId, '1234567890');
  // Everything else is untouched: settlement edits the message, it does not rewrite history.
  assert.equal(again.type, event.type);
  assert.equal(again.refId, event.refId);
  assert.deepEqual(again.payload, event.payload);
});

test('season and week are stored as numbers, whatever the caller passes', () => {
  const db = getDb();
  const before = latestBetEventId();
  // markets.season is TEXT in this schema, so a caller forwarding it straight through hands us a
  // string. Storing it unconverted would make a numeric filter on season silently miss rows.
  db.transaction(() => recordBetEvent(db, args({ season: '2026' as unknown as number })))();
  const [event] = betEventsAfter(before);
  assert.equal(event.season, 2026);
  assert.equal(typeof event.season, 'number');
});
