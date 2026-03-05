# Building Blood on the Clocktower with Long-Running AI Agents

A practical guide to delegating a complex, multi-session coding project to Claude Code using the initializer + coding agent pattern, including full unattended automation.

-----

## The Core Pattern

The strategy combines lessons from Anthropic's two-agent harness and OpenAI's durable markdown approach:

- **Four persistent files** act as the agent's external brain
- **A two-session structure** separates initialization from execution
- **A bash loop** handles unattended multi-session runs

Every session reads the files to get up to speed. Every session writes to the files when it ends. The session itself is disposable. The files are the memory.

```
your-repo/
├── docs/
│   ├── PRD.md              # Your full product requirements
│   ├── feature_list.json   # All features, each with passes: false
│   ├── plan.md             # Milestones with acceptance criteria
│   ├── implement.md        # The agent's runbook (how to operate)
│   └── progress.md         # Audit log: decisions, status, known issues
├── init.sh                 # Starts dev server + runs smoke test
├── CLAUDE.md               # Auto-loaded by Claude Code every session
├── .claude/
│   └── hooks/
│       ├── inject-context.sh   # Re-injects context after /clear
│       └── check-milestone.sh  # Notifies you when a milestone is done
├── logs/                   # Session logs for post-run debugging
├── botc-runner.sh          # Unattended loop script
└── src/
```

-----

## Step 1: Write Your PRD

Before touching Claude Code, write `docs/PRD.md` yourself. This is the frozen spec, the agent's definition of done. Be explicit and unambiguous. The more precisely you define each role's ability upfront, the fewer corrections you will need mid-run.

The BotC PRD is a separate document (`docs/PRD.md`). It covers the full tech stack, all 14 Trouble Brewing roles with detailed ability descriptions, hard architectural constraints (single state machine, Poison/Drunk layer, night order as data, Storyteller override, reversibility, role file structure), game phases, win condition priority, the Grimoire spec, and known interaction edge cases (Drunk + detection abilities, Poisoner timing, Recluse + Investigator, Scarlet Woman timing, Virgin + Townsfolk nominator, Mayor kill redirect, Imp star-pass, Butler vote edge case, Empath with dead neighbors, Fortune Teller red herring).

Your PRD should aim for the same level of specificity. The key sections are:

- **Role distribution table** for every player count (5-15)
- **Each role's ability** written as unambiguous behavioral spec, including poisoned/drunk behavior
- **Hard architectural constraints** established early so the agent never violates them
- **Known edge cases** called out explicitly so the agent handles them by design, not by accident
- **A "Done When" checklist** that serves as the final acceptance gate

-----

## Step 2: The Initializer Session

This is a one-time session. Its only job is to set up the environment every future session depends on. Do not start coding features here.

### What to paste into Claude Code (Session 1)

```
You are the INITIALIZER agent for a long-running coding project.

Your job is NOT to build features. Your job is to set up the environment so that
future coding sessions can work independently and incrementally.

Read docs/PRD.md carefully — including every section. Then do the following in order:

1. Create docs/feature_list.json
   - Extract every discrete feature from the PRD as a separate entry
   - Each entry must have: id, category, description, acceptance_criteria (array),
     automated_tests (array of test commands/descriptions), passes (false)
   - Every acceptance criterion MUST have a corresponding automated test.
     If a criterion cannot be tested automatically, split it into a separate
     "human_review" array on the feature entry so the agent never pretends
     to verify something it cannot.
   - Use JSON. Do not use Markdown for this file. Do not omit any features.
   - It is unacceptable to remove or edit entries later except to flip passes to true.

2. Create docs/plan.md
   - Group features into milestones of 3-5 features each
   - Each milestone must have: a name, the feature IDs it covers, validation commands
   - Order milestones by dependency (lobby before night phase, etc.)
   - Milestone 3 MUST include ARCH-01 (ability execution context with isPoisoned/isDrunk)
     as the first feature, before any role ability features begin.

3. Create docs/implement.md
   - Write the agent runbook. Future agents will read this to know how to operate.
   - Must include: how to start the dev server, how to run tests, the rule that validation
     must pass before moving on, and that docs/progress.md must be updated at session end.
   - Must include: when implementing any role ability, always run the full test suite
     (not just the feature-specific tests) because abilities touch the state machine,
     WebSocket handlers, and night order system across multiple files.

4. Create docs/progress.md
   - Initialize with: current milestone (Milestone 1), features completed (none),
     last known working state, and a section for decisions and known issues.

5. Create init.sh
   - Must perform ALL of the following in order:
     a. Kill any existing dev server process (check for PID file or kill by port)
     b. Run npm install (in case dependencies changed)
     c. Run TypeScript compilation (npx tsc --noEmit)
     d. Start the dev server in the background, write PID to .dev-server.pid
     e. Wait for the server to be ready (health check loop against localhost)
     f. Run the unit test suite (npm run test:unit)
     g. If any step fails, print a clear error and exit non-zero
   - This script is the circuit breaker for unattended mode. If it does not catch
     a broken state, the agent builds on a broken foundation for the entire session.

6. Create CLAUDE.md
   - Short file (under 200 lines): tech stack, how to run the app, where key files live,
     coding conventions, and a pointer to docs/implement.md.

7. Create the logs/ directory for session log capture.

8. Set up the repo: npm init, install dependencies, create the base file structure,
   make an initial git commit with message "chore: initializer setup".

When done, print a summary of what was created and confirm the feature count.
```

