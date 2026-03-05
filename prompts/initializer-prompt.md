# Initializer Prompt

Paste this into Claude Code as your first session. It sets up the repo but does NOT build features.

---

```
You are the INITIALIZER agent for a long-running coding project.

Your job is NOT to build features. Your job is to set up the development environment
so that future coding sessions can work independently and incrementally.

The following files already exist and must NOT be overwritten or modified:
- docs/PRD.md (product requirements -- source of truth)
- docs/feature_list.json (all features catalogued with acceptance criteria)
- docs/plan.md (milestones with validation commands)
- docs/implement.md (agent operating runbook)
- docs/progress.md (session log, initialized)
- init.sh (dev server startup and health check script)
- CLAUDE.md (auto-loaded context file)
- botc-runner.sh (unattended loop script)
- .claude/hooks/inject-context.sh
- .claude/hooks/check-milestone.sh
- .claude/settings.json (hook configuration)

Read docs/PRD.md carefully, then do the following in order:

1. Initialize the project:
   - Run: npm init -y
   - Install dependencies:
     npm install express socket.io react react-dom zustand better-sqlite3
     npm install -D typescript @types/node @types/react @types/react-dom
     npm install -D vite @vitejs/plugin-react vitest playwright @playwright/test
     npm install -D tailwindcss postcss autoprefixer eslint
     npm install -D socket.io-client @types/better-sqlite3 @types/express tsx
   - Create tsconfig.json with strict mode, paths for src/client and src/server
   - Create vite.config.ts for the React frontend
   - Create tailwind.config.js and postcss.config.js

2. Add npm scripts to package.json with THESE EXACT COMMANDS:
   - "dev": "tsx src/server/index.ts"
   - "dev:client": "vite"
   - "build": "tsc && vite build"
   - "test:unit": "vitest --run"
   - "test:e2e": "playwright test"
   - "lint": "eslint src/"
   - "typecheck": "tsc --noEmit"

   CRITICAL: The test:unit script MUST use "vitest --run" (not just "vitest").
   Without --run, vitest runs in watch mode and hangs forever, which will break
   all automated sessions. Double-check this is correct before moving on.

3. Create the base file structure (empty files with type stubs where needed):
   src/
     server/
       index.ts              -- Express + Socket.io server entry point with /health endpoint
                                The /health endpoint must return HTTP 200 with { status: "ok" }
       gameStateMachine.ts   -- State machine skeleton (GameState type, transition functions)
       socketHandlers.ts     -- WebSocket event handler registration
     client/
       index.tsx             -- React entry point
       App.tsx               -- Main app component
       store.ts              -- Zustand store skeleton
       components/           -- (empty directory, add .gitkeep)
     data/
       nightOrder.ts         -- Night 1 and Night 2+ order arrays (from PRD section 6.4)
       roles.ts              -- Role metadata (all 14 roles: name, team, type, ability description)
       distribution.ts       -- Role distribution table (from PRD section 5.1)
     roles/                  -- One file per role (22 files, each exporting metadata + ability handler stub)
       washerwoman.ts
       librarian.ts
       investigator.ts
       chef.ts
       empath.ts
       fortuneTeller.ts
       undertaker.ts
       monk.ts
       ravenkeeper.ts
       virgin.ts
       slayer.ts
       soldier.ts
       mayor.ts
       butler.ts
       drunk.ts
       recluse.ts
       saint.ts
       poisoner.ts
       spy.ts
       scarletWoman.ts
       baron.ts
       imp.ts
     types/
       game.ts               -- Core game types (GameState, Player, Role, Team, Phase, etc.)
       ability.ts            -- AbilityContext type with isPoisoned and isDrunk fields
   public/
     index.html              -- HTML entry point for Vite

4. Create a minimal test setup:
   - tests/unit/ directory with a sample test that imports from src/ and passes
   - tests/e2e/ directory with a sample Playwright test that hits /health and passes
   - vitest.config.ts -- configure with:
     - test.globals: true
     - test.environment: 'node'
     - DO NOT enable watch mode -- the "vitest --run" in package.json handles this
   - playwright.config.ts -- configure with:
     - baseURL: http://localhost:3000
     - webServer config that starts the dev server before tests

5. Verify everything works (run each of these in order):
   a. npx tsc --noEmit (should pass with no errors)
   b. npm run test:unit (should run vitest with --run flag, execute the sample test, and EXIT cleanly)
      -- If vitest hangs or enters watch mode, STOP and fix the test:unit script to use --run
   c. Start the dev server manually: npm run dev &
   d. Wait for it, then: curl http://localhost:3000/health (should return 200)
   e. npm run test:e2e (sample Playwright test should pass)
   f. Kill the dev server

6. Make the shell scripts executable:
   - chmod +x init.sh
   - chmod +x botc-runner.sh
   - chmod +x .claude/hooks/inject-context.sh
   - chmod +x .claude/hooks/check-milestone.sh

7. Create .gitignore:
   node_modules/
   dist/
   .dev-server.pid
   logs/*.log
   *.sqlite
   *.bak

8. Make an initial git commit:
   git init
   git add -A
   git commit -m "chore: initializer setup -- repo scaffolding, no features"

9. Run ./init.sh as a final integration check. It should:
   - Kill any existing dev server
   - Install deps
   - Pass typecheck
   - Start the dev server
   - Pass the health check
   - Run unit tests (with --run, no watch mode) and pass
   - Print "Environment OK"

   If init.sh fails at any step, debug and fix the issue before finishing.

When done, print a summary:
- List all files created
- Confirm the feature count from docs/feature_list.json (should be 52)
- Confirm TypeScript compiles clean
- Confirm unit and e2e tests pass (and that vitest exited cleanly, not in watch mode)
- Confirm the dev server starts and /health returns 200
- Confirm init.sh passes end-to-end
```
