# Declan Dollars bot — implementation plan

Derived from `Declan Dollars — Discord Bot & Same-Week Parlays.md` (2026-09-19), plus two scope
additions agreed after it: **league-activity notifications for any league**, and **read commands
mirroring the site**. Decisions taken are recorded here so they are not re-litigated.

## Decisions already taken

| Question | Decision | Why |
|---|---|---|
| Repo layout | `bot/` inside `declan-fantasy-football`, own pm2 app | Shared types. `MarketRow`, `WagerRow` and event payloads would otherwise be duplicated and drift — same failure class as a stale hand-maintained player index |
| Push handling | **Void the whole slip, refund stake** | Keeps `to_win_cents` immutable from placement, so nothing that reads it needs auditing. Diverges from retail; exact ties are rare at 2-decimal scoring |
| `MAX_PARLAY_PAYOUT_CENTS` | **1,000,000** ($10,000) | Measured: the 0.15 band caps one leg at +475, but multiplication is exponential. 4 legs at the band edge pays $1.1M on a $1,000 stake at 1-in-1,975 — reachable across 17 people in a season, and it would end the standings permanently. EV is fine; variance is not |
| League notifications | Per-guild subscriptions, admin-configured | Works for any league id without touching `BETTING_LEAGUES` |
| Failed waiver claims | Suppressed by default, per-guild toggle | Measured 267 of 810 transactions were `failed`. A third of all messages would be "someone missed a player" |
| Admin gating | Discord user ID allowlist (`DISCORD_ADMIN_IDS`) | Exact, works in any guild, survives role changes |

## Three data planes

The doc describes two directions (readonly SQLite for reads, HTTP for writes). The notification
scope adds a third, and keeping them distinct is the main architectural point.

| Plane | Owner | Path | Why not otherwise |
|---|---|---|---|
| **Bet state** | site DB | `bet_events` outbox → bot cursor | Bet state is the site's; the outbox makes the handoff exactly consistent |
| **Bet actions** | site | bot → HTTP `POST /api/bot/*` → `placeWager` | Every integrity rule applies unchanged. The bot must never write `betting.db` |
| **League activity** | Sleeper | bot → Sleeper directly, own dedup cursor | Transactions are NOT site state. Routing them through the site would need a schema, a poller and an outbox for something one HTTP call already returns — and would tie notifications to `BETTING_LEAGUES` |

### What the site can and cannot supply

| Bot needs | Source |
|---|---|
| Balances + equity | `GET /api/betting/leaderboard` — exists, exactly this shape. Needs `getServiceCaller` |
| Open wagers | `GET /api/betting/me` |
| Markets board | **read SQLite `readonly: true`** — the HTTP route prices as a side effect, and the tick route owns pricing now |
| Fantasy W-L standings | **Sleeper directly** (`rosters[].settings.wins`). The site computes this client-side; a site route would be a pointless hop |
| Trades / adds / drops / waivers | **Sleeper directly** |

## Measured facts

Gathered before planning, so the plan does not rest on assumptions.

### Transaction volume — 810 across 8 leagues × 3 weeks (~34 per league-week)

| type | count | payload of note |
|---|---|---|
| `free_agent` | 419 | `adds` / `drops`, either may be null |
| `waiver` | 362 | `settings.waiver_bid` — the FAAB amount |
| `trade` | 16 | `settings.expires_at`; may carry `draft_picks` |
| `commissioner` | 11 | manual moves |
| `chopped` | 2 | guillotine elimination — drops the entire roster at once |

`status` is `complete` (543) or `failed` (267). At 20 leagues that is ~675/week with ~220 failures.
**Noise control is the design problem, not a polish item.**

### Parlay payouts, $1,000 stake

| slip | pays | hit chance |
|---|---|---|
| 4 coin flips | $13,284 | 1 in 16 |
| 6 coin flips | $48,418 | 1 in 64 |
| 4 legs at the 0.15 band edge | $1,095,976 | 1 in 1,975 |
| 10 legs at the band edge | $39.8bn | 1 in 173M |

Hold compounds as the doc states (1 leg 4.5%, 2 legs 8.9%, 3 legs 13.0%, 4 legs 17.0%), which is
why no leg cap is needed — but a payout cap is.

## Build order

Steps 1–2 are **done** (commit `189b167`).

| # | Step | Notes |
|---|---|---|
| ~~1~~ | ~~`POST /api/betting/tick` + cron~~ | done |
| ~~2~~ | ~~`bet_events` + 3 insertion points~~ | done; `line_moved` deferred to step 8 with the bot, since it needs the coalescing threshold designed alongside |
| 3 | Parlay pricing, pure + tested | Where the money is wrong if it is wrong. No DB, no IO |
| 4 | `wager_legs` migration + backfill | The backfill is the important part: afterwards there is ONE code path and no union |
| 5 | Parlay gates + mutually-exclusive check | Per leg; any failing leg refuses the slip |
| 6 | Two-phase settlement + slip valuation | Grade lost the moment one leg dies |
| 7 | `discord_user_id`, `getServiceCaller`, `/api/bot/*` | Do not loosen `getAuthUser` |
| 8 | Bot: cursor reader, then bet announcements, then `line_moved` | Read-only first |
| 9 | Sleeper transaction poller + guild subscriptions | Independent of 3–6; can ship before them |
| 10 | Read commands | Needs 7 |

Steps 9 and 10 do not depend on the parlay chain, so notifications can land first if that is worth
more.

## Step 4 — the bug to watch for

