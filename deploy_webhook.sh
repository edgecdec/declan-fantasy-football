#!/bin/bash
set -Eeuo pipefail

# Re-exec from a private snapshot of this file before doing anything else.
#
# server.js runs this script straight out of the checkout, and a few lines down it does
# `git reset --hard origin/main` — which rewrites THIS FILE while bash is still reading
# it. Bash reads a script lazily, remembering a byte offset, so once the file changes
# size underneath it the next read lands mid-statement and it executes garbage. Nothing
# had gone wrong yet only because the script had not changed length in a while.
if [ "${DEPLOY_SNAPSHOT:-}" != "1" ]; then
  _snap=$(mktemp /tmp/deploy_fantasy_snapshot.XXXXXX)
  cp "$0" "$_snap"
  # Safe to unlink immediately: bash holds an open fd, and on Linux the content survives
  # until that fd closes. This way no snapshot is left behind however the run ends.
  DEPLOY_SNAPSHOT=1 exec bash -c 'rm -f "$0"; . /dev/stdin' "$_snap" < "$_snap"
fi

# The FF_DEPLOY_* overrides exist so the script can be exercised end to end somewhere other than
# the VPS (see "Deploy invariants" in CLAUDE.md). Production sets none of them.
APP_DIR="${FF_DEPLOY_APP_DIR:-/var/www/FantasyFootball}"
LOG="${FF_DEPLOY_LOG:-/var/log/webhook_deploy_fantasy.log}"
PM2_NAME="fantasy-football"
# A flock, not "does the file exist". The kernel drops a flock when its holder dies, however it
# dies, so a SIGKILLed deploy cannot leave behind a stale lock that silently blocks every later
# deploy. A different path from the old /tmp/deploy_fantasy.lock on purpose: a flock file is never
# deleted (deleting it breaks the mutual exclusion), and if this script were ever reverted, the old
# existence check would read that permanent file as "deploy in progress" forever.
LOCK="/tmp/deploy_fantasy.flock"
# Touched by a push that lands while a deploy is running. See the build loop.
PENDING="/tmp/deploy_fantasy.pending"
# One JSON object describing the latest deploy: running, failed, deployed or skipped. The machine-readable
# half of "a failed deploy is loud"; the "DEPLOY FAILED" line in the log is the human half.
STATUS_FILE="${FF_DEPLOY_STATUS_FILE:-/var/lib/fantasy-deploy/status.json}"
# The memory budget for everything here that can get big: npm install, next build, the bot's tsc.
# See run_contained for why this exists and how the numbers were chosen.
BUILD_MEMORY_MAX="${FF_DEPLOY_BUILD_MEMORY_MAX:-1400M}"
BUILD_SWAP_MAX="${FF_DEPLOY_BUILD_SWAP_MAX:-1536M}"
RETRY_SLEEP="${FF_DEPLOY_RETRY_SLEEP:-20}"

exec >> "$LOG" 2>&1
echo "=========================================="
echo "Deploy started: $(date)"

exec 9>"$LOCK"
if ! flock -n 9; then
  touch "$PENDING"
  echo "Deploy already in progress; queued. The running deploy rebuilds from this push before it swaps."
  exit 0
fi

