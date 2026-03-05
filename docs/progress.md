# BotC -- Progress Log

## Current State
- **Current Milestone:** Milestone 5 (Evil Team Abilities + Poisoner/Drunk System)
- **Features Completed:** 23 / 52 (LOBBY-01, LOBBY-02, LOBBY-03, STATE-01, STATE-02, ROLE-01, ROLE-02, SETUP-01, SETUP-02, SETUP-03, SETUP-04, DAY-01, DAY-02, DAY-03, DAY-04, DAY-05, DAY-06, ARCH-01, NIGHT-01, NIGHT-02, NIGHT-03, ST-01, ABILITY-POISONER)
- **Last Known Working State:** All tests passing (273 unit, 16 e2e)
- **Last Session:** Session 22

## Session Log

### Session 22 -- ABILITY-POISONER
- Implemented ABILITY-POISONER: Poisoner night ability with full AbilityContext integration
- Updated `src/roles/poisoner.ts` ability handler: validates target, checks isPoisoned context flag (no effect if Poisoner is poisoned), clears previous poison and applies new via stateMutation
- `processPoisonerAction()` already existed in `gameStateMachine.ts` (clears all poison, applies new)
- Socket handler already wired: `submit_night_action` calls `processPoisonerAction` when current entry is poisoner
- Poisoner is first in both NIGHT_1_ORDER and NIGHT_OTHER_ORDER (acts before other roles)
- Poison persists through day until Poisoner acts again next night
- isPoisoned visible in Grimoire (sent to Storyteller via grimoire event)
- 18 new tests in `tests/unit/poisoner.test.ts`: night queue presence, target selection, poison timing, duration, poisoned poisoner ineffective, grimoire visibility, logging, invalid target handling
- All 273 unit + 16 e2e tests passing

### Session 21 -- ST-01
- Implemented ST-01: Storyteller override system for overriding game events before commit
- Added `StorytellerOverride` type to `src/types/game.ts` with 8 override types: kill_player, revive_player, set_poison, clear_poison, add_pending_death, remove_pending_death, modify_night_action, set_player_role
- Replaced generic `applyStorytellOverride` (typo) with typed `applyStorytellerOverride()` in `gameStateMachine.ts` that handles each override type via switch statement and logs all overrides
- Added `storyteller_override` socket handler: Storyteller-only, validates active game phase (not lobby/ended), applies override, sends updated Grimoire and sanitized game_state
- Override hooks already exist at every phase transition (all transitions are Storyteller-controlled socket events)
- Overrides during night are reversible until End Night is confirmed (modify_night_action can be applied multiple times)
- Invalid overrides return same state reference, caught by socket handler and returned as error
- Updated existing `stateMachine.test.ts` to use renamed function
- 25 new tests in `storytellerOverride.test.ts`: 14 state machine tests + 11 WebSocket integration tests
- All 255 unit + 16 e2e tests passing
- MILESTONE 4 COMPLETE

### Session 20 -- NIGHT-03
- Implemented NIGHT-03: End Night -- Storyteller confirms, changes are committed, dawn fires
- Added `commitNightActions()` to `gameStateMachine.ts`: logs all night queue entries as permanent `night_committed` game log entry
- Added `revertNightQueueStep()` to `gameStateMachine.ts`: decrements nightQueuePosition, un-marks the last entry as completed, clears its storytellerInput
- Added `end_night` socket handler: Storyteller-only, validates night phase, commits night actions, resolves dawn deaths, emits `night_ended` + `dawn_announcement` + `game_state`
- Added `undo_night_action` socket handler: Storyteller-only, validates night phase, reverts last queue step, re-sends the reverted `night_prompt`
- 15 new unit tests in `endNight.test.ts`: 6 state machine tests (commit, revert, edge cases) + 9 WebSocket integration tests (end night, dawn fires, auth checks, undo, reversibility)
- All 230 unit + 16 e2e tests passing

