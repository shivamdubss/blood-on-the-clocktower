#!/bin/bash
# botc-runner.sh
# Runs Claude Code in a loop, one feature per session, until all features pass.
# Each session gets a fresh context window -- no context rot across sessions.
# All session output is captured to logs/ for post-run debugging.

set -euo pipefail

# Ensure we're running from the repo root
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

# Verify python3 is available (used for JSON parsing)
if ! command -v python3 &> /dev/null; then
  echo "ERROR: python3 is required but not found in PATH."
  exit 1
fi

# Verify claude CLI is available
if ! command -v claude &> /dev/null; then
  echo "ERROR: claude CLI is required but not found in PATH."
  exit 1
fi

LOG_DIR="logs"
mkdir -p "$LOG_DIR"

CODING_PROMPT='You are the CODING agent for this project. You make incremental progress, one feature at a time.

START every session by doing this exact sequence:
1. Run ./init.sh to start the dev server and verify the app is in a working state
2. Read docs/progress.md to see what was last worked on
3. Read docs/feature_list.json to find the highest-priority feature where passes = false
4. Read docs/plan.md to understand the current milestone and required validation
5. Read docs/implement.md for your operating rules

Then:
- Pick exactly ONE feature to work on (the next failing feature in milestone order)
- Implement it
- Write automated tests for every entry in the feature'"'"'s acceptance_criteria array
- Run the feature-specific validation commands from plan.md
- Then run the FULL test suite (npm run test:unit -- --run && npm run test:e2e) to catch regressions
- If any test fails, fix it before moving on -- do not skip
- Once all tests pass, flip passes to true in feature_list.json
- If the feature has a human_review array, note those items in progress.md for manual review
- Write a git commit with a descriptive message (e.g. "feat: implement Poisoner night ability")

END every session by doing this exact sequence:
1. Update docs/progress.md: milestone status, what you completed, decisions made, known issues
2. Confirm the feature is committed and the repo is in a clean state (no failing tests)
3. If all features in the current milestone now pass, write "MILESTONE COMPLETE" in progress.md
4. Print a short summary: what you did, what the next feature is, any blockers

Rules:
- Never mark a feature as passing without running the validation commands AND the full test suite
- Never expand scope mid-feature -- add new entries to feature_list.json instead
- Never remove or edit feature entries except to flip passes to true
- Fix any broken previous features before moving on
- All role abilities must use AbilityContext (isPoisoned, isDrunk)
- When implementing role abilities, run the FULL test suite after each one
- Vitest must be run with --run flag to prevent watch mode (e.g. npm run test:unit -- --run)'

