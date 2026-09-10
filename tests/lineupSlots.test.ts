import test from 'node:test';
import assert from 'node:assert/strict';
import { slotLabel, startingSlots, starterSlotLabel } from '@/services/stats/lineupSlots';

/**
 * Naming the slot a lineup is missing.
 *
 * The alignment is the part that can silently be wrong: a roster's `starters` array lines up with
 * the NON-BENCH entries of `roster_positions`, so failing to strip bench slots names the wrong
 * slot for every starter after the first bench entry — and names it confidently.
 */

/** A real Sleeper shape: bench and IR entries sit in the middle and at the end. */
const POSITIONS = [
  'QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'K', 'DEF',
  'BN', 'BN', 'BN', 'BN', 'BN', 'IR',
];

test('bench, IR and taxi slots are excluded from the starting order', () => {
  assert.deepEqual(
    startingSlots(POSITIONS),
    ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'K', 'DEF'],
  );
  assert.deepEqual(startingSlots(['QB', 'TAXI', 'BN', 'IR', 'DEF']), ['QB', 'DEF']);
});

test('a starter index maps to the slot at that position', () => {
  assert.equal(starterSlotLabel(POSITIONS, 0), 'QB');
  assert.equal(starterSlotLabel(POSITIONS, 6), 'FLEX');
  assert.equal(starterSlotLabel(POSITIONS, 7), 'SUPERFLEX');
  assert.equal(starterSlotLabel(POSITIONS, 9), 'DEF');
});

test('a bench slot in the middle does not shift the labels after it', () => {
  // The bug this guards. With BN left in, index 2 would be 'BN' and every later label wrong.
  const withMidBench = ['QB', 'RB', 'BN', 'WR', 'DEF'];
  assert.equal(starterSlotLabel(withMidBench, 2), 'WR');
  assert.equal(starterSlotLabel(withMidBench, 3), 'DEF');
});

test('an index the roster shape cannot explain returns null, not a guess', () => {
  // A confidently wrong slot name is worse than admitting the league did not say.
  assert.equal(starterSlotLabel(POSITIONS, 10), null);
  assert.equal(starterSlotLabel(POSITIONS, -1), null);
  assert.equal(starterSlotLabel([], 0), null);
  assert.equal(starterSlotLabel(undefined, 0), null);
  assert.equal(starterSlotLabel(null, 0), null);
});

test('machine slot names are written the way a reader says them', () => {
  assert.equal(slotLabel('SUPER_FLEX'), 'SUPERFLEX');
  assert.equal(slotLabel('REC_FLEX'), 'REC FLEX');
  assert.equal(slotLabel('WRRB_FLEX'), 'WR/RB FLEX');
  assert.equal(slotLabel('IDP_FLEX'), 'IDP FLEX');
  assert.equal(slotLabel('QB'), 'QB');
});

test('an unknown slot degrades to something legible rather than undefined', () => {
  // Sleeper can add a slot type; the label must not come out blank or crash the message.
  assert.equal(slotLabel('SOME_NEW_FLEX'), 'SOME NEW FLEX');
  assert.equal(slotLabel('XYZ'), 'XYZ');
});
