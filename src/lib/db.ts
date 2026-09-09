import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

/**
 * SQLite store for the Declan Dollars betting feature.
 *
 * Lives under data/ alongside the committed player JSON, but is gitignored via
 * the `data/*.db*` rules — deploy_webhook.sh uses `git reset --hard` and never
 * `git clean`, so an ignored file here survives every deploy.
 */
/**
 * Resolved lazily so a test can point at a scratch file, and read at call time rather than at
 * module load because the compiled test sets the variable after the import is evaluated.
 *
 * BETTING_DB_DIR gives each PROCESS its own database. `node --test` runs each test file in its
 * own process against the same file otherwise, and SQLite refuses concurrent writers — three
 * files touching the ledger was enough to fail with SQLITE_BUSY. Per-process also stops one
 * file's seeded rows from being visible to another's assertions, which is the subtler half of
 * the same problem.
 */
function dbPath(): string {
  if (process.env.BETTING_DB_PATH) return process.env.BETTING_DB_PATH;
  if (process.env.BETTING_DB_DIR) {
    return path.join(process.env.BETTING_DB_DIR, `test-${process.pid}.db`);
  }
  return path.join(process.cwd(), 'data', 'betting.db');
}

let db: Database.Database | undefined;

export function getDb(): Database.Database {
  if (!db) {
    const file = dbPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    db = new Database(file);
    // WAL keeps readers from blocking on the writer, and makes a pm2 restart
    // mid-write safe rather than leaving a half-applied transaction.
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initDb(db);
  }
  return db;
}

function initDb(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      sleeper_user_id TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      password_hash TEXT,
      is_admin INTEGER NOT NULL DEFAULT 0,
      balance_cents INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS account_leagues (
      account_id TEXT NOT NULL REFERENCES accounts(id),
      league_id TEXT NOT NULL,
      season TEXT NOT NULL,
      PRIMARY KEY (account_id, league_id)
    );

    CREATE TABLE IF NOT EXISTS setup_tokens (
      token_hash TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ledger (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      amount_cents INTEGER NOT NULL,
      reason TEXT NOT NULL,
      ref_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- One row per head-to-head matchup we take action on. The server writes the
    -- price here; a wager references this row rather than carrying a price from
    -- the client, which would be trivially forged.
    CREATE TABLE IF NOT EXISTS markets (
      id TEXT PRIMARY KEY,
      league_id TEXT NOT NULL,
      season TEXT NOT NULL,
      week INTEGER NOT NULL,
      matchup_id INTEGER NOT NULL,
      roster_a INTEGER NOT NULL,
      roster_b INTEGER NOT NULL,
      -- Sleeper user ids, so we can refuse a bet on your own matchup.
      owner_a TEXT,
      owner_b TEXT,
      prob_a REAL NOT NULL,
      price_a INTEGER NOT NULL,
      price_b INTEGER NOT NULL,
      -- open | closed | settled | void
      status TEXT NOT NULL DEFAULT 'open',
      -- 'a' | 'b' | 'push', set at settlement
      winner TEXT,
      remaining_minutes REAL NOT NULL DEFAULT 0,
      priced_at TEXT NOT NULL DEFAULT (datetime('now')),
      settled_at TEXT,
      UNIQUE (league_id, season, week, matchup_id)
    );

    -- Small key/value store. Currently just the settlement sweep's last-run
    -- timestamp, kept in the DB rather than in memory so a pm2 restart doesn't
    -- reset the debounce and let a redeploy hammer ESPN.
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS wagers (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      market_id TEXT NOT NULL REFERENCES markets(id),
      side TEXT NOT NULL,
      stake_cents INTEGER NOT NULL,
      -- American odds locked in at placement; later re-pricing must not move it.
      price INTEGER NOT NULL,
      to_win_cents INTEGER NOT NULL,
      -- open | won | lost | void
      status TEXT NOT NULL DEFAULT 'open',
      placed_at TEXT NOT NULL DEFAULT (datetime('now')),
      settled_at TEXT
    );

    /*
     * Raw NFL plays as captured from Sleeper's GraphQL feed.
     *
     * Stored raw — metadata and stats as JSON, never pre-scored — because the same play has to
     * be re-scored in every league's own settings, and a league can change its scoring. Baking
     * points in at capture time would make the store useless the moment a setting moved.
     *
     * first_seen_at is our own observation time, not Sleeper's. The gap between it and
     * play_time is the live latency of the feed, which is the one thing that cannot be measured
     * after the fact -- so it is recorded on the way in. (No backticks in here: this whole block
     * lives inside a JS template literal and a backtick would end it.)
     */
    CREATE TABLE IF NOT EXISTS nfl_plays (
      play_id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL,
      season TEXT NOT NULL,
      week INTEGER NOT NULL,
      -- Sleeper's ordering key within a game.
      sequence INTEGER,
      -- Sleeper's epoch-ms timestamp for the play itself.
      play_time INTEGER,
      metadata TEXT NOT NULL,
      play_stats TEXT NOT NULL,
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_plays_week ON nfl_plays(season, week, sequence);
    CREATE INDEX IF NOT EXISTS idx_plays_game ON nfl_plays(game_id, sequence);
    CREATE INDEX IF NOT EXISTS idx_plays_seen ON nfl_plays(first_seen_at);

    CREATE INDEX IF NOT EXISTS idx_ledger_account ON ledger(account_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_setup_tokens_account ON setup_tokens(account_id);
    CREATE INDEX IF NOT EXISTS idx_markets_week ON markets(league_id, season, week);
    CREATE INDEX IF NOT EXISTS idx_wagers_account ON wagers(account_id, placed_at);
    CREATE INDEX IF NOT EXISTS idx_wagers_market ON wagers(market_id, status);
  `);

  addColumnIfMissing(database, 'markets', 'final_a', 'REAL');
  addColumnIfMissing(database, 'markets', 'final_b', 'REAL');
  // Manager names frozen at pricing time, so bet history stays readable without
  // re-resolving owner ids against Sleeper — and still reads correctly if someone
  // renames themselves after the bet was struck.
  addColumnIfMissing(database, 'markets', 'name_a', 'TEXT');
  addColumnIfMissing(database, 'markets', 'name_b', 'TEXT');
}

/**
 * Additive migration. The DB already holds real balances on the VPS, so schema
 * changes have to be applied in place rather than by recreating a table.
 */
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
