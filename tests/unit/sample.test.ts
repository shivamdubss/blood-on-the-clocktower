import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../../src/server/gameStateMachine.js';
import { DISTRIBUTION_TABLE } from '../../src/data/distribution.js';
import { ROLES } from '../../src/data/roles.js';
import { NIGHT_1_ORDER, NIGHT_OTHER_ORDER } from '../../src/data/nightOrder.js';

describe('game state machine', () => {
  it('creates initial game state with correct defaults', () => {
    const state = createInitialGameState('game-1', 'ABC123', 'storyteller-1');
    expect(state.id).toBe('game-1');
    expect(state.joinCode).toBe('ABC123');
    expect(state.phase).toBe('lobby');
    expect(state.players).toHaveLength(0);
    expect(state.winner).toBeNull();
  });
});

describe('role distribution table', () => {
  it('has 11 entries (5 to 15 players)', () => {
    expect(DISTRIBUTION_TABLE).toHaveLength(11);
  });

  it('always has exactly 1 demon', () => {
    for (const dist of DISTRIBUTION_TABLE) {
      expect(dist.demons).toBe(1);
    }
  });

  it('total roles equal player count', () => {
    for (const dist of DISTRIBUTION_TABLE) {
      const total = dist.townsfolk + dist.outsiders + dist.minions + dist.demons;
      expect(total).toBe(dist.players);
    }
  });
});

describe('roles data', () => {
  it('has 22 roles defined', () => {
    expect(ROLES).toHaveLength(22);
  });

  it('has all 14 Trouble Brewing roles', () => {
    const ids = ROLES.map((r) => r.id);
    const expected = [
      'washerwoman', 'librarian', 'investigator', 'chef', 'empath',
      'fortuneTeller', 'undertaker', 'monk', 'ravenkeeper', 'virgin',
      'slayer', 'soldier', 'mayor', 'butler', 'drunk', 'recluse',
      'saint', 'poisoner', 'spy', 'scarletWoman', 'baron', 'imp',
    ];
    for (const id of expected) {
      expect(ids).toContain(id);
    }
  });
});

describe('night order data', () => {
  it('night 1 order is an array', () => {
    expect(Array.isArray(NIGHT_1_ORDER)).toBe(true);
    expect(NIGHT_1_ORDER.length).toBeGreaterThan(0);
  });

  it('night 2+ order is an array', () => {
    expect(Array.isArray(NIGHT_OTHER_ORDER)).toBe(true);
    expect(NIGHT_OTHER_ORDER.length).toBeGreaterThan(0);
  });

  it('imp is in night 2+ order but not night 1', () => {
    expect(NIGHT_OTHER_ORDER).toContain('imp');
    expect(NIGHT_1_ORDER).not.toContain('imp');
  });
});
