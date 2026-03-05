import type { GameState, Player, Phase, DaySubPhase, RoleId, Nomination, NightQueueEntry, NightPromptInfo, StorytellerOverride, GrimoireData } from '../types/game.js';
import type { AbilityContext, AbilityResult } from '../types/ability.js';
import { assignRoles as computeRoleAssignments } from './roleDistribution.js';
import { NIGHT_1_ORDER, NIGHT_OTHER_ORDER } from '../data/nightOrder.js';
import { ROLE_MAP } from '../data/roles.js';

export function createInitialGameState(id: string, joinCode: string, storytellerId: string, hostSecret?: string): GameState {
  return {
    id,
    joinCode,
    phase: 'lobby',
    daySubPhase: null,
    dayNumber: 0,
    players: [],
    storytellerId,
    nominations: [],
    activeNominationIndex: null,
    nightQueue: [],
    nightQueuePosition: 0,
    executedPlayerId: null,
    monkProtectedPlayerId: null,
    fortuneTellerRedHerringId: null,
    demonBluffRoles: [],
    slayerAbilityUsed: false,
    virginAbilityUsed: false,
    pendingDeaths: [],
    gameLog: [],
    winner: null,
    hostSecret: hostSecret ?? '',
    storytellerNotes: '',
    createdAt: Date.now(),
  };
}

export function addPlayer(state: GameState, player: Player): GameState {
  return {
    ...state,
    players: [...state.players, player],
  };
}

export function removePlayer(state: GameState, playerId: string): GameState {
  return {
    ...state,
    players: state.players.filter((p) => p.id !== playerId),
  };
}

export function transitionPhase(state: GameState, phase: Phase): GameState {
  return {
    ...state,
    phase,
    gameLog: [
      ...state.gameLog,
      { timestamp: Date.now(), type: 'phase_transition', data: { phase } },
    ],
  };
}

export function assignRole(state: GameState, playerId: string, trueRole: RoleId, apparentRole: RoleId): GameState {
  return {
    ...state,
    players: state.players.map((p) =>
      p.id === playerId ? { ...p, trueRole, apparentRole } : p
    ),
  };
}

export function killPlayer(state: GameState, playerId: string): GameState {
  return {
    ...state,
    players: state.players.map((p) =>
      p.id === playerId ? { ...p, isAlive: false } : p
    ),
    gameLog: [
      ...state.gameLog,
      { timestamp: Date.now(), type: 'player_death', data: { playerId } },
    ],
  };
}

export function poisonPlayer(state: GameState, playerId: string): GameState {
  return {
    ...state,
    players: state.players.map((p) =>
      p.id === playerId ? { ...p, isPoisoned: true } : p
    ),
  };
}

export function clearPoison(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map((p) => ({ ...p, isPoisoned: false })),
  };
}

export function checkWinConditions(state: GameState): GameState {
  const alivePlayers = state.players.filter((p) => p.isAlive);
  const aliveDemons = alivePlayers.filter((p) => p.trueRole === 'imp');

  // Evil wins if only 2 players remain alive
  if (alivePlayers.length <= 2 && aliveDemons.length > 0) {
    return { ...state, winner: 'evil', phase: 'ended' };
  }

  // Good wins if no demons alive
  if (aliveDemons.length === 0 && state.phase !== 'lobby' && state.phase !== 'setup') {
    return { ...state, winner: 'good', phase: 'ended' };
  }

  return state;
}

export function checkMayorWin(state: GameState): GameState {
  if (state.executedPlayerId !== null) return state;
  const alivePlayers = state.players.filter((p) => p.isAlive);
  if (alivePlayers.length !== 3) return state;
  const mayor = alivePlayers.find((p) => p.trueRole === 'mayor');
  if (!mayor || mayor.isPoisoned) return state;
  return { ...state, winner: 'good', phase: 'ended' };
}

export function setStoryteller(state: GameState, storytellerId: string): GameState {
  return {
    ...state,
    storytellerId,
  };
}

