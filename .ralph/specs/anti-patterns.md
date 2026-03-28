# Anti-Patterns — Read This First Every Loop

These are mistakes to avoid. Do not repeat them.

## Iteration Discipline
- STRICTLY ONE task per iteration. NEVER combine multiple changes into one commit.
- If you notice another issue while working, log it in .ralph/progress.txt and move on. Do NOT fix it.
- Each commit = exactly ONE logical change. "Fix X and Y" is WRONG. "Fix X" is correct.
- If a task is bigger than expected, implement what you can, set it to "done", and create a note in progress.txt about remaining work. Do NOT leave it "in_progress" forever — this causes infinite loops.

## Concurrent Editing
- A human developer may be editing files at the same time as you. ALWAYS re-read a file before modifying it — never assume it hasn't changed since you last read it.
- Before editing prd.json or progress.txt, read the current version first. Another process may have updated it.
- Use `git pull` or check `git status` before committing if you suspect concurrent changes.

## Context Management
- Do NOT read every file in the project — only read files relevant to the current task.
- Read the relevant spec file ONCE, then work from memory.
- Do NOT explore the entire directory tree. Only look at what you need.
- Minimize context window usage — you degrade when the window fills up.

## Build & Validation
- NEVER commit code that doesn't pass ALL backpressure commands (tsc --noEmit, next build).
- After changing imports or moving files, verify build passes — macOS is case-insensitive but the Linux server is case-sensitive.
- If you rename or move a file, grep the codebase for old import paths and update them all.

## Code Quality
- NEVER use `any` type — define proper types in src/types/.
- FULL implementations only. No placeholders. No stubs. No TODOs.
- Search the codebase before implementing — don't assume something doesn't exist.
- NEVER put magic numbers or hardcoded strings inline — use named constants.
- NEVER duplicate logic — search for existing utilities/services/components first.

## MUI / Theming
- NEVER use hardcoded hex colors in components (e.g. `color: "#fff"`, `background: "#1e1e1e"`).
- ALWAYS use MUI theme tokens: `text.primary`, `text.secondary`, `background.default`, `background.paper`, `divider`, `primary.main`, `action.hover`.
- For colors that differ between modes, use `theme.palette.mode === 'dark' ? darkValue : lightValue`.

## React Patterns
- Props that seed useState only run once — if the prop changes, state won't update. Use useEffect to sync.
- NEVER create new object/array references inside useEffect dependencies — use useMemo/useCallback.
- NEVER call setState inside useEffect without proper dependency guards — causes infinite re-renders.

## Sleeper API
- The full player database is 5MB+. NEVER fetch it client-side on every page load — use the static `data/sleeper_players.json` committed via GitHub Actions.
- All Sleeper API calls should go through `src/services/sleeper/sleeperService.ts`. Do not create ad-hoc fetch calls.
- Use `cacheService.ts` to avoid redundant API calls within a session.
- Sleeper API has no auth — all endpoints are public. But be respectful of rate limits.

## Deployment
- NEVER modify deploy_webhook.sh or server.js webhook handler unless the task specifically requires it.
- NEVER run `node server.js` locally as a background process — it gets stuck and blocks the iteration.
- This app deploys to a REMOTE server. After pushing, the webhook auto-deploys.
- A curl returning 200 does NOT mean the site works — always verify more than just status code.
- After every `git push`, wait 60 seconds then verify deployment: `source .ralph/.server-env && ssh -i $SSH_KEY $SSH_USER@$SSH_HOST "curl -s -o /dev/null -w '%{http_code}' http://localhost:3004"` — must return 200.
- If deploy fails (non-200 or pm2 shows errored), check logs: `ssh -i $SSH_KEY $SSH_USER@$SSH_HOST "pm2 logs fantasy-football --lines 30 --nostream"`
- Do NOT proceed to the next task if the site is down after your push. Fix it first.

## Security — Secrets and Sensitive Data
- NEVER hardcode IP addresses, API keys, secrets, tokens, or passwords in any committed file.
- ALL secrets go in `.env` (gitignored). Reference them via `process.env.VARIABLE_NAME`.
- Server connection details live in `.ralph/.server-env` (gitignored). Never copy them into other files.
- When creating example configs, use placeholders: `<random-secret>`, `<your-api-key>`, etc.
- NEVER log secrets to console, progress.txt, or commit messages.
- NEVER commit `.env` files. Verify `.gitignore` includes `.env` before every commit that touches env vars.

## File Handling
- ALWAYS read prd.json before editing it — parse the JSON, modify the specific task, write it back. Do NOT rewrite the entire file from memory.
- When appending to progress.txt, APPEND only — do not rewrite existing content.
- Do NOT modify spec files unless explicitly told to by the human.

## Git Hygiene
- NEVER use `git push --force` or `git push --force-with-lease` EXCEPT for the final status update amend after deploy verification passes.
- The ONLY allowed amend is: deploy verified → update prd.json/progress.txt → `git commit --amend --no-edit && git push --force-with-lease`. This keeps one clean commit per task.
- Always `git pull` before committing if you suspect the human or another process pushed changes.

## Nova Act Testing
After deploying any UI task, write a temporary Nova Act test script to verify the feature works in a real browser against the LIVE site (https://fantasyfootball.edgecdec.com).

### Script Pattern
- Save as `/tmp/test_<feature>.py`
- Run with: `/opt/homebrew/bin/python3.13 /tmp/test_<feature>.py`
- Use `headless=True` in NovaAct constructor
- ONE NovaAct session — do NOT create multiple sessions
- Use `nova.act("short one-sentence instruction")` for browser actions
- Use `nova.page` (Playwright) for assertions (URL checks, element visibility, text content)
- `act()` returns `ActResult` with only `metadata` — NO `.response` attribute. Use `act_get()` with a schema for structured data extraction.
- Print PASS/FAIL for each check
- Delete the temp script after verification passes
- Max 5 steps per `act()` call to avoid timeouts: `nova.act("...", max_steps=5)`
