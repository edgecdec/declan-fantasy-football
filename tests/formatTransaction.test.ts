import test from 'node:test';
import assert from 'node:assert/strict';
import type { SleeperTransaction } from '@/services/sleeper/sleeperService';
import { formatTransaction, type PlayerLookup } from '../bot/src/formatTransaction';
import { pad } from '../bot/src/format';

/**
 * Rendering a Sleeper transaction for a channel.
 *
 * The bug worth guarding is directional. `adds` and `drops` are both `player_id -> roster_id`, but
 * in a TRADE that id means "receives", while in a free-agent move it means "did this". Reading a
 * trade with free-agent logic names the wrong manager as the one acquiring a player — a message
 * that is confidently wrong, which is worse than no message.
 */

const PLAYERS: PlayerLookup = {
  '11646': { n: 'Puka Nacua', p: 'WR' },
  '13286': { n: 'Jeremiyah Love', p: 'RB' },
  '4046': { n: 'Patrick Mahomes', p: 'QB' },
  SF: { n: 'San Francisco 49ers', p: 'DEF' },
};

const NAMES = new Map([
  [8, 'alice'],
  [9, 'bob'],
  [15, 'carol'],
]);

const base: SleeperTransaction = {
  transaction_id: 't1',
  type: 'free_agent',
  status: 'complete',
  roster_ids: [8],
  adds: null,
  drops: null,
  creator: 'u',
  created: 1,
  leg: 3,
};

const fmt = (over: Partial<SleeperTransaction>) =>
  formatTransaction({ ...base, ...over }, NAMES, PLAYERS, 'Test League');

const column = (msg: ReturnType<typeof fmt>, who: string) =>
  msg.fields!.find(f => f.name === who)!.value;

test('a trade is one column per manager listing what each RECEIVES, like Sleeper', () => {
  // Real shape: 11646 goes TO roster 8 and FROM roster 9.
  const msg = fmt({
    type: 'trade',
    roster_ids: [8, 9],
    adds: { '11646': 8, '13286': 9 },
    drops: { '11646': 9, '13286': 8 },
  });

  assert.match(msg.title, /Trade completed/);
  assert.match(msg.lines[0], /alice\*\* ⇄ \*\*bob/);
  assert.equal(msg.fields!.length, 2);
  assert.ok(msg.fields!.every(f => f.inline), 'columns sit side by side');

  assert.match(column(msg, 'alice'), /\+ Puka Nacua WR/);
  assert.match(column(msg, 'bob'), /\+ Jeremiyah Love RB/);
  // What a side gave up is the OTHER column, not repeated as a red line in its own.
  assert.ok(!column(msg, 'alice').includes('Jeremiyah Love'));
  assert.ok(!column(msg, 'bob').includes('Puka Nacua'));
});

test('a release to make roster room shows red under the receiver', () => {
  const msg = fmt({
    type: 'trade',
    roster_ids: [8, 9],
    adds: { '11646': 8 },
    drops: { '11646': 9, '4046': 8 },
  });
  assert.match(column(msg, 'alice'), /\n- Patrick Mahomes QB/);
  assert.match(column(msg, 'bob'), /nothing/);
});

test('a trade column is a diff block, so Discord colours it green and red', () => {
  const msg = fmt({ type: 'trade', roster_ids: [8, 9], adds: { '11646': 8 }, drops: { '11646': 9 } });
  assert.match(column(msg, 'alice'), /^```diff\n[\s\S]*\n```$/);
});

test('a lopsided or three-team trade needs no special case', () => {
  const msg = fmt({
    type: 'trade',
    roster_ids: [8, 9, 15],
    adds: { '11646': 8, '13286': 9, '4046': 15 },
    drops: { '11646': 9, '13286': 15, '4046': 8 },
  });
  assert.equal(msg.fields!.length, 3);
  assert.match(column(msg, 'carol'), /Patrick Mahomes/);
});

test('draft picks and FAAB land in the receiving column, naming a moved pick\'s origin', () => {
  const msg = fmt({
    type: 'trade',
    roster_ids: [8, 9],
    adds: { '11646': 8 },
    drops: { '11646': 9 },
    draft_picks: [
      { season: '2027', round: 1, roster_id: 9, previous_owner_id: 9, owner_id: 8 },
      { season: '2027', round: 2, roster_id: 15, previous_owner_id: 8, owner_id: 9 },
    ],
    waiver_budget: [{ sender: 8, receiver: 9, amount: 15 }],
  });
  assert.match(column(msg, 'alice'), /\+ 2027 1st round pick\n/);
  assert.match(column(msg, 'bob'), /\+ 2027 2nd round pick \(carol\)/);
  assert.match(column(msg, 'bob'), /\+ \$15 FAAB/);
});