export function setFortuneTellerRedHerring(state: GameState, playerId: string | null): GameState {
  return {
    ...state,
    fortuneTellerRedHerringId: playerId,
  };
}

export function assignAllRoles(state: GameState): GameState {
  const playerIds = state.players.map((p) => p.id);
  const result = computeRoleAssignments(playerIds);

  let newState: GameState = {
    ...state,
    players: state.players.map((p) => {
      const assignment = result.assignments.find((a) => a.playerId === p.id);
      if (!assignment) return p;
      return {
        ...p,
        trueRole: assignment.role,
        apparentRole: assignment.apparentRole,
        isDrunk: assignment.role === 'drunk',
      };
    }),
  };

  if (result.fortuneTellerRedHerringId) {
    newState = setFortuneTellerRedHerring(newState, result.fortuneTellerRedHerringId);
  }

  if (result.bluffRoles.length > 0) {
    newState = { ...newState, demonBluffRoles: result.bluffRoles };
  }

  return newState;
}

export function addPendingDeath(state: GameState, playerId: string): GameState {
  if (state.pendingDeaths.includes(playerId)) return state;
  return {
    ...state,
    pendingDeaths: [...state.pendingDeaths, playerId],
  };
}

export function resolveDawnDeaths(state: GameState): GameState {
  let newState = { ...state };
  for (const playerId of state.pendingDeaths) {
    newState = killPlayer(newState, playerId);
  }
  return {
    ...newState,
    pendingDeaths: [],
    phase: 'day' as Phase,
    daySubPhase: 'dawn' as DaySubPhase,
    dayNumber: state.dayNumber + 1,
  };
}

export function transitionDaySubPhase(state: GameState, subPhase: DaySubPhase): GameState {
  return {
    ...state,
    daySubPhase: subPhase,
    gameLog: [
      ...state.gameLog,
      { timestamp: Date.now(), type: 'day_sub_phase_transition', data: { subPhase } },
    ],
  };
}

export function addNomination(state: GameState, nominatorId: string, nomineeId: string): GameState {
  const nomination: Nomination = {
    nominatorId,
    nomineeId,
    votes: [],
    votesSubmitted: [],
    voteCount: 0,
    passed: false,
  };
  return {
    ...state,
    nominations: [...state.nominations, nomination],
    gameLog: [
      ...state.gameLog,
      { timestamp: Date.now(), type: 'nomination', data: { nominatorId, nomineeId } },
    ],
  };
}

export function clearNominations(state: GameState): GameState {
  return {
    ...state,
    nominations: [],
    activeNominationIndex: null,
  };
}

export function startVote(state: GameState, nominationIndex: number): GameState {
  return {
    ...state,
    activeNominationIndex: nominationIndex,
    daySubPhase: 'vote' as DaySubPhase,
    gameLog: [
      ...state.gameLog,
      { timestamp: Date.now(), type: 'vote_started', data: { nominationIndex } },
    ],
  };
}

export function recordVote(state: GameState, nominationIndex: number, playerId: string, vote: boolean): GameState {
  const nomination = state.nominations[nominationIndex];
  if (!nomination) return state;

  // Don't allow double submission
  if (nomination.votesSubmitted.includes(playerId)) return state;

  const player = state.players.find((p) => p.id === playerId);
  if (!player) return state;

  // Handle ghost vote for dead players
  let updatedPlayers = state.players;
  if (!player.isAlive && vote) {
    if (player.ghostVoteUsed) return state;
    updatedPlayers = state.players.map((p) =>
      p.id === playerId ? { ...p, ghostVoteUsed: true, hasGhostVote: false } : p
    );
  }

  const updatedNomination: Nomination = {
    ...nomination,
    votes: vote ? [...nomination.votes, playerId] : nomination.votes,
    votesSubmitted: [...nomination.votesSubmitted, playerId],
  };

  const updatedNominations = state.nominations.map((n, i) =>
    i === nominationIndex ? updatedNomination : n
  );

  return {
    ...state,
    nominations: updatedNominations,
    players: updatedPlayers,
  };
}

