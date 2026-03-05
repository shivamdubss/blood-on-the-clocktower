import { describe, it, expect } from 'vitest';
import {
  createInitialGameState,
  addPlayer,
  transitionToNight,
  getNightPromptInfo,
  advanceNightQueue,
  buildAbilityContext,
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

function makeGameWithDrunk(): GameState {
  let state = createInitialGameState('g1', 'ABC123', 'st1');
  state = addPlayer(state, makePlayer({ id: 'p1', name: 'Alice', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 0 }));
  state = addPlayer(state, makePlayer({ id: 'p2', name: 'Bob', trueRole: 'imp', apparentRole: 'imp', seatIndex: 1 }));
  // The Drunk thinks they are the Washerwoman
  state = addPlayer(state, makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'drunk', apparentRole: 'washerwoman', isDrunk: true, seatIndex: 2 }));
  state = addPlayer(state, makePlayer({ id: 'p4', name: 'Diana', trueRole: 'empath', apparentRole: 'empath', seatIndex: 3 }));
  state = addPlayer(state, makePlayer({ id: 'p5', name: 'Eve', trueRole: 'chef', apparentRole: 'chef', seatIndex: 4 }));
  return state;
}

describe('Drunk detection (EDGE-02)', () => {
  it('Storyteller is flagged that the Drunk player is the Drunk in the night prompt', () => {
    let state = makeGameWithDrunk();
    state = transitionToNight(state);

    // Find the Drunk's entry in the night queue (appears under their apparent role)
    const drunkEntry = state.nightQueue.find((e) => e.playerId === 'p3');
    expect(drunkEntry).toBeDefined();
    expect(drunkEntry!.roleId).toBe('washerwoman');

    // Advance to the Drunk's position in the queue
    while (state.nightQueuePosition < state.nightQueue.length) {
      const prompt = getNightPromptInfo(state);
      if (prompt && prompt.playerId === 'p3') {
        // Prompt should flag the player as Drunk
        expect(prompt.isDrunk).toBe(true);
        expect(prompt.promptDescription).toContain('DRUNK');
        expect(prompt.promptDescription).toContain('false information');
        break;
      }
      state = advanceNightQueue(state, {});
    }
  });

  it('Drunk night prompt shows the apparent role name, not "Drunk"', () => {
    let state = makeGameWithDrunk();
    state = transitionToNight(state);

    // Advance to the Drunk's position
    while (state.nightQueuePosition < state.nightQueue.length) {
      const prompt = getNightPromptInfo(state);
      if (prompt && prompt.playerId === 'p3') {
        // Should show washerwoman role (the apparent role), not "drunk"
        expect(prompt.roleId).toBe('washerwoman');
        expect(prompt.roleName.toLowerCase()).not.toBe('drunk');
        break;
      }
      state = advanceNightQueue(state, {});
    }
  });

  it('Storyteller provides false info via submit_night_action input for the Drunk', () => {
    let state = makeGameWithDrunk();
    state = transitionToNight(state);

    // Advance to the Drunk's position
    while (state.nightQueuePosition < state.nightQueue.length) {
      const prompt = getNightPromptInfo(state);
      if (prompt && prompt.playerId === 'p3') break;
      state = advanceNightQueue(state, {});
    }

    // Storyteller provides false Washerwoman info (this is manual input, not auto-computed)
    const falseInput = {
      player1: 'p4',
      player2: 'p5',
      role: 'empath',
    };
    state = advanceNightQueue(state, falseInput);

    // Verify the storyteller input is stored on the queue entry
    const drunkEntry = state.nightQueue.find((e) => e.playerId === 'p3');
    expect(drunkEntry).toBeDefined();
    expect(drunkEntry!.completed).toBe(true);
    expect(drunkEntry!.storytellerInput).toEqual(falseInput);
  });

  it('Drunk ability context has isDrunk set to true', () => {
    let state = makeGameWithDrunk();
    state = transitionToNight(state);

    const context = buildAbilityContext(state, 'p3', 1);
    expect(context.isDrunk).toBe(true);
    // Drunk behaves like poisoned — corrupted output
    expect(context.isPoisoned).toBe(false);
    expect(context.isDrunk).toBe(true);
  });

  it('non-Drunk player ability context has isDrunk set to false', () => {
    let state = makeGameWithDrunk();
    state = transitionToNight(state);

    const context = buildAbilityContext(state, 'p4', 1);
    expect(context.isDrunk).toBe(false);
  });
});
