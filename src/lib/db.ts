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
const DB_PATH = path.join(process.cwd(), 'data', 'betting.db');

let db: Database.Database | undefined;

export function getDb(): Database.Database {
  if (!db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new Database(DB_PATH);
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

    CREATE INDEX IF NOT EXISTS idx_ledger_account ON ledger(account_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_setup_tokens_account ON setup_tokens(account_id);
  `);
}
