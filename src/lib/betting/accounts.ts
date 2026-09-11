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
  /** Which league's bankroll this movement belongs to. */
  league_id: string | null;
  amount_cents: number;
  reason: LedgerReason;
  ref_id: string | null;
  created_at: string;
};

export type LeagueBankroll = {
  leagueId: string;
  season: string;
  balanceCents: number;
};

/**
 * Case-insensitive on purpose. Usernames come from Sleeper display names, which are
 * mostly lowercase, and people naturally capitalise when typing them into a login
 * box — a plain `=` comparison in SQLite is case-sensitive, so "Cemisme" silently
 * failed for an account stored as "cemisme" and looked like a wrong password.
 */
export function findAccountByUsername(username: string): Account | undefined {
  return getDb()
    .prepare('SELECT * FROM accounts WHERE username = ? COLLATE NOCASE')
    .get(username.trim()) as Account | undefined;
}

export function findAccountById(accountId: string): Account | undefined {
  return getDb()
    .prepare('SELECT * FROM accounts WHERE id = ?')
    .get(accountId) as Account | undefined;
}

/**
 * Appends a ledger row and moves that league's bankroll, in one transaction.
 *
 * The ledger is the source of truth and is never updated or deleted. Two caches sit on top of it
 * so a read does not have to sum the whole history: `account_leagues.balance_cents` is the league
 * bankroll — the number that actually constrains a bet — and `accounts.balance_cents` is the sum
 * across leagues, for a whole-account figure. Both move here, in the same transaction as the
 * ledger row, so they cannot disagree with it.
 *
 * Correct a mistake with a compensating `adjustment` row, never by editing history. Balances are
 * allowed to go negative by design.
 *
 * Throws when the account is not a member of the league. That is deliberate rather than a silent
 * no-op: crediting a bankroll that does not exist would write a ledger row against money nobody
 * can ever see, and money that exists only in the ledger is the worst possible failure here.
 */
export function creditAccount(
  accountId: string,
  leagueId: string,
  amountCents: number,
  reason: LedgerReason,
  refId?: string,
): number {
  const db = getDb();
  const apply = db.transaction(() => {
    const membership = db
      .prepare('SELECT 1 AS ok FROM account_leagues WHERE account_id = ? AND league_id = ?')
      .get(accountId, leagueId) as { ok: number } | undefined;
    if (!membership) {
      throw new Error(`Account ${accountId} has no bankroll in league ${leagueId}`);
    }

    db.prepare(
      `INSERT INTO ledger (id, account_id, league_id, amount_cents, reason, ref_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), accountId, leagueId, amountCents, reason, refId ?? null);

    db.prepare(
      `UPDATE account_leagues SET balance_cents = balance_cents + ?
       WHERE account_id = ? AND league_id = ?`,
    ).run(amountCents, accountId, leagueId);
    db.prepare('UPDATE accounts SET balance_cents = balance_cents + ? WHERE id = ?')
      .run(amountCents, accountId);

    const row = db
      .prepare(
        'SELECT balance_cents FROM account_leagues WHERE account_id = ? AND league_id = ?',
      )
      .get(accountId, leagueId) as { balance_cents: number } | undefined;
    if (!row) throw new Error(`Account ${accountId} not found in league ${leagueId}`);
    return row.balance_cents;
  });
  return apply();
}

/** The bankroll an account may stake in one league, or null if they are not a member. */
export function leagueBalanceCents(accountId: string, leagueId: string): number | null {
  const row = getDb()
    .prepare('SELECT balance_cents FROM account_leagues WHERE account_id = ? AND league_id = ?')
    .get(accountId, leagueId) as { balance_cents: number } | undefined;
  return row ? row.balance_cents : null;
}

/** Every league this account can bet in, with its own bankroll. */
export function leagueBankrolls(accountId: string): LeagueBankroll[] {
  return getDb()
    .prepare(
      `SELECT league_id AS leagueId, season, balance_cents AS balanceCents
       FROM account_leagues WHERE account_id = ? ORDER BY season DESC, league_id`,
    )
    .all(accountId) as LeagueBankroll[];
}

/**
 * Grants the opening bankroll for one league membership, once.
 *
 * Guarded on the ledger rather than on the balance, because a legitimate zero is
 * indistinguishable from an ungranted one — someone who has lost their whole $1,000 must not be
 * handed another. Returns whether it granted, so a caller can report it.
 */
export function ensureLeagueGrant(accountId: string, leagueId: string): boolean {
  const db = getDb();
  const already = db
    .prepare(
      `SELECT 1 AS ok FROM ledger
       WHERE account_id = ? AND league_id = ? AND reason = 'initial_grant'`,
    )
    .get(accountId, leagueId) as { ok: number } | undefined;
  if (already) return false;
  creditAccount(accountId, leagueId, START_BALANCE_CENTS, 'initial_grant');
  return true;
}

/** `leagueId` narrows the ledger to one bankroll; omit it for the whole account. */
export function getLedger(accountId: string, limit = 100, leagueId?: string): LedgerEntry[] {
  const db = getDb();
  if (leagueId) {
    return db
      .prepare(
        `SELECT * FROM ledger WHERE account_id = ? AND league_id = ?
         ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .all(accountId, leagueId, limit) as LedgerEntry[];
  }
  return db
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

    /*
     * First-time setup is when the opening balance lands — now once PER LEAGUE, since each has its
     * own bankroll. Guarded on a ledger row for that league, so a re-issued token cannot double
     * anything, and someone added to a second league later gets that league's grant without
     * touching the first.
     */
    const leagues = db
      .prepare('SELECT league_id FROM account_leagues WHERE account_id = ?')
      .all(account.id) as { league_id: string }[];

    for (const { league_id: leagueId } of leagues) {
      const granted = db
        .prepare(
          `SELECT 1 AS ok FROM ledger
           WHERE account_id = ? AND league_id = ? AND reason = 'initial_grant'`,
        )
        .get(account.id, leagueId) as { ok: number } | undefined;
      if (granted) continue;

      db.prepare(
        `INSERT INTO ledger (id, account_id, league_id, amount_cents, reason)
         VALUES (?, ?, ?, ?, 'initial_grant')`,
      ).run(randomUUID(), account.id, leagueId, START_BALANCE_CENTS);
      db.prepare(
        `UPDATE account_leagues SET balance_cents = balance_cents + ?
         WHERE account_id = ? AND league_id = ?`,
      ).run(START_BALANCE_CENTS, account.id, leagueId);
      db.prepare('UPDATE accounts SET balance_cents = balance_cents + ? WHERE id = ?')
        .run(START_BALANCE_CENTS, account.id);
    }

    return db.prepare('SELECT * FROM accounts WHERE id = ?').get(account.id) as Account;
  });

  return run();
}
