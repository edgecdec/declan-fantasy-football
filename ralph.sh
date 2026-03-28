#!/bin/bash
# Ralph-style autonomous development loop for Declanalytics (Fantasy Football)
# Usage: ./ralph.sh [max_iterations]

set -e
cd "$(dirname "$0")" || exit 1

MAX=${1:-0}
COUNT=0
LOG_DIR="/tmp/ralph-fantasy-logs"
mkdir -p "$LOG_DIR"

echo "🏈 Ralph is starting for Declanalytics (max iterations: ${MAX:-unlimited})"
echo ""

while true; do
  COUNT=$((COUNT + 1))
  TIMESTAMP=$(date '+%Y%m%d-%H%M%S')
  LOG_FILE="$LOG_DIR/ralph-${COUNT}-${TIMESTAMP}.log"

  OPEN=$(grep -c '"status": "open"' .ralph/prd.json 2>/dev/null || true)
  [ -z "$OPEN" ] && OPEN=0
  IN_PROGRESS=$(grep -c '"status": "in_progress"' .ralph/prd.json 2>/dev/null || true)
  [ -z "$IN_PROGRESS" ] && IN_PROGRESS=0
  DONE=$(grep -c '"status": "done"' .ralph/prd.json 2>/dev/null || true)
  [ -z "$DONE" ] && DONE=0
  BLOCKED=$(grep -c '"status": "blocked"' .ralph/prd.json 2>/dev/null || true)
  [ -z "$BLOCKED" ] && BLOCKED=0

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "🔄 Iteration $COUNT — $(date '+%H:%M:%S')"
  echo "   📋 $OPEN open | 🔨 $IN_PROGRESS in progress | ✅ $DONE done | 🚫 $BLOCKED blocked"

  if [ "$OPEN" -eq 0 ] && [ "$IN_PROGRESS" -eq 0 ]; then
    echo "✅ All tasks complete!"
    break
  fi

  NEXT=$(python3 -c "
import json
tasks = json.load(open('.ralph/prd.json'))['tasks']
for t in tasks:
    if t['status'] in ('open', 'in_progress'):
        print(f\"{t['id']}: {t['title']}\")
        break
" 2>/dev/null || echo "unknown")
  echo "   Next: $NEXT"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  kiro-cli chat \
    --agent fantasyfootball \
    --no-interactive \
    --trust-all-tools \
    "$(cat .ralph/PROMPT.md)" \
    2>&1 | tee "$LOG_FILE"

  echo "   ✓ Iteration $COUNT done (log: $LOG_FILE)"

  if [ "$MAX" -gt 0 ] && [ "$COUNT" -ge "$MAX" ]; then
    echo "🛑 Max iterations ($MAX) reached"
    break
  fi

  sleep 5
done

echo "🏈 Ralph finished after $COUNT iterations"
