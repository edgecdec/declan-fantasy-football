# Project: Declanalytics (Fantasy Football Analytics)

## Stack

- **Frontend**: Next.js 16 (React 19) with App Router
- **Styling**: MUI v7 + Emotion
- **Charts**: Recharts
- **Data Source**: Sleeper API (client-side fetching + static JSON via GitHub Actions)
- **State**: React Context (UserContext for Sleeper username)
- **Server**: Custom `server.js` wrapping Next.js (same pattern as other apps)
- **Hosting**: Self-hosted on VPS, managed by pm2, auto-deploys via GitHub webhook
- **Data Pipeline**: GitHub Actions daily cron → Python scripts → commits updated JSON

## Project Structure

```
/
├── .ralph/              # Ralph loop config
├── data/
│   ├── sleeper_players.json   # Full player DB (~5MB, auto-updated daily)
│   └── rankings.json          # Generated rankings
├── docs/
│   └── SLEEPER_API.md         # API reference
├── scripts/
│   ├── update_players.py      # Fetches player data from Sleeper
│   └── generate_rankings.py   # Generates rankings from player data
├── server.js                  # Custom Node HTTP server (Next.js + webhook)
├── deploy_webhook.sh          # Auto-deploy via GitHub webhook
├── src/
│   ├── app/                   # Next.js App Router pages
│   │   ├── draft-assistant/   # Draft tool with VBD rankings
│   │   ├── expected-wins/     # Luck analyzer (all-play wins)
│   │   ├── league-history/    # Historical league analysis
│   │   ├── medic/             # Roster health checker
│   │   ├── performance/       # Season review + positional analysis
│   │   ├── players/           # Player database browser
│   │   ├── portfolio/         # Player ownership tracker
│   │   ├── layout.tsx         # Root layout (ThemeRegistry + UserProvider)
│   │   └── page.tsx           # Home/dashboard
│   ├── components/
│   │   ├── analytics/         # LuckSummaryCard, LeagueHistoryChart, UserHistoryChart
│   │   ├── common/            # DataTable, SmartTable, PageHeader, YearSelector, etc.
│   │   ├── draft/             # BestAvailable, DraftBoard
│   │   ├── layout/            # AppLayout (sidebar nav)
│   │   ├── performance/       # PlayerImpactList, SkillProfileChart, StartsTooltip
│   │   └── ThemeRegistry/     # MUI theme, Emotion cache, colors
│   ├── constants/             # colors.ts
│   ├── context/               # UserContext (Sleeper username state)
│   ├── data/                  # mockRankings.ts
│   ├── services/
│   │   ├── common/            # cacheService.ts
│   │   ├── draft/             # vbdService.ts
│   │   ├── sleeper/           # sleeperService.ts (API client)
│   │   └── stats/             # expectedWins, leagueHistory, positionalBenchmarks
│   ├── types/                 # player.ts
│   └── middleware.ts
├── public/                    # Static assets
└── .github/workflows/         # daily_update.yml
```

## Key Patterns

- All pages are `'use client'` — data fetching happens client-side via Sleeper API.
- `UserContext` stores the Sleeper username; pages call `useUser()` to get it.
- `sleeperService.ts` is the central API client — all Sleeper calls go through it.
- `cacheService.ts` provides in-memory caching for API responses.
- Components accept props; data fetching happens in page components.
- MUI theme tokens only — no hardcoded hex colors in components.
- `@/` path alias maps to `src/`.

## Backpressure Validation Commands

Run in order. ALL must exit 0 before committing.

```bash
npx tsc --noEmit
npx next build
```

## Remote Server Access

Connection details are stored locally in `.ralph/.server-env` (gitignored). Read that file to get `SSH_KEY`, `SSH_USER`, and `SSH_HOST`.

- Production path: `/var/www/FantasyFootball`
- Live URL: https://fantasyfootball.edgecdec.com
- OS: Ubuntu 24.04, x86_64
- Process manager: pm2
- Other apps on same server: jeopardy (:3000), superconnections (:3001), marchmadness (:3002), discord-alt (:3003)
- This app runs on port 3004.

### Useful Remote Commands
```bash
source .ralph/.server-env

# Check running processes
ssh -i $SSH_KEY $SSH_USER@$SSH_HOST "pm2 list"

# View app logs
ssh -i $SSH_KEY $SSH_USER@$SSH_HOST "pm2 logs fantasy-football --lines 50"

# Restart app
ssh -i $SSH_KEY $SSH_USER@$SSH_HOST "pm2 restart fantasy-football"

# Test if app is responding
ssh -i $SSH_KEY $SSH_USER@$SSH_HOST "curl -s -o /dev/null -w '%{http_code}' http://localhost:3004"
```

## Deployment

- Hosted on VPS — auto-deploys on push to `main` via GitHub webhook.
- `server.js` handles the webhook POST at `/api/webhook`, verifies signature, runs `deploy_webhook.sh`.
- `deploy_webhook.sh`: git fetch/reset, conditional npm install, next build, pm2 restart.
- After pushing, verify deployment: `source .ralph/.server-env && ssh -i $SSH_KEY $SSH_USER@$SSH_HOST "curl -s -o /dev/null -w '%{http_code}' http://localhost:3004"` — must return 200.

## Data Pipeline

- GitHub Action runs daily at 8:00 AM UTC.
- `scripts/update_players.py` fetches all NFL players from Sleeper API.
- `scripts/generate_rankings.py` generates rankings from player data.
- Results committed to `data/sleeper_players.json` and `data/rankings.json`.

## Sleeper API

- Base URL: `https://api.sleeper.app/v1`
- No auth required — all endpoints are public.
- Full reference in `docs/SLEEPER_API.md`.
- Player headshots: `https://sleepercdn.com/content/nfl/players/<player_id>.jpg`
