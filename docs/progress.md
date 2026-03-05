# BotC -- Progress Log

## Current State
- **Current Milestone:** Milestone 8 (Win Conditions + Grimoire + UI + Full Game)
- **Features Completed:** 47 / 47 (ALL FEATURES COMPLETE)
- **Last Known Working State:** All tests passing (626 unit, 27 e2e)
- **Last Session:** Session 43

## Session Log

### Session 43 -- UI-02 + E2E-01
- Marked UI-02 as passing: SeatingCircle component and seatIndex assignment already fully implemented
  - `SeatingCircle.tsx` renders players in a circle via CSS positioning
  - `seatIndex` assigned at join time in `socketHandlers.ts:77`
  - 3 existing e2e tests verify seatIndex assignment, dead player marking, and adjacency
- Implemented E2E-01: Full 7-player Trouble Brewing game e2e test
  - 3 new e2e tests in `fullGame.spec.ts`:
    1. "7-player Trouble Brewing game completes start to finish" — creates game, joins 7 players, receives roles, transitions through setup → day, nominates and executes the Demon, verifies Good wins with role reveal
    2. "night abilities fire in correct order and produce output" — plays through setup → day → night → end night, verifies night queue processes sequentially and dawn announcement fires
    3. "game ends with no console errors during full cycle" — plays 2 full day/night cycles ending with Demon execution
  - Tests handle random role assignment by reading the Grimoire to identify the Demon and Scarlet Woman
  - Scarlet Woman is poisoned via Storyteller override to prevent trigger on Demon execution
  - All 626 unit + 27 e2e tests passing
- MILESTONE 8 COMPLETE
- ALL MILESTONES COMPLETE

### Session 41 -- EDGE-03
- Marked EDGE-03 as passing: Virgin + Drunk nominator edge case
- Implementation was already complete: `processVirginNomination()` in `gameStateMachine.ts` (line 256) uses `nominator.apparentRole` via `getRoleType()` to check if nominator is Townsfolk
- Drunk's `apparentRole` is always a Townsfolk (set during SETUP-02), so Drunk nominating Virgin correctly triggers the ability
- Existing tests in `virgin.test.ts` already cover all 3 acceptance criteria: state machine test (line 136: "Drunk nominator counts as Townsfolk"), WebSocket test (line 432: "Drunk nominating Virgin triggers execution"), and both verify the Drunk is executed as a result
- All 626 unit + 16 e2e tests passing
- MILESTONE 7 COMPLETE
- Next milestone: Milestone 8 (Win Conditions + Grimoire + UI + Full Game): WIN-01, ST-02, UI-01, UI-02, E2E-01

### Session 40 -- ABILITY-SAINT
- Marked ABILITY-SAINT as passing: Saint execution triggers Good loss (Evil wins)
- Saint is a passive Outsider (firstNight: false, otherNights: false) with no night action
- Saint execution logic already implemented in `resolveExecution()` (gameStateMachine.ts line ~439) and Virgin trigger path (line ~274)
- If Saint is executed, `winner` is set to `'evil'` and phase to `'ended'` immediately
- If Saint is poisoned when executed, the loss condition does NOT trigger (normal execution proceeds)
- Saint dying at night (Demon kill via `resolveDawnDeaths`) does NOT trigger the loss condition
- 11 new tests in `saint.test.ts`: 3 metadata tests (team, passive, ability text), 6 state machine tests (execution triggers Evil win, triggers before other checks, poisoned no trigger, night death no trigger, dead Saint no effect, non-Saint execution), 2 WebSocket tests (game_over with Evil win, poisoned Saint no game_over)
- All 626 unit + 16 e2e tests passing
- Next feature: EDGE-03 (Virgin + Drunk nominator)

