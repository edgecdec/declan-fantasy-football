#!/bin/bash
set -euo pipefail

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

APP_DIR="/var/www/FantasyFootball"
LOG="/var/log/webhook_deploy_fantasy.log"
LOCK="/tmp/deploy_fantasy.lock"
PM2_NAME="fantasy-football"

exec >> "$LOG" 2>&1
echo "=========================================="
echo "Deploy started: $(date)"

if [ -f "$LOCK" ]; then
  echo "Deploy already in progress, exiting."
  exit 0
fi
trap 'rm -f "$LOCK"' EXIT
touch "$LOCK"

cd "$APP_DIR"

OLD_PKG_HASH=$(md5sum package.json 2>/dev/null | cut -d' ' -f1 || echo "none")

git fetch origin main
git reset --hard origin/main

NEW_PKG_HASH=$(md5sum package.json | cut -d' ' -f1)

if [ "$OLD_PKG_HASH" != "$NEW_PKG_HASH" ]; then
  echo "package.json changed, running npm install..."
  # --include=dev is explicit on purpose: the build needs typescript, and if the
  # dev tree is ever missing Next tries to `npm install typescript` from inside
  # `next build`, which wedges on this box and leaves no .next at all.
  npm install --include=dev
fi

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
export NODE_OPTIONS='--max-old-space-size=1536'

rm -rf .next.new .next.old
if ! NEXT_DIST_DIR=.next.new npm run build; then
  echo "BUILD FAILED -- keeping the existing build; the site is untouched."
  rm -rf .next.new
  exit 1
fi

if [ ! -f .next.new/BUILD_ID ]; then
  echo "BUILD PRODUCED NO BUILD_ID -- refusing to swap; the site is untouched."
  rm -rf .next.new
  exit 1
fi

# Swap. Two renames on the same filesystem, so the window where .next is absent is
# microseconds rather than the length of a build.
if [ -d .next ]; then mv .next .next.old; fi
mv .next.new .next

# `next build` rewrites tsconfig.json to add distDir-specific type globs, so building into
# a scratch dir leaves a tracked file modified. Put it back, or the checkout drifts.
git checkout -- tsconfig.json 2>/dev/null || true

# .next.old is deliberately NOT deleted here. It is one generation of rollback material,
# and `rm -rf .next.new .next.old` at the top of the next deploy bounds it to a single
# copy (94M against 7.4G free). If a deploy ever ships a build that will not boot,
# `mv .next.old .next && pm2 restart fantasy-football` is the manual way back.

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
# Release the lock explicitly first: the EXIT trap is not guaranteed to run when pm2
# terminates the group, and a leftover lock would make every future deploy exit early
# with "Deploy already in progress".
rm -f "$LOCK"
trap - EXIT

echo "Deploy finished (handing off to pm2, which ends this script): $(date)"
echo "=========================================="
pm2 restart "$PM2_NAME"