export function resolveVote(state: GameState, nominationIndex: number): GameState {
  const nomination = state.nominations[nominationIndex];
  if (!nomination) return state;

  const livingCount = state.players.filter((p) => p.isAlive).length;
  const threshold = Math.ceil(livingCount / 2);
  const voteCount = nomination.votes.length;
  const passed = voteCount >= threshold;

  const resolvedNomination: Nomination = {
    ...nomination,
    voteCount,
    passed,
  };

  const updatedNominations = state.nominations.map((n, i) =>
    i === nominationIndex ? resolvedNomination : n
  );

  return {
    ...state,
    nominations: updatedNominations,
    activeNominationIndex: null,
    daySubPhase: 'nomination' as DaySubPhase,
    gameLog: [
      ...state.gameLog,
      { timestamp: Date.now(), type: 'vote_resolved', data: { nominationIndex, voteCount, passed, threshold } },
    ],
  };
}

export function resolveExecution(state: GameState): GameState {
  // Find all passing nominations
  const passingNominations = state.nominations.filter((n) => n.passed);

  if (passingNominations.length === 0) {
    // No nominations passed -- no execution
    return {
      ...state,
      executedPlayerId: null,
      gameLog: [
        ...state.gameLog,
        { timestamp: Date.now(), type: 'no_execution', data: {} },
      ],
    };
  }

  // Find highest vote count among passing nominations
  const maxVoteCount = Math.max(...passingNominations.map((n) => n.voteCount));
  const topNominations = passingNominations.filter((n) => n.voteCount === maxVoteCount);

  if (topNominations.length > 1) {
    // Tie -- no execution
    return {
      ...state,
      executedPlayerId: null,
      gameLog: [
        ...state.gameLog,
        { timestamp: Date.now(), type: 'execution_tie', data: { voteCount: maxVoteCount } },
      ],
    };
  }

  // Execute the player with the highest passing vote count
  const executedNomination = topNominations[0];
  const executedPlayerId = executedNomination.nomineeId;
  const executedPlayer = state.players.find((p) => p.id === executedPlayerId);

  let newState = killPlayer(state, executedPlayerId);
  newState = {
    ...newState,
    executedPlayerId,
    gameLog: [
      ...newState.gameLog,
      { timestamp: Date.now(), type: 'execution', data: { playerId: executedPlayerId, voteCount: maxVoteCount } },
    ],
  };

  // Check win conditions: Saint executed (Good loses), Demon executed (Good wins)
  if (executedPlayer) {
    // Saint execution: if Saint is not poisoned, Good loses immediately
    if (executedPlayer.trueRole === 'saint' && !executedPlayer.isPoisoned) {
      return { ...newState, winner: 'evil', phase: 'ended' };
    }

    // Demon execution: Good wins (Scarlet Woman trigger will be handled in a later feature)
    if (executedPlayer.trueRole === 'imp') {
      // Check for Scarlet Woman trigger: 5+ alive (before death), SW alive and not poisoned
      const aliveBeforeDeath = state.players.filter((p) => p.isAlive).length;
      const scarletWoman = state.players.find(
        (p) => p.trueRole === 'scarletWoman' && p.isAlive && !p.isPoisoned
      );
      if (scarletWoman && aliveBeforeDeath >= 5) {
        // Scarlet Woman becomes the new Imp -- game continues
        newState = {
          ...newState,
          players: newState.players.map((p) =>
            p.id === scarletWoman.id ? { ...p, trueRole: 'imp' as const } : p
          ),
          gameLog: [
            ...newState.gameLog,
            { timestamp: Date.now(), type: 'scarlet_woman_trigger', data: { playerId: scarletWoman.id } },
          ],
        };
        return newState;
      }
      return { ...newState, winner: 'good', phase: 'ended' };
    }
  }

  // Run general win condition checks (e.g., 2 players left)
  newState = checkWinConditions(newState);

  return newState;
}

