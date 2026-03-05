# Blood on the Clocktower — Product Requirements Document

**Version:** 1.0  
**Scope:** Trouble Brewing script (v1), web-based, multiplayer  
**Status:** Ready for agent implementation

---

## 1. Overview

Blood on the Clocktower (BotC) is a social deduction game for 5–15 players. Players are secretly assigned roles and divided into two teams: Good (Townsfolk + Outsiders) and Evil (Minions + Demon). Each night, the Demon kills a player. Each day, the town nominates and votes to execute a suspected Evil player. Good wins if the Demon is executed. Evil wins if the Demon survives until only 2 players remain alive.

A human **Storyteller** acts as game master: they run the night phase, resolve ambiguous interactions, provide misleading information within the rules, and have override authority over all game events.

This PRD covers a complete digital implementation of the **Trouble Brewing** script — the official introductory character set of 14 roles — playable in a browser, real-time, across multiple devices.

---

## 2. Tech Stack

| Layer | Choice |
|---|---|
| Frontend | React + TypeScript |
| Backend | Node.js + TypeScript |
| Real-time | WebSockets (Socket.io) |
| State (server) | Single authoritative game state machine |
| State (client) | Zustand |
| Database | SQLite (dev), Postgres (prod) — game log persistence |
| Testing | Vitest (unit), Playwright (e2e) |
| Styling | Tailwind CSS |

---

## 3. Hard Architectural Constraints

These constraints must be established in Milestone 1 and never violated by later features.

**3.1 Single State Machine**  
All game state mutations — role assignments, deaths, phase transitions, ability triggers — must pass through a single server-side state machine (`src/server/gameStateMachine.ts`). The client is read-only. It receives state diffs over WebSocket and renders them. It never mutates game state directly.

**3.2 The Poison/Drunk Layer (Critical)**  
The Poisoner and the Drunk interact with other abilities at the *information layer*, not the execution layer. This means:
- A Drunk player believes they have their stated role. Their ability fires in the night queue as normal. But the *result* it produces is corrupted — false information is returned to them or to the Storyteller instead of true information.
- A Poisoned player's ability also fires in the night queue as normal, but produces corrupted results for that night only.
- The corruption flag must be a property on the ability execution context, not on the role itself. Abilities must check `context.isPoisoned` and `context.isDrunk` before resolving their output.
- The Drunk never knows they are the Drunk. Their role card shows their apparent role. The Storyteller sees their true role (Drunk) and their apparent role.

This layer must be built into the ability execution context from Milestone 3 onward. It cannot be retrofitted.

**3.3 Night Order is Data, Not Code**  
The official BotC night order must be defined as a static data file (`src/data/nightOrder.ts`), not hardcoded in logic. Night 1 order and subsequent night order are separate arrays. The night queue is generated from this data at runtime, filtered to roles present in the current game.

**3.4 Storyteller Override**  
The Storyteller can override any game event before it is committed. The state machine must expose override hooks at every phase transition and ability resolution step. The Storyteller's action always takes precedence over automated logic.

**3.5 Reversibility**  
All Storyteller actions within a night phase are reversible until the Storyteller confirms "End Night." After End Night is confirmed, the night's changes are committed to the game log and become permanent.

**3.6 Role File Structure**  
Each role is implemented as a self-contained module in `src/roles/[roleName].ts`. Each module exports: role metadata (name, team, type), night order position, and an ability handler function. No role file may import from another role file. Cross-role interactions are handled by the state machine.

---

## 4. Non-Goals (v1)

- Custom scripts (non-Trouble Brewing characters)
- Mobile native app
- Spectator mode
- Replay from saved game log (log is written but playback UI is out of scope)
- AI Storyteller
- Account system / persistent profiles
- Voice or video integration
- Localization

---

## 5. Roles — Trouble Brewing

### 5.1 Role Distribution Table