STARTED=$(date -u +%FT%TZ)
COMMIT=""
set_status() {  # <state> <detail>
  local detail
  detail=$(printf '%s' "$2" | tr -d '"\\\n')
  # In a `||` list on purpose, which exempts it from `set -e` and the ERR trap: failing to write
  # the status file must never be what fails a deploy.
  { mkdir -p "${STATUS_FILE%/*}" &&
    printf '{"state":"%s","commit":"%s","pid":%d,"started":"%s","updated":"%s","detail":"%s"}\n' \
      "$1" "$COMMIT" "$$" "$STARTED" "$(date -u +%FT%TZ)" "$detail" > "$STATUS_FILE.tmp" &&
    mv -f "$STATUS_FILE.tmp" "$STATUS_FILE"; } 2>/dev/null || echo "WARNING: could not write $STATUS_FILE"
}
# Every way out of this script other than the pm2 handoff is a failed deploy, and says so.
fail() {
  trap - EXIT ERR TERM INT HUP
  echo "DEPLOY FAILED: $1 -- the live site is untouched and still serving build $(cat "$APP_DIR/.next/BUILD_ID" 2>/dev/null || echo '?')."
  set_status failed "$1"
  rm -rf "$APP_DIR/.next.new"
  exit 1
}
FAILED_AT=""
trap 'FAILED_AT="line $LINENO: $BASH_COMMAND"' ERR
trap 'rc=$?; [ "$rc" -eq 0 ] || fail "deploy script exited $rc at ${FAILED_AT:-an unknown point}"' EXIT
trap 'fail "interrupted by a signal (was pm2-root or fantasy-football restarted mid-deploy?)"' TERM INT HUP
# The pre-flock script's lock. Only one window matters: the first deploy after this script lands
# still runs the OLD script, which holds this file. A push during that deploy runs THIS script,
# and two builds at once is exactly the OOM this file exists to prevent. So a fresh one is honored,
# and a stale one (an old run that was SIGKILLed) is cleared.
if [ -n "$(find /tmp/deploy_fantasy.lock -mmin -30 2>/dev/null)" ]; then
  echo "A deploy from the previous version of this script is still running; not building alongside it. This push is NOT deployed -- push again once it finishes."
  set_status skipped "an old-style deploy held /tmp/deploy_fantasy.lock"
  trap - EXIT
  exit 0
fi
rm -f /tmp/deploy_fantasy.lock
set_status running "started"

cd "$APP_DIR"

# Run a memory-hungry step in its OWN cgroup, with its own memory cap, as the OOM killer's
# first choice.
#
# Why: server.js launches this script, so everything it starts lives inside systemd's
# pm2-root.service cgroup alongside all twelve pm2 apps. That unit has systemd's default
# OOMPolicy=stop, so ANY kernel OOM kill inside it — a build, or SuperConnections picked as the
# victim because a build squeezed it — makes systemd stop the whole unit: `pm2 kill`, every app
# down, then resurrected a second later. The kill also took THIS script with it, which is why
# "BUILD FAILED -- retrying once" was always the last line logged and the retry never ran. It
# happened twelve times between 2026-09-08 and 2026-11-02, every one during a deploy of this site.
#
# A transient scope is a sibling of pm2-root.service, not a child, so an OOM kill in it never
# reaches pm2-root's OOM accounting. The cap makes an over-budget build hit its own limit first,
# and an OOM inside a capped cgroup can only pick victims from inside that cgroup. oom_score_adj
# 1000 covers the remaining case — the whole box running out before the build reaches its cap —
# by making a build process the kernel's top pick over any app.
#
# The cap: Turbopack's footprint is native memory that NODE_OPTIONS cannot bound, and no Next or
# Turbopack setting moved it (turbopackMemoryLimit, cpus: 1, single-threaded runtime and
# in-process builds were all measured; webpack is worse). This build needs 1.8-2.0GB of RAM+swap
# in total. Under a 1400MB RAM cap with nothing else competing it spilled 633MB to swap; on the
# box the apps keep ~600MB resident, so it spills more. 1400MB of RAM leaves ~500MB for the apps;
# 1.5GB of swap covers the spill with room for the build to grow.
CAN_CONTAIN=0
if [ -d /run/systemd/system ] && command -v systemd-run >/dev/null 2>&1; then CAN_CONTAIN=1; fi
# Runs as the scope's main process: lowers its own OOM priority, runs the step, then reports what
# the cgroup actually used. That is the number to watch against the cap; the "peak RSS" line from
# /usr/bin/time covers only the largest single process.
CONTAINED_WRAPPER='
label=$0; cap=$1; shift
echo 1000 > /proc/self/oom_score_adj
cg=/sys/fs/cgroup$(sed -n "s/^0:://p" /proc/self/cgroup)
rc=0; "$@" || rc=$?
kills=$(sed -n "s/^oom_kill //p" "$cg/memory.events" 2>/dev/null)
echo "[$(date +%T)] $label: cgroup peak $(( $(cat "$cg/memory.peak" 2>/dev/null || echo 0) / 1048576 ))MB RAM + $(( $(cat "$cg/memory.swap.peak" 2>/dev/null || echo 0) / 1048576 ))MB swap (cap $cap), oom_kill=${kills:-?}, exit $rc"
if [ "${kills:-0}" != 0 ]; then
  echo "[$(date +%T)] $label: OOM-KILLED inside its own cgroup. The victim was a $label process; pm2 and every app were outside it."
