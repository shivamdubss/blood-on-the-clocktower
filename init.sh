#!/bin/bash
# init.sh
# Starts the dev server and validates the app is in a working state.
# If any step fails, exits non-zero so the agent knows the repo is broken.

set -euo pipefail

# Ensure we're running from the repo root
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

PID_FILE=".dev-server.pid"
PORT=3000
MAX_WAIT=45

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
lsof -ti:$PORT 2>/dev/null | xargs kill -9 2>/dev/null || true

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

# 6. Run unit tests (--run flag prevents vitest from hanging in watch mode)
echo "Running unit tests..."
npm run test:unit -- --run
echo "Unit tests: PASSED"

echo ""
echo "=== init.sh: Environment OK ==="
echo "Dev server PID: $DEV_PID (port $PORT)"
