import { describe, it, expect } from 'vitest';
import {
  createInitialGameState,
  addPlayer,
  poisonPlayer,
  clearPoison,
  processPoisonerAction,
  buildAbilityContext,
  resolveAbility,
  generateNightQueue,
  transitionToNight,
  advanceNightQueue,
  transitionPhase,
  assignRole,
} from '../../src/server/gameStateMachine.js';
import { abilityHandler } from '../../src/roles/poisoner.js';
import type { Player, GameState } from '../../src/types/game.js';

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

function makeGameWithPlayers(): GameState {
  let state = createInitialGameState('g1', 'ABC123', 'st1');
  state = addPlayer(state, makePlayer({ id: 'p1', name: 'Alice', trueRole: 'washerwoman', apparentRole: 'washerwoman' }));
  state = addPlayer(state, makePlayer({ id: 'p2', name: 'Bob', trueRole: 'empath', apparentRole: 'empath', seatIndex: 1 }));
  state = addPlayer(state, makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'fortuneTeller', apparentRole: 'fortuneTeller', seatIndex: 2 }));
  state = addPlayer(state, makePlayer({ id: 'p4', name: 'Diana', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 3 }));
  state = addPlayer(state, makePlayer({ id: 'p5', name: 'Eve', trueRole: 'imp', apparentRole: 'imp', seatIndex: 4 }));
  return state;
}