check_features_remaining() {
  local result
  result=$(python3 -c "
import json, sys
try:
    with open('docs/feature_list.json') as f:
        features = json.load(f)
    remaining = [f for f in features if not f.get('passes', False)]
    print(len(remaining))
except Exception as e:
    print('ERROR: ' + str(e), file=sys.stderr)
    sys.exit(1)
" 2>/dev/null)
  if ! [[ "$result" =~ ^[0-9]+$ ]]; then
    echo "ERROR: Could not parse feature_list.json" >&2
    echo "-1"
    return 1
  fi
  echo "$result"
}

get_next_feature_id() {
  python3 -c "
import json
with open('docs/feature_list.json') as f:
    features = json.load(f)
pending = [f for f in features if not f.get('passes', False)]
if pending:
    print(pending[0]['id'])
else:
    print('NONE')
" 2>/dev/null || echo "UNKNOWN"
}

check_milestone_complete() {
  grep -q "MILESTONE COMPLETE" docs/progress.md 2>/dev/null
}

SESSION=0
MAX_SESSIONS=100         # safety ceiling -- prevents infinite loops
PAUSE_ON_MILESTONE=false # set to true if you want to review at each milestone
STUCK_FEATURE_ID=""
STUCK_COUNT=0
MAX_STUCK=3              # halt if same feature fails 3 sessions in a row
ERROR_COUNT=0
MAX_BACKOFF=300          # 5 minute cap on backoff

echo "=== BotC Runner Starting ==="
echo "Time: $(date)"
echo "Logs: $LOG_DIR/"
echo ""

while true; do
  REMAINING=$(check_features_remaining)

  if [ "$REMAINING" -eq -1 ]; then
    echo "ERROR: Could not read feature_list.json. Halting."
    break
  fi

  if [ "$REMAINING" -eq 0 ]; then
    echo ""
    echo "=== All features complete. Build finished. ==="
    echo "Time: $(date)"
    break
  fi

  SESSION=$((SESSION + 1))

  if [ "$SESSION" -gt "$MAX_SESSIONS" ]; then
    echo "Reached max session limit ($MAX_SESSIONS). Stopping."
    break
  fi

  # Stuck-feature detection
  NEXT_FEATURE=$(get_next_feature_id)
  if [ "$NEXT_FEATURE" = "$STUCK_FEATURE_ID" ]; then
    STUCK_COUNT=$((STUCK_COUNT + 1))
    if [ "$STUCK_COUNT" -ge "$MAX_STUCK" ]; then
      echo ""
      echo "ERROR: Feature $STUCK_FEATURE_ID has failed $MAX_STUCK consecutive sessions."
      echo "This likely requires human intervention. Check logs:"
      echo "  $LOG_DIR/session-$((SESSION - 1)).log"
      echo "  $LOG_DIR/session-$((SESSION - 2)).log"
      echo "Halting runner."
      break
    fi
    echo "WARNING: Feature $STUCK_FEATURE_ID stuck (attempt $((STUCK_COUNT + 1))/$MAX_STUCK)"
  else
    STUCK_FEATURE_ID="$NEXT_FEATURE"
    STUCK_COUNT=0
  fi

  echo ""
  echo "--- Session $SESSION | Feature: $NEXT_FEATURE | $REMAINING remaining | $(date) ---"

  # Check if previous session ended on a milestone boundary
  if [ "$PAUSE_ON_MILESTONE" = true ] && check_milestone_complete; then
    echo ""
    echo "MILESTONE COMPLETE -- review docs/progress.md and git log, then press Enter to continue."
    echo "(Set PAUSE_ON_MILESTONE=false in the script to skip this pause.)"
    # Clear the milestone flag so we don't pause again next loop
    # Use portable sed syntax (works on both macOS and Linux)
    sed -i.bak 's/MILESTONE COMPLETE/Milestone complete/' docs/progress.md && rm -f docs/progress.md.bak
    read -r
  fi

  # Run a fresh Claude Code session -- no --resume means fresh context every time
  # Capture all output to a session log file for post-run debugging
  claude -p "$CODING_PROMPT" \
    --dangerously-skip-permissions \
    --max-turns 50 \
    --output-format text \
    > "$LOG_DIR/session-$SESSION.log" 2>&1
  EXIT_CODE=$?

  # Print last 20 lines of log for visibility
  echo "--- Session $SESSION output (last 20 lines) ---"
  tail -20 "$LOG_DIR/session-$SESSION.log"
  echo "--- End session $SESSION ---"

  if [ $EXIT_CODE -ne 0 ]; then
    ERROR_COUNT=$((ERROR_COUNT + 1))
    BACKOFF=$(( 30 * (2 ** (ERROR_COUNT - 1)) ))
    if [ $BACKOFF -gt $MAX_BACKOFF ]; then
      BACKOFF=$MAX_BACKOFF
    fi
    echo "Session $SESSION exited with error code $EXIT_CODE."
    echo "Waiting ${BACKOFF}s before retrying (error streak: $ERROR_COUNT)..."
    sleep $BACKOFF
  else
    ERROR_COUNT=0  # reset on success
  fi

  # Checkpoint commit after every session regardless of what the agent committed
  git add -A && git commit -m "chore: session $SESSION checkpoint [runner]" 2>/dev/null || true

  sleep 5  # brief pause between sessions to avoid rate limit spikes
done