fi
exit $rc'
run_contained() {  # <label> <command...>
  local label=$1; shift
  if [ "$CAN_CONTAIN" != 1 ]; then
    echo "WARNING: no systemd here; '$label' runs WITHOUT its own memory cgroup."
    "$@"
    return
  fi
  local unit rc=0
  unit="fantasy-deploy-$label-$(date +%s)-$$"
  # OOMPolicy=continue: when the OOM killer takes the build, let the wrapper live long enough to
  # report it. The `systemctl stop` then reaps anything the kill left behind.
  systemd-run --scope --quiet --collect --unit="$unit" \
    -p MemoryMax="$BUILD_MEMORY_MAX" -p MemorySwapMax="$BUILD_SWAP_MAX" -p OOMPolicy=continue \
    /bin/bash -c "$CONTAINED_WRAPPER" "$label" "$BUILD_MEMORY_MAX RAM + $BUILD_SWAP_MAX swap" "$@" || rc=$?
  systemctl stop "$unit.scope" >/dev/null 2>&1 || true
  return $rc
}

# git, with automatic garbage collection switched OFF.
#
# `git fetch` runs `git gc --auto` in the background once loose objects pass ~6700, and on this box
# that is a ~6-minute, ~800MB repack: data/sleeper_players.json is 22MB and is committed daily, so
# loose objects reach 800MB. On 2026-11-02 that repack ran alongside the build in the same cgroup,
# and the build was OOM-killed at its smallest-ever peak. fetch.unpackLimit=1 stops new loose
# objects piling up by keeping each fetched pack as a pack. Packs still accumulate, about one per
# deploy, so gc belongs to a scheduled off-slate job with its own memory cap. That job lives on the
# box, not in this repo; it is in CLAUDE.md under "Deploy invariants".
git_() { git -c gc.auto=0 -c maintenance.auto=false -c fetch.unpackLimit=1 "$@"; }

OLD_HEAD=$(git rev-parse HEAD 2>/dev/null || echo "")

# npm install runs when package.json differs from the one node_modules was last installed for.
# That is recorded in a stamp file. The old check compared package.json before and after the
# fetch, so a failed install was never retried: the next deploy saw "unchanged" and built
# against stale node_modules. Seeded from the current package.json the first time.
PKG_STAMP=node_modules/.deploy-package-json.md5
if [ -d node_modules ] && [ ! -f "$PKG_STAMP" ]; then md5sum package.json | cut -d' ' -f1 > "$PKG_STAMP"; fi
install_if_needed() {
  local want
  want=$(md5sum package.json | cut -d' ' -f1)
  [ "$want" != "$(cat "$PKG_STAMP" 2>/dev/null)" ] || return 0
  echo "package.json changed, running npm install..."
  # --include=dev is explicit on purpose: the build needs typescript, and if the
  # dev tree is ever missing Next tries to `npm install typescript` from inside
  # `next build`, which wedges on this box and leaves no .next at all.
  run_contained npm-install npm install --include=dev || fail "npm install failed for $COMMIT"
  echo "$want" > "$PKG_STAMP"
}

