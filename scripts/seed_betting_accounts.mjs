#!/usr/bin/env node
/**
 * Creates a betting account per member of each league in BETTING_LEAGUES and
 * prints a one-time setup link for each.
 *
 * Run manually on the VPS:
 *   cd /var/www/FantasyFootball && node scripts/seed_betting_accounts.mjs
 *
 * Idempotent by design — re-running never resets an existing password and never
 * re-grants the opening balance. It only issues a fresh link for accounts that
 * still have no password, invalidating any earlier unused link for them.
 *
 * Kept as plain .mjs (not TS) so it runs with bare node on the server, matching
 * how the Python data scripts are invoked.
 */
import Database from 'better-sqlite3';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

const SLEEPER_BASE = 'https://api.sleeper.app/v1';
const SETUP_TOKEN_BYTES = 32;
const SETUP_TOKEN_TTL_DAYS = 7;

// Must stay in sync with src/lib/betting/leagues.ts.
const BETTING_LEAGUES = [
  { leagueId: '1383248044669046784', season: '2026', label: "Graham's Football Fantasy" },
];

const BASE_URL = process.env.SITE_URL || 'https://fantasyfootball.edgecdec.com';
const DB_PATH = path.join(process.cwd(), 'data', 'betting.db');

function openDb() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, sleeper_user_id TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL,
      password_hash TEXT, is_admin INTEGER NOT NULL DEFAULT 0,
      balance_cents INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS account_leagues (
      account_id TEXT NOT NULL REFERENCES accounts(id),
      league_id TEXT NOT NULL, season TEXT NOT NULL,
      PRIMARY KEY (account_id, league_id)
    );
    CREATE TABLE IF NOT EXISTS setup_tokens (
      token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
      expires_at TEXT NOT NULL, used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS ledger (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
      amount_cents INTEGER NOT NULL, reason TEXT NOT NULL, ref_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ledger_account ON ledger(account_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_setup_tokens_account ON setup_tokens(account_id);
  `);
  return db;
}

async function fetchLeagueUsers(leagueId) {
  const res = await fetch(`${SLEEPER_BASE}/league/${leagueId}/users`);
  if (!res.ok) throw new Error(`Sleeper returned ${res.status} for league ${leagueId}`);
  return res.json();
}

function issueSetupToken(db, accountId) {
  const raw = randomBytes(SETUP_TOKEN_BYTES).toString('base64url');
  const hash = createHash('sha256').update(raw).digest('hex');
  const expires = new Date(Date.now() + SETUP_TOKEN_TTL_DAYS * 86_400_000).toISOString();
  db.transaction(() => {
    db.prepare('DELETE FROM setup_tokens WHERE account_id = ? AND used_at IS NULL').run(accountId);
    db.prepare('INSERT INTO setup_tokens (token_hash, account_id, expires_at) VALUES (?, ?, ?)')
      .run(hash, accountId, expires);
  })();
  return raw;
}

/**
 * Writes a one-page handout of the setup links, with a copy button per manager.
 *
 * Tokens are stored only as a sha256 hash, so a raw link cannot be recovered from
 * the database later — this file is the single chance to capture them. It is
 * written to setup_links.html, which is gitignored: it contains live credentials
 * and must never be committed.
 */
function writeHtml(links) {
  const rows = links.map(l => `
    <tr>
      <td class="name">${escapeHtml(l.name)}</td>
      <td><a href="${escapeHtml(l.url)}">${escapeHtml(l.url)}</a></td>
      <td><button data-url="${escapeHtml(l.url)}">Copy</button></td>
    </tr>`).join('');

  const html = `<!doctype html>
<meta charset="utf-8">
<title>Declan Dollars — setup links</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 2rem auto; max-width: 60rem; padding: 0 1rem; }
  h1 { margin-bottom: .25rem; }
  .warn { background: #fff4e5; border-left: 4px solid #ed6c02; padding: .75rem 1rem; margin: 1rem 0; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: .5rem .6rem; border-bottom: 1px solid #e0e0e0; vertical-align: middle; }
  td.name { font-weight: 600; white-space: nowrap; }
  a { font-family: ui-monospace, monospace; font-size: 12px; word-break: break-all; }
  button { cursor: pointer; padding: .3rem .7rem; }
  button.done { background: #2e7d32; color: #fff; border-color: #2e7d32; }
</style>
<h1>Declan Dollars — one-time setup links</h1>
<p>Generated ${new Date().toLocaleString()} · expire in ${SETUP_TOKEN_TTL_DAYS} days · ${links.length} manager(s)</p>
<div class="warn">
  <strong>These are live credentials.</strong> Each link claims that manager's account and
  works once. Anyone holding a link can claim that account, so DM them individually rather
  than posting the list. They cannot be recovered after this — only a hash is stored — so
  re-run the seed script if you need new ones.
</div>
<table>
  <thead><tr><th>Manager</th><th>Link</th><th></th></tr></thead>
  <tbody>${rows}
  </tbody>
</table>
<script>
  document.querySelectorAll('button[data-url]').forEach(b => {
    b.addEventListener('click', async () => {
      await navigator.clipboard.writeText(b.dataset.url);
      b.textContent = 'Copied'; b.classList.add('done');
      setTimeout(() => { b.textContent = 'Copy'; b.classList.remove('done'); }, 1500);
    });
  });
</script>
`;
  const out = path.join(process.cwd(), 'setup_links.html');
  fs.writeFileSync(out, html);
  console.log(`\nHTML handout written to ${out}`);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

async function main() {
  const db = openDb();
  const links = [];
  let created = 0;
  let existing = 0;

  for (const league of BETTING_LEAGUES) {
    const users = await fetchLeagueUsers(league.leagueId);
    console.log(`\n${league.label} (${league.season}) — ${users.length} members`);

    for (const u of users) {
      const sleeperUserId = u.user_id;
      const displayName = u.display_name || sleeperUserId;

      // Keyed on the immutable Sleeper id, so a rename updates the display name
      // instead of creating a second account.
      let account = db.prepare('SELECT * FROM accounts WHERE sleeper_user_id = ?').get(sleeperUserId);

      if (!account) {
        const id = randomUUID();
        db.prepare(
          `INSERT INTO accounts (id, sleeper_user_id, username, display_name)
           VALUES (?, ?, ?, ?)`,
        ).run(id, sleeperUserId, displayName, displayName);
        account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
        created++;
      } else {
        db.prepare('UPDATE accounts SET display_name = ? WHERE id = ?').run(displayName, account.id);
        existing++;
      }

      db.prepare(
        `INSERT OR IGNORE INTO account_leagues (account_id, league_id, season)
         VALUES (?, ?, ?)`,
      ).run(account.id, league.leagueId, league.season);

      if (account.password_hash === null) {
        const token = issueSetupToken(db, account.id);
        links.push({ name: displayName, url: `${BASE_URL}/betting/setup?token=${token}` });
      } else {
        console.log(`  ${displayName.padEnd(20)} already set up — no new link`);
      }
    }
  }

  console.log(`\naccounts: ${created} created, ${existing} already existed`);

  if (links.length > 0) {
    console.log(`\nSetup links (single use, expire in ${SETUP_TOKEN_TTL_DAYS} days) — DM these:\n`);
    for (const l of links) console.log(`  ${l.name.padEnd(20)} ${l.url}`);
    writeHtml(links);
  }
  console.log('');
}

main().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