### What you get after Session 1

A repo with no features, but every feature catalogued, every milestone sequenced, and a runbook any future session can follow cold.

-----

## Step 3: The Coding Agent Prompt

Every subsequent session, whether run manually or by the automation loop, uses this same prompt.

```
You are the CODING agent for this project. You make incremental progress, one feature at a time.

START every session by doing this exact sequence:
1. Run ./init.sh to start the dev server and verify the app is in a working state
2. Read docs/progress.md to see what was last worked on
3. Read docs/feature_list.json to find the highest-priority feature where passes = false
4. Read docs/plan.md to understand the current milestone and required validation
5. Read docs/implement.md for your operating rules

Then:
- Pick exactly ONE feature to work on (the next failing feature in milestone order)
- Implement it
- Write automated tests for every entry in the feature's acceptance_criteria array
- Run the feature-specific validation commands from plan.md
- Then run the FULL test suite (npm run test:unit && npm run test:e2e) to catch regressions
- If any test fails, fix it before moving on — do not skip
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
- Never expand scope mid-feature — if you discover new work, add it as a new entry
- Never remove or edit feature entries except to flip passes to true
- If you find a bug in a previous feature, fix it and note it in progress.md before moving on
- When implementing role abilities, always use the ability execution context pattern
  (context.isPoisoned, context.isDrunk) — never check corruption state on the role directly
```

-----

## Step 4: The feature_list.json for BotC

Go to this level of granularity for every feature. Each role gets its own entry with specific, testable acceptance criteria. Every criterion must have a corresponding automated test. Anything that can only be verified by a human goes in the `human_review` array so the agent never pretends to verify something it cannot.

