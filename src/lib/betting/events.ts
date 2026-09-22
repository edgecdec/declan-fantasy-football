import type { Database } from 'better-sqlite3';
import { getDb } from '@/lib/db';

/**
 * The bet event outbox.
 *
 * Every function here takes an explicit `db` handle rather than calling `getDb()` itself, because
 * the whole point is to write the event INSIDE the caller's existing transaction. better-sqlite3
 * transactions are per-connection, so grabbing the singleton separately would put the event outside
 * the transaction it is supposed to be atomic with — and the failure would be invisible until a
 * rollback left an event describing something that never happened.
 *
 * Reads take no handle and use the singleton, since a read needs no transaction.
 */

export type BetEventType =
  | 'wager_placed'
  | 'market_settled'
  | 'wager_won'
  | 'wager_lost'
  | 'wager_void'
  /** One per league week, when the last market settles. The readable summary of the week. */
  | 'week_settled'
  | 'line_moved';

export type BetEvent = {
  id: number;
  type: BetEventType;
  leagueId: string;
  season: number;
  week: number;
  refId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  discordMessageId: string | null;
};

type InsertArgs = {
  type: BetEventType;
  leagueId: string;
  season: number | string;
  week: number;
  /** The wager or market this concerns, so a reader can join without parsing the payload. */
  refId?: string | null;
  payload: Record<string, unknown>;
};

/**
 * Appends one event. MUST be called from inside the transaction that made the change.
 *
 * Returns the new id so a caller can correlate, though nothing needs that yet.
 */
export function recordBetEvent(db: Database, args: InsertArgs): number {
  const info = db
    .prepare(
      `INSERT INTO bet_events (type, league_id, season, week, ref_id, payload)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      args.type,
      args.leagueId,
      Number(args.season),
      args.week,
      args.refId ?? null,
      JSON.stringify(args.payload),
    );
  return Number(info.lastInsertRowid);
}

type Row = {
  id: number;
  type: string;
  league_id: string;
  season: number;
  week: number;
  ref_id: string | null;
  payload: string;
  created_at: string;
  discord_message_id: string | null;
};

function hydrate(row: Row): BetEvent {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(row.payload) as Record<string, unknown>;
  } catch {
    // A malformed payload must not break the cursor. The event still happened, and its type and
    // ref_id — the parts a reader routes on — are columns, not payload.
    payload = { malformed: row.payload };
  }
  return {
    id: row.id,
    type: row.type as BetEventType,
    leagueId: row.league_id,
    season: row.season,
    week: row.week,
    refId: row.ref_id,
    payload,
    createdAt: row.created_at,
    discordMessageId: row.discord_message_id,
  };
}

/**
 * Events after `afterId`, oldest first — the cursor read.
 *
 * Ascending on purpose: a watcher must process in the order things happened, and it advances its
 * cursor to the last id it handled. Descending would make "everything I have not seen" impossible
 * to express.
 */
export function betEventsAfter(afterId: number, limit = 200): BetEvent[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM bet_events WHERE id > ? ORDER BY id ASC LIMIT ?`,
    )
    .all(afterId, Math.min(1000, Math.max(1, limit))) as Row[];
  return rows.map(hydrate);
}

/** The highest id, so a fresh watcher can start at "now" instead of replaying all history. */
export function latestBetEventId(): number {
  const row = getDb().prepare('SELECT MAX(id) AS id FROM bet_events').get() as { id: number | null };
  return row?.id ?? 0;
}

/**
 * Records the Discord message a placement was announced in, so settlement can edit that message
 * rather than posting a second one.
 *
 * The only mutation this table permits. Everything else is append-only — an event describes
 * something that already happened, and rewriting history would desynchronise any cursor that had
 * already read past it.
 */
export function attachDiscordMessage(eventId: number, messageId: string): void {
  getDb()
    .prepare('UPDATE bet_events SET discord_message_id = ? WHERE id = ?')
    .run(messageId, eventId);
}
