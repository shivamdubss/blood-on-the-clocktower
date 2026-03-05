import { describe, it, expect } from 'vitest';
import {
  createInitialGameState,
  addPlayer,
  removePlayer,
  transitionPhase,
  assignRole,
  killPlayer,
  poisonPlayer,
  clearPoison,
  checkWinConditions,
  setStoryteller,
  applyStorytellerOverride,
} from '../../src/server/gameStateMachine.js';
import type { GameState, Player } from '../../src/types/game.js';

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'p1',
    name: 'Alice',
    trueRole: 'washerwoman',
    apparentRole: 'washerwoman',
    isAlive: true,
    isPoisoned: false,
    isDrunk: false,
    hasGhostVote: true,
    ghostVoteUsed: false,
    seatIndex: 0,
    ...overrides,
  };
}

describe('state machine', () => {
  it('all mutations return new state objects (immutability)', () => {
    const initial = createInitialGameState('g1', 'ABC123', 'st1');
    const player = makePlayer();

    const afterAdd = addPlayer(initial, player);
    expect(afterAdd).not.toBe(initial);
    expect(initial.players).toHaveLength(0);
    expect(afterAdd.players).toHaveLength(1);

    const afterRemove = removePlayer(afterAdd, 'p1');
    expect(afterRemove).not.toBe(afterAdd);
    expect(afterAdd.players).toHaveLength(1);
    expect(afterRemove.players).toHaveLength(0);

    const afterTransition = transitionPhase(initial, 'setup');
    expect(afterTransition).not.toBe(initial);
    expect(initial.phase).toBe('lobby');
    expect(afterTransition.phase).toBe('setup');

    const withPlayer = addPlayer(initial, player);
    const afterAssign = assignRole(withPlayer, 'p1', 'imp', 'imp');
    expect(afterAssign).not.toBe(withPlayer);
    expect(withPlayer.players[0].trueRole).toBe('washerwoman');
    expect(afterAssign.players[0].trueRole).toBe('imp');

    const afterKill = killPlayer(afterAssign, 'p1');
    expect(afterKill).not.toBe(afterAssign);
    expect(afterAssign.players[0].isAlive).toBe(true);
    expect(afterKill.players[0].isAlive).toBe(false);

    const afterPoison = poisonPlayer(withPlayer, 'p1');
    expect(afterPoison).not.toBe(withPlayer);
    expect(withPlayer.players[0].isPoisoned).toBe(false);
    expect(afterPoison.players[0].isPoisoned).toBe(true);

    const afterClear = clearPoison(afterPoison);
    expect(afterClear).not.toBe(afterPoison);
    expect(afterPoison.players[0].isPoisoned).toBe(true);
    expect(afterClear.players[0].isPoisoned).toBe(false);

    const afterStoryteller = setStoryteller(initial, 'new-st');
    expect(afterStoryteller).not.toBe(initial);
    expect(initial.storytellerId).toBe('st1');
    expect(afterStoryteller.storytellerId).toBe('new-st');
  });

  it('createInitialGameState sets all required fields', () => {
    const state = createInitialGameState('g1', 'ABC123', 'st1', 'secret');
    expect(state.id).toBe('g1');
    expect(state.joinCode).toBe('ABC123');
    expect(state.phase).toBe('lobby');
    expect(state.daySubPhase).toBeNull();
    expect(state.dayNumber).toBe(0);
    expect(state.players).toEqual([]);
    expect(state.storytellerId).toBe('st1');
    expect(state.winner).toBeNull();
    expect(state.hostSecret).toBe('secret');
    expect(state.gameLog).toEqual([]);
  });

  it('transitionPhase appends to game log', () => {
    const state = createInitialGameState('g1', 'ABC123', 'st1');
    const afterSetup = transitionPhase(state, 'setup');
    expect(afterSetup.gameLog).toHaveLength(1);
    expect(afterSetup.gameLog[0].type).toBe('phase_transition');

    const afterDay = transitionPhase(afterSetup, 'day');
    expect(afterDay.gameLog).toHaveLength(2);
  });

  it('killPlayer appends to game log', () => {
    const state = createInitialGameState('g1', 'ABC123', 'st1');
    const withPlayer = addPlayer(state, makePlayer());
    const afterKill = killPlayer(withPlayer, 'p1');
    expect(afterKill.gameLog).toHaveLength(1);
    expect(afterKill.gameLog[0].type).toBe('player_death');
  });

  it('checkWinConditions detects evil win when 2 alive with demon', () => {
    let state = createInitialGameState('g1', 'ABC123', 'st1');
    state = transitionPhase(state, 'day');
    state = addPlayer(state, makePlayer({ id: 'p1', trueRole: 'imp' }));
    state = addPlayer(state, makePlayer({ id: 'p2', name: 'Bob', trueRole: 'washerwoman', seatIndex: 1 }));

    const result = checkWinConditions(state);
    expect(result.winner).toBe('evil');
    expect(result.phase).toBe('ended');
  });

  it('checkWinConditions detects good win when no demon alive', () => {
    let state = createInitialGameState('g1', 'ABC123', 'st1');
    state = transitionPhase(state, 'day');
    state = addPlayer(state, makePlayer({ id: 'p1', trueRole: 'imp', isAlive: false }));
    state = addPlayer(state, makePlayer({ id: 'p2', name: 'Bob', trueRole: 'washerwoman', seatIndex: 1 }));
    state = addPlayer(state, makePlayer({ id: 'p3', name: 'Carol', trueRole: 'empath', seatIndex: 2 }));
    state = addPlayer(state, makePlayer({ id: 'p4', name: 'Dave', trueRole: 'chef', seatIndex: 3 }));

    const result = checkWinConditions(state);
    expect(result.winner).toBe('good');
    expect(result.phase).toBe('ended');
  });

  it('applyStorytellerOverride applies a typed override and logs it', () => {
    let state = createInitialGameState('g1', 'ABC123', 'st1');
    const player: Player = {
      id: 'p1', name: 'Alice', trueRole: 'washerwoman', apparentRole: 'washerwoman',
      isAlive: true, isPoisoned: false, isDrunk: false, hasGhostVote: true, ghostVoteUsed: false, seatIndex: 0,
    };
    state = { ...state, players: [player] };
    const overridden = applyStorytellerOverride(state, { type: 'kill_player', playerId: 'p1' });
    expect(overridden.players[0].isAlive).toBe(false);
    expect(overridden.id).toBe('g1');
    const lastLog = overridden.gameLog[overridden.gameLog.length - 1];
    expect(lastLog.type).toBe('storyteller_override');
  });
});