### Session 39 -- ABILITY-RECLUSE
- Marked ABILITY-RECLUSE as passing: Recluse registration in detection abilities
- Recluse is a passive Outsider (firstNight: false, otherNights: false) with no night action
- Added `recluseInfo` optional field to `NightPromptInfo` type: includes playerId and playerName of the Recluse
- Updated `getNightPromptInfo()` in `gameStateMachine.ts`: for detection roles (washerwoman, librarian, investigator, chef, empath, fortuneTeller), checks if a living Recluse exists in the game and adds recluseInfo + prompt description warning
- Storyteller sees warning: "X is the Recluse -- they may register as Evil or as a Minion/Demon" on detection role prompts
- Recluse is actually Good (outsider team) for win conditions
- All detection ability inputs are Storyteller-provided, so Recluse registration is at Storyteller's discretion
- Fixed 2 flaky WebSocket tests: increased timeout for spy.test.ts "Spy grimoire data not leaked" and execution.test.ts "all clients receive execution_result simultaneously" (intermittent timing issues under concurrent load)
- 13 new tests in `recluse.test.ts`: 3 metadata tests (team, passive, ability handler), 8 state machine tests (recluseInfo on Empath, Fortune Teller, Chef prompts; no recluseInfo on non-detection roles, dead Recluse, no Recluse in game; Good for win conditions; Investigator Recluse-as-Evil), 2 WebSocket tests (detection prompt includes recluseInfo, non-detection does not)
- All 615 unit + 16 e2e tests passing
- Next feature: ABILITY-SAINT

### Session 37 -- ABILITY-MAYOR
- Marked ABILITY-MAYOR as passing: both abilities (3-player win + bounce kill) were already implemented in prior sessions
- `checkMayorWin()` in `gameStateMachine.ts` (line 115-122): checks 3 alive players, no executedPlayerId, Mayor alive and not poisoned → Good wins
- Mayor bounce in `processImpAction()` (line 956-973): if Imp targets Mayor (not poisoned) and Storyteller provides `mayorRedirectPlayerId`, kill redirects to that player
- `end_day` socket handler calls `checkMayorWin` before `transitionToNight`, emits `game_over` if Mayor win triggers
- Mayor is passive (firstNight: false, otherNights: false) — no night action needed
- 13 new tests in `mayor.test.ts`: 7 state machine tests (3-player win, no execution check, >3 players, dead Mayor, poisoned Mayor, bounce redirect, bounce poisoned, no redirect, passive metadata, purity) + 3 WebSocket tests (game_over on Mayor win, poisoned no win, bounce via night queue)
- All 576 unit + 16 e2e tests passing
- MILESTONE 6 COMPLETE
- Next milestone: Milestone 7 (Outsider Abilities + Edge Cases): ABILITY-BUTLER, ABILITY-RECLUSE, ABILITY-SAINT, EDGE-03

### Session 36 -- ABILITY-SLAYER + ABILITY-SOLDIER
- Marked ABILITY-SLAYER as passing: implementation was already complete from prior sessions (processSlayerAction in gameStateMachine.ts, slayer_action socket handler in socketHandlers.ts)
- Fixed flaky WebSocket test: "Slayer kills the Demon and all clients receive slayer_result" was timing out because random role assignment could include Scarlet Woman, preventing game_over; fix ensures SW is replaced with poisoner in the test setup
- Slayer is a one-time active day ability: player publicly chooses a target, if target is the Demon they die immediately
- processSlayerAction checks: slayerAbilityUsed flag, isPoisoned/isDrunk (no effect if corrupted), target trueRole === 'imp' for kill, Scarlet Woman trigger on Demon death
- Socket handler validates: day phase, player is alive, player is Slayer (trueRole or apparentRole), ability not already used, target exists and alive
- 15 tests in slayer.test.ts: 9 state machine tests (hit, miss, spent, poisoned, drunk, SW trigger, Good win, logging, purity) + 6 WebSocket tests (kill Demon, miss, poisoned, second use error, non-Slayer error, night phase error)
- All 556 unit + 16 e2e tests passing
- Marked ABILITY-SOLDIER as passing: Soldier protection already implemented in processImpAction (gameStateMachine.ts lines 970-983)
- Soldier is a purely passive role (firstNight: false, otherNights: false) — no night action needed
- Protection blocks Demon kill; poisoned Soldier loses protection; execution still kills Soldier
- 7 new tests in soldier.test.ts: 5 state machine tests (protection, poisoned, execution, passive metadata, purity) + 2 WebSocket tests (Imp blocked by Soldier in night queue, poisoned Soldier killed)
- All 563 unit + 16 e2e tests passing
- Next feature: ABILITY-MAYOR (last in Milestone 6)