test('a trade carries its time so Discord can show it', () => {
  const msg = fmt({ type: 'trade', roster_ids: [8, 9], created: 1000, status_updated: 5000 });
  assert.equal(msg.timestamp, 5000);
});

test('a won waiver names the FAAB cost', () => {
  const msg = fmt({
    type: 'waiver',
    adds: { '11646': 8 },
    settings: { waiver_bid: 27 },
  });
  assert.match(msg.title, /Waiver/);
  assert.match(msg.lines[0], /alice/);
  assert.match(msg.lines[0], /claimed Puka Nacua/);
  assert.match(msg.lines[0], /\$27/);
});

test('a failed waiver reads as a miss, not an acquisition', () => {
  const msg = fmt({
    type: 'waiver',
    status: 'failed',
    adds: { '11646': 8 },
    settings: { waiver_bid: 27 },
  });
  assert.match(msg.title, /failed/i);
  assert.match(msg.lines[0], /missed/);
  assert.ok(!/claimed/.test(msg.lines[0]), 'a failed claim must not read as a success');
});

test('a waiver that also drops someone says so', () => {
  const msg = fmt({
    type: 'waiver',
    adds: { '11646': 8 },
    drops: { '4046': 8 },
    settings: { waiver_bid: 5 },
  });
  assert.match(msg.lines.join(' '), /Dropped Patrick Mahomes/);
});

test('free agent adds, drops and both are all rendered', () => {
  assert.match(fmt({ adds: { '11646': 8 } }).lines[0], /added Puka Nacua/);
  assert.match(fmt({ drops: { '4046': 8 } }).lines[0], /dropped Patrick Mahomes/);

  const both = fmt({ adds: { '11646': 8 }, drops: { '4046': 8 } }).lines[0];
  assert.match(both, /added Puka Nacua/);
  assert.match(both, /dropped Patrick Mahomes/);
});

test('a chopped roster is summarised, not enumerated', () => {
  // 17 players released at once. Listing them would be a wall of text nobody reads.
  const drops: Record<string, number> = {};
  for (let i = 0; i < 17; i++) drops[`p${i}`] = 15;

  const msg = fmt({ type: 'chopped', roster_ids: [15], drops });
  assert.match(msg.title, /Chopped/);
  assert.match(msg.lines[0], /carol/);
  assert.match(msg.lines[0], /eliminated/);
  assert.match(msg.lines[1], /17 players/);
  assert.ok(!msg.lines.join(' ').includes('p12'), 'individual players must not be listed');
});

test('a long player list is truncated with a count', () => {
  const adds: Record<string, number> = {};
  for (let i = 0; i < 10; i++) adds[`x${i}`] = 8;
  const msg = fmt({ type: 'trade', roster_ids: [8, 9], adds, drops: null });
  assert.match(column(msg, 'alice'), /and 4 more/);
  const waiver = fmt({ adds });
  assert.match(waiver.lines[0], /and 4 more/);
});

test('an unknown player id degrades to its id rather than "undefined"', () => {
  const msg = fmt({ adds: { '999999': 8 } });
  assert.match(msg.lines[0], /player 999999/);
  assert.ok(!/undefined/.test(msg.lines[0]));
});

test('an unknown roster id degrades to a roster number', () => {
  const msg = fmt({ roster_ids: [42], adds: { '11646': 42 } });
  assert.match(msg.lines[0], /Roster 42/);
});

test('an unrecognised transaction type still posts something', () => {
  // Sleeper adding a type must not silently drop real league activity.
  const msg = fmt({ type: 'teleport', adds: { '11646': 8 } });
  assert.match(msg.title, /teleport/);
  assert.match(msg.lines[0], /alice/);
});

test('a team defence renders by its team name', () => {
  const msg = fmt({ adds: { SF: 8 } });
  assert.match(msg.lines[0], /San Francisco 49ers/);
});

test('a truncated column never fuses into the next one', () => {
  /*
   * Seen live: "AggressiveIyAvg" filled a 13-wide column exactly, so the row read
   * "AggressiveIyAegruis" — two values with no separator, unreadable. A truncated value must keep a
   * trailing space.
   */
  const row = pad('AggressiveIyAvg', 13) + pad('egruis', 13);
  assert.ok(!row.includes('AggressiveIyAegruis'), row);
  assert.match(row, /AggressiveIy egruis/);
  // Untruncated values are unaffected.
  assert.equal(pad('bob', 6), 'bob   ');
  // And the column is still exactly the width asked for.
  assert.equal(pad('AggressiveIyAvg', 13).length, 13);
});
