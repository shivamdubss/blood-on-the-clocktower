# BotC -- Progress Log

## Current State
- **Current Milestone:** Milestone 3 (Day Phase) -- In Progress
- **Features Completed:** 15 / 52 (LOBBY-01, LOBBY-02, LOBBY-03, STATE-01, STATE-02, ROLE-01, ROLE-02, SETUP-01, SETUP-02, SETUP-03, SETUP-04, DAY-01, DAY-02, DAY-03, DAY-04)
- **Last Known Working State:** All tests passing (136 unit, 16 e2e)
- **Last Session:** Session 14

## Session Log

### Session 14 -- DAY-04
- Implemented DAY-04: Voting system with simultaneous public voting on nominations
- Added `activeNominationIndex` to `GameState` type and `votesSubmitted` to `Nomination` type
- Added `startVote()`, `recordVote()`, `resolveVote()` to `gameStateMachine.ts`
- Modified `nominate` socket handler to auto-start a vote after each nomination (daySubPhase → 'vote')
- Added `submit_vote` socket handler: validates phase, prevents double voting, tracks ghost votes for dead players
- Added `reveal_votes` socket handler: Storyteller-only, resolves vote and broadcasts results to all clients
- Auto-reveal: when all eligible players have submitted, vote resolves automatically without Storyteller action
- Ghost vote tracking: dead players get exactly one ghost vote; `ghostVoteUsed` flag persists across nominations
- Vote threshold: passes if yes votes >= ceil(livingPlayers / 2)
- After vote resolves, daySubPhase returns to 'nomination' for further nominations
- Updated 2 existing nomination tests to resolve votes before testing second nomination (vote auto-starts now)
- Refactored socket handlers to use destructuring for `activeNominationIndex` to satisfy state machine purity test
- 20 new unit tests in `voting.test.ts`: 9 state machine tests + 11 WebSocket integration tests
- All 136 unit + 16 e2e tests passing

### Session 13 -- DAY-03
- Implemented DAY-03: Nomination system with living player nominations
- Fixed pre-existing TypeScript error in `discussionPhase.test.ts` (unknown type on `lastLog.data`)
- Added `addNomination()` and `clearNominations()` to `gameStateMachine.ts`
- Added `nominate` socket handler: validates living status, once-per-day nominator/nominee limits, nomination window open, no self-nomination
- Added `open_nominations` socket handler: Storyteller-only, transitions from discussion to nomination, clears previous nominations
- Added `close_nominations` socket handler: Storyteller-only, transitions from nomination to end sub-phase
- Broadcasts `nomination_made`, `nominations_opened`, `nominations_closed` events to all clients
- Nomination tracking derived from `nominations` array (no new Player fields needed)
- 15 new unit tests in `nomination.test.ts`: state machine tests, WebSocket integration tests for all acceptance criteria
- All 116 unit + 16 e2e tests passing

### Session 12 -- DAY-02
- Implemented DAY-02: Discussion phase with Storyteller-controlled timing
- Added `transitionDaySubPhase()` to `gameStateMachine.ts` for changing daySubPhase with game log entry
- Added `start_discussion` socket handler: Storyteller-only, validates phase is day/dawn, transitions to discussion
- Added `end_discussion` socket handler: Storyteller-only, validates phase is day/discussion, transitions to nomination
- Both handlers broadcast `discussion_started`/`discussion_ended` events and updated `game_state` to all clients
- 11 new unit tests in `discussionPhase.test.ts`: state machine tests, WebSocket integration tests (start/end discussion, auth checks, phase validation, simultaneous broadcast)
- All 101 unit + 16 e2e tests passing

### Session 11 -- DAY-01
- Implemented DAY-01: Dawn announcement -- deaths from the previous night are announced
- Added `addPendingDeath()` and `resolveDawnDeaths()` to `gameStateMachine.ts`
- `resolveDawnDeaths()` kills all pending death players, clears pendingDeaths, transitions to day/dawn phase, increments dayNumber
- Added `transition_to_day` socket handler: Storyteller-only, validates phase is night or setup
- Broadcasts `dawn_announcement` event to all clients with deaths by player name (not role)
- If no deaths, announcement includes a "No one died last night." message
- Broadcasts sanitized game_state with dead players marked
- 10 new unit tests in `dawnAnnouncement.test.ts`: state machine unit tests (addPendingDeath, resolveDawnDeaths), WebSocket integration tests (death announcement, simultaneous broadcast, dead marking, no-deaths message, auth checks)
- All 90 unit + 16 e2e tests passing

### Session 10 -- SETUP-04
- Implemented SETUP-04: Minion and Demon info exchange on Night 1
- Minions receive `minion_info` WebSocket event with other Minions' identities and the Demon's identity
- Demon receives `demon_info` WebSocket event with Minion identities and 3 bluff roles (not-in-play Townsfolk)
- Extended `RoleAssignmentResult` to include `bluffRoles` array
- Added `demonBluffRoles` field to `GameState`; sanitized from broadcast `game_state`
- Bluff roles exclude Drunk's apparent role (since a player claims that role)
- 7 new unit tests in `minionDemonInfo.test.ts`: Minion info delivery, Demon info delivery, bluff role validity, correct-player-only delivery
- All 80 unit + 16 e2e tests passing
- MILESTONE 2 COMPLETE

### Session 9 -- SETUP-03
- Implemented SETUP-03: Fortune Teller red herring is assigned at game start
- Changed `assignRoles()` return type to `RoleAssignmentResult` containing both `assignments` array and `fortuneTellerRedHerringId`
- When Fortune Teller is in the game, a random Good player (not the Fortune Teller) is picked as the red herring
- Added `setFortuneTellerRedHerring()` to gameStateMachine.ts; wired into `assignAllRoles()`
- Red herring ID included in Grimoire data sent to Storyteller
- Updated existing tests (roleDistribution, drunkAssignment, baronAdjustment) to destructure new return type
- 6 new unit tests in `redHerring.test.ts`: red herring is Good, stored in state, visible in Grimoire, persists after player death
- All 73 unit + 16 e2e tests passing

### Session 8 -- SETUP-02
- Implemented SETUP-02: Drunk is assigned an apparent Townsfolk role not otherwise in the game
- Extended `RoleAssignment` interface to include `apparentRole` field
- `assignRoles()` now picks a random Townsfolk not in the assigned pool as the Drunk's apparent role
- `assignAllRoles()` uses the `apparentRole` from role distribution (no longer hardcodes `apparentRole: role`)
- 6 new unit tests in `drunkAssignment.test.ts`: apparent role is Townsfolk, not in game, stored in state, Grimoire shows both roles, non-Drunk players unaffected
- All 67 unit + 16 e2e tests passing

### Session 7 -- SETUP-01
- Implemented SETUP-01: Baron adjustment adds 2 Outsiders (replaces 2 Townsfolk)
- Added `applyBaronAdjustment()` to `roleDistribution.ts` -- exported for testing
- Modified `assignRoles()` to pick minions first, then apply Baron adjustment before selecting townsfolk/outsiders
- Updated existing `roleDistribution.test.ts` to account for Baron-adjusted type counts
- 7 new unit tests in `baronAdjustment.test.ts`: adjustment correctness, total preservation, integration with assignRoles, no-Baron passthrough
- All 61 unit + 16 e2e tests passing

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