export function generateNightQueue(state: GameState): NightQueueEntry[] {
  const nightNumber = state.dayNumber + 1; // Night follows the current day
  const order = nightNumber === 1 ? NIGHT_1_ORDER : NIGHT_OTHER_ORDER;

  return order
    .map((roleId) => {
      // Find an alive player with this role.
      // The Drunk's apparent ability fires as their apparentRole,
      // so match both trueRole and apparentRole (for Drunk players).
      const player = state.players.find(
        (p) => p.isAlive && (p.trueRole === roleId || (p.isDrunk && p.apparentRole === roleId))
      );
      if (!player) return null;
      return {
        roleId,
        playerId: player.id,
        completed: false,
      };
    })
    .filter((entry): entry is NightQueueEntry => entry !== null);
}

export function transitionToNight(state: GameState): GameState {
  const nightQueue = generateNightQueue(state);
  // Clear all poison at the start of each night — Poisoner will re-apply if alive
  const playersWithPoisonCleared = state.players.map((p) =>
    p.isPoisoned ? { ...p, isPoisoned: false } : p
  );
  return {
    ...state,
    players: playersWithPoisonCleared,
    phase: 'night' as Phase,
    daySubPhase: null,
    nominations: [],
    activeNominationIndex: null,
    executedPlayerId: null,
    nightQueue,
    nightQueuePosition: 0,
    monkProtectedPlayerId: null,
    gameLog: [
      ...state.gameLog,
      { timestamp: Date.now(), type: 'phase_transition', data: { phase: 'night' } },
    ],
  };
}

export function applyStorytellerOverride(
  state: GameState,
  override: StorytellerOverride
): GameState {
  let newState = state;

  switch (override.type) {
    case 'kill_player': {
      if (!override.playerId) return state;
      newState = killPlayer(state, override.playerId);
      break;
    }
    case 'revive_player': {
      if (!override.playerId) return state;
      newState = {
        ...state,
        players: state.players.map((p) =>
          p.id === override.playerId ? { ...p, isAlive: true } : p
        ),
      };
      break;
    }
    case 'set_poison': {
      if (!override.playerId) return state;
      newState = poisonPlayer(state, override.playerId);
      break;
    }
    case 'clear_poison': {
      if (!override.playerId) return state;
      newState = {
        ...state,
        players: state.players.map((p) =>
          p.id === override.playerId ? { ...p, isPoisoned: false } : p
        ),
      };
      break;
    }
    case 'add_pending_death': {
      if (!override.playerId) return state;
      newState = addPendingDeath(state, override.playerId);
      break;
    }
    case 'remove_pending_death': {
      if (!override.playerId) return state;
      newState = {
        ...state,
        pendingDeaths: state.pendingDeaths.filter((id) => id !== override.playerId),
      };
      break;
    }
    case 'modify_night_action': {
      if (override.queuePosition === undefined) return state;
      const pos = override.queuePosition;
      if (pos < 0 || pos >= state.nightQueue.length) return state;
      newState = {
        ...state,
        nightQueue: state.nightQueue.map((entry, i) =>
          i === pos ? { ...entry, storytellerInput: override.storytellerInput } : entry
        ),
      };
      break;
    }
    case 'set_player_role': {
      if (!override.playerId || !override.roleId) return state;
      newState = {
        ...state,
        players: state.players.map((p) =>
          p.id === override.playerId
            ? {
                ...p,
                trueRole: override.roleId!,
                apparentRole: override.apparentRole ?? override.roleId!,
              }
            : p
        ),
      };
      break;
    }
    default:
      return state;
  }

  return {
    ...newState,
    gameLog: [
      ...newState.gameLog,
      {
        timestamp: Date.now(),
        type: 'storyteller_override',
        data: {
          overrideType: override.type,
          playerId: override.playerId,
          queuePosition: override.queuePosition,
        },
      },
    ],
  };
}

