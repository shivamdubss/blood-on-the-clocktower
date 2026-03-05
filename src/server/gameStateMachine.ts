import type { GameState, Player, Phase, RoleId } from '../types/game.js';
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
    nightQueue: [],
    nightQueuePosition: 0,
    executedPlayerId: null,
    monkProtectedPlayerId: null,
    fortuneTellerRedHerringId: null,
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

export function assignAllRoles(state: GameState): GameState {
  const playerIds = state.players.map((p) => p.id);
  const assignments = computeRoleAssignments(playerIds);

  return {
    ...state,
    players: state.players.map((p) => {
      const assignment = assignments.find((a) => a.playerId === p.id);
      if (!assignment) return p;
      return {
        ...p,
        trueRole: assignment.role,
        apparentRole: assignment.apparentRole,
        isDrunk: assignment.role === 'drunk',
      };
    }),
  };
}

export function applyStorytellOverride(
  state: GameState,
  override: Partial<GameState>
): GameState {
  return { ...state, ...override };
}