# Build into a scratch directory and swap it in only once it succeeds.
#
# This used to be `rm -rf .next && npm run build`, which had two problems: the running
# server had no build underneath it for the entire build, and a failed build left it that
# way permanently. That is how this site 502'd when a Next bump pushed the build over the
# old 1536MB heap. Now the live .next keeps serving throughout, and a failure changes
# nothing at all.
#
# A pre-build typecheck would be the obvious extra guard and is deliberately NOT here:
# `tsc --noEmit` aborts with an out-of-memory on this 1.9GB box even at a 1400MB heap.
# Typechecking lives in CI, which has the memory for it. Note CI runs in PARALLEL with
# this script rather than gating it, so this rollback is the real safety net, not CI.
# 1536, NOT 3072. This box has 1919MB of RAM and runs ten other pm2 apps holding about
# 1.1GB, leaving roughly 860MB free. Telling V8 it may use 3072MB on a box that cannot
# back it means V8 never collects aggressively — it just grows until the kernel OOM-killer
# takes it, which is precisely what happened on the first run of the atomic-swap deploy
# (killed at 1.09GB anon-rss with a 36GB virtual reservation).
#
# Note the earlier bump from 1536 to 3072 was aimed at a DIFFERENT failure: a clean V8
# "heap out of memory" JS error. Raising the ceiling only converted that into a kernel
# kill. Measured on this box: both 1024 and 1536 complete the build in about 28s, so a
# smaller ceiling is strictly better here — it makes V8 do the collecting instead of the
# kernel doing the killing.
#
# 768, DOWN FROM 1536, because 1536 did not fit and a real deploy proved it. On 2026-09-16 a
# build was 36 seconds in when the kernel logged
#   Out of memory: Killed process (node /var/www/SuperConnections/server.js)
# and this build died with it, mid "Generating static pages", leaving no error in this log at
# all — just a truncated block. The site kept serving the old build (the atomic swap working as
# intended) but the deploy was silently lost, and the collateral damage was ANOTHER app.
# (Not just SuperConnections, as it turned out: that kill was one of the twelve pm2-root stops
# described at run_contained, so every app went down with it.)
#
# The number was then MEASURED on this box rather than reasoned about, and the obvious theory
# turned out to be wrong. Lowering the cap does NOT lower peak RSS, because most of the build's
# footprint is Turbopack's native memory, which lives outside V8's JS heap and ignores this flag:
#
#   cap    build   wall    peak RSS   swap displaced
#   1024   ok      33.4s   1203MB     +472MB
#    768   ok      33.4s   1244MB      +15MB
#    640   ok      32.2s   1272MB       -2MB
#
# Peak RSS is flat-to-slightly-worse as the cap falls; what collapses is how much the build
# pushes OUT of RAM into the (already half-full) 2GB swapfile, and that displacement is what
# precedes the kernel picking a victim. 768 buys it for free — same wall time, and it keeps more
# headroom against a genuine V8 "heap out of memory" than 640 does as this codebase grows.
#
# Context for the sizing: 1919MB physical, other pm2 apps holding ~772MB resident, of which
# SuperConnections alone is 477MB. That app is the real ceiling here — capping ITS memory would
# buy more than any further tuning of this flag.
export NODE_OPTIONS='--max-old-space-size=768'

rm -rf .next.new .next.old

# Peak RSS in the log, every deploy. The 2026-09-16 kill took a while to diagnose precisely
# because nothing recorded how close the build actually came to the limit; a one-line
# measurement means the next person can see the trend instead of re-deriving it.
build_once() {
  local rc=0
  rm -rf .next.new
  NEXT_DIST_DIR=.next.new run_contained build \
    /usr/bin/time -f 'build: peak RSS %M kB (largest process), wall %E' npm run build || rc=$?
  # `next build` rewrites tsconfig.json to add distDir-specific type globs, so building into
  # a scratch dir leaves a tracked file modified. Put it back, or the checkout drifts.
  git checkout -- tsconfig.json 2>/dev/null || true
  [ "$rc" -eq 0 ] || return 1
  [ -f .next.new/BUILD_ID ] || { echo "BUILD PRODUCED NO BUILD_ID -- refusing to swap."; return 1; }
}

# Fetch, build, and retry once, in a loop that picks up any push landing mid-build.
#
# Retried ONCE, because the failure this guards against is transient memory pressure from the
# other apps rather than anything wrong with the commit — the same commit built fine 19 minutes
# later. A retry turns "the deploy vanished, push an empty commit to try again" into something
# that heals itself. It can only do that if this script survives the first failure, which it
# never did before builds ran in their own cgroup (see run_contained).
#
# The loop exists because a push that lands while a deploy is running cannot run its own deploy:
# it finds the lock held. It used to exit and that push was silently never deployed. Now it marks
# PENDING, and this deploy rebuilds from the newer commit before swapping, rather than shipping a
# build it already knows is stale. Bounded at three passes so a burst of pushes cannot keep the
# site from ever being deployed.
pass=1
while :; do
  rm -f "$PENDING"
  git_ fetch origin main
  git_ reset --hard origin/main
  COMMIT=$(git rev-parse --short HEAD)
  set_status running "building $COMMIT (pass $pass)"
  install_if_needed
  built=0
  if build_once; then
    built=1
  else
    echo "[$(date +%T)] BUILD FAILED -- letting memory settle, then retrying once."
    sleep "$RETRY_SLEEP"
    if build_once; then built=1; fi
  fi
  if [ -f "$PENDING" ] && [ "$pass" -lt 3 ]; then
    echo "A newer push arrived during the build; rebuilding from it before swapping."
    pass=$((pass + 1))
    continue
  fi
  [ "$built" -eq 1 ] || fail "build failed twice for $COMMIT (look for OOM-KILLED above)"
  break