export function buildAbilityContext(state: GameState, playerId: string, nightNumber: number): AbilityContext {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }

  // isPoisoned: set if the player has the isPoisoned flag on their state
  // (set by the Poisoner's night action via poisonPlayer())
  const isPoisoned = player.isPoisoned;

  // isDrunk: set if the player's true role is 'drunk'
  const isDrunk = player.isDrunk;

  return {
    gameState: state,
    player,
    isPoisoned,
    isDrunk,
    nightNumber,
  };
}

export function buildGrimoireData(state: GameState): GrimoireData {
  return {
    players: state.players.map((p) => {
      const trueMeta = ROLE_MAP.get(p.trueRole);
      const apparentMeta = ROLE_MAP.get(p.apparentRole);
      return {
        playerId: p.id,
        playerName: p.name,
        trueRole: trueMeta ? { id: trueMeta.id, name: trueMeta.name, team: trueMeta.team, ability: trueMeta.ability } : null,
        apparentRole: apparentMeta ? { id: apparentMeta.id, name: apparentMeta.name, team: apparentMeta.team, ability: apparentMeta.ability } : null,
        isAlive: p.isAlive,
        isPoisoned: p.isPoisoned,
        isDrunk: p.isDrunk,
      };
    }),
    fortuneTellerRedHerringId: state.fortuneTellerRedHerringId,
  };
}

export function getNightPromptInfo(state: GameState): NightPromptInfo | null {
  const { nightQueue, nightQueuePosition } = state;
  if (nightQueuePosition >= nightQueue.length) return null;

  const entry = nightQueue[nightQueuePosition];
  if (!entry || entry.completed) return null;

  const player = state.players.find((p) => p.id === entry.playerId);
  if (!player) return null;

  const roleMeta = ROLE_MAP.get(entry.roleId);
  if (!roleMeta) return null;

  const promptType = getRolePromptType(entry.roleId);
  let promptDescription = getRolePromptDescription(entry.roleId, player.name);

  // Flag to the Storyteller that this player is the Drunk
  if (player.isDrunk) {
    promptDescription += ` ⚠ THIS PLAYER IS THE DRUNK — provide false information.`;
  }

  const prompt: NightPromptInfo = {
    queuePosition: nightQueuePosition,
    totalInQueue: nightQueue.length,
    roleId: entry.roleId,
    roleName: roleMeta.name,
    ability: roleMeta.ability,
    playerId: player.id,
    playerName: player.name,
    isDrunk: player.isDrunk,
    isPoisoned: player.isPoisoned,
    promptType,
    promptDescription,
  };

  // Include grimoire data for the Spy's night prompt
  if (entry.roleId === 'spy') {
    prompt.grimoireData = buildGrimoireData(state);
  }

  // Include execution info for the Undertaker's night prompt
  if (entry.roleId === 'undertaker') {
    const executionLog = [...state.gameLog].reverse().find((log) => log.type === 'execution' || log.type === 'no_execution' || log.type === 'execution_tie');
    if (executionLog && executionLog.type === 'execution') {
      const execData = executionLog.data as { playerId: string };
      const executedPlayer = state.players.find((p) => p.id === execData.playerId);
      if (executedPlayer) {
        const executedRoleMeta = ROLE_MAP.get(executedPlayer.trueRole);
        prompt.executedPlayerInfo = {
          playerId: executedPlayer.id,
          playerName: executedPlayer.name,
          trueRole: executedRoleMeta?.id || executedPlayer.trueRole,
        };
      }
    }
  }

  return prompt;
}

function getRolePromptType(roleId: RoleId): NightPromptInfo['promptType'] {
  switch (roleId) {
    case 'poisoner':
    case 'monk':
    case 'butler':
    case 'imp':
      return 'choose_player';
    case 'fortuneTeller':
      return 'choose_two_players';
    case 'chef':
    case 'empath':
      return 'provide_number';
    case 'washerwoman':
    case 'librarian':
    case 'investigator':
      return 'choose_players_and_role';
    case 'undertaker':
      return 'provide_role';
    case 'spy':
    case 'ravenkeeper':
    default:
      return 'info_only';
  }
}

