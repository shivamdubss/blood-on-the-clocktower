# BotC -- Agent Operating Runbook

This document tells you how to operate as a coding agent on this project. Read it at the start of every session.

## How to Start

1. Run `./init.sh` to start the dev server and verify the app is in a working state. If init.sh fails, fix the issue before doing anything else.
2. Read `docs/progress.md` to see what was last worked on and the current state.
3. Read `docs/feature_list.json` to find the next feature where `passes` is `false`, in milestone order per `docs/plan.md`.
4. Read `docs/plan.md` to understand the current milestone and required validation.

## How to Run Things

- Dev server: `./init.sh` (also runs health checks and unit tests)
- Unit tests: `npm run test:unit`
- E2e tests: `npm run test:e2e`
- Full validation: `npm run test:unit && npm run test:e2e`
- Lint: `npm run lint`
- Typecheck: `npx tsc --noEmit`

## The One-Feature Rule

Each session, implement exactly ONE feature. Do not start a second feature. Do not expand scope mid-feature. If you discover new work is needed, add it as a new entry in `feature_list.json` with `passes: false`.

## Validation Before Marking Done

Before flipping `passes` to `true` on any feature:

1. Write automated tests for every entry in the feature's `acceptance_criteria` array.
2. Run the feature-specific validation commands from `plan.md`.
3. Run the FULL test suite: `npm run test:unit && npm run test:e2e`. This is mandatory because abilities touch the state machine, WebSocket handlers, and night order system across multiple files. A role-specific test passing does not mean you have not broken something else.
4. If any test fails, fix it before moving on. Do not skip.

## Role Ability Implementation Rules

- Every role ability MUST use the AbilityContext pattern. Ability handlers receive an `AbilityContext` parameter with `isPoisoned` and `isDrunk` boolean fields.
- NEVER check corruption state on the role object directly. Always use `context.isPoisoned` or `context.isDrunk`.
- The corruption flag is a property on the ability execution context, not on the role itself.
- When the Drunk's apparent ability fires, it must use `context.isDrunk = true` so the Storyteller is prompted to provide false information.
- When a player is poisoned, the state machine sets `context.isPoisoned = true` before the ability handler runs.

## Architectural Constraints (Never Violate)

- All game state mutations go through `src/server/gameStateMachine.ts`. The client is read-only.
- Night order is defined in `src/data/nightOrder.ts` as static data. Do not hardcode night order in logic.
- Each role is a self-contained module in `src/roles/[roleName].ts`. No role file may import from another role file.
- Storyteller can override any game event before it is committed. Expose override hooks at every phase transition.
- All Storyteller actions within a night phase are reversible until End Night is confirmed.

## Git Commits

After completing a feature and confirming all tests pass:
- Stage and commit with a descriptive message (e.g., `feat: implement Poisoner night ability`).
- If the feature has a `human_review` array, note those items in `progress.md` for manual review.

## How to End a Session

1. Update `docs/progress.md` with: current milestone status, what you completed, decisions made, and known issues.
2. Confirm the feature is committed and the repo is clean (no failing tests).
3. If all features in the current milestone now pass, write "MILESTONE COMPLETE" in `progress.md`.
4. Print a short summary: what you did, what the next feature is, any blockers.

## If Something Is Broken When You Start

If `init.sh` fails or tests are failing when you begin a session, your first task is to fix the broken state. Do not start on a new feature until the repo is green. Note any fixes in `progress.md`.

## If You Get Stuck

If you cannot complete a feature after significant effort, do NOT mark it as passing. Instead:
- Note the blocker in `progress.md` with as much detail as possible.
- Commit whatever partial work you have done.
- End the session cleanly so the next session (or a human) can pick up from a known state.