```json
[
  {
    "id": "LOBBY-01",
    "category": "lobby",
    "description": "Host can create a game and receive a 6-character join code",
    "acceptance_criteria": [
      "POST /api/game returns a game ID and join code",
      "Join code is unique per game",
      "Game appears in active games list"
    ],
    "automated_tests": [
      "test:unit -- --grep 'game creation'",
      "test:e2e -- --grep 'create game'"
    ],
    "human_review": [],
    "passes": false
  },
  {
    "id": "LOBBY-02",
    "category": "lobby",
    "description": "Players can join a game using the join code",
    "acceptance_criteria": [
      "Player enters join code and sees the lobby",
      "Host sees new player appear in real time via WebSocket",
      "Duplicate names are rejected with appropriate error"
    ],
    "automated_tests": [
      "test:unit -- --grep 'join game'",
      "test:e2e -- --grep 'join lobby'"
    ],
    "human_review": [],
    "passes": false
  },
  {
    "id": "ROLE-01",
    "category": "roles",
    "description": "Storyteller can assign roles from the Trouble Brewing script",
    "acceptance_criteria": [
      "All 14 Trouble Brewing roles are available in the assignment UI",
      "Role count matches player count per official distribution table",
      "Each player receives exactly one role"
    ],
    "automated_tests": [
      "test:unit -- --grep 'role assignment'",
      "test:e2e -- --grep 'assign roles'"
    ],
    "human_review": [
      "Verify role assignment UI is intuitive for a Storyteller"
    ],
    "passes": false
  },
  {
    "id": "ARCH-01",
    "category": "architecture",
    "description": "Ability execution context with isPoisoned and isDrunk flags",
    "acceptance_criteria": [
      "AbilityContext type includes isPoisoned and isDrunk boolean fields",
      "All ability resolution functions receive AbilityContext as a parameter",
      "A poisoned ability returns false/null information instead of true information",
      "A drunk ability behaves identically to a poisoned ability",
      "Context flags are set by the state machine based on active Poisoner/Drunk effects"
    ],
    "automated_tests": [
      "test:unit -- --grep 'ability context'",
      "test:unit -- --grep 'poisoned ability'",
      "test:unit -- --grep 'drunk ability'"
    ],
    "human_review": [],
    "passes": false
  },
  {
    "id": "NIGHT-01",
    "category": "night-phase",
    "description": "Night order queue fires in correct official BotC order",
    "acceptance_criteria": [
      "Night order matches the official Trouble Brewing order sheet",
      "Storyteller sees each role prompt in sequence",
      "Queue does not advance until Storyteller confirms each step"
    ],
    "automated_tests": [
      "test:unit -- --grep 'night order'",
      "test:e2e -- --grep 'night phase'"
    ],
    "human_review": [],
    "passes": false
  },
  {
    "id": "ABILITY-IMP-01",
    "category": "role-abilities",
    "description": "The Imp kills one player per night and can star-pass",
    "acceptance_criteria": [
      "Imp selects a target each night via AbilityContext",
      "Target is marked dead at dawn",
      "If Imp kills themselves, a Minion becomes the new Imp",
      "Star-pass is reflected in role assignment state",
      "If Imp is poisoned, the kill does not resolve"
    ],
    "automated_tests": [
      "test:unit -- --grep 'Imp'",
      "test:unit -- --grep 'star-pass'",
      "test:unit -- --grep 'poisoned Imp'"
    ],
    "human_review": [],
    "passes": false
  }
]
```

The same pattern applies to every Trouble Brewing role. The Washerwoman, Librarian, Investigator, Chef, Empath, Fortune Teller, Undertaker, Monk, Ravenkeeper, Virgin, Slayer, Soldier, Mayor, Butler, Drunk, Recluse, Saint, Poisoner, Spy, Scarlet Woman, Baron, and Imp each get their own entry with specific, testable criteria and explicit automated test commands.

-----

## Step 5: The Milestones in plan.md

Structure milestones so each one is completable in 1-3 Claude Code sessions. Note that ARCH-01 (the ability execution context) is placed as the first feature in Milestone 3, before any role abilities are implemented. This prevents a costly refactor later.

```markdown
# BotC — Milestone Plan

## Milestone 1: Foundation
Features: LOBBY-01, LOBBY-02, LOBBY-03, ROLE-01, ROLE-02
Validation:
  - npm run test:unit
  - npm run test:e2e -- --grep "lobby"

## Milestone 2: Day Phase
Features: DAY-01 through DAY-05 (nominations, voting, execution, skip)
Validation:
  - npm run test:unit
  - npm run test:e2e -- --grep "day-phase"

## Milestone 3: Night Phase Infrastructure + Ability Context
Features: ARCH-01, NIGHT-01, NIGHT-02, NIGHT-03
Note: ARCH-01 (ability execution context with isPoisoned/isDrunk) MUST be implemented
first. All subsequent role ability features depend on this pattern. Do not proceed to
Milestone 4 without ARCH-01 passing.
Validation:
  - npm run test:unit -- --grep "night|ability context"
  - npm run test:e2e -- --grep "night"

## Milestone 4: Townsfolk Abilities
Features: ABILITY-WASHERWOMAN through ABILITY-MAYOR (one entry per role)
Note: Every ability must use AbilityContext and check isPoisoned/isDrunk.
Run the full test suite after each ability, not just the role-specific tests.
Validation:
  - npm run test:unit
  - npm run test:e2e

## Milestone 5: Outsider + Minion + Demon Abilities
Features: ABILITY-BUTLER, ABILITY-DRUNK, ABILITY-RECLUSE, ABILITY-SAINT,
          ABILITY-POISONER, ABILITY-SPY, ABILITY-SCARLET-WOMAN, ABILITY-BARON,
          ABILITY-IMP
Note: The Drunk and Poisoner are the most complex. Implement Poisoner first
(it exercises the isPoisoned context flag), then Drunk (isDrunk flag).
Validation:
  - npm run test:unit
  - npm run test:e2e
  - Full Trouble Brewing scenario test passes

## Milestone 6: Storyteller Dashboard + Polish
Features: ST-01 through ST-05, REPLAY-01, ENDGAME-01
Validation:
  - Full e2e game completes with no console errors
  - Storyteller can override any action
  - Replay log shows all events in order
  - npm run test:unit && npm run test:e2e (full suite, zero failures)
```