describe('state mutation', () => {
  it('all exported state machine functions are pure (no side effects)', () => {
    const state = createInitialGameState('g1', 'ABC123', 'st1');
    const player = makePlayer();
    const snapshot = JSON.stringify(state);

    addPlayer(state, player);
    removePlayer(state, 'p1');
    transitionPhase(state, 'setup');
    assignRole(state, 'p1', 'imp', 'imp');
    killPlayer(state, 'p1');
    poisonPlayer(state, 'p1');
    clearPoison(state);
    checkWinConditions(state);
    setStoryteller(state, 'new-st');
    applyStorytellerOverride(state, { type: 'kill_player', playerId: 'p1' });

    // Original state is completely unmodified
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('client store only receives state, never mutates it', async () => {
    // Verify the client store shape: setGameState replaces whole state (read-only pattern)
    const { useStore } = await import('../../src/client/store.js');
    const store = useStore.getState();

    // Store has setGameState (replaces whole state) but no mutation methods
    expect(typeof store.setGameState).toBe('function');
    expect(typeof store.setPlayerId).toBe('function');
    expect(typeof store.reset).toBe('function');

    // No game-logic mutation functions on client store
    const storeKeys = Object.keys(store);
    const mutationFunctions = ['addPlayer', 'removePlayer', 'transitionPhase',
      'assignRole', 'killPlayer', 'poisonPlayer', 'clearPoison'];
    for (const fn of mutationFunctions) {
      expect(storeKeys).not.toContain(fn);
    }
  });

  it('server socket handlers only use state machine functions (no direct mutations)', async () => {
    // Read the socket handlers source to verify no direct state mutations
    const fs = await import('fs');
    const source = fs.readFileSync('src/server/socketHandlers.ts', 'utf-8');

    // All state updates should use state machine functions, not spread operators on game state
    // The handler should import from gameStateMachine
    expect(source).toContain("from './gameStateMachine.js'");

    // No direct property assignments like game.phase = or game.players =
    const directMutationPattern = /\bgame\.\w+\s*=/;
    expect(directMutationPattern.test(source)).toBe(false);

    // No direct spreads creating new game state outside of state machine functions
    // (the only spread should be in the state machine itself)
    const directSpreadPattern = /\{\s*\.\.\.game\b/;
    expect(directSpreadPattern.test(source)).toBe(false);
  });

  it('state machine is the single source of truth -- game state type is shared', async () => {
    // Both server and client import the same GameState type
    const fs = await import('fs');
    const serverSource = fs.readFileSync('src/server/index.ts', 'utf-8');
    const clientSource = fs.readFileSync('src/client/store.ts', 'utf-8');
    const handlersSource = fs.readFileSync('src/server/socketHandlers.ts', 'utf-8');

    // Server uses GameState from types
    expect(serverSource).toContain("from '../types/game.js'");
    // Client uses GameState from types
    expect(clientSource).toContain("from '../types/game.js'");
    // Handlers use state machine functions
    expect(handlersSource).toContain("from './gameStateMachine.js'");
  });
});
