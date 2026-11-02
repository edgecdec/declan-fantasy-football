#!/bin/bash
# sim.sh <script> <hog_mb> [FF_DEPLOY_*=value ...]          (inside the VM, as root)
#
#   <script>   a git ref whose deploy_webhook.sh to test, or "worktree" for the file on disk
#   <hog_mb>   memory the "superconnections" stand-in holds: 300 is calm, 2400 runs the VM
#              out of RAM+swap mid-build (how the 2026-11-02 incident is reproduced)
#   SECOND_PUSH_AFTER=<s> in the environment fires a second push+webhook <s> seconds in
#
# Installs that script as origin/main, sets the overrides in fantasy-football's env (server.js
# passes its env to the deploy), fires a REAL signed webhook, then reports what happened to every
# pm2 app, the pm2-root unit, the kernel's OOM victims, the deploy log, status file and lock.
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(git -C "$HERE" rev-parse --show-toplevel)
APP=/var/www/FantasyFootball; LOG=/var/log/webhook_deploy_fantasy.log
src=$1; hog=$2; shift 2
scratch=$(mktemp -d); git clone -q -b main /srv/origin.git "$scratch"; cd "$scratch" || exit 1
if [ "$src" = worktree ]; then cp "$REPO/deploy_webhook.sh" .; else git -C "$REPO" show "$src:deploy_webhook.sh" > deploy_webhook.sh; fi
git add deploy_webhook.sh; git commit -q --allow-empty -m "sim: install $src deploy script"; git push -q origin HEAD:main
cd "$APP" || exit 1; git fetch -q origin main; git reset -q --hard origin/main
# `pm2 restart --update-env` MERGES env, so every knob is reset explicitly before the overrides.
env NODE_ENV=production FF_DEPLOY_BUILD_MEMORY_MAX= FF_DEPLOY_BUILD_SWAP_MAX= FF_DEPLOY_RETRY_SLEEP= "$@" \
  pm2 restart fantasy-football --update-env >/dev/null
HOG_MB=$hog pm2 restart superconnections --update-env >/dev/null
sleep 8; curl -s -o /dev/null localhost:3004/ || true
snap() {
  pm2 jlist | python3 -c 'import json,sys; print(" ".join(f"{p["name"]}:pid={p["pid"]}" for p in json.load(sys.stdin)))'
  echo "pm2-daemon=$(cat /root/.pm2/pm2.pid) pm2-root: $(systemctl is-active pm2-root), NRestarts=$(systemctl show pm2-root -p NRestarts --value)"
}
push_and_hook() {
  (cd "$scratch" && git commit -q --allow-empty -m "sim: trigger $1" && git push -q origin HEAD:main)
  local body='{"ref":"refs/heads/main"}' sig
  sig="sha256=$(printf '%s' "$body" | openssl dgst -sha256 -hmac testsecret | awk '{print $2}')"
  curl -s -o /dev/null -w "webhook $1: %{http_code}\n" -X POST -H "x-hub-signature-256: $sig" \
    -H 'content-type: application/json' --data "$body" localhost:3004/api/webhook
}
echo "== BEFORE"; snap; free -m | sed -n 2,3p
logstart=$(wc -l < "$LOG" 2>/dev/null || echo 0); since=$(date '+%F %T')
push_and_hook 1
if [ -n "${SECOND_PUSH_AFTER:-}" ]; then sleep "$SECOND_PUSH_AFTER"; push_and_hook 2; fi
want=$(git -C /srv/origin.git rev-parse --short main)
for _ in $(seq 1 450); do
  sleep 2
  tail -n +$((logstart+1)) "$LOG" 2>/dev/null | grep -qE "Deploy finished|DEPLOY FAILED" && break
  journalctl -u pm2-root --since "$since" -q | grep -q "Scheduled restart" && { sleep 8; break; }
done
sleep 10
echo "== DEPLOY LOG"
tail -n +$((logstart+1)) "$LOG" | grep -E "Deploy started|BUILD|build:|build-|OOM|DEPLOY|Deploy finished|queued|newer push|^Killed|WARNING|HEAD is now"
echo "== KERNEL OOM VICTIMS"
victims=$(journalctl -k --since "$since" -q | grep -oE "task_memcg=[^,]*,task=[^,]*,pid=[0-9]+")
if [ -n "$victims" ]; then printf '%s\n' "$victims" | sed 's/^/  /'; else echo "  (none)"; fi
echo "== pm2-root UNIT"
journalctl -u pm2-root --since "$since" -q | grep -E "OOM killer|Failed with result|Scheduled restart|All Applications Stopped" | sed 's/^/  /' || true
journalctl -u pm2-root --since "$since" -q | grep -q "OOM killer" || echo "  (no events)"
echo "== AFTER"; snap
echo "status: $(cat /var/lib/fantasy-deploy/status.json 2>/dev/null || echo none)"
echo "lock: $(flock -n /tmp/deploy_fantasy.flock true 2>/dev/null && echo free || echo HELD)  pending: $(ls /tmp/deploy_fantasy.pending 2>/dev/null || echo none)"
echo "checkout HEAD $(git -C "$APP" rev-parse --short HEAD) (latest pushed $want)  BUILD_ID $(cat "$APP/.next/BUILD_ID")  site $(curl -s -o /dev/null -w "%{http_code}" localhost:3004/)"
rm -rf "$scratch"