-----

## Step 6: init.sh

This is the most critical file for unattended operation. It is the circuit breaker. If init.sh does not catch a broken state, the agent builds on a broken foundation for the entire session.

```bash
#!/bin/bash
# init.sh
# Starts the dev server and validates the app is in a working state.
# If any step fails, exits non-zero so the agent knows the repo is broken.

set -euo pipefail

PID_FILE=".dev-server.pid"
PORT=3000
MAX_WAIT=30

echo "=== init.sh: Starting environment check ==="

# 1. Kill any existing dev server to prevent zombie processes
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "Killing existing dev server (PID $OLD_PID)..."
    kill "$OLD_PID" 2>/dev/null || true
    sleep 2
    # Force kill if still running
    kill -9 "$OLD_PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
fi

# Also kill anything on the target port as a fallback
lsof -ti:$PORT | xargs kill -9 2>/dev/null || true

# 2. Install dependencies (in case they changed between sessions)
echo "Installing dependencies..."
npm install --silent

# 3. TypeScript compilation check
echo "Running TypeScript compilation check..."
npx tsc --noEmit
echo "TypeScript: OK"

# 4. Start dev server in background
echo "Starting dev server on port $PORT..."
npm run dev &
DEV_PID=$!
echo "$DEV_PID" > "$PID_FILE"

# 5. Wait for server to be ready (health check loop)
echo "Waiting for server to be ready..."
WAITED=0
until curl -sf http://localhost:$PORT/health > /dev/null 2>&1; do
  if [ $WAITED -ge $MAX_WAIT ]; then
    echo "ERROR: Dev server did not start within ${MAX_WAIT}s"
    kill "$DEV_PID" 2>/dev/null || true
    rm -f "$PID_FILE"
    exit 1
  fi
  sleep 1
  WAITED=$((WAITED + 1))
done
echo "Dev server ready (took ${WAITED}s)"

# 6. Run unit tests
echo "Running unit tests..."
npm run test:unit
echo "Unit tests: PASSED"

echo ""
echo "=== init.sh: Environment OK ==="
echo "Dev server PID: $DEV_PID (port $PORT)"
```

-----

## Step 7: CLAUDE.md

Auto-loaded by Claude Code at the start of every session. Keep it short; it is the orientation layer, not the runbook.

```markdown
# Blood on the Clocktower — Claude Context

## What This Is
A digital implementation of the BotC social deduction game.

## Stack
- Frontend: React + TypeScript (src/client/)
- Backend: Node.js + WebSockets (src/server/)
- Tests: Vitest (unit), Playwright (e2e)

## Key Files
- docs/PRD.md — Full product spec. Source of truth.
- docs/feature_list.json — All features. Only edit the passes field.
- docs/plan.md — Milestones and validation commands.
- docs/implement.md — Your operating instructions. Read before working.
- docs/progress.md — Session log. Update at the end of every session.

## How to Run
- Dev server: ./init.sh
- Unit tests: npm run test:unit
- E2e tests: npm run test:e2e
- Full validation: npm run test:unit && npm run test:e2e
- Lint: npm run lint
- Typecheck: npm run typecheck

## Coding Conventions
- All game state mutations go through src/server/gameStateMachine.ts
- Night order is defined in src/data/nightOrder.ts — do not hardcode elsewhere
- Role abilities are registered in src/roles/ — one file per role
- All abilities MUST use AbilityContext (isPoisoned, isDrunk) — never check
  corruption state on the role object directly
- Never commit with failing tests
- When implementing role abilities, run the FULL test suite (not just role-specific tests)
  because abilities touch the state machine, WebSocket handlers, and night order system
```

-----

## Step 9: Running Unattended (8-Hour Mode)

This is the fully automated version. A bash loop spins up a fresh Claude Code process for each feature, no human needed between sessions.

### How it works

Because each `claude -p` call is a new process with no `--resume` flag, every iteration gets a clean context window. This is the programmatic equivalent of `/clear`. The agent reads `feature_list.json` at the start of each session to know what is left, and the loop terminates when nothing remains with `passes: false`.