`wagers JOIN wager_legs` **triples a three-leg slip's stake**. Anywhere that sums `stake_cents`
needs `DISTINCT` on the wager or an aggregate over legs. `openExposureCents` is the one that
actually matters: getting it wrong lets someone quietly exceed
`NEGATIVE_OPEN_EXPOSURE_CAP_CENTS`. A test must assert a 3-leg slip contributes its stake **once**.

## Step 9 — league activity

### Storage (bot's own SQLite, separate from `betting.db`)

```sql
CREATE TABLE IF NOT EXISTS guild_subscriptions (
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  league_id TEXT NOT NULL,
  season TEXT NOT NULL,
  -- JSON array: trade, waiver, free_agent, commissioner, chopped
  event_types TEXT NOT NULL,
  include_failed INTEGER NOT NULL DEFAULT 0,
  min_faab INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (guild_id, league_id)
);

-- Dedup cursor. Sleeper transaction ids are snowflakes, so ordering is meaningful, but a claim
-- can be created before an earlier one and processed after, so "seen" is a set not a watermark.
CREATE TABLE IF NOT EXISTS seen_transactions (
  transaction_id TEXT PRIMARY KEY,
  league_id TEXT NOT NULL,
  posted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

A set rather than a max-id watermark on purpose: waiver claims all process in one batch and a
watermark would silently skip any that Sleeper returns out of order.

Separate DB file from `betting.db` so the bot can be restarted, wiped or moved without touching
money, and so the nightly ledger backup stays about the ledger.

### Commands

- `/admin watch <leagueId> #channel` — bind, defaults to `complete`-only
- `/admin unwatch <leagueId>`
- `/admin watching` — list bindings for this guild
- `/admin events <leagueId> <types...>` — adjust which types post

### Polling

Fold into the bot's own loop at 60s, matching the play poller's cadence. One call per subscribed
`(league, week)`. 20 leagues = 20 calls/min against a documented 1000/min limit. Must bypass
`CacheService` — `getTransactions` caches, and a cached response would mean missing a trade for
the cache TTL.

## Step 10 — read commands

| Command | Source | Scope resolution |
|---|---|---|
| `/balances [league]` | `/api/betting/leaderboard` via service auth | Guild binding if exactly one betting league; else a required option |
| `/standings [league]` | Sleeper `rosters` + `users` | Any watched league, betting or not |
| `/slips` | `/api/betting/me` for the caller's linked account | Caller's own only |
| `/markets [week]` | readonly SQLite | Guild binding |
| `/balance` | `/api/betting/me` | Caller's own |

**Privacy rule:** a Discord user sees only leagues the *guild* is bound to, and `/slips` shows only
their own. The site gates balances on league membership; the guild binding is the bot's equivalent.
One league's bets must never surface in another guild's channel.

## Operational

### Discord application — what to create

1. <https://discord.com/developers/applications> → **New Application**, name it Declan Dollars.
2. **Bot** tab → Add Bot → **Reset Token**, copy it. This is the only time it is shown.
3. Privileged intents: **none needed.** Slash commands and channel posting do not require Message
   Content, Presence or Server Members. Leave all three off — fewer intents is less to review.
4. **OAuth2 → URL Generator**: scopes `bot` + `applications.commands`; bot permissions
   **Send Messages**, **Embed Links**, **Read Message History** (needed to edit its own messages).
5. Use the generated URL to invite it to the server.
6. Your numeric user ID: Settings → Advanced → Developer Mode on, then right-click your name →
   Copy User ID.

Then on the VPS `.env`:

```
DISCORD_BOT_TOKEN=...
DISCORD_APP_ID=...
DISCORD_ADMIN_IDS=<your numeric id>
BOT_SERVICE_SECRET=<new random secret, for /api/bot/*>
```

`BOT_SERVICE_SECRET` must be distinct from `WEBHOOK_SECRET` and `POLL_SECRET`: it authorises acting
as a *user* (placing bets), which is a strictly larger power than triggering a poll.

### Deploy ordering

`deploy_webhook.sh` ends at `pm2 restart fantasy-football` and **nothing survives that line** — it
restarts the process that launched the script. A conditional bot restart goes **before** the handoff:

```bash
if git diff --name-only HEAD@{1} HEAD | grep -q '^bot/'; then
  pm2 restart fantasy-bot
fi
pm2 restart fantasy-football
```

This also keeps the gateway connection out of the site's build cycle, so a routine site deploy does
not drop the bot mid-slate.

### Memory

Measured on the box: 1919MB total, other pm2 apps ~772MB resident (SuperConnections alone 477MB),
site build now capped at 768MB after it OOM-killed SuperConnections on 2026-09-16. A discord.js
process is roughly 110MB.

Cap the bot at `--max-old-space-size=256` and check `free -m` during a live Sunday before trusting
it. It is the process least affordable to lose during a slate, and the box has no spare gigabyte.

### Cron

Alongside `poll_fantasy_plays.sh`:

```
* * * * * /usr/local/bin/tick_betting.sh
```

Same shape as the play poller: shared secret, log only when something happened.

## Open questions still outstanding

- [ ] `PARLAY_MIN_REMAINING_MINUTES = 180` — confirm it does not kill weekend volume. Measurable
      once the tick route has been running a week: count how many market-hours sit above 180.
- [ ] `/parlay` interactive builder vs all legs in one invocation. One invocation is far less code
      and Discord's autocomplete makes it tolerable; interactive is nicer and needs component state.
- [ ] Whether `line_moved` posts at all in a 1,100-member server, or is opt-in per guild.
