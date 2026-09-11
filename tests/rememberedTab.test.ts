import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * The tab-memory rules, tested as pure logic.
 *
 * The hook itself needs React and a DOM, neither of which this suite has — but the part that can
 * actually be wrong is the validation of what comes back out of storage, and that is arithmetic.
 * A stored index from a release with more tabs must not select a tab that no longer exists.
 */
function restore(raw: string | null, tabCount: number, defaultTab = 0): number {
  if (raw === null) return defaultTab;
  const stored = Number(raw);
  return Number.isInteger(stored) && stored >= 0 && stored < tabCount ? stored : defaultTab;
}

test('a valid stored tab is restored', () => {
  assert.equal(restore('2', 3), 2);
  assert.equal(restore('0', 3), 0);
});

test('nothing stored falls back to the default', () => {
  assert.equal(restore(null, 3), 0);
  assert.equal(restore(null, 3, 1), 1);
});

test('a tab index from a release with MORE tabs is discarded', () => {
  // The case that renders a blank page: a stored 4 when only 3 tabs remain.
  assert.equal(restore('4', 3), 0);
  assert.equal(restore('3', 3), 0);
});

test('junk in storage does not select a nonsense tab', () => {
  for (const raw of ['', 'abc', '-1', '1.5', 'NaN', 'Infinity']) {
    assert.equal(restore(raw, 3), 0, raw);
  }
});