describe('Poisoner ability', () => {
  describe('fires every night (including Night 1) via AbilityContext', () => {
    it('poisoner appears in night 1 queue', () => {
      let state = makeGameWithPlayers();
      state = transitionPhase(state, 'setup');
      // dayNumber = 0, so night queue generation uses night 1 order
      const queue = generateNightQueue(state);
      const poisonerEntry = queue.find((e) => e.roleId === 'poisoner');
      expect(poisonerEntry).toBeDefined();
      expect(poisonerEntry!.playerId).toBe('p4');
    });

    it('poisoner appears in subsequent night queues', () => {
      let state = makeGameWithPlayers();
      state = { ...state, dayNumber: 1 }; // Night 2
      const queue = generateNightQueue(state);
      const poisonerEntry = queue.find((e) => e.roleId === 'poisoner');
      expect(poisonerEntry).toBeDefined();
      expect(poisonerEntry!.playerId).toBe('p4');
    });
  });

  describe('Poisoner chooses any player to poison', () => {
    it('ability handler accepts a target and applies poison via stateMutation', async () => {
      const state = makeGameWithPlayers();
      const { state: newState, result } = await resolveAbility(
        state,
        'p4',
        1,
        abilityHandler,
        { targetPlayerId: 'p1' }
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ targetPlayerId: 'p1', effective: true });

      // The target should be poisoned
      const target = newState.players.find((p) => p.id === 'p1');
      expect(target!.isPoisoned).toBe(true);
    });

    it('ability handler returns failure without a target', async () => {
      const state = makeGameWithPlayers();
      const { result } = await resolveAbility(state, 'p4', 1, abilityHandler);

      expect(result.success).toBe(false);
      expect(result.message).toBe('No target selected');
    });

    it('ability handler returns failure for nonexistent target', async () => {
      const state = makeGameWithPlayers();
      const { result } = await resolveAbility(
        state,
        'p4',
        1,
        abilityHandler,
        { targetPlayerId: 'nonexistent' }
      );

      expect(result.success).toBe(false);
      expect(result.message).toBe('Target player not found');
    });

    it('poisoner can target any player including themselves', async () => {
      const state = makeGameWithPlayers();
      const { state: newState, result } = await resolveAbility(
        state,
        'p4',
        1,
        abilityHandler,
        { targetPlayerId: 'p4' }
      );

      expect(result.success).toBe(true);
      const poisoner = newState.players.find((p) => p.id === 'p4');
      expect(poisoner!.isPoisoned).toBe(true);
    });
  });

  describe('Poison applies from the moment the Poisoner acts in the night queue', () => {
    it('processPoisonerAction applies poison immediately', () => {
      const state = makeGameWithPlayers();
      const newState = processPoisonerAction(state, 'p1');

      const target = newState.players.find((p) => p.id === 'p1');
      expect(target!.isPoisoned).toBe(true);
    });

    it('poisoner is first in night order (acts before other roles)', () => {
      let state = makeGameWithPlayers();
      state = transitionPhase(state, 'setup');
      const queue = generateNightQueue(state);

      // Poisoner should be first in the queue
      expect(queue[0].roleId).toBe('poisoner');
    });
  });

  describe('Poison lasts until the Poisoner acts again the following night', () => {
    it('processPoisonerAction clears previous poison before applying new', () => {
      let state = makeGameWithPlayers();
      // First night: poison p1
      state = processPoisonerAction(state, 'p1');
      expect(state.players.find((p) => p.id === 'p1')!.isPoisoned).toBe(true);

      // Second night: poison p2 - should clear p1's poison
      state = processPoisonerAction(state, 'p2');
      expect(state.players.find((p) => p.id === 'p1')!.isPoisoned).toBe(false);
      expect(state.players.find((p) => p.id === 'p2')!.isPoisoned).toBe(true);
    });

    it('poison persists through the day until next night action', () => {
      let state = makeGameWithPlayers();
      // Night 1: poison p1
      state = processPoisonerAction(state, 'p1');

      // Transition to day - poison should still be there
      state = transitionPhase(state, 'day');
      expect(state.players.find((p) => p.id === 'p1')!.isPoisoned).toBe(true);

      // Transition to night 2 - poison still persists until Poisoner acts again
      state = transitionToNight(state);
      expect(state.players.find((p) => p.id === 'p1')!.isPoisoned).toBe(true);
    });

    it('ability handler clears old poison and applies new via stateMutation', async () => {
      let state = makeGameWithPlayers();
      // Manually poison p1 first
      state = poisonPlayer(state, 'p1');
      expect(state.players.find((p) => p.id === 'p1')!.isPoisoned).toBe(true);

      // Poisoner uses ability to target p2
      const { state: newState } = await resolveAbility(
        state,
        'p4',
        2,
        abilityHandler,
        { targetPlayerId: 'p2' }
      );

      // p1 should no longer be poisoned, p2 should be
      expect(newState.players.find((p) => p.id === 'p1')!.isPoisoned).toBe(false);
      expect(newState.players.find((p) => p.id === 'p2')!.isPoisoned).toBe(true);
    });
  });

  describe('A poisoned player\'s ability produces false/ineffective results', () => {
    it('poisoned player gets isPoisoned=true in their ability context', () => {
      let state = makeGameWithPlayers();
      state = processPoisonerAction(state, 'p1');

      const context = buildAbilityContext(state, 'p1', 1);
      expect(context.isPoisoned).toBe(true);
    });

    it('poisoned Poisoner\'s ability has no effect', async () => {
      let state = makeGameWithPlayers();
      // Poison the Poisoner themselves (e.g. via storyteller override)
      state = poisonPlayer(state, 'p4');

      const { state: newState, result } = await resolveAbility(
        state,
        'p4',
        1,
        abilityHandler,
        { targetPlayerId: 'p1' }
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ targetPlayerId: 'p1', effective: false });

      // The target should NOT be poisoned because the poisoner is poisoned
      const target = newState.players.find((p) => p.id === 'p1');
      expect(target!.isPoisoned).toBe(false);
    });
  });

  describe('Poison status is visible in the Grimoire', () => {
    it('isPoisoned flag is present on player state after poisoning', () => {
      let state = makeGameWithPlayers();
      state = processPoisonerAction(state, 'p1');

      const player = state.players.find((p) => p.id === 'p1');
      expect(player!.isPoisoned).toBe(true);
    });

    it('clearPoison removes all poison from all players', () => {
      let state = makeGameWithPlayers();
      state = poisonPlayer(state, 'p1');
      state = poisonPlayer(state, 'p2');

      state = clearPoison(state);
      for (const player of state.players) {
        expect(player.isPoisoned).toBe(false);
      }
    });
  });

  describe('processPoisonerAction logs the action', () => {
    it('adds a poisoner_action entry to the game log', () => {
      const state = makeGameWithPlayers();
      const newState = processPoisonerAction(state, 'p1');

      const logEntry = newState.gameLog.find((e) => e.type === 'poisoner_action');
      expect(logEntry).toBeDefined();
      expect((logEntry!.data as { targetPlayerId: string }).targetPlayerId).toBe('p1');
    });
  });

  describe('processPoisonerAction ignores invalid targets', () => {
    it('returns unchanged state for nonexistent target', () => {
      const state = makeGameWithPlayers();
      const newState = processPoisonerAction(state, 'nonexistent');
      expect(newState).toBe(state);
    });
  });

  describe('night queue integration', () => {
    it('poisoner night action is processed during submit_night_action flow', () => {
      let state = makeGameWithPlayers();
      state = transitionPhase(state, 'setup');
      state = transitionToNight(state);

      // The poisoner should be first in the queue
      expect(state.nightQueue[0].roleId).toBe('poisoner');

      // Process the poisoner action via processPoisonerAction
      state = processPoisonerAction(state, 'p1');

      // Advance the queue
      state = advanceNightQueue(state, { targetPlayerId: 'p1' });

      // Target should be poisoned
      expect(state.players.find((p) => p.id === 'p1')!.isPoisoned).toBe(true);

      // Queue should have advanced
      expect(state.nightQueuePosition).toBe(1);
      expect(state.nightQueue[0].completed).toBe(true);
    });
  });
});
