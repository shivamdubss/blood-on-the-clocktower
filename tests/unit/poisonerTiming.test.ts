import { describe, it, expect } from 'vitest';
import {
  createInitialGameState,
  addPlayer,
  poisonPlayer,
  processPoisonerAction,
  transitionToNight,
  buildAbilityContext,
  advanceNightQueue,
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

function makeGameWithPlayers(): GameState {
  let state = createInitialGameState('g1', 'ABC123', 'st1');
  state = addPlayer(state, makePlayer({ id: 'p1', name: 'Alice', trueRole: 'poisoner', apparentRole: 'poisoner', seatIndex: 0 }));
  state = addPlayer(state, makePlayer({ id: 'p2', name: 'Bob', trueRole: 'imp', apparentRole: 'imp', seatIndex: 1 }));
  state = addPlayer(state, makePlayer({ id: 'p3', name: 'Charlie', trueRole: 'washerwoman', apparentRole: 'washerwoman', seatIndex: 2 }));
  state = addPlayer(state, makePlayer({ id: 'p4', name: 'Diana', trueRole: 'empath', apparentRole: 'empath', seatIndex: 3 }));
  state = addPlayer(state, makePlayer({ id: 'p5', name: 'Eve', trueRole: 'chef', apparentRole: 'chef', seatIndex: 4 }));
  return state;
}

describe('Poisoner timing (EDGE-01)', () => {
  it('poison applies to abilities firing after Poisoner in the night queue', () => {
    let state = makeGameWithPlayers();
    state = transitionToNight(state);

    // Poisoner acts first, poisons the Washerwoman
    state = processPoisonerAction(state, 'p3');
    state = advanceNightQueue(state, { targetPlayerId: 'p3' });

    // Washerwoman fires later in the queue — should be poisoned
    const context = buildAbilityContext(state, 'p3', 1);
    expect(context.isPoisoned).toBe(true);
  });

  it('poison persists through the entire day after the night it was applied', () => {
    let state = makeGameWithPlayers();
    state = processPoisonerAction(state, 'p3');

    // Transition to day — poison should still be active
    state = { ...state, phase: 'day' as const, daySubPhase: 'discussion' as const, dayNumber: 1 };
    const poisonedPlayer = state.players.find((p) => p.id === 'p3')!;
    expect(poisonedPlayer.isPoisoned).toBe(true);
  });

  it('poison expires when Night N+1 begins (transitionToNight clears all poison)', () => {
    let state = makeGameWithPlayers();
    // Poison a player on Night N
    state = processPoisonerAction(state, 'p3');
    expect(state.players.find((p) => p.id === 'p3')!.isPoisoned).toBe(true);

    // Transition to day
    state = { ...state, phase: 'day' as const, daySubPhase: 'end' as const, dayNumber: 1 };

    // Transition to Night N+1 — poison should be cleared
    state = transitionToNight(state);
    expect(state.players.find((p) => p.id === 'p3')!.isPoisoned).toBe(false);
  });

  it('Poisoner re-applies poison on Night N+1 if they are alive', () => {
    let state = makeGameWithPlayers();
    // Night 1: Poison p3
    state = processPoisonerAction(state, 'p3');
    expect(state.players.find((p) => p.id === 'p3')!.isPoisoned).toBe(true);

    // Day 1
    state = { ...state, phase: 'day' as const, daySubPhase: 'end' as const, dayNumber: 1 };

    // Night 2: transitionToNight clears poison
    state = transitionToNight(state);
    expect(state.players.find((p) => p.id === 'p3')!.isPoisoned).toBe(false);

    // Poisoner re-poisons p4 this night
    state = processPoisonerAction(state, 'p4');
    expect(state.players.find((p) => p.id === 'p3')!.isPoisoned).toBe(false);
    expect(state.players.find((p) => p.id === 'p4')!.isPoisoned).toBe(true);
  });

  it('poison does not carry over if Poisoner is dead (not in queue, poison cleared at night start)', () => {
    let state = makeGameWithPlayers();
    // Night 1: Poison p3
    state = processPoisonerAction(state, 'p3');
    expect(state.players.find((p) => p.id === 'p3')!.isPoisoned).toBe(true);

    // Kill the Poisoner
    state = {
      ...state,
      players: state.players.map((p) =>
        p.id === 'p1' ? { ...p, isAlive: false } : p
      ),
      phase: 'day' as const,
      daySubPhase: 'end' as const,
      dayNumber: 1,
    };

    // Night 2: transitionToNight clears poison; dead Poisoner can't re-apply
    state = transitionToNight(state);
    expect(state.players.find((p) => p.id === 'p3')!.isPoisoned).toBe(false);

    // Poisoner should not be in the night queue (dead)
    const poisonerInQueue = state.nightQueue.find((e) => e.roleId === 'poisoner');
    expect(poisonerInQueue).toBeUndefined();
  });

  it('poison status is correctly computed via buildAbilityContext for abilities after Poisoner', () => {
    let state = makeGameWithPlayers();
    state = transitionToNight(state);

    // Poisoner poisons the Empath (p4)
    state = processPoisonerAction(state, 'p4');
    state = advanceNightQueue(state, { targetPlayerId: 'p4' });

    // Empath fires later — context should reflect poisoned state
    const empathContext = buildAbilityContext(state, 'p4', 1);
    expect(empathContext.isPoisoned).toBe(true);

    // Chef (p5) is not poisoned
    const chefContext = buildAbilityContext(state, 'p5', 1);
    expect(chefContext.isPoisoned).toBe(false);
  });

  it('poison expiry: poison from Night N is cleared at the start of Night N+1', () => {
    let state = makeGameWithPlayers();
    // Night 1: Poison p3
    state = processPoisonerAction(state, 'p3');
    expect(state.players.find((p) => p.id === 'p3')!.isPoisoned).toBe(true);

    // Day 1
    state = { ...state, phase: 'day' as const, daySubPhase: 'end' as const, dayNumber: 1 };
    // Still poisoned during day
    expect(state.players.find((p) => p.id === 'p3')!.isPoisoned).toBe(true);

    // Night 2: poison expires
    state = transitionToNight(state);
    expect(state.players.find((p) => p.id === 'p3')!.isPoisoned).toBe(false);
  });

  it('multiple night transitions: poison is fresh each night', () => {
    let state = makeGameWithPlayers();

    // Night 1: Poison p3
    state = transitionToNight(state);
    state = processPoisonerAction(state, 'p3');
    expect(state.players.find((p) => p.id === 'p3')!.isPoisoned).toBe(true);

    // Day 1 → Night 2
    state = { ...state, phase: 'day' as const, daySubPhase: 'end' as const, dayNumber: 1 };
    state = transitionToNight(state);

    // All poison cleared at Night 2 start
    expect(state.players.every((p) => !p.isPoisoned)).toBe(true);

    // Poisoner poisons p4 this time
    state = processPoisonerAction(state, 'p4');
    expect(state.players.find((p) => p.id === 'p3')!.isPoisoned).toBe(false);
    expect(state.players.find((p) => p.id === 'p4')!.isPoisoned).toBe(true);
  });
});
