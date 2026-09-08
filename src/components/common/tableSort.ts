/**
 * Sorting for the shared table.
 *
 * Deliberately free of React and MUI imports so it can be unit-tested in plain Node.
 * Every table on the site runs through this comparator, so a regression here is a
 * regression everywhere — that is worth being able to test without rendering anything.
 */

export type Order = 'asc' | 'desc';

/** The part of a column definition that sorting cares about. */
export type SortableColumn<T> = {
  /** Also the sort key: a plain field name, or a dotted path into the row. */
  id: string;
  /**
   * What this column sorts by, when that is not simply the value at `id`.
   *
   * Needed whenever the useful ordering is derived rather than stored — magnitude of a
   * signed number, or distance from a coin flip. Also the escape hatch for a `render`-only
   * column with no backing field: without it the comparator reads undefined for every row
   * and the sort silently does nothing.
   */
  sortValue?: (row: T) => number | string | null;
};

function valueFor<T>(row: T, orderBy: string, column?: SortableColumn<T>): unknown {
  // A column's own accessor wins over the path lookup.
  if (column?.sortValue) return column.sortValue(row);

  if (orderBy.includes('.')) {
    return orderBy.split('.').reduce<unknown>(
      (acc, key) => (acc == null ? undefined : (acc as Record<string, unknown>)[key]),
      row,
    );
  }
  return (row as Record<string, unknown>)[orderBy];
}

export function descendingComparator<T>(
  a: T,
  b: T,
  orderBy: string,
  column?: SortableColumn<T>,
): number {
  let aValue = valueFor(a, orderBy, column);
  let bValue = valueFor(b, orderBy, column);

  // Missing values sort to the bottom in whichever direction is being applied, rather than
  // jumping to the top of an ascending sort.
  const aMissing = aValue === null || aValue === undefined;
  const bMissing = bValue === null || bValue === undefined;
  if (aMissing && bMissing) return 0;
  if (bMissing) return -1;
  if (aMissing) return 1;

  if (typeof aValue === 'string') aValue = aValue.toLowerCase();
  if (typeof bValue === 'string') bValue = bValue.toLowerCase();

  if ((bValue as number) < (aValue as number)) return -1;
  if ((bValue as number) > (aValue as number)) return 1;
  return 0;
}

export function getComparator<T>(
  order: Order,
  orderBy: string,
  columns?: SortableColumn<T>[],
): (a: T, b: T) => number {
  const column = columns?.find(c => c.id === orderBy);
  return order === 'desc'
    ? (a, b) => descendingComparator(a, b, orderBy, column)
    : (a, b) => -descendingComparator(a, b, orderBy, column);
}
