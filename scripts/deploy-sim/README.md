# deploy-sim — run `deploy_webhook.sh` end to end before it reaches the VPS

The deploy script's failures have all been about the box rather than the code: memory, process
groups, systemd, what survives `pm2 restart`. None of that can be checked on a Mac. This drives
the real path — a signed GitHub webhook → `server.js` → `deploy_webhook.sh` → pm2 — in a VM
built to match the box:

| | VPS (2026-11) | VM |
|---|---|---|
| OS / kernel / systemd | Ubuntu 24.04.4, 6.8, 255 | same |
| CPUs / RAM / swap | 2 / 1919MB / 2GB file | 2 / 1958MB / 2GB file |
| Node / pm2 | 20.20.0 / 6.0.14 | same |
| pm2 supervisor | `pm2-root.service`, default `OOMPolicy=stop` | byte-identical unit (`pm2-root.service` here) |
| other apps | 10 more pm2 apps, SuperConnections the largest | `superconnections` + `worldcup` memory hogs (`hog.js`) |

The VM is aarch64 where the box is x86_64. The build's peak largest-process RSS was 1.39–1.54GB
in the VM and 1.07–1.44GB on the box.

## Use

```bash
scripts/deploy-sim/vm-create.sh                       # once: Lima VM "ff-oom" (needs `limactl`)
limactl shell ff-oom -- sudo bash $PWD/scripts/deploy-sim/vm-setup.sh
limactl shell ff-oom -- sudo bash $PWD/scripts/deploy-sim/sim.sh <script> <hog_mb> [FF_DEPLOY_*=v ...]
```

`<script>` is a git ref whose `deploy_webhook.sh` to install as origin/main, or `worktree` for the
file on disk. The VM mounts your home directory read-only at the same path, so edits are picked up
without copying.

## The scenarios that matter (results from 2026-11-02)

| # | Command | Expect |
|---|---|---|
| 1 | `sim.sh 219179e 2400` | **The incident.** The old script runs the VM out of RAM+swap and the kernel kills a pm2 app. `pm2-root: Failed with result 'oom-kill'`, every pid changes, and the log ends at "retrying once" |
| 2 | `sim.sh worktree 2400` | Same pressure. The kernel's victim is in `fantasy-deploy-build-*.scope`, the retry runs, `DEPLOY FAILED` plus status `failed`, every app pid is unchanged, the lock is free |
| 3 | `sim.sh worktree 300 FF_DEPLOY_BUILD_MEMORY_MAX=600M FF_DEPLOY_BUILD_SWAP_MAX=200M` | Cap forced low: OOM-killed twice inside its own cgroup (`CONSTRAINT_MEMCG`), the retry runs, apps untouched |
| 4 | `sim.sh worktree 800` | Normal deploy: builds under the default cap, swaps, status `deployed`, only fantasy-football restarts |
| 5 | `SECOND_PUSH_AFTER=5 sim.sh worktree 300` | The second push is queued, and the first deploy rebuilds from it. The deployed HEAD equals the latest push |

`measure.sh` bisected the build's memory: Turbopack
needs 1.8–2.0GB of RAM+swap however it is configured. That is why the script's cap is 1400M + 1.5G
rather than anything smaller.

## Gotchas found building this

- `pm2 restart --update-env` **merges** env, so a previous run's `FF_DEPLOY_*` override sticks.
  `sim.sh` blanks every knob before applying the new ones.
- A hog whose buffers are unreachable gets garbage-collected and the pressure silently vanishes.
  `hog.js` pins them on `globalThis`, and fills them with random bytes so nothing can compress them.