### Session 19 -- NIGHT-02
- Implemented NIGHT-02: Storyteller night dashboard with sequential prompts for each role in the queue
- Added `NightPromptInfo` type to `src/types/game.ts` with queuePosition, totalInQueue, roleId, roleName, ability, playerId, playerName, isDrunk, isPoisoned, promptType, promptDescription
- Added `storytellerInput` field to `NightQueueEntry` type for storing Storyteller's per-step input
- Added `getNightPromptInfo()` to `gameStateMachine.ts`: generates role-specific prompt with promptType (choose_player, choose_two_players, provide_number, choose_players_and_role, info_only) and descriptive text
- Added `advanceNightQueue()` to `gameStateMachine.ts`: marks current entry completed, stores storytellerInput, increments position
- Added `submit_night_action` socket handler: Storyteller-only, validates night phase, advances queue, emits `night_action_confirmed` + next `night_prompt` or `night_queue_empty`
- Updated `end_day` socket handler to auto-send first `night_prompt` to Storyteller when night begins
- 18 new unit tests in `nightDashboard.test.ts`: 10 state machine tests + 8 WebSocket integration tests
- Human review: Verify night dashboard UI is clear and shows the right info per role
- All 215 unit + 16 e2e tests passing

### Session 18 -- NIGHT-01
- Implemented NIGHT-01: Night order as static data with runtime queue generation
- Added `generateNightQueue()` to `gameStateMachine.ts`: reads NIGHT_1_ORDER or NIGHT_OTHER_ORDER based on dayNumber, filters to alive players with matching trueRole (or apparentRole for Drunk players)
- Updated `transitionToNight()` to automatically populate `nightQueue` and reset `nightQueuePosition` to 0
- Drunk players appear in the queue under their apparentRole (e.g., washerwoman) since their apparent ability fires normally
- Roles not in the night order (soldier, virgin, saint, baron, scarletWoman, etc.) are excluded
- Dead players are excluded from the queue
- 13 new unit tests in `nightOrder.test.ts`: static data validation, official order verification, queue filtering by role presence, dead player exclusion, passive role exclusion, Drunk apparentRole handling, player-to-entry mapping, empty queue edge case, transitionToNight integration
- All 197 unit + 16 e2e tests passing

### Session 17 -- ARCH-01
- Implemented ARCH-01: Ability execution context with isPoisoned and isDrunk flags
- Added `buildAbilityContext()` to `gameStateMachine.ts`: constructs AbilityContext for a player, reading isPoisoned from player state and isDrunk from player.isDrunk
- Added `resolveAbility()` to `gameStateMachine.ts`: executes an ability handler with the correct context, applies stateMutation on success, and logs the resolution with corruption state
- AbilityContext type already existed in `src/types/ability.ts` with isPoisoned, isDrunk, gameState, player, nightNumber, and storytellerOverride fields
- All 22 role files already had stub `abilityHandler` functions accepting AbilityContext
- 19 new unit tests in `abilityContext.test.ts`: context construction, poisoned/drunk flag propagation, corrupted output verification, stateMutation application, error handling
- All 184 unit + 16 e2e tests passing

### Session 16 -- DAY-06
- Implemented DAY-06: Storyteller can end the day and transition to night phase
- Added `transitionToNight()` to `gameStateMachine.ts`: transitions phase to night, clears daySubPhase, nominations, activeNominationIndex, executedPlayerId
- Added `end_day` socket handler: Storyteller-only, validates phase is day and daySubPhase is 'end' or 'execution' (nominations must be closed)
- Broadcasts `night_started` event with dayNumber and sanitized `game_state` to all clients
- 10 new unit tests in `endDay.test.ts`: 3 state machine tests + 7 WebSocket integration tests
- All 165 unit + 16 e2e tests passing
- MILESTONE 3 COMPLETE

### Session 15 -- DAY-05
- Implemented DAY-05: Execution resolution -- highest passing vote count triggers execution
- Added `resolveExecution()` to `gameStateMachine.ts`: finds highest passing nomination, handles ties (no execution), kills executed player, sets `executedPlayerId`
- Win condition checks integrated into execution: Saint execution triggers Evil win (unless poisoned), Demon execution triggers Good win
- Scarlet Woman trigger: if Demon executed with 5+ alive and unpoisoned SW, SW becomes new Imp and game continues
- General win condition check runs after execution (e.g., Evil wins if ≤2 players remain)
- Added `resolve_execution` socket handler: Storyteller-only, resolves execution, broadcasts `execution_result` to all clients
- `execution_result` event includes `executed` (player info or null) and `reason` ('executed', 'tie', 'no_passing_nominations')
- On game end, broadcasts `game_over` event with winner and all players' true roles revealed
- 19 new unit tests in `execution.test.ts`: 12 state machine tests + 7 WebSocket integration tests
- All 155 unit + 16 e2e tests passing

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