done

# Swap. Two renames on the same filesystem, so the window where .next is absent is
# microseconds rather than the length of a build.
if [ -d .next ]; then mv .next .next.old; fi
mv .next.new .next

# .next.old is deliberately NOT deleted here. It is one generation of rollback material,
# and `rm -rf .next.new .next.old` at the top of the next deploy bounds it to a single
# copy (94M against 7.4G free). If a deploy ever ships a build that will not boot,
# `mv .next.old .next && pm2 restart fantasy-football` is the manual way back.

# The Discord bot, if it changed.
#
# Built and restarted HERE, above the pm2 handoff below, because nothing survives that line — it
# restarts the process that launched this script, taking the whole process group with it. A bot
# restart placed after it would simply never run.
#
# Conditional on bot/ or the lockfile changing, so a routine site deploy does not drop the gateway
# connection mid-slate. That matters more than it sounds: reconnecting loses any in-flight
# interaction, and a Sunday deploy would otherwise take the notifications down with it.
#
# Diffed against the HEAD this deploy started from rather than HEAD@{1}: with the rebuild loop,
# HEAD@{1} can be a commit from earlier in this same run, which would hide a bot change.
DIFF_BASE=$OLD_HEAD
[ -n "$DIFF_BASE" ] || DIFF_BASE='HEAD@{1}'
if git diff --name-only "$DIFF_BASE" HEAD 2>/dev/null | grep -qE '^(bot/|package-lock\.json)'; then
  echo "bot/ changed, rebuilding and restarting fantasy-bot..."
  if run_contained bot-build node scripts/build-bot.mjs; then
    # `|| true` because the bot may not be registered with pm2 yet on a first deploy, and a missing
    # app must not fail the whole deploy and leave the SITE unreleased. `9>&-` so a pm2 daemon this
    # spawns (if none was running) cannot inherit the deploy lock and hold it for ever.
    pm2 restart fantasy-bot --update-env 9>&- || echo "fantasy-bot not registered with pm2 yet; skipping"
  else
    echo "BOT BUILD FAILED -- leaving the running bot alone; the site deploy continues."
  fi
fi

if [ -f "$PENDING" ]; then
  echo "WARNING: another push arrived during the final rebuild and is NOT in this deploy -- push again or redeliver the webhook."
fi

# EVERYTHING MUST HAPPEN ABOVE THIS LINE.
#
# `pm2 restart fantasy-football` restarts the very process that launched this script:
# server.js receives the webhook and does execFile("bash", ["deploy_webhook.sh"]), so pm2
# takes the whole process group down with it. Nothing below survives.
#
# This is not a theory. Across 384 recorded deploys the log contains "Deploy started" 384
# times and "Deploy finished" exactly zero times — the old script's final lines had never
# once executed, which is why a `.next.old` was left on disk and tsconfig.json stayed
# dirty. An `if ! pm2 restart; then rollback; fi` guard used to sit here and was
# unreachable dead code for the same reason; it has been removed rather than left to
# imply a safety net that cannot fire.
#
# So the status is written as "deployed" BEFORE the restart, and the traps are cleared: pm2's
# SIGTERM must not be reported as a failed deploy. The lock is released by closing its fd; the
# kernel would drop it when this process dies anyway, so this is belt and braces.
set_status deployed "build $(cat .next/BUILD_ID) swapped in for $COMMIT; pm2 restart issued"
trap - EXIT ERR TERM INT HUP
exec 9>&-

echo "Deploy finished (handing off to pm2, which ends this script): $(date)"
echo "=========================================="
pm2 restart "$PM2_NAME"