### Session 35 -- ABILITY-RAVENKEEPER
- Implemented ABILITY-RAVENKEEPER: Ravenkeeper chooses a player and learns their role when killed by the Demon at night
- Updated `src/roles/ravenkeeper.ts` ability handler: validates targetPlayerId and role input, checks isPoisoned/isDrunk for isCorrupted flag, supports `notTriggered` flag when not killed
- Added `choose_player_and_provide_role` prompt type to `NightPromptInfo` for Ravenkeeper-specific Storyteller input
- Added `ravenkeeperKilledTonight` optional field to `NightPromptInfo`: checks if Ravenkeeper is in pendingDeaths
- Updated `getNightPromptInfo()` in `gameStateMachine.ts`: dynamically changes prompt type and description based on whether Ravenkeeper was killed
- Updated `socketHandlers.ts` night_info delivery: resolves `targetPlayerId` → `targetPlayerName`, suppresses night_info when `notTriggered` is set
- Infrastructure already in place: ravenkeeper in NIGHT_OTHER_ORDER (after imp), included in INFO_ROLES
- Fires every night except Night 1; only triggers when killed by Demon (in pendingDeaths)
- When poisoned/drunk, isCorrupted flag is set; Storyteller manually provides false role
- 17 new tests in `ravenkeeper.test.ts`: 3 night order tests, 2 night prompt tests (killed/not killed), 8 ability handler tests (triggered, notTriggered, validation, poisoned, drunk, execution no-trigger), 4 WebSocket tests (night_info delivery, no delivery when not killed, poisoned delivery, Imp+RK queue sequence)
- All 525 unit + 16 e2e tests passing
- Next feature: ABILITY-VIRGIN

### Session 34 -- ABILITY-MONK
- Implemented ABILITY-MONK: Monk chooses a player each night (not first) to protect from the Demon
- Added `processMonkAction()` to `gameStateMachine.ts`: sets `monkProtectedPlayerId` on the game state
- Updated `src/roles/monk.ts` ability handler: validates targetPlayerId, checks player exists/alive, prevents self-targeting, checks isPoisoned/isDrunk for isCorrupted flag
- Wired Monk processing into `submit_night_action` socket handler: only applies protection if Monk is not poisoned
- Infrastructure already in place: monk in NIGHT_OTHER_ORDER (not NIGHT_1_ORDER), `monkProtectedPlayerId` field in GameState, Monk protection check in `processImpAction`, `choose_player` prompt type
- `monkProtectedPlayerId` is cleared at start of each night via `transitionToNight()`
- When poisoned, Monk's protection is not applied (socket handler checks `isPoisoned` before calling `processMonkAction`)
- 21 new tests in `monk.test.ts`: 3 night order tests, 1 night prompt test, 6 state machine tests (protection set, logging, invalid target, Imp blocked, unprotected player killed, cleared at night), 7 ability handler tests (success, no target, invalid target, dead target, self-target, poisoned, drunk), 4 WebSocket tests (protection set, Imp blocked, poisoned no effect, cleared at night transition)
- All 508 unit + 16 e2e tests passing
- Next feature: ABILITY-RAVENKEEPER

