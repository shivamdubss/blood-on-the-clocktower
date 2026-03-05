#!/bin/bash
# check-milestone.sh
# Hook that checks if a milestone is complete after each session.
# Called automatically by the botc-runner.sh after each coding session.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

PROGRESS_FILE="$REPO_ROOT/docs/progress.md"
FEATURE_FILE="$REPO_ROOT/docs/feature_list.json"

if grep -q "MILESTONE COMPLETE" "$PROGRESS_FILE" 2>/dev/null; then
  echo "MILESTONE_COMPLETE=true"
else
  echo "MILESTONE_COMPLETE=false"
fi

REMAINING=$(python3 -c "
import json
try:
    data = json.load(open('$FEATURE_FILE'))
    print(len([f for f in data if not f.get('passes', False)]))
except Exception as e:
    print(-1)
" 2>/dev/null || echo "-1")

echo "FEATURES_REMAINING=$REMAINING"