### Cost estimation

Before running overnight, estimate your token budget. A rough baseline: each session may use 50,000-150,000 tokens depending on feature complexity and how many turns the agent needs. With 30-50 features and potential retries, a full BotC build could consume 3-10 million tokens across all sessions. Check your current API plan limits and pricing before starting an unattended run to avoid surprises.

### The script

Save this as `botc-runner.sh` in your repo root.

```bash
#!/bin/bash
# botc-runner.sh
# Runs Claude Code in a loop, one feature per session, until all features pass.
# Each session gets a fresh context window — no context rot across sessions.
# All session output is captured to logs/ for post-run debugging.

set -euo pipefail

LOG_DIR="logs"
mkdir -p "$LOG_DIR"

CODING_PROMPT='You are the CODING agent for this project. You make incremental progress, one feature at a time.

START every session by doing this exact sequence:
1. Run ./init.sh to start the dev server and verify the app is in a working state
2. Read docs/progress.md to see what was last worked on
3. Read docs/feature_list.json to find the highest-priority feature where passes = false
4. Read docs/plan.md to understand the current milestone and required validation
5. Read docs/implement.md for your operating rules

Then implement exactly ONE feature. Write automated tests for every acceptance criterion. Run the feature-specific validation AND the full test suite. Flip passes to true only after all tests pass. Commit and update docs/progress.md.

If all features in the current milestone now pass, write "MILESTONE COMPLETE" in docs/progress.md and stop.

Rules:
- Never mark a feature passing without running validation commands AND the full test suite
- Never expand scope mid-feature — add new entries to feature_list.json instead
- Never remove or edit feature entries except to flip passes to true
- Fix any broken previous features before moving on
- All role abilities must use AbilityContext (isPoisoned, isDrunk)'

check_features_remaining() {
  python3 -c "
import json, sys
try:
    with open('docs/feature_list.json') as f:
        features = json.load(f)
    remaining = [f for f in features if not f.get('passes', False)]
    print(len(remaining))
except Exception as e:
    print('ERROR: ' + str(e), file=sys.stderr)
    sys.exit(1)
"
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
"
}

check_milestone_complete() {
  grep -q "MILESTONE COMPLETE" docs/progress.md 2>/dev/null
}

SESSION=0
MAX_SESSIONS=100         # safety ceiling — prevents infinite loops
PAUSE_ON_MILESTONE=true  # set to false for fully dark operation
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
    echo "MILESTONE COMPLETE — review docs/progress.md and git log, then press Enter to continue."
    echo "(Set PAUSE_ON_MILESTONE=false in the script to skip this pause.)"
    # Clear the milestone flag so we don't pause again next loop
    sed -i 's/MILESTONE COMPLETE/Milestone complete/' docs/progress.md
    read -r
  fi

  # Run a fresh Claude Code session — no --resume means fresh context every time
  # Capture all output to a session log file for post-run debugging
  claude -p "$CODING_PROMPT" \
    --dangerously-skip-permissions \
    --max-turns 50 \
    --output-format text \
    2>&1 | tee "$LOG_DIR/session-$SESSION.log"
  EXIT_CODE=${PIPESTATUS[0]}

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
```

### Running it

```bash
chmod +x botc-runner.sh
./botc-runner.sh
```

Leave it running. It will work through features one at a time, committing after each, pausing at milestone boundaries for your review, and stopping cleanly when `feature_list.json` has no remaining `passes: false` entries. If a feature gets stuck for 3 consecutive sessions, the runner halts and points you to the relevant logs.

### Key flags explained

| Flag | Purpose |
|---|---|
| `--dangerously-skip-permissions` | Required for unattended mode. Skips approval prompts on every file write and bash command. Only use on codebases you trust the agent with. |
| `--max-turns 50` | Stops a single session if it gets stuck in a loop. The outer loop retries on the same feature with a fresh context. |
| No `--resume` flag | The key to fresh context. Each `claude -p` call starts a new session with no memory of previous ones. The files carry state instead. |
| `PAUSE_ON_MILESTONE=true` | Pauses the loop at milestone boundaries so you can review before the next milestone starts. Set to `false` for fully dark 8-hour operation. |
| `MAX_STUCK=3` | Halts the runner if the same feature fails 3 consecutive sessions. Prevents burning tokens on a feature that needs human help. |
| `tee logs/session-$SESSION.log` | Captures all session output for debugging what happened at 3am. |

