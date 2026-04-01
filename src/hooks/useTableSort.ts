'use client';

import { useState, useMemo, useCallback } from 'react';

export type SortOrder = 'asc' | 'desc';

function getValue(obj: unknown, key: string): unknown {
  if (key.includes('.')) {
    let val: unknown = obj;
    for (const k of key.split('.')) val = (val as Record<string, unknown>)?.[k];
    return val;
  }
  return (obj as Record<string, unknown>)[key];
}

function compare<T>(a: T, b: T, orderBy: string): number {
  const aRaw = getValue(a, orderBy);
  const bRaw = getValue(b, orderBy);
  if (bRaw == null) return -1;
  if (aRaw == null) return 1;
  const aVal = typeof aRaw === 'string' ? aRaw.toLowerCase() : aRaw;
  const bVal = typeof bRaw === 'string' ? bRaw.toLowerCase() : bRaw;
  if (bVal < aVal) return -1;
  if (bVal > aVal) return 1;
  return 0;
}

export default function useTableSort<T>(
  data: T[],
  defaultOrderBy: string,
  defaultOrder: SortOrder = 'desc'
) {
  const [orderBy, setOrderBy] = useState(defaultOrderBy);
  const [order, setOrder] = useState<SortOrder>(defaultOrder);

  const handleSort = useCallback((property: string) => {
    setOrder(prev => (orderBy === property && prev === 'asc') ? 'desc' : 'asc');
    setOrderBy(property);
  }, [orderBy]);

  const sorted = useMemo(() => {
    const cmp = order === 'desc'
      ? (a: T, b: T) => compare(a, b, orderBy)
      : (a: T, b: T) => -compare(a, b, orderBy);
    return [...data].sort(cmp);
  }, [data, order, orderBy]);

  return { sorted, order, orderBy, handleSort } as const;
}
