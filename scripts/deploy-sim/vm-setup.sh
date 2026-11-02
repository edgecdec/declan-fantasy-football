#!/bin/bash
# Inside the VM, as root. A bare repo stands in for GitHub, plus a checkout at the box's path and
# pm2 under a pm2-root.service byte-identical to the VPS's (OOMPolicy=stop by default). The pm2
# apps are the real server.js as fantasy-football and two memory hogs standing in for the rest.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(git -C "$HERE" rev-parse --show-toplevel)
APP=/var/www/FantasyFootball
rm -rf /srv/origin.git "$APP"
git clone -q --bare "$REPO" /srv/origin.git
git -C /srv/origin.git symbolic-ref HEAD refs/heads/main
git clone -q -b main /srv/origin.git "$APP"
cd "$APP"
npm ci --include=dev --no-audit --no-fund >/tmp/npm-ci.log 2>&1
printf 'PORT=3004\nWEBHOOK_SECRET=testsecret\n' > .env
NODE_OPTIONS=--max-old-space-size=768 ./node_modules/.bin/next build >/tmp/initial-build.log 2>&1
git checkout -q -- tsconfig.json || true
mkdir -p /opt/hog && cp "$HERE/hog.js" /opt/hog/hog.js
cp "$HERE/pm2-root.service" /etc/systemd/system/pm2-root.service
systemctl stop pm2-root 2>/dev/null || true; pm2 kill >/dev/null 2>&1 || true
NODE_ENV=production pm2 start server.js --name fantasy-football --cwd "$APP" >/dev/null
HOG_MB=300 pm2 start /opt/hog/hog.js --name superconnections >/dev/null
HOG_MB=100 pm2 start /opt/hog/hog.js --name worldcup >/dev/null
pm2 save >/dev/null; pm2 kill >/dev/null
systemctl daemon-reload; systemctl enable --now pm2-root.service; sleep 4
pm2 ls; curl -s -o /dev/null -w "site %{http_code}\n" localhost:3004/
