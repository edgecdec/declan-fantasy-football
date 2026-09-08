# 🏈 Declanalytics

### [👉 Live Website: fantasyfootball.edgecdec.com](https://fantasyfootball.edgecdec.com/)

A comprehensive suite of tools to analyze your Sleeper Fantasy Football leagues, tracking everything from historical ownership to "luck" and roster health.

---

## 🚀 Features

### 📈 **Portfolio Tracker**
**"The Stock Market for your Players"**
- View your total exposure to every player across all your leagues.
- **Historical View**: Go back in time to see who you owned in Week 1 vs Week 14.
- **Start vs Bench**: See if you are actually starting the players you own, or just hoarding them.
- **Trends Graph**: Visualize your ownership percentage over the course of the season.

### 🍀 **League Luck Analyzer (Expected Wins)**
**"Did I lose because I'm bad, or because I'm unlucky?"**
- Calculates **"All-Play" Wins**: Your record if you played every team every week.
- **League Median Support**: Correctly handles leagues where the top half gets a win.
- **Advanced Stats**: Toggles to show Points For, Points Against, and Differential.
- **Dashboard**: See your aggregate "Luck" (Actual Wins - Expected Wins) across all leagues.

### 🏆 **Season Performance Review**
**"The Medal Count"**
- Analyzes Playoff Brackets to determine your **True Final Rank**.
- **Smart Detection**: Distinguishes between "Consolation Brackets" (Winner = Best) and "Toilet Bowls" (Winner = Worst).
- **Medal Tracker**: Tracks Golds (1st), Silvers (2nd), and Bronzes (3rd).
- **Percentiles**: Normalizes your finish based on league size (e.g., 5th/10 is better than 5th/6).

### 📊 **Manager Skill Hub**
**"Are your decisions actually good?"**
- **Positional Efficiency**: How much of each position's available points you captured.
- **Start/Sit Accuracy**: Scores your lineup decisions against what you left on the bench.
- **Historical Trends**: Tracks your skill metrics across every season you've played.

### 🏛️ **Legacy League Analyzer**
**"The Historian"**
- Tracks the entire history of a specific league across all its seasons.
- **Head-to-Head Matrix**: See your all-time record against every other owner.
- **Rivalry Tracker**: See who you have outscored the most (and least) over the years.
- **Trade History**: Reviews past trades and how they worked out for each side.

### 📋 **Live Draft Assistant**
**"Your draft-day co-pilot"**
- Real-time draft board that follows your Sleeper draft as picks come in.
- **Best Available**: Ranked suggestions from the players still on the board.
- **VBD Analysis**: Value-based drafting scores rather than raw projections.
- **Rankings Variants**: 18 redraft and 18 dynasty rankings sets covering 1QB/Superflex,
  Standard/Half-PPR/Full-PPR, and three Tight End Premium levels.
- **Custom Rankings**: Upload your own rankings CSV to draft off your board, not ours.
- **Team Value Rankings**: See how each roster in the draft stacks up as it fills out.

### 🚑 **Roster Medic**
**"The Check-Up"**
- Scans all your current-season leagues for critical issues.
- **Alerts**:
  - Empty Starting Slots.
  - Injured Players in Starting Lineup.
  - IR-Eligible players clogging up bench spots.
  - Open Roster Spots.

### 🏈 **Player Database**
- Searchable, sortable list of all 12,000+ NFL players.
- Filters for Position and Team.
- Season stats in Standard, Half-PPR, and PPR scoring.

---

## 📅 Seasons

Every page derives its season from Sleeper's `/state/nfl` endpoint rather than a hardcoded
year, so new seasons appear on their own. Pages flip at different times because they need
different things to exist first:

| Pages | Defaults to | Why |
|---|---|---|
| Draft Assistant, Player Database | New league year (~March) | Forward-looking: during an August draft you want the upcoming season. |
| Portfolio Tracker, Roster Medic | New league year, once rosters exist | Rosters are populated at league creation. |
| Luck Analyzer, Season Review, Legacy Analyzer, Manager Skill | Last season that produced games (Week 1) | All of these divide by games played, so flipping early would show empty tables. |

