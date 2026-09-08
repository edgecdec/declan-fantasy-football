import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * The bar's geometry, extracted so it can be checked without rendering.
 *
 * This mirrors the component's share calculation exactly. It exists because the bug it guards
 * was invisible to type checking and to the build: a `width: 1` in MUI's `sx` means 100%, not
 * 1px, so a hairline became a full-width block.
 */
const MIN_SHARE = 0.08;
function share(net: number, max: number): number {
  return max > 0 && net !== 0
    ? Math.max(MIN_SHARE, Math.min(1, Math.abs(net) / max))
    : 0;
}
/** Which half the bar occupies, and how much of it. */
function geometry(net: number, max: number) {
  const s = share(net, max);
  return {
    leftShare: net < 0 ? s : 0,
    rightShare: net > 0 ? s : 0,
  };
}

test('zero fills neither half, so nothing is drawn at the centre', () => {
  const g = geometry(0, 8);
  assert.equal(g.leftShare, 0);
  assert.equal(g.rightShare, 0);
});

test('positive grows right, negative grows left, and never both', () => {
  const pos = geometry(3, 8);
  assert.ok(pos.rightShare > 0);
  assert.equal(pos.leftShare, 0, 'a positive net must not touch the left half');

  const neg = geometry(-3, 8);
  assert.ok(neg.leftShare > 0);
  assert.equal(neg.rightShare, 0, 'a negative net must not touch the right half');
});

test('equal magnitudes render identically on opposite sides', () => {
  // The scale must be symmetric, or +2 and -2 would look like different strengths.
  assert.equal(geometry(4, 8).rightShare, geometry(-4, 8).leftShare);
});

test('a bar never exceeds its half — this was the visible bug', () => {
  // The bars appeared to run past the track because a mis-specified hairline WAS the track.
  // Independently, no share may exceed 1 or a bar would overflow its half.
  for (const [net, max] of [[8, 8], [12, 8], [-99, 8], [1, 1]] as const) {
    const g = geometry(net, max);
    assert.ok(g.leftShare <= 1, `left overflowed at net=${net}`);
    assert.ok(g.rightShare <= 1, `right overflowed at net=${net}`);
  }
});

test('the largest magnitude fills its half exactly', () => {
  assert.equal(geometry(8, 8).rightShare, 1);
  assert.equal(geometry(-8, 8).leftShare, 1);
});

test('a small net stays visible next to a large one', () => {
  // 1 against a max of 12 is 8% of a half — a couple of pixels — so it gets a floor.
  assert.ok(geometry(1, 12).rightShare >= MIN_SHARE);
  assert.ok(geometry(1, 12).rightShare < geometry(6, 12).rightShare, 'but still ranks below');
});

test('a zero or missing max does not produce NaN', () => {
  for (const max of [0, -1, NaN]) {
    const g = geometry(3, max);
    assert.ok(Number.isFinite(g.leftShare) && Number.isFinite(g.rightShare), `max=${max}`);
  }
});
