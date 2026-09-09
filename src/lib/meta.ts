import { getDb } from '@/lib/db';

/**
 * Small key/value scratchpad for scheduling state — "when did the last sweep run".
 *
 * It lives in the database rather than in module scope because the process restarts on every
 * deploy, and a debounce that forgets itself on restart is not a debounce.
 */

export function readMeta(key: string): string | undefined {
  const row = getDb().prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function writeMeta(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO meta (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    )
    .run(key, value);
}

/** Seconds since a timestamp stored under `key`, or null if never stored / unparseable. */
export function metaAgeSeconds(key: string): number | null {
  const at = readMeta(key);
  if (!at) return null;
  const age = (Date.now() - Date.parse(at)) / 1000;
  return Number.isFinite(age) ? age : null;
}
