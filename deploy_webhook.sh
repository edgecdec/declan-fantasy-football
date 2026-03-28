#!/bin/bash
set -euo pipefail

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
  npm install
fi

rm -rf .next
NODE_OPTIONS='--max-old-space-size=1536' npm run build

pm2 restart "$PM2_NAME"

echo "Deploy finished: $(date)"
echo "=========================================="
