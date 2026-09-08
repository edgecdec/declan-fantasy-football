import test from 'node:test';
import assert from 'node:assert/strict';
import { SleeperDraft } from '@/services/sleeper/sleeperService';
import { compareDraftsBySchedule, formatDraftTime } from '@/services/draft/draftSchedule';

function d(status: string, start_time: number | null, name = 'x'): SleeperDraft {
  return { status, start_time, metadata: { name, description: '' } } as unknown as SleeperDraft;
}
const T = 1788915638000; // a real scheduled draft time

test('an absent or nonsensical start time yields no label rather than 1970', () => {
  for (const bad of [null, undefined, 0, -1, NaN, Infinity]) {
    assert.equal(formatDraftTime(d('pre_draft', bad as number | null)), null, `for ${String(bad)}`);
  }
});

test('imminent and overdue are distinguished, and the boundary is exact', () => {
  const hour = 3_600_000, day = 24 * hour;
  assert.ok(formatDraftTime(d('pre_draft', T), T - 3 * hour)!.imminent);
  assert.ok(!formatDraftTime(d('pre_draft', T), T - 3 * hour)!.overdue);
  assert.ok(formatDraftTime(d('pre_draft', T), T - day)!.imminent, '24h out is still imminent');
  assert.ok(!formatDraftTime(d('pre_draft', T), T - day - 1000)!.imminent, 'past 24h is not');
  const late = formatDraftTime(d('pre_draft', T), T + 2 * hour)!;
  assert.ok(late.overdue && !late.imminent, 'scheduled time passed but still pre_draft');
});

test('a draft already run or running is never flagged imminent or overdue', () => {
  for (const status of ['complete', 'drafting']) {
    const f = formatDraftTime(d(status, T), T + 30 * 86_400_000)!;
    assert.equal(f.relative, null, 'a relative age on a finished draft is noise');
    assert.equal(f.imminent, false);
    assert.equal(f.overdue, false);
    assert.ok(f.absolute.length > 0, 'but it still shows a date');
  }
});

test('upcoming drafts sort soonest-first and finished ones most-recent-first', () => {
  const upcoming = [d('pre_draft', T + 3000), d('pre_draft', T + 1000), d('pre_draft', T + 2000)];
  assert.deepEqual(
    [...upcoming].sort(compareDraftsBySchedule).map(x => x.start_time),
    [T + 1000, T + 2000, T + 3000],
  );
  const finished = [d('complete', T - 3000), d('complete', T - 1000), d('complete', T - 2000)];
  assert.deepEqual(
    [...finished].sort(compareDraftsBySchedule).map(x => x.start_time),
    [T - 1000, T - 2000, T - 3000],
  );
});

test('an undated draft sorts after every dated one in its group', () => {
  // Treating a missing time as zero would park undated leagues at the top and bury the
  // draft happening tonight, which is the bug this ordering exists to prevent.
  const list = [d('pre_draft', null, 'Aardvark'), d('pre_draft', T + 5000), d('pre_draft', null, 'Beta')];
  const sorted = [...list].sort(compareDraftsBySchedule);
  assert.equal(sorted[0].start_time, T + 5000);
  assert.equal(sorted[1].metadata.name, 'Aardvark', 'undated drafts then fall back to name');
  assert.equal(sorted[2].metadata.name, 'Beta');
});

test('status groups never interleave', () => {
  const list = [
    d('complete', T - 1000), d('pre_draft', T + 1000), d('drafting', T),
    d('paused', T), d('complete', T - 2000), d('pre_draft', null),
  ];
  const order = [...list].sort(compareDraftsBySchedule).map(x => x.status);
  assert.deepEqual(order, ['drafting', 'paused', 'pre_draft', 'pre_draft', 'complete', 'complete']);
});

test('the comparator is a valid total order', () => {
  const a = d('pre_draft', T), b = d('pre_draft', null), c = d('weird' as string, null);
  assert.equal(compareDraftsBySchedule(a, a), 0);
  assert.ok(compareDraftsBySchedule(a, b) < 0 && compareDraftsBySchedule(b, a) > 0, 'antisymmetric');
  assert.ok(!Number.isNaN(compareDraftsBySchedule(c, a)), 'unknown status must not produce NaN');
  assert.ok(compareDraftsBySchedule(c, a) > 0, 'unknown status sorts last');
});
