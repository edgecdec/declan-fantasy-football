import test from 'node:test';
import assert from 'node:assert/strict';
import { SortableColumn, getComparator } from '@/components/common/tableSort';

/**
 * Guards on the shared table's sorting. Every page's tables run through this, so a
 * regression here is a regression everywhere.
 */

type Row = {
  name: string;
  score: number;
  signed: number;
  nested: { deep: { value: number } };
  maybe: number | null;
};

const rows: Row[] = [
  { name: 'Charlie', score: 10, signed: -8, nested: { deep: { value: 3 } }, maybe: 5 },
  { name: 'alice', score: 30, signed: 2, nested: { deep: { value: 1 } }, maybe: null },
  { name: 'Bob', score: 20, signed: -1, nested: { deep: { value: 2 } }, maybe: 9 },
];

const sortBy = (id: string, order: 'asc' | 'desc', columns?: SortableColumn<Row>[]) =>
  [...rows].sort(getComparator<Row>(order, id, columns)).map(r => r.name);

test('sorts a plain numeric field both ways', () => {
  assert.deepEqual(sortBy('score', 'desc'), ['alice', 'Bob', 'Charlie']);
  assert.deepEqual(sortBy('score', 'asc'), ['Charlie', 'Bob', 'alice']);
});

test('string sorting is case-insensitive', () => {
  // Without lowercasing, 'Bob' and 'Charlie' would both sort before 'alice' on ASCII.
  assert.deepEqual(sortBy('name', 'asc'), ['alice', 'Bob', 'Charlie']);
});

test('sorts through a dotted path', () => {
  assert.deepEqual(sortBy('nested.deep.value', 'desc'), ['Charlie', 'Bob', 'alice']);
});

test('sortValue overrides the field lookup', () => {
  // The headline case: order by MAGNITUDE of a signed number, so the strongest feelings in
  // either direction come together at the top.
  const columns: SortableColumn<Row>[] = [
    { id: 'signed', sortValue: r => Math.abs(r.signed) },
  ];
  assert.deepEqual(sortBy('signed', 'desc', columns), ['Charlie', 'alice', 'Bob']);
  // Without the override the same id sorts by the signed value instead.
  assert.deepEqual(sortBy('signed', 'desc'), ['alice', 'Bob', 'Charlie']);
});

test('sortValue works for a column with no backing field at all', () => {
  // A render-only column: before sortValue the comparator read undefined for every row and
  // the sort silently did nothing.
  const columns: SortableColumn<Row>[] = [
    { id: 'derived', sortValue: r => r.score * -1 },
  ];
  assert.deepEqual(sortBy('derived', 'desc', columns), ['Charlie', 'Bob', 'alice']);
  // Proof of the bug it fixes: same id, no sortValue, no reordering.
  const untouched = sortBy('derived', 'desc');
  assert.deepEqual(untouched, rows.map(r => r.name), 'a fieldless id must be inert without sortValue');
});

test('sortValue may return a string', () => {
  const columns: SortableColumn<Row>[] = [
    { id: 'initial', sortValue: r => r.name.slice(-1).toLowerCase() },
  ];
  // last letters: Charlie->e, alice->e, Bob->b
  assert.equal(sortBy('initial', 'asc', columns)[0], 'Bob');
});

test('a column without sortValue still uses its own id, not another column\'s', () => {
  const columns: SortableColumn<Row>[] = [
    { id: 'signed', sortValue: r => Math.abs(r.signed) },
    { id: 'score' },
  ];
  // Sorting by 'score' must not pick up the 'signed' column's accessor.
  assert.deepEqual(sortBy('score', 'desc', columns), ['alice', 'Bob', 'Charlie']);
});

test('null and undefined values do not throw and do not win the top spot', () => {
  const desc = sortBy('maybe', 'desc');
  assert.equal(desc[desc.length - 1], 'alice', 'the null should not outrank real values descending');
  // Same via sortValue, which is the path a derived column takes.
  const columns: SortableColumn<Row>[] = [
    { id: 'maybe', sortValue: r => r.maybe },
  ];
  assert.deepEqual(sortBy('maybe', 'desc', columns), desc);
});

test('sorting is not affected by passing columns that do not include the sort key', () => {
  const columns: SortableColumn<Row>[] = [{ id: 'name' }];
  assert.deepEqual(sortBy('score', 'desc', columns), ['alice', 'Bob', 'Charlie']);
});

test('the comparator never reorders equal values (stable within ties)', () => {
  const tied: Row[] = [
    { name: 'first', score: 1, signed: 0, nested: { deep: { value: 0 } }, maybe: 0 },
    { name: 'second', score: 1, signed: 0, nested: { deep: { value: 0 } }, maybe: 0 },
    { name: 'third', score: 1, signed: 0, nested: { deep: { value: 0 } }, maybe: 0 },
  ];
  const out = [...tied].sort(getComparator<Row>('desc', 'score')).map(r => r.name);
  assert.deepEqual(out, ['first', 'second', 'third']);
});
