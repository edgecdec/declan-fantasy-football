# Project rules

## Tables: always use the shared component

Any table of rows a reader might want to reorder uses **`DataTable`**
(`src/components/common/DataTable.tsx`), or **`SmartTable`** when the list is long enough to
want search and per-column filters on top. Never hand-roll `<Table>` / `<TableHead>` /
`<TableRow>` from MUI for a data table.

This is not a style preference. A hand-rolled table silently loses sorting, pagination,
consistent alignment and header tooltips, and every one of those then has to be reinvented
or — more usually — just goes missing. A reader who can sort one table on this site expects
to sort all of them.

**If the shared component cannot express what you need, extend it rather than working
around it.** It already supports:

| Feature | How |
|---|---|
| Sorting | on by default; `sortable: false` to opt a column out |
| Sort by a derived value | `sortValue: row => …` |
| Custom cell content | `render: row => …` |
| Header explanation | `tooltip: '…'` |
| Nested field as sort key | dotted path in `id`, e.g. `me.distribution.banked` |
| Expandable rows | `renderDetailPanel` |
| Search / column filters | use `SmartTable` |
| Show every row | an **All** page size is appended automatically |

`sortValue` exists because a column's displayed value is often not the one worth ordering
by — magnitude of a signed number, or distance from a coin flip. It is also the escape hatch
for a `render`-only column with no backing field: without it the comparator reads `undefined`
for every row and the sort silently does nothing.

**Carve-out:** a raw `<Table>` is fine when it is a layout primitive rather than a data
table — a matrix or heatmap grid where rows and columns are both axes and reordering is
meaningless (`PositionalHeatmap`, `TradeHeatmap`). If rows are records, use the component.

**Known backlog:** ~22 files still hand-roll tables and predate this rule. Don't add to it.
Convert one when you're already editing it, not as a separate sweep.

## League mentions are clickable

Any place a league is named — a table cell, a chip, a list item — links to that league. Use
`leagueUrl(leagueId)` from `src/services/common/leagueLinks.ts`; never hardcode the URL.

That helper is the single place the destination is decided, so if an in-app per-league view
is ever built there is one line to repoint. It currently points at Sleeper's matchup view,
because from an analytics page the useful next step is the live matchup and the actual
lineup, and neither exists here.

Practical consequence: anything that renders a league name needs its **id** alongside, not
just the name. Carry the id through your data model from the start — retrofitting it means
touching every type in the chain.

## Formats without a head-to-head opponent

Guillotine, chopped and survivor leagues give **every roster its own `matchup_id`**, so there
is no pair to price and `buildMatchupMarkets` returns nothing for them. They are still real
leagues with real starters. Don't drop them: this is exactly how four live starters became
invisible on the This Week page.

Anything defined only against an opponent — win probability, and the weighted
"wins at stake" that derives from it — genuinely does not exist in those formats. Report it
as unavailable rather than as zero. Zero claims the player does not matter; a dash says the
number is not defined.

## Sleeper's undocumented GraphQL API

`api.sleeper.app/graphql` is what Sleeper's own app uses. Introspection is open (snake_case —
`query_type`, not `queryType`). It is **undocumented**, so anything built on it needs a fallback
to the public REST endpoints; treat a schema change as a matter of when, not if.

The useful field is `plays(sport, season, season_type, week | game_id | date)`:

| Query shape | Returns | Size |
|---|---|---|
| `week:` | ALL plays for the week, uncapped | ~3 MB, 2.8s |
| `game_id:` / `date:` | the **20 most recent** plays only | 0.02 MB, 0.2s |

`cache-control: max-age=0, private, must-revalidate` — no CDN cache, unlike the REST endpoints
which sit behind 30–60s. This is the live path.

**Poll per-game, never per-league.** Plays are global NFL events with no league context, so one
fetch serves every league and every user. Per-game is 13 calls/min against a documented 1000/min
limit (1.3%); per-league-per-game would be 234/min for a single user and gets us IP-blocked at
three. For the same reason the poller must be **server-side** — browser polling multiplies by
every open tab. Dedupe by `play_id`: at 60s polling, ~19 of the 20 returned plays are repeats.

### What the play feed does and does not contain
Measured by replaying complete weeks against Sleeper's official stats (`npm run verify:plays`):

- **QB/RB/WR/TE/K: exact to the cent**, 100% of players, verified across 3 week/league combinations
- **Team DEF: not derivable from plays at all.** The feed is offence-only — one week carried 1
  sack and 0 interceptions league-wide while a single defence officially had 4 and 2. Defensive
  points must come from the stats feed, which they would anyway since `pts_allow_*` and
  `yds_allow_*` are game-level brackets.

Things the feed leaves to us, all handled in `playScoring.ts`: league **bonuses** (only reported
as game-level aggregates, so derived from primitives — and milestones must fire on the crossing
play, not every play thereafter), **two-point conversions** (`conv_cmp`/`conv_pass_att` vs the
priced `pass_2pt`), and **return touchdowns** (sometimes carry `st_td`, sometimes not — fill the
gap, never add).

