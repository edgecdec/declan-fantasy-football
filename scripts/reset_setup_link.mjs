/**
 * Issues a fresh setup link for one manager, so they can set a new password.
 *
 * For the ordinary case of someone fumbling their first setup: a link is single-use, so once it is
 * consumed there is no way back in without a new one. There is no self-service password reset (no
 * email addresses anywhere), which makes this the recovery path.
 *
 * What it deliberately does NOT touch: balances, the ledger, or wagers. Setting a password again
 * cannot re-grant the opening bankroll either — completeSetup guards that on an `initial_grant`
 * ledger row per league, so the money is granted exactly once whatever happens to the password.
 * That guard is verified below rather than assumed, and the script says which case it is in.
 *
 *   node scripts/reset_setup_link.mjs <username>
 */
import Database from 'better-sqlite3';
import { randomBytes, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SETUP_TOKEN_BYTES = 32;
const SETUP_TOKEN_TTL_DAYS = 7;
const BASE_URL = process.env.SITE_URL || 'https://fantasyfootball.edgecdec.com';
const DB_PATH = path.join(process.cwd(), 'data', 'betting.db');

const username = process.argv[2];
if (!username) {
  console.error('usage: node scripts/reset_setup_link.mjs <username>');
  process.exit(1);
}
if (!fs.existsSync(DB_PATH)) {
  console.error(`No database at ${DB_PATH}. Run this from the app directory.`);
  process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Case-insensitive, matching findAccountByUsername: Sleeper display names are mostly lowercase and
// people capitalise when typing them.
const account = db
  .prepare('SELECT * FROM accounts WHERE username = ? COLLATE NOCASE')
  .get(username);

if (!account) {
  console.error(`No account for "${username}". Names are as they appear on Sleeper.`);
  const near = db
    .prepare('SELECT username FROM accounts ORDER BY username')
    .all()
    .map(r => r.username);
  console.error(`Known accounts: ${near.join(', ')}`);
  process.exit(1);
}

const grants = db
  .prepare(
    "SELECT league_id, amount_cents FROM ledger WHERE account_id = ? AND reason = 'initial_grant'",
  )
  .all(account.id);
const openWagers = db
  .prepare("SELECT COUNT(*) AS c FROM wagers WHERE account_id = ? AND status = 'open'")
  .get(account.id).c;

const raw = randomBytes(SETUP_TOKEN_BYTES).toString('base64url');
const expires = new Date(Date.now() + SETUP_TOKEN_TTL_DAYS * 86_400_000).toISOString();

db.transaction(() => {
  // Any earlier unused link dies with this one, so only the newest can ever be used.
  db.prepare('DELETE FROM setup_tokens WHERE account_id = ? AND used_at IS NULL').run(account.id);
  db.prepare('INSERT INTO setup_tokens (token_hash, account_id, expires_at) VALUES (?, ?, ?)')
    .run(createHash('sha256').update(raw).digest('hex'), account.id, expires);
})();

const money = c => `$${(c / 100).toFixed(2)}`;
console.log('');
console.log(`${account.display_name} — ${account.password_hash ? 'PASSWORD RESET' : 'first-time setup'}`);
console.log(`  balance untouched at ${money(account.balance_cents)}`);
console.log(`  opening bankroll already granted in ${grants.length} league(s), so it will not repeat`);
if (openWagers > 0) console.log(`  ${openWagers} open wager(s) — unaffected by a password change`);
console.log(`  expires in ${SETUP_TOKEN_TTL_DAYS} days, single use`);
console.log('');
console.log(`${BASE_URL}/betting/setup?token=${raw}`);
console.log('');