| Players | Townsfolk | Outsiders | Minions | Demon |
|---|---|---|---|---|
| 5 | 3 | 0 | 1 | 1 |
| 6 | 3 | 1 | 1 | 1 |
| 7 | 5 | 0 | 1 | 1 |
| 8 | 5 | 1 | 1 | 1 |
| 9 | 5 | 2 | 1 | 1 |
| 10 | 7 | 0 | 2 | 1 |
| 11 | 7 | 1 | 2 | 1 |
| 12 | 7 | 2 | 2 | 1 |
| 13 | 9 | 0 | 3 | 1 |
| 14 | 9 | 1 | 3 | 1 |
| 15 | 9 | 2 | 3 | 1 |

### 5.2 Townsfolk (9 roles)

**Washerwoman**  
On night 1 only: learns that one of two specific players is a particular Townsfolk role. The Storyteller chooses which two players to show and which role to reveal. One must actually be that role; the other is a red herring (any player, any role). If the target Townsfolk is the Drunk, the Washerwoman may receive false information.

**Librarian**  
On night 1 only: learns that one of two specific players is a particular Outsider role. Same mechanic as Washerwoman. If no Outsiders are in the game, the Librarian learns "no Outsiders." If poisoned/drunk, may receive false information.

**Investigator**  
On night 1 only: learns that one of two specific players is a particular Minion role. Same mechanic. If poisoned/drunk, may receive false information.

**Chef**  
On night 1 only: learns the number of pairs of Evil players sitting adjacent to each other (counting around the circle). If poisoned/drunk, may receive a false number.

**Empath**  
Each night: learns how many of their two living neighbors are Evil. If poisoned/drunk, may receive a false number. If a neighbor dies, the next living neighbor in that direction becomes the relevant neighbor.

**Fortune Teller**  
Each night: chooses any two players and learns yes/no whether either is the Demon. One Good player is secretly designated as the Fortune Teller's "red herring" — a player who always returns a "yes" result as if they were the Demon. If poisoned/drunk, may receive false information. The red herring is assigned by the Storyteller at game start and does not change.

**Undertaker**  
Each night (after the first): if a player was executed the previous day, the Undertaker learns that player's true role. If poisoned/drunk, may receive false information. If no execution occurred, the Undertaker learns nothing.

**Monk**  
Each night (not the first): chooses a player other than themselves. That player is protected from the Demon's kill that night. The Demon's kill has no effect if they choose the Monk-protected player. The Monk cannot protect themselves.

**Ravenkeeper**  
Passive ability: if the Ravenkeeper is killed by the Demon at night, they wake immediately and choose any player. They learn that player's true role. This triggers instead of the Demon kill resolving silently. If poisoned when killed, they may receive false role information.

**Virgin**  
One-time passive ability: the first time the Virgin is nominated, if the nominator is a Townsfolk, that Townsfolk is immediately executed (before a vote occurs). After this triggers once (successfully or not), the Virgin's ability is spent. If poisoned when nominated, the ability does not trigger.

**Slayer**  
One-time active ability: once per game, during the day phase, the Slayer may publicly declare they are using their ability and choose a target. If the target is the Demon, the target dies immediately. If not, nothing happens. The ability is spent regardless of outcome.

**Soldier**  
Passive ability: the Soldier cannot be killed by the Demon at night. The Demon's kill has no effect on the Soldier. If the Soldier is poisoned, they lose this protection.

