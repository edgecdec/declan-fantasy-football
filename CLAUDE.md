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

Three properties of `deploy_webhook.sh` are load-bearing; each has broken the site or been
silently dead:

1. **It builds into a scratch dir and swaps on success.** Never `rm -rf .next` before
   building — the live server serves out of it.
2. **The heap cap is deliberately below the box's RAM** (1536MB on 1919MB, shared with ten
   other pm2 apps). A larger cap means V8 never collects hard and gets OOM-killed.
3. **Nothing may follow `pm2 restart`.** It restarts the process that launched the script,
   so the process group dies with it. All cleanup goes before the handoff.
