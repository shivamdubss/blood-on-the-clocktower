# Blood on the Clocktower -- Claude Context

## What This Is
A digital implementation of the Blood on the Clocktower social deduction game, covering the full Trouble Brewing script (14 roles) playable in a browser in real time across multiple devices. A human Storyteller acts as game master.

## Stack
- Frontend: React + TypeScript (src/client/)
- Backend: Node.js + TypeScript + Socket.io (src/server/)
- State: Single authoritative server-side state machine (src/server/gameStateMachine.ts)
- Client state: Zustand (read-only, receives diffs from server)
- Database: SQLite (dev) for game log persistence
- Tests: Vitest (unit), Playwright (e2e)
- Styling: Tailwind CSS

## Key Files
- docs/PRD.md -- Full product spec. Source of truth for all game rules.
- docs/feature_list.json -- All features with passes field. Only edit passes.
- docs/plan.md -- Milestones and validation commands.
- docs/implement.md -- Your operating instructions. READ BEFORE WORKING.
- docs/progress.md -- Session log. Update at the end of every session.
- src/data/nightOrder.ts -- Official night order as static data.
- src/server/gameStateMachine.ts -- Single state machine for all mutations.
- src/roles/ -- One file per role. No cross-role imports.

## How to Run
- Dev server + health check: ./init.sh
- Unit tests: npm run test:unit
- E2e tests: npm run test:e2e
- Full validation: npm run test:unit && npm run test:e2e
- Lint: npm run lint
- Typecheck: npx tsc --noEmit

## Coding Conventions
- All game state mutations go through src/server/gameStateMachine.ts
- Night order is defined in src/data/nightOrder.ts -- do not hardcode elsewhere
- Role abilities are in src/roles/ -- one file per role, no cross-role imports
- All abilities MUST use AbilityContext (isPoisoned, isDrunk) -- never check corruption state on the role object directly
- Never commit with failing tests
- When implementing role abilities, run the FULL test suite (not just role-specific tests) because abilities touch the state machine, WebSocket handlers, and night order system
- Read docs/implement.md for the full operating runbook