**Mayor**  
Two passive abilities: (1) if only 3 players are alive and no execution occurs that day, Good wins. (2) if the Mayor is killed by the Demon at night, the Storyteller may redirect the kill to another player instead (Storyteller's discretion). If the Mayor is poisoned, neither ability applies.

### 5.3 Outsiders (4 roles)

**Butler**  
Each night: chooses a master (any player other than themselves). The following day, the Butler may only vote if their chosen master is also voting on the same nomination. The Butler's vote token is locked until the master votes or the nomination closes. If poisoned/drunk, the Butler may vote freely (the constraint is lifted).

**Drunk**  
The Drunk believes they are a Townsfolk role chosen by the Storyteller. Their role card shows the apparent Townsfolk role. In reality, they have no ability — or more precisely, their apparent ability fires but always produces corrupted output (false information, ineffective protection, etc.). The Drunk is never told they are the Drunk. The Storyteller always knows. The Drunk's apparent role must be a Townsfolk role that is not already in the game.

**Recluse**  
Passive ability: the Recluse may register as Evil or as a Minion role to detection abilities, at the Storyteller's discretion. This means: Fortune Teller may get "yes" when checking the Recluse, Investigator may be shown the Recluse as a Minion, Empath may count the Recluse as Evil, etc. The Storyteller decides case-by-case. The Recluse is actually Good and is on the Good team for win conditions.

**Saint**  
Passive ability: if the Saint is executed by the town (voted out), Good loses immediately. This triggers at the moment of execution, before any other end-of-day checks. If the Saint is poisoned, this ability does not trigger (execution proceeds normally).

### 5.4 Minions (4 roles)

**Poisoner**  
Each night (including the first): chooses any player. That player is poisoned for the remainder of that night and the following day. Poisoning expires at the start of the next night. Poisoning causes the target's ability to produce false or ineffective results. The Poisoner's identity is known to the Demon on night 1.

**Spy**  
Passive ability: the Spy may see the full Grimoire (all role assignments, alive/dead status, poison status, drunk status) at any time, as shown by the Storyteller. Additionally, the Spy may register as Good or as a Townsfolk/Outsider role to detection abilities, at the Storyteller's discretion — the inverse of the Recluse. The Spy is on the Evil team for win conditions. The Spy's identity is known to the Demon on night 1.

**Scarlet Woman**  
Passive ability: if the Demon dies and there are 5 or more players still alive at the moment of death, the Scarlet Woman immediately becomes the new Demon (their role changes to Imp). The original Demon's death is announced as normal; the Scarlet Woman's transformation is secret and only the Storyteller knows. This triggers on any Demon death — execution or otherwise. If the Scarlet Woman is poisoned when the Demon dies, this ability does not trigger.

**Baron**  
Setup ability (fires once at game start, not during play): adds 2 Outsiders to the game. This means the role distribution is adjusted: 2 Townsfolk are replaced by 2 Outsiders. The Baron's ability is applied during role assignment before the game begins. The Baron has no night ability.

### 5.5 Demon (1 role)

**Imp**  
Each night (not the first): chooses a player to kill. That player dies at dawn. If the Imp chooses themselves, they die and a Minion of the Storyteller's choice becomes the new Imp (star-pass). The new Imp wakes on subsequent nights as the Imp. The original Imp's role card changes to a dead Minion. The Imp learns which players are Minions on night 1 (and Minions learn the Demon's identity). If the Monk has protected the Imp's target, the kill has no effect. If the Soldier is targeted, the kill has no effect. If the Mayor is targeted, the Storyteller may redirect the kill.

---

## 6. Game Phases

### 6.1 Lobby Phase
- Host creates a game, receives a unique 6-character join code
- Players join using the join code and choose a display name
- Host (who is also the Storyteller) sees all connected players
- Host sets player count and selects which roles to include (defaults to recommended Trouble Brewing distribution)
- Host starts the game when ready

### 6.2 Setup Phase (Night 0)
- Server assigns roles according to distribution table
- Baron adjustment applied if Baron is in the game
- Drunk's apparent role assigned (a Townsfolk not otherwise in the game)
- Fortune Teller's red herring assigned
- Minions learn each other and the Demon's identity
- Demon learns the Minions' identities and 3 not-in-play Townsfolk (bluff roles)
- Storyteller's Grimoire is fully populated
- Players receive their role card (private, visible only to them)

### 6.3 Day Phase
Each day cycle has these sub-phases in order:

**Dawn announcement:** deaths from the previous night are announced publicly (by player name, not role). The Ravenkeeper's revelation (if triggered) is announced here.

**Discussion:** open discussion period. Duration is not enforced by the system — the Storyteller ends discussion manually.

**Nomination window:** any living player may nominate any other living player. A player may only nominate once per day. A player may only be nominated once per day. The Storyteller may open and close the nomination window.

**Vote:** each nomination triggers a vote immediately. Living players may vote by raising their hand (clicking vote). Dead players have exactly one ghost vote for the entire game — once used, they may never vote again. The Butler's vote constraint applies. Votes are public and simultaneous (all players lock in their vote before results are shown, then revealed at once). A nomination passes if the vote count exceeds half of all living players (rounded up). If the vote count ties with a previous nomination's count, neither executes (the higher count executes; ties go to no execution).

**Execution:** the player with the highest passing vote count is executed. Ties with the same count result in no execution. Saint ability checked at execution. Mayor ability (3 alive, no execution) checked at end of day if no execution occurred.

**End of Day:** Storyteller closes the day. Night phase begins.

### 6.4 Night Phase
Sub-phases in order:

**Night queue generation:** server generates the ordered list of roles that act this night, based on official night order, filtered to roles present in the current game and alive (or with relevant passive abilities).

**Night 1 queue:** Minion info, Demon info, Poisoner, Spy, Washerwoman, Librarian, Investigator, Chef, Empath, Fortune Teller, Butler, [any other Night 1 roles in order].

**Night 2+ queue:** Poisoner, Monk, Spy, Imp, Ravenkeeper (if triggered), Empath, Fortune Teller, Undertaker, Butler.

**Storyteller prompt:** for each role in the queue, the Storyteller's dashboard shows the current role's prompt and all relevant information. The Storyteller performs the action (makes the player wake, receives their choice, confirms the result) and advances the queue manually.

**Dawn:** Storyteller confirms End Night. All deaths and effects are committed. Dawn announcement fires.

---

## 7. Win Conditions

Checked in this priority order:

1. **Saint executed:** Good loses immediately at the moment of execution (before any other checks). Applies only if Saint is not poisoned.
2. **Demon executed:** Good wins at the moment of execution.
3. **Scarlet Woman trigger:** if Demon is executed and Scarlet Woman ability triggers (5+ alive, not poisoned), the Scarlet Woman becomes Imp. Good does not win. Game continues.
4. **Mayor win (day end):** if 3 players are alive, no execution occurred, and the Mayor is alive and not poisoned, Good wins.
5. **Evil win (dawn):** if only 2 players remain alive at dawn (after night kills are applied), Evil wins.

Win condition checks run server-side immediately when the triggering event occurs. The game transitions to an end state, reveals all roles, and announces the winning team.

---

## 8. The Grimoire

The Storyteller's private dashboard. Contains:

- Every player's true role
- Every player's apparent role (relevant for Drunk)
- Every player's alive/dead status
- Every player's poison status (current night only)
- The Drunk's apparent role
- The Fortune Teller's red herring player
- The Scarlet Woman's current status (triggered or not)
- Ghost vote tracking (which dead players have used their vote)
- The current night queue and position
- Notes field (free text, Storyteller only)

The Grimoire is never visible to players. The Spy may view it (Storyteller shows them a screenshot or the Storyteller reveals it through the night phase prompt).

---

## 9. Deliverables — Done When

A full Trouble Brewing game with 7 players must be completable start to finish with:

- [ ] All 14 Trouble Brewing roles available and correctly distributed
- [ ] Lobby creation, join code, and player joining all work in real time
- [ ] Role assignment respects distribution table and Baron adjustment
- [ ] Night 0 setup (Minion/Demon info, Drunk assignment, red herring) fires correctly
- [ ] Night queue fires in correct official order for Night 1 and Night 2+
- [ ] Every Townsfolk ability produces correct output (or correctly corrupted output when poisoned/drunk)
- [ ] Every Outsider passive applies correctly (Butler vote lock, Recluse registration, Saint execution, Drunk corruption)
- [ ] Every Minion ability applies correctly (Poisoner poison, Spy Grimoire, Scarlet Woman trigger, Baron setup)
- [ ] Imp kill, self-kill (star-pass), and Monk/Soldier protection all resolve correctly
- [ ] All win conditions fire correctly and at the right moment
- [ ] Storyteller can override any night action before confirming End Night
- [ ] Ghost votes are tracked and enforced for dead players
- [ ] Butler vote constraint is enforced during nominations
- [ ] All Playwright e2e tests pass on a scripted 7-player game
- [ ] No game state mutation occurs on the client side — all state comes from the server

---

## 10. Known Interaction Edge Cases

The following interactions are explicitly called out because they are likely to cause bugs if not planned for:

**Drunk + Detection Abilities**  
The Drunk's apparent ability fires, but the Storyteller provides false information. The system must support the Storyteller manually entering false information for the Drunk's night result, rather than auto-computing it. The Drunk's night prompt must flag to the Storyteller that this player is the Drunk.

**Poisoner Timing**  
Poison applies from the moment the Poisoner acts in the night queue and lasts until the Poisoner acts again the following night. A player poisoned on Night 2 is poisoned for all of Night 2 (including abilities that fire after the Poisoner in the queue) and all of Day 2. They are no longer poisoned when Night 3 begins, unless the Poisoner targets them again.

**Recluse + Investigator**  
The Investigator ability shows one of two players as a specific Minion role. The Recluse may be shown as that Minion role (Storyteller's choice), even though the Recluse is actually Good. The system must allow the Storyteller to manually select the shown Minion role when the Recluse is one of the two presented players.

**Scarlet Woman Timing**  
The Scarlet Woman trigger checks alive player count at the exact moment the Demon dies. If the Demon is executed and the vote kills them, and there are exactly 5 living players including the Demon before execution, after execution there are 4 — but the check is at the moment of death, so 5 counts. The system must check alive count before applying the death.

**Virgin + Townsfolk Nominator**  
The Virgin ability triggers when the first nominator is a Townsfolk. The Drunk nominates as their apparent Townsfolk role — so the Drunk's nomination counts as Townsfolk for the purpose of the Virgin ability. If the Drunk nominates the Virgin, the ability triggers and the Drunk is executed. The system must use the apparent role (not the true role) for the Virgin check. If the Virgin is poisoned, the ability does not trigger regardless.

**Mayor Kill Redirect**  
If the Imp targets the Mayor and the Storyteller chooses to redirect the kill, the redirect target must be chosen and confirmed before dawn. The redirect is at Storyteller discretion — the system must present the redirect option and allow the Storyteller to choose any living player (or confirm no redirect). The Mayor does not die. The redirected player dies at dawn instead.

**Imp Star-Pass**  
When the Imp targets themselves, they die and a living Minion becomes the new Imp. The Storyteller chooses which Minion if multiple Minions are alive. The new Imp's role in the Grimoire updates to Imp. The dead Imp's role in the Grimoire updates to their original Minion role. The new Imp wakes as Imp on all future nights. The Scarlet Woman does not trigger on a star-pass death (the Demon line continues through the new Imp).

**Butler Vote Edge Case**  
The Butler's master may die before a given day's vote. If the master is dead, the Butler has no constraint — they may vote freely. The system must check master alive status at vote time, not at the start of day.

**Empath with Dead Neighbors**  
As players die, the Empath's relevant neighbors shift to the next living player in each direction. The system must compute the Empath's current living neighbors dynamically each night based on the current alive state, not at game start.

**Fortune Teller Red Herring**  
The red herring is assigned once at game start and never changes, even if the red herring player dies. A dead red herring still returns "yes" if the Fortune Teller checks them (unless the Fortune Teller is poisoned/drunk).
