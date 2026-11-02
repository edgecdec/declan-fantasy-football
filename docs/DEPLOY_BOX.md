# Box-side settings for the deploy (VPS 5.78.132.57)

`deploy_webhook.sh` protects itself (see "Deploy invariants" in `CLAUDE.md`). These settings live
on the box, not in the repo, and close the gaps the script cannot reach. Each one is independent
and needs a human: nothing here restarts a pm2 app.

Facts below were verified read-only on the box on 2026-11-02. The steps marked **[VM-verified]**
were also run, with their verification, against the matching VM in `scripts/deploy-sim/`.

## 1. One OOM kill must not restart every pm2 app — do this first

`pm2-root.service` runs with systemd's default `OOMPolicy=stop`. When the kernel OOM-kills any
process in the unit's cgroup, systemd stops the whole unit: `ExecStop=pm2 kill`, all twelve apps
down, then `Restart=on-failure` resurrects them a second later. It has done this 12 times, from
2026-09-08 to 2026-11-02 (`NRestarts=11`, plus the first one). In 5 of them the victim was
SuperConnections, not a build. The script change stops builds from triggering it, but any app
leaking into an OOM still would.

The VM shows this concretely. With something else already holding the memory (a leftover 963MB
repack), the new script's build was correctly the first victim. Seven seconds later, in the
retry's sleep with no build running, the box was still out of memory: the kernel took an app in
pm2-root, and every app restarted. Only this setting prevents that. Conversely, with this
setting but the OLD script, there was no mass restart, but the app was OOM-killed 155 times
while the build ran. The two fixes cover different failures.

**[VM-verified]**

```bash
# before: note the pm2 daemon pid and app pids
systemctl show pm2-root -p OOMPolicy -p MainPID -p NRestarts; pm2 jlist | python3 -c 'import json,sys;[print(p["name"],p["pid"]) for p in json.load(sys.stdin)]'

mkdir -p /etc/systemd/system/pm2-root.service.d
cat > /etc/systemd/system/pm2-root.service.d/oom-policy.conf <<'EOF'
[Service]
# The default, OOMPolicy=stop, turns ANY kernel OOM kill inside this cgroup into `pm2 kill` plus a
# resurrect of every app. With continue, systemd only logs it and pm2 restarts the one app that died.
OOMPolicy=continue
EOF
systemctl daemon-reload        # reloads unit files; does NOT restart pm2-root or any app

# after: OOMPolicy=continue, and MainPID / NRestarts / every app pid unchanged
systemctl show pm2-root -p OOMPolicy -p MainPID -p NRestarts; pm2 jlist | python3 -c 'import json,sys;[print(p["name"],p["pid"]) for p in json.load(sys.stdin)]'
```

Rollback: `rm /etc/systemd/system/pm2-root.service.d/oom-policy.conf && systemctl daemon-reload`.

## 2. Take git gc off the deploy path

`data/sleeper_players.json` (22MB) is committed daily, so the checkout piles up loose objects:
7,978 loose objects / 800MB on 2026-11-02. Past ~6,700, every `git fetch` starts a background
`git gc --auto`, a ~6 min repack peaking at ~790MB RSS. It runs inside `pm2-root.service` with
the highest OOM score on the box. On 2026-11-02 one ran alongside the build and the build was
OOM-killed. The deploy script now passes `gc.auto=0` itself; this makes the repo agree, and moves
gc to an off-slate weekly job in its own capped cgroup.

**[VM-verified]** on a repo in the box's state (9,230 loose objects, 963MB), the job below
packed everything into one 385MB pack. Its anon peak was 187MB (the uncapped repack on the box
reached 790MB), with 0 OOM kills and a 617s wall time at nice 19 / CPUWeight 20.

```bash
git -C /var/www/FantasyFootball config gc.auto 0
git -C /var/www/FantasyFootball config maintenance.auto false

cat > /usr/local/bin/fantasy_git_gc.sh <<'EOF'
#!/bin/bash
# Weekly off-slate gc of the FantasyFootball checkout, in its own capped cgroup, never during a
# deploy. Its own oom_score_adj 1000 makes it, not an app, the victim if the box runs short.
set -uo pipefail
exec >> /var/log/fantasy_git_gc.log 2>&1
echo "== $(date -u +%FT%TZ)"
if ! flock -n /tmp/deploy_fantasy.flock true; then echo "deploy in progress; skipping this week"; exit 0; fi
systemd-run --scope --quiet --collect --unit="fantasy-git-gc-$(date +%s)" \
  -p MemoryMax=600M -p MemorySwapMax=1G -p CPUWeight=20 -p IOWeight=20 -p OOMPolicy=continue \
  /bin/bash -c 'echo 1000 > /proc/self/oom_score_adj; exec nice -n 19 git -C /var/www/FantasyFootball \
    -c pack.threads=1 -c pack.windowMemory=100m -c pack.deltaCacheSize=32m gc --quiet'
echo "exit $?; $(git -C /var/www/FantasyFootball count-objects -vH | tr '\n' ' ')"
EOF
chmod +x /usr/local/bin/fantasy_git_gc.sh

# Tuesday 10:00 UTC: no NFL games on Tuesdays.
echo '0 10 * * 2 root /usr/local/bin/fantasy_git_gc.sh' > /etc/cron.d/fantasy-git-gc
```

The first run packs the existing 800MB in about 10 minutes. Run it once by hand off-slate
(`/usr/local/bin/fantasy_git_gc.sh; tail /var/log/fantasy_git_gc.log`), and expect
`count: 0` loose objects afterwards. A gc that starts while no deploy is running can still
overlap a deploy that starts later. That is safe: both are in separate capped cgroups with
OOM priority 1000, so neither can take down an app.

## 3. More swap

The build needs 1.8–2.0GB of RAM+swap. The other apps hold ~1.0–1.1GB (SuperConnections alone
reached ~830MB, mostly swapped, by the 2026-11-02 OOM), and the 2GB swapfile had 204kB free
when that OOM fired. 12GB of disk is free.

Add a **second** file rather than resizing the first. `swapoff` on the current one would force
its ~800MB back into RAM, which is itself an OOM risk.

```bash
fallocate -l 2G /swapfile2 && chmod 600 /swapfile2 && mkswap /swapfile2 && swapon /swapfile2
grep -q swapfile2 /etc/fstab || echo '/swapfile2 none swap sw 0 0' >> /etc/fstab
swapon --show; free -m      # expect Swap total ~4095
```

## Order

1 first, any time; it is a config reload and touches no app. Then merge `fix/deploy-oom`
outside a slate. That merge deploys with the OLD script one last time, because server.js runs
the file from before `git reset`, and step 1 is what protects that run. 2 and 3 any time
off-slate.

## Not recommended now: building in CI and shipping the artifact

This takes the build off the box entirely, and it is feasible: `.env` has no `NEXT_PUBLIC_*`
keys, so the bundle needs no box secrets, and `better-sqlite3` is a runtime external. The costs:
a new credential (a token on the box to pull artifacts, or a deploy key in GitHub for CI to push),
deploys gated on CI finishing (~3–4 min instead of ~80s), and a second deploy path to maintain.
Worth it only if builds still fail once 1–3 are in place. The status file and `DEPLOY FAILED`
lines will show whether they do.
