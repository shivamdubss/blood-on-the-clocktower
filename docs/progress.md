# BotC -- Progress Log

## Current State
- **Current Milestone:** Milestone 2 (Role Assignment + Setup) -- IN PROGRESS
- **Features Completed:** 7 / 52 (LOBBY-01, LOBBY-02, LOBBY-03, STATE-01, STATE-02, ROLE-01, ROLE-02)
- **Last Known Working State:** All tests passing (54 unit, 16 e2e)
- **Last Session:** Session 6

## Session Log

### Session 6 -- ROLE-02
- Implemented ROLE-02: Players receive their private role card after assignment
- Added `your_role` WebSocket event: each player receives only their own role (apparentRole) with name, team, and ability metadata
- Added `grimoire` WebSocket event: Storyteller receives all players' true roles, apparent roles, alive/dead/poison/drunk status
- Added `sanitizeGameStateForPlayer()`: strips trueRole, apparentRole, isPoisoned, isDrunk, and hostSecret from broadcast `game_state` to prevent info leakage
- Fixed pre-existing flaky e2e test in lobbyStart.spec.ts (race condition: set up both `player_left` and `game_state` listeners before triggering disconnect)
- 5 new unit tests in `roleCard.test.ts`, 3 new e2e tests in `roleReveal.spec.ts`
- All 54 unit + 16 e2e tests passing
- Human review: Verify role card UI is readable and correctly styled

### Session 5 -- ROLE-01
- Implemented ROLE-01: Server assigns roles according to official Trouble Brewing distribution table
- Created `src/server/roleDistribution.ts` with distribution table, `assignRoles()`, `getRoleType()`, and role pools
- Added `assignAllRoles()` to `gameStateMachine.ts` -- assigns roles via state machine on game start
- Wired role assignment into `start_game` socket handler (roles assigned before phase transition to setup)
- 8 new unit tests in `roleDistribution.test.ts`: distribution table correctness for all counts (5-15), unique role assignment, type count validation, randomization
- All 49 unit + 13 e2e tests passing

### Session 4 -- STATE-01 + STATE-02
- Implemented STATE-01: verified all game state mutations go through gameStateMachine.ts
- Implemented STATE-02: verified all 22 role files are self-contained modules
- Updated all role files with correct metadata (ability text, firstNight, otherNights) from central ROLES data
- Human review: Audit role files to confirm no cross-role imports; Audit codebase to confirm no client-side state mutations
- MILESTONE 1 COMPLETE

### Session 4 (earlier) -- STATE-01
- Implemented STATE-01: verified all game state mutations go through gameStateMachine.ts
- Fixed direct state mutation in socketHandlers.ts (storytellerId was set via spread instead of state machine function)
- Added `setStoryteller()` function to gameStateMachine.ts
- Wrote 11 unit tests in `stateMachine.test.ts`: immutability, purity, client read-only verification, source-code analysis confirming no direct mutations in socket handlers
- Human review: Audit codebase to confirm no client-side state mutations exist

### Session 3 -- LOBBY-03
- Implemented `start_game` socket handler: validates player count (5-15), host-only restriction, transitions phase to `setup`
- Implemented disconnect handler: removes players from lobby game state, emits `player_left` and updated `game_state`
- Added `findGameByPlayerId` helper in socketHandlers.ts
- Added `hostSecret` mechanism (via hook/linter): game creation returns a `hostSecret`, first player to join with matching secret claims storyteller role
- Fixed multiple flaky socket.io tests by creating clients sequentially instead of simultaneously
- Fixed e2e joinLobby duplicate name test: keep client1 connected (disconnect now removes player)
- Added unit tests: `startGame.test.ts` (5 tests), e2e: `lobbyStart.spec.ts` (3 tests)

### Session 2 -- LOBBY-02
- Completed `join_game` WebSocket handler: validates join code, checks game phase, rejects duplicate names, adds player to game state via `addPlayer()` state machine function
- Changed error event name from `error` to `join_error` to avoid conflict with Socket.io's built-in `error` event
- Player gets `game_joined` (with gameId + playerId) and `game_state` events on successful join
- Host/other players get `player_joined` and `game_state` events in real time
- Added 7 unit tests in `joinGame.test.ts` and 5 e2e tests in `joinLobby.spec.ts`

### Session 1 -- LOBBY-01
- Implemented `POST /api/game` endpoint with unique 6-character alphanumeric join code
- Join code uses charset `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no ambiguous chars I/1/O/0)
- Response includes `wsUrl` for WebSocket connection
- Note: `npm run test:unit` already includes `--run` flag; do not pass `--run` again via `--`

### Session 0 -- Initializer
- Set up repo structure, installed dependencies, created scaffolding files.

## Decisions

- Join code charset excludes ambiguous characters (I, 1, O, 0) for readability
- Socket.io clients in tests must be created sequentially (not simultaneously) to avoid connect race conditions
- Disconnect in lobby removes player from game state; disconnect in-game is a no-op for now
- `hostSecret` returned from POST /api/game; first joiner with matching secret becomes storyteller

## Known Issues

(none)

## Human Review Items

- LOBBY-03: Verify lobby UI layout is clear and intuitive (no UI built yet, deferred to UI milestone)
