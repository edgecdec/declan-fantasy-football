#!/bin/bash
# usage (inside the VM, as root, from anywhere): measure.sh <label> <memmax|infinity> <swapmax|infinity> [cmd...]
# Runs a build in a transient scope; reports the cgroup's peak (incl. page cache), the peak of
# anon+swap (the build's real demand, sampled every 100ms), the largest single process, and OOM kills.
label=$1; mm=$2; sm=$3; shift 3
cd /var/www/FantasyFootball || exit 1
rm -rf .next.new
[ $# -gt 0 ] || set -- ./node_modules/.bin/next build
start=$(date +%s)
systemd-run --scope --quiet --collect --unit="measure-$label-$$" -p MemoryMax=$mm -p MemorySwapMax=$sm -p OOMPolicy=continue \
  /bin/bash -c '
    cg=/sys/fs/cgroup$(sed -n "s/^0:://p" /proc/self/cgroup)
    ( max=0; while :; do a=$(awk "/^anon /{print \$2}" $cg/memory.stat); s=$(cat $cg/memory.swap.current); t=$((a+s)); [ $t -gt $max ] && max=$t && echo $max > /tmp/anonpeak; sleep 0.1; done ) &
    sp=$!
    rc=0; /usr/bin/time -f "maxrss_mb=%M" "$@" > /tmp/measure.out 2>&1 || rc=$?
    kill $sp 2>/dev/null
    echo "rc=$rc $(tail -1 /tmp/measure.out | sed "s/kb//") anon+swap_peak_mb=$(( $(cat /tmp/anonpeak)/1048576 )) cg_peak_mb=$(( $(cat $cg/memory.peak)/1048576 )) swap_peak_mb=$(( $(cat $cg/memory.swap.peak)/1048576 )) $(grep -E "^oom_kill " $cg/memory.events)"
  ' _ "$@" | tr '\n' ' '
echo "[$label mem=$mm swap=$sm wall=$(( $(date +%s)-start ))s]"
git checkout -q -- tsconfig.json next.config.ts 2>/dev/null || true