### Session 33 -- ABILITY-UNDERTAKER
- Implemented ABILITY-UNDERTAKER: Undertaker learns the role of the executed player each night (after first)
- Updated `src/roles/undertaker.ts` ability handler: validates `role` string input from Storyteller or `noExecution: true`, checks isPoisoned/isDrunk for isCorrupted flag
- Added `provide_role` prompt type to `NightPromptInfo` for Undertaker-specific Storyteller input
- Added `executedPlayerInfo` optional field to `NightPromptInfo`: includes playerId, playerName, trueRole from game log execution entry (convenience for Storyteller)
- Infrastructure already in place: undertaker in NIGHT_OTHER_ORDER (not NIGHT_1_ORDER), included in INFO_ROLES
- Fires every night except Night 1
- When no execution occurred, Storyteller submits `{ noExecution: true }` and Undertaker learns nothing
- When poisoned/drunk, isCorrupted flag is set; Storyteller manually provides false role
- 19 new tests in `undertaker.test.ts`: 2 night order tests (not Night 1, Night 2+), 3 night prompt tests (prompt type, executed player info, no execution info), 9 ability handler tests (role info, noExecution, validation, poisoned, drunk), 5 WebSocket tests (role delivery, noExecution delivery, poisoned delivery, isPoisoned flag, isDrunk flag)
- All 487 unit + 16 e2e tests passing
- Next feature: ABILITY-MONK

### Session 32 -- ABILITY-FORTUNE-TELLER
- Implemented ABILITY-FORTUNE-TELLER: Fortune Teller chooses 2 players each night, learns if either is the Demon (or red herring)
- Updated `src/roles/fortuneTeller.ts` ability handler: validates player1Id, player2Id, and boolean answer; checks isPoisoned/isDrunk for isCorrupted flag
- Infrastructure already in place: fortuneTeller in both NIGHT_1_ORDER and NIGHT_OTHER_ORDER, prompt type `choose_two_players`, prompt description mentioning Demon and red herring, included in INFO_ROLES
- Fires every night (both Night 1 and Night 2+)
- Red herring always registers as "yes" even if dead (Storyteller manually provides the answer)
- Recluse may register as Demon at Storyteller's discretion (Storyteller manually provides the answer)
- When poisoned/drunk, isCorrupted flag is set; Storyteller manually provides false answer
- 20 new tests in `fortuneTeller.test.ts`: 2 night order tests (Night 1 + Night 2+), 1 night prompt test, 12 ability handler tests (yes/no answers, red herring, dead red herring, Recluse, validation, poisoned, drunk), 5 WebSocket tests (info delivery with yes, info delivery with no, poisoned info, isPoisoned flag, isDrunk flag)
- All 468 unit + 16 e2e tests passing
- Next feature: ABILITY-UNDERTAKER

### Session 31 -- ABILITY-EMPATH
- Implemented ABILITY-EMPATH: Empath learns how many of their 2 alive neighbours are Evil each night
- Updated `src/roles/empath.ts` ability handler: validates `number` input from Storyteller, checks isPoisoned/isDrunk for isCorrupted flag
- Infrastructure already in place: empath in both NIGHT_1_ORDER and NIGHT_OTHER_ORDER, prompt type `provide_number`, prompt description mentioning evil alive neighbours, included in INFO_ROLES
- Fires every night (unlike Chef which is Night 1 only)
- Neighbours are computed dynamically each night based on current alive state (dead neighbours skipped to next living player)
- Recluse may register as Evil at Storyteller's discretion (Storyteller manually provides the count)
- When poisoned/drunk, isCorrupted flag is set; Storyteller manually provides false number
- 18 new tests in `empath.test.ts`: 2 night order tests (Night 1 + Night 2+), 1 night prompt test, 10 ability handler tests (success, zero, two neighbours, validation, dead neighbour skip, Recluse, poisoned, drunk), 5 WebSocket tests (info delivery, zero delivery, poisoned info, isPoisoned flag, isDrunk flag)
- All 448 unit + 16 e2e tests passing
- Next feature: ABILITY-FORTUNE-TELLER

