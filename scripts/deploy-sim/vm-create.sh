#!/bin/bash
# Create the Lima VM that mirrors the VPS: Ubuntu 24.04 (kernel 6.8, systemd 255), 2 CPUs, 2GB RAM,
# plus a 2GB swapfile, Node 20.20.0 and pm2 6.0.14 -- the versions on the box as of 2026-11.
# The VM type is vz, so it needs macOS on Apple silicon. It is aarch64 where the box is x86_64;
# Turbopack's footprint measured within ~10% of the box's.
set -euo pipefail
NAME=${1:-ff-oom}
limactl create --name "$NAME" --cpus 2 --memory 2 --disk 20 --vm-type vz --tty=false template:ubuntu-24.04
limactl start "$NAME"
limactl shell "$NAME" -- sudo bash -euc '
  curl -fsSL https://nodejs.org/dist/v20.20.0/node-v20.20.0-linux-arm64.tar.xz | tar -xJ -C /usr/local --strip-components=1
  npm i -g pm2@6.0.14 >/dev/null 2>&1
  mkdir -p /usr/lib/node_modules && ln -sfn /usr/local/lib/node_modules/pm2 /usr/lib/node_modules/pm2
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  apt-get install -y -qq time shellcheck >/dev/null 2>&1 || true
  git config --global --add safe.directory "*"
  git config --global user.email sim@localhost; git config --global user.name deploy-sim'
echo "VM $NAME ready. Next: limactl shell $NAME -- sudo bash $(cd "$(dirname "$0")" && pwd)/vm-setup.sh"
