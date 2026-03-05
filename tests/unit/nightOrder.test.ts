import { describe, it, expect } from 'vitest';
import {
  createInitialGameState,
  generateNightQueue,
  transitionToNight,
  resolveDawnDeaths,
} from '../../src/server/gameStateMachine.js';
import { NIGHT_1_ORDER, NIGHT_OTHER_ORDER } from '../../src/data/nightOrder.js';
import type { Player, RoleId } from '../../src/types/game.js';

function makePlayer(id: string, role: RoleId, isAlive = true, seatIndex = 0): Player {
  return {
    id,
    name: `Player ${id}`,
    trueRole: role,
    apparentRole: role === 'drunk' ? 'washerwoman' : role,
    isAlive,
    isPoisoned: false,
    isDrunk: role === 'drunk',
    hasGhostVote: true,
    ghostVoteUsed: false,
    seatIndex,
  };
}

describe('night order', () => {
  describe('static data', () => {
    it('Night 1 order and subsequent night order are separate arrays', () => {
      expect(Array.isArray(NIGHT_1_ORDER)).toBe(true);
      expect(Array.isArray(NIGHT_OTHER_ORDER)).toBe(true);
      expect(NIGHT_1_ORDER).not.toBe(NIGHT_OTHER_ORDER);
    });

    it('Night order is defined in src/data/nightOrder.ts as static data arrays', () => {
      expect(NIGHT_1_ORDER.length).toBeGreaterThan(0);
      expect(NIGHT_OTHER_ORDER.length).toBeGreaterThan(0);
    });

    it('Night 1 order matches the official Trouble Brewing order', () => {
      // Official Night 1 order: Poisoner, Spy, Washerwoman, Librarian, Investigator, Chef, Empath, Fortune Teller, Butler
      expect(NIGHT_1_ORDER).toEqual([
        'poisoner',
        'spy',
        'washerwoman',
        'librarian',
        'investigator',
        'chef',
        'empath',
        'fortuneTeller',
        'butler',
      ]);
    });

    it('Night 2+ order matches the official Trouble Brewing order', () => {
      // Official Night 2+ order: Poisoner, Monk, Spy, Imp, Ravenkeeper, Empath, Fortune Teller, Undertaker, Butler
      expect(NIGHT_OTHER_ORDER).toEqual([
        'poisoner',
        'monk',
        'spy',
        'imp',
        'ravenkeeper',
        'empath',
        'fortuneTeller',
        'undertaker',
        'butler',
      ]);
    });
  });

  describe('night queue', () => {
    it('generates Night 1 queue filtered to roles present in the game', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      // 7-player game: washerwoman, chef, empath, fortuneTeller, butler, poisoner, imp
      state = {
        ...state,
        dayNumber: 0, // next night will be Night 1
        players: [
          makePlayer('p1', 'washerwoman', true, 0),
          makePlayer('p2', 'chef', true, 1),
          makePlayer('p3', 'empath', true, 2),
          makePlayer('p4', 'fortuneTeller', true, 3),
          makePlayer('p5', 'butler', true, 4),
          makePlayer('p6', 'poisoner', true, 5),
          makePlayer('p7', 'imp', true, 6),
        ],
      };

      const queue = generateNightQueue(state);

      // Should only include roles in the game, in Night 1 order
      const roleIds = queue.map((e) => e.roleId);
      expect(roleIds).toEqual([
        'poisoner',
        'washerwoman',
        'chef',
        'empath',
        'fortuneTeller',
        'butler',
      ]);
    });

    it('generates Night 2+ queue filtered to roles present in the game', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = {
        ...state,
        dayNumber: 1, // next night will be Night 2
        players: [
          makePlayer('p1', 'empath', true, 0),
          makePlayer('p2', 'monk', true, 1),
          makePlayer('p3', 'fortuneTeller', true, 2),
          makePlayer('p4', 'undertaker', true, 3),
          makePlayer('p5', 'butler', true, 4),
          makePlayer('p6', 'poisoner', true, 5),
          makePlayer('p7', 'imp', true, 6),
        ],
      };

      const queue = generateNightQueue(state);

      const roleIds = queue.map((e) => e.roleId);
      expect(roleIds).toEqual([
        'poisoner',
        'monk',
        'imp',
        'empath',
        'fortuneTeller',
        'undertaker',
        'butler',
      ]);
    });

    it('excludes dead players from the night queue', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = {
        ...state,
        dayNumber: 0,
        players: [
          makePlayer('p1', 'washerwoman', true, 0),
          makePlayer('p2', 'chef', false, 1),  // dead
          makePlayer('p3', 'empath', true, 2),
          makePlayer('p4', 'poisoner', true, 3),
          makePlayer('p5', 'imp', true, 4),
        ],
      };

      const queue = generateNightQueue(state);
      const roleIds = queue.map((e) => e.roleId);

      expect(roleIds).not.toContain('chef');
      expect(roleIds).toEqual(['poisoner', 'washerwoman', 'empath']);
    });

    it('excludes roles not in the night order arrays (passive roles)', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = {
        ...state,
        dayNumber: 0,
        players: [
          makePlayer('p1', 'washerwoman', true, 0),
          makePlayer('p2', 'soldier', true, 1),   // not in night order
          makePlayer('p3', 'virgin', true, 2),     // not in night order
          makePlayer('p4', 'saint', true, 3),      // not in night order
          makePlayer('p5', 'poisoner', true, 4),
          makePlayer('p6', 'imp', true, 5),
          makePlayer('p7', 'baron', true, 6),      // not in night order
        ],
      };

      const queue = generateNightQueue(state);
      const roleIds = queue.map((e) => e.roleId);

      expect(roleIds).toEqual(['poisoner', 'washerwoman']);
      expect(roleIds).not.toContain('soldier');
      expect(roleIds).not.toContain('virgin');
      expect(roleIds).not.toContain('saint');
      expect(roleIds).not.toContain('baron');
    });

    it('maps each queue entry to the correct playerId', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = {
        ...state,
        dayNumber: 0,
        players: [
          makePlayer('alice', 'poisoner', true, 0),
          makePlayer('bob', 'washerwoman', true, 1),
          makePlayer('charlie', 'empath', true, 2),
          makePlayer('diana', 'imp', true, 3),
          makePlayer('eve', 'butler', true, 4),
        ],
      };

      const queue = generateNightQueue(state);

      expect(queue).toEqual([
        { roleId: 'poisoner', playerId: 'alice', completed: false },
        { roleId: 'washerwoman', playerId: 'bob', completed: false },
        { roleId: 'empath', playerId: 'charlie', completed: false },
        { roleId: 'butler', playerId: 'eve', completed: false },
      ]);
    });

    it('all queue entries start with completed: false', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = {
        ...state,
        dayNumber: 0,
        players: [
          makePlayer('p1', 'poisoner', true, 0),
          makePlayer('p2', 'washerwoman', true, 1),
          makePlayer('p3', 'imp', true, 2),
        ],
      };

      const queue = generateNightQueue(state);
      expect(queue.every((e) => e.completed === false)).toBe(true);
    });

    it('transitionToNight populates nightQueue and resets nightQueuePosition', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = {
        ...state,
        dayNumber: 1,
        phase: 'day',
        daySubPhase: 'end',
        players: [
          makePlayer('p1', 'empath', true, 0),
          makePlayer('p2', 'imp', true, 1),
          makePlayer('p3', 'poisoner', true, 2),
          makePlayer('p4', 'monk', true, 3),
          makePlayer('p5', 'butler', true, 4),
        ],
      };

      const result = transitionToNight(state);

      expect(result.nightQueue.length).toBeGreaterThan(0);
      expect(result.nightQueuePosition).toBe(0);
      const roleIds = result.nightQueue.map((e) => e.roleId);
      expect(roleIds).toEqual(['poisoner', 'monk', 'imp', 'empath', 'butler']);
    });

    it('Drunk appears in queue under their apparent role', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = {
        ...state,
        dayNumber: 0,
        players: [
          makePlayer('p1', 'drunk', true, 0),  // apparentRole is washerwoman
          makePlayer('p2', 'chef', true, 1),
          makePlayer('p3', 'poisoner', true, 2),
          makePlayer('p4', 'imp', true, 3),
          makePlayer('p5', 'empath', true, 4),
        ],
      };

      const queue = generateNightQueue(state);
      const roleIds = queue.map((e) => e.roleId);

      // Drunk's apparent ability fires as washerwoman in the night queue
      expect(roleIds).toContain('washerwoman');
      // The Drunk player should be the one in the washerwoman slot
      const washerwomanEntry = queue.find((e) => e.roleId === 'washerwoman');
      expect(washerwomanEntry?.playerId).toBe('p1');
      expect(roleIds).toEqual(['poisoner', 'washerwoman', 'chef', 'empath']);
    });

    it('returns empty queue when no alive roles match the night order', () => {
      let state = createInitialGameState('g1', 'ABC123', 'st1');
      state = {
        ...state,
        dayNumber: 0,
        players: [
          makePlayer('p1', 'soldier', true, 0),
          makePlayer('p2', 'virgin', true, 1),
          makePlayer('p3', 'saint', true, 2),
          makePlayer('p4', 'baron', true, 3),
          makePlayer('p5', 'scarletWoman', true, 4),
        ],
      };

      const queue = generateNightQueue(state);
      expect(queue).toEqual([]);
    });
  });
});