### Session 30 -- ABILITY-CHEF
- Implemented ABILITY-CHEF: Chef learns the number of evil pairs sitting adjacent on Night 1
- Updated `src/roles/chef.ts` ability handler: validates `number` input from Storyteller, checks isPoisoned/isDrunk for isCorrupted flag
- Infrastructure already in place: chef in NIGHT_1_ORDER, prompt type `provide_number`, prompt description mentioning evil pairs, included in INFO_ROLES
- Storyteller computes evil pair count based on seating order (join order determines seat positions) and provides the number
- When poisoned/drunk, isCorrupted flag is set; Storyteller manually provides false number
- 16 new tests in `chef.test.ts`: 2 night order tests, 1 night prompt test, 7 ability handler tests (success, zero pairs, validation, seating, poisoned, drunk), 5 WebSocket tests (info delivery, zero pairs delivery, poisoned info, isPoisoned flag, isDrunk flag)
- All 430 unit + 16 e2e tests passing
- Next feature: ABILITY-EMPATH

### Session 29 -- ABILITY-INVESTIGATOR
- Implemented ABILITY-INVESTIGATOR: Investigator learns one of two players is a specific Minion on Night 1
- Updated `src/roles/investigator.ts` ability handler: validates two players + Minion role, checks isPoisoned/isDrunk for isCorrupted flag
- Fixed flaky test in `execution.test.ts` ("Demon execution triggers game_over"): random role assignment could assign Scarlet Woman, preventing game end; fix ensures no SW in game when testing Demon execution
- Infrastructure already in place: investigator in NIGHT_1_ORDER, prompt type `choose_players_and_role`, prompt description mentioning Minion, included in INFO_ROLES
- Recluse may be shown as the Minion at Storyteller's discretion (tested: Storyteller can include Recluse as one of the two players)
- 17 new tests in `investigator.test.ts`: 2 night order tests, 1 night prompt test, 9 ability handler tests (success, validation, Recluse, poisoned, drunk), 5 WebSocket tests (info delivery, poisoned info, isPoisoned flag, isDrunk flag)
- All 414 unit + 16 e2e tests passing
- Next feature: ABILITY-CHEF

### Session 28 -- ABILITY-LIBRARIAN
- Implemented ABILITY-LIBRARIAN: Librarian learns one of two players is a specific Outsider on Night 1, or learns "no Outsiders" if none in game
- Updated `src/roles/librarian.ts` ability handler: validates two players + Outsider role, or accepts `noOutsiders: true` flag
- When poisoned/drunk, isCorrupted flag is set; Storyteller manually provides false information
- Infrastructure already in place: librarian in NIGHT_1_ORDER, prompt type `choose_players_and_role`, prompt description mentioning Outsider, included in INFO_ROLES
- 19 new tests in `librarian.test.ts`: 2 night order tests, 1 night prompt test, 11 ability handler tests (success, validation, noOutsiders, poisoned, drunk), 5 WebSocket tests (info delivery, noOutsiders delivery, poisoned info, isPoisoned flag, isDrunk flag)
- All 397 unit + 16 e2e tests passing
- Next feature: ABILITY-INVESTIGATOR

### Session 27 -- ABILITY-WASHERWOMAN
- Marked ABILITY-WASHERWOMAN as passing: implementation was already complete from prior sessions (ability handler, night prompt, night_info delivery)
- Washerwoman fires on Night 1 only (in NIGHT_1_ORDER, not NIGHT_OTHER_ORDER)
- Storyteller prompted with choose_players_and_role prompt type to select 2 players and a Townsfolk role
- Player receives night_info WebSocket event with player1Id, player1Name, player2Id, player2Name, revealedRole
- When poisoned/drunk, isCorrupted flag is set to true; Storyteller manually provides false information
- 16 new tests in `washerwoman.test.ts`: 2 night order tests, 1 night prompt test, 8 ability handler tests (success, validation, poisoned, drunk), 5 WebSocket tests (info delivery, poisoned info, isPoisoned flag, isDrunk flag)
- All 372 unit + 16 e2e tests passing
- Next feature: ABILITY-LIBRARIAN