Year pickers span 2017 (Sleeper's first NFL season) through the current season. You can
always select a previous year on any page.

---

## 🛠️ Tech Stack
- **Framework**: Next.js 16 (App Router, Turbopack) + React 19
- **UI**: Material UI (MUI) v7 + Emotion
- **Visualization**: Recharts
- **Data**: Sleeper API (client-side) + FantasyCalc (trade values) + GitHub Actions pipeline
- **Hosting**: Self-hosted VPS behind nginx, managed by pm2

## ✅ Checks

| Command | What it does |
|---|---|
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | 44 tests, ~1s |
| `npm run lint` | ESLint |

CI runs typecheck, tests and build on every push to `main` and every PR.

`npm run typecheck` is **not optional**, because `next.config.ts` sets
`typescript.ignoreBuildErrors: true` — `next build` succeeds with type errors, so without a
separate typecheck a type error ships and first appears as a runtime fault.

The test runner adds **no dependencies**: it uses the `typescript` already in devDeps plus
Node's built-in `node:test`. `scripts/run-tests.mjs` compiles, rewrites `@/` path aliases
to real relative paths (tsc emits them verbatim and Node doesn't understand them), then
runs `node --test`. Tests are hermetic — no network — so anything needing live Sleeper data
belongs in a script, not the suite.

## 🚢 Deployment

Pushes to `main` auto-deploy. `server.js` wraps Next.js and exposes a signed GitHub webhook
at `/api/webhook`; on a push to `main` it runs `deploy_webhook.sh`, which fetches, installs
if `package.json` changed, builds, and restarts the pm2 process.

Three properties of that script are load-bearing. Changing any of them has taken the site
down before:

**It builds into a scratch directory and swaps on success.** `NEXT_DIST_DIR=.next.new` (wired
through `distDir` in `next.config.ts`) means the live `.next` keeps serving throughout, and
the swap is two renames on one filesystem. A failed build changes nothing. This replaced
`rm -rf .next && npm run build`, under which the server had no build for the whole build and
permanently if it failed — which is exactly how the site 502'd after a Next bump OOMed.
`.next.old` is kept as one generation of rollback material: `mv .next.old .next && pm2
restart fantasy-football`.

**The heap is capped at 1536MB, deliberately below what the box has.** The VPS has 1919MB and
runs ten other pm2 apps holding ~1.1GB. Telling V8 it may use 3072MB on a box that can't
back it means it never collects aggressively and gets kernel-OOM-killed instead. Measured:
1024 and 1536 both build in ~28s.

**Nothing may follow `pm2 restart`.** That restarts the process which launched the script, so
pm2 takes the whole process group down with it. For 384 deploys the log showed "Deploy
started" 384 times and "Deploy finished" zero times. All cleanup, and releasing the lock,
must happen before the handoff.

A pre-build typecheck on the VPS is **not** possible: `tsc --noEmit` aborts with an OOM
there even at a 1400MB heap. That check lives in CI. Note CI runs in *parallel* with the
deploy rather than gating it, so the scratch-build swap is the real safety net for a direct
push to `main`.

## 🔄 Data Pipeline

A **GitHub Action** runs daily at 8:00 AM UTC and commits the results:

| Script | Output |
|---|---|
| `scripts/update_players.py` | `data/sleeper_players.json` — full player DB + season stats |
| `scripts/generate_rankings.py` | `data/redraft/` — 18 redraft rankings variants |
| `scripts/generate_dynasty_rankings.py` | `data/dynasty/` — 18 dynasty rankings variants |

It also writes `data/player_index.json`, a slim position+team index (~114KB vs 22MB) that
server-side betting code uses instead of parsing the full database.

This keeps the Player Database current without hammering Sleeper's API from the client. A
failure opens a GitHub issue — the job once broke for three days unnoticed, and the bug was
one line.

> The three scripts share one `bash -e` step deliberately: the rankings scripts read the
> player database the first one writes, so a failure there must stop them rather than let
> them regenerate from stale input.

> `update_players.py` writes with `sort_keys=True`. This is load-bearing: Sleeper doesn't
> serialize object keys in a stable order, and without it the daily commit rewrote ~83% of
> an 825k-line file every day, defeating git's delta compression.
