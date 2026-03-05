import type { GameState, Player, Phase, DaySubPhase, RoleId, Nomination } from '../types/game.js';
import { assignRoles as computeRoleAssignments } from './roleDistribution.js';

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

export function applyStorytellOverride(
  state: GameState,
  override: Partial<GameState>
): GameState {
  return { ...state, ...override };
}
