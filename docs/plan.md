# BotC -- Milestone Plan

## Milestone 1: Foundation
Features: LOBBY-01, LOBBY-02, LOBBY-03, STATE-01, STATE-02
Description: Core infrastructure -- game creation, joining, lobby management, state machine skeleton, and role file structure. No game logic yet, but the architectural patterns are established.
Validation:
  - npm run test:unit
  - npm run test:e2e -- --grep "lobby"

## Milestone 2: Role Assignment + Setup
Features: ROLE-01, ROLE-02, SETUP-01, SETUP-02, SETUP-03, SETUP-04
Description: Role distribution table, private role card delivery, Baron adjustment, Drunk apparent role, Fortune Teller red herring, and Minion/Demon info exchange. After this milestone, a game can be created, players can join, roles are assigned, and Night 0 setup is complete.
Validation:
  - npm run test:unit
  - npm run test:e2e -- --grep "role|setup"

## Milestone 3: Day Phase
Features: DAY-01, DAY-02, DAY-03, DAY-04, DAY-05, DAY-06
Description: Full day phase loop -- dawn announcements, discussion, nominations, simultaneous voting (including ghost votes), execution resolution, and Storyteller-controlled day-to-night transition.
Validation:
  - npm run test:unit
  - npm run test:e2e -- --grep "day|vote|nomination|execution"

## Milestone 4: Night Phase Infrastructure + Ability Context
Features: ARCH-01, NIGHT-01, NIGHT-02, NIGHT-03, ST-01
Note: ARCH-01 (ability execution context with isPoisoned/isDrunk) MUST be implemented first. All subsequent role ability features depend on this pattern. Do not proceed to Milestone 5 without ARCH-01 passing.
Description: AbilityContext with isPoisoned/isDrunk, night order as static data, Storyteller night dashboard with sequential prompts, End Night commit/reversibility, and Storyteller override system.
Validation:
  - npm run test:unit -- --grep "night|ability context|override"
  - npm run test:e2e -- --grep "night"

## Milestone 5: Evil Team Abilities + Poisoner/Drunk System
Features: ABILITY-POISONER, ABILITY-IMP, ABILITY-DRUNK, ABILITY-SPY, ABILITY-SCARLET-WOMAN, ABILITY-BARON, EDGE-01, EDGE-02
Note: Implement Poisoner first (exercises isPoisoned), then Drunk (isDrunk), then Imp, then remaining evil roles. Edge cases EDGE-01 (Poisoner timing) and EDGE-02 (Drunk + detection) are tested here because they are tightly coupled to the Poisoner and Drunk implementations.
Validation:
  - npm run test:unit
  - npm run test:e2e

## Milestone 6: Townsfolk Abilities
Features: ABILITY-WASHERWOMAN, ABILITY-LIBRARIAN, ABILITY-INVESTIGATOR, ABILITY-CHEF, ABILITY-EMPATH, ABILITY-FORTUNE-TELLER, ABILITY-UNDERTAKER, ABILITY-MONK, ABILITY-RAVENKEEPER, ABILITY-VIRGIN, ABILITY-SLAYER, ABILITY-SOLDIER, ABILITY-MAYOR
Note: Every ability must use AbilityContext and check isPoisoned/isDrunk. Run the full test suite after each ability, not just the role-specific tests. Abilities touch the state machine, WebSocket handlers, and night order system across multiple files.
Validation:
  - npm run test:unit
  - npm run test:e2e

## Milestone 7: Outsider Abilities + Edge Cases
Features: ABILITY-BUTLER, ABILITY-RECLUSE, ABILITY-SAINT, EDGE-03
Description: Butler vote constraint, Recluse evil registration, Saint execution loss, and Virgin+Drunk edge case.
Validation:
  - npm run test:unit
  - npm run test:e2e

## Milestone 8: Win Conditions + Grimoire + UI + Full Game
Features: WIN-01, ST-02, UI-01, UI-02, E2E-01
Description: All win conditions in priority order, complete Grimoire dashboard, player UI, seating circle, and the final full-game integration test.
Validation:
  - npm run test:unit && npm run test:e2e
  - Full 7-player Trouble Brewing scenario test passes
  - No console errors during full game