function getRolePromptDescription(roleId: RoleId, playerName: string): string {
  switch (roleId) {
    case 'poisoner':
      return `Choose a player for ${playerName} (Poisoner) to poison tonight.`;
    case 'spy':
      return `${playerName} (Spy) may see the Grimoire. Show them the Grimoire info below. The Spy may register as Good or as a Townsfolk/Outsider to detection abilities.`;
    case 'washerwoman':
      return `Choose 2 players and a Townsfolk role to show ${playerName} (Washerwoman).`;
    case 'librarian':
      return `Choose 2 players and an Outsider role to show ${playerName} (Librarian), or indicate no Outsiders.`;
    case 'investigator':
      return `Choose 2 players and a Minion role to show ${playerName} (Investigator).`;
    case 'chef':
      return `Provide the number of evil pairs to show ${playerName} (Chef).`;
    case 'empath':
      return `Provide the number of evil alive neighbours to show ${playerName} (Empath).`;
    case 'fortuneTeller':
      return `${playerName} (Fortune Teller) chooses 2 players. Indicate if either is the Demon (or red herring).`;
    case 'undertaker':
      return `Show ${playerName} (Undertaker) the role of the player executed today, or indicate no execution.`;
    case 'monk':
      return `Choose a player for ${playerName} (Monk) to protect from the Demon tonight.`;
    case 'imp':
      return `Choose a player for ${playerName} (Imp) to kill tonight.`;
    case 'ravenkeeper':
      return `${playerName} (Ravenkeeper) chooses a player to learn their role. (Only if killed tonight.)`;
    case 'butler':
      return `Choose a player for ${playerName} (Butler) to select as their master.`;
    default:
      return `Resolve ${playerName}'s ability.`;
  }
}

export function advanceNightQueue(state: GameState, storytellerInput?: unknown): GameState {
  const { nightQueue, nightQueuePosition } = state;
  if (nightQueuePosition >= nightQueue.length) return state;

  const updatedQueue = nightQueue.map((entry, i) =>
    i === nightQueuePosition
      ? { ...entry, completed: true, storytellerInput }
      : entry
  );

  return {
    ...state,
    nightQueue: updatedQueue,
    nightQueuePosition: nightQueuePosition + 1,
    gameLog: [
      ...state.gameLog,
      {
        timestamp: Date.now(),
        type: 'night_action_confirmed',
        data: {
          queuePosition: nightQueuePosition,
          roleId: nightQueue[nightQueuePosition].roleId,
          playerId: nightQueue[nightQueuePosition].playerId,
        },
      },
    ],
  };
}

export function revertNightQueueStep(state: GameState): GameState {
  const { nightQueue, nightQueuePosition } = state;
  // Can only revert if we've advanced at least one step
  if (nightQueuePosition <= 0) return state;

  const prevPosition = nightQueuePosition - 1;
  const updatedQueue = nightQueue.map((entry, i) =>
    i === prevPosition
      ? { ...entry, completed: false, storytellerInput: undefined }
      : entry
  );

  return {
    ...state,
    nightQueue: updatedQueue,
    nightQueuePosition: prevPosition,
    gameLog: [
      ...state.gameLog,
      {
        timestamp: Date.now(),
        type: 'night_action_reverted',
        data: {
          queuePosition: prevPosition,
          roleId: nightQueue[prevPosition].roleId,
          playerId: nightQueue[prevPosition].playerId,
        },
      },
    ],
  };
}

export function commitNightActions(state: GameState): GameState {
  return {
    ...state,
    gameLog: [
      ...state.gameLog,
      {
        timestamp: Date.now(),
        type: 'night_committed',
        data: {
          nightQueue: state.nightQueue.map((entry) => ({
            roleId: entry.roleId,
            playerId: entry.playerId,
            completed: entry.completed,
          })),
        },
      },
    ],
  };
}