### Fully dark mode (no pauses)

Change `PAUSE_ON_MILESTONE=true` to `PAUSE_ON_MILESTONE=false` in the script. The loop runs through all milestones without stopping. Useful if you want to kick it off before bed and review in the morning. The stuck-feature detector and max-session ceiling still protect against runaway execution.

-----

## Step 10: Hooks for Context Injection (Optional but Recommended)

Even in unattended mode, hooks ensure the agent never starts a session without current context, especially after compaction events within a single session.

> **Note:** Verify the hooks configuration format against Claude Code's current documentation before using. The hook schema may have changed since this guide was written. The important thing is that the two scripts below run at the right times: `inject-context.sh` at session start, and `check-milestone.sh` at session end.

### .claude/hooks/inject-context.sh

Injects the current state of progress and the next pending feature as context at the start of every fresh session.

```bash
#!/bin/bash
# Runs at session start — injects current project state as context

PROGRESS=$(cat docs/progress.md 2>/dev/null || echo "No progress file found")
NEXT_FEATURE=$(python3 -c "
import json
with open('docs/feature_list.json') as f:
    features = json.load(f)
pending = [f for f in features if not f.get('passes', False)]
if pending:
    import json as j
    print(j.dumps(pending[0], indent=2))
else:
    print('All features complete')
" 2>/dev/null || echo "Could not read feature list")

echo "=== SESSION CONTEXT ==="
echo ""
echo "--- Current Progress ---"
echo "$PROGRESS"
echo ""
echo "--- Next Feature ---"
echo "$NEXT_FEATURE"
echo ""
echo "Read docs/implement.md for your operating rules before starting."
```

### .claude/hooks/check-milestone.sh

Prints a notification when the current milestone is complete, so you notice it in the terminal output even in automated runs.

```bash
#!/bin/bash
# Runs when the agent stops — checks if a milestone was just completed

REMAINING=$(python3 -c "
import json
with open('docs/feature_list.json') as f:
    features = json.load(f)
print(len([f for f in features if not f.get('passes', False)]))
" 2>/dev/null || echo "?")

if grep -q "MILESTONE COMPLETE" docs/progress.md 2>/dev/null; then
  echo ""
  echo "========================================="
  echo "  MILESTONE COMPLETE"
  echo "  Features remaining: $REMAINING"
  echo "  Review docs/progress.md before continuing"
  echo "========================================="
fi
```

Make both scripts executable:

```bash
chmod +x .claude/hooks/inject-context.sh
chmod +x .claude/hooks/check-milestone.sh
```

-----

## What Can Go Wrong (and How to Prevent It)

| Failure Mode | Prevention |
|---|---|
| Agent declares victory early | `feature_list.json` with explicit `passes: false`. Must flip each one individually after running tests. |
| Agent expands scope mid-feature | `implement.md` rule: add new entries instead of expanding. |
| Agent breaks a previous feature | `init.sh` runs full TypeScript check + unit tests at session start. Catches regressions immediately. |
| Context rot within a session | `--max-turns 50` limits damage; fresh session starts clean. |
| Architecture goes wrong in Milestone 1 | Review manually before the Milestone 2 loop starts. |
| Agent marks feature passing without testing | `implement.md` rule: run validation commands AND full test suite before flipping `passes`. |
| Loop runs forever on a stuck feature | `MAX_STUCK=3` detector halts the runner and points to session logs. |
| Rate limit or API errors | Exponential backoff (30s, 60s, 120s... capped at 5min) on non-zero exit codes. |
| Cannot debug overnight failures | All session output captured to `logs/session-N.log` via `tee`. |
| Agent pretends to verify manual-only criteria | `human_review` array separates machine-verifiable from human-verifiable criteria. |
| Zombie dev server processes accumulate | `init.sh` kills existing server by PID file and port before starting a new one. |
| Costly refactor when Poisoner/Drunk is added late | ARCH-01 placed as first feature in Milestone 3, before any role abilities. |
| Role abilities touch many files, partial test runs miss regressions | `implement.md` and coding prompt require full test suite run for every role ability, not just role-specific tests. |
| Uncontrolled token spend on long overnight run | Cost estimation section helps you budget before starting. Stuck-feature detector prevents burning tokens on hopeless retries. |
