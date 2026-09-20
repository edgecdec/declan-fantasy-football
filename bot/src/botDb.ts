import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

/**
 * The bot's own tiny database.
 *
 * SEPARATE FILE from data/betting.db, and that separation is the point rather than an accident:
 *
 *  - the bot can be restarted, wiped or moved without touching money
 *  - the nightly ledger backup stays about the ledger
 *  - the bot never holds a write handle on the database that records balances, so no bug here can
 *    corrupt one there
 *
 * What it stores is ONLY channel bindings: which league posts where, and which event types. It
 * stores NO league transaction state at all — no seen-ids table, no cursor, nothing. Deduplication
 * is an in-memory Set that dies with the process, by explicit requirement: notifications are a
 * stream, and anything missed while the bot was down is dropped rather than caught up. See
 * transactionStream.ts for how a restart avoids reposting the week.
 */

/** Overridable so a test gets its own file per process, mirroring BETTING_DB_DIR in src/lib/db.ts. */
function botDbPath(): string {
  if (process.env.BOT_DB_PATH) return process.env.BOT_DB_PATH;
  if (process.env.BOT_DB_DIR) {
    return path.join(process.env.BOT_DB_DIR, `bot-test-${process.pid}.db`);
  }
  return path.join(process.cwd(), 'bot', 'data', 'bot.db');
}

let db: Database.Database | undefined;

export function getBotDb(): Database.Database {
  if (!db) {
    const file = botDbPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    db = new Database(file);
    db.pragma('journal_mode = WAL');
    initBotDb(db);
  }
  return db;
}

function initBotDb(database: Database.Database): void {
  database.exec(`
    /*
     * Which league's activity posts to which channel.
     *
     * Keyed (guild_id, league_id): one guild may watch several leagues, and one league may be
     * watched by several guilds, but a guild cannot bind the same league twice. Channel is a
     * column rather than part of the key on purpose -- rebinding a league to a different channel is
     * an UPDATE, not a second subscription that would double-post.
     *
     * league_id is NOT constrained to the betting leagues. The whole reason this table exists is
     * that notifications must work for any league an admin names, including ones with no betting.
     */
    CREATE TABLE IF NOT EXISTS guild_subscriptions (
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      league_id TEXT NOT NULL,
      league_name TEXT,
      -- JSON array of transaction types: trade, waiver, free_agent, commissioner, chopped
      event_types TEXT NOT NULL,
      -- Measured: 267 of 810 real transactions were 'failed' waiver claims. Announcing those
      -- unfiltered makes a third of all messages "someone missed a player", so it is opt-in.
      include_failed INTEGER NOT NULL DEFAULT 0,
      -- Suppress trivial FAAB claims. 0 posts everything.
      min_faab INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (guild_id, league_id)
    );

    CREATE INDEX IF NOT EXISTS idx_subs_league ON guild_subscriptions(league_id);
  `);

  /*
   * Additive migrations, same approach as src/lib/db.ts. CREATE TABLE IF NOT EXISTS does nothing to
   * a table that already exists, so a new column on a live binding has to be added explicitly or it
   * silently will not be there.
   */
  /*
   * JSON map of transaction type -> role id, so a league can ping one role for trades and a
   * different one (or nobody) for waivers. A single role column plus a list of types could not
   * express that, and "one role per league-event-type combo" is the actual requirement.
   *
   * A map rather than its own table: it is at most five entries, it is never queried BY role, and it
   * is read and written whole alongside the rest of the binding.
   */
  addColumnIfMissing(database, 'guild_subscriptions', 'ping_roles', 'TEXT');
}

function addColumnIfMissing(
  database: Database.Database,
  table: string,
  column: string,
  type: string,
): void {
  const cols = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (cols.some(c => c.name === column)) return;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

/** Test seam: drops the handle so a fresh path is picked up. */
export function closeBotDb(): void {
  db?.close();
  db = undefined;
}