export function processPoisonerAction(state: GameState, targetPlayerId: string): GameState {
  const target = state.players.find((p) => p.id === targetPlayerId);
  if (!target) return state;

  // Clear all previous poison, then poison the new target
  let newState = clearPoison(state);
  newState = poisonPlayer(newState, targetPlayerId);

  return {
    ...newState,
    gameLog: [
      ...newState.gameLog,
      {
        timestamp: Date.now(),
        type: 'poisoner_action',
        data: { targetPlayerId },
      },
    ],
  };
}

export function processImpAction(
  state: GameState,
  targetPlayerId: string,
  impPlayerId: string,
  starPassMinionId?: string
): GameState {
  const target = state.players.find((p) => p.id === targetPlayerId);
  if (!target || !target.isAlive) return state;

  const imp = state.players.find((p) => p.id === impPlayerId);
  if (!imp) return state;

  // Self-target = star-pass: Imp dies, a Minion becomes the new Imp
  if (targetPlayerId === impPlayerId) {
    let newState = addPendingDeath(state, impPlayerId);

    // Find the Minion to become the new Imp
    const minionId = starPassMinionId;
    const minion = minionId
      ? state.players.find((p) => p.id === minionId && p.isAlive && (p.trueRole === 'poisoner' || p.trueRole === 'spy' || p.trueRole === 'scarletWoman' || p.trueRole === 'baron'))
      : state.players.find((p) => p.isAlive && (p.trueRole === 'poisoner' || p.trueRole === 'spy' || p.trueRole === 'scarletWoman' || p.trueRole === 'baron'));

    if (minion) {
      newState = {
        ...newState,
        players: newState.players.map((p) =>
          p.id === minion.id ? { ...p, trueRole: 'imp' as const } : p
        ),
      };
    }

    return {
      ...newState,
      gameLog: [
        ...newState.gameLog,
        {
          timestamp: Date.now(),
          type: 'imp_star_pass',
          data: { impPlayerId, newImpId: minion?.id ?? null },
        },
      ],
    };
  }

  // Check Monk protection
  if (state.monkProtectedPlayerId === targetPlayerId) {
    return {
      ...state,
      gameLog: [
        ...state.gameLog,
        {
          timestamp: Date.now(),
          type: 'imp_kill_blocked',
          data: { targetPlayerId, reason: 'monk_protection' },
        },
      ],
    };
  }

  // Check Soldier protection (only if Soldier is not poisoned)
  if (target.trueRole === 'soldier' && !target.isPoisoned) {
    return {
      ...state,
      gameLog: [
        ...state.gameLog,
        {
          timestamp: Date.now(),
          type: 'imp_kill_blocked',
          data: { targetPlayerId, reason: 'soldier_protection' },
        },
      ],
    };
  }

  // Normal kill: add to pending deaths
  const newState = addPendingDeath(state, targetPlayerId);
  return {
    ...newState,
    gameLog: [
      ...newState.gameLog,
      {
        timestamp: Date.now(),
        type: 'imp_kill',
        data: { targetPlayerId },
      },
    ],
  };
}

export async function resolveAbility(
  state: GameState,
  playerId: string,
  nightNumber: number,
  handler: (context: AbilityContext, input?: unknown) => AbilityResult | Promise<AbilityResult>,
  input?: unknown
): Promise<{ state: GameState; result: AbilityResult }> {
  const context = buildAbilityContext(state, playerId, nightNumber);
  const result = await handler(context, input);

  let newState = state;
  if (result.success && result.stateMutation) {
    newState = { ...state, ...result.stateMutation };
  }

  // Log the ability resolution
  newState = {
    ...newState,
    gameLog: [
      ...newState.gameLog,
      {
        timestamp: Date.now(),
        type: 'ability_resolved',
        data: {
          playerId,
          roleId: context.player.trueRole,
          nightNumber,
          isPoisoned: context.isPoisoned,
          isDrunk: context.isDrunk,
          success: result.success,
        },
      },
    ],
  };

  return { state: newState, result };
}
