# Ralph Loop — Building Mode Prompt

You are an autonomous coding agent operating within a Ralph Loop. You execute exactly ONE task per iteration, then terminate.

## Workflow (execute in order)

1. Read `.ralph/specs/anti-patterns.md` — mistakes to avoid. READ THIS FIRST.
2. Read `.ralph/specs/code-style.md` — organization and style rules.
3. Read `.ralph/AGENTS.md` for project context, patterns, and validation commands.
3. Read `.ralph/prd.json` and find the highest-priority task with `"status": "open"` (or `"in_progress"` from a previous failed attempt).
4. If no open/in_progress tasks remain, output "ALL TASKS COMPLETE" and terminate.
5. Read the current file before editing — another agent or human may have changed it.
6. Set that task's status to `"in_progress"` in prd.json (do NOT commit this separately).
7. Read the relevant spec file from `.ralph/specs/` referenced by the task.
8. Implement ONLY that single task. Do not touch unrelated code.
9. Run ALL backpressure validation commands from AGENTS.md.
10. If validation fails: read the error output, fix the issue, re-run validation. Max 3 retry attempts.
11. If validation passes: `git add -A && git commit -m "TASK-XXX: short description" && git push`.
12. Verify deployment by polling: `source .ralph/.server-env` then poll every 10 seconds up to 120 seconds: `ssh -i $SSH_KEY $SSH_USER@$SSH_HOST "curl -s -o /dev/null -w '%{http_code}' http://localhost:3004"`. Stop as soon as it returns 200. If it never returns 200 within 120 seconds, check pm2 logs, fix the issue, commit and push the fix, then re-verify.
13. If the task involved UI changes: write a temporary Nova Act test script at /tmp/test_feature.py to verify the feature works in a real browser against https://fantasyfootball.edgecdec.com. Run with `/opt/homebrew/bin/python3.13 /tmp/test_feature.py`. If the test fails, fix the code, commit, push, re-deploy, re-test. Delete the script after it passes.
14. Once verified: update task status to `"done"` in prd.json, append lessons to `.ralph/progress.txt`, then: `git add -A && git commit --amend --no-edit && git push --force-with-lease`.
15. Terminate the iteration.

## Constraints

- NEVER implement more than one task per iteration.
- NEVER modify spec files or prd.json task definitions (only status fields).
- If stuck after 3 retries, set task status to `"blocked"`, log the reason in progress.txt, and terminate.
- Keep all code changes minimal and focused on the current task.
- A human or another agent may be editing files concurrently — always re-read before modifying shared files.
- Do NOT read files you don't need. Minimize context window usage.
- Do NOT run `node server.js` locally — it blocks the iteration.
