#!/bin/bash
# inject-context.sh
# Hook that injects project context into Claude sessions.
# Called automatically by Claude Code via .claude/settings.json hooks configuration.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Print key project context for the agent
echo "=== BotC Project Context ==="
echo "Repo: $REPO_ROOT"
echo "Current milestone: $(grep 'Current Milestone' "$REPO_ROOT/docs/progress.md" | head -1 || echo 'unknown')"
echo "Features remaining: $(python3 -c "import json; data=json.load(open('$REPO_ROOT/docs/feature_list.json')); print(len([f for f in data if not f.get('passes', False)]))" 2>/dev/null || echo 'unknown')"
echo "==========================="
