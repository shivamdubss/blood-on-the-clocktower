import { describe, it, expect } from 'vitest';
import {
  createInitialGameState,
  addPlayer,
  poisonPlayer,
  buildAbilityContext,
  resolveAbility,
} from '../../src/server/gameStateMachine.js';
import type { Player } from '../../src/types/game.js';
import type { AbilityContext, AbilityResult } from '../../src/types/ability.js';

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

function makeGameWithPlayers() {
  let state = createInitialGameState('g1', 'ABC123', 'st1');
  state = addPlayer(state, makePlayer({ id: 'p1', name: 'Alice', trueRole: 'washerwoman', apparentRole: 'washerwoman' }));
  state = addPlayer(state, makePlayer({ id: 'p2', name: 'Bob', trueRole: 'empath', apparentRole: 'empath', seatIndex: 1 }));
  state = addPlayer(state, makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'drunk', apparentRole: 'chef', isDrunk: true, seatIndex: 2 }));
  state = addPlayer(state, makePlayer({ id: 'p4', name: 'Diana', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 3 }));
  state = addPlayer(state, makePlayer({ id: 'p5', name: 'Eve', trueRole: 'imp', apparentRole: 'imp', seatIndex: 4 }));
  return state;
}

describe('ability context', () => {
  describe('AbilityContext type includes isPoisoned and isDrunk boolean fields', () => {
    it('buildAbilityContext returns an AbilityContext with isPoisoned and isDrunk', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p1', 1);

      expect(context).toHaveProperty('isPoisoned');
      expect(context).toHaveProperty('isDrunk');
      expect(typeof context.isPoisoned).toBe('boolean');
      expect(typeof context.isDrunk).toBe('boolean');
    });

    it('context includes gameState, player, and nightNumber', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p1', 1);

      expect(context.gameState).toBe(state);
      expect(context.player.id).toBe('p1');
      expect(context.nightNumber).toBe(1);
    });
  });

  describe('All ability resolution functions receive AbilityContext as a parameter', () => {
    it('resolveAbility passes AbilityContext to the handler', async () => {
      const state = makeGameWithPlayers();
      let receivedContext: AbilityContext | null = null;

      const handler = (context: AbilityContext): AbilityResult => {
        receivedContext = context;
        return { success: true };
      };

      await resolveAbility(state, 'p1', 1, handler);

      expect(receivedContext).not.toBeNull();
      expect(receivedContext!.isPoisoned).toBe(false);
      expect(receivedContext!.isDrunk).toBe(false);
      expect(receivedContext!.player.id).toBe('p1');
      expect(receivedContext!.nightNumber).toBe(1);
    });

    it('resolveAbility passes input to the handler', async () => {
      const state = makeGameWithPlayers();
      let receivedInput: unknown = undefined;

      const handler = (_context: AbilityContext, input?: unknown): AbilityResult => {
        receivedInput = input;
        return { success: true };
      };

      await resolveAbility(state, 'p1', 1, handler, { targetId: 'p2' });

      expect(receivedInput).toEqual({ targetId: 'p2' });
    });
  });

  describe('poisoned ability', () => {
    it('a poisoned player gets isPoisoned=true in their ability context', () => {
      let state = makeGameWithPlayers();
      state = poisonPlayer(state, 'p1');

      const context = buildAbilityContext(state, 'p1', 1);

      expect(context.isPoisoned).toBe(true);
      expect(context.isDrunk).toBe(false);
    });

    it('a poisoned ability returns corrupted information', async () => {
      let state = makeGameWithPlayers();
      state = poisonPlayer(state, 'p1');

      const handler = (context: AbilityContext): AbilityResult => {
        if (context.isPoisoned || context.isDrunk) {
          return { success: true, data: { number: 999 }, message: 'corrupted' };
        }
        return { success: true, data: { number: 0 } };
      };

      const { result } = await resolveAbility(state, 'p1', 1, handler);

      expect(result.data).toEqual({ number: 999 });
      expect(result.message).toBe('corrupted');
    });

    it('an unpoisoned player gets isPoisoned=false', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p1', 1);

      expect(context.isPoisoned).toBe(false);
    });
  });

  describe('drunk ability', () => {
    it('the Drunk player gets isDrunk=true in their ability context', () => {
      const state = makeGameWithPlayers();
      // p3 is the Drunk (trueRole: 'drunk', isDrunk: true)
      const context = buildAbilityContext(state, 'p3', 1);

      expect(context.isDrunk).toBe(true);
      expect(context.isPoisoned).toBe(false);
    });

    it('a drunk ability behaves identically to a poisoned ability (corrupted output)', async () => {
      const state = makeGameWithPlayers();

      const handler = (context: AbilityContext): AbilityResult => {
        if (context.isPoisoned || context.isDrunk) {
          return { success: true, data: { info: 'false' }, message: 'corrupted' };
        }
        return { success: true, data: { info: 'true' } };
      };

      // Drunk player
      const { result: drunkResult } = await resolveAbility(state, 'p3', 1, handler);
      expect(drunkResult.data).toEqual({ info: 'false' });
      expect(drunkResult.message).toBe('corrupted');

      // Poisoned player
      let poisonedState = poisonPlayer(state, 'p2');
      const { result: poisonedResult } = await resolveAbility(poisonedState, 'p2', 1, handler);
      expect(poisonedResult.data).toEqual({ info: 'false' });
      expect(poisonedResult.message).toBe('corrupted');

      // Both produce the same corrupted output
      expect(drunkResult.data).toEqual(poisonedResult.data);
    });

    it('a non-drunk player gets isDrunk=false', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p1', 1);

      expect(context.isDrunk).toBe(false);
    });
  });

  describe('Context flags are set by the state machine based on active Poisoner target and Drunk status', () => {
    it('poisonPlayer sets isPoisoned on the target player', () => {
      let state = makeGameWithPlayers();
      state = poisonPlayer(state, 'p2');

      const context = buildAbilityContext(state, 'p2', 1);
      expect(context.isPoisoned).toBe(true);

      // Other players are not poisoned
      const otherContext = buildAbilityContext(state, 'p1', 1);
      expect(otherContext.isPoisoned).toBe(false);
    });

    it('isDrunk is set based on the player true role being drunk', () => {
      const state = makeGameWithPlayers();
      // p3 has trueRole: 'drunk', isDrunk: true
      const drunkContext = buildAbilityContext(state, 'p3', 1);
      expect(drunkContext.isDrunk).toBe(true);

      // p1 is not drunk
      const normalContext = buildAbilityContext(state, 'p1', 1);
      expect(normalContext.isDrunk).toBe(false);
    });

    it('a player can be both poisoned and drunk', () => {
      let state = makeGameWithPlayers();
      // p3 is the Drunk
      state = poisonPlayer(state, 'p3');

      const context = buildAbilityContext(state, 'p3', 1);
      expect(context.isPoisoned).toBe(true);
      expect(context.isDrunk).toBe(true);
    });
  });

  describe('The corruption flag is on the ability execution context, not on the role itself', () => {
    it('context isPoisoned comes from the context object, not the role file', () => {
      let state = makeGameWithPlayers();
      state = poisonPlayer(state, 'p1');

      const context = buildAbilityContext(state, 'p1', 1);

      // The corruption state is on AbilityContext, not role metadata
      expect(context.isPoisoned).toBe(true);
      // The player's isPoisoned is a state property, but the context wraps it
      expect(context.player.isPoisoned).toBe(true);
      // The key point: handlers should check context.isPoisoned, not player.isPoisoned
      // This test validates that buildAbilityContext reads from state and puts it on context
    });

    it('context isDrunk comes from the context object, not the role file', () => {
      const state = makeGameWithPlayers();
      const context = buildAbilityContext(state, 'p3', 1);

      expect(context.isDrunk).toBe(true);
      expect(context.player.isDrunk).toBe(true);
    });

    it('resolveAbility logs the corruption state in the game log', async () => {
      let state = makeGameWithPlayers();
      state = poisonPlayer(state, 'p1');

      const handler = (_context: AbilityContext): AbilityResult => ({ success: true });

      const { state: newState } = await resolveAbility(state, 'p1', 1, handler);

      const abilityLog = newState.gameLog.find(
        (entry) => entry.type === 'ability_resolved'
      );
      expect(abilityLog).toBeDefined();
      const data = abilityLog!.data as { isPoisoned: boolean; isDrunk: boolean; playerId: string };
      expect(data.isPoisoned).toBe(true);
      expect(data.isDrunk).toBe(false);
      expect(data.playerId).toBe('p1');
    });
  });

  describe('resolveAbility applies stateMutation from result', () => {
    it('applies stateMutation to game state when ability succeeds', async () => {
      const state = makeGameWithPlayers();

      const handler = (_context: AbilityContext): AbilityResult => ({
        success: true,
        stateMutation: { monkProtectedPlayerId: 'p2' },
      });

      const { state: newState } = await resolveAbility(state, 'p1', 1, handler);

      expect(newState.monkProtectedPlayerId).toBe('p2');
    });

    it('does not apply stateMutation when ability fails', async () => {
      const state = makeGameWithPlayers();

      const handler = (_context: AbilityContext): AbilityResult => ({
        success: false,
        stateMutation: { monkProtectedPlayerId: 'p2' },
      });

      const { state: newState } = await resolveAbility(state, 'p1', 1, handler);

      expect(newState.monkProtectedPlayerId).toBeNull();
    });
  });

  describe('buildAbilityContext error handling', () => {
    it('throws if player not found', () => {
      const state = makeGameWithPlayers();
      expect(() => buildAbilityContext(state, 'nonexistent', 1)).toThrow('Player nonexistent not found');
    });
  });
});