**Player positions are a moving target.** `data/sleeper_players.json` holds TODAY's positions; 115
fantasy-position players changed between Feb and Sep 2026. Per-position bonuses therefore need the
position as of the games being scored — live that is the current one, but historical replay needs a
contemporary snapshot, which the verifier can read from git via `--players <gitRef>`. Reconciling an
old season against current positions silently mis-scores those players.

Verify with `npm run verify:plays -- <season> <week> --user <name> [--players <gitRef>]`, which
fetches plays once and re-scores every league that user is in. Test more than one league: a
single-league check reported 100% while five real bugs were hiding in the other seventeen.

## Team-defence projections are broken at the source

Sleeper's DEF projection `def_pr_yd` is punt **plus kick** return yards (`def_pr_yd == pr_yd +
def_kr_yd` on every DEF row since 2018), DEF rows also carry offence keys (`pr_yd`, `pass_int_td`),
and actual DEF stats use `def_pr_yd` for punts only. Leagues scoring return yards over-project
every defence by ~4.7/wk (Guillotine ~11.7) since the 2026 kick-return projection caught up.

- **Score projections only through `calculateProjectedPoints`**, which repairs DEF rows
  (`stats/defenceProjection.ts`). Multiplying a raw DEF row by scoring settings brings the
  phantom back.
- **Price a DEF only through `applyDefenceModel`** (`betting/defenceModel.ts`): a league-relative
  model centred on what defences actually score in that league. The old `POSITION_SHAPE.DEF` was
  fitted on the inflated rows and is a fallback only; repaired rows on it backtest *worse* than
  doing nothing. Every candidate builder (betting pricing, matchup markets, This Week) calls it,
  so the pages cannot disagree.

Backtests and the full write-up: `SessionSwarm/runs/2026-10-13_180705/work/ff-def-projections/REPORT.md`.

## Live play capture (The Zone) — operational

The Zone is a **tab on `/week`**, not a page of its own — `/zone` is a middleware redirect kept
only so existing links do not 404. The feed component (`src/components/plays/PlayFeed.tsx`) takes
its season and week from the page rather than owning pickers, so the tab cannot disagree with the
header about which week it is showing.

Capture is a **VPS cron**, not part of the app's request path. Nothing about it lives in this repo,
so it is recorded here:

| Piece | Where |
|---|---|
| Cron | `* * * * *` (root crontab) → `/usr/local/bin/poll_fantasy_plays.sh` |
| Script log | `/var/log/fantasy_plays_poll.log` — **written only when something happened**; silence between slates is correct |
| Endpoint | `POST /api/plays/poll`, shared-secret auth via `x-poll-secret` or `?secret=` |
| Secret | `POLL_SECRET` if set, else the existing `WEBHOOK_SECRET` — so no new env var was needed |
| Health | `GET /api/plays/poll?season=&week=` (same secret) → play count, **observed latency**, last poll, cooldown |
| Backfill a week | `POST /api/plays/poll?season=2025&week=14` — reconcile-only, idempotent |

### The stored plays are a CACHE, not an archive

An earlier version of this file said a play not stored while the game is on cannot be fetched back.
**That is false**, and it was steering design decisions. The `week:` query returns every play of a
week, uncapped, for a finished game as readily as a live one — that is exactly how `POST
/api/plays/poll?season=&week=` backfills, and 2025 week 14 was reconstructed from nothing that way.

Two things storage genuinely buys, and it is worth being clear which is which:

1. **It decouples pageviews from Sleeper.** Without it, every feed load is a 3 MB / 2.8s fetch, and
   the page auto-refreshes every 30s. A handful of viewers is then straight into the rate limiting
   the whole design exists to avoid. This is the real reason.
2. **`first_seen_at`** — the live latency of the feed. That one genuinely cannot be measured after
   the fact, which is why an amendment rewrites `metadata`/`play_stats` but never that column.

What follows from it being a cache:

- **A missed poll is recoverable.** The 15-minute reconcile, or a later backfill, fills the gap.
  Low latency during a slate is still the goal, but a gap is not fatal — earlier notes overstated
  this.
- **Plays are safe to prune.** Old weeks are re-fetchable on demand, which is also why the nightly
  ledger backup drops the table. Current cost: 2,808 plays = 2.34 MB of JSON, ~40 MB for a full
  season. Not yet worth pruning; if the disk gets tight, keeping two weeks hot is the move.
- **Corrections matter more than immutability.** Sleeper amends plays in place, keeping the
  `play_id` — a reception moved from G.Holani to B.Russell hours after the snap in the 2026 opener.
  The reconcile pass rewrites amended rows for that reason; a store that only ever inserted would
  hold the wrong attribution forever.

`latencySeconds` is the number that says whether capture is working. A play count alone looks
identical whether plays arrived seconds or an hour after the snap, so check the latency, not the
count. It is null when every stored play is old (a backfill), by design.

**Don't deploy during a slate if it can wait.** The build swaps atomically and the cron keeps
firing, so a deploy is survivable — but a failed one is not, and the plays missed while pm2 is
restart-looping are gone.

The nightly ledger backup **drops `nfl_plays` from the copy** (`/usr/local/bin/backup_betting_db.sh`).
Plays are re-fetchable from Sleeper wholesale; a ledger row is not. Keeping them would be ~65MB a
season × 14 nights retained.

## Verification

`npm run typecheck` is **mandatory** and is not covered by the build. `next.config.ts` sets
`typescript.ignoreBuildErrors: true`, so `next build` succeeds with type errors, and the
deploy script only runs the build. CI runs typecheck, but it runs in *parallel* with the
deploy rather than gating it.

Before pushing: `npm run typecheck && npm test`.

`npm test` uses the `typescript` already in devDeps plus Node's built-in `node:test` — no
test framework dependency, because the VPS installs devDependencies on every deploy and that
install has taken the site down twice. Keep it that way. Tests are hermetic; anything needing
live Sleeper data belongs in a script, not the suite.

## Don't ship a code path you haven't executed

The daily data job broke for three days on a one-line `NameError` because the slim player
index was generated by hand and the script that was supposed to produce it was never run —
the output was validated, the code was not. Run the thing.

## Deploy invariants

These properties of `deploy_webhook.sh` are load-bearing. Each one has broken the site or been
silently dead:

1. **It builds into a scratch dir and swaps on success.** Never `rm -rf .next` before
   building — the live server serves out of it.
2. **The V8 heap cap is 768MB, deliberately low.** A larger cap means V8 never collects hard.
   It does NOT bound the build, though: most of the build is Turbopack native memory, which
   ignores `--max-old-space-size`. Measured: the build needs 1.8–2.0GB of RAM+swap however it
   is configured. `turbopackMemoryLimit`, `cpus: 1`, a single-threaded runtime and
   `NEXT_TURBOPACK_USE_WORKER=0` change nothing, and webpack is worse.
3. **Nothing may follow `pm2 restart`.** It restarts the process that launched the script,
   so the process group dies with it. All cleanup goes before the handoff.
4. **Anything memory-hungry runs through `run_contained`**: `npm install`, `next build`, the
   bot's `tsc`. That puts it in its own `systemd-run --scope` with
   `MemoryMax`/`MemorySwapMax` (default 1400M RAM + 1.5G swap) and `oom_score_adj` 1000. Never call
   those directly from the script. The script runs inside `pm2-root.service`, whose
   `OOMPolicy=stop` (the systemd default) turns ANY OOM kill in that cgroup into `pm2 kill` +
   resurrect of all twelve apps. It also kills the deploy, so the retry never ran. This
   happened 12 times between 2026-09-08 and 2026-11-02, every one during a deploy of this
   site, and 5 of those times the victim was SuperConnections, not the build.
5. **The deploy never garbage-collects git.** Every git call goes through `git_`
   (`gc.auto=0`, `maintenance.auto=false`, `fetch.unpackLimit=1`). `data/sleeper_players.json`
   is 22MB and committed daily, so an auto-gc is a ~6 min, ~800MB repack. One ran alongside
   the 2026-11-02 build and pushed it over. gc runs off-slate from a box cron in its own capped
   unit (see the runbook below).
6. **Failure is loud and the lock cannot go stale.** A failed deploy logs a greppable
   `DEPLOY FAILED:` line and writes `/var/lib/fantasy-deploy/status.json`
   (`running` / `failed` / `deployed` / `skipped`, plus commit and detail). The lock is a `flock` on
   `/tmp/deploy_fantasy.flock`. The kernel releases it when the holder dies; never delete
   that file. A push that lands mid-deploy marks `/tmp/deploy_fantasy.pending`, and the
   running deploy rebuilds from it before swapping (up to 3 passes).

**The first deploy after changing this script still runs the OLD version**: server.js runs the
file before `git reset` replaces it, and the snapshot re-exec keeps the old copy. Plan
script changes for a quiet window.

**Test changes end to end before pushing.** `scripts/deploy-sim/` drives the real
`server.js` webhook → `deploy_webhook.sh` path in a Lima VM that matches the box: Ubuntu 24.04,
kernel 6.8, systemd 255, 2 CPUs, 2GB RAM + 2GB swap, pm2 under an identical `pm2-root.service`.
It reproduces the 2026-11-02 mass restart with the old script and checks every protection
above. See its README.

### Box-side settings this script depends on (not in the repo)

Applied by hand on the VPS. Check before assuming them:

| Setting | Why |
|---|---|
| `pm2-root.service` drop-in `OOMPolicy=continue` | an OOM kill restarts only the killed app (pm2 autorestart), not all twelve |
| repo `gc.auto=0` + `/etc/cron.d/fantasy-git-gc` (Tue 10:00 UTC, own capped unit) | packs accumulate ~1/deploy and need consolidating off-slate |
| second 2GB swapfile (4GB total) | lets a 1.9GB build push idle apps out instead of running out |

Exact commands, rationale and verification: `docs/DEPLOY_BOX.md`.