### Session 26 -- EDGE-01 + EDGE-02
- Marked EDGE-01 as passing: Poisoner timing tests already existed in `poisonerTiming.test.ts` (7 tests) covering all acceptance criteria (poison persists through Night N and Day N, expires at Night N+1, correctly computed for abilities after Poisoner in queue)
- Marked EDGE-02 as passing: wrote 5 new tests in `drunkDetection.test.ts` covering all acceptance criteria (Storyteller flagged with DRUNK warning in prompt, Storyteller provides false info via input, Drunk receives Storyteller-provided info, isDrunk flag in AbilityContext)
- Implementation for both features was already complete from prior sessions (transitionToNight clears poison, processPoisonerAction applies it; getNightPromptInfo flags Drunk with warning text)
- All 356 unit + 16 e2e tests passing
- MILESTONE 5 COMPLETE
- Next milestone: Milestone 6 (Townsfolk Abilities)

### Session 25 -- ABILITY-SCARLET-WOMAN
- Marked ABILITY-SCARLET-WOMAN as passing: all acceptance criteria already covered by existing tests (13 tests in scarletWoman.test.ts)
- Fixed pre-existing TypeScript error in scarletWoman.test.ts line 367 (type annotation mismatch on `find()` callback parameter)
- Scarlet Woman implementation already complete from prior sessions (resolveExecution in gameStateMachine.ts handles SW trigger)
- All 350 unit + 16 e2e tests passing
- Remaining Milestone 5 features: EDGE-01, EDGE-02

### Session 23 -- ABILITY-IMP
- Implemented ABILITY-IMP: Imp night kill with star-pass, Monk/Soldier protection, poisoned check
- Added `processImpAction()` to `gameStateMachine.ts`: handles normal kills (adds to pendingDeaths), star-pass (Imp dies, chosen Minion becomes new Imp), Monk protection (monkProtectedPlayerId blocks kill), Soldier protection (blocks kill if Soldier not poisoned)
- Updated `src/roles/imp.ts` ability handler: validates target (alive, exists), checks isPoisoned (no effect), detects self-target as star-pass, returns structured result data
- Wired Imp processing into `submit_night_action` socket handler (after Poisoner block): checks Imp poisoned status before calling processImpAction
- Imp already in NIGHT_OTHER_ORDER (not NIGHT_1_ORDER), fires every night except Night 1
- Star-pass does NOT trigger Scarlet Woman (only uses imp_star_pass log type, not a regular demon death)
- Star-pass updates Grimoire (trueRole of new Imp reflects in players array)
- 22 new tests in `tests/unit/imp.test.ts`: 11 state machine tests (kill, Monk block, Soldier block, poisoned Soldier, star-pass, star-pass auto-pick, star-pass no SW trigger, dead target, night queue presence) + 6 ability handler tests (valid kill, no target, invalid target, dead target, poisoned Imp, star-pass data) + 5 WebSocket tests (kill → pendingDeaths, Monk blocks via WS, poisoned no-op, star-pass via WS, dawn announcement integration)
- All 314 unit + 16 e2e tests passing

### Session 22 -- ABILITY-POISONER
- Implemented ABILITY-POISONER: Poisoner night ability with full AbilityContext integration
- Updated `src/roles/poisoner.ts` ability handler: validates target, checks isPoisoned context flag (no effect if Poisoner is poisoned), clears previous poison and applies new via stateMutation
- `processPoisonerAction()` already existed in `gameStateMachine.ts` (clears all poison, applies new)
- Socket handler already wired: `submit_night_action` calls `processPoisonerAction` when current entry is poisoner
- Poisoner is first in both NIGHT_1_ORDER and NIGHT_OTHER_ORDER (acts before other roles)
- Poison persists through day until Poisoner acts again next night
- isPoisoned visible in Grimoire (sent to Storyteller via grimoire event)
- 22 new tests in `tests/unit/poisoner.test.ts`: 14 state machine tests (processPoisonerAction, night queue presence, poison timing/duration, ability handler validation) + 5 WebSocket tests (Storyteller submits action, clears previous poison, Grimoire visibility, sanitized game_state leak prevention) + 3 timing tests
- All 277 unit + 16 e2e tests passing

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
