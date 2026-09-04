import { randomUUID, createHash, randomBytes } from 'crypto';
import { getDb } from '@/lib/db';
import { START_BALANCE_CENTS } from '@/lib/betting/constants';

export { START_BALANCE_CENTS, NEGATIVE_OPEN_EXPOSURE_CAP_CENTS } from '@/lib/betting/constants';

const SETUP_TOKEN_BYTES = 32;
const SETUP_TOKEN_TTL_DAYS = 7;

export type LedgerReason =
  | 'initial_grant'
  | 'wager_place'
  | 'wager_win'
  | 'wager_void'
  | 'adjustment';

export type Account = {
  id: string;
  sleeper_user_id: string;
  username: string;
  display_name: string;
  password_hash: string | null;
  is_admin: number;
  balance_cents: number;
  created_at: string;
};

export type LedgerEntry = {
  id: string;
  account_id: string;
  amount_cents: number;
  reason: LedgerReason;
  ref_id: string | null;
  created_at: string;
};

export function findAccountByUsername(username: string): Account | undefined {
  return getDb()
    .prepare('SELECT * FROM accounts WHERE username = ?')
    .get(username) as Account | undefined;
}

export function findAccountById(accountId: string): Account | undefined {
  return getDb()
    .prepare('SELECT * FROM accounts WHERE id = ?')
    .get(accountId) as Account | undefined;
}

/**
 * Appends a ledger row and moves the cached balance in one transaction.
 *
 * The ledger is the source of truth and is never updated or deleted;
 * `accounts.balance_cents` is a cache so the dashboard doesn't sum the whole
 * history on every read. Correct a mistake with a compensating `adjustment`
 * row, never by editing history. Balances are allowed to go negative by design.
 */
export function creditAccount(
  accountId: string,
  amountCents: number,
  reason: LedgerReason,
  refId?: string,
): number {
  const db = getDb();
  const apply = db.transaction(() => {
    db.prepare(
      `INSERT INTO ledger (id, account_id, amount_cents, reason, ref_id)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(randomUUID(), accountId, amountCents, reason, refId ?? null);

    db.prepare(
      'UPDATE accounts SET balance_cents = balance_cents + ? WHERE id = ?',
    ).run(amountCents, accountId);

    const row = db
      .prepare('SELECT balance_cents FROM accounts WHERE id = ?')
      .get(accountId) as { balance_cents: number } | undefined;
    if (!row) throw new Error(`Account ${accountId} not found`);
    return row.balance_cents;
  });
  return apply();
}

export function getLedger(accountId: string, limit = 100): LedgerEntry[] {
  return getDb()
    .prepare(
      `SELECT * FROM ledger WHERE account_id = ?
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(accountId, limit) as LedgerEntry[];
}

function hashSetupToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Issues a single-use setup link token, invalidating any earlier unused one for
 * the account. Only the hash is stored, so a database leak yields no working
 * links.
 */
export function issueSetupToken(accountId: string): string {
  const db = getDb();
  const raw = randomBytes(SETUP_TOKEN_BYTES).toString('base64url');
  const expires = new Date(Date.now() + SETUP_TOKEN_TTL_DAYS * 86_400_000).toISOString();

  db.transaction(() => {
    db.prepare('DELETE FROM setup_tokens WHERE account_id = ? AND used_at IS NULL').run(accountId);
    db.prepare(
      'INSERT INTO setup_tokens (token_hash, account_id, expires_at) VALUES (?, ?, ?)',
    ).run(hashSetupToken(raw), accountId, expires);
  })();

  return raw;
}

/** Resolves a raw setup token to its account, or null if unusable. */
export function resolveSetupToken(raw: string): Account | null {
  if (!raw) return null;
  const row = getDb()
    .prepare(
      `SELECT account_id, expires_at, used_at FROM setup_tokens WHERE token_hash = ?`,
    )
    .get(hashSetupToken(raw)) as
    | { account_id: string; expires_at: string; used_at: string | null }
    | undefined;

  if (!row || row.used_at) return null;
  if (Date.parse(row.expires_at) < Date.now()) return null;
  return findAccountById(row.account_id) ?? null;
}

/**
 * Consumes a setup token: sets the password, marks the token used, and grants
 * the opening balance — all atomically, so a crash mid-way can never grant
 * twice or leave a usable token behind.
 */
export function completeSetup(raw: string, passwordHash: string): Account | null {
  const db = getDb();
  const tokenHash = hashSetupToken(raw);

  const run = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT account_id, expires_at, used_at FROM setup_tokens WHERE token_hash = ?`,
      )
      .get(tokenHash) as
      | { account_id: string; expires_at: string; used_at: string | null }
      | undefined;

    if (!row || row.used_at) return null;
    if (Date.parse(row.expires_at) < Date.now()) return null;

    const account = db
      .prepare('SELECT * FROM accounts WHERE id = ?')
      .get(row.account_id) as Account | undefined;
    if (!account) return null;

    db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').run(
      passwordHash,
      account.id,
    );
    db.prepare(
      "UPDATE setup_tokens SET used_at = datetime('now') WHERE token_hash = ?",
    ).run(tokenHash);

    // First-time setup is also when the opening balance lands. Guarded on the
    // account never having had a grant, so a re-issued token can't double it.
    const granted = db
      .prepare(
        "SELECT 1 AS ok FROM ledger WHERE account_id = ? AND reason = 'initial_grant'",
      )
      .get(account.id) as { ok: number } | undefined;

    if (!granted) {
      db.prepare(
        `INSERT INTO ledger (id, account_id, amount_cents, reason)
         VALUES (?, ?, ?, 'initial_grant')`,
      ).run(randomUUID(), account.id, START_BALANCE_CENTS);
      db.prepare(
        'UPDATE accounts SET balance_cents = balance_cents + ? WHERE id = ?',
      ).run(START_BALANCE_CENTS, account.id);
    }

    return db.prepare('SELECT * FROM accounts WHERE id = ?').get(account.id) as Account;
  });

  return run();
}
